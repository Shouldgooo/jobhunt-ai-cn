'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB = path.join(os.tmpdir(), `jab_summary_${Date.now()}.db`);
process.env.TEST_DB_PATH = TEST_DB;

const {
  buildChangeSummary,
  buildChangeSummarySafe,
  validateWorkExperience,
  EXPERIENCE_WARNING,
  EMPTY_MSG,
  UNAVAILABLE,
} = require('../change-summary');
const { runAnalyzeGeneration } = require('../analyze-flow');
const { getApplicationById, insertApplication } = require('../db');

after(() => {
  try { fs.unlinkSync(TEST_DB); } catch { /* ignore */ }
});

const ORIG = `---
name: Jordan Avery
---

## Skills
JavaScript, React, Node.js

## Projects
Built a full-stack portfolio website.
`;

test('identical before/after text produces NO claimed change', () => {
  const result = buildChangeSummary({
    originalResume: ORIG,
    generatedResume: ORIG,
    jd: 'Looking for React and AWS experience.',
    claimedChanges: ['强化了 React 技能', '新增了 TypeScript'],
  });
  assert.equal(result.resume_changes.length, 0);
  assert.equal(result.status, 'empty');
  assert.equal(result.message, EMPTY_MSG);
  assert.equal(JSON.stringify(result).includes('强化了 React'), false);
  assert.equal(JSON.stringify(result).includes('新增了 TypeScript'), false);
});

test('a real added phrase is reported as added', () => {
  const generated = ORIG.replace(
    'JavaScript, React, Node.js',
    'JavaScript, TypeScript, React, Node.js',
  );
  const result = buildChangeSummary({
    originalResume: ORIG,
    generatedResume: generated,
    jd: 'TypeScript and React developer.',
    profileMd: 'Comfortable with TypeScript.',
  });
  const skills = result.resume_changes.find((c) => c.section === 'Skills');
  assert.ok(skills);
  assert.equal(skills.verified, true);
  assert.ok(skills.type === 'added' || skills.type === 'modified');
  assert.match(skills.after, /TypeScript/);
  assert.equal(/TypeScript/.test(skills.before), false);
});

test('a real removed phrase is reported as removed', () => {
  const generated = ORIG.replace(', Node.js', '');
  const result = buildChangeSummary({
    originalResume: ORIG,
    generatedResume: generated,
    jd: 'JavaScript engineer.',
  });
  const skills = result.resume_changes.find((c) => c.section === 'Skills');
  assert.ok(skills);
  assert.ok(skills.type === 'removed' || skills.type === 'modified');
  assert.match(skills.before, /Node\.js/);
  assert.equal(/Node\.js/.test(skills.after), false);
  assert.equal(skills.verified, true);
});

test('a real modified phrase shows the actual before and after text', () => {
  const generated = ORIG.replace(
    'Built a full-stack portfolio website.',
    'Built and deployed a full-stack portfolio website with REST APIs and CI/CD.',
  );
  const result = buildChangeSummary({
    originalResume: ORIG,
    generatedResume: generated,
    jd: 'This role emphasizes API development and deployment plus CI/CD.',
  });
  const proj = result.resume_changes.find((c) => c.section === 'Projects');
  assert.ok(proj);
  assert.equal(proj.type, 'modified');
  assert.equal(proj.before.trim(), 'Built a full-stack portfolio website.');
  assert.equal(proj.after.trim(), 'Built and deployed a full-stack portfolio website with REST APIs and CI/CD.');
});

test('a JD keyword is only associated when it actually exists in the JD', () => {
  const generated = ORIG.replace(
    'Built a full-stack portfolio website.',
    'Built and deployed a full-stack portfolio website with REST APIs and CI/CD.',
  );
  const result = buildChangeSummary({
    originalResume: ORIG,
    generatedResume: generated,
    jd: 'We need API development and CI/CD. No mention of the other cloud.',
  });
  const proj = result.resume_changes.find((c) => c.section === 'Projects');
  assert.ok(proj.jd_keywords.some((k) => /API/i.test(k) || /CI\/CD/i.test(k)));
  assert.equal(proj.jd_keywords.some((k) => /AWS/i.test(k)), false);
});

