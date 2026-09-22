'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const fs      = require('fs');

// ─── Paths ─────────────────────────────────────────────────────────────────────

const USER_CONFIG_PATH = path.resolve(__dirname, '../user.config.js');
const THEMES_DIR       = path.resolve(__dirname, '../themes');

/** Load user config (not cached — allows live changes without restart issues) */
function getUserConfig() {
  delete require.cache[require.resolve(USER_CONFIG_PATH)];
  return require(USER_CONFIG_PATH);
}

/** Get CSS path for a theme name. */
function themeCssPath(theme) {
  return path.join(THEMES_DIR, `${theme}.css`);
}

/** Validate theme name — prevent path traversal */
function isValidTheme(theme) {
  return typeof theme === 'string' && /^[a-z0-9-]+$/.test(theme);
}

const {
  insertApplication,
  getAllApplications,
  getApplicationById,
  updateApplication,
  deleteApplication,
  getAllTemplates,
  getTemplateById,
  getDefaultTemplate,
  insertTemplate,
  updateTemplate,
  deleteTemplate,
  setDefaultTemplate,
} = require('./db');

const app = express();
app.use(express.json());

// ─── API Router ────────────────────────────────────────────────────────────────

const api = express.Router();

// Health
api.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ─── Analyze — Stage 1 ────────────────────────────────────────────────────────

