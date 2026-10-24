'use strict';

const fs = require('fs');
const path = require('path');
const { callLLM, formatLlmError } = require('./tailor');
const { assertResumeHeader, preserveResumeHeader, parseFrontMatter } = require('./renderer');

const TEMPLATE_PATH = path.join(__dirname, '../user/cover-letter/template.md');
const PROMPTS_JSON  = path.join(__dirname, '../user/prompts.json');
const CV_MD         = path.join(__dirname, '../user/cv.md');
const PROFILE_MD    = path.join(__dirname, '../user/profile.md');

const COVER_LETTER_EMPTY = '模型没有返回可用的求职信内容。';
const COVER_LETTER_JD_REQUIRED = '缺少职位描述，无法生成求职信。';
const COVER_LETTER_CV_REQUIRED = '未找到用户简历，无法生成求职信。';
const COVER_LETTER_JOB_META_REQUIRED = '无法识别职位名称或公司，请手动填写后重试。';
const COVER_LETTER_CONFIRM_REQUIRED = '现有求职信将被替换，请确认后重试。';
const MAX_NOTES_CHARS = 2000;

const COVER_LETTER_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    body: { type: 'string' },
  },
  required: ['body'],
  additionalProperties: false,
};

function userError(message, statusCode, code) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (code) err.code = code;
  return err;
}

function readOptionalFile(filePath) {
  try {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  } catch {
    return '';
  }
}

function readSourceCv(cvMd) {
  const text = typeof cvMd === 'string' ? cvMd : readOptionalFile(CV_MD);
  if (!String(text || '').trim()) {
    throw userError(COVER_LETTER_CV_REQUIRED, 400, 'CV_REQUIRED');
  }
  return text;
}

function requiresCoverOverwriteConfirm(existingCover, confirm) {
  return Boolean(existingCover && String(existingCover).trim()) && confirm !== true;
}

function normalizeNotes(notes) {
  if (typeof notes !== 'string') return '';
  return notes.trim().slice(0, MAX_NOTES_CHARS);
}

function countWords(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

function coverLetterPageWarning(body) {
  const words = countWords(body);
  if (words > 400) {
    return '求职信较长，导出 PDF 时可能超过一页。系统不会裁剪内容。';
  }
  return '';
}

function extractCoverLetterBody(raw) {
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    if (typeof raw.body === 'string' && raw.body.trim()) return raw.body.trim();
    if (typeof raw.letter === 'string' && raw.letter.trim()) return raw.letter.trim();
    if (typeof raw.cover_letter === 'string' && raw.cover_letter.trim()) return raw.cover_letter.trim();
  }
  throw userError(COVER_LETTER_EMPTY, 502, 'COVER_LETTER_EMPTY');
}

function stripGeneratedIdentity(text) {
  return parseFrontMatter(text).body || String(text || '').trim();
}

function attachCoverLetterHeader(generatedMd, sourceMd) {
  const body = stripGeneratedIdentity(generatedMd);
  if (!body.trim()) throw userError(COVER_LETTER_EMPTY, 502, 'COVER_LETTER_EMPTY');
  const markdown = preserveResumeHeader(body, sourceMd);
  assertResumeHeader(markdown);
  return markdown;
}

