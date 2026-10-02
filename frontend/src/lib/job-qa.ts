import type { QaMessage } from './api'

export const QA_SUGGESTIONS = [
  '你为什么对这个岗位感兴趣？',
  '你为什么想加入这家公司？',
  '用一段话介绍你自己。',
  '你能为这个岗位带来什么？',
] as const

export type AskLock = { current: boolean }

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

export function tryAcquireAskLock(lock: AskLock): boolean {
  if (lock.current) return false
  lock.current = true
  return true
}

export function releaseAskLock(lock: AskLock): void {
  lock.current = false
}

export function appendOptimisticUserMessage(
  messages: QaMessage[],
  question: string,
  createdAt = new Date().toISOString(),
): QaMessage[] {
  return [...messages, { role: 'user', content: question, created_at: createdAt }]
}

export function rollbackOptimisticUserMessage(messages: QaMessage[], question: string): QaMessage[] {
  if (!messages.length) return messages
  const last = messages[messages.length - 1]
  if (last.role === 'user' && last.content === question) {
    return messages.slice(0, -1)
  }
  return messages
}

export function nextDraftAfterAsk(ok: boolean, question: string): string {
  return ok ? '' : question
}
