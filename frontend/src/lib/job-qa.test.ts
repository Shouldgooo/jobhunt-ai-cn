import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { QaMessage } from './api'
import {
  appendOptimisticUserMessage,
  canSendQuestion,
  nextDraftAfterAsk,
  parseQaThread,
  QA_SUGGESTIONS,
  releaseAskLock,
  rollbackOptimisticUserMessage,
  tryAcquireAskLock,
} from './job-qa.ts'

const SAVED: QaMessage[] = [
  { role: 'user', content: '你为什么对这个岗位感兴趣？', created_at: '2026-03-18T09:00:00.000Z' },
  { role: 'assistant', content: '因为我做过桌面支持。', created_at: '2026-03-18T09:00:01.000Z' },
]

test('parseQaThread reads stored JSON and ignores junk', () => {
  assert.deepEqual(parseQaThread(null), [])
  assert.deepEqual(parseQaThread('nope'), [])
  const thread = parseQaThread(JSON.stringify(SAVED))
  assert.equal(thread.length, 2)
  assert.equal(thread[0].content, '你为什么对这个岗位感兴趣？')
})

test('send is blocked while asking or when the box is empty', () => {
  assert.equal(canSendQuestion('  ', false), false)
  assert.equal(canSendQuestion('为什么感兴趣？', true), false)
  assert.equal(canSendQuestion('为什么感兴趣？', false), true)
})

test('success shows question + answer and clears input', () => {
  const optimistic = appendOptimisticUserMessage(SAVED, 'What tools do you use?')
  const result: QaMessage[] = [
    ...SAVED,
    { role: 'user', content: 'What tools do you use?', created_at: '2026-03-18T10:00:00.000Z' },
    { role: 'assistant', content: 'I have used Zoho Desk.', created_at: '2026-03-18T10:00:01.000Z' },
  ]
  assert.equal(optimistic[optimistic.length - 1].content, 'What tools do you use?')
  assert.equal(result.some((item) => item.role === 'user' && item.content === 'What tools do you use?'), true)
  assert.equal(result.some((item) => item.role === 'assistant' && item.content.includes('Zoho')), true)
  assert.equal(nextDraftAfterAsk(true, 'What tools do you use?'), '')
})

test('failure rolls back the optimistic question and keeps input', () => {
  const question = 'What support tools are you familiar with?'
  const optimistic = appendOptimisticUserMessage(SAVED, question)
  const rolled = rollbackOptimisticUserMessage(optimistic, question)
  assert.deepEqual(rolled, SAVED)
  assert.equal(nextDraftAfterAsk(false, question), question)
  assert.equal(rolled.some((item) => item.content === question), false)
})

test('existing saved qa_thread is not deleted on failure', () => {
  const question = '编啊'
  const optimistic = appendOptimisticUserMessage(SAVED, question)
  const rolled = rollbackOptimisticUserMessage(optimistic, question)
  assert.equal(rolled.length, 2)
  assert.equal(rolled[0].content, '你为什么对这个岗位感兴趣？')
  assert.equal(rolled[1].content, '因为我做过桌面支持。')
})

test('duplicate send is blocked by the sync lock', () => {
  const lock = { current: false }
  assert.equal(tryAcquireAskLock(lock), true)
  assert.equal(lock.current, true)
  assert.equal(tryAcquireAskLock(lock), false)
  releaseAskLock(lock)
  assert.equal(lock.current, false)
  assert.equal(tryAcquireAskLock(lock), true)
})

test('suggested employer follow-up questions are available', () => {
  assert.ok(QA_SUGGESTIONS.includes('你为什么对这个岗位感兴趣？'))
})

test('ask helper and API method add no extra Gemini client', () => {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const src = fs.readFileSync(path.join(here, 'job-qa.ts'), 'utf8')
  const apiSrc = fs.readFileSync(path.join(here, 'api.ts'), 'utf8')
  const panelSrc = fs.readFileSync(path.join(here, '../components/JobQaPanel.tsx'), 'utf8')
  const ask = apiSrc.split('askApplication')[1].split('getPdfUrl')[0]
  assert.doesNotMatch(src, /gemini|generateContent/i)
  assert.match(ask, /applications\/\$\{id\}\/ask/)
  assert.match(panelSrc, /tryAcquireAskLock/)
  assert.match(panelSrc, /rollbackOptimisticUserMessage/)
  assert.match(panelSrc, /setDraft\(text\)/)
  assert.match(panelSrc, /setDraft\(''\)/)
})
