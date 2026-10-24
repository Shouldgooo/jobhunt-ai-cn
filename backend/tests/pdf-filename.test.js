'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  pdfExportFilename,
  sanitizePdfFilenamePart,
  parseContentDispositionFilename,
  contentDisposition,
  PDF_FILENAME_CANDIDATE_NAME,
} = require('../../shared/pdf-filename');

const FILENAME_RE = /^[A-Za-z0-9_]+\.pdf$/;

test('normal job title and company become Name_Role_Company_Resume.pdf', () => {
  const name = pdfExportFilename({
    jobTitle: 'Junior Software Developer',
    company: 'Northwind Analytics',
    type: 'resume',
  });
  assert.equal(
    name,
    'SIHUA_TANG_Junior_Software_Developer_Northwind_Analytics_Resume.pdf',
  );
  assert.match(name, FILENAME_RE);
  assert.equal(PDF_FILENAME_CANDIDATE_NAME, 'SIHUA_TANG');
});

test('cover letter uses Cover_Letter and is distinct from resume', () => {
  const resume = pdfExportFilename({
    jobTitle: 'Junior Software Developer',
    company: 'Northwind Analytics',
    type: 'resume',
  });
  const cover = pdfExportFilename({
    jobTitle: 'Junior Software Developer',
    company: 'Northwind Analytics',
    type: 'coverletter',
  });
  assert.equal(
    cover,
    'SIHUA_TANG_Junior_Software_Developer_Northwind_Analytics_Cover_Letter.pdf',
  );
  assert.notEqual(resume, cover);
  assert.match(cover, FILENAME_RE);
  assert.ok(!cover.includes('__'));
});

test('multiple spaces collapse to a single underscore', () => {
  const name = pdfExportFilename({
    jobTitle: 'IT    Support',
    company: 'Northwind   Analytics',
    type: 'resume',
  });
  assert.equal(name, 'SIHUA_TANG_IT_Support_Northwind_Analytics_Resume.pdf');
  assert.ok(!name.includes('__'));
});

test('ampersand, slash, hyphen and other symbols become underscores', () => {
  const name = pdfExportFilename({
    jobTitle: 'IT Support / Help-Desk',
    company: 'Acme & Co.',
    type: 'coverletter',
  });
  assert.equal(name, 'SIHUA_TANG_IT_Support_Help_Desk_Acme_Co_Cover_Letter.pdf');
  assert.match(name, FILENAME_RE);
  assert.ok(!name.includes(' '));
  assert.ok(!name.includes('-'));
  assert.ok(!name.includes('&'));
  assert.ok(!name.includes('/'));
  assert.ok(!name.startsWith('_'));
  assert.ok(!name.endsWith('_'));
});

test('missing job title or company uses explicit defaults, never undefined/null', () => {
  const missingBoth = pdfExportFilename({ type: 'resume' });
  assert.equal(missingBoth, 'SIHUA_TANG_Role_Company_Resume.pdf');
  const missingJob = pdfExportFilename({ company: 'Acme', type: 'coverletter' });
  assert.equal(missingJob, 'SIHUA_TANG_Role_Acme_Cover_Letter.pdf');
  const missingCompany = pdfExportFilename({ jobTitle: 'Engineer', type: 'resume' });
  assert.equal(missingCompany, 'SIHUA_TANG_Engineer_Company_Resume.pdf');
  assert.doesNotMatch(missingBoth, /undefined|null/i);
});

test('candidate name is always SIHUA_TANG, even if other fields look like a person', () => {
  const name = pdfExportFilename({
    jobTitle: 'Fake Person',
    company: 'Other',
    type: 'resume',
  });
  assert.match(name, /^SIHUA_TANG_/);
  assert.equal(name, 'SIHUA_TANG_Fake_Person_Other_Resume.pdf');
  assert.equal(sanitizePdfFilenamePart('___', 'Role'), 'Role');
});

test('Content-Disposition parser reads filename and filename*', () => {
  const built = contentDisposition('SIHUA_TANG_Role_Company_Resume.pdf');
  assert.match(built, /filename="SIHUA_TANG_Role_Company_Resume\.pdf"/);
  assert.equal(parseContentDispositionFilename(built), 'SIHUA_TANG_Role_Company_Resume.pdf');
  assert.equal(
    parseContentDispositionFilename('attachment; filename="ignored.pdf"; filename*=UTF-8\'\'Prefer.pdf'),
    'Prefer.pdf',
  );
  assert.equal(parseContentDispositionFilename(''), '');
});
