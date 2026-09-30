import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type Application } from '@/lib/api'
import { STATUS_LABELS, statusLabel, sourceLabel } from '@/lib/labels'
import {
  applyBulkStatusToApps,
  beginBulkUpdate,
  BULK_APPLIED_STATUS,
  BULK_BUTTON_LABEL,
  BULK_CANCEL_LABEL,
  BULK_CONFIRM_LABEL,
  BULK_CONFIRM_TEXT,
  BULK_LOADING_LABEL,
  cancelBulkConfirm,
  canOpenBulkConfirm,
  finishBulkUpdateError,
  finishBulkUpdateSuccess,
  INITIAL_BULK_STATUS_UI,
  openBulkConfirm,
} from '@/lib/bulk-status'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ArrowUpDown, Pencil, Trash2, Download, ChevronDown, ChevronRight, Bookmark, Send, Bell, Users, XCircle, Hourglass, MessageCircle } from 'lucide-react'

// ─── Constants ─────────────────────────────────────────────────────────────────

type Status = Application['status']
type Filter = 'all' | Status

const STATUSES: Status[] = ['not_started', 'applied', 'followed_up', 'interviewed', 'rejected']

const STATUS_VARIANT: Record<Status, BadgeProps['variant']> = {
  not_started:  'not_started',
  applied:      'applied',
  followed_up:  'followed_up',
  interviewed:  'interviewed',
  rejected:     'rejected',
}

const FILTERS: { label: string; value: Filter }[] = [
  { label: '全部',                    value: 'all' },
  { label: STATUS_LABELS.not_started, value: 'not_started' },
  { label: STATUS_LABELS.applied,     value: 'applied' },
  { label: STATUS_LABELS.followed_up, value: 'followed_up' },
  { label: STATUS_LABELS.interviewed, value: 'interviewed' },
  { label: STATUS_LABELS.rejected,    value: 'rejected' },
]

// ─── Score bar ─────────────────────────────────────────────────────────────────

function ScoreBar({ score }: { score: number }) {
  if (!score) {
    return (
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-[var(--text-secondary)] w-6 text-right">—</span>
        <div className="w-12 h-1.5 bg-[var(--chart-track)] rounded-full opacity-40" />
      </div>
    )
  }
  const color = score >= 70 ? 'bg-[var(--primary-dark)]' : score >= 50 ? 'bg-[var(--primary)]' : 'bg-[var(--secondary)]'
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-xs tabular-nums w-6 text-right">{score}</span>
      <div className="w-12 h-1.5 bg-[var(--chart-track)] rounded-full overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${score}%` }} />
      </div>
    </div>
  )
}

// ─── Inline editable cell ──────────────────────────────────────────────────────

function EditableCell({
  value, onSave, type = 'text', options, display,
}: {
  value: string; onSave: (v: string) => void; type?: string; options?: string[]; display?: (v: string) => string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(value)

  function commit() {
    setEditing(false)
    if (draft !== value) onSave(draft)
  }

  if (!editing) {
    return (
      <span
        className="cursor-text hover:opacity-60 transition-opacity font-sans"
        onClick={() => { setDraft(value); setEditing(true) }}
      >
        {value ? (display ? display(value) : value) : <span className="text-gray-300">—</span>}
      </span>
    )
  }
  if (options) {
    return (
      <select
        autoFocus
        className="border border-[var(--border)] rounded-none px-1.5 py-0.5 font-mono text-xs uppercase bg-[var(--surface)] outline-none focus:ring-1 focus:ring-[var(--primary)]"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
      >
        {options.map(o => <option key={o} value={o}>{display ? display(o) : o}</option>)}
      </select>
    )
  }
  return (
    <input
      autoFocus type={type}
      className="border border-[var(--border)] rounded-none px-1.5 py-0.5 font-sans text-sm bg-[var(--surface)] w-full min-w-[80px] outline-none focus:ring-1 focus:ring-[var(--primary)]"
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') { setDraft(value); setEditing(false) }
      }}
    />
  )
}

