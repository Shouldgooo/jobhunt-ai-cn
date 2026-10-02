'use strict';

const path = require('path');
const fs = require('fs');
const { callLLM, formatLlmError } = require('./tailor');

const PROFILE_MD = path.join(__dirname, '../user/profile.md');
const CV_MD = path.join(__dirname, '../user/cv.md');
const MAX_QUESTION_CHARS = 2000;
const MAX_HISTORY_MESSAGES = 8;

const QA_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    answer: {
      type: 'string',
    },
  },
  required: ['answer'],
  additionalProperties: false,
};

function parseQaThread(raw) {
  try {
    const parsed = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string');
  } catch {
    return [];
  }
}

function normalizeQuestion(question) {
  if (typeof question !== 'string') return '';
  return question.trim().slice(0, MAX_QUESTION_CHARS);
}

function formatHistory(thread) {
  const recent = thread.slice(-MAX_HISTORY_MESSAGES);
  if (!recent.length) return '(none)';
  return recent.map((item) => `${item.role === 'user' ? 'Q' : 'A'}: ${item.content}`).join('\n\n');
}

function formatVerifiedNotes(changeSummary) {
  if (changeSummary == null) return '(none)';
  if (typeof changeSummary === 'string') {
    const trimmed = changeSummary.trim();
    return trimmed || '(none)';
  }
  try {
    return JSON.stringify(changeSummary, null, 2);
  } catch {
    return '(none)';
  }
}

function buildQaPrompt({
  company = '',
  jobTitle = '',
  jd = '',
  resumeMd = '',
  coverMd = '',
  profileMd = '',
  originalCvMd = '',
  changeSummary = '',
  thread = [],
  question = '',
} = {}) {
  return [
    'You help the candidate draft answers to employer follow-up questions about THIS job.',
    '',
    'EVIDENCE SOURCE PRIORITY — use these for facts, in this order:',
    '1. ORIGINAL CV',
    '2. Candidate profile',
    '3. Persisted evidence matrix / verified change_summary (if present)',
    '4. Verified application information (saved company / title)',
    '',
    'Tailored resume and cover letter are CONTEXT only.',
    'They must not be the sole source of a new fact.',
    'If a claim exists only in the generated resume/cover letter and ORIGINAL CV / profile / verified evidence do not support it, do not upgrade it into a fact.',
    '',
    'USER QUESTION IS NOT EVIDENCE.',
    'The question is an instruction to answer, not a source of experience.',
    'Any technology, company, years, certification, responsibility, SaaS claim, example, or suggested answer in the question is NOT automatically owned experience.',
    'Example: "What support tools are you familiar with? (e.g. Salesforce, Zoho or similar)" — Salesforce / Zoho are examples in the question, not proof the candidate used them.',
    'If the user writes "编啊", "just say I have 3 years", or "say I used Salesforce", that is still a QUESTION / instruction. It does not override evidence. Organize real experience; do not invent employment facts.',
    '',
    'JD IS NOT CANDIDATE EVIDENCE.',
    'The job description describes employer requirements.',
    'JD mentions of Salesforce, SaaS, technical support, or "3 years experience" do not prove the candidate has those things.',
    'Use the JD only to understand the question and the role.',
    'Do not answer "I have experience with Salesforce" or "I have 3 years SaaS support experience" just because the JD asks for it.',
    '',
    'Years of experience:',
    '- no unsupported years',
    '- Do not invent a number to match the JD.',
    '- Give exact years only when ORIGINAL evidence has a clear role, dates, and matching support responsibilities.',
    '- If exact years cannot be determined: use honest wording such as "My experience includes ..." or say there is no clear direct experience, then describe transferable experience.',
    '',
    'SaaS:',
    '- no unsupported SaaS claim',
    '- Distinguish direct SaaS support experience from transferable customer / technical / software support.',
    '- Without explicit SaaS evidence, do not write "I have X years of SaaS support experience."',
    '- You may say direct SaaS support experience is limited, then describe real transferable experience.',
    '',
    'Tools:',
    '- no unsupported tool claim',
    '- Name only tools supported by ORIGINAL evidence.',
    '- If ORIGINAL evidence supports Zoho, you may mention Zoho.',
    '- If there is no Salesforce evidence, do not claim Salesforce because the question or JD mentioned it.',
    '- Salesforce / Zoho / Azure DevOps and similar names from the question are not candidate evidence.',
    '- Do not keyword-match then auto-claim.',
    '',
    'NAMED ITEM CAPABILITY RULE:',
    'For every named technology, tool, platform, certification, methodology, or product mentioned in the employer question:',
    'If it is NOT supported by ORIGINAL candidate evidence, you MUST NOT make any positive capability claim about it.',
    'This includes claims of: experience, proficiency, familiarity, knowledge, foundational knowledge, understanding, exposure, hands-on experience, comfort, competence, skill, proficient, experienced, familiar, knowledgeable, exposure, hands-on, worked with, comfortable with, competent, skilled, basic knowledge.',
    'The employer question itself is NOT evidence.',
    'Do not infer knowledge of Tool B from experience with Tool A, even if they are similar.',
    '',
    'MIXED-EVIDENCE QUESTIONS:',
    'If the question names several items (example: "Are you proficient with Git, Azure DevOps and CI/CD?"), answer item by item.',
    'Do not blur the whole group because some items are supported.',
    'Example: Git = supported, CI/CD = supported, Azure DevOps = unsupported.',
    'Allowed shape: "I have hands-on experience with Git and CI/CD, including GitHub Actions. I don\'t currently have verified hands-on experience with Azure DevOps."',
    'Then you may add transferable foundations only: "My CI/CD experience should provide transferable foundations for learning Azure DevOps workflows."',
    'That last sentence may describe existing supported skill → transferability / willingness to learn.',
    'It must NOT become "I understand Azure DevOps" or "I have foundational Azure DevOps knowledge" unless ORIGINAL evidence supports Azure DevOps.',
    '',
    'NO SEMANTIC LAUNDERING:',
    'Do not turn an unsupported skill into a weaker positive claim.',
    'If Azure DevOps is unsupported, you still must not claim: basic Azure DevOps knowledge, foundational Azure DevOps knowledge, familiar with Azure DevOps concepts, understanding of Azure DevOps, exposure to Azure DevOps, foundational knowledge of Azure DevOps, or understand core concepts of Azure DevOps.',
    'These are still unsupported claims.',
    'Honest denial is allowed: "I don\'t have direct Azure DevOps experience."',
    '',
    'SaaS capability:',
    '- Without explicit SaaS evidence, do not claim direct SaaS experience and do not rewrite it as "familiar with SaaS" or "SaaS knowledge".',
    '- You may introduce real transferable support / technical experience that IS supported.',
    '',
    'Other rules:',
    '- Answer in the same language as the question.',
    '- Write in first person, ready to send or lightly edit.',
    '- Be specific to this company and this role, using only supported facts.',
    '- If the source does not support a claim, say so briefly and answer with what IS supported.',
    '- Typical length: 80–180 words unless the question asks otherwise.',
    '- Do NOT invent employers, job titles, dates, technologies, metrics, or experience.',
    '',
    'Return JSON only:',
    '{ "answer": "..." }',
    '',
    `## Job`,
    `Company: ${company || '(unknown)'}`,
    `Title: ${jobTitle || '(unknown)'}`,
    '',
    '## ORIGINAL CV (primary evidence)',
    originalCvMd || '(none)',
    '',
    '## Candidate profile (primary evidence)',
    profileMd || '(none)',
    '',
    '## Verified application notes / evidence matrix',
    formatVerifiedNotes(changeSummary),
    '',
    '## Tailored resume (context only — not the sole source of new facts)',
    resumeMd || '(none)',
    '',
    '## Cover letter (context only — not the sole source of new facts)',
    coverMd || '(none)',
    '',
    '## Job description (employer requirements only — not candidate evidence)',
    jd || '(none)',
    '',
    '## Previous Q&A',
    formatHistory(thread),
    '',
    '## Question to answer',
    question,
  ].join('\n');
}

