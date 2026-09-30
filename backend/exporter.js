'use strict';

// Oh My CV removed in v2 refactor.
// PDFs are now generated on-demand via page.setContent() + page.pdf().
// Oh My CV lifecycle is no longer managed here or in server.js.

const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer');
const { renderResume, renderCoverLetter } = require('./renderer');

const HOME_PUPPETEER_CACHE = path.join(os.homedir(), '.cache', 'puppeteer');

function cacheHasChrome(dir) {
  if (!dir) return false;
  try {
    return fs.existsSync(path.join(dir, 'chrome'));
  } catch {
    return false;
  }
}

/** Prefer a cache that actually has Chrome; ignore empty Cursor sandbox caches. */
function resolvePuppeteerCacheDir({
  envCache = process.env.PUPPETEER_CACHE_DIR,
  homeCache = HOME_PUPPETEER_CACHE,
} = {}) {
  if (cacheHasChrome(envCache)) return envCache;
  if (cacheHasChrome(homeCache)) return homeCache;
  return envCache || homeCache;
}

function applyPuppeteerCacheDir() {
  const resolved = resolvePuppeteerCacheDir();
  if (resolved) process.env.PUPPETEER_CACHE_DIR = resolved;
  return resolved;
}

function findFileNamed(root, wanted, depth = 0) {
  if (!root || depth > 8) return null;
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return null; }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isFile() && entry.name === wanted) return full;
    if (entry.isDirectory()) {
      const found = findFileNamed(full, wanted, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** Puppeteer snapshots cacheDirectory at require-time; pass an explicit binary. */
function resolveChromeExecutable(cacheDir = resolvePuppeteerCacheDir()) {
  const fromCache = findFileNamed(path.join(cacheDir, 'chrome'), 'Google Chrome for Testing');
  if (fromCache) return fromCache;
  const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (fs.existsSync(macChrome)) return macChrome;
  return null;
}

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
  const cacheDir = applyPuppeteerCacheDir();
  const executablePath = resolveChromeExecutable(cacheDir);
  const launchOpts = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  };
  if (executablePath) launchOpts.executablePath = executablePath;
  const browser = await puppeteer.launch(launchOpts);
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

module.exports = {
  exportResumePDF,
  exportCoverLetterPDF,
  resolvePuppeteerCacheDir,
  applyPuppeteerCacheDir,
  resolveChromeExecutable,
};
