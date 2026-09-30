'use strict';

/**
 * One-shot application generation with real stage progress + AbortSignal.
 * No extra Gemini calls. Lock is released by the caller in finally.
 */

const fs = require('fs');
const path = require('path');
const { parseJd, mergeJobMeta } = require('./jd-parser');
const { generateApplication, isCancelledError, workAbortedError } = require('./tailor');
const { insertApplication, getTemplateById, getDefaultTemplate } = require('./db');
const { buildChangeSummarySafe, UNAVAILABLE } = require('./change-summary');

const CV_MD = path.join(__dirname, '../user/cv.md');
const PROFILE_MD = path.join(__dirname, '../user/profile.md');

function progress(onProgress, stage, pct, message) {
  onProgress?.({ type: 'progress', stage, progress: pct, message });
}

async function runAnalyzeGeneration({
  body,
  signal,
  onProgress,
  isValidTheme,
  getUserConfig,
  generate = generateApplication,
  insert = insertApplication,
  summarize,
} = {}) {
  const { job_title, company, location, jd, url, source, theme, resume_template_id, generate_cover_letter } = body || {};
  const startedAt = Date.now();
  const logGen = (label) => console.log(`[generation] ${label} +${Date.now() - startedAt}ms`);
  logGen('accepted');

  progress(onProgress, 'accepted', 5, '请求已接受…');
  if (signal?.aborted) throw workAbortedError(signal);

  progress(onProgress, 'validating', 10, '正在验证职位信息…');
  if (!jd || !String(jd).trim()) {
    const err = new Error('jd is required');
    err.statusCode = 400;
    throw err;
  }

  progress(onProgress, 'parsing', 20, '正在准备职位信息…');
  const parsed = parseJd(jd);
  const hints = {
    job_title: job_title || parsed.job_title,
    company:   company   || parsed.company,
    location:  location  || parsed.location,
  };

  const resolvedTheme = (theme && isValidTheme(theme)) ? theme : (getUserConfig().theme || 'classic');
  let baseMd;
  let resolvedTemplateId = resume_template_id || null;
  if (resume_template_id) {
    const tpl = getTemplateById(resume_template_id);
    if (!tpl) {
      const err = new Error('Resume template not found');
      err.statusCode = 404;
      throw err;
    }
    baseMd = tpl.markdown;
  } else {
    const defaultTpl = getDefaultTemplate();
    if (defaultTpl) { baseMd = defaultTpl.markdown; resolvedTemplateId = defaultTpl.id; }
  }

  const doCoverLetter = generate_cover_letter !== false;

  let generated;
  try {
    generated = await generate({
      jd,
      baseMd,
      generateCoverLetter: doCoverLetter,
      hints,
    }, { signal, onProgress, startedAt });
  } catch (err) {
    logGen(isCancelledError(err) ? 'cancelled' : 'failed');
    throw err;
  }

  if (signal?.aborted) throw workAbortedError(signal);

  const meta = mergeJobMeta(hints, parsed, generated);
  if (!meta.job_title || !meta.company) {
    const err = new Error('无法识别职位名称或公司，请手动填写后重试。');
    err.statusCode = 422;
    err.job_title = meta.job_title;
    err.company = meta.company;
    err.location = meta.location;
    throw err;
  }

  progress(onProgress, 'saving', 95, '正在保存申请记录…');
  if (signal?.aborted) throw workAbortedError(signal);

  const originalResume = baseMd
    || (fs.existsSync(CV_MD) ? fs.readFileSync(CV_MD, 'utf8') : '');
  const profileMd = fs.existsSync(PROFILE_MD) ? fs.readFileSync(PROFILE_MD, 'utf8') : '';
  let change_summary;
  try {
    const summary = summarize
      ? summarize({
        originalResume,
        generatedResume: generated.markdown,
        coverLetter: generated.cover_md || '',
        jd,
        profileMd,
        claimedChanges: generated.detected_skills,
      })
      : buildChangeSummarySafe({
        originalResume,
        generatedResume: generated.markdown,
        coverLetter: generated.cover_md || '',
        jd,
        profileMd,
        claimedChanges: generated.detected_skills,
      });
    change_summary = JSON.stringify(summary);
  } catch {
    change_summary = JSON.stringify({
      status: 'unavailable',
      message: UNAVAILABLE,
      resume_changes: [],
      cover_letter: { items: [] },
      unsupported: [],
      unsupported_experience: [],
    });
  }

  const id = insert({
    created_at:         new Date().toISOString(),
    company:            meta.company,
    job_title:          meta.job_title,
    location:           meta.location,
    url:                url    || '',
    source:             source || 'other',
    jd_text:            jd,
    stack_used:         generated.job_title || meta.job_title,
    fit_score:          generated.fit_score,
    resume_md:          generated.markdown,
    cover_md:           generated.cover_md || '',
    status:             'not_started',
    theme:              resolvedTheme,
    resume_template_id: resolvedTemplateId,
    change_summary,
  });

  const application = {
    id,
    fit_score:              generated.fit_score,
    job_title:              meta.job_title,
    company:                meta.company,
    location:               meta.location,
    detected_skills:        generated.detected_skills,
    cover_letter_available: generated.cover_letter_available,
    theme:                  resolvedTheme,
  };

  onProgress?.({ type: 'complete', progress: 100, message: '生成完成', application });
  logGen('completed');
  return { application, tracker: generated.tracker, resolvedTemplateId, doCoverLetter };
}

module.exports = { runAnalyzeGeneration, isCancelledError };
