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

const COVER_LETTER_CLICHE_PHRASES = [
  'I am writing to express my strong interest',
  'I am writing to express my interest',
  'I am thrilled to apply',
  'I am confident that my skills',
  'I am passionate about technology',
  'I would be a valuable asset',
  "In today's fast-paced environment",
  'I believe I am an ideal candidate',
];

const COVER_LETTER_TARGET_WORDS = { min: 250, max: 350 };

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
    'Write a professional Australian English cover letter for THIS job only.',
    'Different job descriptions must produce clearly different letters. Do not reuse a generic template.',
    'Return JSON only: { "body": "<letter body>" }.',
    '',
    'The "body" is the finished letter only — no name, email, phone, address, LinkedIn, or other header.',
    'Do not emit Markdown headings such as "## Opening", "## Experience", or "## Closing".',
    'Start with a natural salutation such as "Dear Hiring Manager," unless a real hiring-manager name is explicitly provided in the user notes.',
    'Do not invent a hiring-manager name, company name, job title, or location.',
    `Use exactly this company name: ${company}`,
    `Use exactly this job title: ${jobTitle}`,
    location ? `Location (optional context only): ${location}` : 'Location is unknown — do not invent one.',
    '',
    'BEFORE WRITING — analyse the JD internally. Do not print this analysis.',
    '1. Job title and company (use the exact values above; never invent missing ones).',
    '2. Main duties actually described in the JD.',
    '3. The 3–5 most important skill requirements, ranked by what THIS role needs — not a keyword dump.',
    '4. Essential versus desirable requirements when the JD distinguishes them.',
    '5. Special requirements stated in the JD (client-facing work, shift patterns, industry domain, clearance, tooling).',
    'If the JD is thin, work only with what is present. Do not invent duties, products, culture, values, or strategy.',
    '',
    'MATCHING — every claim must follow: JD Requirement → CV Evidence → Cover Letter Content.',
    'ORIGINAL CV is the source of facts.',
    '1. Choose the 2–3 most relevant REAL experiences (projects, duties, tools) for this JD.',
    '2. Prefer specific work and technical evidence over generic soft-skill claims.',
    '3. Use a quantified result only when the ORIGINAL CV already states that number. Never invent metrics.',
    '4. Candidate profile may add targeting / framing, not new jobs, degrees, tools, or metrics.',
    '5. Tailored resume is CONTEXT only. It must not be the sole source of a new fact.',
    '6. Do not rewrite the resume as paragraphs. Do not invent personal contact details.',
    '',
    'EVIDENCE LEVELS — classify each claim internally. Do not print Level A–E labels.',
    'Level A — Professional Experience: the skill or task is in a formal job on the ORIGINAL CV. Describe that work without enlarging the duty or proficiency.',
    'Level B — Project Experience: the skill or task is only in a personal, school, or other project. Keep the project context. Do not upgrade it to commercial employment.',
    'Level C — Listed Skill: the skill appears only in the Skills list. You may say it is part of the technical background or that the candidate is familiar with it. Do not claim job use. Do not invent coursework as the source.',
    'Level D — Transferable Skill: related CV evidence exists, but the candidate has not done the JD task. Explain how the real experience would help them learn the new duty. Never rewrite the JD duty as lived experience.',
    'Level D means a foundation for learning the target duty, not the ability to perform it already.',
    '  Allowed: "My experience investigating application defects provides a foundation for learning Windows and Microsoft 365 support workflows."',
    '  Allowed: "My experience troubleshooting application defects would provide a useful foundation for learning first-level IT support workflows."',
    '  Forbidden: "My debugging experience translates directly to diagnosing Windows and Microsoft 365 issues."',
    '  Also forbidden as lived experience: "I have experience managing IT support tickets."',
    'Do not package an unsupported JD task as a present ability with wording such as "translates directly to diagnosing…", "equipped me to manage…", "prepared me to administer…", "enables me to deliver…", or "comfortable handling…" unless the ORIGINAL CV actually shows that task.',
    'Keep three buckets distinct: already done (Level A/B); related but not done (Level D — foundation for learning); no evidence (Level E — omit or a brief willingness to learn).',
    'Level E — Unsupported: no CV evidence. Do not claim the skill or experience. Do not hide the gap with vague analytical, business-intelligence, or soft-skill language.',
    '',
    'DATABASE WORK IS NOT AUTOMATICALLY ANALYTICS.',
    'MySQL development assistance, PostgreSQL schema design, and SQL queries are database or engineering evidence.',
    'Do not upgrade them to advanced data analytics, business intelligence expertise, customer behaviour analysis, forecasting experience, or analysing business datasets.',
    'You may describe the real database work and how it would help the candidate learn analysis. If the ORIGINAL CV actually contains an analytics job or project, describe that accurately — do not over-restrict real analysis evidence.',
    '',
    'The job description is a requirement list, not candidate history.',
    'Do not turn a JD duty into "I have experience…", "I am proficient in…", "I am comfortable managing…", "I regularly work with…", or "I have successfully delivered…" unless the ORIGINAL CV supports that exact claim at Level A or B (Level B must keep project context).',
    'Windows troubleshooting, Power BI, customer support tickets, user-account administration, and phone/remote support are JD duties only unless the ORIGINAL CV states them.',
    '',
    'PROFICIENCY — never upgrade the wording on the CV.',
    '- "assisted senior engineers with MySQL" → "I assisted senior engineers with MySQL-related development tasks." Not "advanced SQL expertise".',
    '- "practical exposure to AWS" → "My technical background includes some exposure to AWS." Not production cloud hosting experience.',
    '- C# only in Skills → "C# is included in my technical skill set." Not professional C# development experience.',
    'Do not call a listed-only skill proficient, advanced, expert, or commercially experienced.',
    '',
    'MUST-HAVE GAPS:',
    'If the CV has direct evidence, use that real work or project.',
    'If only transferable evidence, use Level D wording.',
    'If none: do not pretend; do not cover the gap with empty soft skills; a brief willingness to learn is allowed; do not list every missing skill; prefer real strengths over a gap inventory.',
    'Power BI, Microsoft 365, or Windows may be mentioned only as learning goals or omitted — never as skills already held unless the ORIGINAL CV says so.',
    '',
    'SPECIFICITY: real experience → task done → link to this JD. Not abstract capability → self-praise.',
    '',
    'STYLE — natural, professional Australian English. Avoid default AI filler.',
    'These phrases are not a default template (do not open or pad with them):',
    ...COVER_LETTER_CLICHE_PHRASES.map((phrase) => `- ${phrase}...`),
    'Prefer a direct opening such as "I am applying for the [job title] role at [company]." Vary the sentence naturally; do not force every letter to use the same first line.',
    'Open with the role and the most relevant real background. Explain the match with concrete experience.',
    'Do not stack keyword lists. Give each paragraph a clear purpose. Vary sentence rhythm. Avoid exaggerated or stiff tone.',
    '',
    'STRUCTURE — four paragraphs, no headings:',
    '1. Opening — the role, the company, and the most relevant real background.',
    '2. Relevant experience — 2–3 real matches for this JD.',
    '3. Contribution — value for this team, grounded in JD priorities and CV evidence. No empty claims.',
    '4. Closing — natural interest and a polite sign-off. Do not add the candidate name after the sign-off; the header is rendered separately.',
    '',
    'COMPANY DETAIL:',
    'You may mention a product, domain, or team fact only if the JD states it.',
    'If the JD gives only a company name, do not invent praise, culture, values, products, or strategy.',
    '',
    `LENGTH: ${COVER_LETTER_TARGET_WORDS.min}–${COVER_LETTER_TARGET_WORDS.max} English words when evidence is rich. Shorter is better than padding when evidence is thin.`,
    'Do not pad to hit the word count. Do not invent duties, inflate proficiency, or add empty claims to hit a word count. If over 350 words, cut repetition first. Keep it to one A4 page. Keep it concise.',
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
  COVER_LETTER_CLICHE_PHRASES,
  COVER_LETTER_TARGET_WORDS,
  COVER_LETTER_EMPTY,
  COVER_LETTER_JD_REQUIRED,
  COVER_LETTER_CV_REQUIRED,
  COVER_LETTER_JOB_META_REQUIRED,
  COVER_LETTER_CONFIRM_REQUIRED,
  formatLlmError,
};