test('a skill mentioned only in the JD is NOT reported as a resume change', () => {
  const result = buildChangeSummary({
    originalResume: ORIG,
    generatedResume: ORIG,
    jd: 'Must have AWS and Kubernetes experience.',
  });
  assert.equal(result.resume_changes.length, 0);
  assert.equal(JSON.stringify(result).includes('AWS'), false);
  assert.equal(JSON.stringify(result).includes('Kubernetes'), false);
});

test('a supposed Gemini change absent from the actual diff is ignored', () => {
  const result = buildChangeSummary({
    originalResume: ORIG,
    generatedResume: ORIG,
    jd: 'React role',
    claimedChanges: ['强化了 React 技能', '新增了 TypeScript', '突出 teamwork'],
  });
  assert.equal(result.resume_changes.length, 0);
  const blob = JSON.stringify(result);
  assert.equal(blob.includes('强化了'), false);
  assert.equal(blob.includes('突出 teamwork'), false);
});

test('unsupported additions are flagged rather than described as improvements', () => {
  const generated = ORIG.replace(
    'JavaScript, React, Node.js',
    'JavaScript, React, Node.js, AWS',
  );
  const result = buildChangeSummary({
    originalResume: ORIG,
    generatedResume: generated,
    jd: 'AWS required.',
    profileMd: 'Background in JavaScript and React.',
  });
  assert.ok(result.unsupported.some((u) => u.text === 'AWS'));
  const blob = JSON.stringify(result);
  assert.equal(blob.includes('根据 JD 增加了 AWS'), false);
  assert.equal(blob.includes('成功优化'), false);
});

test('no cover letter produces no fake cover-letter summary', () => {
  const result = buildChangeSummary({
    originalResume: ORIG,
    generatedResume: ORIG,
    coverLetter: '',
    jd: 'Problem-solving and teamwork required.',
  });
  assert.deepEqual(result.cover_letter.items, []);
  assert.equal(JSON.stringify(result).includes('更突出 problem-solving'), false);
});

test('cover letter items must exist in the final letter and the JD', () => {
  const result = buildChangeSummary({
    originalResume: ORIG,
    generatedResume: ORIG,
    coverLetter: 'I worked on REST API integration for internal tools.',
    jd: 'We need REST API experience.',
  });
  assert.equal(result.cover_letter.items.length >= 1, true);
  assert.match(result.cover_letter.items[0].text, /REST API/);
  assert.ok(result.cover_letter.items[0].jd_keywords.some((k) => /REST|API/i.test(k)));
});

test('missing comparison data never breaks generation', async () => {
  let inserted = 0;
  const { application } = await runAnalyzeGeneration({
    body: {
      jd: 'Job title: Support Engineer\nCompany: Northwind Analytics\nHelp customers.',
      generate_cover_letter: false,
    },
    summarize: () => { throw new Error('compare exploded'); },
    generate: async () => ({
      markdown: ORIG,
      fit_score: 70,
      detected_skills: ['React'],
      job_title: 'Support Engineer',
      company: 'Northwind Analytics',
      location: 'Melbourne',
      cover_md: '',
      cover_letter_available: false,
      tracker: { logicalCalls: 1, httpAttempts: 1 },
    }),
    insert: (row) => {
      inserted += 1;
      assert.ok(row.resume_md);
      const parsed = JSON.parse(row.change_summary);
      assert.equal(parsed.status, 'unavailable');
      assert.equal(parsed.message, UNAVAILABLE);
      return 501;
    },
    isValidTheme: () => true,
    getUserConfig: () => ({ theme: 'classic' }),
  });
  assert.equal(inserted, 1);
  assert.equal(application.id, 501);
});

test('successful generation stores a verified summary and uses one logical Gemini call', async () => {
  const generated = ORIG.replace(
    'JavaScript, React, Node.js',
    'JavaScript, TypeScript, React, Node.js',
  );
  const { application, tracker } = await runAnalyzeGeneration({
    body: {
      jd: 'Job title: Support Engineer\nCompany: Northwind Analytics\nTypeScript required.',
      generate_cover_letter: false,
    },
    generate: async () => ({
      markdown: generated,
      fit_score: 80,
      detected_skills: ['TypeScript'],
      job_title: 'Support Engineer',
      company: 'Northwind Analytics',
      location: 'Melbourne',
      cover_md: '',
      cover_letter_available: false,
      tracker: { logicalCalls: 1, httpAttempts: 1 },
    }),
    insert: (row) => {
      const parsed = JSON.parse(row.change_summary);
      assert.equal(parsed.status, 'ok');
      assert.ok(parsed.resume_changes.some((c) => c.after.includes('TypeScript') && c.verified));
      return insertApplication(row);
    },
    isValidTheme: () => true,
    getUserConfig: () => ({ theme: 'classic' }),
  });
  assert.equal(tracker.logicalCalls, 1);
  const row = getApplicationById(application.id);
  assert.ok(row.change_summary);
  assert.equal(JSON.parse(row.change_summary).resume_changes[0].verified, true);
});

