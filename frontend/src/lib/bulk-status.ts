export const BULK_APPLIED_STATUS = 'applied' as const
export const BULK_BUTTON_LABEL = '全部标记为已申请'
export const BULK_CONFIRM_TEXT = '确定要将全部申请的状态改为「已申请」吗？'
export const BULK_CANCEL_LABEL = '取消'
export const BULK_CONFIRM_LABEL = '确认修改'
export const BULK_LOADING_LABEL = '正在更新…'

export type BulkStatusUi = {
  confirmOpen: boolean
  submitting: boolean
  message: string | null
  error: string | null
}

export const INITIAL_BULK_STATUS_UI: BulkStatusUi = {
  confirmOpen: false,
  submitting: false,
  message: null,
  error: null,
}

export function canOpenBulkConfirm(appCount: number, submitting: boolean): boolean {
  return appCount > 0 && !submitting
}

export function openBulkConfirm(ui: BulkStatusUi, appCount: number): BulkStatusUi {
  if (!canOpenBulkConfirm(appCount, ui.submitting)) return ui
  return { ...ui, confirmOpen: true, error: null }
}

export function cancelBulkConfirm(ui: BulkStatusUi): BulkStatusUi {
  if (ui.submitting) return ui
  return { ...ui, confirmOpen: false }
}

/** Returns the submitting UI, or null if confirmation is missing / already in flight. */
export function beginBulkUpdate(ui: BulkStatusUi): BulkStatusUi | null {
  if (ui.submitting || !ui.confirmOpen) return null
  return { ...ui, submitting: true, error: null, message: null }
}

export function formatBulkAppliedSuccess(updated: number): string {
  return `已将 ${updated} 条申请标记为「已申请」。`
}

export function finishBulkUpdateSuccess(updated: number): BulkStatusUi {
  return {
    confirmOpen: false,
    submitting: false,
    message: formatBulkAppliedSuccess(updated),
    error: null,
  }
}

export function finishBulkUpdateError(error: string): BulkStatusUi {
  return {
    confirmOpen: false,
    submitting: false,
    message: null,
    error,
  }
}

export function applyBulkStatusToApps<T extends { status: string }>(apps: T[], status: string): T[] {
  return apps.map((app) => ({ ...app, status }))
}
