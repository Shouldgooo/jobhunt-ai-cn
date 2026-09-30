'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB = path.join(os.tmpdir(), `jab_longwait_test_${Date.now()}.db`);
process.env.TEST_DB_PATH = TEST_DB;

const {
  generateApplication,
  requestGeminiWithRetry,
  isCancelledError,
  GEMINI_GENERATION_CONFIG,
  buildGeminiRequestBody,
} = require('../tailor');
const { runAnalyzeGeneration } = require('../analyze-flow');
const { getAllApplications } = require('../db');
const { generationKey, tryStartGeneration, finishGeneration } = require('../generation-lock');
const { SEEK_STYLE } = require('./fixtures/job-ads');

after(() => {
  try { fs.unlinkSync(TEST_DB); } catch { /* ignore */ }
});

const BASE_MD = `---
name: Jordan Avery
---
## Summary
Engineer
`;

function okPayload() {
  return {
    tailored_resume_md: '# Resume\n',
    detected_skills: ['TypeScript'],
    fit_score: 80,
    job_title: 'Support Engineer',
    company: 'Northwind Analytics',
    location: 'Melbourne VIC',
    cover_letter: null,
  };
}

function httpErr(status) {
  const err = new Error('http');
  err.response = { status, data: { error: { message: 'busy', status: 'UNAVAILABLE' } } };
  return err;
}

function quotaErr(retryDelay) {
  const err = new Error('quota');
  err.response = {
    status: 429,
    data: {
      error: {
        code: 429,
        status: 'RESOURCE_EXHAUSTED',
        details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay }],
      },
    },
  };
  return err;
}

function hangOnSignal(signal) {
  return new Promise((_, reject) => {
    const fail = () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      reject(err);
    };
    if (signal?.aborted) fail();
    else signal.addEventListener('abort', fail, { once: true });
  });
}

async function runWithDelayedLlm(delayMs, t) {
  const events = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const pending = generateApplication({
    jd: 'Job title: Support Engineer\nCompany: Northwind Analytics\nHelp customers.',
    baseMd: BASE_MD,
    generateCoverLetter: false,
  }, {
    onProgress: (e) => events.push(e),
    callLLM: async (_prompt, { signal }) => {
      await gate;
      assert.equal(Boolean(signal?.aborted), false);
      return okPayload();
    },
  });
  await Promise.resolve();
  await Promise.resolve();
  t.mock.timers.tick(delayMs);
  const last = events.at(-1);
  assert.equal(last?.progress, 35);
  assert.equal(last?.stage, 'generating');
  assert.equal(events.some(e => e.type === 'complete' || e.progress === 100), false);
  release();
  const result = await pending;
  const stages = events.filter(e => e.type === 'progress').map(e => e.progress);
  assert.ok(stages.includes(35));
  assert.ok(stages.includes(85));
  assert.ok(stages.includes(90));
  assert.equal(result.tracker.logicalCalls, 1);
  return { events, result };
}

test('generation can remain at 35% beyond 120 seconds without auto-abort', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const { events } = await runWithDelayedLlm(120_000, t);
  assert.equal(events.filter(e => e.progress === 35).length >= 1, true);
});

test('generation can remain at 35% beyond 300 seconds without auto-abort', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  await runWithDelayedLlm(300_000, t);
});

test('no automatic AbortController fires after a long wait', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const ac = new AbortController();
  let released = false;
  const gate = new Promise((resolve) => {
    setTimeout(() => { released = true; resolve(); }, 400_000);
  });
  const pending = generateApplication({
    jd: 'Job title: Support Engineer\nCompany: Northwind Analytics\nHelp customers.',
    baseMd: BASE_MD,
    generateCoverLetter: false,
  }, {
    signal: ac.signal,
    callLLM: async (_p, { signal }) => {
      await gate;
      assert.equal(signal.aborted, false);
      assert.equal(ac.signal.aborted, false);
      return okPayload();
    },
  });
  t.mock.timers.tick(400_000);
  const result = await pending;
  assert.equal(released, true);
  assert.equal(ac.signal.aborted, false);
  assert.equal(result.fit_score, 80);
});

