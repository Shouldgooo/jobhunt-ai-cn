'use strict';

const fs = require('fs');
const path = require('path');
const { callLLM } = require('./tailor');

const TEMPLATE_PATH = path.join(__dirname, '../user/cover-letter/template.md');
const PROMPTS_JSON  = path.join(__dirname, '../user/prompts.json');

async function generateCoverLetter({ company, job_title, jd }) {
  if (!fs.existsSync(TEMPLATE_PATH)) {
    return { markdown: '', available: false };
  }

  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const prompts  = JSON.parse(fs.readFileSync(PROMPTS_JSON, 'utf8'));
  const prompt   = prompts.coverletter
    .replace(/\{\{COMPANY\}\}/g,   company)
    .replace(/\{\{JOB_TITLE\}\}/g, job_title)
    .replace('{{JD}}',             jd)
    .replace('{{TEMPLATE}}',       template);

  const result = await callLLM(prompt);

  return { markdown: fillTemplate(template, result), available: true };
}

function fillTemplate(template, values) {
  let filled = template;
  for (const [key, value] of Object.entries(values)) {
    filled = filled.replaceAll(`{{${key}}}`, value);
  }
  return filled;
}

module.exports = { generateCoverLetter, fillTemplate };
