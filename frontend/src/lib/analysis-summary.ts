import { parseChangeSummary, type ChangeSummary, type VerifiedResumeChange } from './change-summary.ts'

export const EVIDENCE_FALLBACK =
  '该申请创建于新版证据分析功能之前，暂无完整的要求证据分析。'

export const NO_VERIFIED_CHANGES = '暂无可验证的简历改动摘要。'

export const EVIDENCE_LEVEL_LABEL = {
  strong: '证据充分',
  partial: '部分证据',
  missing: '缺少证据',
} as const

export type EvidenceLevel = keyof typeof EVIDENCE_LEVEL_LABEL
export type RequirementKind = 'core' | 'supporting'

export interface EvidenceRequirement {
  name: string
  kind: RequirementKind
  level: EvidenceLevel
  note: string
}

export interface AnalysisPoint {
  title: string
  detail: string
  level: EvidenceLevel
}

export interface AnalysisView {
  fitScore: number
  hasEvidenceMatrix: boolean
  evidenceFallback: string | null
  overview: string
  changeSummaryText: string
  strengths: AnalysisPoint[]
  attention: AnalysisPoint[]
  recommendation: string
}

const SECTION_LABEL: Record<string, string> = {
  header: 'Header',
  summary: 'Profile',
  profile: 'Profile',
  skills: 'Technical Skills',
  'technical skills': 'Technical Skills',
  experience: 'Work Experience',
  'work experience': 'Work Experience',
  projects: 'Projects',
  education: 'Education',
}

