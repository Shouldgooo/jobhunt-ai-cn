import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseChangeSummary } from './change-summary.ts'

test('parseChangeSummary drops unverified claims', () => {
  const parsed = parseChangeSummary(JSON.stringify({
    status: 'ok',
    resume_changes: [
      { section: 'Skills', type: 'modified', before: 'JS', after: 'TS', verified: true, jd_keywords: ['TS'] },
      { section: 'Skills', type: 'modified', before: 'x', after: '强化了 React', verified: false },
    ],
    cover_letter: { items: [{ text: 'fake', verified: false }] },
    unsupported: [],
  }))
  assert.equal(parsed?.resume_changes.length, 1)
  assert.equal(parsed?.resume_changes[0].after, 'TS')
  assert.equal(parsed?.cover_letter.items.length, 0)
})

test('parseChangeSummary treats missing data as absent, not invented', () => {
  assert.equal(parseChangeSummary(null), null)
  assert.equal(parseChangeSummary(undefined), null)
})
