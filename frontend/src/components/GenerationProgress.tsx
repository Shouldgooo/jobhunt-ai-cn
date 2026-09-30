import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatElapsedWait, type GenProgressState } from '@/lib/analyze-stream'

export function GenerationProgress({
  state,
  onCancel,
  onRetry,
  elapsedMs = 0,
}: {
  state: GenProgressState
  onCancel?: () => void
  onRetry?: () => void
  elapsedMs?: number
}) {
  const pct = Math.max(0, Math.min(100, state.progress))
  const running = state.phase === 'running'
  const failed = state.phase === 'error'
  const cancelled = state.phase === 'cancelled'
  const done = state.phase === 'complete'

  return (
    <div className="jh-card p-5 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-serif text-xl font-bold">
          {failed ? '生成失败' : cancelled ? '生成已取消' : done ? '生成完成 ✓' : '正在生成申请材料'}
        </h2>
        <span className="font-mono text-sm tabular-nums font-bold" aria-hidden="true">
          {pct}%
        </span>
      </div>

      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label="生成进度"
        className="h-2.5 rounded-full bg-[var(--chart-track)] overflow-hidden relative"
      >
        <div
          className={`h-full rounded-full bg-[var(--primary-dark)] ${state.waitingOnModel ? 'gen-progress-waiting' : ''}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <p className="font-sans text-sm text-[var(--text-secondary)] whitespace-pre-line" role="status" aria-live="polite">
        {state.message}
      </p>

      {running && state.waitingOnModel && (
        <p className="font-mono text-xs uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          当前步骤：{state.message}
        </p>
      )}

      {running && (
        <p className="font-mono text-xs tabular-nums text-[var(--text-secondary)]" aria-live="polite">
          {formatElapsedWait(elapsedMs)}
        </p>
      )}

      {running && onCancel && (
        <Button type="button" variant="outline" onClick={onCancel}>
          取消生成
        </Button>
      )}

      {failed && onRetry && (
        <Button type="button" onClick={onRetry}>
          重新尝试
        </Button>
      )}
    </div>
  )
}
