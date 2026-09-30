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

function httpErr(status, message = 'busy', extras = {}) {
  const err = new Error(`Request failed with status code ${status}`);
  const error = { message };
  if (extras.code != null) error.code = extras.code;
  if (extras.status != null) error.status = extras.status;
  if (extras.details) error.details = extras.details;
  err.response = { status, data: { error } };
  return err;
}

function quotaErr({ retryDelay, message } = {}) {
  const details = retryDelay
    ? [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay }]
    : undefined;
  return httpErr(
    429,
    message || 'You exceeded your current quota, please check your plan and billing details.',
    { code: 429, status: 'RESOURCE_EXHAUSTED', details }
  );
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

test('parseGeminiRetryDelayMs accepts protobuf Duration strings', () => {
  const { parseGeminiRetryDelayMs } = require('../tailor');
  assert.equal(parseGeminiRetryDelayMs('36s'), 36000);
  assert.equal(parseGeminiRetryDelayMs('36.884777933s'), 36885);
  assert.equal(parseGeminiRetryDelayMs('1.5s'), 1500);
  assert.equal(parseGeminiRetryDelayMs(null), null);
  assert.equal(parseGeminiRetryDelayMs('soon'), null);
});

test('extractGeminiErrorInfo reads RetryInfo and RESOURCE_EXHAUSTED', () => {
  const { extractGeminiErrorInfo } = require('../tailor');
  const info = extractGeminiErrorInfo(quotaErr({ retryDelay: '36.884777933s' }));
  assert.equal(info.httpStatus, 429);
  assert.equal(info.code, 429);
  assert.equal(info.status, 'RESOURCE_EXHAUSTED');
  assert.equal(info.retryDelayMs, 36885);
});

test('extractGeminiErrorInfo falls back to "retry in Ns" in the message', () => {
  const { extractGeminiErrorInfo } = require('../tailor');
  const info = extractGeminiErrorInfo(httpErr(
    429,
    'Quota exceeded. Please retry in 36.884777933s.',
    { code: 429, status: 'RESOURCE_EXHAUSTED' }
  ));
  assert.equal(info.retryDelayMs, 36885);
});

test('formatLlmError: 429 with RetryInfo includes approximate wait', () => {
  const { formatLlmError } = require('../tailor');
  const wrapped = formatLlmError(quotaErr({ retryDelay: '36.884777933s' }));
  assert.match(wrapped.message, /额度已达到限制/);
  assert.match(wrapped.message, /约 40 秒后重试/);
  assert.ok(!wrapped.message.includes('temporarily unavailable'));
});

test('formatLlmError: 429 without RetryInfo has no specific wait', () => {
  const { formatLlmError } = require('../tailor');
  const wrapped = formatLlmError(quotaErr());
  assert.equal(wrapped.message, 'Gemini API 请求额度已达到限制，请稍后重试。');
  assert.ok(!wrapped.message.includes('约'));
});

test('formatLlmError: 503 is a Chinese busy message', () => {
  const { formatLlmError } = require('../tailor');
  const wrapped = formatLlmError(httpErr(503, 'The model is overloaded.'));
  assert.equal(wrapped.message, 'Gemini 服务暂时繁忙，请稍后重试。');
});

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

test('requestGeminiWithRetry: repeated 503 failures exhaust 3 retries then formatLlmError', async () => {
  const { requestGeminiWithRetry, GEMINI_RETRY_DELAYS_MS } = require('../tailor');
  let calls = 0;
  const delays = [];
  const { error, logs } = await withSilentWarn(() => requestGeminiWithRetry(async () => {
    calls += 1;
    throw httpErr(503, 'The model is overloaded.');
  }, { sleep: async (ms) => { delays.push(ms); } }));

  assert.ok(error);
  assert.equal(error.message, 'Gemini 服务暂时繁忙，请稍后重试。');
  assert.ok(!error.message.includes('temporarily unavailable after 3 retries'));
  assert.equal(calls, 4);
  assert.deepEqual(delays, GEMINI_RETRY_DELAYS_MS);
  assert.ok(logs.length >= 3);
  assert.match(logs[0], /HTTP 503/);
  assert.match(logs[1], /attempt 2/);
  assert.match(logs[2], /8000ms/);
});

