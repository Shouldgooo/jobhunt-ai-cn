'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cleanJobDescriptionForAI } = require('../jd-clean');
const { SEEK_STYLE, LINKEDIN_STYLE, INDEED_STYLE } = require('./fixtures/job-ads');

const DUP_ABOUT = `
View all jobs
Support Engineer
Northwind Analytics
Melbourne VIC

The Job
Own first-line support and write runbooks.

Requirements
Must know TypeScript and incident response.

About us
Northwind Analytics builds internal tools for fictional teams.
We value clear writing and calm operations.

Company profile
About us
Northwind Analytics builds internal tools for fictional teams.
We value clear writing and calm operations.

https://www.example.com/jobs/123
Report this job advert
Be careful
Posted 1d ago
Salary match
svg
`;

test('cleaner removes obvious SEEK chrome and keeps the role', () => {
  const cleaned = cleanJobDescriptionForAI(SEEK_STYLE);
  assert.equal(cleaned.includes('View all jobs'), false);
  assert.equal(cleaned.includes('Salary match'), false);
  assert.equal(cleaned.includes('Posted 2d ago'), false);
  assert.match(cleaned, /Help customers with outdoor equipment systems/);
  assert.match(cleaned, /Network Support/);
  assert.match(cleaned, /Example Outdoor sells camping gear/);
  assert.ok(cleaned.length < SEEK_STYLE.length);
});

test('cleaner removes LinkedIn chrome and keeps the job', () => {
  const cleaned = cleanJobDescriptionForAI(LINKEDIN_STYLE);
  assert.equal(/easy apply/i.test(cleaned), false);
  assert.match(cleaned, /IT Support Engineer/);
  assert.match(cleaned, /We are looking for an IT Support Engineer/);
});

test('cleaner removes Indeed chrome and keeps responsibilities', () => {
  const cleaned = cleanJobDescriptionForAI(INDEED_STYLE);
  assert.equal(cleaned.includes('Job details'), false);
  assert.equal(cleaned.includes('Company reviews'), false);
  assert.match(cleaned, /Provide first-line support for internal staff/);
  assert.match(cleaned, /Service Desk Analyst/);
});

test('cleaner preserves responsibilities and requirements', () => {
  const cleaned = cleanJobDescriptionForAI(DUP_ABOUT);
  assert.match(cleaned, /Own first-line support and write runbooks/);
  assert.match(cleaned, /Must know TypeScript and incident response/);
  assert.equal(cleaned.includes('View all jobs'), false);
  assert.equal(cleaned.includes('Report this job advert'), false);
  assert.equal(cleaned.includes('https://www.example.com/jobs/123'), false);
});

test('cleaner can drop a duplicated company-about block', () => {
  const cleaned = cleanJobDescriptionForAI(DUP_ABOUT);
  const hits = cleaned.split('Northwind Analytics builds internal tools').length - 1;
  assert.equal(hits, 1);
});

test('cleaner leaves a plain JD almost unchanged', () => {
  const plain = 'Support Engineer\n\nRequirements\n- TypeScript\n- Customer support';
  const cleaned = cleanJobDescriptionForAI(plain);
  assert.match(cleaned, /TypeScript/);
  assert.match(cleaned, /Customer support/);
});
