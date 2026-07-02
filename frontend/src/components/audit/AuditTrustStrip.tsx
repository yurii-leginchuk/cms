import { Skeleton } from '@/components/ui/skeleton'
import { RelativeClock } from '@/components/index-status/RelativeClock'
import type { AuditSummary } from '@/api/audit'

/**
 * The honesty header: when we last audited, how much of the scope we actually
 * evaluated (denominators inline, always), which detectors were partial, and
 * when the next scheduled run is. A half-checked scope must never read as
 * "all clear".
 */
export function AuditTrustStrip({ summary }: { summary: AuditSummary | undefined }) {
  if (!summary) return <Skeleton className="h-16 w-full bg-white/5 rounded-xl" />
  const run = summary.lastRun
  if (!run) return null

  const coverage = run.coverage ?? {}
  const detectors = Object.keys(coverage)
  const partial = detectors.filter((k) => !coverage[k].scopeComplete)
  const s = run.summary

  return (
    <div className="rounded-xl border border-white/8 bg-[#1a1d27]/60 px-5 py-4 flex flex-wrap items-center gap-x-8 gap-y-3">
      <div className="text-[13px] text-[#e8eaed]">
        Last audit <RelativeClock ts={run.finishedAt ?? run.startedAt} />
        {run.trigger === 'manual' && <span className="text-[#9aa0a6]"> (manual)</span>}
        {s && (
          <span className="text-[#9aa0a6]">
            {' · '}
            <span className="text-[#e8eaed] tabular-nums">{s.pagesEvaluated}</span> of{' '}
            <span className="tabular-nums">{s.pagesTotal}</span> pages the CMS manages evaluated
          </span>
        )}
      </div>
      <div className="text-[12px] text-[#9aa0a6]">
        {detectors.length > 0 && (
          <>
            <span className="text-[#e8eaed] tabular-nums">{detectors.length - partial.length}</span> of{' '}
            <span className="tabular-nums">{detectors.length}</span> detectors complete
            {partial.length > 0 && (
              <span className="text-amber-300/90"> · {partial.length} partial</span>
            )}
          </>
        )}
      </div>
      <div className="text-[12px] text-[#9aa0a6]">
        Live fetches: <span className="tabular-nums text-[#e8eaed]">{run.liveFetchesUsed}</span> / {run.liveFetchBudget}
      </div>
      <div className="text-[12px] text-[#9aa0a6]">
        Next scheduled run: <span className="text-[#e8eaed]">{summary.nextRunLabel}</span>
      </div>
    </div>
  )
}
