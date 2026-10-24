'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildCoverLetterPrompt,
  generateCoverLetterDocument,
  COVER_LETTER_RESPONSE_JSON_SCHEMA,
} = require('../coverletter');
const { parseFrontMatter } = require('../renderer');

const EVIDENCE_CV = `---
name: Jordan Avery
header:
  - text: "email: jordan@example.com"
---

## Summary
Back-end developer with practical exposure to AWS and full-stack project work.

## Skills
TypeScript, JavaScript, SQL, C#, AWS

## Work Experience

### Back-end Developer — Huayun Zhongsheng Technology Co.
- Diagnosed and resolved application defects on a digital tax platform
- Assisted senior engineers with MySQL database development and API implementation

## Projects

### MiniMovie — Full-Stack Film Discovery Platform
- Built a TypeScript, React, Next.js, Express and PostgreSQL application
`;

function promptFor(jd, company, jobTitle) {
  return buildCoverLetterPrompt({
    cvMd: EVIDENCE_CV,
    jd,
    company,
    jobTitle,
  });
}

async function generateWith(jd, company, jobTitle, body) {
  let calls = 0;
  let seenPrompt = '';
  const result = await generateCoverLetterDocument({
    jd,
    company,
    jobTitle,
    cvMd: EVIDENCE_CV,
    profileMd: '',
  }, {
    callLLM: async (prompt, opts = {}) => {
      calls += 1;
      seenPrompt = prompt;
      assert.equal(opts.responseSchema, COVER_LETTER_RESPONSE_JSON_SCHEMA);
      return { body };
    },
  });
  return { calls, seenPrompt, result };
}

