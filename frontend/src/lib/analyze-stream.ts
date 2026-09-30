export interface AnalyzeCompletePayload {
  id: number
  fit_score: number
  job_title: string
  company?: string
  location?: string
  detected_skills: string[]
  cover_letter_available: boolean
  theme: string
}

export type AnalyzeStreamEvent<T = AnalyzeCompletePayload> =
  | { type: 'progress'; stage: string; progress: number; message: string }
  | { type: 'complete'; progress: number; message?: string; application: T }
  | { type: 'cancelled'; progress?: number; message?: string }
  | { type: 'error'; progress?: number; status?: number; error: string }

export type GenPhase = 'idle' | 'running' | 'complete' | 'cancelled' | 'error'

export interface GenProgressState {
  phase: GenPhase
  progress: number
  message: string
  stage: string
  waitingOnModel: boolean
  error?: string
  application?: AnalyzeCompletePayload
}

export function formatElapsedWait(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000))
  if (sec < 60) return `已等待 ${sec} 秒`
  const minutes = Math.floor(sec / 60)
  const rest = sec % 60
  return `已等待 ${minutes} 分 ${rest} 秒`
}

export function shouldTickElapsed(phase: GenPhase): boolean {
  return phase === 'running'
}

export const INITIAL_GEN_PROGRESS: GenProgressState = {
  phase: 'idle',
  progress: 0,
  message: '',
  stage: '',
  waitingOnModel: false,
}

const WAITING_STAGES = new Set(['sending', 'generating', 'retrying'])

export function isUserAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { name?: string; code?: string; cancelled?: boolean }
  return Boolean(
    e.cancelled
    || e.name === 'AbortError'
    || e.name === 'CanceledError'
    || e.code === 'ERR_CANCELED'
  )
}

export function shouldPreserveDraftForm(phase: GenPhase): boolean {
  return phase === 'cancelled' || phase === 'error' || phase === 'running'
}

export const CONNECTION_LOST = '连接已中断，生成未完成。'

export function outcomeFromAnalyzeError(
  err: unknown,
  { userCancelled }: { userCancelled: boolean },
): { phase: 'cancelled' | 'error'; message: string } {
  if (userCancelled) {
    return { phase: 'cancelled', message: '生成已取消' }
  }
  if (isUserAbortError(err) || (err as { disconnected?: boolean } | null)?.disconnected) {
    return { phase: 'error', message: CONNECTION_LOST }
  }
  return {
    phase: 'error',
    message: err instanceof Error ? err.message : '未知错误',
  }
}

export function applyAnalyzeEvent(state: GenProgressState, event: AnalyzeStreamEvent): GenProgressState {
  if (event.type === 'progress') {
    return {
      ...state,
      phase: 'running',
      progress: event.progress,
      message: event.message,
      stage: event.stage,
      waitingOnModel: WAITING_STAGES.has(event.stage),
    }
  }
  if (event.type === 'complete') {
    return {
      ...state,
      phase: 'complete',
      progress: 100,
      message: event.message || '生成完成',
      stage: 'complete',
      waitingOnModel: false,
      application: event.application,
    }
  }
  if (event.type === 'cancelled') {
    // Backend cannot know whether the user clicked 取消生成.
    return {
      ...state,
      waitingOnModel: false,
    }
  }
  if (event.type === 'error') {
    return {
      ...state,
      phase: 'error',
      message: event.error,
      error: event.error,
      waitingOnModel: false,
    }
  }
  return state
}

export function parseNdjsonChunk<T = AnalyzeCompletePayload>(buffer: string): { events: AnalyzeStreamEvent<T>[]; rest: string } {
  const lines = buffer.split('\n')
  const rest = lines.pop() ?? ''
  const events: AnalyzeStreamEvent<T>[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    events.push(JSON.parse(trimmed) as AnalyzeStreamEvent<T>)
  }
  return { events, rest }
}

export async function consumeAnalyzeNdjson<T = AnalyzeCompletePayload>(
  stream: ReadableStream<Uint8Array> | null,
  onEvent: (event: AnalyzeStreamEvent<T>) => void,
): Promise<T> {
  if (!stream) throw new Error('生成响应为空')
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result: T | null = null

  const handle = (event: AnalyzeStreamEvent<T>) => {
    onEvent(event)
    if (event.type === 'complete') result = event.application
    if (event.type === 'error') {
      const err = new Error(event.error)
      ;(err as Error & { statusCode?: number }).statusCode = event.status
      throw err
    }
    if (event.type === 'cancelled') {
      const err = new Error(CONNECTION_LOST)
      ;(err as Error & { disconnected?: boolean }).disconnected = true
      throw err
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parsed = parseNdjsonChunk<T>(buffer)
    buffer = parsed.rest
    for (const event of parsed.events) handle(event)
  }
  if (buffer.trim()) {
    handle(JSON.parse(buffer.trim()) as AnalyzeStreamEvent<T>)
  }
  if (!result) {
    const err = new Error(CONNECTION_LOST)
    ;(err as Error & { disconnected?: boolean }).disconnected = true
    throw err
  }
  return result
}