function buildCoverLetterPrompt({
  cvMd,
  profileMd = '',
  jd,
  company,
  jobTitle,
  location = '',
  notes = '',
  tailoredResumeMd = '',
} = {}) {
  return [
    'Write a professional Australian English cover letter for THIS job.',
    'Return JSON only: { "body": "<letter body>" }.',
    '',
    'The "body" is the letter only. Do not include a name, email, phone, address, LinkedIn, or any other header.',
    'Start with a natural salutation such as "Dear Hiring Manager," unless a real hiring-manager name is explicitly provided in the user notes.',
    'Do not invent a hiring-manager name, company name, job title, or location.',
    `Use exactly this company name: ${company}`,
    `Use exactly this job title: ${jobTitle}`,
    location ? `Location (optional context only): ${location}` : 'Location is unknown — do not invent one.',
    '',
    'Target length: 250–350 words. Keep it to one A4 page. Natural, concise, specific.',
    '',
    'Structure:',
    '1. Opening — the role, the company, and a genuine reason for applying.',
    '2. Relevant experience — pick the 2–3 most important JD requirements and explain the match using REAL evidence.',
    '3. Value proposition — concrete value for this team. No empty claims.',
    '4. Closing — interest, thanks, professional sign-off. Do not add the candidate name after the sign-off; the header is rendered separately.',
    '',
    'EVIDENCE RULES:',
    '1. ORIGINAL CV is the source of facts.',
    '2. Candidate profile may add targeting / framing, not new jobs, degrees, or metrics.',
    '3. Tailored resume is CONTEXT only. It must not be the sole source of a new fact.',
    '4. The job description is not candidate evidence. Do not describe a JD requirement as a skill the candidate already has unless the ORIGINAL CV supports it.',
    '5. If a JD skill is missing from the ORIGINAL CV, use a real transferable skill or omit it. Never fabricate experience, certificates, education, projects, proficiency, or quantified results.',
    '6. Do not repeat the resume. Do not use generic AI clichés.',
    '7. Do not invent personal contact details.',
    '',
    'ORIGINAL CV:',
    cvMd,
    '',
    'CANDIDATE PROFILE:',
    profileMd || '(none)',
    '',
    'JOB DESCRIPTION:',
    jd,
    '',
    'TAILORED RESUME (context only):',
    tailoredResumeMd || '(none)',
    '',
    'OPTIONAL USER NOTES (not evidence of experience):',
    notes || '(none)',
  ].join('\n');
}

async function generateCoverLetterDocument({
  jd,
  company,
  jobTitle,
  location = '',
  notes = '',
  cvMd: cvMdOverride,
  profileMd: profileOverride,
  tailoredResumeMd = '',
} = {}, { callLLM: llm = callLLM, signal, onProgress } = {}) {
  const cleanedJd = String(jd || '').trim();
  if (!cleanedJd) throw userError(COVER_LETTER_JD_REQUIRED, 400, 'JD_REQUIRED');

  const companyName = String(company || '').trim();
  const title = String(jobTitle || '').trim();
  if (!companyName || !title) {
    throw userError(COVER_LETTER_JOB_META_REQUIRED, 422, 'JOB_META_REQUIRED');
  }

  const cvMd = readSourceCv(cvMdOverride);
  assertResumeHeader(cvMd);
  const profileMd = profileOverride != null ? String(profileOverride) : readOptionalFile(PROFILE_MD);
  const extraNotes = normalizeNotes(notes);

  let cleanedForAi = cleanedJd;
  try {
    const { cleanJobDescriptionForAI } = require('./jd-clean');
    cleanedForAi = cleanJobDescriptionForAI(cleanedJd);
  } catch {
    cleanedForAi = cleanedJd;
  }

  const prompt = buildCoverLetterPrompt({
    cvMd,
    profileMd,
    jd: cleanedForAi,
    company: companyName,
    jobTitle: title,
    location: String(location || '').trim(),
    notes: extraNotes,
    tailoredResumeMd: String(tailoredResumeMd || ''),
  });

  onProgress?.({ type: 'progress', stage: 'cover_letter', progress: 88, message: '正在生成求职信…' });
  const raw = await llm(prompt, { signal, responseSchema: COVER_LETTER_RESPONSE_JSON_SCHEMA });
  const body = extractCoverLetterBody(raw);
  const markdown = attachCoverLetterHeader(body, cvMd);
  return {
    markdown,
    body,
    pageWarning: coverLetterPageWarning(body),
  };
}

/** Legacy template-fill path (kept for generateApplication one-shot cover objects). */
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

module.exports = {
  generateCoverLetter,
  generateCoverLetterDocument,
  requiresCoverOverwriteConfirm,
  fillTemplate,
  buildCoverLetterPrompt,
  extractCoverLetterBody,
  attachCoverLetterHeader,
  coverLetterPageWarning,
  COVER_LETTER_RESPONSE_JSON_SCHEMA,
  COVER_LETTER_EMPTY,
  COVER_LETTER_JD_REQUIRED,
  COVER_LETTER_CV_REQUIRED,
  COVER_LETTER_JOB_META_REQUIRED,
  COVER_LETTER_CONFIRM_REQUIRED,
  formatLlmError,
};
