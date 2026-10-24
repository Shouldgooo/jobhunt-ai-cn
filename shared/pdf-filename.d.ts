export const PDF_FILENAME_CANDIDATE_NAME: 'SIHUA_TANG'
export const DEFAULT_JOB_TITLE: 'Role'
export const DEFAULT_COMPANY: 'Company'

export function sanitizePdfFilenamePart(value: unknown, fallback: string): string

export function pdfExportFilename(opts?: {
  jobTitle?: string | null
  company?: string | null
  type?: string | null
}): string

export function parseContentDispositionFilename(header: string | null | undefined): string

export function contentDisposition(filename: string): string
