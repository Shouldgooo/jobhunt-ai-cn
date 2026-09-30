import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  canShowGenerationDownloads,
  canToggleCoverLetter,
  DEFAULT_AI_COVER_LETTER,
  DEFAULT_AI_RESUME,
  downloadExistingPdf,
  editorPathForApplication,
  existingPdfExportUrl,
  generationDownloadTypes,
  generationSuccessCopy,
  isExistingPdfExportUrl,
  nextCoverLetterSelection,
  pdfDownloadFilename,
  shouldShowCoverLetterDownload,
} from './new-application.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const pageSrc = fs.readFileSync(path.join(here, '../pages/NewApplication.tsx'), 'utf8')
const helperSrc = fs.readFileSync(path.join(here, 'new-application.ts'), 'utf8')
const apiSrc = fs.readFileSync(path.join(here, 'api.ts'), 'utf8')
const pdfRoute = fs.readFileSync(path.join(here, '../../../backend/server.js'), 'utf8')
  .split("api.get('/applications/:id/pdf'")[1]
  .split('api.post')[0]

test('resume is selected by default and cover letter is not', () => {
  assert.equal(DEFAULT_AI_RESUME, true)
  assert.equal(DEFAULT_AI_COVER_LETTER, false)
})

test('user can manually select cover letter when resume generation is on', () => {
  assert.equal(canToggleCoverLetter(true), true)
  assert.equal(nextCoverLetterSelection(true, false, true), true)
  assert.equal(nextCoverLetterSelection(true, true, false), false)
})

test('cover letter cannot stay selected if resume generation is off', () => {
  assert.equal(canToggleCoverLetter(false), false)
  assert.equal(nextCoverLetterSelection(false, true, true), false)
})

test('download buttons appear only after successful save with an application id', () => {
  const saved = { phase: 'complete' as const, progress: 100, applicationId: 12 }
  assert.equal(canShowGenerationDownloads(saved), true)
  assert.equal(canShowGenerationDownloads({ phase: 'running', progress: 85, applicationId: undefined }), false)
  assert.equal(canShowGenerationDownloads({ phase: 'running', progress: 90, applicationId: undefined }), false)
  assert.equal(canShowGenerationDownloads({ phase: 'running', progress: 95, applicationId: 12 }), false)
  assert.equal(canShowGenerationDownloads({ phase: 'complete', progress: 100, applicationId: 0 }), false)
})

test('failed or cancelled generation does not expose downloads', () => {
  assert.equal(canShowGenerationDownloads({ phase: 'error', progress: 0, applicationId: 12 }), false)
  assert.equal(canShowGenerationDownloads({ phase: 'cancelled', progress: 35, applicationId: undefined }), false)
  assert.equal(canShowGenerationDownloads({ phase: 'cancelled', progress: 100, applicationId: 12 }), false)
})

test('successful generation exposes 下载简历; cover-letter download only when generated', () => {
  assert.equal(shouldShowCoverLetterDownload(true), true)
  assert.equal(shouldShowCoverLetterDownload(false), false)
  assert.equal(shouldShowCoverLetterDownload(undefined), false)
  assert.deepEqual(generationDownloadTypes(false), ['resume'])
  assert.deepEqual(generationDownloadTypes(true), ['resume', 'coverletter'])
  assert.match(pageSrc, /下载简历/)
  assert.match(pageSrc, /下载求职信/)
  assert.match(pageSrc, /查看分析结果 →/)
  assert.match(pageSrc, /shouldShowCoverLetterDownload\(result\.cover_letter_available\)/)
})

test('查看分析结果 navigates to the generated application', () => {
  assert.equal(editorPathForApplication(12), '/editor/12')
})

test('PDF download uses the existing per-application export URL', () => {
  const resume = existingPdfExportUrl(12, 'resume')
  const cover = existingPdfExportUrl(12, 'coverletter')
  assert.equal(isExistingPdfExportUrl(resume, 12, 'resume'), true)
  assert.equal(isExistingPdfExportUrl(cover, 12, 'coverletter'), true)
  assert.equal(resume.includes('/applications/12/pdf'), true)
  assert.equal(pdfDownloadFilename({ company: 'Northwind', job_title: 'IT Support' }, 'resume'), 'Northwind_IT Support_resume.pdf')
})

