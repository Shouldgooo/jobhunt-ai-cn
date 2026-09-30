import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  applyBulkStatusToApps,
  beginBulkUpdate,
  BULK_APPLIED_STATUS,
  BULK_BUTTON_LABEL,
  BULK_CONFIRM_TEXT,
  canOpenBulkConfirm,
  cancelBulkConfirm,
  finishBulkUpdateError,
  finishBulkUpdateSuccess,
  formatBulkAppliedSuccess,
  INITIAL_BULK_STATUS_UI,
  openBulkConfirm,
} from './bulk-status.ts'

test('confirmation is required before an update can start', () => {
  assert.equal(beginBulkUpdate(INITIAL_BULK_STATUS_UI), null)
  const opened = openBulkConfirm(INITIAL_BULK_STATUS_UI, 3)
  assert.equal(opened.confirmOpen, true)
  assert.equal(opened.submitting, false)
  const started = beginBulkUpdate(opened)
  assert.ok(started)
  assert.equal(started.submitting, true)
  assert.equal(started.confirmOpen, true)
})

test('empty history cannot open the confirm dialog', () => {
  assert.equal(canOpenBulkConfirm(0, false), false)
  const next = openBulkConfirm(INITIAL_BULK_STATUS_UI, 0)
  assert.deepEqual(next, INITIAL_BULK_STATUS_UI)
})

test('duplicate confirm is ignored while loading', () => {
  const opened = openBulkConfirm(INITIAL_BULK_STATUS_UI, 2)
  const first = beginBulkUpdate(opened)
  assert.ok(first)
  assert.equal(beginBulkUpdate(first), null)
  assert.equal(canOpenBulkConfirm(2, first.submitting), false)
  assert.equal(cancelBulkConfirm(first).confirmOpen, true)
})

test('UI refresh maps every application to 已申请 / applied', () => {
  const apps = [
    { id: 1, status: 'not_started', company: 'A' },
    { id: 2, status: 'rejected', company: 'B' },
  ]
  const next = applyBulkStatusToApps(apps, BULK_APPLIED_STATUS)
  assert.deepEqual(next.map((a) => a.status), ['applied', 'applied'])
  assert.equal(next[0].company, 'A')
  assert.equal(next[1].company, 'B')
  assert.equal(apps[0].status, 'not_started')
})

test('success and error messages leave the user able to retry', () => {
  assert.equal(formatBulkAppliedSuccess(12), '已将 12 条申请标记为「已申请」。')
  const ok = finishBulkUpdateSuccess(12)
  assert.equal(ok.submitting, false)
  assert.equal(ok.confirmOpen, false)
  assert.equal(ok.message, '已将 12 条申请标记为「已申请」。')
  const fail = finishBulkUpdateError('网络错误')
  assert.equal(fail.submitting, false)
  assert.equal(fail.error, '网络错误')
  assert.equal(canOpenBulkConfirm(4, fail.submitting), true)
})

test('copy matches the History button and confirm dialog', () => {
  assert.equal(BULK_BUTTON_LABEL, '全部标记为已申请')
  assert.equal(BULK_CONFIRM_TEXT, '确定要将全部申请的状态改为「已申请」吗？')
})

test('this module adds zero Gemini/LLM calls', () => {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const src = fs.readFileSync(path.join(here, 'bulk-status.ts'), 'utf8')
  const apiSrc = fs.readFileSync(path.join(here, 'api.ts'), 'utf8')
  const patchAll = apiSrc.split('patchAllApplicationStatus')[1].split('deleteApplication')[0]
  assert.doesNotMatch(src, /gemini|generateContent|callLLM|ollama/i)
  assert.doesNotMatch(patchAll, /analyze|gemini|generateContent|callLLM|ollama/i)
  assert.match(patchAll, /applications\/status\/all/)
})
