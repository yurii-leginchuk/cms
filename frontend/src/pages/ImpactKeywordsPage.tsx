import { useMemo, useState } from 'react'
import { useParams, Navigate, Link } from 'react-router-dom'
import {
  ArrowLeft, Plus, X, ExternalLink, TrendingUp, Globe, FileText, Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  useKeywordMonitoring, useAddWatchedKeyword, useRemoveWatchedKeyword,
} from '@/hooks/useImpact'
import { CannibalizationPanel } from '@/components/impact/CannibalizationPanel'
import type { WatchedKeywordMonitor, KeywordPoint } from '@/api/impact'

const RANGES: { label: string; days: number }[] = [
  { label: '28d', days: 28 }, { label: '90d', days: 90 },
  { label: '6mo', days: 182 }, { label: '12mo', days: 365 },
]

function daysAgoStr(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)
}

export default function ImpactKeywordsPage() {
  const { id: siteId } = useParams<{ id: string }>()
  const [rangeDays, setRangeDays] = useState(90)
  const [draft, setDraft] = useState('')

  const params = useMemo(
    () => ({ from: daysAgoStr(rangeDays), to: daysAgoStr(0) }),
    [rangeDays],
  )
  const { data, isLoading } = useKeywordMonitoring(siteId ?? '', params)
  const addKw = useAddWatchedKeyword(siteId ?? '')
  const removeKw = useRemoveWatchedKeyword(siteId ?? '')

  if (!siteId) return <Navigate to="/sites" replace />

  const keywords = data?.keywords ?? []
  const submit = () => {
    const q = draft.trim()
    if (!q) return
    addKw.mutate({ query: q })
    setDraft('')
  }

  return (
    <div className="min-h-full">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="border-b border-white/8 px-8 py-5">
        <Link
          to={`/sites/${siteId}/impact`}
          className="inline-flex items-center gap-1.5 text-[12px] text-[#9aa0a6] hover:text-[#e8eaed] transition-colors mb-2"
        >
          <ArrowLeft className="size-3.5" /> Back to global impact
        </Link>
        <h1 className="text-xl font-semibold text-[#e8eaed] tracking-tight">Impact · Keywords</h1>
        <p className="text-[13px] text-[#9aa0a6] mt-1 max-w-2xl">
          Monitor a chosen set of target queries over time - site-wide or scoped to a page.
          Position is an impression-weighted <span className="text-[#c8cad0]">average position</span>, not a literal rank.
        </p>
      </div>

      <div className="px-8 py-6 space-y-4">
        {/* ── Controls ─────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-wider text-[#9aa0a6]/70">Range</span>
            <div className="flex items-center rounded-lg bg-white/5 p-0.5">
              {RANGES.map((r) => (
                <button key={r.days} onClick={() => setRangeDays(r.days)}
                  className={cn('px-2.5 py-1 rounded-md text-[12px] transition-colors',
                    rangeDays === r.days ? 'bg-[#4e8af4]/20 text-[#4e8af4] font-medium' : 'text-[#9aa0a6] hover:text-[#e8eaed]')}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-1 min-w-[260px] max-w-md">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
              placeholder="Add a keyword to watch site-wide…"
              className="h-8 bg-white/5 border-white/10 text-[13px]"
            />
            <button
              onClick={submit}
              disabled={addKw.isPending || !draft.trim()}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] bg-[#4e8af4]/15 text-[#4e8af4] hover:bg-[#4e8af4]/25 disabled:opacity-50 transition-colors flex-shrink-0"
            >
              {addKw.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Watch
            </button>
          </div>
        </div>

        {/* ── Table ────────────────────────────────────────────────────── */}
        <div className="rounded-xl border border-white/8 bg-[#14161f] overflow-hidden">
          <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] items-center gap-4 px-4 py-2 border-b border-white/8 text-[10px] uppercase tracking-wider text-[#9aa0a6]/70">
            <span>Keyword</span>
            <span className="text-right">Avg pos</span>
            <span className="text-right">Clicks</span>
            <span className="text-right">Impr</span>
            <span className="text-right pr-1">Trend</span>
            <span className="w-4" />
          </div>

          {isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-6 w-full bg-white/5" />)}
            </div>
          ) : keywords.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <TrendingUp className="size-7 text-[#4e8af4]/40 mx-auto mb-3" />
              <p className="text-[13px] text-[#e8eaed] font-medium">No watched keywords yet</p>
              <p className="text-[12px] text-[#9aa0a6] mt-1">
                Add a query above, or hit “Watch” on a query in a page’s Top-queries panel.
              </p>
            </div>
          ) : (
            keywords.map((k) => (
              <KeywordRow key={k.id} k={k} onRemove={() => removeKw.mutate(k.id)} />
            ))
          )}
        </div>

        {/* ── Cannibalization (site-wide) ──────────────────────────────── */}
        <CannibalizationPanel siteId={siteId} from={params.from} to={params.to} />
      </div>
    </div>
  )
}