test('resume and cover-letter downloads add zero Gemini calls and do not create applications', () => {
  const getPdf = apiSrc.split('getPdfUrl')[1].split('preview(')[0]
  const downloadFn = pageSrc.split('handleDownloadGenerated')[1].split('function handleCancelGeneration')[0]
  assert.doesNotMatch(helperSrc, /gemini|generateContent|analyzeWithProgress|createApplication/i)
  assert.doesNotMatch(getPdf, /gemini|generateContent|analyze/i)
  assert.doesNotMatch(downloadFn, /analyzeWithProgress|createApplication|gemini/i)
  assert.match(getPdf, /\/applications\/\$\{id\}\/pdf/)
  assert.match(downloadFn, /downloadExistingPdf/)
  assert.match(downloadFn, /api\.getPdfUrl\(result\.id, type\)/)
  assert.doesNotMatch(pdfRoute, /gemini|generateContent|generateApplication/i)
  assert.match(pdfRoute, /exportResumePDF/)
  assert.match(pdfRoute, /exportCoverLetterPDF/)
})

test('New Application defaults, stays on page after AI success, and keeps cancel/retry', () => {
  assert.match(pageSrc, /ai_customize: DEFAULT_AI_RESUME/)
  assert.match(pageSrc, /ai_cover_letter: DEFAULT_AI_COVER_LETTER/)
  assert.match(pageSrc, /generate_cover_letter: form\.ai_cover_letter/)
  assert.match(pageSrc, />简历</)
  assert.match(pageSrc, />求职信</)
  assert.match(pageSrc, /canShowGenerationDownloads/)
  assert.match(pageSrc, /handleCancelGeneration/)
  assert.match(pageSrc, /onRetry=\{genProgress\.phase === 'error' \? handleSubmit : undefined\}/)
  const aiBranch = pageSrc.split('if (useAI) {')[1].split('} else {')[0]
  assert.doesNotMatch(aiBranch, /navigate\(/)
  assert.match(aiBranch, /analyzeWithProgress/)
  assert.match(pageSrc, /navigate\(editorPathForApplication\(result\.id\)\)/)
  assert.doesNotMatch(pageSrc, /打开编辑器并导出 PDF/)
})

test('downloadExistingPdf hits the saved application PDF once and never regenerates', async () => {
  const urls: string[] = []
  const clicks: string[] = []
  const previousDocument = globalThis.document
  const previousCreateObjectURL = URL.createObjectURL
  const previousRevokeObjectURL = URL.revokeObjectURL
  URL.createObjectURL = () => 'blob:mock-pdf'
  URL.revokeObjectURL = () => {}
  globalThis.document = {
    createElement: () => {
      const a = {
        href: '',
        download: '',
        click() { clicks.push(a.download) },
      }
      return a
    },
    body: { appendChild() {}, removeChild() {} },
  } as unknown as Document
  try {
    await downloadExistingPdf(12, 'resume', { company: 'Northwind', job_title: 'IT Support' }, async (url) => {
      urls.push(String(url))
      return {
        ok: true,
        blob: async () => new Blob(['pdf']),
        json: async () => ({}),
      } as Response
    })
    await downloadExistingPdf(12, 'coverletter', { company: 'Northwind', job_title: 'IT Support' }, async (url) => {
      urls.push(String(url))
      return {
        ok: true,
        blob: async () => new Blob(['pdf']),
        json: async () => ({}),
      } as Response
    })
  } finally {
    globalThis.document = previousDocument
    URL.createObjectURL = previousCreateObjectURL
    URL.revokeObjectURL = previousRevokeObjectURL
  }
  assert.equal(urls.length, 2)
  assert.equal(clicks.length, 2)
  assert.equal(isExistingPdfExportUrl(urls[0], 12, 'resume'), true)
  assert.equal(isExistingPdfExportUrl(urls[1], 12, 'coverletter'), true)
  assert.equal(clicks[0], 'Northwind_IT Support_resume.pdf')
  assert.equal(clicks[1], 'Northwind_IT Support_coverletter.pdf')
})

test('success copy stays compact for resume-only vs resume+cover', () => {
  assert.equal(generationSuccessCopy(false).title, '生成完成')
  assert.equal(generationSuccessCopy(false).body, '简历已根据该职位完成定制。')
  assert.equal(generationSuccessCopy(true).body, '简历和求职信已完成生成。')
})
