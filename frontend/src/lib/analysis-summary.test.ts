import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildAnalysisView,
  buildRecommendation,
  EVIDENCE_FALLBACK,
  mentionsAsExperience,
  NO_VERIFIED_CHANGES,
  parseEvidenceMatrix,
  persistedFitScore,
  selectAttention,
  selectStrengths,
  summarizeVerifiedChanges,
} from './analysis-summary.ts'
import { parseChangeSummary } from './change-summary.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const editorSrc = fs.readFileSync(path.join(here, '../pages/Editor.tsx'), 'utf8')
const panelSrc = fs.readFileSync(path.join(here, '../components/AnalysisPanel.tsx'), 'utf8')
const helperSrc = fs.readFileSync(path.join(here, 'analysis-summary.ts'), 'utf8')
const apiSrc = fs.readFileSync(path.join(here, 'api.ts'), 'utf8')

const MATRIX = {
  status: 'ok',
  resume_changes: [
    {
      section: 'Skills',
      type: 'modified',
      before: 'REST API PostgreSQL Docker',
      after: 'REST API PostgreSQL Docker CI/CD',
      jd_keywords: ['REST API', 'PostgreSQL', 'Docker'],
      verified: true,
    },
    {
      section: 'Work Experience',
      type: 'modified',
      before: 'Built REST APIs',
      after: 'Built REST APIs and documented runbooks',
      jd_keywords: ['REST API'],
      verified: true,
    },
  ],
  cover_letter: { items: [] },
  unsupported: [],
  unsupported_experience: [],
  evidence_matrix: [
    { name: 'REST API / 后端开发', kind: 'core', level: 'strong', note: '工作经历和项目中存在直接证据' },
    { name: '数据库', kind: 'core', level: 'strong', note: 'PostgreSQL / MySQL 项目与工作经验支持' },
    { name: 'Docker / CI/CD', kind: 'supporting', level: 'strong', note: '原始资料中存在直接证据' },
    { name: 'LLM / RAG 实践经验', kind: 'core', level: 'missing', note: 'JD 明确要求，但原始资料中未找到实际项目或工作经验支持。' },
    { name: 'Python', kind: 'core', level: 'partial', note: 'Skills 中存在，但项目/工作经历证据较弱。' },
    { name: 'Kubernetes', kind: 'supporting', level: 'missing', note: 'JD 有提及，原始资料中未找到支持。' },
  ],
}

