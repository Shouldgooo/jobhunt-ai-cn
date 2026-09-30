import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { api, Application } from '@/lib/api'
import { STATUS_LABELS, statusLabel } from '@/lib/labels'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

function countByStatus(apps: Application[]) {
  const counts: Record<string, number> = {}
  for (const a of apps) {
    counts[a.status] = (counts[a.status] ?? 0) + 1
  }
  return counts
}

function avgFitScore(apps: Application[]): number | null {
  const scored = apps.filter(a => a.fit_score != null && a.fit_score > 0)
  if (!scored.length) return null
  return Math.round(scored.reduce((s, a) => s + (a.fit_score ?? 0), 0) / scored.length)
}

function needsFollowUp(apps: Application[]): Application[] {
  return apps.filter(a => a.follow_up === 1)
}

function activityByDay(apps: Application[]): Record<string, number> {
  const map: Record<string, number> = {}
  for (const a of apps) {
    const day = a.created_at.slice(0, 10)
    map[day] = (map[day] ?? 0) + 1
  }
  return map
}

function buildHeatmapGrid(activity: Record<string, number>) {
  const today = new Date()
  const dayOfWeek = today.getDay()
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  const end = new Date(today)
  const start = new Date(today)
  start.setDate(today.getDate() - mondayOffset - 7 * 51)

  const cols: { date: string; count: number }[][] = []
  let week: { date: string; count: number }[] = []
  const cur = new Date(start)

  while (cur <= end) {
    const iso = cur.toISOString().slice(0, 10)
    week.push({ date: iso, count: activity[iso] ?? 0 })
    if (week.length === 7) { cols.push(week); week = [] }
    cur.setDate(cur.getDate() + 1)
  }
  if (week.length) {
    while (week.length < 7) week.push({ date: '', count: 0 })
    cols.push(week)
  }
  return cols
}

const FUNNEL = [
  { key: 'not_started', label: STATUS_LABELS.not_started, bar: 'bg-[var(--text-muted)]' },
  { key: 'applied', label: STATUS_LABELS.applied, bar: 'bg-[var(--status-applied-fg)]' },
  { key: 'followed_up', label: STATUS_LABELS.followed_up, bar: 'bg-[var(--status-followed-fg)]' },
  { key: 'interviewed', label: STATUS_LABELS.interviewed, bar: 'bg-[var(--status-interview-fg)]' },
  { key: 'rejected', label: STATUS_LABELS.rejected, bar: 'bg-[var(--status-rejected-fg)]' },
]

const STATUS_VARIANT: Record<string, BadgeProps['variant']> = {
  not_started: 'not_started',
  applied: 'applied',
  followed_up: 'followed_up',
  interviewed: 'interviewed',
  rejected: 'rejected',
}

const DAYS = ['一', '二', '三', '四', '五', '六', '日']

function KpiCards({ apps }: { apps: Application[] }) {
  const counts = countByStatus(apps)
  const avg = avgFitScore(apps)

  const cards = [
    { label: '申请总数', value: String(apps.length) },
    { label: '平均匹配分', value: avg !== null ? String(avg) : '—' },
    { label: '已申请', value: String(counts.applied ?? 0) },
    { label: '面试', value: String(counts.interviewed ?? 0) },
    { label: '未通过', value: String(counts.rejected ?? 0) },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {cards.map(k => (
        <div key={k.label} className="jh-card px-4 py-4">
          <p className="jh-panel-title">{k.label}</p>
          <p className="font-serif text-2xl font-bold mt-2 text-[var(--text-primary)]">{k.value}</p>
        </div>
      ))}
    </div>
  )
}

function FunnelPanel({ counts, total }: { counts: Record<string, number>; total: number }) {
  return (
    <div className="jh-card p-5 flex flex-col gap-3.5 h-full">
      <p className="jh-panel-title">申请状态</p>
      {FUNNEL.map(s => {
        const n = counts[s.key] ?? 0
        const pct = total > 0 ? Math.round((n / total) * 100) : 0
        return (
          <div key={s.key} className="flex items-center gap-3">
            <span className="font-sans text-xs text-[var(--text-secondary)] w-14 flex-shrink-0">{s.label}</span>
            <div className="flex-1 h-2 rounded-full bg-[var(--chart-track)] overflow-hidden">
              <div className={`h-full rounded-full ${s.bar} transition-all`} style={{ width: `${pct}%` }} />
            </div>
            <span className="font-sans text-xs font-semibold text-[var(--text-primary)] w-5 text-right">{n}</span>
          </div>
        )
      })}
    </div>
  )
}

