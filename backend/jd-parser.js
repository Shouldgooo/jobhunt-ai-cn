'use strict';

/**
 * General job-ad metadata parser (SEEK / LinkedIn / Indeed / careers pages).
 * Local only — no network. Keep in sync with frontend/src/lib/parse-jd.ts
 *
 * Layers:
 *  1. Normalize a COPY of pasted page text (never mutate the saved JD)
 *  2. Explicit metadata labels (highest confidence)
 *  3. Job-board header heuristics
 *  4. Semantic / pattern scoring
 *  5. Existing Gemini generateApplication fills gaps after the user clicks 分析并生成
 */

const AUTO_FILL_MIN = 0.6;

const TITLE_LABELS = [
  /^(?:job\s*title|title|position|role)\s*[:：]\s*(.*)$/i,
];
const COMPANY_LABELS = [
  /^(?:company|employer|organisation|organization)\s*[:：]\s*(.*)$/i,
];
const LOCATION_LABELS = [
  /^(?:location|based\s*in|work\s*location)\s*[:：]\s*(.*)$/i,
];

const ROLE_WORDS = [
  'engineer', 'developer', 'support', 'analyst', 'administrator', 'technician',
  'specialist', 'coordinator', 'consultant', 'manager', 'officer', 'designer',
  'architect', 'scientist', 'lead', 'director', 'assistant', 'associate',
];

const NOISE = [
  'view all jobs', 'about us', 'about the job', 'about the role', 'who are we?',
  'who we are', 'apply', 'easy apply', 'sign in', 'log in', 'register',
  'company profile', 'report this job', 'similar jobs', 'salary match',
  'job details', 'see more', 'show more', 'save', 'share', 'follow',
  'posted', 'posted date', 'people hired', 'see who', 'applicants',
  'skip to', 'cookie', 'privacy', 'terms', 'home', 'jobs', 'search',
  'back to search', 'be an early applicant', 'actively reviewing',
];

