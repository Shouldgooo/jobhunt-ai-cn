'use strict';

const fs   = require('fs');
const path = require('path');
const axios = require('axios');

const CV_MD       = path.join(__dirname, '../user/cv.md');
const PROFILE_MD  = path.join(__dirname, '../user/profile.md');
const TAILOR_MD   = path.join(__dirname, '../prompts/tailor.md');
const PROMPTS_JSON = path.join(__dirname, '../user/prompts.json');

function geminiModel() {
  return process.env.GEMINI_MODEL || 'gemini-3.6-flash';
}

const TRANSIENT_OVERLOAD_STATUSES = new Set([500, 502, 503, 504]);
const MAX_GEMINI_RETRIES = 3;
const GEMINI_RETRY_DELAYS_MS = [2000, 4000, 8000];
const MAX_QUOTA_AUTORETRY = 1;
const MAX_QUOTA_WAIT_MS = 60_000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Parse Gemini RetryInfo.retryDelay ("36s", "36.884s") into milliseconds. */
function parseGeminiRetryDelayMs(retryDelay) {
  if (retryDelay == null) return null;
  if (typeof retryDelay === 'number' && Number.isFinite(retryDelay)) {
    return Math.max(0, Math.round(retryDelay));
  }
  if (typeof retryDelay !== 'string') return null;
  const m = retryDelay.trim().match(/^(\d+(?:\.\d+)?)s$/i);
  if (!m) return null;
  return Math.max(0, Math.round(parseFloat(m[1]) * 1000));
}

function extractGeminiErrorInfo(err) {
  const httpStatus = err?.response?.status ?? null;
  const geminiError = err?.response?.data?.error ?? {};
  const details = Array.isArray(geminiError.details) ? geminiError.details : [];
  const retryInfo = details.find(d =>
    (typeof d?.['@type'] === 'string' && d['@type'].endsWith('RetryInfo')) ||
    d?.retryDelay != null
  );
  let retryDelayMs = parseGeminiRetryDelayMs(retryInfo?.retryDelay);
  if (retryDelayMs == null && typeof geminiError.message === 'string') {
    const m = geminiError.message.match(/retry in (\d+(?:\.\d+)?)\s*s/i);
    if (m) retryDelayMs = Math.max(0, Math.round(parseFloat(m[1]) * 1000));
  }
  return {
    httpStatus,
    code: geminiError.code ?? null,
    status: geminiError.status ?? null,
    message: typeof geminiError.message === 'string' ? geminiError.message : null,
    retryDelayMs,
  };
}

function formatRetrySeconds(retryDelayMs) {
  if (retryDelayMs == null) return null;
  const sec = retryDelayMs / 1000;
  if (sec <= 10) return Math.max(1, Math.ceil(sec));
  return Math.ceil(sec / 10) * 10;
}

function logGeminiDecision(info, { attempt, delayMs, action }) {
  const parts = [`[gemini] HTTP ${info.httpStatus ?? 'n/a'}`];
  if (info.status) parts.push(`status=${info.status}`);
  if (info.code != null) parts.push(`code=${info.code}`);
  parts.push(`attempt ${attempt}`);
  if (info.retryDelayMs != null) parts.push(`retryDelay=${info.retryDelayMs}ms`);
  if (action === 'retry' && delayMs != null) parts.push(`retry in ${delayMs}ms`);
  else parts.push(action === 'retry' ? 'retry' : 'not retrying');
  console.warn(parts.join(' '));
}

