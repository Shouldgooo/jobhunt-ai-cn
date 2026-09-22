/** Display labels for user-facing UI. Keys stay in English (API/DB values). */

export const STATUS_LABELS: Record<string, string> = {
  not_started: '未开始',
  applied: '已申请',
  followed_up: '已跟进',
  interviewed: '面试',
  rejected: '未通过',
}

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status
}

export const SOURCE_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn',
  seek: 'Seek',
  other: '其他',
}

export const THEME_LABELS: Record<string, string> = {
  classic: '经典',
  modern: '现代',
  executive: '商务',
  sidebar: '侧栏',
  minimal: '极简',
  compact: '紧凑',
  bold: '醒目',
}

export function themeLabel(theme: string): string {
  return THEME_LABELS[theme] ?? theme
}

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source
}

export const EVAL_REC_LABELS: Record<string, string> = {
  Apply: '建议投递',
  'Apply with caveats': '可投递（有保留）',
  Skip: '不建议投递',
}

export function evalRecLabel(rec: string | null | undefined): string {
  if (!rec) return ''
  return EVAL_REC_LABELS[rec] ?? rec
}

export const PANEL_LABELS: Record<string, string> = {
  editor: '编辑',
  preview: '预览',
}
