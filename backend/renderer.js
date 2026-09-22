'use strict';

/**
 * renderer.js — Converts base.md format → full HTML for PDF export / live preview.
 *
 * Supported syntax:
 *   YAML front matter: name + header items (text / optional link)
 *   ## H2           → section heading
 *   **text**        → <strong>
 *   text\n  ~ note  → flex row (left: text, right: note)
 *   - bullet        → <li> in <ul>
 *   paragraph       → <p>
 */

const fs   = require('fs');
const path = require('path');

const THEMES_DIR      = path.resolve(__dirname, '../themes');
const USER_CONFIG_PATH = path.resolve(__dirname, '../user.config.js');

/** Slugs that belong in the left column for two-column themes. */
const LEFT_SECTION_SLUGS = new Set([
  'summary', 'skills', 'education', 'certification', 'certifications',
  'languages', 'interests', 'about',
]);

/** Theme names that use two-column HTML layout (resume-left / resume-right). */
const TWO_COLUMN_THEMES = new Set(['modern', 'sidebar']);

/** Load CSS for the given theme name (or the default from user.config.js). */
function loadThemeCss(theme) {
  const resolved = theme || (require(USER_CONFIG_PATH).theme) || 'classic';
  return fs.readFileSync(path.join(THEMES_DIR, `${resolved}.css`), 'utf8');
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Render filled resume markdown to a complete HTML document string.
 * Uses the default theme from user.config.js.
 * @param {string} markdown
 * @param {string} [theme] - theme name override (e.g. 'modern')
 * @returns {string}
 */
function renderResume(markdown, theme) {
  return renderResumeWithCss(markdown, loadThemeCss(theme), theme);
}

/**
 * Render resume markdown with an explicit CSS string (used for style previews).
 * @param {string} markdown
 * @param {string} css
 * @param {string} [theme] - optional theme name, used to select layout mode
 * @returns {string}
 */
function renderResumeWithCss(markdown, css, theme) {
  const { name, headerItems, body } = parseFrontMatter(markdown);
  const bodyHtml = renderBody(body, theme);
  return buildHTML(name, headerItems, bodyHtml, css);
}

/**
 * Render plain cover letter markdown to a complete HTML document string.
 * @param {string} markdown
 * @returns {string}
 */
function renderCoverLetter(markdown) {
  const noComments = markdown.split('\n').filter(l => !l.trimStart().startsWith('#')).join('\n');
  const withBold   = noComments.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const bodyHtml   = withBold
    .split(/\n{2,}/)
    .map(b => b.trim())
    .filter(Boolean)
    .map(b => `<p>${b.replace(/\n/g, '<br>')}</p>`)
    .join('\n');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { font-family: "Times New Roman", serif; font-size: 11pt; line-height: 1.5; margin: 50px 60px; color: #000; }
  p { margin: 0 0 0.8em 0; }
  strong { font-weight: bold; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

// ─── Front matter parser ───────────────────────────────────────────────────────

function parseFrontMatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]+?)\n---\n?([\s\S]*)$/);
  if (!match) return { name: '', headerItems: [], body: markdown };

  const fm   = match[1];
  const body = match[2].trim();

  const nameMatch = fm.match(/^name:\s*(.+)$/m);
  const name = nameMatch ? nameMatch[1].trim().replace(/^["']|["']$/g, '') : '';

  const headerItems = [];
  const itemRe = /[-*] text:\s*"([^"]+)"[ \t]*(?:\n[ \t]+link:\s*(\S+))?/g;
  let m;
  while ((m = itemRe.exec(fm)) !== null) {
    headerItems.push({ text: m[1].trim(), link: m[2] ? m[2].trim() : null });
  }

  return { name, headerItems, body };
}

// ─── Body renderer ─────────────────────────────────────────────────────────────

/**
 * Groups body blocks into sections (split by ## headings) and wraps each in
 * <section class="resume-section section-[slug]"> so CSS can target them by name.
 * This enables both single-column and multi-column CSS layouts.
 */