test('requestGeminiWithRetry: 429 with RetryInfo waits server delay then succeeds', async () => {
  const { requestGeminiWithRetry } = require('../tailor');
  let calls = 0;
  const delays = [];
  const { result, logs } = await withSilentWarn(() => requestGeminiWithRetry(async () => {
    calls += 1;
    if (calls === 1) throw quotaErr({ retryDelay: '36s' });
    return { ok: true };
  }, { sleep: async (ms) => { delays.push(ms); } }));

  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 2);
  assert.deepEqual(delays, [36000]);
  assert.match(logs[0], /HTTP 429/);
  assert.match(logs[0], /status=RESOURCE_EXHAUSTED/);
  assert.match(logs[0], /code=429/);
  assert.match(logs[0], /retryDelay=36000ms/);
  assert.match(logs[0], /36000ms/);
  assert.ok(!logs.some(l => /2000ms/.test(l)));
});

test('requestGeminiWithRetry: 429 with RetryInfo still failing returns quota error', async () => {
  const { requestGeminiWithRetry } = require('../tailor');
  let calls = 0;
  const delays = [];
  const { error, logs } = await withSilentWarn(() => requestGeminiWithRetry(async () => {
    calls += 1;
    throw quotaErr({ retryDelay: '36.884777933s' });
  }, { sleep: async (ms) => { delays.push(ms); } }));

  assert.ok(error);
  assert.equal(calls, 2);
  assert.deepEqual(delays, [36885]);
  assert.match(error.message, /额度已达到限制/);
  assert.match(error.message, /约 40 秒后重试/);
  assert.ok(!error.message.includes('temporarily unavailable'));
  assert.match(logs[0], /HTTP 429/);
  assert.match(logs[0], /RESOURCE_EXHAUSTED/);
});

test('requestGeminiWithRetry: 429 without RetryInfo is not retried', async () => {
  const { requestGeminiWithRetry } = require('../tailor');
  let calls = 0;
  const delays = [];
  const { error, logs } = await withSilentWarn(() => requestGeminiWithRetry(async () => {
    calls += 1;
    throw quotaErr();
  }, { sleep: async (ms) => { delays.push(ms); } }));

  assert.ok(error);
  assert.equal(calls, 1);
  assert.deepEqual(delays, []);
  assert.equal(error.message, 'Gemini API 请求额度已达到限制，请稍后重试。');
  assert.match(logs[0], /HTTP 429/);
  assert.match(logs[0], /not retrying/);
});

test('requestGeminiWithRetry: 429 with long RetryInfo is not auto-waited', async () => {
  const { requestGeminiWithRetry, MAX_QUOTA_WAIT_MS } = require('../tailor');
  let calls = 0;
  const delays = [];
  const { error } = await withSilentWarn(() => requestGeminiWithRetry(async () => {
    calls += 1;
    throw quotaErr({ retryDelay: '90s' });
  }, { sleep: async (ms) => { delays.push(ms); } }));

  assert.ok(error);
  assert.equal(calls, 1);
  assert.deepEqual(delays, []);
  assert.ok(90000 > MAX_QUOTA_WAIT_MS);
  assert.match(error.message, /约 90 秒后重试/);
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
  const { generateApplication } = require('../tailor');
  let promptSeen = '';
  const result = await generateApplication({
    jd: 'test jd',
    baseMd: '# My CV\n\nSome content',
    generateCoverLetter: false,
  }, {
    callLLM: async (prompt) => {
      promptSeen = prompt;
      return {
        tailored_resume_md: '# My CV\n\nSome content',
        detected_skills: ['TypeScript'],
        fit_score: 70,
        job_title: 'Engineer',
        company: 'Acme',
        location: '',
        archetype: 'Full-stack SWE',
        cover_letter: null,
      };
    },
  });
  assert.match(promptSeen, /# My CV/);
  assert.match(promptSeen, /Some content/);
  assert.ok(!result.markdown.includes('cv.md not found'));
});

// ─── prompts/tailor.md — exists and has placeholders ─────────────────────────

test('prompts/tailor.md exists and contains required placeholders', () => {
  const tailorMdPath = path.resolve(__dirname, '../../prompts/tailor.md');
  assert.ok(fs.existsSync(tailorMdPath), 'prompts/tailor.md must exist');
  const content = fs.readFileSync(tailorMdPath, 'utf8');
  assert.ok(content.includes('{{PROFILE}}'), 'prompts/tailor.md must contain {{PROFILE}} placeholder');
  assert.ok(content.includes('{{CV}}'),      'prompts/tailor.md must contain {{CV}} placeholder');
  assert.ok(content.includes('{{JD}}'),      'prompts/tailor.md must contain {{JD}} placeholder');
  assert.match(content, /WORK EXPERIENCE is a major tailoring target/);
  assert.match(content, /Official Title \| Functional Focus/);
  assert.match(content, /Do NOT move personal\/portfolio projects into WORK EXPERIENCE/);
  assert.equal(content.includes('Do NOT rewrite bullet text'), false);
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
