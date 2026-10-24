'use strict';

/** Fixed candidate token for export filenames. Not taken from AI or YAML. */
export const PDF_FILENAME_CANDIDATE_NAME = 'SIHUA_TANG';
export const DEFAULT_JOB_TITLE = 'Role';
export const DEFAULT_COMPANY = 'Company';

export function sanitizePdfFilenamePart(value, fallback) {
  const raw = String(value == null ? '' : value).trim();
  const source = raw || String(fallback || '');
  const cleaned = source
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (cleaned) return cleaned;
  const fallbackClean = String(fallback || '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return fallbackClean || 'Value';
}

function pdfKind(type) {
  return type === 'coverletter' || type === 'Cover_Letter' ? 'Cover_Letter' : 'Resume';
}

export function pdfExportFilename({ jobTitle, company, type } = {}) {
  const job = sanitizePdfFilenamePart(jobTitle, DEFAULT_JOB_TITLE);
  const org = sanitizePdfFilenamePart(company, DEFAULT_COMPANY);
  return `${PDF_FILENAME_CANDIDATE_NAME}_${job}_${org}_${pdfKind(type)}.pdf`;
}

export function parseContentDispositionFilename(header) {
  if (typeof header !== 'string' || !header.trim()) return '';
  const star = header.match(/filename\*\s*=\s*(?:UTF-8''|utf-8'')([^;]+)/i);
  if (star) {
    try { return decodeURIComponent(star[1].trim()); } catch { return star[1].trim(); }
  }
  const quoted = header.match(/filename\s*=\s*"((?:\\.|[^"])*)"/i);
  if (quoted) return quoted[1].replace(/\\"/g, '"');
  const plain = header.match(/filename\s*=\s*([^;]+)/i);
  return plain ? plain[1].trim().replace(/^["']|["']$/g, '') : '';
}

export function contentDisposition(filename) {
  const safe = String(filename || '').replace(/"/g, '');
  return `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}