const DOT_COLOR: Record<Status, string> = {
  not_started:  'bg-[var(--text-muted)]',
  applied:      'bg-[var(--status-applied-fg)]',
  followed_up:  'bg-[var(--status-followed-fg)]',
  interviewed:  'bg-[var(--status-interview-fg)]',
  rejected:     'bg-[var(--status-rejected-fg)]',
}

const STATUS_ICON: Record<Status, React.ElementType> = {
  not_started: Hourglass,
  applied:     Send,
  followed_up: Bell,
  interviewed: Users,
  rejected:    XCircle,
}

// ─── Status dropdown ───────────────────────────────────────────────────────────

function StatusCell({ app, onUpdate }: { app: Application; onUpdate: (s: Status) => void }) {
  const [open, setOpen] = useState(false)
  const Icon = STATUS_ICON[app.status]
  return (
    <div className="relative inline-block">
      <Badge
        variant={STATUS_VARIANT[app.status]}
        className="cursor-pointer select-none gap-1"
        onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
      >
        <Icon className="h-3 w-3 flex-shrink-0" />
        {statusLabel(app.status)}
      </Badge>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 z-20 w-40 border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow)] overflow-hidden">
            {STATUSES.map(s => {
              const SIcon = STATUS_ICON[s]
              return (
                <button
                  key={s}
                  className="flex w-full items-center gap-2 px-3 py-2 font-mono text-xs uppercase tracking-wider hover:bg-[var(--primary-soft)] hover:text-[var(--text-primary)] transition-colors"
                  onClick={() => { onUpdate(s); setOpen(false) }}
                >
                  <SIcon className="h-3.5 w-3.5 flex-shrink-0" />
                  {statusLabel(s)}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Desktop row ───────────────────────────────────────────────────────────────

function DesktopRow({
  app, onUpdate, onDelete,
}: { app: Application; onUpdate: (id: number, d: Partial<Application>) => void; onDelete: (id: number) => void }) {
  const navigate   = useNavigate()
  const [open, setOpen] = useState(false)
  const patch = useCallback((d: Partial<Application>) => onUpdate(app.id, d), [app.id, onUpdate])

  return (
    <>
      <tr className="hover:bg-[var(--primary-soft)]/60 transition-colors border-b border-[var(--border)]">
        <td className="pl-4 pr-2 py-3 w-7">
          <button
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            onClick={() => setOpen(o => !o)}
          >
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        </td>
        <td className="px-3 py-3 font-mono text-xs text-[var(--text-secondary)] whitespace-nowrap">{app.created_at.slice(0, 10)}</td>
        <td className="px-3 py-3 font-sans font-semibold text-sm"><EditableCell value={app.company} onSave={v => patch({ company: v })} /></td>
        <td className="px-3 py-3 font-sans text-sm text-[var(--text-secondary)]"><EditableCell value={app.job_title} onSave={v => patch({ job_title: v })} /></td>
        <td className="px-3 py-3 font-mono text-xs uppercase"><EditableCell value={app.source} onSave={v => patch({ source: v })} options={['linkedin','seek','other']} display={sourceLabel} /></td>
        <td className="px-3 py-3"><ScoreBar score={app.fit_score ?? 0} /></td>
        <td className="px-3 py-3 font-mono text-xs text-[var(--text-secondary)]">{app.stack_used || '—'}</td>
        <td className="px-3 py-3">
          <StatusCell app={app} onUpdate={s => patch({ status: s })} />
        </td>
        <td className="px-3 py-3">
          {app.url
            ? <a href={app.url} target="_blank" rel="noreferrer" className="font-mono text-xs text-[var(--text-primary)] hover:underline">↗ 链接</a>
            : <span className="text-gray-300 font-mono text-xs">—</span>}
        </td>
        <td className="px-3 py-3 pr-4 whitespace-nowrap">
            <div className="flex items-center justify-end gap-0.5 min-w-[9.5rem]">
            <Button
              variant="ghost" size="icon" className={`h-7 w-7 transition-colors ${app.follow_up ? 'text-[var(--text-primary)]' : 'hover:text-[var(--text-primary)]'}`}
              title={app.follow_up ? '取消待跟进' : '标记待跟进'}
              onClick={() => patch({ follow_up: app.follow_up ? 0 : 1 })}
            >
              <Bookmark className={`h-3.5 w-3.5 ${app.follow_up ? 'fill-black' : ''}`} />
            </Button>
            {app.resume_md ? (
              <a href={api.getPdfUrl(app.id, 'resume')} download title="下载简历 PDF">
                <Button variant="ghost" size="icon" className="h-7 w-7"><Download className="h-3.5 w-3.5" /></Button>
              </a>
            ) : (
              <Button variant="ghost" size="icon" className="h-7 w-7" title="暂无简历可下载" disabled>
                <Download className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-7 w-7" title="追问这个岗位" onClick={() => navigate(`/editor/${app.id}?tab=qa`)}>
              <MessageCircle className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" title="打开编辑器" onClick={() => navigate(`/editor/${app.id}`)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost" size="icon" className="h-7 w-7 hover:text-[var(--text-primary)] transition-colors" title="删除"
              onClick={() => { if (confirm(`确定删除「${app.job_title}」@ ${app.company}？\n\n将永久删除已保存的简历 Markdown、求职信和状态历史。`)) onDelete(app.id) }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </td>
      </tr>

      {open && (
        <tr className="border-b border-[var(--border)]">
          <td colSpan={10} className="bg-[var(--bg)] border-b border-[var(--border)] px-6 py-4">
            <div className="grid grid-cols-[3fr_1fr] gap-6">
              <div>
                <p className="font-mono text-xs uppercase tracking-wider text-[var(--text-secondary)] mb-2">职位描述</p>
                <textarea
                  className="w-full min-h-48 font-sans text-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 resize-y focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
                  defaultValue={app.jd_text}
                  onBlur={e => { if (e.target.value !== app.jd_text) patch({ jd_text: e.target.value }) }}
                />
                <p className="font-mono text-xs text-[var(--text-secondary)] mt-1">[ 失焦时自动保存 ]</p>
              </div>
              <div className="space-y-1.5">
                <p className="font-mono text-xs uppercase tracking-wider text-[var(--text-secondary)] mb-2">详情</p>
                {[
                  ['ID', app.id],
                  ['创建日期', app.created_at.slice(0, 10)],
                  ['匹配分', app.fit_score ? `${app.fit_score} / 100` : '—'],
                  ['技术栈', app.stack_used || '—'],
                  ['来源', sourceLabel(app.source || '') || '—'],
                ].map(([k, v]) => (
                  <p key={String(k)} className="font-mono text-xs">
                    <span className="text-[var(--text-secondary)] uppercase">{k}: </span>
                    <span className="text-[var(--text-primary)]">{v}</span>
                  </p>
                ))}
                {app.url && (
                  <p className="font-mono text-xs">
                    <span className="text-[var(--text-secondary)] uppercase">链接： </span>
                    <a href={app.url} target="_blank" rel="noreferrer" className="text-[var(--text-primary)] hover:underline break-all">{app.url}</a>
                  </p>
                )}

                {/* Status history */}
                {(() => {
                  const log: { status: string; changed_at: string }[] = JSON.parse(app.status_log || '[]')
                  if (!log.length) return null
                  return (
                    <div className="mt-3 pt-3 border-t border-[#E5E5DC]">
                      <p className="font-mono text-xs uppercase tracking-wider text-[var(--text-secondary)] mb-2">状态历史</p>
                      <div className="flex flex-col gap-1">
                        {log.map((entry, i) => (
                          <div key={i} className="flex items-center gap-2 group/entry">
                            <span className={`w-1.5 h-1.5 flex-shrink-0 ${DOT_COLOR[entry.status as Status] ?? 'bg-gray-400'}`} />
                            <span className="font-mono text-xs uppercase tracking-wider text-[var(--text-primary)]">{statusLabel(entry.status)}</span>
                            <span className="font-mono text-[10px] text-[var(--text-secondary)] ml-auto">{entry.changed_at.slice(0, 16).replace('T', ' ')}</span>
                            <button
                              className="opacity-0 group-hover/entry:opacity-100 font-mono text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all ml-1"
                              title="删除此记录"
                              onClick={() => {
                                const updated = log.filter((_, j) => j !== i)
                                onUpdate(app.id, { status_log: JSON.stringify(updated) })
                              }}
                            >×</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })()}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ─── Mobile card ───────────────────────────────────────────────────────────────

function MobileCard({
  app, onUpdate, onDelete,
}: { app: Application; onUpdate: (id: number, d: Partial<Application>) => void; onDelete: (id: number) => void }) {
  const navigate = useNavigate()
  const patch    = useCallback((d: Partial<Application>) => onUpdate(app.id, d), [app.id, onUpdate])

  return (
    <div className="jh-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-sans font-semibold text-sm truncate">{app.company}</p>
          <p className="font-mono text-xs text-[var(--text-secondary)] truncate uppercase">{app.job_title}</p>
        </div>
        <StatusCell app={app} onUpdate={s => patch({ status: s })} />
      </div>

      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-[var(--text-secondary)]">{app.created_at.slice(0, 10)}</span>
        <ScoreBar score={app.fit_score ?? 0} />
      </div>

      <div className="flex items-center gap-2 pt-2 border-t border-[var(--border)]">
        {app.resume_md && (
          <a href={api.getPdfUrl(app.id, 'resume')} download>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
              <Download className="h-3 w-3" /> PDF
            </Button>
          </a>
        )}
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => navigate(`/editor/${app.id}?tab=qa`)}>
          <MessageCircle className="h-3 w-3" /> 追问
        </Button>
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => navigate(`/editor/${app.id}`)}>
          <Pencil className="h-3 w-3" /> 编辑
        </Button>
        <Button
          variant="ghost" size="sm" className="h-7 text-xs text-[var(--text-primary)] ml-auto"
          onClick={() => { if (confirm(`确定删除「${app.job_title}」@ ${app.company}？\n\n将永久删除已保存的简历 Markdown、求职信和状态历史。`)) onDelete(app.id) }}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  )
}

// ─── Page ───────────────────────────────────────────────────────────────────────

export default function History() {
  const [apps, setApps]       = useState<Application[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter]   = useState<Filter>('all')
  const [sortAsc, setSortAsc] = useState(false)
  const [bulkUi, setBulkUi]   = useState(INITIAL_BULK_STATUS_UI)
  const bulkSubmittingRef     = useRef(false)

  useEffect(() => {
    api.getApplications().then(setApps).finally(() => setLoading(false))
  }, [])

  const handleUpdate = useCallback(async (id: number, data: Partial<Application>) => {
    setApps(prev => prev.map(a => a.id === id ? { ...a, ...data } : a))
    await api.patchApplication(id, data)
  }, [])

  const handleDelete = useCallback(async (id: number) => {
    await api.deleteApplication(id)
    setApps(prev => prev.filter(a => a.id !== id))
  }, [])

  const handleOpenBulkApplied = useCallback(() => {
    setBulkUi(ui => openBulkConfirm(ui, apps.length))
  }, [apps.length])

  const handleCancelBulkApplied = useCallback(() => {
    setBulkUi(ui => cancelBulkConfirm(ui))
  }, [])

  const handleConfirmBulkApplied = useCallback(async () => {
    if (bulkSubmittingRef.current) return
    const next = beginBulkUpdate(bulkUi)
    if (!next) return
    bulkSubmittingRef.current = true
    setBulkUi(next)
    try {
      const result = await api.patchAllApplicationStatus(BULK_APPLIED_STATUS)
      setApps(prev => applyBulkStatusToApps(prev, result.status))
      setFilter('all')
      try {
        const fresh = await api.getApplications()
        setApps(applyBulkStatusToApps(fresh, result.status))
      } catch {
        // keep the local applied statuses if refetch fails
      }
      setBulkUi(finishBulkUpdateSuccess(result.updated))
    } catch (err) {
      setBulkUi(finishBulkUpdateError(err instanceof Error ? err.message : '更新失败，请重试。'))
    } finally {
      bulkSubmittingRef.current = false
    }
  }, [bulkUi])

  const visible = apps
    .filter(a => filter === 'all' || a.status === filter)
    .sort((a, b) => {
      const d = a.created_at.localeCompare(b.created_at)
      return sortAsc ? d : -d
    })

  return (
    <div className="space-y-6">

      {/* Page header */}
      <div className="border-b border-[var(--border)] pb-4 flex items-end justify-between gap-4">
        <h1 className="font-serif text-3xl font-bold">历史记录</h1>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled={!canOpenBulkConfirm(apps.length, bulkUi.submitting) || loading}
              onClick={handleOpenBulkApplied}
            >
              {bulkUi.submitting ? BULK_LOADING_LABEL : BULK_BUTTON_LABEL}
            </Button>
            <button
              className="flex items-center gap-1.5 font-mono text-xs uppercase tracking-wider text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              onClick={() => setSortAsc(a => !a)}
            >
              <ArrowUpDown className="h-3.5 w-3.5" />
              日期 {sortAsc ? '↑' : '↓'}
            </button>
          </div>
          {bulkUi.message && (
            <p className="font-mono text-xs text-[var(--text-primary)]">{bulkUi.message}</p>
          )}
          {bulkUi.error && (
            <p className="font-mono text-xs text-[var(--text-primary)]">{bulkUi.error}</p>
          )}
        </div>
      </div>

      {bulkUi.confirmOpen && (
        <div
          className="fixed inset-0 z-50 bg-[var(--text-primary)]/35 flex items-center justify-center p-4"
          onClick={() => { if (!bulkUi.submitting) handleCancelBulkApplied() }}
        >
          <div
            className="bg-[var(--surface)] border border-[var(--border)] shadow-[var(--shadow)] w-full max-w-sm p-6 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <p className="font-sans text-sm leading-relaxed">{BULK_CONFIRM_TEXT}</p>
            <div className="flex gap-2 justify-end pt-1">
              <Button
                variant="ghost"
                size="sm"
                disabled={bulkUi.submitting}
                onClick={handleCancelBulkApplied}
              >
                {BULK_CANCEL_LABEL}
              </Button>
              <Button
                variant="default"
                size="sm"
                disabled={bulkUi.submitting}
                onClick={handleConfirmBulkApplied}
              >
                {bulkUi.submitting ? BULK_LOADING_LABEL : BULK_CONFIRM_LABEL}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {FILTERS.map(f => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`px-3 py-1.5 font-sans text-xs tracking-wide rounded-full border transition-colors ${
              filter === f.value
                ? 'bg-[var(--primary-soft)] text-[var(--text-primary)] border-[var(--border)]'
                : 'bg-[var(--surface)] text-[var(--text-secondary)] border-[var(--border)] hover:bg-[var(--primary-soft)] hover:text-[var(--text-primary)]'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden sm:block jh-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--bg)]">
                <th className="w-7" />
                {['日期','公司','职位','来源','匹配分','技术栈','状态','链接','操作'].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left font-mono text-xs uppercase tracking-wider text-[var(--text-secondary)] whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={10} className="px-4 py-10 text-center font-mono text-xs uppercase tracking-wider text-[var(--text-secondary)]">[ 加载中… ]</td></tr>
              )}
              {!loading && visible.length === 0 && (
                <tr><td colSpan={10} className="px-4 py-10 text-center font-mono text-xs uppercase tracking-wider text-[var(--text-secondary)]">[ 暂无申请 ]</td></tr>
              )}
              {visible.map(app => (
                <DesktopRow key={app.id} app={app} onUpdate={handleUpdate} onDelete={handleDelete} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile cards */}
      <div className="sm:hidden space-y-3">
        {loading && <p className="font-mono text-xs uppercase tracking-wider text-[var(--text-secondary)] text-center py-8">[ 加载中… ]</p>}
        {!loading && visible.length === 0 && (
          <p className="font-mono text-xs uppercase tracking-wider text-[var(--text-secondary)] text-center py-8">[ 暂无申请 ]</p>
        )}
        {visible.map(app => (
          <MobileCard key={app.id} app={app} onUpdate={handleUpdate} onDelete={handleDelete} />
        ))}
      </div>
    </div>
  )
}
