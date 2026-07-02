import type { AuditSummary } from '@/api/audit'
import { SEVERITY_META, SEVERITY_ORDER } from './auditMeta'

/** Clickable severity distribution over OPEN findings (muted excluded). */
export function SeverityBar({
  summary,
  active,
  onPick,
}: {
  summary: AuditSummary
  active: string
  onPick: (severity: string) => void
}) {
  const by = summary.counts.bySeverity
  const total = summary.counts.open
  if (total === 0) return null

  const segments = SEVERITY_ORDER
    .map((sev) => ({ sev, count: by[sev] ?? 0, meta: SEVERITY_META[sev] }))
    .filter((s) => s.count > 0)

  const denominator = summary.lastRun?.summary
    ? `based on ${summary.lastRun.summary.pagesEvaluated} of ${summary.lastRun.summary.pagesTotal} pages`
    : null

  return (
    <div className="space-y-2">
      <div className="flex h-2.5 rounded-full overflow-hidden border border-white/8">
        {segments.map((s) => (
          <button
            key={s.sev}
            onClick={() => onPick(active === s.sev ? '' : s.sev)}
            title={`${s.meta.label}: ${s.count}`}
            className={`${s.meta.dot} transition-opacity hover:opacity-80 ${active && active !== s.sev ? 'opacity-40' : ''}`}
            style={{ width: `${(s.count / total) * 100}%` }}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
        {segments.map((s) => (
          <button
            key={s.sev}
            onClick={() => onPick(active === s.sev ? '' : s.sev)}
            className={`inline-flex items-center gap-1.5 hover:text-[#e8eaed] ${active === s.sev ? 'text-[#e8eaed]' : 'text-[#9aa0a6]'}`}
          >
            <span className={`size-2 rounded-full ${s.meta.dot}`} />
            {s.meta.label} <span className="tabular-nums">{s.count}</span>
          </button>
        ))}
        {denominator && <span className="text-[#9aa0a6]/60">{denominator}</span>}
        {summary.counts.muted > 0 && (
          <span className="text-[#9aa0a6]/60">· {summary.counts.muted} muted (excluded)</span>
        )}
      </div>
    </div>
  )
}
