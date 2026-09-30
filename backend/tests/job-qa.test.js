'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB = path.join(os.tmpdir(), `jab_qa_${Date.now()}.db`);
process.env.TEST_DB_PATH = TEST_DB;

const {
  parseQaThread,
  normalizeQuestion,
  buildQaPrompt,
  extractAnswer,
  answerJobQuestion,
  MAX_QUESTION_CHARS,
} = require('../job-qa');
const { insertApplication, getApplicationById, updateApplication } = require('../db');

after(() => {
  try { fs.unlinkSync(TEST_DB); } catch { /* ignore */ }
});

const SAMPLE = {
  created_at: '2026-03-18T10:00:00.000Z',
  company: 'Northwind Analytics',
  job_title: 'IT Support Engineer',
  url: 'https://example.com/jobs/1',
  source: 'seek',
  jd_text: 'We need someone who enjoys helping users and troubleshooting Windows.',
  stack_used: '',
  fit_score: 80,
  resume_md: '## Experience\n\nTroubleshot user hardware and documented fixes.',
  cover_md: 'I am interested in supporting Northwind users.',
  change_summary: '{"status":"ok"}',
  status: 'applied',
};

test('parseQaThread ignores malformed data', () => {
  assert.deepEqual(parseQaThread(null), []);
  assert.deepEqual(parseQaThread('not-json'), []);
  assert.deepEqual(parseQaThread('{"role":"user"}'), []);
  assert.deepEqual(parseQaThread(JSON.stringify([
    { role: 'user', content: 'Why this role?' },
    { role: 'system', content: 'ignore' },
  ])), [{ role: 'user', content: 'Why this role?' }]);
});

test('normalizeQuestion trims and caps length', () => {
  assert.equal(normalizeQuestion('  你好  '), '你好');
  assert.equal(normalizeQuestion(123), '');
  assert.equal(normalizeQuestion('x'.repeat(MAX_QUESTION_CHARS + 20)).length, MAX_QUESTION_CHARS);
});

test('prompt includes the job, resume, and question and forbids invention', () => {
  const prompt = buildQaPrompt({
    company: 'Northwind Analytics',
    jobTitle: 'IT Support Engineer',
    jd: SAMPLE.jd_text,
    resumeMd: SAMPLE.resume_md,
    coverMd: SAMPLE.cover_md,
    profileMd: 'Target: IT support',
    thread: [{ role: 'user', content: 'prev' }, { role: 'assistant', content: 'ans' }],
    question: '你为什么对这个岗位感兴趣？',
  });
  assert.match(prompt, /Northwind Analytics/);
  assert.match(prompt, /IT Support Engineer/);
  assert.match(prompt, /troubleshooting Windows/);
  assert.match(prompt, /Troubleshot user hardware/);
  assert.match(prompt, /你为什么对这个岗位感兴趣/);
  assert.match(prompt, /Do NOT invent/);
  assert.match(prompt, /Q: prev/);
});

test('mocked ask appends Q&A and does not change other application fields', async () => {
  const id = Number(insertApplication(SAMPLE));
  const before = getApplicationById(id);
  let calls = 0;
  const result = await answerJobQuestion({
    company: before.company,
    jobTitle: before.job_title,
    jd: before.jd_text,
    resumeMd: before.resume_md,
    coverMd: before.cover_md,
    qaThread: before.qa_thread,
    question: '你为什么对这个岗位感兴趣？',
  }, {
    llm: async (prompt) => {
      calls += 1;
      assert.match(prompt, /你为什么对这个岗位感兴趣/);
      return { answer: '我对帮助用户排查 Windows 问题感兴趣。' };
    },
  });
  assert.equal(calls, 1);
  assert.match(result.answer, /Windows/);
  assert.equal(result.qa_thread.length, 2);
  assert.equal(result.qa_thread[0].role, 'user');
  assert.equal(result.qa_thread[1].role, 'assistant');

  updateApplication(id, { qa_thread: JSON.stringify(result.qa_thread) });
  const after = getApplicationById(id);
  assert.equal(after.resume_md, SAMPLE.resume_md);
  assert.equal(after.cover_md, SAMPLE.cover_md);
  assert.equal(after.jd_text, SAMPLE.jd_text);
  assert.equal(after.change_summary, SAMPLE.change_summary);
  assert.equal(after.company, SAMPLE.company);
  assert.equal(after.status, 'applied');
  assert.equal(JSON.parse(after.qa_thread).length, 2);
});

test('empty question and missing JD are rejected without calling the LLM', async () => {
  let calls = 0;
  const llm = async () => { calls += 1; return { answer: 'nope' }; };
  await assert.rejects(() => answerJobQuestion({ jd: 'x', question: '   ' }, { llm }), /question is required/);
  await assert.rejects(() => answerJobQuestion({ jd: '', question: '为什么感兴趣？' }, { llm }), /没有职位描述/);
  assert.equal(calls, 0);
});

test('extractAnswer requires a real answer string', () => {
  assert.equal(extractAnswer({ answer: '  hello  ' }), 'hello');
  assert.throws(() => extractAnswer({}), /没有返回可用的回答/);
});

test('job-qa module does not invent a second generation request', () => {
  const src = fs.readFileSync(path.join(__dirname, '../job-qa.js'), 'utf8');
  assert.match(src, /callLLM/);
  assert.doesNotMatch(src, /generateApplication/);
});