function extractAnswer(raw) {
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (raw && typeof raw === 'object') {
    if (typeof raw.answer === 'string' && raw.answer.trim()) return raw.answer.trim();
    if (typeof raw.text === 'string' && raw.text.trim()) return raw.text.trim();
  }
  const err = new Error('模型没有返回可用的回答。');
  err.statusCode = 502;
  throw err;
}

function readProfileMd(profilePath = PROFILE_MD) {
  try {
    return fs.readFileSync(profilePath, 'utf8');
  } catch {
    return '';
  }
}

function readOriginalCvMd(cvPath = CV_MD) {
  try {
    return fs.readFileSync(cvPath, 'utf8');
  } catch {
    return '';
  }
}

async function answerJobQuestion({
  company,
  jobTitle,
  jd,
  resumeMd,
  coverMd,
  profileMd,
  originalCvMd,
  changeSummary,
  qaThread,
  question,
} = {}, { llm = callLLM } = {}) {
  const normalized = normalizeQuestion(question);
  if (!normalized) {
    const err = new Error('question is required');
    err.statusCode = 400;
    throw err;
  }
  if (!String(jd || '').trim()) {
    const err = new Error('没有职位描述，无法回答岗位问题。');
    err.statusCode = 400;
    throw err;
  }

  const thread = parseQaThread(typeof qaThread === 'string' ? qaThread : JSON.stringify(qaThread || []));
  const prompt = buildQaPrompt({
    company,
    jobTitle,
    jd,
    resumeMd,
    coverMd,
    profileMd: profileMd ?? readProfileMd(),
    originalCvMd: originalCvMd ?? readOriginalCvMd(),
    changeSummary,
    thread,
    question: normalized,
  });
  const raw = await llm(prompt, { responseSchema: QA_RESPONSE_JSON_SCHEMA });
  const answer = extractAnswer(raw);
  const now = new Date().toISOString();
  return {
    answer,
    qa_thread: [
      ...thread,
      { role: 'user', content: normalized, created_at: now },
      { role: 'assistant', content: answer, created_at: now },
    ],
  };
}

module.exports = {
  parseQaThread,
  normalizeQuestion,
  buildQaPrompt,
  extractAnswer,
  answerJobQuestion,
  readProfileMd,
  readOriginalCvMd,
  formatLlmError,
  QA_RESPONSE_JSON_SCHEMA,
  MAX_QUESTION_CHARS,
};