function llmUserError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function formatLlmError(err) {
  if (err && err.statusCode && err.message) return err;
  const info   = extractGeminiErrorInfo(err);
  const status = info.httpStatus;
  const model  = geminiModel();
  if (status === 429) {
    const secs = formatRetrySeconds(info.retryDelayMs);
    return llmUserError(
      secs
        ? `Gemini API 请求额度已达到限制，请约 ${secs} 秒后重试。`
        : 'Gemini API 请求额度已达到限制，请稍后重试。',
      429
    );
  }
  if (status === 503) {
    return llmUserError('Gemini 服务暂时繁忙，请稍后重试。', 503);
  }
  if (status === 404) {
    return llmUserError(
      `Gemini model "${model}" is not available (404)${info.message ? ': ' + info.message : ''}. Set GEMINI_MODEL in backend/.env to a model your API key can use.`,
      404
    );
  }
  if (info.message) return llmUserError(`Gemini API error (${status}): ${info.message}`, status && status >= 400 ? status : 500);
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * Retry Gemini errors:
 * - 503/500/502/504: exponential backoff 2s/4s/8s, max 3 retries
 * - 429: at most one retry, and only if RetryInfo.retryDelay is present and ≤ 60s
 * - 400/401/403/404: fail immediately
 * Final errors always go through formatLlmError (never a generic "unavailable" message).
 */
async function requestGeminiWithRetry(requestFn, { sleep: sleepFn = sleep } = {}) {
  let lastErr;
  let overloadRetries = 0;
  let quotaRetries = 0;

  for (let attempt = 1; ; attempt++) {
    try {
      return await requestFn();
    } catch (err) {
      lastErr = err;
      const info = extractGeminiErrorInfo(err);
      const status = info.httpStatus;

      if (status === 429) {
        const delayMs = info.retryDelayMs;
        const shouldRetry =
          quotaRetries < MAX_QUOTA_AUTORETRY &&
          delayMs != null &&
          delayMs <= MAX_QUOTA_WAIT_MS;
        logGeminiDecision(info, {
          attempt,
          delayMs: shouldRetry ? delayMs : null,
          action: shouldRetry ? 'retry' : 'stop',
        });
        if (!shouldRetry) break;
        quotaRetries += 1;
        await sleepFn(delayMs);
        continue;
      }

      if (TRANSIENT_OVERLOAD_STATUSES.has(status) && overloadRetries < MAX_GEMINI_RETRIES) {
        const delayMs = GEMINI_RETRY_DELAYS_MS[overloadRetries];
        logGeminiDecision(info, { attempt, delayMs, action: 'retry' });
        overloadRetries += 1;
        await sleepFn(delayMs);
        continue;
      }

      if (TRANSIENT_OVERLOAD_STATUSES.has(status)) {
        logGeminiDecision(info, { attempt, delayMs: null, action: 'stop' });
      }
      break;
    }
  }
  throw formatLlmError(lastErr);
}

function createGeminiCallTracker() {
  return { logicalCalls: 0, httpAttempts: 0 };
}

function parseLlmJson(text) {
  const raw = String(text ?? '').trim();
  const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(stripped);
  } catch {
    throw llmUserError('Gemini 返回了无法解析的 JSON，未保存申请。请重试。', 502);
  }
}