test('cover letter prompt classifies evidence and forbids JD-as-experience wording', () => {
  const prompt = promptFor(
    'Level 1 IT Support. Must handle tickets, Windows troubleshooting, and Power BI is not required.',
    'Example Support',
    'IT Support Technician'
  );
  assert.match(prompt, /Level A — Professional Experience/);
  assert.match(prompt, /Level B — Project Experience/);
  assert.match(prompt, /Level C — Listed Skill/);
  assert.match(prompt, /Level D — Transferable Skill/);
  assert.match(prompt, /Level E — Unsupported/);
  assert.match(prompt, /I have experience managing IT support tickets/);
  assert.match(prompt, /foundation for learning first-level IT support workflows/);
  assert.match(prompt, /I am comfortable managing/);
  assert.match(prompt, /advanced SQL expertise/);
  assert.match(prompt, /production cloud hosting/);
  assert.match(prompt, /professional C# development experience/);
  assert.match(prompt, /The job description is a requirement list, not candidate history/);
  assert.match(prompt, /Shorter is better than padding when evidence is thin/);
  assert.match(prompt, /translates directly to diagnosing/);
  assert.match(prompt, /foundation for learning Windows and Microsoft 365/);
  assert.match(prompt, /DATABASE WORK IS NOT AUTOMATICALLY ANALYTICS/);
  assert.match(prompt, /I am applying for the \[job title\] role at \[company\]/);
});

test('IT Support tickets stay Level D when the CV only has application debugging', async () => {
  const jd = `IT Support Technician — Example Support
Essential: respond to customer support tickets, Windows troubleshooting, user account administration, phone and remote support.`;
  const body = [
    'Dear Hiring Manager,',
    'I am applying for the IT Support Technician role at Example Support after working as a Back-end Developer at Huayun Zhongsheng Technology Co.',
    'My experience troubleshooting application defects would provide a useful foundation for learning first-level IT support workflows. I have not managed IT support tickets, administered user accounts, or provided Windows phone or remote support.',
    'I would welcome the chance to discuss that debugging background. Kind regards,',
  ].join('\n\n');

  const { calls, seenPrompt, result } = await generateWith(jd, 'Example Support', 'IT Support Technician', body);
  assert.equal(calls, 1);
  assert.match(seenPrompt, /Level D — Transferable Skill/);
  assert.match(seenPrompt, /customer support tickets/);
  assert.match(result.body, /foundation for learning first-level IT support/);
  assert.doesNotMatch(result.body, /I have experience managing IT support tickets/i);
  assert.doesNotMatch(result.body, /I am comfortable managing/i);
  assert.doesNotMatch(result.body, /I regularly work with Windows/i);
  assert.doesNotMatch(result.body, /translates directly to diagnosing/i);
  assert.doesNotMatch(result.body, /equipped me to manage/i);
  assert.match(seenPrompt, /foundation for learning Windows and Microsoft 365/);
  assert.equal(parseFrontMatter(result.markdown).name, 'Jordan Avery');
});

test('application debugging is not Windows or Microsoft 365 hands-on experience', () => {
  const prompt = promptFor(
    'IT Support. Essential: Windows troubleshooting and Microsoft 365.',
    'Example Support',
    'IT Support Technician'
  );
  assert.match(prompt, /translates directly to diagnosing Windows and Microsoft 365 issues/);
  assert.match(prompt, /foundation for learning Windows and Microsoft 365 support workflows/);
  assert.match(prompt, /Level D means a foundation for learning the target duty, not the ability to perform it already/);
});

test('database development is not business data analytics', async () => {
  const jd = `Data Analyst — Example Insights
Must have: analysing business datasets, customer behaviour analysis, forecasting, Power BI.`;
  const body = [
    'Dear Hiring Manager,',
    'I am applying for the Data Analyst role at Example Insights.',
    'I assisted senior engineers with MySQL database development and designed PostgreSQL schemas on the MiniMovie project. That database work is a foundation for learning analysis, not business intelligence or customer-behaviour experience.',
    'Kind regards,',
  ].join('\n\n');
  const { calls, seenPrompt, result } = await generateWith(jd, 'Example Insights', 'Data Analyst', body);
  assert.equal(calls, 1);
  assert.match(seenPrompt, /DATABASE WORK IS NOT AUTOMATICALLY ANALYTICS/);
  assert.match(seenPrompt, /analysing business datasets/);
  assert.match(result.body, /foundation for learning analysis/);
  assert.doesNotMatch(result.body, /analysing structured datasets/i);
  assert.doesNotMatch(result.body, /advanced data analytics/i);
  assert.doesNotMatch(result.body, /business intelligence expertise/i);
  assert.doesNotMatch(result.body, /forecasting experience/i);
});

test('real analytics experience on the CV can still be described', async () => {
  const analyticsCv = `---
name: Jordan Avery
header:
  - text: "email: jordan@example.com"
---

## Work Experience

### Data Analyst — Harbor Civic
- Built weekly Power BI views of ticket volumes
- Investigated customer behaviour trends and recommended two process changes
`;
  const body = [
    'Dear Hiring Manager,',
    'I am applying for the Data Analyst role at Example Insights.',
    'At Harbor Civic I built weekly Power BI views of ticket volumes and investigated customer behaviour trends. Those are analytics tasks I have already done, not database-only engineering.',
    'Kind regards,',
  ].join('\n\n');
  const result = await generateCoverLetterDocument({
    jd: 'Data Analyst. Power BI and customer behaviour analysis required.',
    company: 'Example Insights',
    jobTitle: 'Data Analyst',
    cvMd: analyticsCv,
    profileMd: '',
  }, {
    callLLM: async (prompt, opts = {}) => {
      assert.equal(opts.responseSchema, COVER_LETTER_RESPONSE_JSON_SCHEMA);
      assert.match(prompt, /If the ORIGINAL CV actually contains an analytics job or project, describe that accurately/);
      assert.match(prompt, /Harbor Civic/);
      assert.match(prompt, /Power BI views/);
      return { body };
    },
  });
  assert.match(result.body, /Power BI views of ticket volumes/);
  assert.match(result.body, /customer behaviour trends/);
  assert.doesNotMatch(result.body, /I do not have Power BI/);
});

test('prompt discourages near-template openings without forcing one first line', () => {
  const prompt = promptFor('Any role.', 'Example Co', 'Example Role');
  assert.match(prompt, /I am writing to express my interest/);
  assert.match(prompt, /I am applying for the \[job title\] role at \[company\]/);
  assert.match(prompt, /do not force every letter to use the same first line/);
});

test('Power BI stays unsupported when it is absent from the CV', async () => {
  const jd = `Data Analyst — Example Insights
Must have: Power BI dashboards and proven business-insight case studies. Strong SQL.`;
  const body = [
    'Dear Hiring Manager,',
    'I am applying for the Data Analyst role at Example Insights.',
    'I assisted senior engineers with MySQL-related development tasks and used PostgreSQL on the MiniMovie project. I do not have Power BI experience. My experience working with relational databases provides a foundation for developing further reporting and analytics skills.',
    'Kind regards,',
  ].join('\n\n');

  const { calls, seenPrompt, result } = await generateWith(jd, 'Example Insights', 'Data Analyst', body);
  assert.equal(calls, 1);
  assert.match(seenPrompt, /Level E — Unsupported/);
  assert.match(seenPrompt, /Power BI/);
  assert.doesNotMatch(result.body, /I have (strong )?(Power BI|business intelligence)/i);
  assert.doesNotMatch(result.body, /advanced SQL expertise/i);
  assert.match(result.body, /I do not have Power BI experience/);
  assert.match(result.body, /assisted senior engineers with MySQL/);
});

test('assisted MySQL must not be described as advanced SQL expertise', () => {
  const prompt = promptFor('Data Analyst needing SQL.', 'Example Insights', 'Data Analyst');
  assert.match(prompt, /assisted senior engineers with MySQL/);
  assert.match(prompt, /Not "advanced SQL expertise"/);
  assert.match(prompt, /Assisted senior engineers with MySQL database development/);
});

test('C# listed only under Skills must not become commercial experience', () => {
  const prompt = promptFor(
    'Junior Software Developer. Familiarity with TypeScript/React or C#/.NET.',
    'Example Software',
    'Junior Software Developer'
  );
  assert.match(prompt, /C# only in Skills/);
  assert.match(prompt, /C# is included in my technical skill set/);
  assert.match(prompt, /Not professional C# development experience/);
  assert.match(prompt, /Do not claim job use/);
  assert.match(prompt, /C#, AWS/);
});

test('AWS exposure must not become production cloud hosting experience', () => {
  const prompt = promptFor(
    'Developer with AWS production hosting required.',
    'Example Cloud',
    'Junior Software Developer'
  );
  assert.match(prompt, /practical exposure to AWS/);
  assert.match(prompt, /some exposure to AWS/);
  assert.match(prompt, /Not production cloud hosting experience/);
  assert.match(prompt, /practical exposure to AWS/);
});

test('real commercial development can still be highlighted accurately', async () => {
  const jd = `Junior Software Developer — Example Software
Essential: maintain features, investigate software issues, write tests, work with TypeScript or similar web stacks.`;
  const body = [
    'Dear Hiring Manager,',
    'I am applying for the Junior Software Developer role at Example Software.',
    'As a Back-end Developer at Huayun Zhongsheng Technology Co. I diagnosed application defects on a digital tax platform and assisted senior engineers with MySQL database development and API implementation. On the MiniMovie project I built a TypeScript, React, Next.js, Express and PostgreSQL application. C# is included in my technical skill set; I am not claiming professional C# development experience. My technical background includes some exposure to AWS rather than production cloud hosting.',
    'Kind regards,',
  ].join('\n\n');

  const { calls, result } = await generateWith(jd, 'Example Software', 'Junior Software Developer', body);
  assert.equal(calls, 1);
  assert.match(result.body, /Huayun Zhongsheng Technology Co/);
  assert.match(result.body, /digital tax platform/);
  assert.match(result.body, /MiniMovie/);
  assert.match(result.body, /C# is included in my technical skill set/);
  assert.match(result.body, /not claiming professional C#/);
  assert.doesNotMatch(result.body, /I have professional (C#|CSharp)/i);
  assert.doesNotMatch(result.body, /I have extensive experience deploying/i);
});

test('thin evidence may produce a short cover letter without padding', async () => {
  const shortBody = [
    'Dear Hiring Manager,',
    'I am applying for the Data Analyst role at Example Insights after assisting senior engineers with MySQL-related development tasks.',
    'I do not have Power BI or business-insight case studies, so I am keeping this letter to the database work I have actually done.',
    'Kind regards,',
  ].join('\n\n');

  const { calls, seenPrompt, result } = await generateWith(
    'Data Analyst requiring Power BI and advanced commercial analytics.',
    'Example Insights',
    'Data Analyst',
    shortBody
  );
  assert.equal(calls, 1);
  assert.match(seenPrompt, /Shorter is better than padding when evidence is thin/);
  const words = result.body.trim().split(/\s+/).filter(Boolean).length;
  assert.ok(words < 250, `short letter should stay under 250 words, got ${words}`);
  assert.equal(result.pageWarning, '');
  assert.doesNotMatch(result.body, /analytical mindset|strong business intelligence/i);
});
