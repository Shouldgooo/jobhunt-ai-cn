import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyAnalyzeEvent,
  CONNECTION_LOST,
  consumeAnalyzeNdjson,
  formatElapsedWait,
  INITIAL_GEN_PROGRESS,
  isUserAbortError,
  outcomeFromAnalyzeError,
  parseNdjsonChunk,
  shouldPreserveDraftForm,
  shouldTickElapsed,
} from './analyze-stream.ts'

const APP = {
  id: 3,
  fit_score: 80,
  job_title: 'Support Engineer',
  company: 'Northwind Analytics',
  location: 'Melbourne VIC',
  detected_skills: ['TypeScript'],
  cover_letter_available: false,
  theme: 'classic',
}

test('frontend parses a successful NDJSON progress sequence', () => {
  const chunk = [
    '{"type":"progress","stage":"accepted","progress":5,"message":"请求已接受…"}',
    '{"type":"progress","stage":"generating","progress":35,"message":"AI 正在分析 JD 并生成定制简历…"}',
    '{"type":"complete","progress":100,"message":"生成完成","application":{"id":3}}',
    '',
  ].join('\n')
  const { events, rest } = parseNdjsonChunk(chunk)
  assert.equal(events.length, 3)
  assert.equal(events[0].type, 'progress')
  assert.equal(events[1].progress, 35)
  assert.equal(events[2].type, 'complete')
  assert.equal(rest, '')
})

test('frontend AbortError is treated as user cancellation when requested', () => {
  const abort = new Error('The operation was aborted.')
  abort.name = 'AbortError'
  assert.equal(isUserAbortError(abort), true)
  const outcome = outcomeFromAnalyzeError(abort, { userCancelled: true })
  assert.equal(outcome.phase, 'cancelled')
  assert.equal(outcome.message, '生成已取消')
})

test('elapsed-time display uses wall-clock seconds and minutes', () => {
  assert.equal(formatElapsedWait(18000), '已等待 18 秒')
  assert.equal(formatElapsedWait(72000), '已等待 1 分 12 秒')
  assert.equal(formatElapsedWait(5 * 60 * 1000 + 34 * 1000), '已等待 5 分 34 秒')
})

test('elapsed timer ticks only while running and stops on terminal states', () => {
  assert.equal(shouldTickElapsed('running'), true)
  assert.equal(shouldTickElapsed('complete'), false)
  assert.equal(shouldTickElapsed('cancelled'), false)
  assert.equal(shouldTickElapsed('error'), false)
  assert.equal(shouldTickElapsed('idle'), false)
})

test('AbortError without an explicit user click is a connection error', () => {
  const abort = new Error('The operation was aborted.')
  abort.name = 'AbortError'
  const outcome = outcomeFromAnalyzeError(abort, { userCancelled: false })
  assert.equal(outcome.phase, 'error')
  assert.equal(outcome.message, CONNECTION_LOST)
  assert.equal(outcome.message.includes('规定时间'), false)
  assert.notEqual(outcome.message, '生成已取消')
})

test('backend cancelled event is not labelled USER_CANCELLED', () => {
  const state = applyAnalyzeEvent({
    ...INITIAL_GEN_PROGRESS,
    phase: 'running',
    progress: 35,
    message: 'AI 正在分析 JD 并生成定制简历…',
    stage: 'generating',
    waitingOnModel: true,
  }, { type: 'cancelled', message: '生成已取消' })
  assert.notEqual(state.phase, 'cancelled')
  assert.notEqual(state.message, '生成已取消')
  const outcome = outcomeFromAnalyzeError(Object.assign(new Error(CONNECTION_LOST), { disconnected: true }), {
    userCancelled: false,
  })
  assert.equal(outcome.phase, 'error')
  assert.equal(outcome.message, CONNECTION_LOST)
})

test('form data remains after cancellation or error', () => {
  const form = {
    job_title: 'Support Engineer',
    company: 'Northwind Analytics',
    location: 'Melbourne VIC',
    jd: 'Paste stays here',
  }
  assert.equal(shouldPreserveDraftForm('cancelled'), true)
  assert.equal(shouldPreserveDraftForm('error'), true)
  assert.deepEqual(form, {
    job_title: 'Support Engineer',
    company: 'Northwind Analytics',
    location: 'Melbourne VIC',
    jd: 'Paste stays here',
  })
})

test('waiting on Gemini does not invent extra percentage', () => {
  let state = applyAnalyzeEvent(INITIAL_GEN_PROGRESS, {
    type: 'progress',
    stage: 'generating',
    progress: 35,
    message: 'AI 正在分析 JD 并生成定制简历…',
  })
  assert.equal(state.progress, 35)
  assert.equal(state.waitingOnModel, true)
  state = applyAnalyzeEvent(state, {
    type: 'progress',
    stage: 'retrying',
    progress: 35,
    message: 'Gemini 暂时繁忙，正在重试（1/3）…',
  })
  assert.equal(state.progress, 35)
  assert.equal(state.waitingOnModel, true)
})

test('consumeAnalyzeNdjson returns complete payload and handles abort event', async () => {
  const text = [
    '{"type":"progress","stage":"saving","progress":95,"message":"正在保存申请记录…"}',
    `{"type":"complete","progress":100,"message":"生成完成","application":${JSON.stringify(APP)}}`,
    '',
  ].join('\n')
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })
  const events: unknown[] = []
  const result = await consumeAnalyzeNdjson(stream, (e) => events.push(e))
  assert.equal(result.id, 3)
  assert.equal((events.at(-1) as { type: string }).type, 'complete')
})

test('consumeAnalyzeNdjson cancelled event is a disconnect, not user cancel', async () => {
  const text = [
    '{"type":"progress","stage":"generating","progress":35,"message":"AI 正在分析 JD 并生成定制简历…"}',
    '{"type":"cancelled","progress":0,"message":"生成已取消"}',
    '',
  ].join('\n')
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })
  await assert.rejects(
    () => consumeAnalyzeNdjson(stream, () => {}),
    (err: Error & { disconnected?: boolean }) => err.disconnected === true && err.message === CONNECTION_LOST,
  )
  const outcome = outcomeFromAnalyzeError(Object.assign(new Error(CONNECTION_LOST), { disconnected: true }), {
    userCancelled: false,
  })
  assert.equal(outcome.phase, 'error')
  assert.notEqual(outcome.message, '生成已取消')
})
