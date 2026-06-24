import { useState } from 'react'
import { toast } from 'sonner'
import {
  TrendingUp, TrendingDown, Minus, ExternalLink, Loader2, Clock, BarChart3, AlertTriangle,
  ChevronRight, Search, Download,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { downloadCsv } from '@/lib/csv'
import { useMeasureEffect, useEffectQueries } from '@/hooks/useOptimizationEffects'
import type { OptimizationEffect, EffectQueryRow } from '@/api/optimizationEffects'
import { expectedCtr, isStrikingDistance } from '@/lib/seoCtrCurve'

// Wait for re-indexing + SERP settle (~14d) THEN a 28-day window before the
// auto-measure fires. Mirrors ONSET_GAP_DAYS + WINDOW_DAYS on the backend.
const MEASURE_AFTER_DAYS = 42
const MIN_SIGNIFICANT_IMPRESSIONS = 100

/** A single before→after metric. `lowerIsBetter` for position. `muted` forces neutral. */
export function DeltaMetric({
  label, before, after, lowerIsBetter = false, suffix = '', decimals = 0, muted = false,
}: {
  label: string
  before: number
  after: number | null
  lowerIsBetter?: boolean
  suffix?: string
  decimals?: number
  muted?: boolean
}) {
  const fmt = (n: number) => n.toFixed(decimals) + suffix
  if (after === null) {
    return (
      <div className="flex-1 min-w-[110px]">
        <div className="text-[10px] uppercase tracking-wider text-[#9aa0a6]">{label}</div>
        <div className="text-[15px] text-[#e8eaed] mt-0.5">{fmt(before)}</div>
        <div className="text-[11px] text-[#9aa0a6]/60">baseline</div>
      </div>
    )
  }
  const diff = after - before
  const improved = lowerIsBetter ? diff < 0 : diff > 0
  const worse = lowerIsBetter ? diff > 0 : diff < 0
  const color = muted
    ? 'text-[#9aa0a6]'
    : improved ? 'text-emerald-400' : worse ? 'text-red-400' : 'text-[#9aa0a6]'
  const Icon = muted ? Minus : improved ? TrendingUp : worse ? TrendingDown : Minus
  const pct = before !== 0 ? Math.round((diff / before) * 100) : null

  return (
    <div className="flex-1 min-w-[110px]">
      <div className="text-[10px] uppercase tracking-wider text-[#9aa0a6]">{label}</div>
      <div className="flex items-baseline gap-1.5 mt-0.5">
        <span className="text-[13px] text-[#9aa0a6]">{fmt(before)}</span>
        <span className="text-[#9aa0a6]">→</span>
        <span className="text-[15px] text-[#e8eaed] font-medium">{fmt(after)}</span>
      </div>
      <div className={cn('flex items-center gap-1 text-[11px] mt-0.5', color)}>
        <Icon className="size-3" />
        {diff > 0 ? '+' : ''}{fmt(diff)}{pct !== null && ` (${diff > 0 ? '+' : ''}${pct}%)`}
      </div>
    </div>
  )
}

export function EffectCard({
  effect, siteId, highlighted = false, confounders = 0, onHover,
}: {
  effect: OptimizationEffect
  siteId: string
  highlighted?: boolean
  /** Other tracked changes overlapping this measurement window. */
  confounders?: number
  onHover?: (hovering: boolean) => void
}) {
  const measure = useMeasureEffect(siteId)
  const measured = effect.status === 'measured'
  const noData = effect.status === 'no_data'

  const measureDate = new Date(effect.appliedAt)
  measureDate.setDate(measureDate.getDate() + MEASURE_AFTER_DAYS)
  const ready = Date.now() >= measureDate.getTime()

  // Significance guard: small impression counts make % deltas meaningless.
  const sampleImpr = effect.resultImpressions ?? effect.baselineImpressions
  const lowSample = measured && sampleImpr < MIN_SIGNIFICANT_IMPRESSIONS

  // CTR vs the expected CTR for the rank the page now sits at.
  const ctrVsExpected = measured && effect.resultPosition && effect.resultCtr != null && !lowSample
    ? (() => {
        const expected = expectedCtr(effect.resultPosition) * 100
        return {
          actual: effect.resultCtr,
          expected,
          over: effect.resultCtr >= expected,
          striking: isStrikingDistance(effect.resultPosition),
        }
      })()
    : null

  const handleMeasure = async () => {
    try {
      await measure.mutateAsync(effect.id)
      toast.success('Measured against the latest Search Console data')
    } catch {
      toast.error("Couldn't measure. Check that Search Console is connected.")
    }
  }

  return (
    <div
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
      className={cn(
        'rounded-xl border bg-[#1a1d27] overflow-hidden transition-colors',
        highlighted ? 'border-[#4e8af4]/70 ring-1 ring-[#4e8af4]/30' : 'border-white/8',
      )}
    >
      <div className="px-4 py-3 flex items-center gap-3 border-b border-white/5">
        <div className="min-w-0 flex-1">
          <a
            href={effect.pageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[13px] text-[#e8eaed] hover:text-[#4e8af4] inline-flex items-center gap-1 truncate max-w-full"
          >
            {effect.pageUrl}
            <ExternalLink className="size-3 flex-shrink-0 opacity-50" />
          </a>
          <div className="text-[11px] text-[#9aa0a6] mt-0.5">
            Changed <span className="text-[#c8cad0]">{effect.changeSummary}</span> ·{' '}
            {new Date(effect.appliedAt).toLocaleDateString()}
          </div>
        </div>
        {measured ? (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 flex-shrink-0">Measured</span>
        ) : noData ? (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-[#9aa0a6] flex-shrink-0">No GSC data</span>
        ) : (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 flex-shrink-0 inline-flex items-center gap-1">
            <Clock className="size-2.5" /> Pending
          </span>
        )}
      </div>

      <div className="px-4 py-3">
        {confounders > 0 && (
          <div className="flex items-start gap-1.5 text-[11px] text-amber-400/90 mb-2">
            <AlertTriangle className="size-3 mt-0.5 flex-shrink-0" />
            <span>
              {confounders} other change{confounders > 1 ? 's' : ''} on this page fall in the same
              measurement window - impact can&apos;t be attributed to this change alone.
            </span>
          </div>
        )}
        {!effect.baselineHasData && (
          <div className="text-[11px] text-[#9aa0a6]/70 mb-2">
            No Search Console impressions before the change - this page had little or no organic visibility to begin with.
          </div>
        )}
        {lowSample && (
          <div className="text-[11px] text-amber-400/80 mb-2">
            Small sample (under {MIN_SIGNIFICANT_IMPRESSIONS} impressions) - we still show the change, but read the direction loosely, not the exact numbers.
          </div>
        )}
        <div className="flex flex-wrap gap-4">
          <DeltaMetric label="Clicks" before={effect.baselineClicks} after={effect.resultClicks} muted={lowSample} />
          <DeltaMetric label="Impressions" before={effect.baselineImpressions} after={effect.resultImpressions} muted={lowSample} />
          <DeltaMetric label="CTR" before={effect.baselineCtr} after={effect.resultCtr} suffix="%" decimals={2} muted={lowSample} />
          <DeltaMetric label="Avg position" before={effect.baselinePosition} after={effect.resultPosition} lowerIsBetter decimals={1} muted={lowSample} />
        </div>

        {ctrVsExpected && (
          <div className="text-[11px] mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-[#9aa0a6]">
              CTR vs expected at pos {effect.resultPosition!.toFixed(1)}:
            </span>
            <span className="text-[#c8cad0]">{ctrVsExpected.actual.toFixed(2)}%</span>
            <span className="text-[#9aa0a6]/60">vs ~{ctrVsExpected.expected.toFixed(2)}% expected</span>
            <span className={ctrVsExpected.over ? 'text-emerald-400' : 'text-amber-400'}>
              ({ctrVsExpected.over ? 'over' : 'under'}-performing its rank)
            </span>
            {ctrVsExpected.striking && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#4e8af4]/15 text-[#4e8af4]">
                striking distance
              </span>
            )}
          </div>
        )}

        {!measured && !noData && (
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-white/5">
            <span className="text-[11px] text-[#9aa0a6]">
              {ready
                ? 'The measurement window is complete - you can measure now.'
                : `Measures automatically on ${measureDate.toLocaleDateString()} - it waits about 14 days for re-indexing, then watches a 28-day window.`}
            </span>
            <div className="flex-1" />
            <button
              onClick={handleMeasure}
              disabled={measure.isPending}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] bg-[#4e8af4]/15 text-[#4e8af4] hover:bg-[#4e8af4]/25 disabled:opacity-50 transition-colors"
            >
              {measure.isPending ? <Loader2 className="size-3 animate-spin" /> : <BarChart3 className="size-3" />}
              Measure now
            </button>
          </div>
        )}
        {measured && effect.resultEnd && (
          <div className="text-[11px] text-[#9aa0a6]/60 mt-3 pt-3 border-t border-white/5">
            Baseline {effect.baselineStart} → {effect.baselineEnd} vs result {effect.resultStart} → {effect.resultEnd}
          </div>
        )}

        {/* ── Per-query before→after drill-down ──────────────────────────── */}
        <div className="mt-3 pt-3 border-t border-white/5">
          <EffectQueriesSection siteId={siteId} effectId={effect.id} measured={measured} />
        </div>
      </div>
    </div>
  )
}

// ── Per-query drill-down panel ───────────────────────────────────────────────

/**
 * The collapsible "Queries that moved" toggle + lazy panel. Reused by both the
 * EffectCard and the timeline's MarkerDetail so a measured change exposes its
 * per-query before→after the same way wherever it surfaces.
 */
export function EffectQueriesSection({
  siteId, effectId, measured,
}: {
  siteId: string
  effectId: string
  measured: boolean
}) {
  const [showQueries, setShowQueries] = useState(false)
  return (
    <>
      <button
        onClick={() => setShowQueries((s) => !s)}
        className="flex items-center gap-1 text-[11px] text-[#9aa0a6] hover:text-[#e8eaed] transition-colors"
      >
        <ChevronRight className={cn('size-3 transition-transform', showQueries && 'rotate-90')} />
        <Search className="size-3" />
        {measured ? 'Queries that moved' : 'Top queries (baseline)'}
      </button>
      {showQueries && <EffectQueriesPanel siteId={siteId} effectId={effectId} />}
    </>
  )
}

/** A single before→after numeric cell. Muted/baseline-only until measured. */
function QCell({
  before, after, lowerIsBetter = false, decimals = 0, suffix = '',
}: {
  before: number | null
  after: number | null
  lowerIsBetter?: boolean
  decimals?: number
  suffix?: string
}) {
  const fmt = (n: number) => n.toFixed(decimals) + suffix
  if (before == null && after == null) return <span className="text-[#9aa0a6]/30">-</span>
  if (after == null) {
    return <span className="text-[#9aa0a6] tabular-nums">{before != null ? fmt(before) : '-'}</span>
  }
  if (before == null) {
    return <span className="text-[#e8eaed] tabular-nums">{fmt(after)}</span>
  }
  const diff = after - before
  const improved = lowerIsBetter ? diff < 0 : diff > 0
  const worse = lowerIsBetter ? diff > 0 : diff < 0
  const color = improved ? 'text-emerald-400' : worse ? 'text-red-400' : 'text-[#9aa0a6]'
  return (
    <span className="inline-flex items-baseline gap-1 tabular-nums">
      <span className="text-[#9aa0a6]">{fmt(before)}</span>
      <span className="text-[#9aa0a6]/50">→</span>
      <span className="text-[#e8eaed]">{fmt(after)}</span>
      {diff !== 0 && <span className={cn('text-[10px]', color)}>{diff > 0 ? '+' : ''}{fmt(diff)}</span>}
    </span>
  )
}

function EffectQueriesPanel({ siteId, effectId }: { siteId: string; effectId: string }) {
  const { data, isLoading, isError } = useEffectQueries(siteId, effectId, true)

  if (isLoading) {
    return (
      <div className="mt-2 flex items-center gap-2 text-[11px] text-[#9aa0a6]">
        <Loader2 className="size-3 animate-spin" /> Loading queries…
      </div>
    )
  }
  if (isError) {
    return <div className="mt-2 text-[11px] text-[#9aa0a6]">Couldn't load query data - try again.</div>
  }
  const rows = data?.rows ?? []
  const realRows = rows.filter((r) => !r.isRemainder)
  if (realRows.length === 0) {
    return (
      <div className="mt-2 text-[11px] text-[#9aa0a6]/80">
        No query-level data for this page in the snapshot window - Search Console only reports
        queries above a traffic threshold.
      </div>
    )
  }
  const remainder = rows.find((r) => r.isRemainder)
  const cov = data?.baselineCoverage
  const resCov = data?.resultCoverage

  const exportCsv = () => {
    downloadCsv(
      `effect-queries-${effectId}.csv`,
      ['query', 'baselineClicks', 'baselineImpr', 'baselineCtr', 'baselinePos',
        'resultClicks', 'resultImpr', 'resultCtr', 'resultPos', 'isNew', 'isLost', 'isRemainder'],
      rows.map((r) => [
        r.isRemainder ? '(other / undisclosed)' : r.query,
        r.baseline?.clicks ?? '', r.baseline?.impressions ?? '', r.baseline?.ctr ?? '', r.baseline?.position ?? '',
        r.result?.clicks ?? '', r.result?.impressions ?? '', r.result?.ctr ?? '', r.result?.position ?? '',
        String(r.isNew), String(r.isLost), String(r.isRemainder),
      ]),
    )
  }

  return (
    <div className="mt-2">
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 gap-y-1 text-[11px]">
        <span className="text-[10px] uppercase tracking-wider text-[#9aa0a6]/70">Query</span>
        <span className="text-[10px] uppercase tracking-wider text-[#9aa0a6]/70 text-right">Clicks</span>
        <span className="text-[10px] uppercase tracking-wider text-[#9aa0a6]/70 text-right">Impr</span>
        <span className="text-[10px] uppercase tracking-wider text-[#9aa0a6]/70 text-right">Avg pos</span>
        {realRows.map((r) => (
          <QueryRow key={r.query} r={r} />
        ))}
        {remainder && (remainder.baseline || remainder.result) && (
          <>
            <span className="text-[#9aa0a6]/50 italic truncate">other / undisclosed queries</span>
            <span className="text-right"><QCell before={remainder.baseline?.clicks ?? null} after={remainder.result?.clicks ?? null} /></span>
            <span className="text-right"><QCell before={remainder.baseline?.impressions ?? null} after={remainder.result?.impressions ?? null} /></span>
            <span className="text-right text-[#9aa0a6]/30">-</span>
          </>
        )}
      </div>

      <div className="flex items-start justify-between gap-3 mt-2">
        <p className="text-[10px] text-[#9aa0a6]/70 leading-relaxed max-w-md">
          {cov != null
            ? `Top queries cover ${Math.round(cov * 100)}% of baseline clicks${resCov != null ? ` · ${Math.round(resCov * 100)}% of result clicks` : ''}. `
            : ''}
          The rest are low-volume queries Google hides for privacy, so the rows won't add up to the
          page total. Treat movement as correlated with the change, not proof it caused it.
        </p>
        <button
          onClick={exportCsv}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-white/5 text-[#9aa0a6] hover:text-[#e8eaed] transition-colors flex-shrink-0"
        >
          <Download className="size-3" /> CSV
        </button>
      </div>
    </div>
  )
}

function QueryRow({ r }: { r: EffectQueryRow }) {
  return (
    <>
      <span className="flex items-center gap-1.5 min-w-0">
        <span className="truncate text-[#e8eaed]" title={r.query}>{r.query}</span>
        {r.isNew && (
          <span className="text-[9px] px-1 py-px rounded-full bg-emerald-500/15 text-emerald-400 flex-shrink-0">new</span>
        )}
        {r.isLost && (
          <span className="text-[9px] px-1 py-px rounded-full bg-red-500/15 text-red-400 flex-shrink-0">lost</span>
        )}
      </span>
      <span className="text-right">
        <QCell before={r.baseline?.clicks ?? null} after={r.result?.clicks ?? null} />
      </span>
      <span className="text-right">
        <QCell before={r.baseline?.impressions ?? null} after={r.result?.impressions ?? null} />
      </span>
      <span className="text-right">
        <QCell before={r.baseline?.position ?? null} after={r.result?.position ?? null} lowerIsBetter decimals={1} />
      </span>
    </>
  )
}
