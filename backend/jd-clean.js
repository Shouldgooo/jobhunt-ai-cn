'use strict';

/**
 * Conservative cleaner for Gemini only.
 * Stores/displays still use the original pasted JD.
 * Prefer leaving harmless noise over dropping requirements.
 */

const EXACT_CHROME = new Set([
  'svg',
  'view all jobs',
  'salary match',
  'report this job',
  'report this job advert',
  'be careful',
  'easy apply',
  'sign in',
  'log in',
  'register',
  'save',
  'share',
  'follow',
  'similar jobs',
  'skip to',
  'cookie',
  'privacy',
  'terms',
  'home',
  'jobs',
  'search',
  'back to search',
  'be an early applicant',
  'actively reviewing',
  'see more',
  'show more',
  'company profile',
  'posted date',
  'people hired',
  'see who',
  'apply',
  'apply now',
  'job details',
  'company reviews',
  'see more jobs',
  'report job',
]);

const RATING_RE = /^\d(?:\.\d)?(?:\s*[·•|,]\s*\d[\d,]*\s*reviews?)?$/i;
const URL_LINE_RE = /^(https?:\/\/\S+|www\.\S+)$/i;
const POSTED_RE = /^posted\s+\d+\s*[hdwm](?:\s+ago)?$/i;
const AGO_APPLICANTS_RE = /^(?:\d+\s+(?:day|days|hour|hours|week|weeks)\s+ago)(?:\s*[·•|,]\s*\d[\d,]*\s*applicants)?$/i;
const APPLICANTS_ONLY_RE = /^\d[\d,]*\s+applicants$/i;
const SECURITY_RE = /don'?t provide your bank|beware of scams|job scams|never send money/i;

function isChromeLine(line) {
  const t = String(line || '').trim();
  if (!t) return false;
  if (/^svg$/i.test(t)) return true;
  if (EXACT_CHROME.has(t.toLowerCase())) return true;
  if (RATING_RE.test(t)) return true;
  if (URL_LINE_RE.test(t)) return true;
  if (POSTED_RE.test(t)) return true;
  if (AGO_APPLICANTS_RE.test(t)) return true;
  if (APPLICANTS_ONLY_RE.test(t)) return true;
  if (/^be careful\b/i.test(t)) return true;
  if (/report this job/i.test(t)) return true;
  if (SECURITY_RE.test(t)) return true;
  if (/^see who\b/i.test(t) && /easy apply/i.test(t)) return true;
  return false;
}

function stripMarkdownUrls(text) {
  return String(text || '').replace(/\[([^\]]+)\]\((?:https?:\/\/|mailto:)[^)]+\)/gi, '$1');
}

function dropDuplicateParagraphs(text) {
  const parts = text.split(/\n{2,}/);
  const seen = new Set();
  const kept = [];
  for (const part of parts) {
    const key = part.trim().toLowerCase().replace(/\s+/g, ' ');
    if (key.length >= 40 && seen.has(key)) continue;
    if (key.length >= 40) seen.add(key);
    kept.push(part);
  }
  return kept.join('\n\n');
}

function cleanJobDescriptionForAI(rawJD) {
  const src = stripMarkdownUrls(String(rawJD || '')).replace(/\r\n/g, '\n');
  const out = [];
  let blank = 0;
  for (const raw of src.split('\n')) {
    const trimmed = raw.trim();
    if (!trimmed) {
      blank += 1;
      if (blank === 1 && out.length) out.push('');
      continue;
    }
    blank = 0;
    if (isChromeLine(trimmed)) continue;
    if (out.length && out[out.length - 1].trim() === trimmed) continue;
    out.push(raw.replace(/\s+$/, ''));
  }
  return dropDuplicateParagraphs(out.join('\n')).replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = {
  cleanJobDescriptionForAI,
  isChromeLine,
};