const EXP_ORIG = `---
name: Jordan Avery
---

## Experience

**Warehouse Administrator**
  ~ Melbourne VIC

Northwind Logistics
  ~ Jan 2022 – Present

- Helped users with hardware and software problems
- Maintained spreadsheet trackers and documented procedures

## Projects

**PriceWatch** — Personal Project

- Built a REST API for price alerts
`;

test('work experience rewrite/reorder is a verified change and keeps identity fields', () => {
  const generated = EXP_ORIG.replace(
    `- Helped users with hardware and software problems
- Maintained spreadsheet trackers and documented procedures`,
    `- Performed troubleshooting of user hardware, software and connectivity issues
- Wrote documentation for spreadsheet trackers used in operations`,
  );
  const result = buildChangeSummary({
    originalResume: EXP_ORIG,
    generatedResume: generated,
    jd: 'IT support role focused on troubleshooting and documentation.',
  });
  const exp = result.resume_changes.find((c) => /experience/i.test(c.section));
  assert.ok(exp);
  assert.equal(exp.verified, true);
  assert.match(exp.after, /troubleshooting/);
  assert.match(exp.before, /Helped users with hardware/);
  assert.match(exp.after, /Northwind Logistics/);
  assert.match(exp.after, /Jan 2022/);
  assert.match(exp.after, /\*\*Warehouse Administrator\*\*/);
  assert.ok(exp.jd_keywords.some((k) => /troubleshoot/i.test(k) || /documentation/i.test(k)));
});

test('unchanged work experience is not falsely reported as changed', () => {
  const result = buildChangeSummary({
    originalResume: EXP_ORIG,
    generatedResume: EXP_ORIG,
    jd: 'IT support troubleshooting.',
  });
  assert.equal(result.resume_changes.some((c) => /experience/i.test(c.section)), false);
});

test('fabricated employer, title, technology, metric, and project-as-job are flagged', () => {
  const bad = `---
name: Jordan Avery
---

## Experience

**Software Developer**
  ~ Melbourne VIC

Acme Software
  ~ Jan 2022 – Present

- Built Kubernetes clusters and increased uptime by 47%

PriceWatch
  ~ 2024 – 2025
`;
  const flags = validateWorkExperience({
    originalResume: EXP_ORIG,
    generatedResume: bad,
    profileMd: 'Background in warehouse administration and user support.',
  });
  const kinds = flags.map((f) => f.kind);
  assert.ok(kinds.includes('employer'));
  assert.ok(kinds.includes('title'));
  assert.ok(kinds.includes('technology'));
  assert.ok(kinds.includes('metric'));
  assert.ok(kinds.includes('project_as_job'));
  const summary = buildChangeSummary({
    originalResume: EXP_ORIG,
    generatedResume: bad,
    jd: 'Software developer with Kubernetes.',
    profileMd: 'Background in warehouse administration and user support.',
  });
  assert.ok(summary.unsupported_experience.length > 0);
  assert.equal(EXPERIENCE_WARNING.includes('工作经历'), true);
});

test('supported Official Title | Functional Focus is not flagged', () => {
  const generated = EXP_ORIG.replace(
    '**Warehouse Administrator**',
    '**Warehouse Administrator | IT Systems & Data Support**',
  );
  const flags = validateWorkExperience({
    originalResume: EXP_ORIG,
    generatedResume: generated,
    profileMd: 'IT systems and data support in warehouse operations.',
  });
  assert.equal(flags.some((f) => f.kind === 'title'), false);
});

test('this module adds zero Gemini/LLM calls', () => {
  const src = fs.readFileSync(path.join(__dirname, '../change-summary.js'), 'utf8');
  assert.equal(/axios|generateContent|callLLM/i.test(src), false);
});

test('exporter source makes zero Gemini calls', () => {
  const src = fs.readFileSync(path.join(__dirname, '../exporter.js'), 'utf8');
  assert.equal(/generateApplication|callLLM|generateContent/i.test(src), false);
});
