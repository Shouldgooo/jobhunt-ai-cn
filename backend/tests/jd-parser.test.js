'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseJd, mergeJobMeta, normalizeJobAdText } = require('../jd-parser');
const {
  SEEK_STYLE,
  LINKEDIN_STYLE,
  INDEED_STYLE,
  CAREERS_STYLE,
  STRUCTURED_JD,
} = require('./fixtures/job-ads');

test('parseJd: SEEK-style full-page copy', () => {
  const parsed = parseJd(SEEK_STYLE);
  assert.equal(parsed.job_title, 'Network Support');
  assert.equal(parsed.company, 'Example Outdoor');
  assert.equal(parsed.location, 'Richmond, Melbourne VIC');
  assert.equal(parsed.work_arrangement, 'Hybrid');
  assert.equal(parsed.employment_type, 'Full time');
});

test('parseJd: LinkedIn-style full-page copy', () => {
  const parsed = parseJd(LINKEDIN_STYLE);
  assert.equal(parsed.job_title, 'IT Support Engineer');
  assert.equal(parsed.company, 'Example Technology Group');
  assert.equal(parsed.location, 'Melbourne, Victoria, Australia');
});

test('parseJd: Indeed-style full-page copy', () => {
  const parsed = parseJd(INDEED_STYLE);
  assert.equal(parsed.job_title, 'Service Desk Analyst');
  assert.equal(parsed.company, 'Example Services Pty Ltd');
  assert.equal(parsed.location, 'Dandenong VIC 3175');
  assert.equal(parsed.employment_type, 'Full time');
});

test('parseJd: generic careers-page copy', () => {
  const parsed = parseJd(CAREERS_STYLE);
  assert.equal(parsed.job_title, 'Junior Software Developer');
  assert.equal(parsed.company, 'Example Software');
  assert.equal(parsed.location, 'Melbourne VIC');
});

test('parseJd: structured markdown JD', () => {
  const parsed = parseJd(STRUCTURED_JD);
  assert.equal(parsed.job_title, 'Support Engineer');
  assert.equal(parsed.company, 'Example Automotive Pty. Ltd');
  assert.equal(parsed.location, 'Dandenong South, Victoria, Australia, 3175');
});

test('parseJd: markdown heading title + Company + Location', () => {
  const parsed = parseJd(`# Support Engineer
Date: 23 Sept 2026
Location: Dandenong South, Victoria, Australia, 3175
Company: Example Automotive Pty. Ltd

We are looking for a Support Engineer to join the team.
`);
  assert.equal(parsed.job_title, 'Support Engineer');
  assert.equal(parsed.company, 'Example Automotive Pty. Ltd');
  assert.equal(parsed.location, 'Dandenong South, Victoria, Australia, 3175');
});

test('parseJd: labeled Job Title / Employer / Based in', () => {
  const parsed = parseJd([
    'Job Title: Platform Engineer',
    'Employer: Northwind Analytics',
    'Based in: Sydney, NSW',
  ].join('\n'));
  assert.equal(parsed.job_title, 'Platform Engineer');
  assert.equal(parsed.company, 'Northwind Analytics');
  assert.equal(parsed.location, 'Sydney, NSW');
});

test('parseJd: missing metadata returns empty strings', () => {
  const parsed = parseJd('We need someone who can write TypeScript and help customers.');
  assert.equal(parsed.job_title, '');
  assert.equal(parsed.company, '');
  assert.equal(parsed.location, '');
});

test('parseJd: empty / non-string is safe', () => {
  assert.deepEqual(parseJd(''), {
    job_title: '', company: '', location: '', work_arrangement: '', employment_type: '',
  });
  assert.deepEqual(parseJd(null), {
    job_title: '', company: '', location: '', work_arrangement: '', employment_type: '',
  });
});

test('normalizeJobAdText does not require mutating the original JD', () => {
  const original = 'Example Outdoor svg\n\n\n3.7\n[Richmond, Melbourne VIC](https://example.com)';
  const copy = original;
  const normalized = normalizeJobAdText(original);
  assert.equal(original, copy);
  assert.match(normalized, /Example Outdoor/);
  assert.doesNotMatch(normalized, /svg/i);
  assert.doesNotMatch(normalized, /https:/);
  assert.match(normalized, /Richmond, Melbourne VIC/);
});

test('mergeJobMeta: Gemini fills fields the local parser missed', () => {
  const merged = mergeJobMeta(
    {},
    { job_title: '', company: '', location: '' },
    { job_title: 'Support Engineer', company: 'Acme Pty Ltd', location: 'Melbourne VIC' }
  );
  assert.equal(merged.job_title, 'Support Engineer');
  assert.equal(merged.company, 'Acme Pty Ltd');
  assert.equal(merged.location, 'Melbourne VIC');
});

test('mergeJobMeta: user / local parse wins over Gemini', () => {
  const merged = mergeJobMeta(
    { job_title: 'Support Engineer' },
    { job_title: '', company: 'Example Automotive Pty. Ltd', location: '' },
    { job_title: 'Wrong Title', company: 'Wrong Co', location: 'Dandenong South, Victoria, Australia, 3175' }
  );
  assert.equal(merged.job_title, 'Support Engineer');
  assert.equal(merged.company, 'Example Automotive Pty. Ltd');
  assert.equal(merged.location, 'Dandenong South, Victoria, Australia, 3175');
});
