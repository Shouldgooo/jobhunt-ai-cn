'use strict';

/**
 * Application generation with real stage progress + AbortSignal.
 * Mode A (resume only): one generateApplication call, cover letter off.
 * Mode B (cover only): generateCoverLetterDocument only — no resume LLM.
 * Mode C (both): resume first, then an independent cover-letter call.
 * Lock is released by the caller in finally.
 */

const fs = require('fs');
const path = require('path');
const { parseJd, mergeJobMeta } = require('./jd-parser');
const { generateApplication, isCancelledError, workAbortedError } = require('./tailor');
const { generateCoverLetterDocument } = require('./coverletter');
const { insertApplication, getTemplateById, getDefaultTemplate } = require('./db');
const { buildChangeSummarySafe, UNAVAILABLE } = require('./change-summary');

const CV_MD = path.join(__dirname, '../user/cv.md');
const PROFILE_MD = path.join(__dirname, '../user/profile.md');

function progress(onProgress, stage, pct, message) {
  onProgress?.({ type: 'progress', stage, progress: pct, message });
}

function missingMetaError(meta) {
  const err = new Error('无法识别职位名称或公司，请手动填写后重试。');
  err.statusCode = 422;
  err.job_title = meta.job_title;
  err.company = meta.company;
  err.location = meta.location;
  return err;
}

function fallbackChangeSummary() {
  return JSON.stringify({
    status: 'unavailable',
    message: UNAVAILABLE,
    resume_changes: [],
    cover_letter: { items: [] },
    unsupported: [],
    unsupported_experience: [],
  });
}

async function runAnalyzeGeneration({
  body,
  signal,
  onProgress,
  isValidTheme,
  getUserConfig,
  generate = generateApplication,
  generateCover = generateCoverLetterDocument,
  insert = insertApplication,
  summarize,
} = {}) {
  const {
    job_title,
    company,
    location,
    jd,
    url,
    source,
    theme,
    resume_template_id,
    generate_cover_letter,
    generate_resume,
    cover_letter_notes,
  } = body || {};
  const startedAt = Date.now();
  const logGen = (label) => console.log(`[generation] ${label} +${Date.now() - startedAt}ms`);
  logGen('accepted');

  const doResume = generate_resume !== false;
  const doCoverLetter = generate_cover_letter === true;

  progress(onProgress, 'accepted', 5, '请求已接受…');
  if (signal?.aborted) throw workAbortedError(signal);

  progress(onProgress, 'validating', 10, '正在验证职位信息…');
  if (!jd || !String(jd).trim()) {
    const err = new Error('jd is required');
    err.statusCode = 400;
    throw err;
  }
  if (!doResume && !doCoverLetter) {
    const err = new Error('请选择生成简历、求职信，或两者都生成。');
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

  const originalResume = baseMd
    || (fs.existsSync(CV_MD) ? fs.readFileSync(CV_MD, 'utf8') : '');
  const profileMd = fs.existsSync(PROFILE_MD) ? fs.readFileSync(PROFILE_MD, 'utf8') : '';

  let generated = {
    markdown: originalResume,
    fit_score: 0,
    detected_skills: [],
    job_title: hints.job_title || '',
    company: hints.company || '',
    location: hints.location || '',
    cover_md: '',
    cover_letter_available: false,
    tracker: { logicalCalls: 0, httpAttempts: 0 },
  };

  if (doResume) {
    try {
      generated = await generate({
        jd,
        baseMd,
        generateCoverLetter: false,
        hints,
      }, { signal, onProgress, startedAt });
    } catch (err) {
      logGen(isCancelledError(err) ? 'cancelled' : 'failed');
      throw err;
    }
    if (signal?.aborted) throw workAbortedError(signal);
  }

  const meta = mergeJobMeta(hints, parsed, generated);
  if (!meta.job_title || !meta.company) {
    throw missingMetaError(meta);
  }

  let cover_md = '';
  let cover_letter_error = null;
  let cover_letter_warning = '';
  if (doCoverLetter) {
    try {
      if (signal?.aborted) throw workAbortedError(signal);
      const cover = await generateCover({
        jd,
        company: meta.company,
        jobTitle: meta.job_title,
        location: meta.location,
        notes: cover_letter_notes,
        cvMd: originalResume,
        profileMd,
        tailoredResumeMd: doResume ? generated.markdown : '',
      }, { signal, onProgress });
      cover_md = cover.markdown || '';
      cover_letter_warning = cover.pageWarning || '';
    } catch (err) {
      if (isCancelledError(err) || signal?.aborted) {
        logGen('cancelled');
        throw err;
      }
      if (doResume) {
        cover_letter_error = err.message || '求职信生成失败';
        logGen('cover-failed');
      } else {
        logGen('failed');
        throw err;
      }
    }
  }

  progress(onProgress, 'saving', 95, '正在保存申请记录…');
  if (signal?.aborted) throw workAbortedError(signal);

  let change_summary;
  try {
    const summaryArgs = {
      originalResume,
      generatedResume: generated.markdown,
      coverLetter: cover_md,
      jd,
      profileMd,
      claimedChanges: generated.detected_skills,
    };
    const summary = summarize ? summarize(summaryArgs) : buildChangeSummarySafe(summaryArgs);
    change_summary = JSON.stringify(summary);
  } catch {
    change_summary = fallbackChangeSummary();
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
    cover_md,
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
    cover_letter_available: Boolean(cover_md),
    resume_available:       doResume,
    cover_letter_error,
    cover_letter_warning:   cover_letter_warning || undefined,
    theme:                  resolvedTheme,
  };

  onProgress?.({ type: 'complete', progress: 100, message: '生成完成', application });
  logGen('completed');
  return {
    application,
    tracker: generated.tracker,
    resolvedTemplateId,
    doCoverLetter,
    doResume,
  };
}

module.exports = { runAnalyzeGeneration, isCancelledError };
