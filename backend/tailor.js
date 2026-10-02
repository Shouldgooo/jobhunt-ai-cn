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
const { CLIENT_DISCONNECTED, abortReasonText } = require('./generation-abort');
const USER_CANCELLED = 'USER_CANCELLED';
const GEMINI_THINKING_LEVEL = 'low';

const COVER_LETTER_OBJECT_SCHEMA = {
  type: 'object',
  properties: {
    company: { type: 'string' },
    job_title: { type: 'string' },
    why_company: { type: 'string' },
    matching_skills: { type: 'string' },
    specific_project: { type: 'string' },
    why_company_culture: { type: 'string' },
  },
  required: [
    'company',
    'job_title',
    'why_company',
    'matching_skills',
    'specific_project',
    'why_company_culture',
  ],
  additionalProperties: false,
};

/** JSON Schema for generateContent responseFormat.text.schema (official REST subset). */
const GENERATION_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    tailored_resume_md: { type: 'string' },
    detected_skills: { type: 'array', items: { type: 'string' } },
    fit_score: { type: 'number', minimum: 0, maximum: 100 },
    job_title: { type: 'string' },
    company: { type: 'string' },
    location: { type: 'string' },
    archetype: { type: 'string' },
    cover_letter: {
      anyOf: [
        { type: 'null' },
        { type: 'string' },
        COVER_LETTER_OBJECT_SCHEMA,
      ],
    },
  },
  required: [
    'tailored_resume_md',
    'detected_skills',
    'fit_score',
    'job_title',
    'company',
    'location',
    'archetype',
    'cover_letter',
  ],
  additionalProperties: false,
};

const GEMINI_GENERATION_CONFIG = {
  thinkingConfig: { thinkingLevel: GEMINI_THINKING_LEVEL },
  responseFormat: {
    text: {
      mimeType: 'APPLICATION_JSON',
      schema: GENERATION_RESPONSE_JSON_SCHEMA,
    },
  },
};

function cancelledError() {
  const err = llmUserError('生成已取消', 499);
  err.cancelled = true;
  err.code = USER_CANCELLED;
  return err;
}

function disconnectedError() {
  const err = llmUserError('连接已中断，生成未完成。', 499);
  err.disconnected = true;
  err.code = CLIENT_DISCONNECTED;
  return err;
}

function workAbortedError(signal) {
  const reason = signal?.reason;
  if (reason === USER_CANCELLED) return cancelledError();
  return disconnectedError();
}

function isCancelledError(err) {
  return Boolean(
    err?.cancelled
    || err?.disconnected
    || err?.code === 'ERR_CANCELED'
    || err?.code === USER_CANCELLED
    || err?.code === CLIENT_DISCONNECTED
    || err?.name === 'CanceledError'
    || err?.name === 'AbortError'
  );
}

