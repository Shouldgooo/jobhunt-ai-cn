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
  QA_RESPONSE_JSON_SCHEMA,
  MAX_QUESTION_CHARS,
} = require('../job-qa');
const {
  buildGeminiRequestBody,
  GENERATION_RESPONSE_JSON_SCHEMA,
  GEMINI_GENERATION_CONFIG,
  parseLlmJson,
  collectGeminiText,
  JSON_PARSE_ERROR,
} = require('../tailor');
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
  jd_text: 'We need someone who enjoys helping users and troubleshooting Windows. Salesforce or 3 years SaaS support preferred.',
  stack_used: '',
  fit_score: 80,
  resume_md: '## Experience\n\nTroubleshot user hardware and documented fixes. Used Zoho Desk.',
  cover_md: 'I am interested in supporting Northwind users.',
  change_summary: '{"status":"ok","unsupported_experience":[]}',
  status: 'applied',
};

function samplePrompt(extra = {}) {
  return buildQaPrompt({
    company: 'Northwind Analytics',
    jobTitle: 'IT Support Engineer',
    jd: SAMPLE.jd_text,
    resumeMd: SAMPLE.resume_md,
    coverMd: SAMPLE.cover_md,
    profileMd: 'Target: IT support. Tools: Zoho.',
    originalCvMd: 'IT Officer 2022-2024. Desktop support. Zoho Desk.',
    changeSummary: SAMPLE.change_summary,
    thread: [{ role: 'user', content: 'prev' }, { role: 'assistant', content: 'ans' }],
    question: 'What support tools are you familiar with? (e.g. Salesforce, Zoho or similar)',
    ...extra,
  });
}

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

test('Q&A schema is {answer:string} with additionalProperties false', () => {
  assert.equal(QA_RESPONSE_JSON_SCHEMA.type, 'object');
  assert.deepEqual(QA_RESPONSE_JSON_SCHEMA.required, ['answer']);
  assert.equal(QA_RESPONSE_JSON_SCHEMA.properties.answer.type, 'string');
  assert.equal(QA_RESPONSE_JSON_SCHEMA.additionalProperties, false);
  assert.equal(QA_RESPONSE_JSON_SCHEMA.properties.tailored_resume_md, undefined);
});

test('/api/analyze default schema stays the application-generation schema', () => {
  const body = buildGeminiRequestBody('analyze-prompt');
  assert.equal(body.generationConfig, GEMINI_GENERATION_CONFIG);
  assert.equal(body.generationConfig.responseFormat.text.mimeType, 'APPLICATION_JSON');
  assert.equal(body.generationConfig.responseFormat.text.schema, GENERATION_RESPONSE_JSON_SCHEMA);
  assert.ok(GENERATION_RESPONSE_JSON_SCHEMA.required.includes('tailored_resume_md'));
  assert.ok(GENERATION_RESPONSE_JSON_SCHEMA.required.includes('fit_score'));
});

test('Job Q&A request body uses {answer:string} schema and APPLICATION_JSON', () => {
  const body = buildGeminiRequestBody('qa-prompt', { responseSchema: QA_RESPONSE_JSON_SCHEMA });
  assert.equal(body.generationConfig.responseFormat.text.mimeType, 'APPLICATION_JSON');
  assert.deepEqual(body.generationConfig.responseFormat.text.schema, QA_RESPONSE_JSON_SCHEMA);
  assert.equal(body.generationConfig.response_schema, undefined);
  assert.equal(body.generationConfig.responseSchema, undefined);
  assert.equal(body.generationConfig.response_json_schema, undefined);
  assert.equal(body.generationConfig.responseJsonSchema, undefined);
  assert.equal(body.generationConfig.response_mime_type, undefined);
  assert.equal(body.generationConfig.responseMimeType, undefined);
  assert.notEqual(body.generationConfig.responseFormat.text.schema, GENERATION_RESPONSE_JSON_SCHEMA);
});

