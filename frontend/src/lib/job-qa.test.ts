import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { canSendQuestion, parseQaThread, QA_SUGGESTIONS } from './job-qa.ts'

test('parseQaThread reads stored JSON and ignores junk', () => {
  assert.deepEqual(parseQaThread(null), [])
  assert.deepEqual(parseQaThread('nope'), [])
  const thread = parseQaThread(JSON.stringify([
    { role: 'user', content: '你为什么对这个岗位感兴趣？' },
    { role: 'assistant', content: '因为…' },
  ]))
  assert.equal(thread.length, 2)
  assert.equal(thread[0].content, '你为什么对这个岗位感兴趣？')
})

test('send is blocked while asking or when the box is empty', () => {
  assert.equal(canSendQuestion('  ', false), false)
  assert.equal(canSendQuestion('为什么感兴趣？', true), false)
  assert.equal(canSendQuestion('为什么感兴趣？', false), true)
})

test('suggested employer follow-up questions are available', () => {
  assert.ok(QA_SUGGESTIONS.includes('你为什么对这个岗位感兴趣？'))
})

test('ask helper and API method add no extra Gemini client', () => {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const src = fs.readFileSync(path.join(here, 'job-qa.ts'), 'utf8')
  const apiSrc = fs.readFileSync(path.join(here, 'api.ts'), 'utf8')
  const ask = apiSrc.split('askApplication')[1].split('getPdfUrl')[0]
  assert.doesNotMatch(src, /gemini|generateContent/i)
  assert.match(ask, /applications\/\$\{id\}\/ask/)
})