function renderBody(body, theme) {
  const allBlocks = body
    .split(/\n{2,}/)
    .map(b => b.trim())
    .filter(Boolean);

  const sections = [];
  let current = null;

  for (const block of allBlocks) {
    if (block.startsWith('## ')) {
      if (current) sections.push(current);
      const heading = block.slice(3).trim();
      const slug = heading.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      current = { heading, slug, blocks: [] };
    } else {
      if (current) current.blocks.push(block);
    }
  }
  if (current) sections.push(current);

  // Fallback: no ## headings found, render blocks as-is
  if (sections.length === 0) {
    return allBlocks.map(renderBlock).join('\n');
  }

  const renderSection = ({ heading, slug, blocks }) => {
    const inner = blocks.map(renderBlock).join('\n');
    return `<section class="resume-section section-${slug}">\n<h2>${inlineMd(heading)}</h2>\n${inner}\n</section>`;
  };

  // Two-column layout: split sections into left and right divs
  if (theme && TWO_COLUMN_THEMES.has(theme)) {
    const leftSections  = sections.filter(s => LEFT_SECTION_SLUGS.has(s.slug));
    const rightSections = sections.filter(s => !LEFT_SECTION_SLUGS.has(s.slug));
    return [
      '<div class="resume-left">',
      leftSections.map(renderSection).join('\n'),
      '</div>',
      '<div class="resume-right">',
      rightSections.map(renderSection).join('\n'),
      '</div>',
    ].join('\n');
  }

  // Single-column (all existing themes)
  return sections.map(renderSection).join('\n');
}

function renderBlock(block) {
  const lines = block.split('\n');

  // ## Section heading
  if (lines[0].startsWith('## ')) {
    return `<h2>${inlineMd(lines[0].slice(3))}</h2>`;
  }

  // Paired row: any text + "  ~ annotation" on next line
  if (lines.length === 2 && lines[1].trimStart().startsWith('~ ')) {
    const left  = inlineMd(lines[0].trim());
    const right = inlineMd(lines[1].trimStart().slice(2).trim());
    return `<div class="row"><span class="row-main">${left}</span><span class="row-meta">${right}</span></div>`;
  }

  // Bullet list (all lines start with "- ")
  if (lines.every(l => l.startsWith('- '))) {
    const items = lines.map(l => `<li>${inlineMd(l.slice(2))}</li>`).join('');
    return `<ul>${items}</ul>`;
  }

  // Paragraph
  return `<p>${lines.map(inlineMd).join('<br>')}</p>`;
}

function inlineMd(text) {
  return text
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

// ─── HTML builder ──────────────────────────────────────────────────────────────

function unwrapMdLinks(text) {
  return String(text).replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

function parseContactItem(item) {
  const raw = unwrapMdLinks(item.text).trim();
  const labeled = raw.match(/^([A-Za-z]+):\s*(.*)$/);
  return {
    kind: labeled ? labeled[1].toLowerCase() : '',
    display: (labeled ? labeled[2] : raw).trim(),
    link: item.link,
  };
}

function renderContactNode(item) {
  if (item.kind === 'email') {
    const href = item.link || `mailto:${item.display}`;
    return `<a href="${esc(href)}">${esc(item.display)}</a>`;
  }
  if (item.kind === 'github') {
    let href = item.link;
    if (!href && /github\.com/i.test(item.display)) {
      href = item.display.startsWith('http') ? item.display : `https://${item.display}`;
    }
    return href
      ? `<a href="${esc(href)}">${esc(item.display)}</a>`
      : `<span>${esc(item.display)}</span>`;
  }
  if (item.kind === 'mobile' || item.kind === 'phone') {
    return `<span>${esc(item.display)}</span>`;
  }
  return null;
}

function buildContactHtml(headerItems) {
  const parsed = headerItems.map(parseContactItem);
  const ordered = [
    parsed.find(p => p.kind === 'email'),
    parsed.find(p => p.kind === 'mobile' || p.kind === 'phone'),
    parsed.find(p => p.kind === 'github'),
  ].filter(Boolean);
  if (ordered.length) return ordered.map(renderContactNode).join(' | ');

  return parsed
    .filter(p => p.kind !== 'portfolio')
    .map(p => p.link
      ? `<a href="${esc(p.link)}">${esc(p.display)}</a>`
      : `<span>${esc(p.display)}</span>`)
    .join(' | ');
}

function buildHTML(name, headerItems, bodyHtml, css) {
  const contactHtml = buildContactHtml(headerItems);

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
${css}
</style>
</head>
<body>
<div id="resume">
  <header class="resume-header">
    <h1 class="resume-name">${esc(name)}</h1>
    <div class="resume-contact">${contactHtml}</div>
  </header>
  <main class="resume-body">
${bodyHtml}
  </main>
</div>
</body>
</html>`;
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = { renderResume, renderResumeWithCss, renderCoverLetter, renderBlock, inlineMd, parseFrontMatter, loadThemeCss };
