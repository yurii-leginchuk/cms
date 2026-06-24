import { useMemo, useState } from 'react'
import { useParams, Navigate, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Search, ExternalLink, ChevronRight, TrendingUp, Pin } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { usePages } from '@/hooks/usePages'
import { useImpactEvents, useImpactAnnotations } from '@/hooks/useImpact'
import { TYPE_META } from '@/components/impact/ImpactTimeline'
import type { ChangeEvent, ChangeEventType } from '@/api/impact'

const TYPE_ORDER: ChangeEventType[] = ['meta', 'technical', 'schema', 'brief']
const ALL_PAGES_LIMIT = 50

/** Per-page roll-up of tracked change events (the pins shown on that page's timeline). */
interface PageEvents {
  count: number
  types: Set<ChangeEventType>
  lastDay: string
}

function summarizeEvents(events: ChangeEvent[]): Map<string, PageEvents> {
  const byPage = new Map<string, PageEvents>()
  for (const e of events) {
    if (!e.pageId) continue
    const cur = byPage.get(e.pageId) ?? { count: 0, types: new Set(), lastDay: '' }
    cur.count += 1
    cur.types.add(e.type)
    if (e.day > cur.lastDay) cur.lastDay = e.day
    byPage.set(e.pageId, cur)
  }
  return byPage
}

function TypeDots({ types }: { types: Set<ChangeEventType> }) {
  return (
    <span className="inline-flex items-center gap-1">
      {TYPE_ORDER.filter((t) => types.has(t)).map((t) => (
        <span
          key={t}
          className="size-2 rounded-full"
          style={{ background: TYPE_META[t].color }}
          title={TYPE_META[t].label}
        />
      ))}
    </span>
  )
}

