import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ChevronRight, Search, Download, Loader2, Star, GitFork } from 'lucide-react'
import { cn } from '@/lib/utils'
import { downloadCsv } from '@/lib/csv'
import { useImpactPageQueries, useAddWatchedKeyword, useCannibalization } from '@/hooks/useImpact'
import type { PageQueryRow } from '@/api/impact'

/**
 * Per-page query drill-down for the Optimization Impact page: top queries for the
 * current range vs the immediately-preceding period. Collapsed and lazy by default
 * so it never delays the timeline. Disclosed queries don't sum to the page total
 * (GSC withholds low-volume "anonymized" queries) - the remainder row + coverage
 * line keep that gap honest. Movement is correlation, not proof of cause.
 */
export function ImpactQueriesPanel({
  siteId, pageId, pageUrl, from, to, brand,
}: {
  siteId: string
  pageId: string
  pageUrl: string
  from: string
  to: string
  brand: 'all' | 'nonbranded'
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-xl border border-white/8 bg-[#14161f] p-4">
      <button
        onClick={() => setOpen((s) => !s)}
        className="flex items-center gap-1.5 text-[12px] text-[#9aa0a6] hover:text-[#e8eaed] transition-colors"
      >
        <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
        <Search className="size-3.5" />
        <span className="text-[#e8eaed] font-medium">Top queries</span>
        <span className="text-[11px] text-[#9aa0a6]/70">
          · current vs previous period{brand === 'nonbranded' ? ' · non-branded' : ''}
        </span>
      </button>
      {open && <QueriesBody siteId={siteId} pageId={pageId} pageUrl={pageUrl} from={from} to={to} brand={brand} />}
    </div>
  )
}

function QueriesBody({
  siteId, pageId, pageUrl, from, to, brand,
}: {
  siteId: string; pageId: string; pageUrl: string; from: string; to: string; brand: 'all' | 'nonbranded'
}) {
  const { data, isLoading, isError } = useImpactPageQueries(
    siteId, { pageUrl, from, to, brand }, true,
  )
  const addKw = useAddWatchedKeyword(siteId)
  const watch = (query: string) => {
    addKw.mutate(
      { query, pageId, pageUrl, source: 'manual' },
      { onSuccess: () => toast.success(`Now watching "${query}" on this page`) },
    )
  }
  // Per-query cannibalization: how many OTHER pages compete for the same query.
  const { data: cann } = useCannibalization(siteId, { from, to, pageUrl }, true)
  const competeBy = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of cann?.conflicts ?? []) m.set(c.query, Math.max(0, c.competingPages.length - 1))
    return m
  }, [cann])

  if (isLoading) {
    return (
      <div className="mt-3 flex items-center gap-2 text-[12px] text-[#9aa0a6]">
        <Loader2 className="size-3.5 animate-spin" /> Loading queries…
      </div>
    )
  }
  if (isError) {
    return <div className="mt-3 text-[12px] text-[#9aa0a6]">Couldn’t load query data for this page.</div>
  }

  const rows = data?.rows ?? []
  const realRows = rows.filter((r) => !r.isRemainder)
  if (realRows.length === 0) {
    return (
      <div className="mt-3 text-[12px] text-[#9aa0a6]/80">
        No per-query data for this page in this range. Search Console only reports queries that get
        enough traffic.
      </div>
    )
  }
  const remainder = rows.find((r) => r.isRemainder)
  const cov = data?.currentCoverage
  const prevCov = data?.previousCoverage

  const exportCsv = () => {
    downloadCsv(
      `impact-queries-${pageUrl.replace(/[^a-z0-9]+/gi, '_').slice(0, 60)}.csv`,
      ['query', 'prevClicks', 'prevImpr', 'prevCtr', 'prevPos',
        'curClicks', 'curImpr', 'curCtr', 'curPos', 'isNew', 'isLost', 'isRemainder'],
      rows.map((r) => [
        r.isRemainder ? '(other / undisclosed)' : r.query,
        r.previous?.clicks ?? '', r.previous?.impressions ?? '', r.previous?.ctr ?? '', r.previous?.position ?? '',
        r.current?.clicks ?? '', r.current?.impressions ?? '', r.current?.ctr ?? '', r.current?.position ?? '',
        String(r.isNew), String(r.isLost), String(r.isRemainder),
      ]),
    )
  }

  return (
    <div className="mt-3">
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 gap-y-1.5 text-[12px]">
        <span className="text-[10px] uppercase tracking-wider text-[#9aa0a6]/70">Query</span>
        <span className="text-[10px] uppercase tracking-wider text-[#9aa0a6]/70 text-right">Clicks</span>
        <span className="text-[10px] uppercase tracking-wider text-[#9aa0a6]/70 text-right">Impr</span>
        <span className="text-[10px] uppercase tracking-wider text-[#9aa0a6]/70 text-right">Avg pos</span>
        {realRows.map((r) => (
          <QueryRow key={r.query} r={r} competing={competeBy.get(r.query) ?? 0} onWatch={() => watch(r.query)} />
        ))}
        {remainder && (remainder.current || remainder.previous) && (
          <>
            <span className="text-[#9aa0a6]/50 italic truncate">other / undisclosed queries</span>
            <span className="text-right"><QCell before={remainder.previous?.clicks ?? null} after={remainder.current?.clicks ?? null} /></span>
            <span className="text-right"><QCell before={remainder.previous?.impressions ?? null} after={remainder.current?.impressions ?? null} /></span>
            <span className="text-right text-[#9aa0a6]/30">-</span>
          </>
        )}
      </div>

      <div className="flex items-start justify-between gap-3 mt-3 pt-2 border-t border-white/5">
        <p className="text-[10px] text-[#9aa0a6]/70 leading-relaxed max-w-lg">
          {cov != null
            ? `Top queries cover ${Math.round(cov * 100)}% of clicks this period${prevCov != null ? ` · ${Math.round(prevCov * 100)}% the previous period` : ''}. `
            : ''}
          The rest are low-volume queries Google hides for privacy, so the rows won't add up to the
          page total. Movement lines up with what changed - it isn't proof the change caused it.
        </p>
        <button
          onClick={exportCsv}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-white/5 text-[#9aa0a6] hover:text-[#e8eaed] transition-colors flex-shrink-0"
        >
          <Download className="size-3" /> CSV
        </button>
      </div>
    </div>
  )
}

