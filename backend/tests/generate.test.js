'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB = path.join(os.tmpdir(), `jab_gen_test_${Date.now()}.db`);
process.env.TEST_DB_PATH = TEST_DB;

const {
  generateApplication,
  normalizeGenerationResult,
  parseLlmJson,
  collectGeminiText,
  JSON_PARSE_ERROR,
  JSON_TRUNCATED_ERROR,
  JSON_SCHEMA_ERROR,
  createGeminiCallTracker,
  buildGeminiRequestBody,
  GEMINI_GENERATION_CONFIG,
  GENERATION_RESPONSE_JSON_SCHEMA,
} = require('../tailor');
const { getApplicationById, insertApplication } = require('../db');
const { createGenerationLock, generationKey, tryStartGeneration, finishGeneration } = require('../generation-lock');

after(() => {
  try { fs.unlinkSync(TEST_DB); } catch { /* ignore */ }
});

const FICTIONAL_CV = `---
name: Jordan Avery
header:
  - text: "email: jordan@example.com"
---

## Summary
Full-stack engineer.

## Skills
TypeScript, React
`;

const COVER_TEMPLATE = `Dear Hiring Manager,

I am applying for the {{job_title}} role at {{company}}.

{{why_company}}
{{matching_skills}}
{{specific_project}}
{{why_company_culture}}

Sincerely,
Jordan Avery`;

function okPayload({ cover = false } = {}) {
  return {
    tailored_resume_md: FICTIONAL_CV,
    detected_skills: ['TypeScript', 'React'],
    fit_score: 81,
    job_title: 'Support Engineer',
    company: 'Northwind Analytics',
    location: 'Melbourne VIC',
    archetype: 'Full-stack SWE',
    cover_letter: cover
      ? {
        company: 'Northwind Analytics',
        job_title: 'Support Engineer',
        why_company: 'They build tools used by teams worldwide.',
        matching_skills: 'TypeScript, React',
        specific_project: 'Shipped a customer dashboard.',
        why_company_culture: 'Collaborative and practical.',
      }
      : null,
  };
}

test('generate_cover_letter=false: one logical Gemini request, no cover letter', async () => {
  let calls = 0;
  const fakeLlm = async () => {
    calls += 1;
    return okPayload({ cover: false });
  };

  const result = await generateApplication({
    jd: 'TypeScript support role at Northwind Analytics in Melbourne.',
    baseMd: FICTIONAL_CV,
    generateCoverLetter: false,
    hints: {},
  }, { callLLM: fakeLlm });

  assert.equal(calls, 1);
  assert.equal(result.tracker.logicalCalls, 1);
  assert.equal(result.fit_score, 81);
  assert.ok(result.markdown.includes('Jordan Avery'));
  assert.equal(result.cover_md, '');
  assert.equal(result.cover_letter_available, false);
  assert.deepEqual(result.detected_skills, ['TypeScript', 'React']);
});

test('generate_cover_letter=true: one logical Gemini request includes cover letter', async () => {
  let calls = 0;
  const fakeLlm = async (prompt) => {
    calls += 1;
    assert.match(prompt, /Cover letter/);
    assert.match(prompt, /\{\{why_company\}\}/);
    return okPayload({ cover: true });
  };

  const result = await generateApplication({
    jd: 'TypeScript support role at Northwind Analytics.',
    baseMd: FICTIONAL_CV,
    generateCoverLetter: true,
    hints: { job_title: 'Support Engineer', company: 'Northwind Analytics' },
    coverTemplate: COVER_TEMPLATE,
  }, { callLLM: fakeLlm });

  assert.equal(calls, 1);
  assert.equal(result.tracker.logicalCalls, 1);
  assert.equal(result.cover_letter_available, true);
  assert.match(result.cover_md, /Northwind Analytics/);
  assert.match(result.cover_md, /Support Engineer/);
  assert.ok(!result.cover_md.includes('{{'));
});

test('normalizeGenerationResult accepts nested job/analysis schema', () => {
  const result = normalizeGenerationResult({
    job: { title: 'Support Engineer', company: 'Acme', location: 'Sydney' },
    analysis: { fit_score: 70, keywords: ['React'] },
    resume: '# Resume\n',
    cover_letter: null,
  }, { wantCoverLetter: false });
  assert.equal(result.job_title, 'Support Engineer');
  assert.equal(result.company, 'Acme');
  assert.equal(result.location, 'Sydney');
  assert.equal(result.fit_score, 70);
  assert.deepEqual(result.detected_skills, ['React']);
});

