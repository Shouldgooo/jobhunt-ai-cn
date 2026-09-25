'use strict';

/**
 * Deterministic JD metadata extraction. No network / no LLM.
 * Keep in sync with frontend/src/lib/parse-jd.ts
 */

function clean(value) {
  return String(value || '')
    .replace(/[#*_`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchLabeled(text, patterns) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    for (const re of patterns) {
      const m = trimmed.match(re);
      if (m && clean(m[1])) return clean(m[1]);
    }
  }
  return '';
}

const TITLE_LABELS = [
  /^(?:job\s*title|title|position|role)\s*[:：]\s*(.+)$/i,
];
const COMPANY_LABELS = [
  /^(?:company|employer|organisation|organization)\s*[:：]\s*(.+)$/i,
];
const LOCATION_LABELS = [
  /^(?:location|based\s*in|work\s*location)\s*[:：]\s*(.+)$/i,
];

function headingTitle(text) {
  const m = String(text || '').replace(/\r\n/g, '\n').match(/^\s{0,3}#{1,3}\s+(.+)$/m);
  return m ? clean(m[1]) : '';
}

function parseJd(text) {
  const source = typeof text === 'string' ? text : '';
  if (!source.trim()) {
    return { job_title: '', company: '', location: '' };
  }

  const job_title = matchLabeled(source, TITLE_LABELS) || headingTitle(source);
  const company   = matchLabeled(source, COMPANY_LABELS);
  const location  = matchLabeled(source, LOCATION_LABELS);

  return { job_title, company, location };
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function mergeJobMeta(userHints = {}, parsed = {}, gemini = {}) {
  return {
    job_title: firstNonEmpty(userHints.job_title, parsed.job_title, gemini.job_title, gemini.title),
    company:   firstNonEmpty(userHints.company, parsed.company, gemini.company),
    location:  firstNonEmpty(userHints.location, parsed.location, gemini.location),
  };
}

module.exports = { parseJd, mergeJobMeta, firstNonEmpty };
