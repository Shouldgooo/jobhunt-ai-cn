import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseJd, nextAutoField } from './parse-jd.ts'

const SEEK_STYLE = `
View all jobs
Network Support
Example Outdoor svg
3.7
4.2 · 125 reviews
[Richmond, Melbourne VIC](https://www.example.com/jobs?l=richmond)
Richmond, Melbourne VIC (Hybrid)
Information & Communication Technology
Help Desk & IT Support
Full time
Posted 2d ago
Salary match

What you will do
Help customers with outdoor equipment systems.

Company profile
Example Outdoor
About us
Example Outdoor sells camping gear.
`

const LINKEDIN_STYLE = `
IT Support Engineer
Example Technology Group
Melbourne, Victoria, Australia · Hybrid
2 days ago · 48 applicants
See who ... Easy Apply

About the job
We are looking for an IT Support Engineer to join a small team.

Company
Example Technology Group
`

const INDEED_STYLE = `
Service Desk Analyst
Example Services Pty Ltd
3.9
Dandenong VIC 3175
Job details
Full-time
Monday to Friday

Job description
Provide first-line support for internal staff.

Company reviews
Example Services Pty Ltd
`

const CAREERS_STYLE = `
# Junior Software Developer
Example Software
Melbourne VIC

About the role
Build internal tools with TypeScript.

Who we are
Example Software is a fictional product studio.
`

const STRUCTURED_JD = `# Support Engineer

**Date: **23 Sept 2026

**Location:** Dandenong South, Victoria, Australia, 3175

**Company: **Example Automotive Pty. Ltd

## About Us

Example text...
`

test('parseJd: SEEK-style full-page copy', () => {
  const parsed = parseJd(SEEK_STYLE)
  assert.equal(parsed.job_title, 'Network Support')
  assert.equal(parsed.company, 'Example Outdoor')
  assert.equal(parsed.location, 'Richmond, Melbourne VIC')
})

test('parseJd: LinkedIn-style full-page copy', () => {
  const parsed = parseJd(LINKEDIN_STYLE)
  assert.equal(parsed.job_title, 'IT Support Engineer')
  assert.equal(parsed.company, 'Example Technology Group')
  assert.equal(parsed.location, 'Melbourne, Victoria, Australia')
})

test('parseJd: Indeed-style full-page copy', () => {
  const parsed = parseJd(INDEED_STYLE)
  assert.equal(parsed.job_title, 'Service Desk Analyst')
  assert.equal(parsed.company, 'Example Services Pty Ltd')
  assert.equal(parsed.location, 'Dandenong VIC 3175')
})

test('parseJd: generic careers-page copy', () => {
  const parsed = parseJd(CAREERS_STYLE)
  assert.equal(parsed.job_title, 'Junior Software Developer')
  assert.equal(parsed.company, 'Example Software')
  assert.equal(parsed.location, 'Melbourne VIC')
})

test('parseJd: Pedders-style markdown with bold labels', () => {
  const parsed = parseJd(STRUCTURED_JD)
  assert.equal(parsed.job_title, 'Support Engineer')
  assert.equal(parsed.company, 'Example Automotive Pty. Ltd')
  assert.equal(parsed.location, 'Dandenong South, Victoria, Australia, 3175')
})

test('nextAutoField: empty field is populated; manual edit is kept', () => {
  assert.equal(nextAutoField('', 'Support Engineer', ''), 'Support Engineer')
  assert.equal(nextAutoField('Support Engineer', 'Other Role', 'Support Engineer'), 'Other Role')
  assert.equal(nextAutoField('My Title', 'Support Engineer', 'Support Engineer'), 'My Title')
  assert.equal(nextAutoField('Support Engineer', '', 'Support Engineer'), '')
})
