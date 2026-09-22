'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fillTemplate } = require('../coverletter');

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
