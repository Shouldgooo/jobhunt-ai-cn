import {
  buildAnalysisView,
  EVIDENCE_LEVEL_LABEL,
  type AnalysisPoint,
  type EvidenceLevel,
} from '@/lib/analysis-summary'

function levelClass(level: EvidenceLevel): string {
  if (level === 'strong') return 'bg-[var(--status-applied-bg)] text-[var(--status-applied-fg)]'
  if (level === 'partial') return 'bg-[var(--status-followed-bg)] text-[var(--status-followed-fg)]'
  return 'bg-[var(--status-rejected-bg)] text-[var(--status-rejected-fg)]'
}

function PointList({ items }: { items: AnalysisPoint[] }) {
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={`${item.level}-${item.title}`} className="space-y-1">
          <div className="flex items-start justify-between gap-3">
            <p className="font-sans text-sm font-medium">{item.title}</p>
            <span className={`flex-shrink-0 rounded-full px-2 py-0.5 font-sans text-[11px] ${levelClass(item.level)}`}>
              {EVIDENCE_LEVEL_LABEL[item.level]}
            </span>
          </div>
          <p className="font-sans text-sm text-[var(--text-secondary)] leading-relaxed">{item.detail}</p>
        </li>
      ))}
    </ul>
  )
}

export function AnalysisPanel({
  fitScore,
  changeSummary,
}: {
  fitScore: number
  changeSummary?: string | null
}) {
  const view = buildAnalysisView({ fit_score: fitScore, change_summary: changeSummary })
  const bar = Math.max(0, Math.min(100, view.fitScore))

  return (
    <div className="flex-1 overflow-auto bg-[var(--bg)]">
      <div className="mx-auto w-full max-w-[40rem] px-5 py-8 sm:px-6 space-y-6">
        <div>
          <h1 className="font-serif text-2xl font-bold">分析结果</h1>
        </div>

        <section className="jh-card px-5 py-5 space-y-3">
          <p className="jh-panel-title">匹配度</p>
          <p className="font-serif text-4xl font-bold tracking-tight">
            {view.fitScore}
            <span className="ml-1 font-sans text-base font-medium text-[var(--text-secondary)]">/ 100</span>
          </p>
          <div className="h-1.5 rounded-full bg-[var(--chart-track)] overflow-hidden">
            <div
              className="h-full rounded-full bg-[var(--primary)] transition-all"
              style={{ width: `${bar}%` }}
            />
          </div>
        </section>

        <section className="jh-card px-5 py-5 space-y-2">
          <h2 className="font-serif text-lg font-bold">综合分析</h2>
          <p className="font-sans text-sm leading-relaxed text-[var(--text-primary)]">{view.overview}</p>
        </section>

        <section className="jh-card px-5 py-5 space-y-2">
          <h2 className="font-serif text-lg font-bold">本次简历调整</h2>
          <p className="font-sans text-sm leading-relaxed text-[var(--text-primary)]">{view.changeSummaryText}</p>
        </section>

        <section className="jh-card px-5 py-5 space-y-3">
          <h2 className="font-serif text-lg font-bold">主要优势</h2>
          {view.strengths.length > 0 ? (
            <PointList items={view.strengths} />
          ) : (
            <p className="font-sans text-sm text-[var(--text-secondary)] leading-relaxed">
              {view.evidenceFallback || '暂无带原始资料支持的优势条目。'}
            </p>
          )}
        </section>

        <section className="jh-card px-5 py-5 space-y-3">
          <h2 className="font-serif text-lg font-bold">需要注意</h2>
          {view.attention.length > 0 ? (
            <PointList items={view.attention} />
          ) : (
            <p className="font-sans text-sm text-[var(--text-secondary)] leading-relaxed">
              {view.evidenceFallback || '暂无需要特别标注的核心缺口。'}
            </p>
          )}
        </section>

        <section className="jh-card px-5 py-5 space-y-2">
          <h2 className="font-serif text-lg font-bold">建议</h2>
          <p className="font-sans text-sm leading-relaxed text-[var(--text-primary)]">{view.recommendation}</p>
        </section>
      </div>
    </div>
  )
}