api.post('/analyze', async (req, res) => {
  const { job_title, company, jd, url, source, theme, resume_template_id, generate_cover_letter } = req.body;

  if (!job_title || !company || !jd) {
    return res.status(400).json({ error: 'job_title, company, and jd are required' });
  }

  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: 'Gemini API key not configured — set GEMINI_API_KEY in backend/.env' });
  }

  // Theme: explicit in request → user.config.js default → 'classic'
  const resolvedTheme = (theme && isValidTheme(theme)) ? theme : (getUserConfig().theme || 'classic');

  // Resolve base markdown: from template if specified, else tailor.js reads user/base.md
  let baseMd;
  let resolvedTemplateId = resume_template_id || null;
  if (resume_template_id) {
    const tpl = getTemplateById(resume_template_id);
    if (!tpl) return res.status(404).json({ error: 'Resume template not found' });
    baseMd = tpl.markdown;
  } else {
    const defaultTpl = getDefaultTemplate();
    if (defaultTpl) { baseMd = defaultTpl.markdown; resolvedTemplateId = defaultTpl.id; }
  }

  try {
    const { tailorResume }        = require('./tailor');
    const { generateCoverLetter } = require('./coverletter');

    const tailor      = await tailorResume({ jd, baseMd });
    const doCoverLetter = generate_cover_letter !== false;
    const coverResult = doCoverLetter
      ? await generateCoverLetter({ company, job_title, jd })
      : { markdown: '', available: true };

    const id = insertApplication({
      created_at:         new Date().toISOString(),
      company,
      job_title,
      url:                url    || '',
      source:             source || 'other',
      jd_text:            jd,
      stack_used:         tailor.job_title,
      fit_score:          tailor.fit_score,
      resume_md:          tailor.markdown,
      cover_md:           coverResult.markdown || '',
      status:             'not_started',
      theme:              resolvedTheme,
      resume_template_id: resolvedTemplateId,
    });

    res.json({
      id,
      fit_score:              tailor.fit_score,
      job_title:              tailor.job_title,
      detected_skills:        tailor.detected_skills,
      cover_letter_available: doCoverLetter ? coverResult.available : false,
      theme:                  resolvedTheme,
    });
  } catch (err) {
    console.error('[/api/analyze error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── PDF Export — Stage 2 (on-demand) ─────────────────────────────────────────

api.get('/applications/:id/pdf', async (req, res) => {
  const type   = req.query.type === 'coverletter' ? 'coverletter' : 'resume';
  const record = getApplicationById(Number(req.params.id));

  if (!record) return res.status(404).json({ error: 'Not found' });

  const markdown = type === 'coverletter' ? record.cover_md : record.resume_md;
  if (!markdown) {
    return res.status(404).json({
      error: type === 'coverletter'
        ? 'No cover letter saved — generate one from New Application'
        : 'Resume markdown not saved — try re-generating from New Application',
    });
  }

  try {
    const { exportResumePDF, exportCoverLetterPDF } = require('./exporter');
    const buffer = type === 'coverletter'
      ? await exportCoverLetterPDF(markdown)
      : await exportResumePDF(markdown, record.theme || 'classic');

    const slug     = `${record.company}_${record.job_title}`.replace(/[^a-zA-Z0-9]/g, '-');
    const filename = `${slug}_${type}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error('[/api/pdf error]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Rescore ──────────────────────────────────────────────────────────────────

api.post('/applications/:id/rescore', async (req, res) => {
  const record = getApplicationById(Number(req.params.id));
  if (!record) return res.status(404).json({ error: 'Not found' });

  const jd = req.body.jd || record.jd_text;
  if (!jd) return res.status(400).json({ error: 'No job description available — paste a JD to score against' });

  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: 'Gemini API key not configured — set GEMINI_API_KEY in backend/.env' });
  }

  try {
    const { rescoreResume } = require('./tailor');
    const fit_score = await rescoreResume(jd);
    const updates = { fit_score };
    if (req.body.jd && !record.jd_text) updates.jd_text = req.body.jd;
    updateApplication(record.id, updates);
    res.json({ fit_score });
  } catch (err) {
    console.error('[/api/applications/:id/rescore error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Evaluate ─────────────────────────────────────────────────────────────────

api.post('/applications/:id/evaluate', async (req, res) => {
  const record = getApplicationById(Number(req.params.id));
  if (!record) return res.status(404).json({ error: 'Not found' });
  if (!record.jd_text) return res.status(400).json({ error: 'No job description saved — run Analyze first' });

  const provider = (process.env.LLM_PROVIDER || 'gemini').toLowerCase();
  if (provider !== 'ollama' && !process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: 'Gemini API key not configured — set GEMINI_API_KEY in backend/.env' });
  }

  try {
    const { evaluateApplication } = require('./evaluator');
    const result = await evaluateApplication({ jd: record.jd_text });
    updateApplication(record.id, result);
    res.json(result);
  } catch (err) {
    console.error('[/api/evaluate error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Preview ───────────────────────────────────────────────────────────────────

api.post('/preview', (req, res) => {
  const { markdown, type, theme } = req.body;
  if (!markdown) return res.status(400).json({ error: 'markdown is required' });
  if (theme && !isValidTheme(theme)) return res.status(400).json({ error: 'Invalid theme name' });

  try {
    const { renderResume, renderCoverLetter } = require('./renderer');
    const html = type === 'coverletter'
      ? renderCoverLetter(markdown)
      : renderResume(markdown, theme || null);
    res.json({ html });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Prompts ───────────────────────────────────────────────────────────────────

// ─── Profile (user/profile.md) ────────────────────────────────────────────────

const PROFILE_MD_PATH = path.resolve(__dirname, '../user/profile.md');

api.get('/profile', (_req, res) => {
  try {
    const profile = fs.existsSync(PROFILE_MD_PATH) ? fs.readFileSync(PROFILE_MD_PATH, 'utf8') : '';
    res.json({ profile });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.put('/profile', (req, res) => {
  const { profile } = req.body;
  if (typeof profile !== 'string') return res.status(400).json({ error: 'profile must be a string' });
  try {
    fs.writeFileSync(PROFILE_MD_PATH, profile, 'utf8');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── CV (user/cv.md) ──────────────────────────────────────────────────────────

const CV_MD_PATH = path.resolve(__dirname, '../user/cv.md');

api.get('/cv', (_req, res) => {
  try {
    const cv = fs.existsSync(CV_MD_PATH) ? fs.readFileSync(CV_MD_PATH, 'utf8') : '';
    res.json({ cv });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.put('/cv', (req, res) => {
  const { cv } = req.body;
  if (typeof cv !== 'string') return res.status(400).json({ error: 'cv must be a string' });
  try {
    fs.writeFileSync(CV_MD_PATH, cv, 'utf8');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Cover Letter Template ─────────────────────────────────────────────────────

const COVER_LETTER_TEMPLATE_PATH = path.resolve(__dirname, '../user/cover-letter/template.md');

api.get('/cover-letter/template', (_req, res) => {
  try {
    const template = fs.existsSync(COVER_LETTER_TEMPLATE_PATH)
      ? fs.readFileSync(COVER_LETTER_TEMPLATE_PATH, 'utf8')
      : '';
    res.json({ template });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.put('/cover-letter/template', (req, res) => {
  const { template } = req.body;
  if (typeof template !== 'string') {
    return res.status(400).json({ error: 'template must be a string' });
  }
  try {
    fs.writeFileSync(COVER_LETTER_TEMPLATE_PATH, template, 'utf8');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Style / Themes ────────────────────────────────────────────────────────────

// GET /api/style — return the active theme name + its CSS
api.get('/style', (_req, res) => {
  try {
    const config = getUserConfig();
    const theme  = config.theme || 'classic';
    res.json({ theme, css: fs.readFileSync(themeCssPath(theme), 'utf8') });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/style — save CSS to a theme file (defaults to active theme)
api.put('/style', (req, res) => {
  const { css, theme } = req.body;
  if (typeof css !== 'string') return res.status(400).json({ error: 'css must be a string' });
  if (theme && !isValidTheme(theme)) return res.status(400).json({ error: 'Invalid theme name' });
  try {
    const resolvedTheme = theme || getUserConfig().theme || 'classic';
    fs.writeFileSync(themeCssPath(resolvedTheme), css, 'utf8');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/style/themes — list all available themes
api.get('/style/themes', (_req, res) => {
  try {
    const themes = fs.readdirSync(THEMES_DIR)
      .filter(f => f.endsWith('.css'))
      .map(file => ({
        name:  file.replace('.css', ''),
        label: formatThemeLabel(file.replace('.css', '')),
        css:   fs.readFileSync(path.join(THEMES_DIR, file), 'utf8'),
      }));
    res.json(themes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/style/preview — render resume HTML with a given CSS string
api.post('/style/preview', (req, res) => {
  const { css, theme } = req.body;
  if (typeof css !== 'string') return res.status(400).json({ error: 'css must be a string' });
  if (theme && !isValidTheme(theme)) return res.status(400).json({ error: 'Invalid theme name' });
  try {
    const { renderResumeWithCss } = require('./renderer');
    const apps     = getAllApplications();
    const latest   = apps.find(a => a.resume_md);
    const markdown = latest
      ? latest.resume_md
      : fs.readFileSync(CV_MD_PATH, 'utf8');
    res.json({ html: renderResumeWithCss(markdown, css, theme || undefined) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function formatThemeLabel(name) {
  return name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ─── Applications — direct save (Persona A, no AI) ────────────────────────────

const STATIC_COVER_PATH = path.resolve(__dirname, '../user/cover-letter/static.md');

api.post('/applications', (req, res) => {
  const { job_title, company, resume_template_id, source, url, jd, theme } = req.body;
  if (!job_title || !company) {
    return res.status(400).json({ error: 'job_title and company are required' });
  }

  // Resolve template markdown
  let resume_md = '';
  let resolvedTemplateId = resume_template_id || null;
  if (resume_template_id) {
    const tpl = getTemplateById(resume_template_id);
    if (!tpl) return res.status(404).json({ error: 'Resume template not found' });
    resume_md = tpl.markdown;
  } else {
    const tpl = getDefaultTemplate();
    if (tpl) { resume_md = tpl.markdown; resolvedTemplateId = tpl.id; }
  }

  // Fill static cover letter template with company and job_title
  let cover_md = '';
  if (fs.existsSync(STATIC_COVER_PATH)) {
    cover_md = fs.readFileSync(STATIC_COVER_PATH, 'utf8')
      .replace(/\{\{company\}\}/g,   company)
      .replace(/\{\{job_title\}\}/g, job_title);
  }

  const id = insertApplication({
    created_at:         new Date().toISOString(),
    company,
    job_title,
    url:                url    || '',
    source:             source || 'other',
    jd_text:            jd     || '',
    stack_used:         '',
    fit_score:          null,
    resume_md,
    cover_md,
    status:             'not_started',
    theme:              (theme && isValidTheme(theme)) ? theme : (getUserConfig().theme || 'classic'),
    resume_template_id: resolvedTemplateId,
  });

  res.json({ id });
});

// ─── Resume Templates ──────────────────────────────────────────────────────────

api.get('/resume-templates', (_req, res) => {
  try { res.json(getAllTemplates()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

api.post('/resume-templates', (req, res) => {
  const { name, markdown } = req.body;
  if (!name || typeof markdown !== 'string') {
    return res.status(400).json({ error: 'name and markdown are required' });
  }
  try {
    const id = insertTemplate({ name, markdown });
    res.json({ id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

api.get('/resume-templates/:id', (req, res) => {
  const tpl = getTemplateById(Number(req.params.id));
  tpl ? res.json(tpl) : res.status(404).json({ error: 'Not found' });
});

api.put('/resume-templates/:id', (req, res) => {
  const { name, markdown } = req.body;
  const ok = updateTemplate(Number(req.params.id), { name, markdown });
  ok ? res.json({ ok: true }) : res.status(404).json({ error: 'Not found' });
});

api.delete('/resume-templates/:id', (req, res) => {
  const result = deleteTemplate(Number(req.params.id));
  if (result === false) {
    const tpl = getTemplateById(Number(req.params.id));
    if (!tpl) return res.status(404).json({ error: 'Not found' });
    return res.status(400).json({ error: 'Cannot delete the last template' });
  }
  res.json({ ok: true });
});

api.patch('/resume-templates/:id/default', (req, res) => {
  const ok = setDefaultTemplate(Number(req.params.id));
  ok ? res.json({ ok: true }) : res.status(404).json({ error: 'Not found' });
});

/** Convert structured resume data to Oh My CV markdown. */
function buildResumeMarkdown({ personal = {}, summary, skills, experience, education, certifications }) {
  const p = personal;
  const headerItems = [];
  if (p.phone)     headerItems.push(`  - text: "mobile: ${p.phone}"`);
  if (p.portfolio) headerItems.push(`  - text: "portfolio: ${p.portfolio}"\n    link: ${p.portfolio}`);
  if (p.email)     headerItems.push(`  - text: "email: ${p.email}"\n    link: mailto:${p.email}`);
  if (p.linkedin) {
    const handle = p.linkedin.replace(/^https?:\/\/(www\.)?linkedin\.com\/in\//i, '').replace(/\/$/, '');
    headerItems.push(`  - text: "linkedin: ${p.linkedin}"\n    link: https://linkedin.com/in/${handle}`);
  }

  const frontMatter = `---\nname: ${p.name || 'Your Name'}\nheader:\n${headerItems.join('\n')}\n---`;

  const summarySection = summary ? `\n## Summary\n\n${summary}\n` : '';

  let skillsSection = '';
  if (Array.isArray(skills) && skills.length > 0) {
    skillsSection = '\n## Skills\n\n';
    for (const group of skills) {
      if (group.label && group.items) skillsSection += `${group.label}\n  ~ ${group.items}\n\n`;
    }
  }

  let expSection = '';
  if (Array.isArray(experience) && experience.length > 0) {
    expSection = '\n## Experience\n\n';
    for (const job of experience) {
      const end = job.current ? 'Present' : (job.end || '');
      const dateRange = job.start ? `${job.start}${end ? ` – ${end}` : ''}` : '';
      expSection += `**${job.title || 'Job Title'}**\n  ~ ${job.location || ''}\n\n`;
      expSection += `${job.company || 'Company'}\n  ~ ${dateRange}\n\n`;
      if (Array.isArray(job.bullets)) {
        for (const b of job.bullets) { if (b) expSection += `- ${b}\n\n`; }
      }
    }
  }

  let eduSection = '';
  if (Array.isArray(education) && education.length > 0) {
    eduSection = '\n## Education\n\n';
    for (const edu of education) {
      eduSection += `**${edu.institution || 'Institution'}**\n  ~ ${edu.year || ''}\n\n`;
      if (edu.degree) eduSection += `${edu.degree}\n\n`;
    }
  }

  let certSection = '';
  if (Array.isArray(certifications) && certifications.length > 0) {
    certSection = '\n## Certification\n\n';
    for (const cert of certifications) {
      if (cert.name) certSection += `**${cert.name}**\n  ~ ${cert.date || ''}\n\n`;
    }
  }

  return [frontMatter, summarySection, skillsSection, expSection, eduSection, certSection]
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd() + '\n';
}

api.post('/resume-templates/build', (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'name is required' });
  }
  try {
    const markdown = buildResumeMarkdown(req.body);
    const id = insertTemplate({ name, markdown });
    res.json({ id, markdown });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.post('/resume-templates/build-preview', (req, res) => {
  try {
    const markdown = buildResumeMarkdown(req.body);
    res.json({ markdown });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Applications CRUD ─────────────────────────────────────────────────────────

api.get('/applications', (_req, res) => {
  try {
    res.json(getAllApplications());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.get('/applications/:id', (req, res) => {
  const record = getApplicationById(Number(req.params.id));
  record ? res.json(record) : res.status(404).json({ error: 'Not found' });
});

api.patch('/applications/:id', (req, res) => {
  const ok = updateApplication(Number(req.params.id), req.body);
  ok ? res.json({ ok: true }) : res.status(404).json({ error: 'Not found' });
});

api.delete('/applications/:id', (req, res) => {
  const ok = deleteApplication(Number(req.params.id));
  ok ? res.json({ ok: true }) : res.status(404).json({ error: 'Not found' });
});

// Mount all API routes under /api
app.use('/api', api);

// ─── Frontend (production) ─────────────────────────────────────────────────────
// In dev, Vite serves the frontend on port 5173.
// In production, serve the built frontend from backend/public/.

const publicDir = path.join(__dirname, 'public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });
}

// ─── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`\nServer running at http://localhost:${PORT}\n`);
});
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Set PORT in backend/.env to a free port (Vite reads the same value for /api proxy).`);
    process.exit(1);
  }
  throw err;
});