function isUserCancelledError(err) {
  return Boolean(err?.cancelled || err?.code === USER_CANCELLED);
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw workAbortedError(signal);
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      try { throwIfAborted(signal); } catch (err) { reject(err); }
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      try { throwIfAborted(signal); } catch (err) { reject(err); }
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function redactSensitive(text) {
  if (typeof text !== 'string' || !text) return text;
  return text
    .replace(/AIza[0-9A-Za-z_-]{10,}/g, '[redacted]')
    .replace(/\bAQ\.[A-Za-z0-9_-]{10,}/g, '[redacted]')
    .replace(/([?&](?:key|api_key|apikey)=)[^&\s"'\\]+/gi, '$1[redacted]')
    .replace(/(Authorization:\s*)\S+/gi, '$1[redacted]')
    .replace(/(Bearer\s+)\S+/gi, '$1[redacted]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]');
}

function truncateForLog(text, max = 240) {
  if (typeof text !== 'string' || !text) return text;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Safely read axios error.response.data (object or JSON string). Never throws. */
function parseGeminiErrorPayload(data) {
  if (data == null) return {};
  if (typeof data === 'string') {
    const trimmed = data.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return {};
    try {
      const parsed = JSON.parse(trimmed);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  if (typeof data === 'object' && !Buffer.isBuffer(data)) return data;
  return {};
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
  const payload = parseGeminiErrorPayload(err?.response?.data);
  const geminiError = payload && typeof payload.error === 'object' && payload.error
    ? payload.error
    : {};
  const rawDetails = Array.isArray(geminiError.details) ? geminiError.details : [];
  const details = rawDetails.map((d) => {
    if (!d || typeof d !== 'object') return null;
    const type = typeof d['@type'] === 'string' ? d['@type'] : null;
    const reason = typeof d.reason === 'string' ? d.reason : null;
    const domain = typeof d.domain === 'string' ? d.domain : null;
    const retryDelay = d.retryDelay != null ? d.retryDelay : null;
    if (!type && !reason && !domain && retryDelay == null) return null;
    return { type, reason, domain, retryDelay };
  }).filter(Boolean);
  const retryInfo = details.find(d =>
    (typeof d?.type === 'string' && d.type.endsWith('RetryInfo')) ||
    d?.retryDelay != null
  );
  const rawMessage = typeof geminiError.message === 'string' ? geminiError.message : null;
  let retryDelayMs = parseGeminiRetryDelayMs(retryInfo?.retryDelay);
  if (retryDelayMs == null && rawMessage) {
    const m = rawMessage.match(/retry in (\d+(?:\.\d+)?)\s*s/i);
    if (m) retryDelayMs = Math.max(0, Math.round(parseFloat(m[1]) * 1000));
  }
  return {
    httpStatus,
    code: geminiError.code ?? null,
    status: typeof geminiError.status === 'string' ? geminiError.status : null,
    message: rawMessage ? redactSensitive(rawMessage) : null,
    details,
    retryDelayMs,
  };
}

function classifyGemini403(info) {
  if (info?.httpStatus !== 403) return null;
  const blob = [
    info.status,
    info.message,
    ...(info.details || []).flatMap(d => [d.type, d.reason, d.domain]),
  ].filter(Boolean).join(' ').toLowerCase();

  const apiDisabled = (
    /\bservice_disabled\b/.test(blob)
    || /has not been used/.test(blob)
    || /api has not been enabled/.test(blob)
    || /api is not enabled/.test(blob)
    || (/is disabled/.test(blob) && /\bapi\b/.test(blob))
    || /enable it by visiting/.test(blob)
  );
  if (apiDisabled) return 'api_disabled';

  const modelPermission = (
    /does not have permission to use (the )?(requested )?model/.test(blob)
    || /does not have access to (the )?(requested )?model/.test(blob)
    || /no permission to (access|use) (the )?(requested )?model/.test(blob)
    || /api key does not have permission to use the requested model/.test(blob)
  );
  if (modelPermission) return 'model_permission';

  if (info.status === 'PERMISSION_DENIED') return 'permission_denied';
  return 'unknown';
}

function formatRetrySeconds(retryDelayMs) {
  if (retryDelayMs == null) return null;
  const sec = retryDelayMs / 1000;
  if (sec <= 10) return Math.max(1, Math.ceil(sec));
  return Math.ceil(sec / 10) * 10;
}

function elapsedSince(startedAt) {
  return Date.now() - (startedAt || Date.now());
}

function logGeminiDecision(info, { attempt, delayMs, action }) {
  const parts = [`[gemini] HTTP ${info.httpStatus ?? 'n/a'}`];
  if (info.status) parts.push(`status=${info.status}`);
  if (info.code != null) parts.push(`code=${info.code}`);
  if (info.message) parts.push(`message=${truncateForLog(info.message)}`);
  if (Array.isArray(info.details) && info.details.length) {
    const summary = info.details.map((d) => [
      d.type && `@type=${d.type}`,
      d.reason && `reason=${d.reason}`,
      d.domain && `domain=${d.domain}`,
    ].filter(Boolean).join(' ')).filter(Boolean).join('; ');
    if (summary) parts.push(`details=${summary}`);
  }
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
  if (isCancelledError(err)) return cancelledError();
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
  if (status === 403) {
    const kind = classifyGemini403(info);
    if (kind === 'api_disabled') {
      return llmUserError('当前 Google Cloud 项目尚未启用 Gemini API。', 403);
    }
    if (kind === 'model_permission') {
      return llmUserError('当前 API Key / Google Cloud 项目没有访问该 Gemini 模型的权限。', 403);
    }
    if (kind === 'permission_denied') {
      return llmUserError('Gemini API 拒绝了当前请求，请检查 API Key、Google Cloud 项目权限或模型访问权限。', 403);
    }
    return llmUserError('Gemini API 拒绝了当前请求（403）。请检查 API Key、项目权限和模型访问权限。', 403);
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
async function requestGeminiWithRetry(requestFn, {
  sleep: sleepFn = sleep,
  signal,
  onRetry,
  startedAt = Date.now(),
} = {}) {
  let lastErr;
  let overloadRetries = 0;
  let quotaRetries = 0;

  for (let attempt = 1; ; attempt++) {
    throwIfAborted(signal);
    console.log(`[gemini] attempt ${attempt} started +${elapsedSince(startedAt)}ms`);
    try {
      const result = await requestFn();
      console.log(`[gemini] attempt ${attempt} completed +${elapsedSince(startedAt)}ms`);
      return result;
    } catch (err) {
      lastErr = err;
      if (signal?.aborted || isCancelledError(err)) {
        console.log(`[gemini] attempt ${attempt} cancelled +${elapsedSince(startedAt)}ms`);
        console.log(`[cancel] Gemini axios canceled reason=${abortReasonText(signal?.reason)}`);
        throw signal?.aborted ? workAbortedError(signal) : err;
      }
      const info = extractGeminiErrorInfo(err);
      const failCode = info.httpStatus ?? err?.code ?? 'n/a';
      console.log(`[gemini] attempt ${attempt} failed +${elapsedSince(startedAt)}ms status=${failCode}`);
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
        onRetry?.({ status: 429, attempt, delayMs, kind: 'quota' });
        await sleepFn(delayMs, signal);
        continue;
      }

      if (TRANSIENT_OVERLOAD_STATUSES.has(status) && overloadRetries < MAX_GEMINI_RETRIES) {
        const delayMs = GEMINI_RETRY_DELAYS_MS[overloadRetries];
        logGeminiDecision(info, { attempt, delayMs, action: 'retry' });
        onRetry?.({ status, attempt, delayMs, kind: 'busy' });
        overloadRetries += 1;
        await sleepFn(delayMs, signal);
        continue;
      }

      if (TRANSIENT_OVERLOAD_STATUSES.has(status) || status) {
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

const JSON_PARSE_ERROR = 'Gemini 返回了无法解析的 JSON，未保存申请。请重试。';
const JSON_TRUNCATED_ERROR = 'AI 返回内容不完整，本次申请未保存。请重新尝试。';
const JSON_SCHEMA_ERROR = 'AI 返回的数据结构不完整，本次申请未保存。请重新尝试。';

function previewForLog(text, n = 80) {
  const value = redactSensitive(String(text || ''));
  return {
    chars: value.length,
    head: value.slice(0, n),
    tail: value.length > n ? value.slice(-n) : value,
  };
}

function stripBom(text) {
  return String(text ?? '').replace(/^\uFEFF/, '');
}

function looksLikeTruncatedJson(text, finishReason) {
  const reason = String(finishReason || '').toUpperCase();
  if (reason === 'MAX_TOKENS' || reason === 'OTHER') return true;
  const s = String(text || '').trim();
  if (!s) return true;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (const ch of s) {
    if (inString) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
  }
  if (inString || escape || depth !== 0) return true;
  return /[:,\[{]$/.test(s);
}

function extractJsonCandidate(text) {
  let s = stripBom(text).trim();
  if (!s) return '';
  const wrapped = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (wrapped) s = wrapped[1].trim();
  else {
    const fenced = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced) s = fenced[1].trim();
  }
  if (!s) return '';
  try {
    JSON.parse(s);
    return s;
  } catch {
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start >= 0 && end > start) return s.slice(start, end + 1);
    return s;
  }
}

function collectGeminiText(data) {
  const cand = data?.candidates?.[0] || {};
  const finishReason = cand.finishReason || cand.finish_reason || '';
  const parts = Array.isArray(cand.content?.parts) ? cand.content.parts : [];
  const texts = [];
  let thoughtParts = 0;
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;
    if (part.thought === true) {
      thoughtParts += 1;
      continue;
    }
    if (typeof part.text === 'string') texts.push(part.text);
  }
  return {
    finishReason: String(finishReason),
    partCount: parts.length,
    thoughtParts,
    text: texts.join(''),
  };
}

function extractJsonParsePosition(err) {
  const msg = String(err?.message || '');
  const m = msg.match(/position\s+(\d+)/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function describeJsonParseError(err, candidateChars) {
  return {
    message: redactSensitive(String(err?.message || '')).slice(0, 200),
    position: extractJsonParsePosition(err),
    candidateChars: typeof candidateChars === 'number' ? candidateChars : null,
  };
}

function logGeminiJsonShape(collected, extra = {}) {
  const preview = previewForLog(collected.text);
  console.log(
    `[gemini] candidate finishReason=${collected.finishReason || 'n/a'} parts=${collected.partCount} thoughtParts=${collected.thoughtParts} textChars=${preview.chars}${extra.kind ? ` json=${extra.kind}` : ''}`
  );
  if (extra.failed) {
    const bits = [`[gemini] json ${extra.kind || 'parse-failed'}`];
    if (extra.jsonParse?.candidateChars != null) bits.push(`chars=${extra.jsonParse.candidateChars}`);
    if (extra.jsonParse?.message) bits.push(`error=${JSON.stringify(extra.jsonParse.message)}`);
    if (extra.jsonParse?.position != null) bits.push(`position=${extra.jsonParse.position}`);
    bits.push(`head=${JSON.stringify(preview.head)} tail=${JSON.stringify(preview.tail)}`);
    console.warn(bits.join(' '));
  }
}

function parseLlmJson(text, { finishReason } = {}) {
  const extracted = extractJsonCandidate(text);
  try {
    const parsed = JSON.parse(extracted);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw llmUserError(JSON_SCHEMA_ERROR, 502);
    }
    return parsed;
  } catch (err) {
    if (err && err.statusCode === 502) throw err;
    const truncated = looksLikeTruncatedJson(extracted || text, finishReason);
    const userErr = llmUserError(truncated ? JSON_TRUNCATED_ERROR : JSON_PARSE_ERROR, 502);
    userErr.jsonParse = describeJsonParseError(err, String(extracted || '').length);
    throw userErr;
  }
}

function buildGeminiGenerationConfig(responseSchema) {
  return {
    thinkingConfig: { thinkingLevel: GEMINI_THINKING_LEVEL },
    responseFormat: {
      text: {
        mimeType: 'APPLICATION_JSON',
        schema: responseSchema,
      },
    },
  };
}

function buildGeminiRequestBody(prompt, { responseSchema } = {}) {
  return {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: responseSchema
      ? buildGeminiGenerationConfig(responseSchema)
      : GEMINI_GENERATION_CONFIG,
  };
}

function logUsageMetadata(data) {
  const u = data?.usageMetadata || data?.usage_metadata;
  if (!u || typeof u !== 'object') return;
  const keys = [
    'promptTokenCount', 'candidatesTokenCount', 'thoughtsTokenCount', 'totalTokenCount',
    'prompt_token_count', 'candidates_token_count', 'thoughts_token_count', 'total_token_count',
  ];
  const parts = [];
  for (const key of keys) {
    if (typeof u[key] === 'number') parts.push(`${key}=${u[key]}`);
  }
  if (parts.length) console.log(`[gemini] usage ${parts.join(' ')}`);
}

async function callLLM(prompt, { tracker, signal, onRetry, startedAt, responseSchema } = {}) {
  throwIfAborted(signal);
  const provider = (process.env.LLM_PROVIDER || 'gemini').toLowerCase();

  if (provider === 'ollama') {
    if (tracker) {
      tracker.httpAttempts += 1;
      console.log(`[gemini] generateContent call #${tracker.httpAttempts}`);
    }
    const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const model   = process.env.OLLAMA_MODEL    || 'gemma3:12b';
    const timeout = process.env.LLM_TIMEOUT_MS
      ? parseInt(process.env.LLM_TIMEOUT_MS, 10)
      : 0;
    const res = await axios.post(
      `${baseUrl}/api/generate`,
      { model, prompt, format: 'json', stream: false },
      { timeout, signal }
    );
    throwIfAborted(signal);
    return parseLlmJson(res.data.response);
  }

  // default: gemini — AbortSignal cancels the in-flight axios HTTP request
  return requestGeminiWithRetry(async () => {
    throwIfAborted(signal);
    if (tracker) {
      tracker.httpAttempts += 1;
      console.log(`[gemini] generateContent call #${tracker.httpAttempts}`);
    }
    const body = buildGeminiRequestBody(prompt, { responseSchema });
    const res = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel()}:generateContent`,
      body,
      {
        headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY },
        timeout: 0,
        signal,
      }
    );
    throwIfAborted(signal);
    logUsageMetadata(res.data);
    const collected = collectGeminiText(res.data);
    logGeminiJsonShape(collected);
    if (!collected.text.trim()) {
      logGeminiJsonShape(collected, { failed: true, kind: 'empty' });
      throw llmUserError(JSON_TRUNCATED_ERROR, 502);
    }
    try {
      return parseLlmJson(collected.text, { finishReason: collected.finishReason });
    } catch (err) {
      logGeminiJsonShape(collected, {
        failed: true,
        kind: err.message.includes('不完整') ? 'truncated-or-incomplete' : 'parse',
        jsonParse: err.jsonParse,
      });
      throw err;
    }
  }, { signal, onRetry, startedAt });
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
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw llmUserError(JSON_SCHEMA_ERROR, 502);
  }

  const job = raw.job && typeof raw.job === 'object' ? raw.job : {};
  const analysis = raw.analysis && typeof raw.analysis === 'object' ? raw.analysis : {};

  const markdown = typeof raw.tailored_resume_md === 'string'
    ? raw.tailored_resume_md
    : (typeof raw.resume === 'string' ? raw.resume : null);
  if (typeof markdown !== 'string') {
    throw llmUserError(JSON_SCHEMA_ERROR, 502);
  }

  const fitRaw = raw.fit_score ?? analysis.fit_score;
  if (typeof fitRaw !== 'number' || Number.isNaN(fitRaw)) {
    throw llmUserError(JSON_SCHEMA_ERROR, 502);
  }

  const skills = Array.isArray(raw.detected_skills)
    ? raw.detected_skills
    : (Array.isArray(analysis.keywords) ? analysis.keywords : null);
  if (!Array.isArray(skills)) {
    throw llmUserError(JSON_SCHEMA_ERROR, 502);
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
} = {}, { callLLM: llm = callLLM, tracker = createGeminiCallTracker(), signal, onProgress, startedAt = Date.now() } = {}) {
  try {
    return await runGenerateApplication({
      jd,
      externalBaseMd,
      generateCoverLetter,
      hints,
      coverTemplateOverride,
      llm,
      tracker,
      onProgress,
      startedAt,
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw workAbortedError(signal);
    throw err;
  }
}

async function runGenerateApplication({
  jd,
  externalBaseMd,
  generateCoverLetter,
  hints,
  coverTemplateOverride,
  llm,
  tracker,
  onProgress,
  startedAt,
  signal,
}) {
  const { fillTemplate } = require('./coverletter');
  const { cleanJobDescriptionForAI } = require('./jd-clean');

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

  throwIfAborted(signal);
  onProgress?.({ type: 'progress', stage: 'preparing', progress: 30, message: '正在准备生成内容…' });

  const cleanedJd = cleanJobDescriptionForAI(jd);
  const prompt = buildGenerationPrompt({
    tailorTemplate,
    profileMd,
    cvMd,
    jd: cleanedJd,
    hints,
    generateCoverLetter: coverAvailable,
    coverTemplate,
  });
  const requestBody = buildGeminiRequestBody(prompt);
  console.log(`[generation] prompt prepared +${elapsedSince(startedAt)}ms chars=${prompt.length}`);
  console.log(`[gemini] model=${geminiModel()}`);
  console.log(`[gemini] rawJdChars=${String(jd || '').length}`);
  console.log(`[gemini] cleanedJdChars=${cleanedJd.length}`);
  console.log(`[gemini] promptChars=${prompt.length}`);
  console.log(`[gemini] requestBytes=${Buffer.byteLength(JSON.stringify(requestBody))}`);
  console.log(`[gemini] thinkingLevel=${GEMINI_THINKING_LEVEL}`);

  throwIfAborted(signal);
  onProgress?.({ type: 'progress', stage: 'sending', progress: 35, message: '正在连接 Gemini…' });
  onProgress?.({ type: 'progress', stage: 'generating', progress: 35, message: 'AI 正在分析 JD 并生成定制简历…' });

  logGenerationStart();
  tracker.logicalCalls += 1;
  const raw = await llm(prompt, {
    tracker,
    signal,
    startedAt,
    onRetry: (info) => {
      const n = info.attempt;
      const message = info.kind === 'quota'
        ? `Gemini API 额度紧张，正在等待后重试（${n}）…`
        : `Gemini 暂时繁忙，正在重试（${n}/3）…`;
      onProgress?.({ type: 'progress', stage: 'retrying', progress: 35, message });
    },
  });
  throwIfAborted(signal);
  onProgress?.({ type: 'progress', stage: 'received', progress: 85, message: '正在处理 AI 返回结果…' });
  const result = normalizeGenerationResult(raw, { wantCoverLetter: coverAvailable });
  onProgress?.({ type: 'progress', stage: 'validating_result', progress: 90, message: '正在校验生成结果…' });
  logGenerationDone(tracker);

  let cover_md = '';
  if (coverAvailable) {
    if (typeof result.cover_letter === 'string' && result.cover_letter.trim()) {
      cover_md = result.cover_letter;
    } else if (result.cover_letter && typeof result.cover_letter === 'object') {
      cover_md = fillTemplate(coverTemplate, result.cover_letter);
    } else {
      throw llmUserError(JSON_SCHEMA_ERROR, 502);
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
    rawJdChars: String(jd || '').length,
    cleanedJdChars: cleanedJd.length,
    cleanedJd,
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
  collectGeminiText,
  extractJsonCandidate,
  looksLikeTruncatedJson,
  JSON_PARSE_ERROR,
  JSON_TRUNCATED_ERROR,
  JSON_SCHEMA_ERROR,
  createGeminiCallTracker,
  callLLM,
  formatLlmError,
  cancelledError,
  disconnectedError,
  workAbortedError,
  isCancelledError,
  isUserCancelledError,
  throwIfAborted,
  buildGeminiRequestBody,
  GEMINI_GENERATION_CONFIG,
  GENERATION_RESPONSE_JSON_SCHEMA,
  GEMINI_THINKING_LEVEL,
  USER_CANCELLED,
  geminiModel,
  requestGeminiWithRetry,
  parseGeminiRetryDelayMs,
  extractGeminiErrorInfo,
  redactSensitive,
  classifyGemini403,
  GEMINI_RETRY_DELAYS_MS,
  MAX_GEMINI_RETRIES,
  MAX_QUOTA_WAIT_MS,
  MAX_QUOTA_AUTORETRY,
};