test('prompt includes evidence rules and forbids invention', () => {
  const prompt = samplePrompt();
  assert.match(prompt, /Northwind Analytics/);
  assert.match(prompt, /IT Support Engineer/);
  assert.match(prompt, /troubleshooting Windows/);
  assert.match(prompt, /Troubleshot user hardware/);
  assert.match(prompt, /IT Officer 2022-2024/);
  assert.match(prompt, /What support tools/);
  assert.match(prompt, /Do NOT invent/);
  assert.match(prompt, /Q: prev/);
  assert.match(prompt, /USER QUESTION IS NOT EVIDENCE/);
  assert.match(prompt, /JD IS NOT CANDIDATE EVIDENCE/);
  assert.match(prompt, /no unsupported years/);
  assert.match(prompt, /no unsupported SaaS claim/);
  assert.match(prompt, /no unsupported tool claim/);
  assert.match(prompt, /ORIGINAL CV/);
  assert.match(prompt, /MUST NOT make any positive capability claim/);
  assert.match(prompt, /NO SEMANTIC LAUNDERING/);
  assert.match(prompt, /MIXED-EVIDENCE QUESTIONS/);
});

test('Case A mixed Git / Azure DevOps / CI/CD: prompt forbids unsupported Azure capability claims', () => {
  const prompt = buildQaPrompt({
    company: 'Northwind Analytics',
    jobTitle: 'IT Support Engineer',
    jd: 'Git, Azure DevOps and CI/CD preferred.',
    originalCvMd: 'Used Git and GitHub Actions for CI/CD pipelines. Docker for local builds.',
    profileMd: 'Target: IT support. Tools: Git, GitHub Actions, CI/CD.',
    resumeMd: 'Generated resume may mention Azure DevOps from the JD.',
    question: 'Are you proficient with Git, Azure Devops and CI/CD?',
  });
  assert.match(prompt, /Are you proficient with Git, Azure Devops and CI\/CD/);
  assert.match(prompt, /Used Git and GitHub Actions for CI\/CD/);
  assert.match(prompt, /answer item by item/);
  assert.match(prompt, /Git = supported, CI\/CD = supported, Azure DevOps = unsupported/);
  assert.match(prompt, /I have hands-on experience with Git and CI\/CD, including GitHub Actions/);
  assert.match(prompt, /I don't currently have verified hands-on experience with Azure DevOps/);
  assert.match(prompt, /transferable foundations for learning Azure DevOps/);
  assert.match(prompt, /MUST NOT make any positive capability claim/);
  assert.match(prompt, /foundational Azure DevOps knowledge/);
  assert.match(prompt, /understanding of Azure DevOps/);
  assert.match(prompt, /exposure to Azure DevOps/);
  assert.match(prompt, /Do not turn an unsupported skill into a weaker positive claim/);
  assert.match(prompt, /Do not infer knowledge of Tool B from experience with Tool A/);
  assert.match(prompt, /The employer question itself is NOT evidence/);
  assert.doesNotMatch(prompt, /if answer\.includes\("Azure DevOps"\)/);
});

test('Case B Salesforce / Zoho: prompt allows Zoho only when ORIGINAL evidence supports it', () => {
  const prompt = buildQaPrompt({
    company: 'Northwind Analytics',
    jobTitle: 'IT Support Engineer',
    jd: 'Salesforce or Zoho preferred.',
    originalCvMd: 'IT Officer. Used Zoho Desk for tickets.',
    profileMd: 'Tools: Zoho.',
    question: 'What support tools are you familiar with? (e.g. Salesforce, Zoho or similar)',
  });
  assert.match(prompt, /What support tools are you familiar with/);
  assert.match(prompt, /Used Zoho Desk/);
  assert.match(prompt, /If ORIGINAL evidence supports Zoho, you may mention Zoho/);
  assert.match(prompt, /If there is no Salesforce evidence, do not claim Salesforce/);
  assert.match(prompt, /Salesforce \/ Zoho \/ Azure DevOps and similar names from the question are not candidate evidence/);
  assert.match(prompt, /MUST NOT make any positive capability claim/);
  assert.match(prompt, /familiarity/);
  assert.match(prompt, /knowledge/);
  assert.match(prompt, /exposure/);
});

test('Case C SaaS without explicit evidence: prompt forbids direct or laundered SaaS claims', () => {
  const prompt = buildQaPrompt({
    company: 'Northwind Analytics',
    jobTitle: 'IT Support Engineer',
    jd: '3 years SaaS support experience.',
    originalCvMd: 'Desktop support and user troubleshooting. No SaaS product named.',
    profileMd: 'IT Support / Desktop Support.',
    question: 'Do you have SaaS support experience?',
  });
  assert.match(prompt, /Do you have SaaS support experience/);
  assert.match(prompt, /no unsupported SaaS claim/);
  assert.match(prompt, /Without explicit SaaS evidence, do not claim direct SaaS experience/);
  assert.match(prompt, /do not rewrite it as "familiar with SaaS"/);
  assert.match(prompt, /You may introduce real transferable support \/ technical experience/);
  assert.match(prompt, /JD IS NOT CANDIDATE EVIDENCE/);
});

test('mocked ask appends Q&A and does not change other application fields', async () => {
  const id = Number(insertApplication(SAMPLE));
  const before = getApplicationById(id);
  let calls = 0;
  let llmOpts = null;
  const result = await answerJobQuestion({
    company: before.company,
    jobTitle: before.job_title,
    jd: before.jd_text,
    resumeMd: before.resume_md,
    coverMd: before.cover_md,
    originalCvMd: 'IT Officer 2022-2024. Desktop support. Zoho Desk.',
    profileMd: 'Target: IT support.',
    changeSummary: before.change_summary,
    qaThread: before.qa_thread,
    question: '你为什么对这个岗位感兴趣？',
  }, {
    llm: async (prompt, opts) => {
      calls += 1;
      llmOpts = opts;
      assert.match(prompt, /你为什么对这个岗位感兴趣/);
      assert.match(prompt, /USER QUESTION IS NOT EVIDENCE/);
      return { answer: '我对帮助用户排查 Windows 问题感兴趣。' };
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(llmOpts.responseSchema, QA_RESPONSE_JSON_SCHEMA);
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

test('Q&A structured response {answer} is accepted', async () => {
  const collected = collectGeminiText({
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"answer":"I used Zoho Desk for ticket work."}' }] } }],
  });
  const parsed = parseLlmJson(collected.text, { finishReason: collected.finishReason });
  assert.equal(extractAnswer(parsed), 'I used Zoho Desk for ticket work.');
});

test('empty answer is rejected', () => {
  assert.throws(() => extractAnswer({ answer: '' }), /没有返回可用的回答/);
  assert.throws(() => extractAnswer({ answer: '   ' }), /没有返回可用的回答/);
  assert.throws(() => extractAnswer({ answer: 12 }), /没有返回可用的回答/);
});

test('malformed JSON is rejected before save', () => {
  assert.throws(() => parseLlmJson('{ "answer": "ok", }'), (err) => err.message === JSON_PARSE_ERROR);
});

test('wrong schema response is rejected', () => {
  assert.throws(() => extractAnswer({
    tailored_resume_md: '## Resume',
    fit_score: 80,
    detected_skills: ['Salesforce'],
  }), /没有返回可用的回答/);
  assert.throws(() => extractAnswer({}), /没有返回可用的回答/);
});

test('empty question and missing JD are rejected without calling the LLM', async () => {
  let calls = 0;
  const llm = async () => { calls += 1; return { answer: 'nope' }; };
  await assert.rejects(() => answerJobQuestion({ jd: 'x', question: '   ' }, { llm }), /question is required/);
  await assert.rejects(() => answerJobQuestion({ jd: '', question: '为什么感兴趣？' }, { llm }), /没有职位描述/);
  assert.equal(calls, 0);
});

test('one question is one logical generation and has no repair call', async () => {
  let calls = 0;
  await answerJobQuestion({
    jd: SAMPLE.jd_text,
    question: 'How many years?',
    originalCvMd: 'Desktop support 2022-2024',
    profileMd: '',
  }, {
    llm: async () => {
      calls += 1;
      return { answer: 'My experience includes desktop support from 2022 to 2024.' };
    },
  });
  assert.equal(calls, 1);
  const src = fs.readFileSync(path.join(__dirname, '../job-qa.js'), 'utf8');
  assert.equal(src.includes('jsonrepair'), false);
  assert.doesNotMatch(src, /repair/);
});

test('Q&A failure does not write qa_thread', async () => {
  const id = Number(insertApplication(SAMPLE));
  updateApplication(id, {
    qa_thread: JSON.stringify([
      { role: 'user', content: 'saved question', created_at: '2026-03-18T09:00:00.000Z' },
      { role: 'assistant', content: 'saved answer', created_at: '2026-03-18T09:00:00.000Z' },
    ]),
  });
  const before = getApplicationById(id);
  await assert.rejects(() => answerJobQuestion({
    company: before.company,
    jobTitle: before.job_title,
    jd: before.jd_text,
    resumeMd: before.resume_md,
    coverMd: before.cover_md,
    originalCvMd: 'IT Officer',
    qaThread: before.qa_thread,
    question: 'What tools?',
  }, {
    llm: async () => ({ tailored_resume_md: '## Resume', fit_score: 70 }),
  }), /没有返回可用的回答/);
  const after = getApplicationById(id);
  assert.equal(after.qa_thread, before.qa_thread);
  assert.equal(JSON.parse(after.qa_thread).length, 2);
});

test('malformed LLM JSON does not write qa_thread', async () => {
  const id = Number(insertApplication(SAMPLE));
  const before = getApplicationById(id);
  await assert.rejects(() => answerJobQuestion({
    jd: before.jd_text,
    qaThread: before.qa_thread,
    question: 'Why this role?',
    originalCvMd: 'IT Officer',
  }, {
    llm: async () => {
      const err = new Error('模型返回了无法解析的 JSON。');
      err.statusCode = 502;
      throw err;
    },
  }), /无法解析的 JSON/);
  assert.equal(getApplicationById(id).qa_thread, before.qa_thread);
});

test('success writes qa_thread only after extractAnswer', async () => {
  const id = Number(insertApplication(SAMPLE));
  const before = getApplicationById(id);
  const result = await answerJobQuestion({
    jd: before.jd_text,
    qaThread: before.qa_thread,
    question: 'Why this role?',
    originalCvMd: 'IT Officer',
    profileMd: '',
  }, {
    llm: async () => ({ answer: 'I enjoy helping users with Windows issues.' }),
  });
  assert.equal(getApplicationById(id).qa_thread, before.qa_thread);
  updateApplication(id, { qa_thread: JSON.stringify(result.qa_thread) });
  assert.equal(JSON.parse(getApplicationById(id).qa_thread).length, 2);
});

test('extractAnswer requires a real answer string', () => {
  assert.equal(extractAnswer({ answer: '  hello  ' }), 'hello');
  assert.equal(extractAnswer('plain text fallback'), 'plain text fallback');
  assert.throws(() => extractAnswer({}), /没有返回可用的回答/);
});

test('job-qa does not add Gemini repair or a second generation request', () => {
  const src = fs.readFileSync(path.join(__dirname, '../job-qa.js'), 'utf8');
  const tailorSrc = fs.readFileSync(path.join(__dirname, '../tailor.js'), 'utf8');
  assert.match(src, /callLLM/);
  assert.doesNotMatch(src, /generateApplication/);
  assert.doesNotMatch(src, /axios\.post|generateContent/);
  assert.equal(src.includes('jsonrepair'), false);
  assert.equal(tailorSrc.includes('jsonrepair'), false);
  assert.match(tailorSrc, /function requestGeminiWithRetry/);
  assert.match(tailorSrc, /function extractGeminiErrorInfo/);
  assert.match(src, /responseSchema: QA_RESPONSE_JSON_SCHEMA/);
});

test('429/503 retry and 403 diagnostics stay in tailor.js', () => {
  const src = fs.readFileSync(path.join(__dirname, '../tailor.js'), 'utf8');
  assert.match(src, /TRANSIENT_OVERLOAD_STATUSES/);
  assert.match(src, /MAX_QUOTA_AUTORETRY/);
  assert.match(src, /extractGeminiErrorInfo/);
  assert.match(src, /formatLlmError/);
  assert.match(src, /PERMISSION_DENIED|403/);
  assert.match(src, /requestGeminiWithRetry/);
});
