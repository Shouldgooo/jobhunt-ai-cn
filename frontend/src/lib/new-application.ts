import type { GenPhase } from './analyze-stream'
import {
  pdfExportFilename,
  parseContentDispositionFilename,
} from '../../../shared/pdf-filename.js'

export { parseContentDispositionFilename }

export const DEFAULT_AI_RESUME = true
export const DEFAULT_AI_COVER_LETTER = false

export function canToggleCoverLetter(_resumeSelected?: boolean): boolean {
  return true
}

export function nextCoverLetterSelection(_resumeSelected: boolean, _coverSelected: boolean, next: boolean): boolean {
  return next
}

export function usesAiGeneration(hasJd: boolean, resumeSelected: boolean, coverSelected: boolean): boolean {
  return hasJd && (resumeSelected || coverSelected)
}

export function canShowGenerationDownloads(opts: {
  phase: GenPhase
  progress: number
  applicationId?: number | null
}): boolean {
  return opts.phase === 'complete'
    && opts.progress >= 100
    && Number(opts.applicationId) > 0
}

export function shouldShowCoverLetterDownload(coverLetterAvailable: boolean | undefined): boolean {
  return coverLetterAvailable === true
}

export function shouldShowResumeDownload(resumeAvailable: boolean | undefined): boolean {
  return resumeAvailable !== false
}

export function generationDownloadTypes(
  coverLetterAvailable: boolean | undefined | {
    resumeAvailable?: boolean
    coverLetterAvailable?: boolean
  },
): Array<'resume' | 'coverletter'> {
  if (coverLetterAvailable && typeof coverLetterAvailable === 'object') {
    const types: Array<'resume' | 'coverletter'> = []
    if (shouldShowResumeDownload(coverLetterAvailable.resumeAvailable)) types.push('resume')
    if (shouldShowCoverLetterDownload(coverLetterAvailable.coverLetterAvailable)) types.push('coverletter')
    return types
  }
  return shouldShowCoverLetterDownload(coverLetterAvailable) ? ['resume', 'coverletter'] : ['resume']
}

export function generationSuccessCopy(
  coverLetterAvailable: boolean | {
    resumeAvailable?: boolean
    coverLetterAvailable?: boolean
    coverLetterError?: string | null
  },
): { title: string; body: string } {
  const opts = typeof coverLetterAvailable === 'boolean'
    ? { resumeAvailable: true, coverLetterAvailable, coverLetterError: null }
    : coverLetterAvailable

  if (opts.coverLetterError) {
    return {
      title: opts.resumeAvailable === false ? '求职信未生成' : '简历已生成',
      body: `求职信生成失败：${opts.coverLetterError}`,
    }
  }
  if (opts.coverLetterAvailable && opts.resumeAvailable === false) {
    return { title: '生成完成', body: '求职信已根据该职位完成生成。' }
  }
  if (opts.coverLetterAvailable) {
    return { title: '生成完成', body: '简历和求职信已完成生成。' }
  }
  return { title: '生成完成', body: '简历已根据该职位完成定制。' }
}

export function editorPathForApplication(id: number): string {
  return `/editor/${id}`
}

export function pdfDownloadFilename(
  app: { company?: string; job_title?: string },
  type: 'resume' | 'coverletter',
): string {
  return pdfExportFilename({
    jobTitle: app.job_title,
    company: app.company,
    type,
  })
}

export function existingPdfExportUrl(id: number, type: 'resume' | 'coverletter'): string {
  return `/api/applications/${id}/pdf?type=${type}`
}

export function isExistingPdfExportUrl(url: string, id: number, type: 'resume' | 'coverletter'): boolean {
  return url.includes(`/applications/${id}/pdf`) && url.includes(`type=${type}`)
}

export async function downloadExistingPdf(
  id: number,
  type: 'resume' | 'coverletter',
  app: { company?: string; job_title?: string },
  fetchImpl: typeof fetch = fetch,
  url: string = existingPdfExportUrl(id, type),
): Promise<void> {
  const res = await fetchImpl(url)
  if (!res.ok) {
    const data = await res.json().catch(() => ({} as { error?: string }))
    throw new Error(data.error ?? 'PDF 生成失败')
  }
  const blob = await res.blob()
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = parseContentDispositionFilename(res.headers.get('content-disposition'))
    || pdfDownloadFilename(app, type)
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(href), 100)
}