test('match score is displayed from persisted data and not recalculated', () => {
  assert.equal(persistedFitScore(62), 62)
  assert.equal(persistedFitScore(0), 0)
  const view = buildAnalysisView({ fit_score: 62, change_summary: JSON.stringify(MATRIX) })
  assert.equal(view.fitScore, 62)
  assert.doesNotMatch(helperSrc, /fitScore\s*\+|Math\.round\(|recalc/i)
})

test('Chinese overview uses actual evidence and never invents missing skills as experience', () => {
  const view = buildAnalysisView({ fit_score: 62, change_summary: JSON.stringify(MATRIX) })
  assert.match(view.overview, /中等匹配度/)
  assert.match(view.overview, /REST API/)
  assert.match(view.overview, /LLM \/ RAG/)
  assert.equal(mentionsAsExperience(view.overview, 'LLM / RAG 实践经验'), false)
  assert.equal(mentionsAsExperience(view.overview, 'Python'), false)
  assert.doesNotMatch(view.overview, /理想候选人/)
})

test('strong evidence appears under 主要优势', () => {
  const reqs = parseEvidenceMatrix(JSON.stringify(MATRIX)) || []
  const strengths = selectStrengths(reqs)
  assert.equal(strengths[0].name, 'REST API / 后端开发')
  assert.equal(strengths[0].kind, 'core')
  assert.ok(strengths.some((s) => s.name === 'Docker / CI/CD'))
  assert.equal(strengths.some((s) => s.level !== 'strong'), false)
  const view = buildAnalysisView({ fit_score: 62, change_summary: JSON.stringify(MATRIX) })
  assert.ok(view.strengths.some((s) => s.title === '数据库'))
  assert.equal(view.strengths.some((s) => s.title.includes('RAG')), false)
})

test('missing core evidence appears under 需要注意 before partial core', () => {
  const reqs = parseEvidenceMatrix(JSON.stringify(MATRIX)) || []
  const attention = selectAttention(reqs)
  assert.equal(attention[0].name, 'LLM / RAG 实践经验')
  assert.equal(attention[0].level, 'missing')
  assert.ok(attention.some((a) => a.name === 'Python' && a.level === 'partial'))
  const view = buildAnalysisView({ fit_score: 62, change_summary: JSON.stringify(MATRIX) })
  assert.equal(view.attention[0].title, 'LLM / RAG 实践经验')
})

test('verified change summary only mentions sections that actually changed', () => {
  const parsed = parseChangeSummary(JSON.stringify(MATRIX))
  const text = summarizeVerifiedChanges(parsed)
  assert.match(text, /Technical Skills/)
  assert.match(text, /Work Experience/)
  assert.doesNotMatch(text, /Education/)
  const skillsOnly = summarizeVerifiedChanges(parseChangeSummary(JSON.stringify({
    status: 'ok',
    resume_changes: [{
      section: 'Skills', type: 'modified', before: 'JS', after: 'TS', verified: true, jd_keywords: ['TS'],
    }],
    cover_letter: { items: [] },
    unsupported: [],
  })))
  assert.match(skillsOnly, /Technical Skills/)
  assert.doesNotMatch(skillsOnly, /Work Experience/)
})

test('no raw giant before/after diff is rendered on Analysis', () => {
  assert.doesNotMatch(panelSrc, /原来：|调整后：|whitespace-pre-wrap/)
  assert.match(editorSrc, /tab !== 'analysis'/)
  assert.match(editorSrc, /<AnalysisPanel/)
  assert.doesNotMatch(panelSrc, /VerifiedChangeSummary/)
})

test('old application without evidence matrix fails gracefully', () => {
  const view = buildAnalysisView({
    fit_score: 55,
    change_summary: JSON.stringify({
      status: 'ok',
      resume_changes: [{
        section: 'Summary', type: 'modified', before: 'support engineer', after: 'IT support', verified: true, jd_keywords: [],
      }],
      cover_letter: { items: [] },
      unsupported: [],
    }),
  })
  assert.equal(view.hasEvidenceMatrix, false)
  assert.equal(view.evidenceFallback, EVIDENCE_FALLBACK)
  assert.match(view.overview, new RegExp(EVIDENCE_FALLBACK))
  assert.equal(buildAnalysisView({ fit_score: 40, change_summary: null }).changeSummaryText, NO_VERIFIED_CHANGES)
})

test('opening Analysis adds zero Gemini calls', () => {
  assert.doesNotMatch(helperSrc, /gemini|generateContent|evaluateApplication|rescoreApplication|analyzeWithProgress/i)
  assert.doesNotMatch(panelSrc, /evaluateApplication|gemini|fetch\(/i)
  const analysisBranch = editorSrc.split("tab === 'analysis'")[1].split("tab === 'qa'")[0] || editorSrc.split('<AnalysisPanel')[1].split('Save as template')[0]
  assert.doesNotMatch(analysisBranch, /evaluateApplication|handleEvaluate/)
  assert.match(editorSrc, /<AnalysisPanel[\s\S]*fitScore=\{app\.fit_score\}/)
})

test('recommendation stays evidence-safe and never suggests fabricating', () => {
  const rec = buildRecommendation({
    hasEvidenceMatrix: true,
    missingCore: ['LLM / RAG 实践经验'],
    partialCore: ['Python'],
    hasUnsupported: false,
    fitScore: 62,
  })
  assert.match(rec, /LLM \/ RAG/)
  assert.doesNotMatch(rec, /把 RAG 加到简历|编造|虚构/)
  const unsafe = buildRecommendation({
    hasEvidenceMatrix: true, missingCore: [], partialCore: [], hasUnsupported: true, fitScore: 80,
  })
  assert.match(unsafe, /不要把未发生过的经历写进简历/)
})

test('简历 and 求职信 tabs plus download buttons remain in the editor', () => {
  assert.match(editorSrc, /t === 'coverletter' \? '求职信'/)
  assert.match(editorSrc, /t === 'analysis' \? '分析'/)
  assert.match(editorSrc, /handleDownload\('resume'\)/)
  assert.match(editorSrc, /handleDownload\('coverletter'\)/)
  assert.match(editorSrc, /VerifiedChangeSummary/)
  assert.doesNotMatch(editorSrc, /尚未评估/)
  assert.doesNotMatch(editorSrc, /handleEvaluate/)
})

test('keyword only present in tailored after-text is not treated as original evidence', () => {
  const view = buildAnalysisView({
    fit_score: 48,
    change_summary: JSON.stringify({
      status: 'ok',
      resume_changes: [{
        section: 'Skills',
        type: 'modified',
        before: 'Excel Windows',
        after: 'Excel Windows Kubernetes',
        jd_keywords: ['Kubernetes'],
        verified: true,
      }],
      cover_letter: { items: [] },
      unsupported: [{ text: 'Kubernetes', section: 'Skills' }],
    }),
  })
  assert.equal(view.strengths.some((s) => /Kubernetes/i.test(s.title)), false)
  assert.ok(view.attention.some((a) => /Kubernetes/i.test(a.title)))
})

test('evaluate API remains available but is not used by Analysis', () => {
  assert.match(apiSrc, /evaluateApplication/)
  assert.match(apiSrc, /\/applications\/\$\{id\}\/evaluate/)
  assert.doesNotMatch(panelSrc, /evaluateApplication/)
})
