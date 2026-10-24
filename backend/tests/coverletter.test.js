'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  fillTemplate,
  extractCoverLetterBody,
  attachCoverLetterHeader,
  buildCoverLetterPrompt,
  generateCoverLetterDocument,
  requiresCoverOverwriteConfirm,
  coverLetterPageWarning,
  COVER_LETTER_EMPTY,
  COVER_LETTER_JD_REQUIRED,
  COVER_LETTER_CV_REQUIRED,
  COVER_LETTER_RESPONSE_JSON_SCHEMA,
} = require('../coverletter');
const { parseFrontMatter } = require('../renderer');
const { GENERATION_RESPONSE_JSON_SCHEMA } = require('../tailor');

const TEMPLATE = `Dear Hiring Manager,

I am excited to apply for the {{job_title}} role at {{company}}.

{{why_company}}

My top skills include {{matching_skills}}, which align well with your requirements.

A highlight from my experience: {{specific_project}}

{{why_company_culture}}

Sincerely,
Jane Doe`;

test('fillTemplate: replaces all 6 placeholders', () => {
  const values = {
    company:            'Atlassian',
    job_title:          'Software Engineer',
    why_company:        'Atlassian builds tools used by millions of developers worldwide.',
    matching_skills:    'C#, React, ASP.NET Core',
    specific_project:   'Built real-time monitoring dashboard using SignalR and Redis.',
    why_company_culture: 'I admire Atlassian\'s open culture and focus on team collaboration.',
  };
  const result = fillTemplate(TEMPLATE, values);
  assert.ok(!result.includes('{{'), 'All placeholders should be replaced');
  assert.ok(result.includes('Atlassian'), 'company should be filled');
  assert.ok(result.includes('Software Engineer'), 'job_title should be filled');
  assert.ok(result.includes('C#, React, ASP.NET Core'), 'matching_skills should be filled');
});

test('fillTemplate: leaves non-placeholder text unchanged', () => {
  const values = {
    company: 'Acme', job_title: 'Engineer',
    why_company: 'x', matching_skills: 'y', specific_project: 'z', why_company_culture: 'w',
  };
  const result = fillTemplate(TEMPLATE, values);
  assert.ok(result.includes('Dear Hiring Manager'));
  assert.ok(result.includes('Sincerely,'));
  assert.ok(result.includes('Jane Doe'));
});

test('fillTemplate: handles empty string values', () => {
  const values = {
    company: '', job_title: '',
    why_company: '', matching_skills: '', specific_project: '', why_company_culture: '',
  };
  const result = fillTemplate(TEMPLATE, values);
  assert.ok(!result.includes('{{'), 'All placeholders should be replaced even with empty strings');
});

test('fillTemplate: extra keys in values are ignored', () => {
  const values = {
    company: 'Acme', job_title: 'Engineer',
    why_company: 'x', matching_skills: 'y', specific_project: 'z', why_company_culture: 'w',
    extra_key: 'should be ignored',
  };
  const result = fillTemplate(TEMPLATE, values);
  assert.ok(!result.includes('extra_key'));
});

test('fillTemplate: unfilled placeholder stays if key missing', () => {
  const result = fillTemplate(TEMPLATE, { company: 'Acme' }); // only one key
  assert.ok(result.includes('{{job_title}}'), 'Unfilled placeholder should remain');
});

const SOURCE_CV = `---
name: Jordan Avery
header:
  - text: "email: jordan@example.com"
    link: mailto:jordan@example.com
  - text: "mobile: 0400 000 000"
  - text: "location: Melbourne VIC"
  - text: "linkedin: linkedin.com/in/jordanavery"
    link: https://www.linkedin.com/in/jordanavery/
---

## Summary
Built TypeScript services at Northwind Labs.
`;

test('cover letter schema is body-only and not the resume generation schema', () => {
  assert.deepEqual(COVER_LETTER_RESPONSE_JSON_SCHEMA.required, ['body']);
  assert.equal(COVER_LETTER_RESPONSE_JSON_SCHEMA.additionalProperties, false);
  assert.ok(GENERATION_RESPONSE_JSON_SCHEMA.properties.tailored_resume_md);
  assert.notEqual(COVER_LETTER_RESPONSE_JSON_SCHEMA, GENERATION_RESPONSE_JSON_SCHEMA);
});

test('extractCoverLetterBody accepts body and rejects empty AI output', () => {
  assert.equal(extractCoverLetterBody({ body: 'Dear Hiring Manager,\n\nHello.' }), 'Dear Hiring Manager,\n\nHello.');
  assert.equal(extractCoverLetterBody('Dear Hiring Manager,'), 'Dear Hiring Manager,');
  assert.throws(() => extractCoverLetterBody({ body: '   ' }), (err) => (
    err.statusCode === 502 && err.message === COVER_LETTER_EMPTY
  ));
  assert.throws(() => extractCoverLetterBody({}), (err) => err.code === 'COVER_LETTER_EMPTY');
});

