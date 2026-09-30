import { parseChangeSummary } from '@/lib/change-summary'

const TYPE_LABEL: Record<string, string> = {
  added: '新增',
  removed: '删除',
  modified: '调整',
}

export function VerifiedChangeSummary({ raw }: { raw?: string | null }) {
  const summary = parseChangeSummary(raw)
  if (!summary) return null

  if (summary.status === 'unavailable') {
    return (
      <section className="border-b border-[var(--border)] bg-[var(--bg)] px-4 py-3 flex-shrink-0">
        <h2 className="font-serif text-lg font-bold">本次针对 JD 的实际改动</h2>
        <p className="font-sans text-sm text-[var(--text-secondary)] mt-1">{summary.message || '暂时无法生成可靠的改动概要。'}</p>
      </section>
    )
  }

  const hasResume = summary.resume_changes.length > 0
  const hasCover = summary.cover_letter.items.length > 0
  const empty = !hasResume && !hasCover

  return (
    <section className="border-b border-[var(--border)] bg-[var(--surface)] px-4 py-4 flex-shrink-0 space-y-4 max-h-[40vh] overflow-y-auto">
      <h2 className="font-serif text-lg font-bold">本次针对 JD 的实际改动</h2>

      <div>
        <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--text-secondary)]">简历实际改动</h3>
        {empty && (
          <p className="font-sans text-sm text-[var(--text-secondary)] mt-2">{summary.message || '未检测到可验证的实质性改动。'}</p>
        )}
        {hasResume && (
          <ul className="mt-2 space-y-3">
            {summary.resume_changes.map((change, i) => (
              <li key={`${change.section}-${i}`} className="border border-[var(--border)] p-3 space-y-1.5">
                <p className="font-mono text-xs uppercase tracking-wider">
                  {change.section}
                  <span className="ml-2 text-[var(--text-secondary)]">{TYPE_LABEL[change.type] || change.type}</span>
                </p>
                <p className="font-sans text-sm whitespace-pre-wrap">
                  <span className="font-mono text-xs uppercase tracking-wider text-[var(--text-secondary)]">原来：</span>
                  {' '}{change.before || '（无）'}
                </p>
                <p className="font-sans text-sm whitespace-pre-wrap">
                  <span className="font-mono text-xs uppercase tracking-wider text-[var(--text-secondary)]">调整后：</span>
                  {' '}{change.after || '（无）'}
                </p>
                {change.jd_keywords && change.jd_keywords.length > 0 && (
                  <p className="font-sans text-sm">
                    <span className="font-mono text-xs uppercase tracking-wider text-[var(--text-secondary)]">对应 JD：</span>
                    {' '}{change.jd_keywords.join('、')}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {hasCover && (
        <div>
          <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--text-secondary)]">求职信针对 JD 的实际定制内容</h3>
          <ul className="mt-2 space-y-2">
            {summary.cover_letter.items.map((item, i) => (
              <li key={i} className="font-sans text-sm">
                <span className="font-mono text-xs uppercase tracking-wider text-[var(--text-secondary)]">加入内容：</span>
                {' '}{item.text}
                {item.jd_keywords && item.jd_keywords.length > 0 && (
                  <span className="block mt-0.5">
                    <span className="font-mono text-xs uppercase tracking-wider text-[var(--text-secondary)]">对应 JD：</span>
                    {' '}{item.jd_keywords.join('、')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {summary.unsupported_experience.length > 0 && (
        <div className="border border-[var(--border)] bg-neutral-100 p-3 space-y-1">
          <p className="font-sans text-sm font-bold">需要确认：该工作经历中的新增内容可能缺少原始资料支持。</p>
          {summary.unsupported_experience.map((item, i) => (
            <p key={i} className="font-sans text-sm">{item.text}</p>
          ))}
        </div>
      )}

      {summary.unsupported.length > 0 && (
        <div className="border border-[var(--border)] bg-neutral-100 p-3 space-y-1">
          <p className="font-sans text-sm font-bold">需要确认：生成后的简历出现了原始资料中未明确支持的内容。</p>
          {summary.unsupported.map((item, i) => (
            <p key={i} className="font-sans text-sm">
              {item.section ? `${item.section}：` : ''}{item.text}
              {item.excerpt ? ` — ${item.excerpt}` : ''}
            </p>
          ))}
        </div>
      )}
    </section>
  )
}
