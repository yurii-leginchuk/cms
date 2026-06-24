import { useEffect, useMemo, useState } from 'react'
import { useParams, Navigate, Link, useSearchParams } from 'react-router-dom'
import {
  TrendingUp, ExternalLink, ArrowLeft, AlertTriangle, X, Download, Pin, Wand2, Search,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { downloadCsv } from '@/lib/csv'
import { Skeleton } from '@/components/ui/skeleton'
import { GscStatus } from '@/components/GscStatus'
import { useSite } from '@/hooks/useSites'
import { usePage } from '@/hooks/usePages'
import { useGscSiteStatus } from '@/hooks/useGsc'
import { useOptimizationEffects } from '@/hooks/useOptimizationEffects'
import {
  useImpactEvents, useImpactSeries, useImpactAnnotations, useCreateAnnotation, useDeleteAnnotation,
} from '@/hooks/useImpact'
import { EffectCard, EffectQueriesSection } from '@/components/impact/EffectCard'
import { ChangesTable } from '@/components/impact/ChangesTable'
import {
  ImpactTimeline, METRIC_SEL_LABELS, TYPE_META, type ImpactMetricSel,
} from '@/components/impact/ImpactTimeline'
import { ImpactQueriesPanel } from '@/components/impact/ImpactQueriesPanel'
import type { ChangeEvent, ChangeEventType } from '@/api/impact'

const ALL_TYPES: ChangeEventType[] = ['meta', 'technical', 'schema', 'brief']
const METRICS: ImpactMetricSel[] = ['all', 'clicks', 'impressions', 'ctr', 'position']
const RANGES: { label: string; days: number }[] = [
  { label: '28d', days: 28 }, { label: '90d', days: 90 },
  { label: '6mo', days: 182 }, { label: '12mo', days: 365 },
]

function daysAgoStr(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)
}
function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)
}
/** % change in clicks between the first and last 7 complete days of a series. */
function rangeClicksDelta(points: { clicks: number; provisional: boolean }[]): number | null {
  const np = points.filter((p) => !p.provisional)
  if (np.length < 14) return null
  const head = np.slice(0, 7).reduce((s, p) => s + p.clicks, 0)
  const tail = np.slice(-7).reduce((s, p) => s + p.clicks, 0)
  if (head === 0) return null
  return Math.round(((tail - head) / head) * 100)
}

