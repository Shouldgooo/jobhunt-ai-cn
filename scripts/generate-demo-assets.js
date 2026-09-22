'use strict';

/**
 * generate-demo-assets.js
 *
 * Generates the static demo assets (PDFs + preview HTML) from the fake
 * resume markdown. Run this once before deploying the demo build.
 *
 *   node scripts/generate-demo-assets.js
 *
 * Output:
 *   frontend/public/demo/resume.pdf
 *   frontend/public/demo/coverletter.pdf
 *   frontend/public/demo/preview.html
 */

const path = require('path');
const fs   = require('fs');

// Load backend modules
const { exportResumePDF, exportCoverLetterPDF } = require('../backend/exporter');
const { renderResume }                          = require('../backend/renderer');

const DEMO_DIR     = path.resolve(__dirname, '../frontend/public/demo');
const RESUME_MD    = fs.readFileSync(path.join(DEMO_DIR, 'resume.md'), 'utf8');
const COVER_MD     = fs.readFileSync(path.join(DEMO_DIR, 'coverletter.md'), 'utf8');
const THEME        = 'classic';

async function main() {
  console.log('Generating demo assets...\n');

  // 1. Resume PDF
  console.log('→ resume.pdf');
  const resumePdf = await exportResumePDF(RESUME_MD, THEME);
  fs.writeFileSync(path.join(DEMO_DIR, 'resume.pdf'), resumePdf);
  console.log(`  ✓ ${resumePdf.length} bytes\n`);

  // 2. Cover letter PDF
  console.log('→ coverletter.pdf');
  const coverPdf = await exportCoverLetterPDF(COVER_MD);
  fs.writeFileSync(path.join(DEMO_DIR, 'coverletter.pdf'), coverPdf);
  console.log(`  ✓ ${coverPdf.length} bytes\n`);

  // 3. Preview HTML
  console.log('→ preview.html');
  const html = renderResume(RESUME_MD, THEME);
  fs.writeFileSync(path.join(DEMO_DIR, 'preview.html'), html);
  console.log(`  ✓ ${html.length} chars\n`);

  console.log('Done. Commit frontend/public/demo/ before deploying.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