async function callLLM(prompt, { tracker } = {}) {
  const provider = (process.env.LLM_PROVIDER || 'gemini').toLowerCase();

  if (provider === 'ollama') {
    if (tracker) {
      tracker.httpAttempts += 1;
      console.log(`[gemini] generateContent call #${tracker.httpAttempts}`);
    }
    const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const model   = process.env.OLLAMA_MODEL    || 'gemma3:12b';
    const timeout = parseInt(process.env.LLM_TIMEOUT_MS || '120000', 10);
    const res = await axios.post(
      `${baseUrl}/api/generate`,
      { model, prompt, format: 'json', stream: false },
      { timeout }
    );
    return parseLlmJson(res.data.response);
  }

  // default: gemini — 503/5xx backoff; 429 respects RetryInfo (at most one wait); no 400/401/403/404 retry
  return requestGeminiWithRetry(async () => {
    if (tracker) {
      tracker.httpAttempts += 1;
      console.log(`[gemini] generateContent call #${tracker.httpAttempts}`);
    }
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Gemini request timed out after 60s')), 60000)
    );
    const res = await Promise.race([
      axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel()}:generateContent`,
        {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { response_mime_type: 'application/json' },
        },
        { headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY } }
      ),
      timeoutPromise,
    ]);
    return parseLlmJson(res.data.candidates[0].content.parts[0].text);
  });
}

function logGenerationStart() {
  console.log('[gemini] application generation started');
}

function logGenerationDone(tracker) {
  console.log('[gemini] application generation completed');
  console.log(`[gemini] total generateContent calls: ${tracker.logicalCalls}`);
  if (tracker.httpAttempts > tracker.logicalCalls) {
    console.log(`[gemini] logical generation request: ${tracker.logicalCalls}`);
    console.log(`[gemini] HTTP/API attempts: ${tracker.httpAttempts}`);
  }
}

function buildGenerationPrompt({ tailorTemplate, profileMd, cvMd, jd, hints, generateCoverLetter, coverTemplate }) {
  let prompt = tailorTemplate
    .replace('{{PROFILE}}', profileMd)
    .replace('{{CV}}', cvMd)
    .replace('{{JD}}', jd);

  prompt += [

    '',
    '## Extra JSON keys (same response — do not make a second call)',
    'Also include:',
    '- "company": company name from the JD (string, empty if unknown)',
    '- "location": job location from the JD (string, empty if unknown)',
    'Prefer these user-provided / locally parsed hints when they are non-empty:',
    `- job_title hint: ${hints.job_title || '(none)'}`,
    `- company hint: ${hints.company || '(none)'}`,
    `- location hint: ${hints.location || '(none)'}`,
  ].join('\n');

  if (generateCoverLetter && coverTemplate) {
    prompt += [

      '',
      '## Cover letter (same JSON response)',
      'Fill the cover-letter placeholders only. Do not rewrite surrounding template text.',
      'Set "cover_letter" to an object with string values for:',
      'company, job_title, why_company, matching_skills, specific_project, why_company_culture.',
      'You may instead set "cover_letter" to the complete filled markdown string.',
      '',
      'Cover letter template:',
      coverTemplate,
    ].join('\n');
  } else {
    prompt += '\n\nSet "cover_letter" to null.\n';
  }

  return prompt;
}

function normalizeGenerationResult(raw, { wantCoverLetter }) {
  if (!raw || typeof raw !== 'object') {
    throw llmUserError('Gemini 返回了无法解析的 JSON，未保存申请。请重试。', 502);
  }

  const job = raw.job && typeof raw.job === 'object' ? raw.job : {};
  const analysis = raw.analysis && typeof raw.analysis === 'object' ? raw.analysis : {};

  const markdown = typeof raw.tailored_resume_md === 'string'
    ? raw.tailored_resume_md
    : (typeof raw.resume === 'string' ? raw.resume : null);
  if (typeof markdown !== 'string') {
    throw llmUserError('Gemini 返回无效响应：缺少 tailored_resume_md。未保存申请。', 502);
  }

  const fitRaw = raw.fit_score ?? analysis.fit_score;
  if (typeof fitRaw !== 'number' || Number.isNaN(fitRaw)) {
    throw llmUserError('Gemini 返回无效响应：缺少 fit_score。未保存申请。', 502);
  }

  const skills = Array.isArray(raw.detected_skills)
    ? raw.detected_skills
    : (Array.isArray(analysis.keywords) ? analysis.keywords : null);
  if (!Array.isArray(skills)) {
    throw llmUserError('Gemini 返回无效响应：缺少 detected_skills。未保存申请。', 502);
  }

  let coverLetter = raw.cover_letter ?? raw.cover_letter_md ?? null;
  if (!wantCoverLetter) coverLetter = null;

  return {
    markdown,
    fit_score: Math.max(0, Math.min(100, fitRaw)),
    detected_skills: skills.filter(s => typeof s === 'string'),
    job_title: typeof (raw.job_title || job.title) === 'string' ? (raw.job_title || job.title) : '',
    company:   typeof (raw.company || job.company) === 'string' ? (raw.company || job.company) : '',
    location:  typeof (raw.location || job.location) === 'string' ? (raw.location || job.location) : '',
    archetype: typeof raw.archetype === 'string' ? raw.archetype : (typeof analysis.summary === 'string' ? '' : ''),
    cover_letter: coverLetter,
  };
}

async function generateApplication({
  jd,
  baseMd: externalBaseMd,
  generateCoverLetter = false,
  hints = {},
  coverTemplate: coverTemplateOverride,
} = {}, { callLLM: llm = callLLM, tracker = createGeminiCallTracker() } = {}) {
  const { fillTemplate } = require('./coverletter');

  const cvMd = externalBaseMd ?? (() => {
    if (!fs.existsSync(CV_MD)) throw new Error('Missing user CV: `user/cv.md` not found.');
    return fs.readFileSync(CV_MD, 'utf8');
  })();

  if (!fs.existsSync(TAILOR_MD)) throw new Error('Missing prompt template: `prompts/tailor.md` not found.');
  const profileMd = fs.existsSync(PROFILE_MD) ? fs.readFileSync(PROFILE_MD, 'utf8') : '';
  const tailorTemplate = fs.readFileSync(TAILOR_MD, 'utf8');

  const TEMPLATE_PATH = path.join(__dirname, '../user/cover-letter/template.md');
  const coverTemplate = typeof coverTemplateOverride === 'string'
    ? coverTemplateOverride
    : ((generateCoverLetter && fs.existsSync(TEMPLATE_PATH)) ? fs.readFileSync(TEMPLATE_PATH, 'utf8') : '');
  const coverAvailable = generateCoverLetter && Boolean(coverTemplate);

  const prompt = buildGenerationPrompt({
    tailorTemplate,
    profileMd,
    cvMd,
    jd,
    hints,
    generateCoverLetter: coverAvailable,
    coverTemplate,
  });

  logGenerationStart();
  tracker.logicalCalls += 1;
  const raw = await llm(prompt, { tracker });
  const result = normalizeGenerationResult(raw, { wantCoverLetter: coverAvailable });
  logGenerationDone(tracker);

  let cover_md = '';
  if (coverAvailable) {
    if (typeof result.cover_letter === 'string' && result.cover_letter.trim()) {
      cover_md = result.cover_letter;
    } else if (result.cover_letter && typeof result.cover_letter === 'object') {
      cover_md = fillTemplate(coverTemplate, result.cover_letter);
    } else {
      throw llmUserError('Gemini 未返回求职信内容。未保存申请。请重试。', 502);
    }
  }

  return {
    markdown:        result.markdown,
    fit_score:       result.fit_score,
    detected_skills: result.detected_skills,
    job_title:       result.job_title,
    company:         result.company,
    location:        result.location,
    archetype:       result.archetype,
    cover_md,
    cover_letter_available: generateCoverLetter ? coverAvailable : false,
    tracker,
  };
}

async function tailorResume({ jd, baseMd: externalBaseMd }) {
  const cvMd = externalBaseMd ?? (() => {
    if (!fs.existsSync(CV_MD)) throw new Error('Missing user CV: `user/cv.md` not found.');
    return fs.readFileSync(CV_MD, 'utf8');
  })();

  if (!fs.existsSync(TAILOR_MD)) throw new Error('Missing prompt template: `prompts/tailor.md` not found.');
  const profileMd = fs.existsSync(PROFILE_MD) ? fs.readFileSync(PROFILE_MD, 'utf8') : '';

  const prompt = fs.readFileSync(TAILOR_MD, 'utf8')
    .replace('{{PROFILE}}', profileMd)
    .replace('{{CV}}', cvMd)
    .replace('{{JD}}', jd);

  const result = await callLLM(prompt);

  if (typeof result.tailored_resume_md !== 'string') throw new Error('Gemini returned invalid response: expected string for `tailored_resume_md`');
  if (typeof result.fit_score !== 'number')           throw new Error('Gemini returned invalid response: expected number for `fit_score`');
  if (!Array.isArray(result.detected_skills))         throw new Error('Gemini returned invalid response: expected array for `detected_skills`');

  return {
    markdown:        result.tailored_resume_md,
    fit_score:       Math.max(0, Math.min(100, result.fit_score)),
    detected_skills: result.detected_skills,
    job_title:       typeof result.job_title === 'string' ? result.job_title : '',
    archetype:       typeof result.archetype === 'string' ? result.archetype : '',
  };
}

async function rescoreResume(jd) {
  const cvMd = fs.existsSync(CV_MD) ? fs.readFileSync(CV_MD, 'utf8') : '';
  const prompts = JSON.parse(fs.readFileSync(PROMPTS_JSON, 'utf8'));
  const prompt  = prompts.rescore
    .replace('{{CV}}', cvMd)
    .replace('{{JD}}', jd);

  const result = await callLLM(prompt);
  if (typeof result.fit_score !== 'number') throw new Error('Gemini returned invalid response: expected number for `fit_score`');
  return Math.max(0, Math.min(100, result.fit_score));
}

module.exports = {
  tailorResume,
  rescoreResume,
  generateApplication,
  normalizeGenerationResult,
  buildGenerationPrompt,
  parseLlmJson,
  createGeminiCallTracker,
  callLLM,
  formatLlmError,
  geminiModel,
  requestGeminiWithRetry,
  parseGeminiRetryDelayMs,
  extractGeminiErrorInfo,
  GEMINI_RETRY_DELAYS_MS,
  MAX_GEMINI_RETRIES,
  MAX_QUOTA_WAIT_MS,
  MAX_QUOTA_AUTORETRY,
};