/** A single before→after numeric cell, colored by direction. */
function QCell({
  before, after, lowerIsBetter = false, decimals = 0,
}: {
  before: number | null
  after: number | null
  lowerIsBetter?: boolean
  decimals?: number
}) {
  const fmt = (n: number) => n.toFixed(decimals)
  if (before == null && after == null) return <span className="text-[#9aa0a6]/30">-</span>
  if (after == null) return <span className="text-[#9aa0a6] tabular-nums">{before != null ? fmt(before) : '-'}</span>
  if (before == null) return <span className="text-[#e8eaed] tabular-nums">{fmt(after)}</span>
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

function QueryRow({ r, competing, onWatch }: { r: PageQueryRow; competing: number; onWatch: () => void }) {
  return (
    <>
      <span className="flex items-center gap-1.5 min-w-0">
        <button
          onClick={onWatch}
          title="Watch this keyword on this page"
          className="text-[#9aa0a6]/40 hover:text-[#fbbf24] transition-colors flex-shrink-0"
        >
          <Star className="size-3" />
        </button>
        <span className="truncate text-[#e8eaed]" title={r.query}>{r.query}</span>
        {r.isNew && <span className="text-[9px] px-1 py-px rounded-full bg-emerald-500/15 text-emerald-400 flex-shrink-0">new</span>}
        {r.isLost && <span className="text-[9px] px-1 py-px rounded-full bg-red-500/15 text-red-400 flex-shrink-0">lost</span>}
        {competing > 0 && (
          <span className="inline-flex items-center gap-0.5 text-[9px] px-1 py-px rounded-full bg-[#a78bfa]/15 text-[#a78bfa] flex-shrink-0"
            title={`Also ranks on ${competing} other page${competing > 1 ? 's' : ''} - cannibalization`}>
            <GitFork className="size-2.5" />{competing}
          </span>
        )}
      </span>
      <span className="text-right"><QCell before={r.previous?.clicks ?? null} after={r.current?.clicks ?? null} /></span>
      <span className="text-right"><QCell before={r.previous?.impressions ?? null} after={r.current?.impressions ?? null} /></span>
      <span className="text-right"><QCell before={r.previous?.position ?? null} after={r.current?.position ?? null} lowerIsBetter decimals={1} /></span>
    </>
  )
}
