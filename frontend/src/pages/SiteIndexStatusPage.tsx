import { useState, useRef, useMemo } from 'react'
import { Link, useParams, Navigate, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  ChevronRight, ChevronLeft, ChevronRight as ChevronRightIcon,
  ExternalLink, Search, ScanSearch, RefreshCw, Link2, AlertTriangle, Send,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { StatusBadge } from '@/components/StatusBadge'
import { useSite } from '@/hooks/useSites'
import {
  useCrawlSummary, useCrawlPages, useInspectPages,
  useCrawlLatestDigest, useResubmitSitemap,
} from '@/hooks/useCrawl'
import type { CrawlSummary } from '@/api/crawl'
import { IndexStatusChip } from '@/components/index-status/IndexStatusChip'
import { statusMeta } from '@/components/index-status/statusMeta'
import { RelativeClock } from '@/components/index-status/RelativeClock'
import { ChangeDigestPanel } from '@/components/index-status/ChangeDigest'

const PAGE_LIMIT = 50
const STALE_DAYS = 14

const SEGMENTS = [
  { value: '', label: 'All statuses' },
  { value: 'indexed', label: 'Indexed' },
  { value: 'crawled_not_indexed', label: 'Crawled – not indexed' },
  { value: 'discovered_not_indexed', label: 'Discovered – not indexed' },
  { value: 'excluded_noindex', label: 'Excluded (noindex)' },
  { value: 'canonical_alternate', label: 'Alternate (canonical)' },
  { value: 'redirect', label: 'Redirect' },
  { value: 'not_found', label: 'Not found (404)' },
  { value: 'unknown', label: 'Unknown status' },
  { value: 'never_checked', label: 'Never checked' },
]

const FRESHNESS = [
  { value: '', label: 'Any freshness' },
  { value: 'fresh', label: 'Fresh (≤2d)' },
  { value: 'stale', label: 'Stale (>14d)' },
  { value: 'never', label: 'Never checked' },
]

const SORTS = [
  { value: 'priority', label: 'Priority (money + conflicts + stalest)' },
  { value: 'stalest', label: 'Stalest first' },
  { value: 'recently_changed', label: 'Recently changed' },
  { value: 'url_asc', label: 'URL (A–Z)' },
]

const selectCls =
  'h-9 px-3 pr-8 rounded-lg bg-[#1a1d27] border border-white/8 text-[13px] text-[#e8eaed] focus:outline-none focus:ring-1 focus:ring-[#4e8af4]/50 appearance-none cursor-pointer'
const selectBg = {
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239aa0a6' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 10px center',
}

export default function SiteIndexStatusPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [currentPage, setCurrentPage] = useState(1)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [segment, setSegment] = useState('')
  const [freshness, setFreshness] = useState('')
  const [conflictOnly, setConflictOnly] = useState(false)
  const [sort, setSort] = useState('priority')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { data: site, isLoading: siteLoading } = useSite(id!)
  // Live-poll while the site is still parsing OR a backfill scan is in flight
  // (an unfinished lastRun) so a freshly-added site fills in without a refresh.
  const [summaryLive, setSummaryLive] = useState(false)
  const { data: summary } = useCrawlSummary(id, summaryLive)
  const live = site?.status === 'parsing' || !!(summary?.lastRun && !summary.lastRun.finishedAt)
  if (live !== summaryLive) setSummaryLive(live)
  const { data: pageList, isLoading: pagesLoading, isFetching } = useCrawlPages(id, {
    page: currentPage, limit: PAGE_LIMIT, search: debouncedSearch || undefined,
    segment: segment || undefined, freshness: freshness || undefined,
    canonicalConflict: conflictOnly, sort,
  }, live)
  const inspect = useInspectPages(id!)
  const { data: digest } = useCrawlLatestDigest(id, live)
  const resubmit = useResubmitSitemap(id!)

  if (!id) return <Navigate to="/sites" replace />

  async function handleResubmitSitemap() {
    try {
      const res = await resubmit.mutateAsync()
      toast.success(
        `Sitemap resubmitted to Google (${res.sitemapUrl.replace(/^https?:\/\/[^/]+/, '')}). ` +
        'This nudges discovery — re-inspect the affected pages in a day or two to see if anything changed.',
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't resubmit the sitemap.")
    }
  }

  const rows = pageList?.data ?? []
  const meta = pageList?.meta

  function onSearch(v: string) {
    setSearch(v); setCurrentPage(1)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => setDebouncedSearch(v), 350)
  }

  function toggle(pageId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(pageId)) next.delete(pageId); else next.add(pageId)
      return next
    })
  }

  function filterToSegment(seg: string) {
    setSegment(seg); setConflictOnly(false); setCurrentPage(1)
  }

  const remaining = summary?.quota?.remainingDaily ?? null
  const canInspect = selected.size > 0 && (remaining == null || remaining > 0)

  async function reinspect() {
    const ids = [...selected]
    if (ids.length === 0) return
    try {
      const res = await inspect.mutateAsync(ids)
      const ok = res.results.filter((r) => r.ok).length
      const changed = res.results.filter((r) => r.changed).length
      setSelected(new Set())
      if (res.granted < ids.length) {
        toast.warning(`Inspected ${ok}/${ids.length} — daily quota limited this batch (${res.granted} allowed).`)
      } else {
        toast.success(`Re-inspected ${ok} page${ok === 1 ? '' : 's'}${changed ? `, ${changed} changed` : ''}.`)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't re-inspect. Try again.")
    }
  }

  const gscOffline = summary && !summary.connected

  return (
    <div className="min-h-full">
      {/* Header */}
      <div className="border-b border-white/8 px-8 py-5">
        <div className="flex items-center gap-1.5 text-[13px] mb-3">
          <Link to="/sites" className="text-[#9aa0a6] hover:text-[#e8eaed] flex items-center gap-1">
            <ChevronLeft className="size-3.5" />Sites
          </Link>
          <ChevronRight className="size-3.5 text-[#9aa0a6]/40" />
          <Link to={`/sites/${id}`} className="text-[#9aa0a6] hover:text-[#e8eaed]">
            {siteLoading ? <Skeleton className="h-4 w-24 bg-white/5 inline-block" /> : site?.name}
          </Link>
          <ChevronRight className="size-3.5 text-[#9aa0a6]/40" />
          <span className="text-[#e8eaed]">Index Status</span>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <ScanSearch className="size-5 text-[#4e8af4]" />
            <h1 className="text-xl font-semibold text-[#e8eaed] tracking-tight">{site?.name}</h1>
            <span className="text-[#9aa0a6]/50 text-xl font-light">/</span>
            <span className="text-[#9aa0a6] text-[15px]">Index Status</span>
            {site && <StatusBadge status={site.status ?? 'idle'} />}
          </div>
          {summary?.property && (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={handleResubmitSitemap}
                disabled={resubmit.isPending}
                title="Resubmit the sitemap to Google — a discovery nudge (does NOT force indexing). Best for 'Discovered' / 'Unknown to Google' pages."
                className="h-8 px-2.5 text-[12px] text-[#9aa0a6] hover:text-[#e8eaed] border border-white/8 gap-1.5"
              >
                {resubmit.isPending ? <RefreshCw className="size-3 animate-spin" /> : <Send className="size-3" />}
                Resubmit sitemap
              </Button>
              <a
                href={`https://search.google.com/search-console?resource_id=${encodeURIComponent(summary.property)}`}
                target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[12px] text-[#9aa0a6] hover:text-[#e8eaed]"
              >
                Open in GSC <ExternalLink className="size-3" />
              </a>
            </div>
          )}
        </div>
      </div>

      <div className="px-8 py-6 space-y-6">
        {gscOffline ? (
          <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.04] px-5 py-4 flex items-start gap-3">
            <AlertTriangle className="size-4 text-amber-400 mt-0.5 flex-shrink-0" />
            <div className="text-[13px] text-[#e8eaed]">
              <p className="font-medium">Search Console isn't connected for this site.</p>
              <p className="text-[#9aa0a6] mt-1">
                Index status comes from the GSC URL Inspection API. Add the service account to this
                property in Search Console to start inspecting.
                {summary?.connectionReason && (
                  <span className="text-[#9aa0a6]/70"> ({summary.connectionReason})</span>
                )}
              </p>
            </div>
          </div>
        ) : (
          <>
            <FreshnessQuotaStrip summary={summary} />
            <DistributionBar summary={summary} onPick={filterToSegment} active={segment} />
            {digest && <ChangeDigestPanel digest={digest} />}
          </>
        )}

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative max-w-xs flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[#9aa0a6]" />
            <Input
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Filter by URL…"
              className="pl-9 bg-[#1a1d27] border-white/8 text-[#e8eaed] placeholder:text-[#9aa0a6]/60 h-9"
            />
          </div>
          <select value={segment} onChange={(e) => filterToSegment(e.target.value)} className={selectCls} style={selectBg}>
            {SEGMENTS.map((s) => <option key={s.value} value={s.value} className="bg-[#1a1d27]">{s.label}</option>)}
          </select>
          <select value={freshness} onChange={(e) => { setFreshness(e.target.value); setCurrentPage(1) }} className={selectCls} style={selectBg}>
            {FRESHNESS.map((s) => <option key={s.value} value={s.value} className="bg-[#1a1d27]">{s.label}</option>)}
          </select>
          <label className="inline-flex items-center gap-2 text-[13px] text-[#9aa0a6] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={conflictOnly}
              onChange={(e) => { setConflictOnly(e.target.checked); setCurrentPage(1) }}
              className="accent-[#4e8af4]"
            />
            <Link2 className="size-3.5" />Canonical conflicts
          </label>
          <div className="flex-1" />
          <select value={sort} onChange={(e) => { setSort(e.target.value); setCurrentPage(1) }} className={selectCls} style={selectBg}>
            {SORTS.map((s) => <option key={s.value} value={s.value} className="bg-[#1a1d27]">{s.label}</option>)}
          </select>
        </div>

        {/* Selection action bar */}
        {selected.size > 0 && (
          <div className="flex items-center justify-between rounded-lg border border-[#4e8af4]/20 bg-[#4e8af4]/[0.05] px-4 py-2.5">
            <span className="text-[13px] text-[#e8eaed]">
              {selected.size} selected
              {remaining != null && (
                <span className="text-[#9aa0a6]"> · spends {Math.min(selected.size, remaining)} of {remaining} left today</span>
              )}
            </span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} className="h-8 text-[#9aa0a6] hover:text-[#e8eaed]">
                Clear
              </Button>
              <Button
                size="sm"
                onClick={reinspect}
                disabled={!canInspect || inspect.isPending}
                className="h-8 px-3 text-[13px] bg-[#4e8af4] hover:bg-[#4e8af4]/90 text-white gap-1.5 disabled:opacity-60"
              >
                {inspect.isPending ? <RefreshCw className="size-3.5 animate-spin" /> : <ScanSearch className="size-3.5" />}
                Re-inspect selected
              </Button>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="rounded-xl border border-white/8 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-white/8 hover:bg-transparent bg-[#1a1d27]">
                <TableHead className="w-10 h-10" />
                <TableHead className="text-[11px] font-medium uppercase tracking-widest text-[#9aa0a6] h-10">URL</TableHead>
                <TableHead className="text-[11px] font-medium uppercase tracking-widest text-[#9aa0a6] h-10">Status</TableHead>
                <TableHead className="text-[11px] font-medium uppercase tracking-widest text-[#9aa0a6] h-10">Google crawled</TableHead>
                <TableHead className="text-[11px] font-medium uppercase tracking-widest text-[#9aa0a6] h-10">We checked</TableHead>
                <TableHead className="text-[11px] font-medium uppercase tracking-widest text-[#9aa0a6] h-10">Canonical</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagesLoading ? (
                [0, 1, 2, 3, 4].map((i) => (
                  <TableRow key={i} className="border-white/8 hover:bg-transparent">
                    {[24, 240, 140, 90, 90, 80].map((w, j) => (
                      <TableCell key={j}><Skeleton className="h-4 bg-white/5 rounded" style={{ width: w }} /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow className="border-white/8 hover:bg-transparent">
                  <TableCell colSpan={6}>
                    <div className="flex flex-col items-center justify-center py-14 gap-3">
                      <div className="size-12 rounded-xl bg-[#1a1d27] border border-white/8 flex items-center justify-center">
                        <ScanSearch className="size-6 text-[#9aa0a6]" />
                      </div>
                      <p className="text-[#9aa0a6] text-sm">
                        {debouncedSearch || segment || freshness || conflictOnly
                          ? 'No pages match these filters'
                          : 'No pages yet — add pages, then the nightly scan will inspect them'}
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow
                    key={r.pageId}
                    onClick={() => navigate(`/sites/${id}/index-status/${r.pageId}`)}
                    className={`border-white/8 transition-colors cursor-pointer ${r.isTransactional ? 'bg-[#4e8af4]/[0.04] hover:bg-[#4e8af4]/[0.07]' : 'hover:bg-white/[0.02]'}`}
                  >
                    <TableCell onClick={(e) => e.stopPropagation()} className="w-10">
                      <input
                        type="checkbox"
                        checked={selected.has(r.pageId)}
                        onChange={() => toggle(r.pageId)}
                        className="accent-[#4e8af4]"
                      />
                    </TableCell>
                    <TableCell className="max-w-[300px]">
                      <a
                        href={r.url} target="_blank" rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-1 text-[13px] text-[#9aa0a6] hover:text-[#e8eaed]"
                      >
                        <span className="truncate max-w-[270px]" title={r.url}>
                          {r.url.replace(/^https?:\/\/[^/]+/, '') || '/'}
                        </span>
                        <ExternalLink className="size-3 flex-shrink-0 opacity-50" />
                      </a>
                      {r.lastError && (
                        <span className="mt-0.5 block text-[10px] text-red-400/80 truncate max-w-[270px]" title={r.lastError}>
                          last attempt failed
                        </span>
                      )}
                    </TableCell>
                    <TableCell><IndexStatusChip status={r.derivedStatus} /></TableCell>
                    <TableCell><RelativeClock ts={r.googleLastCrawlTime} emptyLabel={r.lastInspectedAt ? 'never' : '—'} /></TableCell>
                    <TableCell><RelativeClock ts={r.lastInspectedAt} staleDays={STALE_DAYS} /></TableCell>
                    <TableCell>
                      {r.canonicalConflict ? (
                        <span className="inline-flex items-center gap-1 text-[12px] text-amber-400" title={`Google: ${r.googleCanonical}\nDeclared: ${r.userCanonical}`}>
                          <AlertTriangle className="size-3" />Google ≠ declared
                        </span>
                      ) : r.lastInspectedAt ? (
                        <span className="inline-flex items-center gap-1 text-[12px] text-emerald-400/70"><Link2 className="size-3" />match</span>
                      ) : (
                        <span className="text-[#9aa0a6]/30 text-[13px]">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {meta && meta.totalPages > 1 && (
          <div className="flex items-center justify-between text-[13px] text-[#9aa0a6]">
            <span>
              Page <span className="text-[#e8eaed]">{meta.page}</span> of{' '}
              <span className="text-[#e8eaed]">{meta.totalPages}</span>
              {' · '}{meta.total.toLocaleString()} pages{isFetching ? ' · updating…' : ''}
            </span>
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage <= 1} className="h-7 px-2 text-[#9aa0a6] hover:text-[#e8eaed] disabled:opacity-30">
                <ChevronLeft className="size-4" />Prev
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCurrentPage((p) => Math.min(meta.totalPages, p + 1))} disabled={currentPage >= meta.totalPages} className="h-7 px-2 text-[#9aa0a6] hover:text-[#e8eaed] disabled:opacity-30">
                Next<ChevronRightIcon className="size-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Freshness & quota strip ─────────────────────────────────────────────── */

function FreshnessQuotaStrip({ summary }: { summary: CrawlSummary | undefined }) {
  if (!summary) return <Skeleton className="h-16 w-full bg-white/5 rounded-xl" />
  const { coverage, freshness, quota } = summary
  const pct = quota ? Math.min(100, Math.round((quota.used / quota.capDaily) * 100)) : 0
  return (
    <div className="rounded-xl border border-white/8 bg-[#1a1d27]/60 px-5 py-4 flex flex-wrap items-center gap-x-8 gap-y-3">
      <div className="text-[13px] text-[#e8eaed]">
        <span className="tabular-nums font-medium">{coverage.inspected}</span>
        <span className="text-[#9aa0a6]"> of {coverage.total} pages inspected</span>
        {freshness.medianAgeDays != null && (
          <span className="text-[#9aa0a6]"> · median age {freshness.medianAgeDays}d</span>
        )}
        {coverage.neverChecked > 0 && (
          <span className="text-[#9aa0a6]"> · <span className="text-[#9aa0a6]">{coverage.neverChecked} never checked</span></span>
        )}
      </div>
      {quota && (
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-[#9aa0a6]">Inspections today</span>
          <div className="w-28 h-1.5 rounded-full bg-white/8 overflow-hidden">
            <div className="h-full bg-[#4e8af4]" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-[12px] tabular-nums text-[#e8eaed]">{quota.used} / {quota.capDaily}</span>
          <span className="text-[11px] text-[#9aa0a6]">({quota.remainingDaily} left)</span>
        </div>
      )}
      {summary.lastRun && (
        <div className="text-[12px] text-[#9aa0a6]">
          Last scan: <RelativeClock ts={summary.lastRun.finishedAt ?? summary.lastRun.startedAt} />
          {' · '}{summary.lastRun.pagesInspected} inspected, {summary.lastRun.pagesChanged} changed
        </div>
      )}
    </div>
  )
}

/* ── Status distribution bar ─────────────────────────────────────────────── */

function DistributionBar({
  summary, onPick, active,
}: {
  summary: CrawlSummary | undefined
  onPick: (seg: string) => void
  active: string
}) {
  const segments = useMemo(() => {
    if (!summary) return []
    const by = summary.coverage.byStatus
    return Object.entries(by)
      .sort((a, b) => b[1] - a[1])
      .map(([status, count]) => ({ status, count, meta: statusMeta(status as never) }))
  }, [summary])

  if (!summary) return null
  const { coverage } = summary
  if (coverage.inspected === 0) {
    return (
      <div className="text-[13px] text-[#9aa0a6]">
        Nothing inspected yet. The nightly scan inspects money pages and the stalest URLs first — or
        select pages below and re-inspect now.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex h-2.5 rounded-full overflow-hidden border border-white/8">
        {segments.map((s) => (
          <button
            key={s.status}
            onClick={() => onPick(s.status)}
            title={`${s.meta.label}: ${s.count}`}
            className={`${s.meta.dot} transition-opacity hover:opacity-80 ${active && active !== s.status ? 'opacity-40' : ''}`}
            style={{ width: `${(s.count / coverage.inspected) * 100}%` }}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
        {segments.map((s) => (
          <button
            key={s.status}
            onClick={() => onPick(s.status)}
            className={`inline-flex items-center gap-1.5 hover:text-[#e8eaed] ${active === s.status ? 'text-[#e8eaed]' : 'text-[#9aa0a6]'}`}
          >
            <span className={`size-2 rounded-full ${s.meta.dot}`} />
            {s.meta.label} <span className="tabular-nums">{s.count}</span>
          </button>
        ))}
        <span className="text-[#9aa0a6]/60">
          Based on {coverage.inspected} of {coverage.total}
          {coverage.canonicalConflicts > 0 && <> · {coverage.canonicalConflicts} canonical conflicts</>}
        </span>
      </div>
    </div>
  )
}
