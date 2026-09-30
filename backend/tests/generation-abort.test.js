'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const TEST_DB = path.join(os.tmpdir(), `jab_abort_test_${Date.now()}.db`);
process.env.TEST_DB_PATH = TEST_DB;

const { attachClientDisconnectAbort, CLIENT_DISCONNECTED } = require('../generation-abort');
const { runAnalyzeGeneration, isCancelledError } = require('../analyze-flow');
const { generateApplication, isUserCancelledError, workAbortedError } = require('../tailor');
const { getAllApplications } = require('../db');
const { generationKey, tryStartGeneration, finishGeneration } = require('../generation-lock');

after(() => {
  try { fs.unlinkSync(TEST_DB); } catch { /* ignore */ }
});

const JD = 'Job title: Support Engineer\nCompany: Northwind Analytics\nHelp customers.';
const BASE_MD = '---\nname: Jordan Avery\n---\n## Summary\nEngineer\n';

function mockReq() {
  const req = new EventEmitter();
  req.aborted = false;
  req.complete = true;
  return req;
}

function mockRes() {
  const res = new EventEmitter();
  res.writableEnded = false;
  res.end = () => { res.writableEnded = true; };
  return res;
}

function hangOnSignal(signal) {
  return new Promise((_, reject) => {
    if (signal?.aborted) {
      reject(workAbortedError(signal));
      return;
    }
    signal.addEventListener('abort', () => reject(workAbortedError(signal)), { once: true });
  });
}

test('req close after a fully received POST body does not abort pending Gemini', () => {
  const req = mockReq();
  const res = mockRes();
  const ac = new AbortController();
  const detach = attachClientDisconnectAbort(req, res, ac);

  req.emit('close');
  req.emit('end');

  assert.equal(ac.signal.aborted, false);
  detach();
});

test('Express POST body lifecycle close does not cancel a pending generation', async () => {
  const app = express();
  app.use(express.json());

  let sawReqClose = false;
  let abortedAfterBodyClose = false;
  let releaseGemini;

  const geminiHold = new Promise((resolve) => { releaseGemini = resolve; });

  app.post('/analyze-hold', (req, res) => {
    const ac = new AbortController();
    const detach = attachClientDisconnectAbort(req, res, ac);
    req.on('close', () => { sawReqClose = true; });

    queueMicrotask(() => {
      abortedAfterBodyClose = ac.signal.aborted;
    });

    geminiHold.then(() => {
      res.json({ aborted: ac.signal.aborted, sawReqClose });
      detach();
    });
  });

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  after(() => server.close());

  const { port } = server.address();
  const pending = fetch(`http://127.0.0.1:${port}/analyze-hold`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jd: JD }),
  });

  await new Promise((r) => setTimeout(r, 40));
  assert.equal(abortedAfterBodyClose, false);

  releaseGemini();
  const body = await pending.then((r) => r.json());
  assert.equal(body.aborted, false);
  assert.equal(typeof body.sawReqClose, 'boolean');
});

test('response close before completion aborts pending work as disconnect, not USER_CANCELLED', () => {
  const req = mockReq();
  const res = mockRes();
  const ac = new AbortController();
  attachClientDisconnectAbort(req, res, ac);

  res.emit('close');

  assert.equal(ac.signal.aborted, true);
  assert.equal(ac.signal.reason, CLIENT_DISCONNECTED);
  const err = workAbortedError(ac.signal);
  assert.equal(isCancelledError(err), true);
  assert.equal(isUserCancelledError(err), false);
  assert.match(err.message, /连接已中断/);
});

test('req aborted aborts pending Gemini without USER_CANCELLED', () => {
  const req = mockReq();
  const res = mockRes();
  const ac = new AbortController();
  attachClientDisconnectAbort(req, res, ac);

  req.emit('aborted');

  assert.equal(ac.signal.aborted, true);
  assert.equal(ac.signal.reason, CLIENT_DISCONNECTED);
  assert.equal(isUserCancelledError(workAbortedError(ac.signal)), false);
});

test('normal response end does not abort after detach/finish', () => {
  const req = mockReq();
  const res = mockRes();
  const ac = new AbortController();
  const detach = attachClientDisconnectAbort(req, res, ac);
  res.end();
  res.emit('close');
  detach();
  assert.equal(ac.signal.aborted, false);
});