test('parseLlmJson accepts pure, fenced, wrapped, and BOM JSON without extra Gemini calls', () => {
  const payload = okPayload();
  const raw = JSON.stringify(payload);
  assert.equal(parseLlmJson(raw).fit_score, 81);
  assert.equal(parseLlmJson('```json\n' + raw + '\n```').fit_score, 81);
  assert.equal(parseLlmJson('Here is the result:\n' + raw + '\nThanks.').fit_score, 81);
  assert.equal(parseLlmJson('\uFEFF  \n' + raw + '\n  ').fit_score, 81);
});

test('parseLlmJson rejects truncated or malformed JSON', () => {
  assert.throws(() => parseLlmJson('{ "tailored_resume_md": "hello'), (err) => err.message === JSON_TRUNCATED_ERROR);
  assert.throws(() => parseLlmJson('not-json {{{'), (err) => err.message === JSON_TRUNCATED_ERROR);
  assert.throws(() => parseLlmJson('{ "fit_score": 1, }'), (err) => err.message === JSON_PARSE_ERROR);
});

test('parseLlmJson attaches redacted SyntaxError diagnostics without the full candidate', () => {
  const leaky = `{ "note": "key=AIzaSyTESTKEY1234567890abcdefghiJKL", }`;
  assert.throws(
    () => parseLlmJson(leaky),
    (err) => {
      assert.equal(err.message, JSON_PARSE_ERROR);
      assert.equal(err.jsonParse.candidateChars, leaky.length);
      assert.equal(typeof err.jsonParse.message, 'string');
      assert.ok(err.jsonParse.message.length > 0);
      assert.ok(err.jsonParse.message.length <= 200);
      assert.equal(typeof err.jsonParse.position, 'number');
      assert.doesNotMatch(err.jsonParse.message, /AIzaSy/);
      assert.equal(JSON.stringify(err.jsonParse).includes(leaky), false);
      return true;
    },
  );
});

test('collectGeminiText skips thought parts and reads the JSON text part', () => {
  const payload = okPayload();
  const collected = collectGeminiText({
    candidates: [{
      finishReason: 'STOP',
      content: {
        parts: [
          { thought: true, text: 'I will write JSON next.' },
          { text: JSON.stringify(payload) },
        ],
      },
    }],
  });
  assert.equal(collected.thoughtParts, 1);
  assert.equal(parseLlmJson(collected.text, { finishReason: collected.finishReason }).job_title, 'Support Engineer');
});

test('valid JSON with invalid schema fails without inventing fields', () => {
  assert.throws(
    () => normalizeGenerationResult({ fit_score: 10 }, { wantCoverLetter: false }),
    (err) => err.message === JSON_SCHEMA_ERROR,
  );
  assert.throws(
    () => parseLlmJson('[1, 2]'),
    (err) => err.message === JSON_SCHEMA_ERROR,
  );
});

test('malformed generation does not insert an application', async () => {
  const before = getApplicationById(999999);
  assert.equal(before, null);

  await assert.rejects(
    () => generateApplication({
      jd: 'A role',
      baseMd: FICTIONAL_CV,
      generateCoverLetter: false,
    }, { callLLM: async () => ({ nope: true }) }),
    /申请未保存/
  );

  assert.equal(getApplicationById(999999), null);
});

test('opening an existing application does not call Gemini', () => {
  const id = insertApplication({
    created_at: '2026-09-25T00:00:00.000Z',
    company: 'Northwind Analytics',
    job_title: 'Support Engineer',
    location: 'Melbourne VIC',
    url: '',
    source: 'other',
    jd_text: 'Fictional JD',
    stack_used: 'Support Engineer',
    fit_score: 81,
    resume_md: FICTIONAL_CV,
    cover_md: 'Dear Hiring Manager',
    status: 'not_started',
    theme: 'classic',
    resume_template_id: null,
  });

  let llmCalls = 0;
  const original = require('../tailor').callLLM;
  require('../tailor').callLLM = async () => { llmCalls += 1; return {}; };
  try {
    const row = getApplicationById(Number(id));
    assert.equal(row.company, 'Northwind Analytics');
    assert.equal(row.job_title, 'Support Engineer');
    assert.equal(row.location, 'Melbourne VIC');
    assert.match(row.resume_md, /Jordan Avery/);
    assert.equal(llmCalls, 0);
  } finally {
    require('../tailor').callLLM = original;
  }
});

test('generation lock: double-start is rejected', () => {
  const lock = createGenerationLock();
  assert.equal(lock.tryStart(), true);
  assert.equal(lock.tryStart(), false);
  lock.finish();
  assert.equal(lock.tryStart(), true);
});

