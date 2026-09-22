'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const { renderBlock, inlineMd, parseFrontMatter, renderResume } = require('../renderer');

// ─── inlineMd ─────────────────────────────────────────────────────────────────

test('inlineMd: converts **bold** to <strong>', () => {
  assert.equal(inlineMd('Hello **world**'), 'Hello <strong>world</strong>');
});

test('inlineMd: multiple bold spans in one line', () => {
  assert.equal(inlineMd('**C#**, **React**, plain'), '<strong>C#</strong>, <strong>React</strong>, plain');
});

test('inlineMd: no change when no bold markers', () => {
  assert.equal(inlineMd('plain text'), 'plain text');
});

// ─── renderBlock ──────────────────────────────────────────────────────────────

test('renderBlock: ## heading → <h2>', () => {
  const result = renderBlock('## Experience');
  assert.equal(result, '<h2>Experience</h2>');
});

test('renderBlock: ## heading with bold inside', () => {
  const result = renderBlock('## **Summary**');
  assert.ok(result.includes('<h2>') && result.includes('<strong>Summary</strong>'));
});

test('renderBlock: paired row → .row div', () => {
  const result = renderBlock('Orefox Ai Limited\n  ~ Feb 2025 - July 2025');
  assert.ok(result.includes('class="row"'));
  assert.ok(result.includes('class="row-main"'));
  assert.ok(result.includes('class="row-meta"'));
  assert.ok(result.includes('Orefox Ai Limited'));
  assert.ok(result.includes('Feb 2025 - July 2025'));
});

test('renderBlock: paired row with bold title', () => {
  const result = renderBlock('**Software Engineer**\n  ~ Brisbane, Australia');
  assert.ok(result.includes('<strong>Software Engineer</strong>'));
  assert.ok(result.includes('Brisbane, Australia'));
});

test('renderBlock: single bullet → <ul><li>', () => {
  const result = renderBlock('- Built RESTful APIs using **C#**');
  assert.ok(result.startsWith('<ul>'));
  assert.ok(result.includes('<li>'));
  assert.ok(result.includes('<strong>C#</strong>'));
});

test('renderBlock: multi-bullet block → single <ul> with multiple <li>', () => {
  const result = renderBlock('- First bullet\n- Second bullet\n- Third bullet');
  const liCount = (result.match(/<li>/g) || []).length;
  assert.equal(liCount, 3);
  assert.equal((result.match(/<ul>/g) || []).length, 1);
});

test('renderBlock: plain paragraph → <p>', () => {
  const result = renderBlock('Technologies: C#, React, Node.js');
  assert.ok(result.startsWith('<p>'));
  assert.ok(result.includes('Technologies: C#, React, Node.js'));
});

test('renderBlock: not a paired row if only one line with ~', () => {
  // Single line containing ~ should be a paragraph, not a row
  const result = renderBlock('Skills ~ something');
  assert.ok(result.startsWith('<p>'), `Expected <p>, got: ${result}`);
});

// ─── parseFrontMatter ─────────────────────────────────────────────────────────

const SAMPLE_FM = `---
name: Jane Doe
header:
  - text: "mobile: 0400 000 000"
  - text: "email: test@example.com"
    link: mailto:test@example.com
---

## Summary

Some text here.`;

test('parseFrontMatter: extracts name', () => {
  const { name } = parseFrontMatter(SAMPLE_FM);
  assert.equal(name, 'Jane Doe');
});

test('parseFrontMatter: extracts header items', () => {
  const { headerItems } = parseFrontMatter(SAMPLE_FM);
  assert.equal(headerItems.length, 2);
  assert.equal(headerItems[0].text, 'mobile: 0400 000 000');
  assert.equal(headerItems[0].link, null);
  assert.equal(headerItems[1].text, 'email: test@example.com');
  assert.equal(headerItems[1].link, 'mailto:test@example.com');
});

test('parseFrontMatter: body excludes front matter', () => {
  const { body } = parseFrontMatter(SAMPLE_FM);
  assert.ok(body.startsWith('## Summary'));
  assert.ok(!body.includes('name: Hsin-Yu Chou'));
});

test('parseFrontMatter: no front matter → returns markdown as body', () => {
  const md = '## Just a heading\n\nSome text.';
  const { name, headerItems, body } = parseFrontMatter(md);
  assert.equal(name, '');
  assert.equal(headerItems.length, 0);
  assert.equal(body, md);
});

test('parseFrontMatter: accepts * list markers', () => {
  const md = `---
name: Jane Doe
header:
* text: "mobile: 0400 000 000"
* text: "email: test@example.com"
  link: mailto:test@example.com
---
## Summary
Hi.`;
  const { headerItems } = parseFrontMatter(md);
  assert.equal(headerItems.length, 2);
  assert.equal(headerItems[0].text, 'mobile: 0400 000 000');
  assert.equal(headerItems[1].link, 'mailto:test@example.com');
});

test('renderResume: contact line is email | phone | github, centered, no labels or portfolio', () => {
  const md = `---
name: Jane Doe
header:
* text: "mobile: 0400 000 000"
* text: "portfolio: example.com"
  link: https://example.com
* text: "email: [jane@example.com](mailto:jane@example.com)"
  link: mailto:jane@example.com
* text: "github: github.com/example"
  link: https://github.com/example
---
## Summary
Hi.`;
  const html = renderResume(md, 'classic');
  const contact = html.match(/<div class="resume-contact">([\s\S]*?)<\/div>/)[1];
  assert.equal(
    contact,
    '<a href="mailto:jane@example.com">jane@example.com</a> | <span>0400 000 000</span> | <a href="https://github.com/example">github.com/example</a>'
  );
  assert.doesNotMatch(contact, /portfolio|email:|mobile:|github:/i);
  assert.match(html, /\.resume-contact\s*\{[^}]*text-align:\s*center/);
});