function FollowUpPanel({ apps, onUnflag }: { apps: Application[]; onUnflag: (id: number) => void }) {
  const navigate = useNavigate()
  const flagged = needsFollowUp(apps)

  return (
    <div className="jh-card p-5 flex flex-col h-full min-h-0">
      <p className="jh-panel-title mb-3">待跟进</p>
      {flagged.length === 0 ? (
        <p className="font-sans text-sm text-[var(--text-muted)] py-2">
          可在历史记录中标记待跟进申请。
        </p>
      ) : (
        <div className="flex flex-col divide-y divide-[var(--border)] overflow-y-auto max-h-64">
          {flagged.map(a => (
            <div key={a.id} className="group flex items-center gap-2 py-2.5">
              <button
                className="min-w-0 flex-1 text-left"
                onClick={() => navigate(`/editor/${a.id}`)}
              >
                <p className="font-sans text-sm font-medium text-[var(--text-primary)] truncate">{a.company}</p>
                <p className="font-sans text-xs text-[var(--text-muted)] truncate">{a.job_title}</p>
              </button>
              <Badge variant={STATUS_VARIANT[a.status] ?? 'outline'} className="flex-shrink-0 group-hover:hidden">
                {statusLabel(a.status)}
              </Badge>
              <button
                className="hidden group-hover:flex items-center justify-center w-6 h-6 flex-shrink-0 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--primary-soft)] transition-colors"
                title="取消待跟进"
                onClick={() => onUnflag(a.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function RecentApplications({ apps }: { apps: Application[] }) {
  const navigate = useNavigate()
  const recent = apps.slice(0, 5)

  return (
    <div className="jh-card p-5 flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between mb-3">
        <p className="jh-panel-title">最近申请</p>
        <button
          className="font-sans text-xs text-[var(--primary-dark)] hover:text-[var(--primary)] transition-colors"
          onClick={() => navigate('/history')}
        >
          查看全部 →
        </button>
      </div>
      {recent.length === 0 ? (
        <p className="font-sans text-sm text-[var(--text-muted)] py-2">还没有申请记录。</p>
      ) : (
        <div className="flex flex-col divide-y divide-[var(--border)]">
          {recent.map(a => (
            <button
              key={a.id}
              className="flex items-center gap-3 py-2.5 text-left hover:bg-[var(--primary-soft)]/40 -mx-2 px-2 rounded-lg transition-colors"
              onClick={() => navigate(`/editor/${a.id}`)}
            >
              <div className="min-w-0 flex-1">
                <p className="font-sans text-sm font-medium text-[var(--text-primary)] truncate">{a.job_title}</p>
                <p className="font-sans text-xs text-[var(--text-muted)] truncate">{a.company}</p>
              </div>
              {a.fit_score > 0 && (
                <span className="font-sans text-xs tabular-nums text-[var(--text-secondary)] flex-shrink-0">
                  {a.fit_score}
                </span>
              )}
              <Badge variant={STATUS_VARIANT[a.status] ?? 'outline'} className="flex-shrink-0">
                {statusLabel(a.status)}
              </Badge>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function WeeklyActivity({ apps }: { apps: Application[] }) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (6 - i))
    return {
      date: d.toISOString().slice(0, 10),
      label: d.toLocaleString('zh-CN', { weekday: 'short' }),
      isToday: i === 6,
    }
  })
  const activity = activityByDay(apps)
  const counts = days.map(d => activity[d.date] ?? 0)
  const max = Math.max(1, ...counts)

  return (
    <div className="jh-card p-5 h-full">
      <p className="jh-panel-title mb-4">本周动态</p>
      <div className="flex items-end gap-2 h-24">
        {days.map((d, i) => {
          const count = counts[i]
          const heightPct = count === 0 ? 6 : Math.max(12, Math.round((count / max) * 100))
          return (
            <div key={d.date} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end group relative">
              {count > 0 && (
                <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-[var(--text-primary)] text-[var(--surface)] font-sans text-[10px] px-1.5 py-0.5 rounded-md opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none z-10">
                  {count}
                </div>
              )}
              <div
                className={`w-full rounded-t-md ${d.isToday ? 'bg-[var(--primary-dark)]' : 'bg-[var(--primary)]'} ${count === 0 ? 'opacity-25' : ''}`}
                style={{ height: `${heightPct}%` }}
              />
              <span className={`font-sans text-[10px] ${d.isToday ? 'text-[var(--text-primary)] font-semibold' : 'text-[var(--text-muted)]'}`}>
                {d.label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function HeatmapChart({ apps }: { apps: Application[] }) {
  const activity = activityByDay(apps)
  const grid = buildHeatmapGrid(activity)
  const today = new Date().toISOString().slice(0, 10)
  const max = Math.max(1, ...Object.values(activity))

  function cellColor(count: number, date: string) {
    if (!date) return 'bg-transparent'
    if (count === 0) return 'bg-[var(--chart-track)]'
    const intensity = count / max
    if (intensity <= 0.25) return 'bg-[var(--primary-soft)]'
    if (intensity <= 0.5) return 'bg-[var(--secondary)]'
    if (intensity <= 0.75) return 'bg-[var(--primary)]'
    return 'bg-[var(--primary-dark)]'
  }

  const monthLabels: (string | null)[] = grid.map(week => {
    const firstDay = week.find(d => d.date)?.date
    if (!firstDay) return null
    const d = new Date(firstDay)
    return d.getDate() <= 7 ? d.toLocaleString('zh-CN', { month: 'short' }) : null
  })

  return (
    <div className="jh-card p-5">
      <p className="jh-panel-title mb-4">近 52 周动态</p>
      <div className="flex gap-3 min-w-0">
        <div
          className="flex-1 min-w-0 overflow-x-auto"
          style={{
            display: 'grid',
            gridTemplateColumns: `auto repeat(${grid.length}, minmax(8px, 1fr))`,
            gap: '3px',
          }}
        >
          <div />
          {grid.map((_, wi) => (
            <div key={`m-${wi}`} className="h-4 flex items-end pb-0.5">
              {monthLabels[wi] && (
                <span className="font-sans text-[10px] text-[var(--text-muted)]">{monthLabels[wi]}</span>
              )}
            </div>
          ))}

          {DAYS.map((day, di) => (
            <React.Fragment key={di}>
              <div className="flex items-center pr-1">
                <span className="font-sans text-[9px] text-[var(--text-muted)] w-6">{day}</span>
              </div>
              {grid.map((week, wi) => {
                const cell = week[di]
                return (
                  <div
                    key={wi}
                    title={cell.date ? `${cell.date}: ${cell.count} 份申请` : ''}
                    className={`aspect-square rounded-sm ${cellColor(cell.count, cell.date)} ${cell.date === today ? 'ring-1 ring-[var(--primary-dark)]' : ''}`}
                  />
                )
              })}
            </React.Fragment>
          ))}
        </div>

        <div className="flex flex-col justify-end gap-1 flex-shrink-0">
          <span className="font-sans text-[10px] text-[var(--text-muted)]">少</span>
          {['bg-[var(--chart-track)]', 'bg-[var(--primary-soft)]', 'bg-[var(--secondary)]', 'bg-[var(--primary)]', 'bg-[var(--primary-dark)]'].map(c => (
            <div key={c} className={`w-3 h-3 rounded-sm ${c}`} />
          ))}
          <span className="font-sans text-[10px] text-[var(--text-muted)]">多</span>
        </div>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [apps, setApps] = useState<Application[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getApplications()
      .then(setApps)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="font-sans text-sm text-[var(--text-muted)]">加载中…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="font-sans text-sm text-[var(--text-primary)]">{error}</span>
      </div>
    )
  }

  async function handleUnflag(id: number) {
    setApps(prev => prev.map(a => a.id === id ? { ...a, follow_up: 0 } : a))
    await api.patchApplication(id, { follow_up: 0 })
  }

  const counts = countByStatus(apps)

  return (
    <div className="flex flex-col gap-6 overflow-auto pb-8 w-full">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-bold text-[var(--text-primary)]">仪表盘</h1>
          <p className="font-sans text-sm text-[var(--text-secondary)] mt-1">你的求职进度概览</p>
        </div>
        <Button className="self-start sm:self-auto bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-[var(--surface)]" onClick={() => navigate('/new')}>
          <Plus className="h-4 w-4" />
          新建申请
        </Button>
      </div>

      <KpiCards apps={apps} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 min-w-0">
          <FunnelPanel counts={counts} total={apps.length} />
        </div>
        <div className="min-w-0">
          <FollowUpPanel apps={apps} onUnflag={handleUnflag} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 min-w-0">
          <RecentApplications apps={apps} />
        </div>
        <div className="min-w-0">
          <WeeklyActivity apps={apps} />
        </div>
      </div>

      <HeatmapChart apps={apps} />
    </div>
  )
}