test('attachCoverLetterHeader always uses source identity, even if AI omitted or invented a header', () => {
  const omitted = attachCoverLetterHeader('Dear Hiring Manager,\n\nI am applying.', SOURCE_CV);
  assert.equal(parseFrontMatter(omitted).name, 'Jordan Avery');
  assert.match(omitted, /Dear Hiring Manager/);
  const invented = attachCoverLetterHeader('---\nname: Fake Person\n---\n\nDear Team,', SOURCE_CV);
  assert.equal(parseFrontMatter(invented).name, 'Jordan Avery');
  assert.doesNotMatch(invented, /Fake Person/);
});

test('attachCoverLetterHeader fails when the source CV has no name', () => {
  assert.throws(
    () => attachCoverLetterHeader('Dear Hiring Manager,', '## Summary\nNo name.'),
    (err) => err.code === 'RESUME_HEADER_REQUIRED'
  );
});

test('cover letter prompt is evidence-safe and uses the provided company/title', () => {
  const prompt = buildCoverLetterPrompt({
    cvMd: SOURCE_CV,
    profileMd: 'Target: support roles.',
    jd: 'Need Kubernetes and 5 years Salesforce.',
    company: 'Northwind Analytics',
    jobTitle: 'Support Engineer',
    notes: 'Keep it concise.',
    tailoredResumeMd: 'Invented Kubernetes lead.',
  });
  assert.match(prompt, /Northwind Analytics/);
  assert.match(prompt, /Support Engineer/);
  assert.match(prompt, /ORIGINAL CV is the source of facts/);
  assert.match(prompt, /JD Requirement → CV Evidence → Cover Letter Content/);
  assert.match(prompt, /Tailored resume is CONTEXT only/);
  assert.match(prompt, /Do not invent a hiring-manager name/);
  assert.match(prompt, /Do not emit Markdown headings/);
  assert.match(prompt, /Keep it concise/);
  assert.doesNotMatch(prompt, /tailored_resume_md/);
});

test('generateCoverLetterDocument does not call resume generation and restores the header', async () => {
  let calls = 0;
  let schema;
  const result = await generateCoverLetterDocument({
    jd: 'Support Engineer at Northwind Analytics in Melbourne.',
    company: 'Northwind Analytics',
    jobTitle: 'Support Engineer',
    cvMd: SOURCE_CV,
    profileMd: '',
  }, {
    callLLM: async (_prompt, opts = {}) => {
      calls += 1;
      schema = opts.responseSchema;
      return { body: 'Dear Hiring Manager,\n\nI am applying for the Support Engineer role at Northwind Analytics.' };
    },
  });
  assert.equal(calls, 1);
  assert.equal(schema, COVER_LETTER_RESPONSE_JSON_SCHEMA);
  assert.equal(parseFrontMatter(result.markdown).name, 'Jordan Avery');
  assert.match(result.body, /Support Engineer/);
  assert.doesNotMatch(result.markdown, /Fake/);
});

test('generateCoverLetterDocument errors on missing JD, CV, empty body, and missing name', async () => {
  await assert.rejects(
    () => generateCoverLetterDocument({ jd: '', company: 'Acme', jobTitle: 'Eng', cvMd: SOURCE_CV }, { callLLM: async () => ({ body: 'x' }) }),
    (err) => err.message === COVER_LETTER_JD_REQUIRED && err.statusCode === 400
  );
  await assert.rejects(
    () => generateCoverLetterDocument({ jd: 'A role', company: 'Acme', jobTitle: 'Eng', cvMd: '   ' }, { callLLM: async () => ({ body: 'x' }) }),
    (err) => err.message === COVER_LETTER_CV_REQUIRED
  );
  await assert.rejects(
    () => generateCoverLetterDocument({ jd: 'A role', company: 'Acme', jobTitle: 'Eng', cvMd: SOURCE_CV }, { callLLM: async () => ({ body: '' }) }),
    (err) => err.message === COVER_LETTER_EMPTY
  );
  await assert.rejects(
    () => generateCoverLetterDocument({
      jd: 'A role',
      company: 'Acme',
      jobTitle: 'Eng',
      cvMd: '## Summary\nNo name here.',
    }, { callLLM: async () => ({ body: 'Dear Hiring Manager,' }) }),
    (err) => err.code === 'RESUME_HEADER_REQUIRED'
  );
});

test('regenerate does not silently overwrite an edited cover letter', () => {
  assert.equal(requiresCoverOverwriteConfirm('Dear Hiring Manager, edited.', false), true);
  assert.equal(requiresCoverOverwriteConfirm('Dear Hiring Manager, edited.', true), false);
  assert.equal(requiresCoverOverwriteConfirm('', false), false);
  assert.equal(requiresCoverOverwriteConfirm('   ', undefined), false);
});

test('coverLetterPageWarning flags long letters instead of clipping', () => {
  assert.equal(coverLetterPageWarning('Dear Hiring Manager, short letter.'), '');
  const long = Array.from({ length: 420 }, () => 'word').join(' ');
  assert.match(coverLetterPageWarning(long), /超过一页/);
  assert.match(coverLetterPageWarning(long), /不会裁剪/);
});
