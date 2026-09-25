'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseJd, mergeJobMeta } = require('../jd-parser');

const PEDDERS_JD = `# Support Engineer
Date: 23 Sept 2026
Location: Dandenong South, Victoria, Australia, 3175
Company: Pedders Shock Absorber Service Pty. Ltd

We are looking for a Support Engineer to join the team.
`;

test('parseJd: markdown heading title + Company + Location', () => {
  const parsed = parseJd(PEDDERS_JD);
  assert.equal(parsed.job_title, 'Support Engineer');
  assert.equal(parsed.company, 'Pedders Shock Absorber Service Pty. Ltd');
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
  assert.deepEqual(parseJd(''), { job_title: '', company: '', location: '' });
  assert.deepEqual(parseJd(null), { job_title: '', company: '', location: '' });
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
    { job_title: '', company: 'Pedders Shock Absorber Service Pty. Ltd', location: '' },
    { job_title: 'Wrong Title', company: 'Wrong Co', location: 'Dandenong South, Victoria, Australia, 3175' }
  );
  assert.equal(merged.job_title, 'Support Engineer');
  assert.equal(merged.company, 'Pedders Shock Absorber Service Pty. Ltd');
  assert.equal(merged.location, 'Dandenong South, Victoria, Australia, 3175');
});
