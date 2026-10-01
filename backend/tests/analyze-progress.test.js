'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB = path.join(os.tmpdir(), `jab_progress_test_${Date.now()}.db`);
process.env.TEST_DB_PATH = TEST_DB;

const { runAnalyzeGeneration, isCancelledError } = require('../analyze-flow');
const { generateApplication, cancelledError } = require('../tailor');
const { getAllApplications } = require('../db');
const { generationKey, tryStartGeneration, finishGeneration } = require('../generation-lock');

after(() => {
  try { fs.unlinkSync(TEST_DB); } catch { /* ignore */ }
});

const JD = `
Job title: Support Engineer
Company: Northwind Analytics
Location: Melbourne VIC

Help customers with TypeScript tools.
`;

function fakeGenerated(overrides = {}) {
  return {
    markdown: '# Resume\nJordan Avery\n',
    fit_score: 80,
    detected_skills: ['TypeScript'],
    job_title: 'Support Engineer',
    company: 'Northwind Analytics',
    location: 'Melbourne VIC',
    cover_md: '',
    cover_letter_available: false,
    tracker: { logicalCalls: 1, httpAttempts: 1 },
    ...overrides,
  };
}

function deps({ generate, insert } = {}) {
  return {
    isValidTheme: () => true,
    getUserConfig: () => ({ theme: 'classic' }),
    generate: generate || (async (_args, { onProgress } = {}) => {
      onProgress?.({ type: 'progress', stage: 'preparing', progress: 30, message: '正在准备生成内容…' });
      onProgress?.({ type: 'progress', stage: 'sending', progress: 35, message: '正在连接 Gemini…' });
      onProgress?.({ type: 'progress', stage: 'generating', progress: 35, message: 'AI 正在分析 JD 并生成定制简历…' });
      onProgress?.({ type: 'progress', stage: 'received', progress: 85, message: '正在处理 AI 返回结果…' });
      onProgress?.({ type: 'progress', stage: 'validating_result', progress: 90, message: '正在校验生成结果…' });
      return fakeGenerated();
    }),
    insert: insert || (() => 101),
  };
}

test('successful progress sequence maps real stages', async () => {
  const events = [];
  const { application } = await runAnalyzeGeneration({
    body: { jd: JD, generate_cover_letter: false },
    onProgress: (e) => events.push(e),
    ...deps(),
  });

  const stages = events.filter(e => e.type === 'progress').map(e => [e.stage, e.progress]);
  assert.deepEqual(stages, [
    ['accepted', 5],
    ['validating', 10],
    ['parsing', 20],
    ['preparing', 30],
    ['sending', 35],
    ['generating', 35],
    ['received', 85],
    ['validating_result', 90],
    ['saving', 95],
  ]);
  assert.equal(events.at(-1).type, 'complete');
  assert.equal(events.at(-1).progress, 100);
  assert.equal(application.id, 101);
});

test('progress reaches 100 only after successful save', async () => {
  const events = [];
  let saved = false;
  await runAnalyzeGeneration({
    body: { jd: JD, generate_cover_letter: false },
    onProgress: (e) => events.push(e),
    ...deps({
      insert: () => {
        assert.equal(events.some(e => e.progress === 100), false);
        saved = true;
        return 7;
      },
    }),
  });
  assert.equal(saved, true);
  assert.equal(events.at(-1).progress, 100);
  assert.equal(events.at(-1).type, 'complete');
});

test('cancellation before Gemini call creates no application and skips generate', async () => {
  const ac = new AbortController();
  ac.abort();
  let generated = false;
  let inserted = false;
  await assert.rejects(
    () => runAnalyzeGeneration({
      body: { jd: JD },
      signal: ac.signal,
      generate: async () => { generated = true; return fakeGenerated(); },
      insert: () => { inserted = true; return 1; },
      isValidTheme: () => true,
      getUserConfig: () => ({ theme: 'classic' }),
    }),
    (err) => isCancelledError(err)
  );
  assert.equal(generated, false);
  assert.equal(inserted, false);
  assert.equal(getAllApplications().length, 0);
});

test('cancellation while waiting for Gemini creates no application record', async () => {
  const ac = new AbortController();
  let inserted = false;
  const pending = runAnalyzeGeneration({
    body: { jd: JD },
    signal: ac.signal,
    onProgress() {},
    generate: async (_args, { signal }) => {
      await new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(cancelledError()), { once: true });
      });
    },
    insert: () => { inserted = true; return 1; },
    isValidTheme: () => true,
    getUserConfig: () => ({ theme: 'classic' }),
  });
  setTimeout(() => ac.abort(), 20);
  await assert.rejects(pending, (err) => isCancelledError(err));
  assert.equal(inserted, false);
  assert.equal(getAllApplications().length, 0);
});

test('generation lock is released after cancellation and can start again', async () => {
  const key = generationKey({ jd: JD, resume_template_id: 0, generate_cover_letter: true });
  assert.equal(tryStartGeneration(key), true);
  const ac = new AbortController();
  ac.abort();
  try {
    await runAnalyzeGeneration({
      body: { jd: JD },
      signal: ac.signal,
      ...deps(),
    });
  } catch (err) {
    assert.equal(isCancelledError(err), true);
  } finally {
    finishGeneration(key);
  }
  assert.equal(tryStartGeneration(key), true);
  finishGeneration(key);
});

