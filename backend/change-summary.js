'use strict';

/**
 * Deterministic original→generated document comparison.
 * Never invents resume/cover-letter changes. No LLM calls.
 */

const STOP = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'was', 'were', 'are', 'is',
  'to', 'of', 'in', 'on', 'at', 'a', 'an', 'or', 'as', 'by', 'be', 'it', 'we',
  'our', 'you', 'your', 'their', 'they', 'i', 'my', 'me', 'have', 'has', 'had',
  'will', 'can', 'using', 'used', 'use', 'into', 'over', 'than', 'then',
]);

const UNAVAILABLE = '暂时无法生成可靠的改动概要。';
const EMPTY_MSG = '未检测到可验证的实质性改动。';

function norm(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitFrontMatter(md) {
  const raw = String(md || '');
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { front: '', body: raw };
  return { front: m[1], body: m[2] };
}

function parseSections(md) {
  const { front, body } = splitFrontMatter(md);
  const sections = [];
  if (norm(front)) sections.push({ section: 'Header', body: front });
  let name = 'Body';
  let buf = [];
  const flush = () => {
    const text = buf.join('\n').replace(/\n+$/, '');
    if (name !== 'Body' || norm(text)) sections.push({ section: name, body: text });
    buf = [];
  };
  for (const line of String(body || '').split('\n')) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      flush();
      name = heading[1].trim() || 'Section';
      continue;
    }
    buf.push(line);
  }
  flush();
  return sections;
}

