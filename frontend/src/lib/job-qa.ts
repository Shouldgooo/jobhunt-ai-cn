import type { QaMessage } from './api'

export const QA_SUGGESTIONS = [
  '你为什么对这个岗位感兴趣？',
  '你为什么想加入这家公司？',
  '用一段话介绍你自己。',
  '你能为这个岗位带来什么？',
] as const

export function parseQaThread(raw: string | QaMessage[] | null | undefined): QaMessage[] {
  if (Array.isArray(raw)) {
    return raw.filter((item) => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string')
  }
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item) => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string')
  } catch {
    return []
  }
}

export function canSendQuestion(question: string, asking: boolean): boolean {
  return question.trim().length > 0 && !asking
}
