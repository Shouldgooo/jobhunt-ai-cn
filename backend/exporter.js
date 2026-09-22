'use strict';

// Oh My CV removed in v2 refactor.
// PDFs are now generated on-demand via page.setContent() + page.pdf().
// Oh My CV lifecycle is no longer managed here or in server.js.

const puppeteer = require('puppeteer');
const { renderResume, renderCoverLetter } = require('./renderer');

// ─── Resume PDF ────────────────────────────────────────────────────────────────

/**
 * Render a resume markdown string to a PDF Buffer.
 * @param {string} markdown - Filled resume markdown (base.md format)
 * @param {string} [theme]  - Theme name (e.g. 'classic'). Defaults to user.config.js theme.
 * @returns {Promise<Buffer>}
 */
async function exportResumePDF(markdown, theme) {
  const html = renderResume(markdown, theme);
  return _renderPDF(html, {
    format: 'A4',
    printBackground: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' },
  });
}

// ─── Cover Letter PDF ──────────────────────────────────────────────────────────

/**
 * Render a cover letter markdown string to a PDF Buffer.
 * @param {string} markdown
 * @returns {Promise<Buffer>}
 */
async function exportCoverLetterPDF(markdown) {
  const html = renderCoverLetter(markdown);
  return _renderPDF(html, {
    format: 'A4',
    printBackground: false,
    margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' },
  });
}

// ─── Shared Puppeteer helper ───────────────────────────────────────────────────

async function _renderPDF(html, pdfOptions) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.emulateMediaType('print');
    const buffer = await page.pdf({ ...pdfOptions, timeout: 60000 });
    return Buffer.from(buffer); // ensure Buffer even if Puppeteer returns Uint8Array
  } finally {
    await browser.close();
  }
}

module.exports = { exportResumePDF, exportCoverLetterPDF };
