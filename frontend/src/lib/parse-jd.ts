/**
 * Deterministic JD metadata extraction. No network / no LLM.
 * Keep in sync with backend/jd-parser.js
 */

function clean(value: string): string {
  return String(value || '')
    .replace(/[#*_`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function matchLabeled(text: string, patterns: RegExp[]): string {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    for (const re of patterns) {
      const m = trimmed.match(re)
      if (m?.[1] && clean(m[1])) return clean(m[1])
    }
  }
  return ''
}

const TITLE_LABELS = [
  /^(?:job\s*title|title|position|role)\s*[:：]\s*(.+)$/i,
]
const COMPANY_LABELS = [
  /^(?:company|employer|organisation|organization)\s*[:：]\s*(.+)$/i,
]
const LOCATION_LABELS = [
  /^(?:location|based\s*in|work\s*location)\s*[:：]\s*(.+)$/i,
]

function headingTitle(text: string): string {
  const m = String(text || '').replace(/\r\n/g, '\n').match(/^\s{0,3}#{1,3}\s+(.+)$/m)
  return m ? clean(m[1]) : ''
}

export function parseJd(text: string): { job_title: string; company: string; location: string } {
  const source = typeof text === 'string' ? text : ''
  if (!source.trim()) {
    return { job_title: '', company: '', location: '' }
  }

  return {
    job_title: matchLabeled(source, TITLE_LABELS) || headingTitle(source),
    company: matchLabeled(source, COMPANY_LABELS),
    location: matchLabeled(source, LOCATION_LABELS),
  }
}

export function createGenerationLock() {
  let busy = false
  return {
    tryStart() {
      if (busy) return false
      busy = true
      return true
    },
    finish() { busy = false },
    isBusy() { return busy },
  }
}
