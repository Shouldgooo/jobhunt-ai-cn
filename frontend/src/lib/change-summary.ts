export interface VerifiedResumeChange {
  section: string
  type: 'added' | 'removed' | 'modified'
  before: string
  after: string
  jd_keywords?: string[]
  verified: boolean
}

export interface CoverLetterHighlight {
  text: string
  jd_keywords?: string[]
  verified: boolean
}

export interface ChangeSummary {
  status: 'ok' | 'empty' | 'unavailable'
  message?: string
  resume_changes: VerifiedResumeChange[]
  cover_letter: { items: CoverLetterHighlight[] }
  unsupported: { text: string; section?: string; excerpt?: string }[]
  unsupported_experience: { kind: string; text: string }[]
}

export function parseChangeSummary(raw: string | null | undefined): ChangeSummary | null {
  if (raw == null || raw === '') return null
  try {
    const data = JSON.parse(raw) as ChangeSummary
    if (!data || typeof data !== 'object') return null
    return {
      status: data.status === 'unavailable' || data.status === 'empty' || data.status === 'ok'
        ? data.status
        : 'unavailable',
      message: typeof data.message === 'string' ? data.message : '',
      resume_changes: Array.isArray(data.resume_changes)
        ? data.resume_changes.filter((c) => c && c.verified === true)
        : [],
      cover_letter: {
        items: Array.isArray(data.cover_letter?.items)
          ? data.cover_letter.items.filter((i) => i && i.verified === true && i.text)
          : [],
      },
      unsupported: Array.isArray(data.unsupported) ? data.unsupported : [],
      unsupported_experience: Array.isArray(data.unsupported_experience) ? data.unsupported_experience : [],
    }
  } catch {
    return {
      status: 'unavailable',
      message: '暂时无法生成可靠的改动概要。',
      resume_changes: [],
      cover_letter: { items: [] },
      unsupported: [],
      unsupported_experience: [],
    }
  }
}