const EMPLOYMENT_RE = /^(full[-\s]?time|part[-\s]?time|casual|contract(?:\/temp)?|temporary|permanent)$/i;
const ARRANGEMENT_RE = /^(hybrid|remote|on[-\s]?site)$/i;
const RATING_RE = /^\d(?:\.\d)?(?:\s*[·•|,]\s*\d[\d,]*\s*reviews?)?$/i;
const STATE_RE = /\b(?:NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\b/;
const STATE_NAME_RE = /\b(?:New South Wales|Victoria|Queensland|Western Australia|South Australia|Tasmania|Australian Capital Territory|Northern Territory)\b/i;
const COMPANY_SUFFIX_RE = /\b(?:Pty\.?\s*Ltd\.?|Limited|Ltd\.?|Inc\.?|LLC|Group|Holdings|Australia|Services|Solutions)\b/i;

function clean(value) {
  return String(value || '')
    .replace(/[#*_`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLine(line) {
  return String(line || '')
    .replace(/\[([^\]]+)\]\((?:https?:\/\/|mailto:)[^)]+\)/gi, '$1')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .replace(/`+/g, '')
    .replace(/\*/g, '')
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/\bsvg\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isNoise(line) {
  const t = line.toLowerCase().replace(/[.?!]+$/, '');
  if (!t || t === 'svg') return true;
  if (NOISE.some(n => t === n || t.startsWith(n + ' ') || t.startsWith('posted '))) return true;
  if (/^\d+\s+(day|hour|week|month)s?\s+ago$/i.test(t)) return true;
  if (/^posted\b/i.test(t)) return true;
  return false;
}

function isRating(line) {
  return RATING_RE.test(line.trim());
}

function isEmployment(line) {
  return EMPLOYMENT_RE.test(line.trim());
}

function isArrangement(line) {
  return ARRANGEMENT_RE.test(line.trim());
}

function splitLocationAndArrangement(line) {
  const src = String(line || '');
  const paren = src.match(/^(.*?)\s*\((hybrid|remote|on[-\s]?site)\)\s*$/i);
  if (paren) return { location: clean(paren[1]), arrangement: normalizeArrangement(paren[2]) };
  const dotted = src.match(/^(.*?)\s*[·•|,]\s*(hybrid|remote|on[-\s]?site)\s*$/i);
  if (dotted) return { location: clean(dotted[1]), arrangement: normalizeArrangement(dotted[2]) };
  return { location: clean(src), arrangement: '' };
}

function normalizeArrangement(value) {
  const t = String(value || '').toLowerCase().replace(/\s+/g, '');
  if (t === 'hybrid') return 'Hybrid';
  if (t === 'remote') return 'Remote';
  if (t === 'onsite' || t === 'on-site') return 'On-site';
  return clean(value);
}

function normalizeEmployment(value) {
  const t = String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (/^full[-\s]?time$/.test(t)) return 'Full time';
  if (/^part[-\s]?time$/.test(t)) return 'Part time';
  if (t === 'casual') return 'Casual';
  if (/^contract/.test(t)) return 'Contract';
  if (t === 'temporary') return 'Temporary';
  if (t === 'permanent') return 'Permanent';
  return clean(value);
}

function isAuLocation(line) {
  const { location } = splitLocationAndArrangement(line);
  if (!location || location.length > 80) return false;
  if (isEmployment(location) || isArrangement(location) || isNoise(location) || isRating(location)) return false;
  if (/,\s*Australia\s*$/i.test(location)) return true;
  if (STATE_RE.test(location) && /[A-Za-z]/.test(location)) return true;
  if (STATE_NAME_RE.test(location)) return true;
  if (/^[A-Z][A-Za-z .'-]+(?:\s+[A-Z][A-Za-z .'-]+)*\s+[A-Z]{2,3}\s+\d{4}$/.test(location)) return true;
  return false;
}

function looksLikeCategory(line) {
  return /&|\/|,/.test(line) && !isAuLocation(line) && /technology|science|healthcare|education|hospitality|retail|marketing|sales|administration|human resources|information/i.test(line);
}

function hasRoleWord(line) {
  const t = line.toLowerCase();
  return ROLE_WORDS.some(w => t.includes(w));
}

function titleScore(line, index, wasHeading) {
  if (!line || line.length < 3 || line.length > 80) return 0;
  if (isNoise(line) || isRating(line) || isEmployment(line) || isArrangement(line) || isAuLocation(line) || looksLikeCategory(line)) return 0;
  if (COMPANY_SUFFIX_RE.test(line) && !hasRoleWord(line)) return 0.15;
  let score = 0.45;
  if (index <= 2) score += 0.25;
  else if (index <= 6) score += 0.1;
  if (wasHeading) score += 0.2;
  if (hasRoleWord(line)) score += 0.15;
  if (/^(view|about|who|apply|sign|company profile|report|similar|posted)/i.test(line)) score -= 0.5;
  if (/^(we|our|looking|join)\b/i.test(line)) score -= 0.35;
  if (line.split(/\s+/).length > 10) score -= 0.4;
  if (/[.!?]$/.test(line)) score -= 0.3;
  return Math.max(0, Math.min(1, score));
}

function companyScore(line, { belowTitle, beforeLocation, inProfile, index }) {
  if (!line || line.length < 2 || line.length > 90) return 0;
  if (isNoise(line) || isRating(line) || isEmployment(line) || isArrangement(line) || isAuLocation(line) || looksLikeCategory(line)) return 0;
  if (/^\d/.test(line)) return 0;
  let score = 0.4;
  if (belowTitle) score += 0.2;
  if (beforeLocation) score += 0.15;
  if (inProfile) score += 0.25;
  if (index <= 4) score += 0.1;
  if (COMPANY_SUFFIX_RE.test(line)) score += 0.15;
  if (hasRoleWord(line) && !COMPANY_SUFFIX_RE.test(line)) score -= 0.25;
  return Math.max(0, Math.min(1, score));
}

function extractHeadings(raw) {
  const headings = [];
  for (const line of String(raw || '').replace(/\r\n/g, '\n').split('\n')) {
    const m = line.match(/^\s{0,3}(#{1,3})\s+(.+)$/);
    if (m) headings.push(clean(normalizeLine(m[2])));
  }
  return headings.filter(Boolean);
}

function normalizeJobAdText(text) {
  let src = String(text || '').replace(/\r\n/g, '\n');
  src = src.replace(/\[([^\]]+)\]\((?:https?:\/\/|mailto:)[^)]+\)/gi, '$1');
  const out = [];
  let blank = 0;
  for (const raw of src.split('\n')) {
    let line = normalizeLine(raw);
    if (!line || /^svg$/i.test(line)) {
      blank += 1;
      if (blank === 1 && out.length) out.push('');
      continue;
    }
    blank = 0;
    if (isRating(line)) continue;
    if (out.length && out[out.length - 1] === line) continue;
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function matchLabeled(lines, patterns) {
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i];
    for (const re of patterns) {
      const m = trimmed.match(re);
      if (!m) continue;
      const value = clean(m[1]);
      if (value) return value;
      const next = clean(lines[i + 1] || '');
      if (next && !patterns.some(p => p.test(next)) && !isNoise(next)) return next;
    }
  }
  return '';
}

function companyFromProfile(lines) {
  for (let i = 0; i < lines.length; i++) {
    if (/^company profile$/i.test(lines[i])) {
      const next = clean(lines[i + 1] || '');
      if (next && !isNoise(next) && !isAuLocation(next) && !isEmployment(next)) return next;
    }
  }
  return '';
}

function scanOptional(lines) {
  let arrangement = '';
  let employment = '';
  for (const line of lines) {
    const split = splitLocationAndArrangement(line);
    if (split.arrangement && !arrangement) arrangement = split.arrangement;
    if (isArrangement(line) && !arrangement) arrangement = normalizeArrangement(line);
    if (isEmployment(line) && !employment) employment = normalizeEmployment(line);
  }
  return { arrangement, employment };
}

function field(value, confidence) {
  return { value: value || '', confidence: value ? confidence : 0 };
}

function pick(a, b) {
  if ((a.confidence || 0) >= (b.confidence || 0)) return a;
  return b;
}

function parseJdDetailed(text) {
  const empty = {
    job_title: field('', 0),
    company: field('', 0),
    location: field('', 0),
    work_arrangement: field('', 0),
    employment_type: field('', 0),
  };
  const raw = typeof text === 'string' ? text : '';
  if (!raw.trim()) return empty;

  const headings = extractHeadings(raw);
  const normalized = normalizeJobAdText(raw);
  const lines = normalized.split('\n').map(l => l.trim()).filter(Boolean);
  const optional = scanOptional(lines);

  let job_title = field('', 0);
  let company = field('', 0);
  let location = field('', 0);

  const labeledTitle = matchLabeled(lines, TITLE_LABELS);
  const labeledCompany = matchLabeled(lines, COMPANY_LABELS);
  const labeledLocation = matchLabeled(lines, LOCATION_LABELS);
  if (labeledTitle) job_title = field(labeledTitle, 0.95);
  if (labeledCompany) company = field(labeledCompany, 0.95);
  if (labeledLocation) {
    const split = splitLocationAndArrangement(labeledLocation);
    location = field(split.location, 0.95);
    if (split.arrangement) optional.arrangement = optional.arrangement || split.arrangement;
  }

  const headingTitle = headings.find(h => titleScore(h, 0, true) >= 0.5);
  if (headingTitle) job_title = pick(job_title, field(headingTitle, 0.88));

  const header = [];
  for (const line of lines) {
    if (isNoise(line) || isRating(line)) continue;
    header.push(line);
    if (header.length >= 12) break;
  }

  const locIdx = header.findIndex(isAuLocation);
  if (locIdx >= 0) {
    const split = splitLocationAndArrangement(header[locIdx]);
    location = pick(location, field(split.location, 0.92));
    if (split.arrangement) optional.arrangement = optional.arrangement || split.arrangement;
  }

  const profileCompany = companyFromProfile(lines);

  if (!job_title.value || job_title.confidence < 0.85) {
    let best = job_title;
    header.forEach((line, i) => {
      if (isAuLocation(line) || isEmployment(line) || isArrangement(line)) return;
      const score = titleScore(line, i, headings.includes(line));
      if (score > best.confidence) best = field(line, score);
    });
    job_title = best;
  }

  if (!company.value || company.confidence < 0.85) {
    let best = company;
    header.forEach((line, i) => {
      if (line === job_title.value) return;
      const score = companyScore(line, {
        belowTitle: job_title.value ? i > header.indexOf(job_title.value) : i === 1,
        beforeLocation: locIdx < 0 || i < locIdx,
        inProfile: profileCompany && profileCompany.toLowerCase() === line.toLowerCase(),
        index: i,
      });
      if (score > best.confidence) best = field(line, score);
    });
    if (profileCompany) {
      const boosted = companyScore(profileCompany, {
        belowTitle: true,
        beforeLocation: true,
        inProfile: true,
        index: 1,
      });
      if (boosted > best.confidence) best = field(profileCompany, boosted);
    }
    company = best;
  }

  return {
    job_title,
    company,
    location,
    work_arrangement: field(optional.arrangement, optional.arrangement ? 0.9 : 0),
    employment_type: field(optional.employment, optional.employment ? 0.9 : 0),
  };
}

function take(fieldObj) {
  if (!fieldObj || !fieldObj.value || fieldObj.confidence < AUTO_FILL_MIN) return '';
  return fieldObj.value;
}

function parseJd(text) {
  const d = parseJdDetailed(text);
  return {
    job_title: take(d.job_title),
    company: take(d.company),
    location: take(d.location),
    work_arrangement: take(d.work_arrangement),
    employment_type: take(d.employment_type),
  };
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

module.exports = {
  parseJd,
  parseJdDetailed,
  normalizeJobAdText,
  mergeJobMeta,
  firstNonEmpty,
  AUTO_FILL_MIN,
};
