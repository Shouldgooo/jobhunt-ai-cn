'use strict';

const path = require('path');
const fs = require('fs');
const { callLLM, formatLlmError } = require('./tailor');

const PROFILE_MD = path.join(__dirname, '../user/profile.md');
const MAX_QUESTION_CHARS = 2000;
const MAX_HISTORY_MESSAGES = 8;

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

function buildQaPrompt({
  company = '',
  jobTitle = '',
  jd = '',
  resumeMd = '',
  coverMd = '',
  profileMd = '',
  thread = [],
  question = '',
} = {}) {
  return [
    'You help the candidate draft answers to employer follow-up questions about THIS job.',
    '',
    'Rules:',
    '- Answer in the same language as the question.',
    '- Write in first person, ready to send or lightly edit.',
    '- Be specific to this company, this role, and this candidate.',
    '- Use ONLY facts from the resume, cover letter, profile, and JD.',
    '- Do NOT invent employers, job titles, dates, technologies, metrics, or experience.',
    '- If the source does not support a claim, say so briefly and answer with what IS supported.',
    '- Typical length: 80–180 words unless the question asks otherwise.',
    '',
    'Return JSON only:',
    '{ "answer": "..." }',
    '',
    `## Job`,
    `Company: ${company || '(unknown)'}`,
    `Title: ${jobTitle || '(unknown)'}`,
    '',
    '## Job description',
    jd || '(none)',
    '',
    '## Candidate profile',
    profileMd || '(none)',
    '',
    '## Tailored resume',
    resumeMd || '(none)',
    '',
    '## Cover letter',
    coverMd || '(none)',
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

async function answerJobQuestion({
  company,
  jobTitle,
  jd,
  resumeMd,
  coverMd,
  profileMd,
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
    thread,
    question: normalized,
  });
  const raw = await llm(prompt);
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
  formatLlmError,
  MAX_QUESTION_CHARS,
};