test('normal generation still uses one logical Gemini request', async () => {
  let calls = 0;
  const result = await generateApplication({
    jd: JD,
    baseMd: '---\nname: Jordan Avery\n---\n## Summary\nEngineer\n',
    generateCoverLetter: false,
  }, {
    callLLM: async () => {
      calls += 1;
      return {
        tailored_resume_md: '# Resume\n',
        detected_skills: ['TypeScript'],
        fit_score: 80,
        job_title: 'Support Engineer',
        company: 'Northwind Analytics',
        location: 'Melbourne VIC',
        cover_letter: null,
      };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.tracker.logicalCalls, 1);
});

test('429 retry emits quota progress message without extra logical calls', async () => {
  const events = [];
  const result = await generateApplication({
    jd: JD,
    baseMd: '---\nname: Jordan Avery\n---\n## Summary\nEngineer\n',
    generateCoverLetter: false,
  }, {
    callLLM: async (_prompt, { onRetry } = {}) => {
      onRetry?.({ status: 429, attempt: 1, delayMs: 1000, kind: 'quota' });
      return {
        tailored_resume_md: '# Resume\n',
        detected_skills: ['TypeScript'],
        fit_score: 80,
        job_title: 'Support Engineer',
        company: 'Northwind Analytics',
        location: 'Melbourne VIC',
        cover_letter: null,
      };
    },
    onProgress: (e) => events.push(e),
  });
  const retry = events.find(e => e.stage === 'retrying');
  assert.ok(retry);
  assert.match(retry.message, /额度紧张/);
  assert.equal(retry.progress, 35);
  assert.equal(result.tracker.logicalCalls, 1);
});

test('503 retry emits busy progress message', async () => {
  const events = [];
  await generateApplication({
    jd: JD,
    baseMd: '---\nname: Jordan Avery\n---\n## Summary\nEngineer\n',
    generateCoverLetter: false,
  }, {
    callLLM: async (_prompt, { onRetry } = {}) => {
      onRetry?.({ status: 503, attempt: 1, delayMs: 2000, kind: 'busy' });
      return {
        tailored_resume_md: '# Resume\n',
        detected_skills: ['TypeScript'],
        fit_score: 80,
        job_title: 'Support Engineer',
        company: 'Northwind Analytics',
        location: 'Melbourne VIC',
        cover_letter: null,
      };
    },
    onProgress: (e) => events.push(e),
  });
  const retry = events.find(e => e.stage === 'retrying');
  assert.ok(retry);
  assert.match(retry.message, /暂时繁忙/);
  assert.match(retry.message, /1\/3/);
  assert.equal(retry.progress, 35);
});

test('JSON/schema failure does not insert and a later retry does not duplicate', async () => {
  let inserts = 0;
  let calls = 0;
  const fail = Object.assign(new Error('AI 返回的数据结构不完整，本次申请未保存。请重新尝试。'), { statusCode: 502 });
  await assert.rejects(
    () => runAnalyzeGeneration({
      body: { jd: JD, generate_cover_letter: false },
      ...deps({
        generate: async () => { calls += 1; throw fail; },
        insert: () => { inserts += 1; return 1; },
      }),
    }),
    /申请未保存/,
  );
  assert.equal(calls, 1);
  assert.equal(inserts, 0);
  assert.equal(getAllApplications().length, 0);

  const key = generationKey({ jd: JD, resume_template_id: 0, generate_cover_letter: false });
  assert.equal(tryStartGeneration(key), true);
  finishGeneration(key);
  assert.equal(tryStartGeneration(key), true);
  finishGeneration(key);

  const { application } = await runAnalyzeGeneration({
    body: { jd: JD, generate_cover_letter: false },
    ...deps({
      generate: async () => { calls += 1; return fakeGenerated(); },
      insert: () => { inserts += 1; return 55; },
    }),
  });
  assert.equal(calls, 2);
  assert.equal(inserts, 1);
  assert.equal(application.id, 55);
});

test('Gemini 403 does not insert and releases the generation lock', async () => {
  const { formatLlmError } = require('../tailor');
  let inserts = 0;
  let calls = 0;
  const fail = formatLlmError({
    message: 'Request failed with status code 403',
    response: {
      status: 403,
      data: {
        error: {
          code: 403,
          message: 'Permission denied',
          status: 'PERMISSION_DENIED',
        },
      },
    },
    config: { url: 'https://example/?key=AIzaSySHOULDNOTLEAK1234567890abc' },
  });
  await assert.rejects(
    () => runAnalyzeGeneration({
      body: { jd: JD, generate_cover_letter: false },
      ...deps({
        generate: async () => { calls += 1; throw fail; },
        insert: () => { inserts += 1; return 1; },
      }),
    }),
    (err) => {
      assert.match(err.message, /拒绝了当前请求/);
      assert.doesNotMatch(err.message, /Request failed with status code 403/);
      assert.doesNotMatch(err.message, /AIzaSy/);
      return err.statusCode === 403;
    },
  );
  assert.equal(calls, 1);
  assert.equal(inserts, 0);
  assert.equal(getAllApplications().length, 0);

  const key = generationKey({ jd: JD, resume_template_id: 0, generate_cover_letter: false });
  assert.equal(tryStartGeneration(key), true);
  finishGeneration(key);
});
