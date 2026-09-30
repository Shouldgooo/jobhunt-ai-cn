'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const express = require('express');

const TEST_DB = path.join(os.tmpdir(), `jab_bulk_${Date.now()}.db`);
process.env.TEST_DB_PATH = TEST_DB;

const {
  insertApplication,
  getAllApplications,
  getApplicationById,
  updateAllApplicationStatuses,
  isValidStatus,
  VALID_STATUSES,
} = require('../db');
const { isValidStatus: routeValid, updateAllApplicationStatuses: routeUpdate } = require('../db');

after(() => {
  try { fs.unlinkSync(TEST_DB); } catch { /* ignore */ }
});

const SAMPLE = {
  created_at: '2026-03-18T10:00:00.000Z',
  company: 'Northwind',
  job_title: 'Warehouse Administrator',
  url: 'https://example.com/jobs/1',
  source: 'seek',
  jd_text: 'Troubleshoot hardware and help users.',
  stack_used: 'excel',
  fit_score: 71,
  resume_md: '## Experience\n\nOriginal resume.',
  cover_md: 'Dear Hiring Manager,\n\nOriginal letter.',
  change_summary: '{"status":"ok"}',
  status: 'not_started',
};

function snapshot(row) {
  const { status, ...rest } = row;
  void status;
  return rest;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

function jsonRequest(port, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: urlPath,
      method,
      headers: { 'Content-Type': 'application/json' },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* ignore */ }
        resolve({ status: res.statusCode, json, text });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

function mountBulkRoutes() {
  const app = express();
  app.use(express.json());
  app.patch('/api/applications/status/all', (req, res) => {
    const status = req.body && req.body.status;
    if (!routeValid(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    try {
      const updated = routeUpdate(status);
      res.json({ success: true, updated, status });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.patch('/api/applications/:id', (req, res) => {
    res.json({ capturedAsId: req.params.id });
  });
  return app;
}

test('all records become status applied and other fields stay unchanged', () => {
  const id1 = Number(insertApplication({ ...SAMPLE, company: 'Alpha', status: 'not_started' }));
  const id2 = Number(insertApplication({
    ...SAMPLE,
    created_at: '2026-03-19T10:00:00.000Z',
    company: 'Beta',
    job_title: 'IT Support',
    status: 'rejected',
  }));
  const before1 = getApplicationById(id1);
  const before2 = getApplicationById(id2);

  const updated = updateAllApplicationStatuses('applied');
  assert.ok(updated >= 2);

  const after1 = getApplicationById(id1);
  const after2 = getApplicationById(id2);
  assert.equal(after1.status, 'applied');
  assert.equal(after2.status, 'applied');
  assert.deepEqual(snapshot(after1), snapshot(before1));
  assert.deepEqual(snapshot(after2), snapshot(before2));
  assert.equal(after1.company, 'Alpha');
  assert.equal(after1.job_title, 'Warehouse Administrator');
  assert.equal(after1.jd_text, SAMPLE.jd_text);
  assert.equal(after1.resume_md, SAMPLE.resume_md);
  assert.equal(after1.cover_md, SAMPLE.cover_md);
  assert.equal(after1.change_summary, SAMPLE.change_summary);
  assert.equal(after1.created_at, SAMPLE.created_at);
  assert.equal(after1.status_log, before1.status_log);
});

test('empty history is a successful zero-row update', () => {
  const tmp = path.join(os.tmpdir(), `jab_bulk_empty_${Date.now()}.db`);
  const { spawnSync } = require('child_process');
  const dbModule = path.join(__dirname, '../db.js');
  const result = spawnSync(process.execPath, ['-e', `
    process.env.TEST_DB_PATH = ${JSON.stringify(tmp)};
    const { updateAllApplicationStatuses, getAllApplications } = require(${JSON.stringify(dbModule)});
    const updated = updateAllApplicationStatuses('applied');
    const all = getAllApplications();
    console.log(JSON.stringify({ updated, count: all.length }));
  `], { encoding: 'utf8', env: { ...process.env, TEST_DB_PATH: tmp } });
  try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout.trim().split('\n').pop());
  assert.equal(payload.updated, 0);
  assert.equal(payload.count, 0);
});

test('invalid status is rejected and does not change rows', () => {
  const id = Number(insertApplication({ ...SAMPLE, company: 'Gamma', status: 'followed_up' }));
  assert.equal(isValidStatus('hired'), false);
  assert.ok(VALID_STATUSES.includes('applied'));
  assert.throws(() => updateAllApplicationStatuses('hired'), /Invalid status/);
  assert.equal(getApplicationById(id).status, 'followed_up');
});

test('PATCH /api/applications/status/all updates in one request and rejects bad status', async () => {
  insertApplication({ ...SAMPLE, company: 'Delta', status: 'interviewed' });
  const { server, port } = await listen(mountBulkRoutes());
  try {
    const bad = await jsonRequest(port, 'PATCH', '/api/applications/status/all', { status: 'software_developer' });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error, 'Invalid status');

    const ok = await jsonRequest(port, 'PATCH', '/api/applications/status/all', { status: 'applied' });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.success, true);
    assert.equal(ok.json.status, 'applied');
    assert.ok(ok.json.updated >= 1);
    assert.ok(getAllApplications().every((row) => row.status === 'applied'));

    const shadowed = await jsonRequest(port, 'PATCH', '/api/applications/status/all', { status: 'applied' });
    assert.notEqual(shadowed.json.capturedAsId, 'status');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('bulk status update adds zero Gemini/LLM calls', () => {
  const dbSrc = fs.readFileSync(path.join(__dirname, '../db.js'), 'utf8');
  const serverSrc = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.match(dbSrc, /UPDATE applications SET status = \?/);
  assert.doesNotMatch(dbSrc, /generateContent|callLLM|gemini-3|LLM_PROVIDER/);
  assert.match(serverSrc, /\/applications\/status\/all/);
  const handler = serverSrc.split("api.patch('/applications/status/all'")[1].split('api.get')[0];
  assert.doesNotMatch(handler, /generateApplication|callLLM|gemini|ollama|tailor/i);
});