test('in-flight generation key blocks a duplicate', () => {
  const key = generationKey({
    jd: 'same jd',
    resume_template_id: 1,
    generate_cover_letter: true,
  });
  assert.equal(tryStartGeneration(key), true);
  assert.equal(tryStartGeneration(key), false);
  finishGeneration(key);
  assert.equal(tryStartGeneration(key), true);
  finishGeneration(key);
});

test('Gemini request uses REST responseFormat structured output, not deprecated response_schema', () => {
  const body = buildGeminiRequestBody('prompt');
  const cfg = body.generationConfig;
  assert.equal(cfg.thinkingConfig.thinkingLevel, 'low');
  assert.equal(cfg.response_mime_type, undefined);
  assert.equal(cfg.responseMimeType, undefined);
  assert.equal(cfg.response_schema, undefined);
  assert.equal(cfg.responseSchema, undefined);
  assert.equal(cfg.response_json_schema, undefined);
  assert.equal(cfg.responseJsonSchema, undefined);
  assert.equal(cfg.responseFormat.text.mimeType, 'APPLICATION_JSON');
  assert.equal(cfg.responseFormat.text.schema, GENERATION_RESPONSE_JSON_SCHEMA);
  assert.equal(GEMINI_GENERATION_CONFIG.responseFormat.text.mimeType, 'APPLICATION_JSON');

  const schema = cfg.responseFormat.text.schema;
  assert.equal(schema.type, 'object');
  assert.equal(schema.properties.tailored_resume_md.type, 'string');
  assert.equal(schema.properties.detected_skills.type, 'array');
  assert.equal(schema.properties.detected_skills.items.type, 'string');
  assert.equal(schema.properties.fit_score.type, 'number');
  assert.equal(schema.properties.fit_score.minimum, 0);
  assert.equal(schema.properties.fit_score.maximum, 100);
  for (const key of ['job_title', 'company', 'location', 'archetype']) {
    assert.equal(schema.properties[key].type, 'string');
  }
  assert.deepEqual(schema.required, [
    'tailored_resume_md',
    'detected_skills',
    'fit_score',
    'job_title',
    'company',
    'location',
    'archetype',
    'cover_letter',
  ]);
  const coverTypes = schema.properties.cover_letter.anyOf.map((item) => item.type || 'object');
  assert.ok(coverTypes.includes('null'));
  assert.ok(coverTypes.includes('string'));
  assert.ok(coverTypes.includes('object'));
  const coverObject = schema.properties.cover_letter.anyOf.find((item) => item.type === 'object');
  assert.deepEqual(coverObject.required, [
    'company', 'job_title', 'why_company', 'matching_skills', 'specific_project', 'why_company_culture',
  ]);
});

test('structured-output JSON still goes through parseLlmJson without a repair call', () => {
  const payload = okPayload({ cover: false });
  const parsed = parseLlmJson(JSON.stringify(payload));
  assert.equal(parsed.fit_score, 81);
  assert.equal(typeof parsed.tailored_resume_md, 'string');
  assert.deepEqual(parsed.detected_skills, ['TypeScript', 'React']);
  assert.equal(parsed.cover_letter, null);
  const withCover = parseLlmJson(JSON.stringify(okPayload({ cover: true })));
  assert.equal(withCover.cover_letter.company, 'Northwind Analytics');
});

test('structured output does not skip local validation or add a Gemini repair call', () => {
  const src = fs.readFileSync(path.join(__dirname, '../tailor.js'), 'utf8');
  assert.match(src, /function collectGeminiText/);
  assert.match(src, /function parseLlmJson/);
  assert.match(src, /function normalizeGenerationResult/);
  assert.match(src, /responseFormat/);
  assert.equal(src.includes('jsonrepair'), false);
  assert.equal((src.match(/axios\.post/g) || []).length, 2);
  const analyze = fs.readFileSync(path.join(__dirname, '../analyze-flow.js'), 'utf8');
  assert.match(analyze, /change-summary/);
});

test('createGeminiCallTracker starts at zero', () => {
  const tracker = createGeminiCallTracker();
  assert.equal(tracker.logicalCalls, 0);
  assert.equal(tracker.httpAttempts, 0);
});

test('JSON extraction and schema checks add zero Gemini calls', () => {
  const src = fs.readFileSync(path.join(__dirname, '../tailor.js'), 'utf8');
  const parseFn = src.split('function parseLlmJson')[1].split('function buildGeminiRequestBody')[0];
  const collectFn = src.split('function collectGeminiText')[1].split('function logGeminiJsonShape')[0];
  assert.doesNotMatch(parseFn, /axios\.post|generateContent/);
  assert.doesNotMatch(collectFn, /axios\.post|generateContent/);
});