function hasTerm(haystack: string, term: string): boolean {
  if (!haystack || !term || term.length < 2) return false
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|[^A-Za-z0-9])${escaped}(?:[^A-Za-z0-9]|$)`, 'i').test(haystack)
}

export function persistedFitScore(score: number | null | undefined): number {
  const n = Number(score)
  if (!Number.isFinite(n)) return 0
  return n
}

export function matchBand(score: number): '较高' | '中等' | '偏低' {
  if (score >= 70) return '较高'
  if (score >= 50) return '中等'
  return '偏低'
}

export function joinZh(items: string[]): string {
  const unique = [...new Set(items.filter(Boolean))]
  if (unique.length === 0) return ''
  if (unique.length === 1) return unique[0]
  if (unique.length === 2) return `${unique[0]}和${unique[1]}`
  return `${unique.slice(0, -1).join('、')}和${unique[unique.length - 1]}`
}

export function sectionLabel(section: string): string {
  const key = String(section || '').trim().toLowerCase()
  return SECTION_LABEL[key] || String(section || '').trim()
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function normalizeLevel(raw: unknown): EvidenceLevel | null {
  const value = String(raw || '').toLowerCase()
  if (value === 'strong' || value === 'full' || value === '直接' || value === '证据充分') return 'strong'
  if (value === 'partial' || value === 'weak' || value === '部分' || value === '部分证据') return 'partial'
  if (value === 'missing' || value === 'none' || value === 'absent' || value === '缺少证据') return 'missing'
  return null
}

function normalizeKind(raw: unknown): RequirementKind {
  const value = String(raw || '').toLowerCase()
  return value.includes('core') || value.includes('关键') || value.includes('核心')
    ? 'core'
    : 'supporting'
}

function defaultNote(level: EvidenceLevel): string {
  if (level === 'strong') return '原始资料中存在直接证据'
  if (level === 'partial') return 'Skills 或描述中有提及，但项目/工作经历证据较弱。'
  return 'JD 明确要求，但原始资料中未找到实际项目或工作经验支持。'
}

function parseRequirement(raw: unknown): EvidenceRequirement | null {
  const item = asRecord(raw)
  if (!item) return null
  const name = String(item.name || item.label || item.requirement || item.title || '').trim()
  const level = normalizeLevel(item.level ?? item.evidence ?? item.status ?? item.strength)
  if (!name || !level) return null
  const note = String(item.note || item.detail || item.reason || item.source || '').trim()
  return {
    name,
    kind: normalizeKind(item.kind ?? item.priority ?? item.tier ?? item.category),
    level,
    note: note || defaultNote(level),
  }
}

function readRequirementList(raw: unknown): EvidenceRequirement[] {
  if (Array.isArray(raw)) {
    return raw.map(parseRequirement).filter((x): x is EvidenceRequirement => Boolean(x))
  }
  const obj = asRecord(raw)
  if (!obj) return []
  if (Array.isArray(obj.requirements)) return readRequirementList(obj.requirements)
  if (Array.isArray(obj.items)) return readRequirementList(obj.items)
  const fromBuckets = [
    ...(Array.isArray(obj.core)
      ? obj.core.map((item) => ({ ...(asRecord(item) || {}), kind: 'core' }))
      : []),
    ...(Array.isArray(obj.supporting)
      ? obj.supporting.map((item) => ({ ...(asRecord(item) || {}), kind: 'supporting' }))
      : []),
  ]
  return fromBuckets.map(parseRequirement).filter((x): x is EvidenceRequirement => Boolean(x))
}

export function parseEvidenceMatrix(rawSummary: string | null | undefined): EvidenceRequirement[] | null {
  if (rawSummary == null || rawSummary === '') return null
  try {
    const data = asRecord(JSON.parse(rawSummary))
    if (!data) return null
    const candidates = [
      data.evidence_matrix,
      data.requirement_matrix,
      data.requirements,
      asRecord(data.evidence)?.requirements,
      asRecord(data.evidence)?.items,
      data.evidence,
      asRecord(data.analysis)?.requirements,
    ]
    for (const candidate of candidates) {
      const list = readRequirementList(candidate)
      if (list.length > 0) return list
    }
    return null
  } catch {
    return null
  }
}

export function selectStrengths(requirements: EvidenceRequirement[]): EvidenceRequirement[] {
  const strong = requirements.filter((r) => r.level === 'strong')
  const core = strong.filter((r) => r.kind === 'core')
  const supporting = strong.filter((r) => r.kind === 'supporting')
  return [...core, ...supporting].slice(0, 5)
}

export function selectAttention(requirements: EvidenceRequirement[]): EvidenceRequirement[] {
  const missingCore = requirements.filter((r) => r.kind === 'core' && r.level === 'missing')
  const partialCore = requirements.filter((r) => r.kind === 'core' && r.level === 'partial')
  const missingOther = requirements.filter((r) => r.kind !== 'core' && r.level === 'missing')
  return [...missingCore, ...partialCore, ...missingOther].slice(0, 4)
}

function originalEvidenceKeywords(changes: VerifiedResumeChange[]): string[] {
  const names: string[] = []
  for (const change of changes) {
    for (const keyword of change.jd_keywords || []) {
      if (hasTerm(change.before || '', keyword)) names.push(keyword)
    }
  }
  return [...new Set(names)].slice(0, 5)
}

function toPoint(req: EvidenceRequirement): AnalysisPoint {
  return { title: req.name, detail: req.note, level: req.level }
}

export function summarizeVerifiedChanges(summary: ChangeSummary | null): string {
  if (!summary || summary.status === 'unavailable') return NO_VERIFIED_CHANGES
  const sections = [...new Set(
    summary.resume_changes
      .filter((c) => c.verified === true)
      .map((c) => sectionLabel(c.section))
      .filter(Boolean),
  )]
  if (sections.length === 0) return NO_VERIFIED_CHANGES
  return `本次主要调整了${joinZh(sections)}的表达，把已有经历放到更对应 JD 的位置，未改动未发生变化的部分。`
}

function overviewFromEvidence(score: number, requirements: EvidenceRequirement[]): string {
  const band = matchBand(score)
  const strongNames = selectStrengths(requirements).map((r) => r.name)
  const missingCore = requirements.filter((r) => r.kind === 'core' && r.level === 'missing').map((r) => r.name)
  const parts = [`该职位与你的背景具有${band}匹配度。`]
  if (strongNames.length) {
    parts.push(`你在${joinZh(strongNames)}方面有较强证据，与岗位的部分要求吻合。`)
  }
  if (missingCore.length) {
    parts.push(`但 JD 明确要求的${joinZh(missingCore.slice(0, 2))}目前缺少原始资料支持，因此整体匹配度受到影响。`)
  }
  return parts.join('')
}

function overviewWithoutMatrix(score: number, originalKeywords: string[]): string {
  const band = matchBand(score)
  const parts = [`该职位与你的背景具有${band}匹配度。`]
  if (originalKeywords.length) {
    parts.push(`对照已保存的改动记录，原始简历中能对应 JD 的内容包括${joinZh(originalKeywords)}。`)
  }
  parts.push(EVIDENCE_FALLBACK)
  return parts.join('')
}

export function buildRecommendation(opts: {
  hasEvidenceMatrix: boolean
  missingCore: string[]
  partialCore: string[]
  hasUnsupported: boolean
  fitScore: number
}): string {
  if (opts.hasUnsupported) {
    return '请先核对标出的内容是否确有原始资料支持，不要把未发生过的经历写进简历。'
  }
  if (opts.missingCore.length) {
    return `当前最明显的缺口是${opts.missingCore[0]}。如果实际做过相关项目但尚未记录，可以先补充到 Profile 后重新生成。`
  }
  if (opts.partialCore.length) {
    return `${opts.partialCore[0]}目前证据偏弱。若确有实际项目或工作经历，应先补进 Profile，而不是只增加关键词。`
  }
  if (!opts.hasEvidenceMatrix) {
    return '建议只根据原始资料核对已有经历，不要为了匹配 JD 补充无法证实的内容。'
  }
  if (opts.fitScore >= 70) {
    return '现有证据与岗位要求较为吻合，检查措辞后即可投递。'
  }
  return '建议对照职位描述核对应聘资料中已有的经历，而不是补充无法证实的关键词。'
}

function attentionFromValidation(summary: ChangeSummary | null): AnalysisPoint[] {
  if (!summary) return []
  const points: AnalysisPoint[] = []
  for (const item of summary.unsupported_experience.slice(0, 3)) {
    points.push({
      title: item.text,
      detail: '工作经历中的新增内容可能缺少原始资料支持。',
      level: 'missing',
    })
  }
  for (const item of summary.unsupported.slice(0, 3)) {
    points.push({
      title: item.text,
      detail: item.section
        ? `${item.section} 中出现了原始资料未明确支持的内容。`
        : '生成后的简历出现了原始资料中未明确支持的内容。',
      level: 'missing',
    })
  }
  return points.slice(0, 4)
}

export function mentionsAsExperience(text: string, name: string): boolean {
  if (!text || !name) return false
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`你在[^。]*${escaped}|具备${escaped}|拥有${escaped}经验`).test(text)
}

export function buildAnalysisView(app: {
  fit_score?: number | null
  change_summary?: string | null
}): AnalysisView {
  const fitScore = persistedFitScore(app.fit_score)
  const parsed = parseChangeSummary(app.change_summary)
  const matrix = parseEvidenceMatrix(app.change_summary)
  const hasEvidenceMatrix = Array.isArray(matrix) && matrix.length > 0
  const changeSummaryText = summarizeVerifiedChanges(parsed)
  const hasUnsupported = Boolean(
    (parsed?.unsupported_experience.length || 0) + (parsed?.unsupported.length || 0),
  )

  if (hasEvidenceMatrix && matrix) {
    const strengths = selectStrengths(matrix).map(toPoint)
    const attention = selectAttention(matrix).map(toPoint)
    const missingCore = matrix.filter((r) => r.kind === 'core' && r.level === 'missing').map((r) => r.name)
    const partialCore = matrix.filter((r) => r.kind === 'core' && r.level === 'partial').map((r) => r.name)
    return {
      fitScore,
      hasEvidenceMatrix: true,
      evidenceFallback: null,
      overview: overviewFromEvidence(fitScore, matrix),
      changeSummaryText,
      strengths,
      attention,
      recommendation: buildRecommendation({
        hasEvidenceMatrix: true,
        missingCore,
        partialCore,
        hasUnsupported,
        fitScore,
      }),
    }
  }

  const originalKeywords = originalEvidenceKeywords(parsed?.resume_changes || [])
  const derivedStrengths = originalKeywords.map((name) => ({
    title: name,
    detail: '工作经历或项目原文中存在直接证据',
    level: 'strong' as const,
  }))

  return {
    fitScore,
    hasEvidenceMatrix: false,
    evidenceFallback: EVIDENCE_FALLBACK,
    overview: overviewWithoutMatrix(fitScore, originalKeywords),
    changeSummaryText,
    strengths: derivedStrengths,
    attention: attentionFromValidation(parsed),
    recommendation: buildRecommendation({
      hasEvidenceMatrix: false,
      missingCore: [],
      partialCore: [],
      hasUnsupported,
      fitScore,
    }),
  }
}
