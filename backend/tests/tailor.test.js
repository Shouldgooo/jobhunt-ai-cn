'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const path     = require('path');
const fs       = require('fs');

// ─── Module exports ───────────────────────────────────────────────────────────

test('tailor.js exports tailorResume and rescoreResume', () => {
  const mod = require('../tailor');
  assert.equal(typeof mod.tailorResume,  'function', 'tailorResume should be a function');
  assert.equal(typeof mod.rescoreResume, 'function', 'rescoreResume should be a function');
});

test('formatLlmError surfaces Gemini 404 model message instead of raw axios text', () => {
  const { formatLlmError } = require('../tailor');
  const wrapped = formatLlmError({
    response: {
      status: 404,
      data: { error: { message: 'This model models/gemini-2.5-flash is no longer available to new users.' } },
    },
  });
  assert.ok(wrapped instanceof Error);
  assert.match(wrapped.message, /404/);
  assert.match(wrapped.message, /no longer available/);
  assert.match(wrapped.message, /GEMINI_MODEL/);
  assert.ok(!wrapped.message.includes('Request failed with status code 404'));
});

test('geminiModel defaults to gemini-3.6-flash when GEMINI_MODEL is unset', () => {
  const prev = process.env.GEMINI_MODEL;
  delete process.env.GEMINI_MODEL;
  delete require.cache[require.resolve('../tailor')];
  try {
    const { geminiModel } = require('../tailor');
    assert.equal(geminiModel(), 'gemini-3.6-flash');
  } finally {
    if (prev !== undefined) process.env.GEMINI_MODEL = prev;
    else delete process.env.GEMINI_MODEL;
    delete require.cache[require.resolve('../tailor')];
  }
});

function httpErr(status, message = 'busy') {
  const err = new Error(`Request failed with status code ${status}`);
  err.response = { status, data: { error: { message } } };
  return err;
}

async function withSilentWarn(fn) {
  const orig = console.warn;
  const logs = [];
  console.warn = (...args) => { logs.push(args.join(' ')); };
  try {
    return { result: await fn(), logs };
  } catch (err) {
    return { error: err, logs };
  } finally {
    console.warn = orig;
  }
}

test('requestGeminiWithRetry: 503 then success retries once with 2s delay', async () => {
  const { requestGeminiWithRetry, GEMINI_RETRY_DELAYS_MS } = require('../tailor');
  let calls = 0;
  const delays = [];
  const { result, logs } = await withSilentWarn(() => requestGeminiWithRetry(async () => {
    calls += 1;
    if (calls === 1) throw httpErr(503);
    return { ok: true };
  }, { sleep: async (ms) => { delays.push(ms); } }));

  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 2);
  assert.deepEqual(delays, [GEMINI_RETRY_DELAYS_MS[0]]);
  assert.equal(GEMINI_RETRY_DELAYS_MS[0], 2000);
  assert.match(logs[0], /HTTP 503/);
  assert.match(logs[0], /attempt 1/);
  assert.match(logs[0], /2000ms/);
});

test('requestGeminiWithRetry: repeated 503 failures exhaust 3 retries then throw', async () => {
  const { requestGeminiWithRetry, GEMINI_RETRY_DELAYS_MS } = require('../tailor');
  let calls = 0;
  const delays = [];
  const { error, logs } = await withSilentWarn(() => requestGeminiWithRetry(async () => {
    calls += 1;
    throw httpErr(503);
  }, { sleep: async (ms) => { delays.push(ms); } }));

  assert.ok(error);
  assert.match(error.message, /temporarily unavailable after 3 retries/i);
  assert.equal(calls, 4);
  assert.deepEqual(delays, GEMINI_RETRY_DELAYS_MS);
  assert.equal(logs.length, 3);
  assert.match(logs[0], /HTTP 503/);
  assert.match(logs[1], /attempt 2/);
  assert.match(logs[2], /8000ms/);
});

test('requestGeminiWithRetry: 429 is retried', async () => {
  const { requestGeminiWithRetry, GEMINI_RETRY_DELAYS_MS } = require('../tailor');
  let calls = 0;
  const delays = [];
  const { result, logs } = await withSilentWarn(() => requestGeminiWithRetry(async () => {
    calls += 1;
    if (calls === 1) throw httpErr(429, 'quota');
    return { ok: true };
  }, { sleep: async (ms) => { delays.push(ms); } }));

  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 2);
  assert.deepEqual(delays, [GEMINI_RETRY_DELAYS_MS[0]]);
  assert.match(logs[0], /HTTP 429/);
  assert.match(logs[0], /2000ms/);
});

