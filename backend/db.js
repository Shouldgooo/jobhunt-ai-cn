'use strict';

// node:sqlite is built into Node.js v22+
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs   = require('fs');

const db = new DatabaseSync(process.env.TEST_DB_PATH || path.join(__dirname, 'applications.db'));

// ─── Schema ────────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS applications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    company    TEXT NOT NULL,
    job_title  TEXT NOT NULL,
    url        TEXT,
    source     TEXT,
    jd_text    TEXT,
    stack_used TEXT,
    fit_score  INTEGER,
    resume_md  TEXT,
    cover_md   TEXT,
    status     TEXT DEFAULT 'analyzed'
  )
`);

// ─── Resume Templates Schema ────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS resume_templates (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    markdown   TEXT NOT NULL,
    is_default INTEGER DEFAULT 0,
    created_at TEXT,
    updated_at TEXT
  )
`);

// Migration: add new columns to existing DBs (safe to run every time)
for (const col of [
  'resume_md TEXT', 'cover_md TEXT', "theme TEXT DEFAULT 'classic'",
  "status_log TEXT DEFAULT '[]'", "follow_up INTEGER DEFAULT 0", 'resume_template_id INTEGER',
  'eval_score INTEGER', 'eval_recommendation TEXT', 'eval_archetype TEXT', 'eval_review TEXT',
]) {
  try { db.exec(`ALTER TABLE applications ADD COLUMN ${col}`); } catch { /* already exists */ }
}

const DEFAULT_TEMPLATE_NAME = 'Master Resume';
const CV_MD_PATH = process.env.CV_MD_PATH || path.join(__dirname, '../user/cv.md');

/**
 * If resume_templates is empty, import user/cv.md as the default template.
 * No-op when templates already exist. Does not throw if cv.md is missing.
 */
function seedDefaultResumeTemplate(cvPath = CV_MD_PATH) {
  try {
    const count = Number(db.prepare('SELECT COUNT(*) as c FROM resume_templates').get().c);
    if (count > 0) return;

    if (!fs.existsSync(cvPath)) {
      console.warn('[db] resume_templates is empty and user/cv.md was not found — skipping default template seed');
      return;
    }

    const markdown = fs.readFileSync(cvPath, 'utf8');
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO resume_templates (name, markdown, is_default, created_at, updated_at) VALUES (?, ?, 1, ?, ?)'
    ).run(DEFAULT_TEMPLATE_NAME, markdown, now, now);
  } catch (err) {
    console.warn(`[db] failed to seed default resume template: ${err.message}`);
  }
}

seedDefaultResumeTemplate();

// ─── CRUD ──────────────────────────────────────────────────────────────────────

function insertApplication(data) {
  const status_log = JSON.stringify([{ status: data.status, changed_at: data.created_at }]);
  return db.prepare(`
    INSERT INTO applications
      (created_at, company, job_title, url, source, jd_text, stack_used, fit_score, resume_md, cover_md, status, theme, status_log, resume_template_id)
    VALUES
      (:created_at, :company, :job_title, :url, :source, :jd_text, :stack_used, :fit_score, :resume_md, :cover_md, :status, :theme, :status_log, :resume_template_id)
  `).run({ resume_template_id: null, ...data, status_log }).lastInsertRowid;
}

function getAllApplications() {
  return db.prepare('SELECT * FROM applications ORDER BY created_at DESC').all();
}

function getApplicationById(id) {
  return db.prepare('SELECT * FROM applications WHERE id = ?').get(id) ?? null;
}