export default function ImpactPagesPage() {
  const { id: siteId } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [mode, setMode] = useState<'changed' | 'all'>('changed')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const { data: events = [], isLoading: eventsLoading } = useImpactEvents(siteId ?? '')
  const { data: annotations = [] } = useImpactAnnotations(siteId ?? '')
  const byPage = useMemo(() => summarizeEvents(events), [events])
  // Page-scoped pins (the "Pinned events") counted per page.
  const pinByPage = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of annotations) {
      if (a.pageId) m.set(a.pageId, (m.get(a.pageId) ?? 0) + 1)
    }
    return m
  }, [annotations])

  // "All pages" mode pulls the paginated, server-searched page list.
  const allPages = usePages(siteId ?? '', page, ALL_PAGES_LIMIT, mode === 'all' ? search : '')

  if (!siteId) return <Navigate to="/sites" replace />

  const openPage = (pageId: string) => navigate(`/sites/${siteId}/impact?pageId=${pageId}`)

  // ── "With changes" rows are derived purely from the events feed ──────────────
  const changedRows = useMemo(() => {
    const seen = new Map<string, { pageId: string; url: string; ev: PageEvents }>()
    for (const e of events) {
      if (!e.pageId) continue
      if (!seen.has(e.pageId)) {
        seen.set(e.pageId, { pageId: e.pageId, url: e.pageUrl, ev: byPage.get(e.pageId)! })
      }
    }
    let rows = [...seen.values()]
    const q = search.trim().toLowerCase()
    if (q) rows = rows.filter((r) => r.url.toLowerCase().includes(q))
    rows.sort((a, b) => (a.ev.lastDay < b.ev.lastDay ? 1 : a.ev.lastDay > b.ev.lastDay ? -1 : 0))
    return rows
  }, [events, byPage, search])

  const totalPages = allPages.data?.meta.totalPages ?? 1

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
        <h1 className="text-xl font-semibold text-[#e8eaed] tracking-tight">Impact · Pages</h1>
        <p className="text-[13px] text-[#9aa0a6] mt-1 max-w-2xl">
          Pick a page to see its Search Console performance against only its own changes.
          Pages with tracked change events (the pins on the timeline) are marked.
        </p>
      </div>

      <div className="px-8 py-6 space-y-4">
        {/* ── Controls ─────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center rounded-lg bg-white/5 p-0.5 text-[12px]">
            {(['changed', 'all'] as const).map((m) => (
              <button
                key={m}
                onClick={() => { setMode(m); setPage(1) }}
                className={cn(
                  'px-3 py-1 rounded-md transition-colors',
                  mode === m ? 'bg-[#4e8af4]/20 text-[#4e8af4] font-medium' : 'text-[#9aa0a6] hover:text-[#e8eaed]',
                )}
              >
                {m === 'changed' ? 'With changes' : 'All pages'}
              </button>
            ))}
          </div>
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-[#9aa0a6]" />
            <Input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
              placeholder="Filter by URL…"
              className="pl-8 h-8 bg-white/5 border-white/10 text-[13px]"
            />
          </div>
        </div>

        {/* ── List ─────────────────────────────────────────────────────── */}
        <div className="rounded-xl border border-white/8 bg-[#14161f] overflow-hidden">
          {/* Header row */}
          <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-4 px-4 py-2 border-b border-white/8 text-[10px] uppercase tracking-wider text-[#9aa0a6]/70">
            <span>Page</span>
            <span className="text-right">Pinned</span>
            <span className="text-right">Changes</span>
            <span className="text-right">Last change</span>
            <span className="w-4" />
          </div>

          {mode === 'changed' ? (
            eventsLoading ? (
              <ListSkeleton />
            ) : changedRows.length === 0 ? (
              <EmptyState
                hint={search ? 'No pages match that filter.' : 'No pages have tracked change events yet.'}
              />
            ) : (
              changedRows.map((r) => (
                <PageRow
                  key={r.pageId}
                  url={r.url}
                  ev={r.ev}
                  pins={pinByPage.get(r.pageId) ?? 0}
                  onOpen={() => openPage(r.pageId)}
                />
              ))
            )
          ) : allPages.isLoading ? (
            <ListSkeleton />
          ) : !allPages.data || allPages.data.data.length === 0 ? (
            <EmptyState hint="No pages found." />
          ) : (
            allPages.data.data.map((p) => (
              <PageRow
                key={p.id}
                url={p.url}
                ev={byPage.get(p.id) ?? null}
                pins={pinByPage.get(p.id) ?? 0}
                onOpen={() => openPage(p.id)}
              />
            ))
          )}
        </div>

        {/* ── Pagination (All pages only) ─────────────────────────────── */}
        {mode === 'all' && totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 text-[12px]">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-2.5 py-1 rounded-md bg-white/5 text-[#9aa0a6] hover:text-[#e8eaed] disabled:opacity-40 transition-colors"
            >
              Prev
            </button>
            <span className="text-[#9aa0a6]">Page {page} / {totalPages}</span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="px-2.5 py-1 rounded-md bg-white/5 text-[#9aa0a6] hover:text-[#e8eaed] disabled:opacity-40 transition-colors"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function PageRow({
  url, ev, pins, onOpen,
}: {
  url: string; ev: PageEvents | null; pins: number; onOpen: () => void
}) {
  return (
    <button
      onClick={onOpen}
      className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-4 w-full px-4 py-2.5 text-left border-b border-white/5 last:border-0 hover:bg-white/[0.03] transition-colors group"
    >
      <span className="flex items-center gap-2 min-w-0">
        <span className="truncate text-[13px] text-[#e8eaed]">{url}</span>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-[#9aa0a6]/50 hover:text-[#4e8af4] flex-shrink-0"
        >
          <ExternalLink className="size-3" />
        </a>
      </span>
      <span className="justify-self-end w-[56px] text-right">
        {pins > 0 ? (
          <span className="inline-flex items-center gap-1 text-[12px] text-[#fbbf24] tabular-nums" title="Pinned events on this page">
            <Pin className="size-3 fill-current" />{pins}
          </span>
        ) : (
          <span className="text-[12px] text-[#9aa0a6]/30">-</span>
        )}
      </span>
      <span className="justify-self-end">
        {ev ? (
          <span className="inline-flex items-center gap-2">
            <TypeDots types={ev.types} />
            <span className="text-[12px] text-[#c8cad0] tabular-nums">{ev.count}</span>
          </span>
        ) : (
          <span className="text-[12px] text-[#9aa0a6]/30">-</span>
        )}
      </span>
      <span className="justify-self-end text-[12px] text-[#9aa0a6] tabular-nums w-[88px] text-right">
        {ev ? ev.lastDay : '-'}
      </span>
      <ChevronRight className="size-4 text-[#9aa0a6]/40 group-hover:text-[#9aa0a6]" />
    </button>
  )
}

function ListSkeleton() {
  return (
    <div className="p-4 space-y-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-6 w-full bg-white/5" />
      ))}
    </div>
  )
}

function EmptyState({ hint }: { hint: string }) {
  return (
    <div className="px-6 py-12 text-center">
      <TrendingUp className="size-7 text-[#4e8af4]/40 mx-auto mb-3" />
      <p className="text-[13px] text-[#9aa0a6]">{hint}</p>
    </div>
  )
}