test('long generation remains active beyond 5 minutes without disconnect abort', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const req = mockReq();
  const res = mockRes();
  const ac = new AbortController();
  attachClientDisconnectAbort(req, res, ac);
  req.emit('close');
  t.mock.timers.tick(5 * 60 * 1000 + 1000);
  assert.equal(ac.signal.aborted, false);
});

test('explicit USER_CANCELLED abort still cancels and writes no row', async () => {
  const key = generationKey({ jd: JD, resume_template_id: 0, generate_cover_letter: true });
  assert.equal(tryStartGeneration(key), true);
  const parent = new AbortController();
  const pending = generateApplication({
    jd: JD,
    baseMd: BASE_MD,
    generateCoverLetter: false,
  }, {
    signal: parent.signal,
    callLLM: async (_p, { signal }) => hangOnSignal(signal),
  });
  parent.abort('USER_CANCELLED');
  await assert.rejects(pending, (err) => (
    isUserCancelledError(err) && err.message === '生成已取消'
  ));
  finishGeneration(key);
  assert.equal(getAllApplications().length, 0);
  assert.equal(tryStartGeneration(key), true);
  finishGeneration(key);
});

test('unexpected disconnect aborts work, writes no row, releases lock, and is not USER_CANCELLED', async () => {
  const key = generationKey({ jd: JD, resume_template_id: 0, generate_cover_letter: true });
  assert.equal(tryStartGeneration(key), true);
  const ac = new AbortController();
  let inserted = false;
  const pending = runAnalyzeGeneration({
    body: { jd: JD },
    signal: ac.signal,
    generate: async (_args, { signal }) => hangOnSignal(signal),
    insert: () => { inserted = true; return 1; },
    isValidTheme: () => true,
    getUserConfig: () => ({ theme: 'classic' }),
  });
  ac.abort(CLIENT_DISCONNECTED);
  const err = await pending.then(() => null, (e) => e);
  assert.equal(isCancelledError(err), true);
  assert.equal(isUserCancelledError(err), false);
  assert.match(err.message, /连接已中断/);
  assert.equal(inserted, false);
  assert.equal(getAllApplications().length, 0);
  finishGeneration(key);
  assert.equal(tryStartGeneration(key), true);
  finishGeneration(key);
});

test('successful stream still reaches 100 after a harmless request-side close', async () => {
  const req = mockReq();
  const res = mockRes();
  const ac = new AbortController();
  attachClientDisconnectAbort(req, res, ac);
  req.emit('close');

  const events = [];
  const { application } = await runAnalyzeGeneration({
    body: { jd: JD, generate_cover_letter: false },
    signal: ac.signal,
    onProgress: (e) => events.push(e),
    isValidTheme: () => true,
    getUserConfig: () => ({ theme: 'classic' }),
    generate: async () => ({
      markdown: '# Resume\n',
      fit_score: 80,
      detected_skills: ['TypeScript'],
      job_title: 'Support Engineer',
      company: 'Northwind Analytics',
      location: 'Melbourne VIC',
      cover_md: '',
      cover_letter_available: false,
      tracker: { logicalCalls: 1, httpAttempts: 1 },
    }),
    insert: () => 42,
  });

  assert.equal(ac.signal.aborted, false);
  assert.equal(application.id, 42);
  assert.equal(events.at(-1).type, 'complete');
  assert.equal(events.at(-1).progress, 100);
});

test('real HTTP client abort closes the response and aborts pending work', async () => {
  const app = express();
  app.use(express.json());
  let backendAborted = false;
  let abortReason = null;

  app.post('/analyze-hold', (req, res) => {
    const ac = new AbortController();
    attachClientDisconnectAbort(req, res, ac);
    ac.signal.addEventListener('abort', () => {
      backendAborted = true;
      abortReason = ac.signal.reason;
      if (!res.writableEnded) {
        res.write(`${JSON.stringify({ type: 'error', error: '连接已中断，生成未完成。' })}\n`);
        res.end();
      }
    });
    res.status(200);
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.write(`${JSON.stringify({ type: 'progress', stage: 'generating', progress: 35 })}\n`);
  });

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  after(() => server.close());
  const { port } = server.address();

  const client = new AbortController();
  const pending = fetch(`http://127.0.0.1:${port}/analyze-hold`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
    body: JSON.stringify({ jd: JD }),
    signal: client.signal,
  });
  await new Promise((r) => setTimeout(r, 30));
  client.abort();
  await pending.catch(() => {});
  await new Promise((r) => setTimeout(r, 30));

  assert.equal(backendAborted, true);
  assert.equal(abortReason, CLIENT_DISCONNECTED);
});