export default function ImpactPage() {
  const { id: siteId } = useParams<{ id: string }>()
  const { data: site } = useSite(siteId ?? '')
  const gsc = useGscSiteStatus(site?.url)

  const [searchParams, setSearchParams] = useSearchParams()
  const urlPageId = searchParams.get('pageId')

  const [scope, setScope] = useState<'global' | 'page'>('global')
  const [selectedPage, setSelectedPage] = useState<{ id: string; url: string } | null>(null)

  // Per-page view can be opened by URL (?pageId=…) from the Impact pages list.
  // Resolve the page's URL (the series needs it) and switch into page scope.
  const urlPage = usePage(siteId ?? '', urlPageId)
  useEffect(() => {
    if (urlPageId && urlPage.data && urlPage.data.id === urlPageId) {
      setSelectedPage({ id: urlPage.data.id, url: urlPage.data.url })
      setScope('page')
    }
  }, [urlPageId, urlPage.data])

  // Returning to the global view also clears the URL param so the effect above
  // doesn't immediately re-enter page scope.
  function goGlobal() {
    setScope('global')
    setSelectedId(null)
    setSelectedPage(null)
    if (urlPageId) {
      searchParams.delete('pageId')
      setSearchParams(searchParams, { replace: true })
    }
  }
  const [metric, setMetric] = useState<ImpactMetricSel>('all')
  const [brand, setBrand] = useState<'all' | 'nonbranded'>('all')
  const [rangeDays, setRangeDays] = useState(90)
  const [enabled, setEnabled] = useState<ChangeEventType[]>(ALL_TYPES)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hoveredDay, setHoveredDay] = useState<string | null>(null)
  const [smooth, setSmooth] = useState(false)
  const [view, setView] = useState<'cards' | 'table'>('cards')
  const [compare, setCompare] = useState<'none' | 'prev' | 'yoy'>('none')

  const pageId = scope === 'page' ? selectedPage?.id : undefined
  const from = daysAgoStr(rangeDays)
  const to = daysAgoStr(0)

  const series = useImpactSeries(siteId ?? '', {
    scope, pageUrl: selectedPage?.url, from, to, brand,
  })
  // Always available site-wide series - also the seasonal baseline for per-page.
  const siteSeries = useImpactSeries(siteId ?? '', { scope: 'global', from, to, brand })
  const { data: events = [] } = useImpactEvents(siteId ?? '', pageId)
  const { data: effects = [] } = useOptimizationEffects(siteId ?? '', pageId)
  const { data: annotations = [] } = useImpactAnnotations(siteId ?? '')
  const createAnnotation = useCreateAnnotation(siteId ?? '')
  const deleteAnnotation = useDeleteAnnotation(siteId ?? '')

  // Comparison overlay (previous period / YoY), single-metric mode only.
  const shift = compare === 'yoy' ? 365 : rangeDays
  const compareSeries = useImpactSeries(
    siteId ?? '',
    { scope, pageUrl: selectedPage?.url, from: daysAgoStr(rangeDays + shift), to: daysAgoStr(shift), brand },
    compare !== 'none' && metric !== 'all',
  )

  const visibleEvents = useMemo(
    () => events.filter((e) => e.day >= from && e.day <= to && enabled.includes(e.type)),
    [events, from, to, enabled],
  )
  // Site-wide pins (pageId null) show on every timeline; page pins only on their
  // own page. So the global view stays uncluttered and the page view gets both.
  const visibleAnnotations = useMemo(
    () => annotations.filter((a) =>
      a.pageId == null || (scope === 'page' && a.pageId === selectedPage?.id)),
    [annotations, scope, selectedPage],
  )
  const selectedEvent = useMemo(
    () => events.find((e) => e.id === selectedId) ?? null,
    [events, selectedId],
  )

  // Keyboard nav: ←/→ step between markers (chronological), Esc closes detail.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.key === 'Escape') { setSelectedId(null); return }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      const nav = [...visibleEvents].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
      if (nav.length === 0) return
      e.preventDefault()
      const idx = nav.findIndex((x) => x.id === selectedId)
      const next = idx === -1
        ? (e.key === 'ArrowRight' ? 0 : nav.length - 1)
        : e.key === 'ArrowRight' ? Math.min(nav.length - 1, idx + 1) : Math.max(0, idx - 1)
      setSelectedId(nav[next].id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visibleEvents, selectedId])

  const confoundersFor = (pid: string | null, appliedAt: string): number => {
    if (!pid) return 0
    const day = appliedAt.slice(0, 10)
    return Math.max(0, events.filter(
      (e) => e.pageId === pid && Math.abs(dayDiff(e.day, day)) <= 28,
    ).length - 1)
  }

  if (!siteId) return <Navigate to="/sites" replace />

  const notConnected = gsc.data && !gsc.data.connected
  const fresh = series.data?.freshness

  return (
    <div className="min-h-full">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="border-b border-white/8 px-8 py-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-[#e8eaed] tracking-tight">Optimization Impact</h1>
            <p className="text-[13px] text-[#9aa0a6] mt-1 max-w-2xl">
              See how your changes - meta, schema, briefs, technical - line up with Search Console
              performance over time. Markers show <span className="text-[#c8cad0]">when you changed something, not that the change caused the move</span>.
            </p>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <Link to={`/sites/${siteId}/impact/keywords`}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] bg-white/5 text-[#9aa0a6] hover:text-[#e8eaed] transition-colors">
              <Search className="size-3.5" /> Keywords
            </Link>
            <ScopeToggle siteId={siteId ?? ''} scope={scope}
              perPageActive={!!selectedPage} pageUrl={selectedPage?.url}
              onBackToGlobal={goGlobal} />
          </div>
        </div>
      </div>

      {notConnected ? (
        <div className="px-8 py-12 max-w-xl">
          <div className="rounded-xl border border-white/10 bg-[#1a1d27] p-6 text-center">
            <p className="text-[#e8eaed] text-sm font-medium mb-1">Connect Search Console to see impact</p>
            <p className="text-[#9aa0a6] text-[13px] mb-4">
              The timeline plots your changes against real search performance, so it needs Search Console data first.
            </p>
            <div className="flex justify-center"><GscStatus siteUrl={site?.url} /></div>
          </div>
        </div>
      ) : (
        <div className="px-8 py-6 space-y-5">
          {/* ── Controls ──────────────────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <Segmented label="Metric" options={METRICS.map((m) => ({ v: m, label: METRIC_SEL_LABELS[m] }))}
              value={metric} onChange={(v) => setMetric(v as ImpactMetricSel)} />
            <Segmented label="Range" options={RANGES.map((r) => ({ v: String(r.days), label: r.label }))}
              value={String(rangeDays)} onChange={(v) => setRangeDays(Number(v))} />
            {fresh?.hasBrandSplit && (
              <Segmented label="Traffic"
                options={[{ v: 'all', label: 'All' }, { v: 'nonbranded', label: 'Non-branded' }]}
                value={brand} onChange={(v) => setBrand(v as 'all' | 'nonbranded')} />
            )}
            <button
              onClick={() => setSmooth((s) => !s)}
              className={cn('px-2.5 py-1 rounded-md text-[12px] transition-colors',
                smooth ? 'bg-[#4e8af4]/20 text-[#4e8af4] font-medium' : 'bg-white/5 text-[#9aa0a6] hover:text-[#e8eaed]')}
              title="7-day weighted moving average (raw is the default)">
              Smooth 7d
            </button>
            {metric !== 'all' && (
              <Segmented label="Compare"
                options={[{ v: 'none', label: 'Off' }, { v: 'prev', label: 'Prev' }, { v: 'yoy', label: 'YoY' }]}
                value={compare} onChange={(v) => setCompare(v as 'none' | 'prev' | 'yoy')} />
            )}
            <button
              onClick={() => {
                if (series.data) {
                  downloadCsv(
                    `impact-series-${scope}-${from}_${to}.csv`,
                    ['date', 'clicks', 'impressions', 'position', 'provisional'],
                    series.data.points.map((p) => [p.date, p.clicks, p.impressions, p.position, String(p.provisional)]),
                  )
                }
              }}
              className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-white/5 text-[#9aa0a6] hover:text-[#e8eaed] transition-colors"
              title="Export the daily series as CSV (recompute CTR/position yourself to verify)">
              <Download className="size-3" /> Series
            </button>
            <button
              onClick={() => downloadCsv(
                `impact-events-${scope}.csv`,
                ['day', 'type', 'subtype', 'pageUrl', 'status', 'confoundedWith', 'before', 'after'],
                visibleEvents.map((e) => [e.day, e.type, e.subtype, e.pageUrl, e.effectStatus ?? '', e.confoundedWith, e.before ?? '', e.after ?? '']),
              )}
              className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-white/5 text-[#9aa0a6] hover:text-[#e8eaed] transition-colors"
              title="Export the change events as CSV">
              <Download className="size-3" /> Events
            </button>
            <div className="flex items-center gap-1.5">
              {ALL_TYPES.map((t) => {
                const on = enabled.includes(t)
                return (
                  <button key={t}
                    onClick={() => setEnabled((cur) => on ? cur.filter((x) => x !== t) : [...cur, t])}
                    className={cn('flex items-center gap-1.5 px-2 py-1 rounded text-[11px] transition-colors',
                      on ? 'bg-white/8 text-[#e8eaed]' : 'bg-transparent text-[#9aa0a6]/50 hover:text-[#9aa0a6]')}>
                    <span className="size-2 rounded-full" style={{ background: on ? TYPE_META[t].color : '#555' }} />
                    {TYPE_META[t].label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* ── Timeline ──────────────────────────────────────────────── */}
          <div className="rounded-xl border border-white/8 bg-[#14161f] p-4">
            {series.isLoading ? (
              <Skeleton className="w-full h-[230px] bg-white/5" />
            ) : !series.data || series.data.points.length === 0 ? (
              <div className="h-[200px] flex items-center justify-center text-[13px] text-[#9aa0a6]">
                No Search Console data for this date range yet. Try a longer range.
              </div>
            ) : (
              <ImpactTimeline
                points={series.data.points}
                events={visibleEvents}
                metric={metric}
                enabledTypes={enabled}
                selectedId={selectedId}
                onSelectEvent={(ev) => setSelectedId(ev.id)}
                onHoverDay={setHoveredDay}
                hoveredDay={hoveredDay}
                smooth={smooth}
                annotations={visibleAnnotations}
                comparePoints={compare !== 'none' ? compareSeries.data?.points : undefined}
              />
            )}
            {fresh && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[11px] text-[#9aa0a6]/70">
                <span>Data through {fresh.through}</span>
                <span>· last {fresh.lagDays} days still settling</span>
                {!fresh.hasBrandSplit && <span>· add brand terms to the Brand Card to separate branded traffic</span>}
                {fresh.stale && <span className="text-amber-400/80">· showing saved data - couldn't refresh just now</span>}
              </div>
            )}
            {scope === 'page' && series.data && siteSeries.data && (() => {
              const pd = rangeClicksDelta(series.data.points)
              const sd = rangeClicksDelta(siteSeries.data.points)
              if (pd == null || sd == null) return null
              const net = pd - sd
              return (
                <div className="mt-1.5 text-[11px] text-[#9aa0a6]">
                  This page vs the site -{' '}
                  <span className="text-[#c8cad0]">{pd >= 0 ? '+' : ''}{pd}%</span> vs site-wide{' '}
                  <span className="text-[#c8cad0]">{sd >= 0 ? '+' : ''}{sd}%</span> over this range ·{' '}
                  <span className={net >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                    net {net >= 0 ? '+' : ''}{net}% vs the site trend
                  </span>
                </div>
              )
            })()}
            <AnnotationsBar
              annotations={visibleAnnotations}
              defaultDate={to}
              pageScope={scope === 'page' ? selectedPage?.url : undefined}
              onAdd={(date, label) => createAnnotation.mutate({
                date, label, pageId: scope === 'page' ? selectedPage?.id : undefined,
              })}
              onRemove={(id) => deleteAnnotation.mutate(id)}
            />
          </div>

          {/* ── Per-page query drill-down ─────────────────────────────── */}
          {scope === 'page' && selectedPage && (
            <ImpactQueriesPanel
              siteId={siteId}
              pageId={selectedPage.id}
              pageUrl={selectedPage.url}
              from={from}
              to={to}
              brand={brand}
            />
          )}

          {/* ── Selected marker detail ────────────────────────────────── */}
          {selectedEvent && (
            <MarkerDetail
              event={selectedEvent}
              siteId={siteId}
              confounders={selectedEvent.confoundedWith}
              onClose={() => setSelectedId(null)}
              onOpenPage={selectedEvent.pageId
                ? () => { setSelectedPage({ id: selectedEvent.pageId!, url: selectedEvent.pageUrl }); setScope('page'); setSelectedId(null) }
                : undefined}
            />
          )}

          {/* ── Changes (cards | table) ───────────────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] uppercase tracking-wider text-[#9aa0a6]">
                Changes {effects.length > 0 && `· ${effects.length} measured`}
              </div>
              <div className="flex items-center rounded-lg bg-white/5 p-0.5 text-[12px]">
                {(['cards', 'table'] as const).map((v) => (
                  <button key={v} onClick={() => setView(v)}
                    className={cn('px-2.5 py-1 rounded-md transition-colors capitalize',
                      view === v ? 'bg-[#4e8af4]/20 text-[#4e8af4] font-medium' : 'text-[#9aa0a6] hover:text-[#e8eaed]')}>
                    {v}
                  </button>
                ))}
              </div>
            </div>

            {effects.length === 0 && visibleEvents.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/10 px-6 py-12 text-center">
                <TrendingUp className="size-8 text-[#4e8af4]/40 mx-auto mb-3" />
                <p className="text-[#e8eaed] text-sm font-medium">Nothing tracked here yet</p>
                <p className="text-[#9aa0a6] text-[13px] mt-1">
                  Apply a meta title or description change from Meta Management or the AI assistant, and
                  you'll see its before-and-after impact here.
                </p>
              </div>
            ) : view === 'table' ? (
              <ChangesTable events={visibleEvents} effects={effects} onSelectEvent={(ev) => setSelectedId(ev.id)} />
            ) : (
              <div className="space-y-3 max-w-4xl">
                {effects.map((e) => (
                  <div key={e.id} id={`effect-${e.id}`}>
                    <EffectCard
                      effect={e}
                      siteId={siteId}
                      confounders={confoundersFor(e.pageId, e.appliedAt)}
                      highlighted={hoveredDay != null && Math.abs(dayDiff(e.appliedAt.slice(0, 10), hoveredDay)) <= 1}
                      onHover={(h) => setHoveredDay(h ? e.appliedAt.slice(0, 10) : null)}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sub-components ───────────────────────────────────────────────────────────

function ScopeToggle({
  siteId, scope, perPageActive, pageUrl, onBackToGlobal,
}: {
  siteId: string; scope: 'global' | 'page'
  perPageActive: boolean; pageUrl?: string; onBackToGlobal: () => void
}) {
  if (scope === 'page' && perPageActive) {
    return (
      <button onClick={onBackToGlobal}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] bg-white/8 text-[#e8eaed] hover:bg-white/12 transition-colors max-w-[320px]">
        <ArrowLeft className="size-3.5 flex-shrink-0" />
        <span className="truncate">{pageUrl}</span>
      </button>
    )
  }
  return (
    <div className="flex items-center rounded-lg bg-white/5 p-0.5 text-[12px]">
      <span className="px-3 py-1 rounded-md bg-[#4e8af4]/20 text-[#4e8af4] font-medium">
        Global
      </span>
      <Link to={`/sites/${siteId}/impact/pages`}
        className="px-3 py-1 rounded-md text-[#9aa0a6] hover:text-[#e8eaed] transition-colors">
        Per-page →
      </Link>
    </div>
  )
}

function AnnotationsBar({
  annotations, defaultDate, pageScope, onAdd, onRemove,
}: {
  annotations: { id: string; date: string; label: string; pageId: string | null }[]
  defaultDate: string
  /** When set, the page URL the new pin will be scoped to (per-page view). */
  pageScope?: string
  onAdd: (date: string, label: string) => void
  onRemove: (id: string) => void
}) {
  const [adding, setAdding] = useState(false)
  const [date, setDate] = useState(defaultDate)
  const [label, setLabel] = useState('')
  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-2 pt-2 border-t border-white/5">
      <span className="text-[10px] uppercase tracking-wider text-[#9aa0a6]/60 mr-1">Events</span>
      {annotations.map((a) => (
        <span key={a.id}
          className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-[#fbbf24]/10 text-[#fbbf24]"
          title={a.pageId ? 'Pinned to this page' : 'Site-wide event'}>
          {a.pageId && <Pin className="size-2.5 fill-current" />}
          {a.label} <span className="text-[#fbbf24]/50">{a.date}</span>
          <button onClick={() => onRemove(a.id)} className="hover:text-white"><X className="size-2.5" /></button>
        </span>
      ))}
      {adding ? (
        <span className="inline-flex items-center gap-1">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="bg-white/5 text-[#e8eaed] text-[11px] rounded px-1.5 py-0.5 border border-white/10" />
          <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)}
            placeholder={pageScope ? 'e.g. Rewrote intro' : 'e.g. Google core update'}
            onKeyDown={(e) => { if (e.key === 'Enter' && label.trim()) { onAdd(date, label.trim()); setLabel(''); setAdding(false) } }}
            className="bg-white/5 text-[#e8eaed] text-[11px] rounded px-1.5 py-0.5 border border-white/10 w-44" />
          <button onClick={() => { if (label.trim()) { onAdd(date, label.trim()); setLabel(''); setAdding(false) } }}
            className="text-[11px] px-2 py-0.5 rounded bg-[#4e8af4]/15 text-[#4e8af4]">Pin</button>
          <button onClick={() => setAdding(false)} className="text-[#9aa0a6] hover:text-white"><X className="size-3" /></button>
        </span>
      ) : (
        <button onClick={() => { setDate(defaultDate); setAdding(true) }}
          className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded text-[#9aa0a6] hover:text-[#e8eaed] transition-colors"
          title={pageScope ? `Pin an event on ${pageScope}` : 'Pin a site-wide event'}>
          <Pin className="size-3" /> {pageScope ? 'Pin event on page' : 'Pin event'}
        </button>
      )}
    </div>
  )
}

function Segmented({
  label, options, value, onChange,
}: {
  label: string; options: { v: string; label: string }[]
  value: string; onChange: (v: string) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] uppercase tracking-wider text-[#9aa0a6]/70">{label}</span>
      <div className="flex items-center rounded-lg bg-white/5 p-0.5">
        {options.map((o) => (
          <button key={o.v} onClick={() => onChange(o.v)}
            className={cn('px-2.5 py-1 rounded-md text-[12px] transition-colors',
              value === o.v ? 'bg-[#4e8af4]/20 text-[#4e8af4] font-medium' : 'text-[#9aa0a6] hover:text-[#e8eaed]')}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function MarkerDetail({
  event, siteId, confounders, onClose, onOpenPage,
}: {
  event: ChangeEvent; siteId: string; confounders: number
  onClose: () => void; onOpenPage?: () => void
}) {
  const color = TYPE_META[event.type].color
  const watchHint: Record<ChangeEvent['type'], string> = {
    meta: 'Watch CTR (a title/description win often lifts CTR without moving position).',
    brief: 'Watch avg position & clicks (content/intent changes move rankings).',
    technical: 'Watch impressions (canonical/noindex changes eligibility, not CTR).',
    schema: "Affects rich-result eligibility - you won't see this isolated in clicks or impressions.",
  }
  return (
    <div className="rounded-xl border border-[#4e8af4]/40 bg-[#1a1d27] p-4 max-w-4xl">
      <div className="flex items-start gap-3">
        <span className="size-2.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: color }} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] text-[#e8eaed] font-medium">{event.summary}</span>
            <span className="text-[11px] text-[#9aa0a6]">{event.day}</span>
            {!event.measurable && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-[#9aa0a6]">
                can't measure this one directly
              </span>
            )}
          </div>
          <a href={event.pageUrl} target="_blank" rel="noopener noreferrer"
            className="text-[12px] text-[#9aa0a6] hover:text-[#4e8af4] inline-flex items-center gap-1 mt-0.5 truncate max-w-full">
            {event.pageUrl}<ExternalLink className="size-3 opacity-50" />
          </a>
          {(event.before || event.after) && (
            <div className="mt-2 text-[12px]">
              {event.before && <div className="text-[#9aa0a6] line-through decoration-[#9aa0a6]/40 truncate">{event.before}</div>}
              {event.after && <div className="text-[#e8eaed] truncate">{event.after}</div>}
            </div>
          )}
          <div className="mt-2 text-[11px] text-[#9aa0a6]/80">{watchHint[event.type]}</div>
          {confounders > 0 && (
            <div className="flex items-start gap-1.5 text-[11px] text-amber-400/90 mt-2">
              <AlertTriangle className="size-3 mt-0.5 flex-shrink-0" />
              <span>{confounders} other change{confounders > 1 ? 's' : ''} on this page in the
                measurement window, so this result can&apos;t be pinned to one change.</span>
            </div>
          )}
          {event.effectId && (
            <div className="mt-2.5">
              <EffectQueriesSection
                siteId={siteId}
                effectId={event.effectId}
                measured={event.effectStatus === 'measured'}
              />
            </div>
          )}
          <div className="mt-3 flex items-center gap-2">
            {onOpenPage && (
              <button onClick={onOpenPage}
                className="text-[11px] px-2.5 py-1 rounded bg-[#4e8af4]/15 text-[#4e8af4] hover:bg-[#4e8af4]/25 transition-colors">
                Open page view →
              </button>
            )}
            {(event.type === 'meta' || event.type === 'brief') && (
              <Link to={`/sites/${siteId}/meta`}
                className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded bg-white/5 text-[#9aa0a6] hover:text-[#e8eaed] transition-colors">
                <Wand2 className="size-3" /> Do this again in Meta Manager
              </Link>
            )}
          </div>
        </div>
        <button onClick={onClose} className="text-[#9aa0a6] hover:text-[#e8eaed] flex-shrink-0">
          <X className="size-4" />
        </button>
      </div>
    </div>
  )
}