function tokenize(text) {
  return String(text || '')
    .split(/[^A-Za-z0-9.+#/-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

function hasTerm(haystack, term) {
  if (!haystack || !term || term.length < 2) return false;
  const escaped = String(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^A-Za-z0-9])${escaped}(?:[^A-Za-z0-9]|$)`, 'i').test(haystack);
}

function unique(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const key = String(item).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function newTerms(before, after) {
  const prior = new Set(tokenize(before).map((t) => t.toLowerCase()));
  return unique(tokenize(after).filter((t) => !prior.has(t.toLowerCase())));
}

function jdKeywordsForChange(before, after, jd) {
  if (!jd) return [];
  const terms = newTerms(before, after);
  return unique(terms.filter((t) => t.length >= 2 && hasTerm(jd, t)));
}

function isSkillLike(term) {
  if (!term || term.length < 2 || term.length > 40) return false;
  if (STOP.has(term.toLowerCase())) return false;
  return /[A-Z]/.test(term) || /[.#+/]/.test(term) || /[A-Za-z][0-9]|[0-9][A-Za-z]/.test(term);
}

function findUnsupported({ originalResume, profileMd, addedTerms }) {
  const support = `${originalResume || ''}\n${profileMd || ''}`;
  const flagged = [];
  for (const term of addedTerms) {
    if (!isSkillLike(term)) continue;
    if (hasTerm(support, term)) continue;
    flagged.push(term);
  }
  return unique(flagged);
}

function compareResume(originalResume, generatedResume, jd) {
  const beforeMap = new Map();
  for (const sec of parseSections(originalResume)) {
    beforeMap.set(sec.section.toLowerCase(), sec);
  }
  const afterMap = new Map();
  for (const sec of parseSections(generatedResume)) {
    afterMap.set(sec.section.toLowerCase(), sec);
  }
  const names = unique([
    ...[...beforeMap.values()].map((s) => s.section),
    ...[...afterMap.values()].map((s) => s.section),
  ]);

  const changes = [];
  const addedTerms = [];
  for (const displayName of names) {
    const beforeSec = beforeMap.get(displayName.toLowerCase());
    const afterSec = afterMap.get(displayName.toLowerCase());
    const before = beforeSec ? beforeSec.body : '';
    const after = afterSec ? afterSec.body : '';
    if (norm(before) === norm(after)) continue;

    let type = 'modified';
    if (!norm(before) && norm(after)) type = 'added';
    if (norm(before) && !norm(after)) type = 'removed';

    const section = (afterSec || beforeSec).section;
    const jd_keywords = jdKeywordsForChange(before, after, jd);
    addedTerms.push(...newTerms(before, after));
    changes.push({
      section,
      type,
      before,
      after,
      jd_keywords,
      verified: true,
    });
  }
  return { changes, addedTerms: unique(addedTerms) };
}

function coverLetterHighlights(coverLetter, jd) {
  const text = String(coverLetter || '').trim();
  if (!text) return { items: [] };
  const chunks = text
    .split(/\n{2,}|(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 12 && !s.startsWith('#'));
  const items = [];
  for (const chunk of chunks) {
    const hits = unique(tokenize(chunk).filter((t) => t.length >= 2 && hasTerm(jd, t)));
    if (!hits.length) continue;
    items.push({ text: chunk, jd_keywords: hits, verified: true });
  }
  return { items };
}

const EXP_NAME = /^(work\s+)?experience|employment|professional experience$/i;
const PROJ_NAME = /^projects?$/i;
const EXPERIENCE_WARNING = '需要确认：该工作经历中的新增内容可能缺少原始资料支持。';

function sectionBody(md, matcher) {
  const hit = parseSections(md).find((s) => matcher.test(s.section));
  return hit ? hit.body : '';
}

function extractBoldTitles(text) {
  return unique([...String(text || '').matchAll(/\*\*([^*]+)\*\*/g)].map((m) => m[1].trim()).filter(Boolean));
}

function extractDateTokens(text) {
  const re = /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}|\d{4}\s*[–—-]\s*(?:Present|\d{4})|\b(?:19|20)\d{2}\b/gi;
  return unique((String(text || '').match(re) || []).map((s) => s.replace(/\s+/g, ' ')));
}

function extractEmployerLines(expText) {
  const out = [];
  for (const raw of String(expText || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (/^[-*~]/.test(line) || /^\*\*/.test(line)) continue;
    if (/^stack:/i.test(line)) continue;
    if (line.includes('.') && line.split(/\s+/).length > 8) continue;
    if (line.length < 2 || line.length > 80) continue;
    out.push(line);
  }
  return unique(out);
}

function extractProjectNames(md) {
  return extractBoldTitles(sectionBody(md, PROJ_NAME))
    .map((t) => t.split(/[—-]/)[0].trim())
    .filter(Boolean);
}

function titleAllowed(generatedTitle, originalTitles, support) {
  const g = String(generatedTitle || '').trim();
  if (!g) return true;
  if (originalTitles.some((t) => t.toLowerCase() === g.toLowerCase())) return true;
  if (hasTerm(support, g)) return true;
  const parts = g.split('|').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 2 && originalTitles.some((t) => t.toLowerCase() === parts[0].toLowerCase())) {
    const focusTerms = tokenize(parts[1]).filter(isSkillLike);
    return focusTerms.length === 0 || focusTerms.every((tok) => hasTerm(support, tok));
  }
  return false;
}

function extractMetrics(text) {
  return unique((String(text || '').match(/\d+(?:\.\d+)?%|\$\d[\d,]*(?:\.\d+)?|\b\d{2,}\b/g) || []));
}

function validateWorkExperience({ originalResume = '', generatedResume = '', profileMd = '' } = {}) {
  const originalExp = sectionBody(originalResume, EXP_NAME);
  const generatedExp = sectionBody(generatedResume, EXP_NAME);
  if (!norm(generatedExp)) return [];

  const support = `${originalResume || ''}\n${profileMd || ''}\n${originalExp}`;
  const flags = [];
  const originalTitles = extractBoldTitles(originalExp);
  const originalEmployers = new Set(extractEmployerLines(originalExp).map((e) => e.toLowerCase()));
  const originalDates = new Set(extractDateTokens(`${originalExp}\n${originalResume}`).map((d) => d.toLowerCase()));
  const originalMetrics = new Set(extractMetrics(originalExp).map((m) => m.toLowerCase()));
  const projectNames = extractProjectNames(originalResume);

  for (const employer of extractEmployerLines(generatedExp)) {
    if (!originalEmployers.has(employer.toLowerCase()) && !hasTerm(support, employer)) {
      flags.push({ kind: 'employer', text: employer });
    }
  }

  for (const date of extractDateTokens(generatedExp)) {
    if (!originalDates.has(date.toLowerCase()) && !hasTerm(support, date)) {
      flags.push({ kind: 'date', text: date });
    }
  }

  for (const title of extractBoldTitles(generatedExp)) {
    if (!titleAllowed(title, originalTitles, support)) {
      flags.push({ kind: 'title', text: title });
    }
  }

  for (const term of newTerms(originalExp, generatedExp)) {
    if (!isSkillLike(term)) continue;
    if (hasTerm(support, term)) continue;
    flags.push({ kind: 'technology', text: term });
  }

  for (const metric of extractMetrics(generatedExp)) {
    if (!originalMetrics.has(metric.toLowerCase()) && !hasTerm(originalResume, metric)) {
      flags.push({ kind: 'metric', text: metric });
    }
  }

  for (const name of projectNames) {
    const inOrigExp = hasTerm(originalExp, name);
    const inGenExp = hasTerm(generatedExp, name);
    const asEmployer = extractEmployerLines(generatedExp).some((e) => e.toLowerCase() === name.toLowerCase());
    if (!inOrigExp && inGenExp && asEmployer) {
      flags.push({ kind: 'project_as_job', text: name });
    }
  }

  return unique(flags.map((f) => `${f.kind}:${f.text}`)).map((key) => {
    const [kind, ...rest] = key.split(':');
    return { kind, text: rest.join(':') };
  });
}

function emptyResult(status, message) {
  return {
    status,
    message,
    resume_changes: [],
    cover_letter: { items: [] },
    unsupported: [],
    unsupported_experience: [],
  };
}

function buildChangeSummary({
  originalResume = '',
  generatedResume = '',
  coverLetter = '',
  jd = '',
  profileMd = '',
  claimedChanges = [],
} = {}) {
  const { changes, addedTerms } = compareResume(originalResume, generatedResume, jd);
  const cover = coverLetterHighlights(coverLetter, jd);
  const unsupportedTerms = findUnsupported({
    originalResume,
    profileMd,
    addedTerms,
  });
  const unsupported = unsupportedTerms.map((term) => {
    const hit = changes.find((c) => hasTerm(c.after, term));
    return {
      text: term,
      section: hit ? hit.section : '',
      excerpt: hit ? hit.after : '',
    };
  });

  // Provider-claimed blurbs are never a source of truth.
  void claimedChanges;

  const unsupported_experience = validateWorkExperience({
    originalResume,
    generatedResume,
    profileMd,
  });

  const status = changes.length || cover.items.length || unsupported.length || unsupported_experience.length
    ? 'ok'
    : 'empty';
  return {
    status,
    message: status === 'empty' ? EMPTY_MSG : '',
    resume_changes: changes,
    cover_letter: cover,
    unsupported,
    unsupported_experience,
  };
}

function buildChangeSummarySafe(args) {
  try {
    return buildChangeSummary(args);
  } catch {
    return emptyResult('unavailable', UNAVAILABLE);
  }
}

module.exports = {
  buildChangeSummary,
  buildChangeSummarySafe,
  parseSections,
  jdKeywordsForChange,
  hasTerm,
  validateWorkExperience,
  EXPERIENCE_WARNING,
  UNAVAILABLE,
  EMPTY_MSG,
};
