export type DocumentTab = 'resume' | 'coverletter'

export function documentFieldForTab(tab: DocumentTab): 'resume_md' | 'cover_md' {
  return tab === 'coverletter' ? 'cover_md' : 'resume_md'
}

export function shouldFlushDocumentOnTabChange(from: string, to: string): boolean {
  return (from === 'resume' || from === 'coverletter') && from !== to
}

export function shouldConfirmCoverRegenerate(existingCover: string | null | undefined): boolean {
  return Boolean(existingCover && existingCover.trim())
}

export function applyCoverLetterUpdate<T extends { resume_md?: string; cover_md?: string }>(
  app: T,
  coverMd: string,
): T {
  return { ...app, cover_md: coverMd }
}

export const COVER_REGENERATE_CONFIRM =
  '重新生成将替换当前求职信（包括你手动改过的内容）。简历不会被修改。确定继续？'