test('delayed Gemini success still walks 35 → 85 → 90 → 100', async () => {
  const events = [];
  let inserted = null;
  await runAnalyzeGeneration({
    body: { jd: 'Job title: Support Engineer\nCompany: Northwind Analytics\nHelp customers.' },
    generate: async (_args, { onProgress }) => {
      onProgress?.({ type: 'progress', stage: 'generating', progress: 35, message: 'AI 正在分析 JD 并生成定制简历…' });
      onProgress?.({ type: 'progress', stage: 'received', progress: 85, message: '正在处理 AI 返回结果…' });
      onProgress?.({ type: 'progress', stage: 'validating_result', progress: 90, message: '正在校验生成结果…' });
      return {
        markdown: '# Resume\n',
        fit_score: 80,
        detected_skills: ['TypeScript'],
        job_title: 'Support Engineer',
        company: 'Northwind Analytics',
        location: 'Melbourne VIC',
        cover_md: '',
        cover_letter_available: false,
        tracker: { logicalCalls: 1, httpAttempts: 1 },
      };
    },
    insert: (row) => { inserted = row; return 11; },
    isValidTheme: () => true,
    getUserConfig: () => ({ theme: 'classic' }),
    onProgress: (e) => events.push(e),
  });
  const marks = events.map(e => e.progress);
  assert.ok(marks.includes(35));
  assert.ok(marks.includes(85));
  assert.ok(marks.includes(90));
  assert.ok(marks.includes(95));
  assert.equal(events.at(-1).progress, 100);
  assert.equal(events.at(-1).type, 'complete');
  assert.ok(inserted);
});

test('manual cancellation still aborts, writes no row, and releases the lock', async () => {
  const jd = 'Job title: Support Engineer\nCompany: Northwind Analytics\nHelp customers.';
  const key = generationKey({ jd, resume_template_id: 0, generate_cover_letter: true });
  assert.equal(tryStartGeneration(key), true);
  const parent = new AbortController();
  const pending = generateApplication({
    jd,
    baseMd: BASE_MD,
    generateCoverLetter: false,
  }, {
    signal: parent.signal,
    callLLM: async (_p, { signal }) => hangOnSignal(signal),
  });
  setTimeout(() => parent.abort('USER_CANCELLED'), 15);
  await assert.rejects(pending, (err) => isCancelledError(err) && err.message === '生成已取消');
  finishGeneration(key);
  assert.equal(getAllApplications().length, 0);
  assert.equal(tryStartGeneration(key), true);
  finishGeneration(key);
});

test('real 429 handling still retries only on RetryInfo', async () => {
  let calls = 0;
  const delays = [];
  const result = await requestGeminiWithRetry(async () => {
    calls += 1;
    if (calls === 1) throw quotaErr('36s');
    return { ok: true };
  }, { sleep: async (ms) => { delays.push(ms); } });
  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 2);
  assert.deepEqual(delays, [36000]);
});

test('real 503 handling still retries with backoff', async () => {
  let calls = 0;
  const delays = [];
  const result = await requestGeminiWithRetry(async () => {
    calls += 1;
    if (calls === 1) throw httpErr(503);
    return { ok: true };
  }, { sleep: async (ms) => { delays.push(ms); } });
  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 2);
  assert.deepEqual(delays, [2000]);
});

test('thinkingLevel=low remains active', () => {
  assert.equal(GEMINI_GENERATION_CONFIG.thinkingConfig.thinkingLevel, 'low');
  assert.equal(buildGeminiRequestBody('x').generationConfig.thinkingConfig.thinkingLevel, 'low');
});

test('cleaned JD is sent to Gemini; raw JD is stored', async () => {
  let prompt = '';
  let stored = null;
  const result = await generateApplication({
    jd: SEEK_STYLE,
    baseMd: BASE_MD,
    generateCoverLetter: false,
  }, {
    callLLM: async (text) => {
      prompt = text;
      return okPayload();
    },
  });
  assert.equal(prompt.includes('View all jobs'), false);
  assert.match(prompt, /Help customers with outdoor equipment systems/);
  assert.ok(result.cleanedJdChars < result.rawJdChars);
  assert.equal(result.tracker.logicalCalls, 1);

  await runAnalyzeGeneration({
    body: { jd: SEEK_STYLE, generate_cover_letter: false },
    generate: async ({ jd }) => {
      assert.equal(jd, SEEK_STYLE);
      return {
        markdown: '# Resume\n',
        fit_score: 80,
        detected_skills: ['TypeScript'],
        job_title: 'Network Support',
        company: 'Example Outdoor',
        location: 'Richmond, Melbourne VIC',
        cover_md: '',
        cover_letter_available: false,
        tracker: { logicalCalls: 1, httpAttempts: 1 },
      };
    },
    insert: (row) => { stored = row; return 3; },
    isValidTheme: () => true,
    getUserConfig: () => ({ theme: 'classic' }),
  });
  assert.equal(stored.jd_text, SEEK_STYLE);
});
