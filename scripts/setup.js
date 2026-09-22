'use strict';

/**
 * setup.js
 *
 * First-time setup: copies example files into place if the real files
 * don't exist yet. Safe to re-run — never overwrites existing files.
 *
 *   npm run setup
 */

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const copies = [
  {
    src:  'user/cv.example.md',
    dest: 'user/cv.md',
    hint: 'Edit user/cv.md — replace with your own resume in Oh My CV markdown format.',
  },
  {
    src:  'user/profile.example.md',
    dest: 'user/profile.md',
    hint: 'Edit user/profile.md — set your target roles, adaptive framing, and professional narrative.',
  },
  {
    src:  'user/cover-letter/template.example.md',
    dest: 'user/cover-letter/template.md',
    hint: 'Edit user/cover-letter/template.md — write your cover letter template.',
  },
  {
    src:  'user/cover-letter/static.example.md',
    dest: 'user/cover-letter/static.md',
    hint: 'Edit user/cover-letter/static.md — your pre-written cover letter for applications without AI (only {{job_title}} and {{company}} are filled automatically).',
  },
  {
    src:  'user/prompts.example.json',
    dest: 'user/prompts.json',
    hint: 'Edit user/prompts.json — customize the rescore and coverletter LLM prompts (optional).',
  },
  {
    src:  'backend/.env.example',
    dest: 'backend/.env',
    hint: 'Edit backend/.env — set GEMINI_API_KEY, or set LLM_PROVIDER=ollama for local inference.',
  },
];

let anyCreated = false;

for (const { src, dest, hint } of copies) {
  const srcPath  = path.join(ROOT, src);
  const destPath = path.join(ROOT, dest);

  if (fs.existsSync(destPath)) {
    console.log(`  ✓ ${dest} already exists — skipped`);
    continue;
  }

  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.copyFileSync(srcPath, destPath);
  console.log(`  + created ${dest}`);
  console.log(`    → ${hint}`);
  anyCreated = true;
}

if (anyCreated) {
  console.log('\nSetup complete. Edit the files above, then run: npm run dev');
} else {
  console.log('\nAll files already in place. Run: npm run dev');
}
