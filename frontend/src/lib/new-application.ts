import type { GenPhase } from './analyze-stream'

export const DEFAULT_AI_RESUME = true
export const DEFAULT_AI_COVER_LETTER = false

export function canToggleCoverLetter(resumeSelected: boolean): boolean {
  return resumeSelected
}

export function nextCoverLetterSelection(resumeSelected: boolean, _coverSelected: boolean, next: boolean): boolean {
  if (!resumeSelected) return false
  return next
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

export function generationDownloadTypes(coverLetterAvailable: boolean | undefined): Array<'resume' | 'coverletter'> {
  return shouldShowCoverLetterDownload(coverLetterAvailable) ? ['resume', 'coverletter'] : ['resume']
}

export function generationSuccessCopy(coverLetterAvailable: boolean): { title: string; body: string } {
  if (coverLetterAvailable) {
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
  const safe = (value: string) => value.replace(/[\\/:*?"<>|]+/g, '_').trim() || type
  return `${safe(app.company || 'company')}_${safe(app.job_title || type)}_${type}.pdf`
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
  a.download = pdfDownloadFilename(app, type)
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(href), 100)
}