test('requestGeminiWithRetry: 404 is not retried', async () => {
  const { requestGeminiWithRetry } = require('../tailor');
  let calls = 0;
  const delays = [];
  const { error, logs } = await withSilentWarn(() => requestGeminiWithRetry(async () => {
    calls += 1;
    throw httpErr(404, 'This model models/gemini-2.5-flash is no longer available to new users.');
  }, { sleep: async (ms) => { delays.push(ms); } }));

  assert.ok(error);
  assert.equal(calls, 1);
  assert.deepEqual(delays, []);
  assert.equal(logs.length, 0);
  assert.match(error.message, /404/);
  assert.match(error.message, /no longer available/);
  assert.ok(!error.message.includes('temporarily unavailable after 3 retries'));
});

// ─── tailorResume — missing cv.md ─────────────────────────────────────────────

test('tailorResume throws when cv.md is missing and no baseMd provided', async () => {
  const cvPath = path.resolve(__dirname, '../../user/cv.md');
  const tmpPath = cvPath + '.bak';
  const existed = fs.existsSync(cvPath);
  if (existed) fs.renameSync(cvPath, tmpPath);

  try {
    delete require.cache[require.resolve('../tailor')];
    const { tailorResume } = require('../tailor');
    await assert.rejects(
      () => tailorResume({ jd: 'some jd text' }),
      /cv\.md/i
    );
  } finally {
    if (existed) fs.renameSync(tmpPath, cvPath);
    delete require.cache[require.resolve('../tailor')];
  }
});

// ─── tailorResume — uses provided baseMd over cv.md ──────────────────────────

test('tailorResume uses baseMd when provided (no Gemini call made for validation)', async () => {
  delete require.cache[require.resolve('../tailor')];
  const { tailorResume } = require('../tailor');
  try {
    await tailorResume({ jd: 'test jd', baseMd: '# My CV\n\nSome content' });
  } catch (err) {
    assert.ok(
      !err.message.includes('cv.md not found'),
      `Unexpected cv.md error when baseMd provided: ${err.message}`
    );
  }
});

// ─── prompts/tailor.md — exists and has placeholders ─────────────────────────

test('prompts/tailor.md exists and contains required placeholders', () => {
  const tailorMdPath = path.resolve(__dirname, '../../prompts/tailor.md');
  assert.ok(fs.existsSync(tailorMdPath), 'prompts/tailor.md must exist');
  const content = fs.readFileSync(tailorMdPath, 'utf8');
  assert.ok(content.includes('{{PROFILE}}'), 'prompts/tailor.md must contain {{PROFILE}} placeholder');
  assert.ok(content.includes('{{CV}}'),      'prompts/tailor.md must contain {{CV}} placeholder');
  assert.ok(content.includes('{{JD}}'),      'prompts/tailor.md must contain {{JD}} placeholder');
});

// ─── user/prompts.json — rescore and coverletter keys ────────────────────────

test('prompts.json contains rescore and coverletter keys with required placeholders', () => {
  // Fall back to example file in CI where user/ is gitignored
  const promptsPath = path.resolve(__dirname, '../../user/prompts.json');
  const examplePath = path.resolve(__dirname, '../../user/prompts.example.json');
  const filePath = fs.existsSync(promptsPath) ? promptsPath : examplePath;
  assert.ok(fs.existsSync(filePath), 'user/prompts.json or prompts.example.json must exist');

  const prompts = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(typeof prompts.rescore,     'string', 'rescore key must be a string');
  assert.equal(typeof prompts.coverletter, 'string', 'coverletter key must be a string');
  assert.ok(prompts.rescore.includes('{{CV}}'),      'rescore prompt must contain {{CV}}');
  assert.ok(prompts.rescore.includes('{{JD}}'),      'rescore prompt must contain {{JD}}');
  assert.ok(prompts.coverletter.includes('{{JD}}'),  'coverletter prompt must contain {{JD}}');
});

// ─── user/cv.md — exists and has content ─────────────────────────────────────

test('user/cv.md (or example) exists and is non-empty', () => {
  // Fall back to example file in CI where user/ is gitignored
  const cvPath      = path.resolve(__dirname, '../../user/cv.md');
  const examplePath = path.resolve(__dirname, '../../user/cv.example.md');
  const filePath = fs.existsSync(cvPath) ? cvPath : examplePath;
  assert.ok(fs.existsSync(filePath), 'user/cv.md or cv.example.md must exist');
  const content = fs.readFileSync(filePath, 'utf8');
  assert.ok(content.length > 100, 'CV file must have substantial content');
});

test('user/cv.md (or example) has no unfilled {{placeholders}}', () => {
  const cvPath      = path.resolve(__dirname, '../../user/cv.md');
  const examplePath = path.resolve(__dirname, '../../user/cv.example.md');
  const filePath = fs.existsSync(cvPath) ? cvPath : examplePath;
  const content = fs.readFileSync(filePath, 'utf8');
  const placeholders = content.match(/\{\{[^}]+\}\}/g) || [];
  assert.equal(
    placeholders.length, 0,
    `CV file should have no placeholders, found: ${placeholders.join(', ')}`
  );
});
