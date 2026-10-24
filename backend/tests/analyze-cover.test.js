'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB = path.join(os.tmpdir(), `jab_cover_mode_${Date.now()}.db`);
process.env.TEST_DB_PATH = TEST_DB;

const { runAnalyzeGeneration } = require('../analyze-flow');
const { insertApplication, getApplicationById, updateApplication } = require('../db');

after(() => {
  try { fs.unlinkSync(TEST_DB); } catch { /* ignore */ }
});

const JD = `
Job title: Support Engineer
Company: Northwind Analytics
Location: Melbourne VIC

Help customers with TypeScript tools.
`;

const RESUME_MD = `---
name: Jordan Avery
header:
  - text: "email: jordan@example.com"
---
## Summary
Tailored resume.
`;

const COVER_MD = `---
name: Jordan Avery
header:
  - text: "email: jordan@example.com"
---

Dear Hiring Manager,

I am applying for the Support Engineer role at Northwind Analytics.
`;

function deps({ generate, generateCover, insert } = {}) {
  return {
    isValidTheme: () => true,
    getUserConfig: () => ({ theme: 'classic' }),
    generate: generate || (async () => {
      throw new Error('resume generation should not run');
    }),
    generateCover: generateCover || (async () => {
      throw new Error('cover generation should not run');
    }),
    insert: insert || ((row) => insertApplication(row)),
  };
}

test('Cover Letter Only does not call resume generation', async () => {
  let resumeCalls = 0;
  let coverCalls = 0;
  const { application } = await runAnalyzeGeneration({
    body: {
      jd: JD,
      generate_resume: false,
      generate_cover_letter: true,
      job_title: 'Support Engineer',
      company: 'Northwind Analytics',
    },
    ...deps({
      generate: async () => {
        resumeCalls += 1;
        return { markdown: RESUME_MD, fit_score: 80, detected_skills: [], job_title: 'X', company: 'Y', location: '', tracker: {} };
      },
      generateCover: async (args) => {
        coverCalls += 1;
        assert.equal(args.company, 'Northwind Analytics');
        assert.equal(args.jobTitle, 'Support Engineer');
        assert.equal(args.tailoredResumeMd, '');
        return { markdown: COVER_MD };
      },
    }),
  });
  assert.equal(resumeCalls, 0);
  assert.equal(coverCalls, 1);
  assert.equal(application.cover_letter_available, true);
  assert.equal(application.resume_available, false);
  const saved = getApplicationById(application.id);
  assert.match(saved.cover_md, /Dear Hiring Manager/);
  assert.doesNotMatch(saved.resume_md, /Tailored resume/);
});

test('Resume Only keeps the original generateApplication path and does not write a cover letter', async () => {
  let resumeCalls = 0;
  let coverCalls = 0;
  let generateCoverLetter;
  const { application } = await runAnalyzeGeneration({
    body: { jd: JD, generate_cover_letter: false },
    ...deps({
      generate: async (args) => {
        resumeCalls += 1;
        generateCoverLetter = args.generateCoverLetter;
        return {
          markdown: RESUME_MD,
          fit_score: 81,
          detected_skills: ['TypeScript'],
          job_title: 'Support Engineer',
          company: 'Northwind Analytics',
          location: 'Melbourne VIC',
          tracker: { logicalCalls: 1 },
        };
      },
      generateCover: async () => {
        coverCalls += 1;
        return { markdown: COVER_MD };
      },
    }),
  });
  assert.equal(resumeCalls, 1);
  assert.equal(coverCalls, 0);
  assert.equal(generateCoverLetter, false);
  assert.equal(application.cover_letter_available, false);
  assert.equal(application.resume_available, true);
  assert.equal(getApplicationById(application.id).cover_md, '');
});

test('Resume + Cover Letter generates both with the same company and title', async () => {
  const { application } = await runAnalyzeGeneration({
    body: { jd: JD, generate_resume: true, generate_cover_letter: true },
    ...deps({
      generate: async () => ({
        markdown: RESUME_MD,
        fit_score: 81,
        detected_skills: ['TypeScript'],
        job_title: 'Support Engineer',
        company: 'Northwind Analytics',
        location: 'Melbourne VIC',
        tracker: { logicalCalls: 1 },
      }),
      generateCover: async (args) => {
        assert.equal(args.company, 'Northwind Analytics');
        assert.equal(args.jobTitle, 'Support Engineer');
        assert.match(args.tailoredResumeMd, /Tailored resume/);
        return { markdown: COVER_MD };
      },
    }),
  });
  const saved = getApplicationById(application.id);
  assert.equal(saved.company, 'Northwind Analytics');
  assert.equal(saved.job_title, 'Support Engineer');
  assert.match(saved.resume_md, /Tailored resume/);
  assert.match(saved.cover_md, /Dear Hiring Manager/);
  assert.equal(application.cover_letter_available, true);
  assert.equal(application.cover_letter_error, null);
});

test('Resume + Cover Letter reports cover failure without claiming full success', async () => {
  const { application } = await runAnalyzeGeneration({
    body: { jd: JD, generate_cover_letter: true },
    ...deps({
      generate: async () => ({
        markdown: RESUME_MD,
        fit_score: 81,
        detected_skills: ['TypeScript'],
        job_title: 'Support Engineer',
        company: 'Northwind Analytics',
        location: 'Melbourne VIC',
        tracker: { logicalCalls: 1 },
      }),
      generateCover: async () => {
        const err = new Error('模型没有返回可用的求职信内容。');
        err.statusCode = 502;
        throw err;
      },
    }),
  });
  assert.equal(application.cover_letter_available, false);
  assert.match(application.cover_letter_error, /求职信/);
  assert.match(getApplicationById(application.id).resume_md, /Tailored resume/);
  assert.equal(getApplicationById(application.id).cover_md, '');
});

test('missing JD or empty cover-only failure does not save a successful pair', async () => {
  await assert.rejects(
    () => runAnalyzeGeneration({
      body: { jd: '', generate_resume: false, generate_cover_letter: true },
      ...deps({ generateCover: async () => ({ markdown: COVER_MD }) }),
    }),
    (err) => err.statusCode === 400
  );
  await assert.rejects(
    () => runAnalyzeGeneration({
      body: { jd: JD, generate_resume: false, generate_cover_letter: true },
      ...deps({
        generateCover: async () => {
          const err = new Error('未找到用户简历，无法生成求职信。');
          err.statusCode = 400;
          throw err;
        },
      }),
    }),
    (err) => err.statusCode === 400
  );
});

test('updating cover_md does not change resume_md', () => {
  const id = Number(insertApplication({
    created_at: new Date().toISOString(),
    company: 'Northwind Analytics',
    job_title: 'Support Engineer',
    location: 'Melbourne VIC',
    url: '',
    source: 'other',
    jd_text: JD,
    stack_used: 'Support Engineer',
    fit_score: 80,
    resume_md: 'RESUME-KEEP',
    cover_md: '',
    status: 'not_started',
    theme: 'classic',
  }));
  updateApplication(id, { cover_md: COVER_MD });
  const saved = getApplicationById(id);
  assert.equal(saved.resume_md, 'RESUME-KEEP');
  assert.match(saved.cover_md, /Dear Hiring Manager/);
});
