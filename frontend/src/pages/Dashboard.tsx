import React, { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, Application } from '@/lib/api'
import { STATUS_LABELS, statusLabel } from '@/lib/labels'

// ─── Helpers ───────────────────────────────────────────────────────────────────

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

// Build a 7-row × N-col grid for the heatmap (last 12 weeks)
function buildHeatmapGrid(activity: Record<string, number>) {
  // Start from the Monday 12 weeks ago
  const today = new Date()
  const dayOfWeek = today.getDay() // 0=Sun
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  const end = new Date(today)
  const start = new Date(today)
  start.setDate(today.getDate() - mondayOffset - 7 * 51) // 52 weeks back to Monday

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

// ─── Constants ─────────────────────────────────────────────────────────────────

const FUNNEL = [
  { key: 'not_started', label: STATUS_LABELS.not_started, dot: 'bg-gray-400', bar: 'bg-gray-300' },
  { key: 'applied', label: STATUS_LABELS.applied, dot: 'bg-blue-700', bar: 'bg-blue-700' },
  { key: 'followed_up', label: STATUS_LABELS.followed_up, dot: 'bg-yellow-400', bar: 'bg-yellow-400' },
  { key: 'interviewed', label: STATUS_LABELS.interviewed, dot: 'bg-green-700', bar: 'bg-green-700' },
  { key: 'rejected', label: STATUS_LABELS.rejected, dot: 'bg-red-600', bar: 'bg-red-200' },
]

const STATUS_DOT: Record<string, string> = {
  not_started: 'bg-gray-400', applied: 'bg-blue-700',
  followed_up: 'bg-yellow-400', interviewed: 'bg-green-700', rejected: 'bg-red-600',
}

const DAYS = ['一', '二', '三', '四', '五', '六', '日']

// ─── Sub-components ────────────────────────────────────────────────────────────

function KpiCards({ apps }: { apps: Application[] }) {
  const avg = avgFitScore(apps)
  const followUp = needsFollowUp(apps).length

  return (
    <div className="grid grid-cols-3 sm:grid-cols-3 gap-3">
      {[
        { label: '申请总数', value: apps.length, color: 'text-black' },
        { label: '平均匹配分', value: avg !== null ? `${avg}` : '—', color: avg !== null ? (avg >= 70 ? 'text-green-700' : avg >= 50 ? 'text-yellow-600' : 'text-red-600') : 'text-[#4B5563]' },
        { label: '待跟进', value: followUp, color: followUp > 0 ? 'text-orange-600' : 'text-black' },
      ].map(k => (
        <div key={k.label} className="bg-white border-2 border-black shadow-[4px_4px_0px_0px_#000000] px-5 py-4">
          <p className="font-mono text-xs uppercase tracking-wider text-[#4B5563]">{k.label}</p>
          <p className={`font-serif text-3xl font-bold mt-0.5 ${k.color}`}>{k.value}</p>
        </div>
      ))}
    </div>
  )
}

function FunnelPanel({ counts, total }: { counts: Record<string, number>; total: number }) {
  return (
    <div className="bg-white border-2 border-black shadow-[4px_4px_0px_0px_#000000] p-5 flex flex-col gap-3">
      <p className="font-mono text-xs uppercase tracking-wider text-[#4B5563]">申请进度</p>
      {FUNNEL.map(s => {
        const n = counts[s.key] ?? 0
        const pct = total > 0 ? Math.round((n / total) * 100) : 0
        return (
          <div key={s.key} className="flex items-center gap-3">
            <div className={`w-1.5 h-1.5 flex-shrink-0 ${s.dot}`} />
            <span className="font-mono text-xs uppercase tracking-wider text-[#4B5563] w-24 flex-shrink-0">{s.label}</span>
            <div className="flex-1 h-2 bg-[#F0F0E8] border border-[#ddd]">
              <div className={`h-full ${s.bar} transition-all`} style={{ width: `${pct}%` }} />
            </div>
            <span className="font-mono text-xs font-bold text-black w-5 text-right">{n}</span>
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
    <div className="bg-white border-2 border-black shadow-[4px_4px_0px_0px_#000000] p-5 flex flex-col min-h-full">
      <p className="font-mono text-xs uppercase tracking-wider text-[#4B5563] mb-3">待跟进</p>
      {flagged.length === 0 ? (
        <div className="flex-1 flex items-center justify-center font-mono text-xs uppercase tracking-wider text-[#4B5563] py-4 text-center leading-relaxed">
          [ 可在历史记录中<br />标记待跟进申请 ]
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-[#E5E5DC] overflow-y-auto">
          {flagged.map(a => (
            <div key={a.id} className="group flex items-center gap-2 py-2.5 -mx-1 px-1 hover:bg-[#F0F0E8] transition-colors">
              <div className={`w-1.5 h-1.5 flex-shrink-0 ${STATUS_DOT[a.status] ?? 'bg-gray-400'}`} />
              <button
                className="min-w-0 flex-1 text-left"
                onClick={() => navigate(`/editor/${a.id}`)}
              >
                <p className="font-mono text-xs font-medium text-black truncate">{a.company}</p>
                <p className="font-mono text-[10px] text-[#4B5563] truncate">{a.job_title}</p>
              </button>
              <span className="font-mono text-[10px] uppercase tracking-wider text-[#4B5563] flex-shrink-0 group-hover:hidden">
                {statusLabel(a.status)}
              </span>
              <button
                className="hidden group-hover:flex items-center justify-center w-5 h-5 flex-shrink-0 text-[#4B5563] hover:text-red-600 hover:bg-red-50 transition-colors"
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
    <div className="bg-white border-2 border-black shadow-[4px_4px_0px_0px_#000000] p-5">
      <p className="font-mono text-xs uppercase tracking-wider text-[#4B5563] mb-4">本周动态</p>
      <div className="flex items-end gap-2 h-20">
        {days.map((d, i) => {
          const count = counts[i]
          const heightPct = count === 0 ? 4 : Math.max(10, Math.round((count / max) * 100))
          return (
            <div key={d.date} className="flex-1 flex flex-col items-center gap-1 h-full justify-end group relative">
              {count > 0 && (
                <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-black text-white font-mono text-[10px] px-1 py-0.5 opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none z-10">
                  {count}
                </div>
              )}
              <div
                className={`w-full ${d.isToday ? 'bg-blue-700' : 'bg-blue-300'} ${count === 0 ? 'opacity-30' : ''}`}
                style={{ height: `${heightPct}%` }}
              />
              <span className={`font-mono text-[10px] uppercase ${d.isToday ? 'text-black font-bold' : 'text-[#4B5563]'}`}>
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
    if (count === 0) return 'bg-[#E5E5DC] border border-[#d0d0c4]'
    const intensity = count / max
    if (intensity <= 0.25) return 'bg-blue-200 border border-blue-300'
    if (intensity <= 0.5) return 'bg-blue-400 border border-blue-500'
    if (intensity <= 0.75) return 'bg-blue-600 border border-blue-700'
    return 'bg-blue-800 border border-blue-900'
  }

  // Month labels: show month name when first day of month appears
  const monthLabels: (string | null)[] = grid.map(week => {
    const firstDay = week.find(d => d.date)?.date
    if (!firstDay) return null
    const d = new Date(firstDay)
    return d.getDate() <= 7 ? d.toLocaleString('zh-CN', { month: 'short' }) : null
  })

  return (
    <div className="bg-white border-2 border-black shadow-[4px_4px_0px_0px_#000000] p-5">
      <p className="font-mono text-xs uppercase tracking-wider text-[#4B5563] mb-4">近 52 周动态</p>
      <div className="flex gap-3 min-w-0">

        {/* Grid — CSS grid so cells fill available width, scroll on narrow screens */}
        <div
          className="flex-1 min-w-0 overflow-x-auto"
          style={{
            display: 'grid',
            gridTemplateColumns: `auto repeat(${grid.length}, minmax(8px, 1fr))`,
            gap: '3px',
          }}
        >
          {/* Row 0: empty corner + month labels */}
          <div />
          {grid.map((_, wi) => (
            <div key={`m-${wi}`} className="h-4 flex items-end pb-0.5">
              {monthLabels[wi] && (
                <span className="font-mono text-[10px] text-[#4B5563]">{monthLabels[wi]}</span>
              )}
            </div>
          ))}

          {/* Rows 1–7: day label + cells */}
          {DAYS.map((day, di) => (
            <React.Fragment key={di}>
              <div className="flex items-center pr-1">
                <span className="font-mono text-[9px] text-[#4B5563] w-6">{day}</span>
              </div>
              {grid.map((week, wi) => {
                const cell = week[di]
                return (
                  <div
                    key={wi}
                    title={cell.date ? `${cell.date}: ${cell.count} 份申请` : ''}
                    className={`aspect-square ${cellColor(cell.count, cell.date)} ${cell.date === today ? 'ring-1 ring-black ring-offset-0' : ''}`}
                  />
                )
              })}
            </React.Fragment>
          ))}
        </div>

        {/* Legend */}
        <div className="flex flex-col justify-end gap-1 flex-shrink-0">
          <span className="font-mono text-[10px] text-[#4B5563]">少</span>
          {['bg-[#E5E5DC]', 'bg-blue-200', 'bg-blue-400', 'bg-blue-600', 'bg-blue-800'].map(c => (
            <div key={c} className={`w-3 h-3 ${c} border border-black/10`} />
          ))}
          <span className="font-mono text-[10px] text-[#4B5563]">多</span>
        </div>
      </div>
    </div>
  )
}

// ─── Page ───────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [apps, setApps] = useState<Application[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const leftRef = useRef<HTMLDivElement>(null)
  const [leftH, setLeftH] = useState<number | undefined>(undefined)

  useEffect(() => {
    api.getApplications()
      .then(setApps)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!leftRef.current) return
    const ro = new ResizeObserver(() => setLeftH(leftRef.current!.offsetHeight))
    ro.observe(leftRef.current)
    return () => ro.disconnect()
  }, [apps])

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="font-mono text-xs uppercase tracking-wider text-[#4B5563]">[ 加载中… ]</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="font-mono text-xs uppercase tracking-wider text-red-600">{error}</span>
      </div>
    )
  }

  async function handleUnflag(id: number) {
    setApps(prev => prev.map(a => a.id === id ? { ...a, follow_up: 0 } : a))
    await api.patchApplication(id, { follow_up: 0 })
  }

  const counts = countByStatus(apps)

  return (
    <div className="flex flex-col gap-4 overflow-auto pb-6 w-full">
      <h1 className="font-serif text-3xl font-bold flex-shrink-0">仪表盘</h1>

      <div className="flex flex-col sm:flex-row gap-3 sm:items-start">

        {/* Left col — KPI + Pipeline + Weekly Activity */}
        <div ref={leftRef} className="flex-[2] flex flex-col gap-3 min-w-0">
          <KpiCards apps={apps} />
          <FunnelPanel counts={counts} total={apps.length} />
          <WeeklyActivity apps={apps} />
        </div>

        {/* Right col — fixed to left col height, scrolls if overflow */}
        <div className="flex-1 min-w-0" style={{ height: leftH, maxHeight: leftH, overflowY: 'auto' }}>
          <FollowUpPanel apps={apps} onUnflag={handleUnflag} />
        </div>

      </div>

      <HeatmapChart apps={apps} />
    </div>
  )
}