function KeywordRow({ k, onRemove }: { k: WatchedKeywordMonitor; onRemove: () => void }) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] items-center gap-4 px-4 py-2.5 border-b border-white/5 last:border-0 hover:bg-white/[0.03] transition-colors group">
      <span className="flex items-center gap-2 min-w-0">
        <span className="truncate text-[13px] text-[#e8eaed]" title={k.query}>{k.query}</span>
        {k.pageUrl ? (
          <a href={k.pageUrl} target="_blank" rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-white/5 text-[#9aa0a6] hover:text-[#4e8af4] flex-shrink-0 max-w-[200px]"
            title={k.pageUrl}>
            <FileText className="size-2.5 flex-shrink-0" />
            <span className="truncate">page</span>
            <ExternalLink className="size-2.5 flex-shrink-0 opacity-50" />
          </a>
        ) : (
          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-white/5 text-[#9aa0a6] flex-shrink-0" title="Monitored site-wide">
            <Globe className="size-2.5" /> site
          </span>
        )}
      </span>
      {!k.hasData ? (
        <span className="col-span-4 text-right text-[11px] text-[#9aa0a6]/50">no Search Console data in range</span>
      ) : (
        <>
          <span className="justify-self-end text-right">
            <KwDelta before={k.previous.position || null} after={k.current.position || null} lowerIsBetter decimals={1} />
          </span>
          <span className="justify-self-end text-right">
            <KwDelta before={k.previous.clicks} after={k.current.clicks} />
          </span>
          <span className="justify-self-end text-right text-[12px] text-[#9aa0a6] tabular-nums">
            {k.current.impressions.toLocaleString('en-US')}
          </span>
          <span className="justify-self-end">
            <Sparkline points={k.points} />
          </span>
        </>
      )}
      <button onClick={onRemove}
        className="justify-self-end text-[#9aa0a6]/40 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
        title="Stop watching">
        <X className="size-3.5" />
      </button>
    </div>
  )
}

/** A before→after numeric, colored by direction. */
function KwDelta({
  before, after, lowerIsBetter = false, decimals = 0,
}: {
  before: number | null
  after: number | null
  lowerIsBetter?: boolean
  decimals?: number
}) {
  const fmt = (n: number) => n.toFixed(decimals)
  if (after == null) return <span className="text-[#9aa0a6]/30">-</span>
  if (before == null || before === 0) return <span className="text-[#e8eaed] tabular-nums">{fmt(after)}</span>
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

/** Tiny position sparkline (inverted - lower position draws higher = better). */
function Sparkline({ points }: { points: KeywordPoint[] }) {
  const W = 72
  const H = 20
  const valid = points.filter((p) => p.position > 0)
  if (valid.length < 2) return <span className="text-[11px] text-[#9aa0a6]/30 w-[72px] inline-block text-right">-</span>
  const positions = valid.map((p) => p.position)
  const min = Math.min(...positions)
  const max = Math.max(...positions)
  const span = max - min || 1
  const step = W / (valid.length - 1)
  // Invert: best (lowest) position at the top.
  const path = valid
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(((p.position - min) / span) * (H - 4) + 2).toFixed(1)}`)
    .join(' ')
  const lastBetter = valid[valid.length - 1].position <= valid[0].position
  return (
    <svg width={W} height={H} className="inline-block align-middle">
      <path d={path} fill="none" stroke={lastBetter ? '#34d399' : '#f87171'} strokeWidth={1.5}
        strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}
