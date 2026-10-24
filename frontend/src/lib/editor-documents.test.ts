import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  applyCoverLetterUpdate,
  COVER_REGENERATE_CONFIRM,
  documentFieldForTab,
  shouldConfirmCoverRegenerate,
  shouldFlushDocumentOnTabChange,
} from './editor-documents.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const editorSrc = fs.readFileSync(path.join(here, '../pages/Editor.tsx'), 'utf8')
const apiSrc = fs.readFileSync(path.join(here, 'api.ts'), 'utf8')

test('resume and cover letter use independent document fields', () => {
  assert.equal(documentFieldForTab('resume'), 'resume_md')
  assert.equal(documentFieldForTab('coverletter'), 'cover_md')
  const next = applyCoverLetterUpdate({ resume_md: 'RESUME', cover_md: 'OLD' }, 'NEW LETTER')
  assert.equal(next.resume_md, 'RESUME')
  assert.equal(next.cover_md, 'NEW LETTER')
})

test('regenerate asks before replacing an edited cover letter', () => {
  assert.equal(shouldConfirmCoverRegenerate('Dear Hiring Manager, edited.'), true)
  assert.equal(shouldConfirmCoverRegenerate(''), false)
  assert.equal(shouldConfirmCoverRegenerate(null), false)
  assert.match(COVER_REGENERATE_CONFIRM, /替换当前求职信/)
  assert.match(COVER_REGENERATE_CONFIRM, /简历不会被修改/)
})

test('switching documents flushes the pending draft instead of dropping it', () => {
  assert.equal(shouldFlushDocumentOnTabChange('resume', 'coverletter'), true)
  assert.equal(shouldFlushDocumentOnTabChange('coverletter', 'resume'), true)
  assert.equal(shouldFlushDocumentOnTabChange('resume', 'resume'), false)
  assert.equal(shouldFlushDocumentOnTabChange('analysis', 'coverletter'), false)
  assert.match(editorSrc, /changeTab/)
  assert.match(editorSrc, /shouldFlushDocumentOnTabChange/)
})

test('Editor keeps separate autosave fields and a confirm regenerate path', () => {
  assert.match(editorSrc, /documentFieldForTab/)
  assert.match(editorSrc, /shouldConfirmCoverRegenerate/)
  assert.match(editorSrc, /api\.regenerateCoverLetter/)
  assert.match(editorSrc, /window\.confirm\(COVER_REGENERATE_CONFIRM\)/)
  assert.match(editorSrc, /tab === 'resume' \? app\.resume_md/)
  assert.match(editorSrc, /app\.cover_md/)
  assert.match(apiSrc, /\/applications\/\$\{id\}\/cover-letter/)
  assert.doesNotMatch(editorSrc, /求职信模板未找到/)
})