function updateApplication(id, fields) {
  const ALLOWED = ['created_at', 'company', 'job_title', 'url', 'source',
                   'jd_text', 'stack_used', 'fit_score', 'status', 'resume_md', 'cover_md', 'theme', 'status_log', 'follow_up',
                   'eval_score', 'eval_recommendation', 'eval_archetype', 'eval_review'];
  const pairs = Object.entries(fields).filter(([k]) => ALLOWED.includes(k));
  if (!pairs.length) return false;

  // Append to status_log whenever status changes (skip if same as last entry)
  if (fields.status !== undefined) {
    const row = db.prepare('SELECT status_log FROM applications WHERE id = ?').get(id);
    if (row) {
      let log;
      try { log = JSON.parse(row.status_log || '[]'); } catch { log = []; }
      const last = log[log.length - 1];
      if (!last || last.status !== fields.status) {
        log.push({ status: fields.status, changed_at: new Date().toISOString() });
        pairs.push(['status_log', JSON.stringify(log)]);
      }
    }
  }

  const setClause = pairs.map(([k]) => `${k} = :${k}`).join(', ');
  const params = { ...Object.fromEntries(pairs), id };
  return db.prepare(`UPDATE applications SET ${setClause} WHERE id = :id`).run(params).changes > 0;
}

// Kept for backward compatibility (used by tests)
function updateApplicationStatus(id, status) {
  return db.prepare('UPDATE applications SET status = ? WHERE id = ?').run(status, id).changes > 0;
}

function deleteApplication(id) {
  return db.prepare('DELETE FROM applications WHERE id = ?').run(id).changes > 0;
}

// ─── Resume Templates CRUD ─────────────────────────────────────────────────────

function getAllTemplates() {
  return db.prepare(
    'SELECT id, name, is_default, created_at, updated_at FROM resume_templates ORDER BY is_default DESC, created_at ASC'
  ).all();
}

function getTemplateById(id) {
  return db.prepare('SELECT * FROM resume_templates WHERE id = ?').get(id) ?? null;
}

function getDefaultTemplate() {
  return db.prepare('SELECT * FROM resume_templates WHERE is_default = 1').get() ?? null;
}

function insertTemplate({ name, markdown }) {
  const now = new Date().toISOString();
  return db.prepare(
    'INSERT INTO resume_templates (name, markdown, is_default, created_at, updated_at) VALUES (?, ?, 0, ?, ?)'
  ).run(name, markdown, now, now).lastInsertRowid;
}

function updateTemplate(id, fields) {
  const ALLOWED = ['name', 'markdown'];
  const pairs = Object.entries(fields).filter(([k]) => ALLOWED.includes(k));
  if (!pairs.length) return false;
  pairs.push(['updated_at', new Date().toISOString()]);
  const setClause = pairs.map(([k]) => `${k} = :${k}`).join(', ');
  return db.prepare(`UPDATE resume_templates SET ${setClause} WHERE id = :id`)
    .run({ ...Object.fromEntries(pairs), id }).changes > 0;
}

function deleteTemplate(id) {
  const count = db.prepare('SELECT COUNT(*) as c FROM resume_templates').get().c;
  if (count <= 1) return false; // can't delete the last template
  const tpl = db.prepare('SELECT is_default FROM resume_templates WHERE id = ?').get(id);
  if (!tpl) return false;
  const deleted = db.prepare('DELETE FROM resume_templates WHERE id = ?').run(id).changes > 0;
  if (deleted && tpl.is_default) {
    const first = db.prepare('SELECT id FROM resume_templates LIMIT 1').get();
    if (first) db.prepare('UPDATE resume_templates SET is_default = 1 WHERE id = ?').run(first.id);
  }
  return deleted;
}

function setDefaultTemplate(id) {
  db.prepare('UPDATE resume_templates SET is_default = 0').run();
  return db.prepare('UPDATE resume_templates SET is_default = 1 WHERE id = ?').run(id).changes > 0;
}

module.exports = {
  insertApplication,
  getAllApplications,
  getApplicationById,
  updateApplication,
  updateApplicationStatus,
  deleteApplication,
  getAllTemplates,
  getTemplateById,
  getDefaultTemplate,
  insertTemplate,
  updateTemplate,
  deleteTemplate,
  setDefaultTemplate,
  seedDefaultResumeTemplate,
};
