import { useState, useRef } from 'react'
import { Link, useParams, Navigate, useNavigate } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'
import {
  ChevronRight, ExternalLink, RefreshCw, Search,
  Pencil, ChevronLeft, ChevronRight as ChevronRightIcon,
  FileText, ArrowRight, Upload, CheckCircle2, XCircle,
  EyeOff, Link2, Tag, Image as ImageIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table, TableBody, TableCell,
  TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { StatusBadge } from '@/components/StatusBadge'
import { WpPluginStatus } from '@/components/WpPluginStatus'
import { useSite } from '@/hooks/useSites'
import { usePages } from '@/hooks/usePages'
import { useSyncStatus, useTriggerSync } from '@/hooks/useSync'
import type { PageSyncStatus } from '@/api/pages'

const PAGE_LIMIT = 50

function trunc(s: string | null | undefined, max: number) {
  if (!s) return null
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

/* ──────────────────────────────── Sync Status Cell ─────────────────────────── */

function SyncStatusCell({ status, appliedAt, error }: {
  status: PageSyncStatus
  appliedAt: string | null
  error: string | null
}) {
  if (status === 'idle') return <span className="text-[#9aa0a6]/30 text-[13px]">-</span>
  if (status === 'syncing') return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-[#4e8af4]">
      <RefreshCw className="size-3 animate-spin" />Syncing…
    </span>
  )
  if (status === 'pending') return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-amber-400">
      <span className="size-1.5 rounded-full bg-amber-400 animate-pulse" />
      {error ? 'Retrying' : 'Pending'}
    </span>
  )
  if (status === 'synced') return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-emerald-400">
      <CheckCircle2 className="size-3.5" />
      <span>
        Synced
        {appliedAt && (
          <span className="text-[11px] text-[#9aa0a6] ml-1">
            {formatDistanceToNow(new Date(appliedAt), { addSuffix: true })}
          </span>
        )}
      </span>
    </span>
  )
  if (status === 'failed') return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-red-400 cursor-help" title={error ?? 'Unknown error'}>
      <XCircle className="size-3.5 flex-shrink-0" />Failed
    </span>
  )
  return null
}

/* ──────────────────────────────── Skeleton Rows ────────────────────────────── */

function SkeletonRows() {
  return (
    <>
      {[0, 1, 2, 3, 4].map((i) => (
        <TableRow key={i} className="border-white/8 hover:bg-transparent">
          {[220, 180, 180, 80, 120, 60, 80, 60].map((w, j) => (
            <TableCell key={j}>
              <Skeleton className="h-4 bg-white/5 rounded" style={{ width: w }} />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  )
}

/* ──────────────────────────────── Modified Badge ────────────────────────────── */

function ModifiedBadge() {
  return (
    <Badge className="ml-1.5 h-4 px-1 text-[9px] font-semibold uppercase tracking-wider bg-[#4e8af4]/15 text-[#4e8af4] border border-[#4e8af4]/25 hover:bg-[#4e8af4]/15">
      edited
    </Badge>
  )
}

/* ──────────────────────────────── Main Page ────────────────────────────────── */

const SORT_OPTIONS = [
  { value: 'url_asc', label: 'URL (A–Z)' },
  { value: 'transactional_first', label: 'Transactional first' },
  { value: 'custom_first', label: 'Modified first' },
  { value: 'modified_desc', label: 'Recently modified' },
]

export default function SiteMetaPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [currentPage, setCurrentPage] = useState(1)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [sort, setSort] = useState<string>(
    () => localStorage.getItem('meta-sort') ?? 'url_asc',
  )
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { data: site, isLoading: siteLoading } = useSite(id!)
  const isParsing = site?.status === 'parsing'

  const { data: syncStatus } = useSyncStatus(id!)
  const triggerSync = useTriggerSync(id!)
  const pendingCount = (syncStatus?.pending ?? 0) + (syncStatus?.failed ?? 0)
  const isSyncing = (syncStatus?.syncing ?? 0) > 0

  const { data: pagesData, isLoading: pagesLoading } = usePages(
    id!, currentPage, PAGE_LIMIT, debouncedSearch, isParsing || isSyncing, sort,
  )

  if (!id) return <Navigate to="/sites" replace />

  const pages = pagesData?.data ?? []
  const meta = pagesData?.meta

  function handleSearch(v: string) {
    setSearch(v)
    setCurrentPage(1)
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => setDebouncedSearch(v), 350)
  }

  function handleSortChange(value: string) {
    setSort(value)
    localStorage.setItem('meta-sort', value)
    setCurrentPage(1)
  }

  async function handleApplyChanges() {
    try {
      await triggerSync.mutateAsync()
      toast.success('Pushing your changes to WordPress…')
    } catch {
      toast.error("Couldn't start the sync. Try again.")
    }
  }

  return (
    <div className="min-h-full">
      {/* Header */}
      <div className="border-b border-white/8 px-8 py-5">
        <div className="flex items-center gap-1.5 text-[13px] mb-3">
          <Link to="/sites" className="text-[#9aa0a6] hover:text-[#e8eaed] transition-colors flex items-center gap-1">
            <ChevronLeft className="size-3.5" />
            Sites
          </Link>
          <ChevronRight className="size-3.5 text-[#9aa0a6]/40" />
          <Link
            to={`/sites/${id}`}
            className="text-[#9aa0a6] hover:text-[#e8eaed] transition-colors"
          >
            {siteLoading
              ? <Skeleton className="h-4 w-24 bg-white/5 inline-block" />
              : site?.name}
          </Link>
          <ChevronRight className="size-3.5 text-[#9aa0a6]/40" />
          <span className="text-[#e8eaed]">Meta</span>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            {siteLoading ? (
              <Skeleton className="h-7 w-48 bg-white/5" />
            ) : (
              <>
                {site?.favicon && (
                  <img
                    src={site.favicon}
                    className="size-5 rounded-sm object-contain flex-shrink-0"
                    alt=""
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                  />
                )}
                <h1 className="text-xl font-semibold text-[#e8eaed] tracking-tight">
                  {site?.name}
                </h1>
                <span className="text-[#9aa0a6]/50 text-xl font-light">/</span>
                <span className="text-[#9aa0a6] text-[15px]">Meta Management</span>
                <StatusBadge status={site?.status ?? 'idle'} />
                <WpPluginStatus siteId={id!} />
              </>
            )}
          </div>

          <div className="flex items-center gap-3 flex-shrink-0">
            {(pendingCount > 0 || isSyncing) && (
              <Button
                size="sm"
                onClick={handleApplyChanges}
                disabled={isSyncing || triggerSync.isPending}
                className="h-8 px-3 text-[13px] bg-[#4e8af4] hover:bg-[#4e8af4]/90 text-white gap-1.5 disabled:opacity-70 shadow-[0_0_12px_rgba(78,138,244,0.35)]"
              >
                {isSyncing ? (
                  <><RefreshCw className="size-3.5 animate-spin" />Syncing…</>
                ) : (
                  <>
                    <Upload className="size-3.5" />
                    Apply Changes
                    <span className="bg-white/20 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-full tabular-nums">
                      {pendingCount}
                    </span>
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="px-8 py-6 space-y-6">
        {/* Search + Sort */}
        <div className="flex items-center gap-3">
          <div className="relative max-w-md flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[#9aa0a6]" />
            <Input
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Filter by URL…"
              className="pl-9 bg-[#1a1d27] border-white/8 text-[#e8eaed] placeholder:text-[#9aa0a6]/60 focus-visible:ring-[#4e8af4]/50 focus-visible:border-[#4e8af4]/50 h-9"
            />
          </div>
          <select
            value={sort}
            onChange={(e) => handleSortChange(e.target.value)}
            className="h-9 px-3 pr-8 rounded-lg bg-[#1a1d27] border border-white/8 text-[13px] text-[#e8eaed] focus:outline-none focus:ring-1 focus:ring-[#4e8af4]/50 focus:border-[#4e8af4]/50 appearance-none cursor-pointer"
            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239aa0a6' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center' }}
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value} className="bg-[#1a1d27]">
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Table */}
        <div className="rounded-xl border border-white/8 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-white/8 hover:bg-transparent bg-[#1a1d27]">
                <TableHead className="text-[11px] font-medium uppercase tracking-widest text-[#9aa0a6] h-10">URL</TableHead>
                <TableHead className="text-[11px] font-medium uppercase tracking-widest text-[#9aa0a6] h-10">Meta Title</TableHead>
                <TableHead className="text-[11px] font-medium uppercase tracking-widest text-[#9aa0a6] h-10">Meta Description</TableHead>
                <TableHead className="text-[11px] font-medium uppercase tracking-widest text-[#9aa0a6] h-10">
                  <span className="flex items-center gap-1.5"><EyeOff className="size-3" />Indexing</span>
                </TableHead>
                <TableHead className="text-[11px] font-medium uppercase tracking-widest text-[#9aa0a6] h-10">
                  <span className="flex items-center gap-1.5"><Link2 className="size-3" />Canonical</span>
                </TableHead>
                <TableHead className="text-[11px] font-medium uppercase tracking-widest text-[#9aa0a6] h-10">
                  <span className="flex items-center gap-1.5"><ImageIcon className="size-3" />OG</span>
                </TableHead>
                <TableHead className="text-[11px] font-medium uppercase tracking-widest text-[#9aa0a6] h-10">
                  <span className="flex items-center gap-1.5"><Upload className="size-3" />WP Sync</span>
                </TableHead>
                <TableHead className="h-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagesLoading ? (
                <SkeletonRows />
              ) : pages.length === 0 ? (
                <TableRow className="border-white/8 hover:bg-transparent">
                  <TableCell colSpan={8}>
                    <div className="flex flex-col items-center justify-center py-14 gap-3">
                      <div className="size-12 rounded-xl bg-[#1a1d27] border border-white/8 flex items-center justify-center">
                        <FileText className="size-6 text-[#9aa0a6]" />
                      </div>
                      <p className="text-[#9aa0a6] text-sm">
                        {debouncedSearch
                          ? 'No pages match your search'
                          : 'No pages yet - run a crawl to pull them in'}
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                pages.map((page) => (
                  <TableRow
                    key={page.id}
                    onClick={() => navigate(`/sites/${id}/meta/${page.id}`)}
                    className={`border-white/8 transition-colors cursor-pointer ${page.isTransactional ? 'bg-[#4e8af4]/[0.05] hover:bg-[#4e8af4]/[0.08]' : 'hover:bg-white/[0.02]'}`}
                  >
                    {/* URL */}
                    <TableCell className="max-w-[220px]">
                      <a
                        href={page.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-1 text-[13px] text-[#9aa0a6] hover:text-[#e8eaed] transition-colors"
                      >
                        <span className="truncate max-w-[200px]" title={page.url}>
                          {trunc(page.url.replace(/^https?:\/\/[^/]+/, ''), 55) || '/'}
                        </span>
                        <ExternalLink className="size-3 flex-shrink-0 opacity-50" />
                      </a>
                      {page.isTransactional && (
                        <span className="inline-flex items-center gap-1 mt-1 text-[10px] text-[#4e8af4]/70">
                          <Tag className="size-2.5" />
                          transactional
                        </span>
                      )}
                    </TableCell>

                    {/* Meta Title */}
                    <TableCell className="max-w-[200px]">
                      {page.customMetaTitle ? (
                        <div>
                          <div className="flex items-center gap-0.5">
                            <ArrowRight className="size-2.5 text-[#4e8af4] flex-shrink-0" />
                            <span className="text-[12px] text-[#4e8af4] truncate max-w-[170px]" title={page.customMetaTitle}>
                              {trunc(page.customMetaTitle, 40)}
                            </span>
                            <ModifiedBadge />
                          </div>
                          <span className="text-[11px] text-[#9aa0a6]/50 truncate block max-w-[180px] line-through" title={page.metaTitle ?? ''}>
                            {trunc(page.metaTitle, 38) ?? '-'}
                          </span>
                        </div>
                      ) : (
                        <span className="text-[13px] text-[#e8eaed]/60" title={page.metaTitle ?? ''}>
                          {trunc(page.metaTitle, 40) ?? <span className="opacity-30">-</span>}
                        </span>
                      )}
                    </TableCell>

                    {/* Meta Description */}
                    <TableCell className="max-w-[240px]">
                      {page.customMetaDescription ? (
                        <div>
                          <div className="flex items-center gap-0.5">
                            <ArrowRight className="size-2.5 text-[#4e8af4] flex-shrink-0" />
                            <span className="text-[12px] text-[#4e8af4] truncate max-w-[210px]" title={page.customMetaDescription}>
                              {trunc(page.customMetaDescription, 50)}
                            </span>
                            <ModifiedBadge />
                          </div>
                          <span className="text-[11px] text-[#9aa0a6]/50 truncate block max-w-[220px] line-through" title={page.metaDescription ?? ''}>
                            {trunc(page.metaDescription, 48) ?? '-'}
                          </span>
                        </div>
                      ) : (
                        <span className="text-[13px] text-[#e8eaed]/60" title={page.metaDescription ?? ''}>
                          {trunc(page.metaDescription, 50) ?? <span className="opacity-30">-</span>}
                        </span>
                      )}
                    </TableCell>

                    {/* Indexing */}
                    <TableCell>
                      {page.noindex ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium bg-amber-400/10 text-amber-400 border border-amber-400/25">
                          <EyeOff className="size-3" />noindex
                        </span>
                      ) : (
                        <span className="text-[#9aa0a6]/30 text-[13px]">index</span>
                      )}
                      {page.nofollow && (
                        <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-amber-400/10 text-amber-400 border border-amber-400/25">
                          nofollow
                        </span>
                      )}
                    </TableCell>

                    {/* Canonical */}
                    <TableCell className="max-w-[180px]">
                      {page.canonical ? (
                        <a
                          href={page.canonical}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-1 text-[12px] text-emerald-400 hover:text-emerald-300 transition-colors"
                          title={page.canonical}
                        >
                          <Link2 className="size-3 flex-shrink-0" />
                          <span className="truncate max-w-[150px]">
                            {page.canonical.replace(/^https?:\/\/[^/]+/, '') || '/'}
                          </span>
                        </a>
                      ) : (
                        <span className="text-[#9aa0a6]/30 text-[13px]">-</span>
                      )}
                    </TableCell>

                    {/* OG */}
                    <TableCell>
                      {page.ogImage || page.ogTitle || page.ogDescription ? (
                        <span className="inline-flex items-center gap-1 text-[12px] text-sky-400" title="Open Graph override set">
                          <ImageIcon className="size-3" />
                          {page.ogImage ? 'image' : 'text'}
                        </span>
                      ) : (
                        <span className="text-[#9aa0a6]/30 text-[13px]">-</span>
                      )}
                    </TableCell>

                    {/* WP Sync */}
                    <TableCell>
                      <SyncStatusCell
                        status={page.syncStatus}
                        appliedAt={page.syncAppliedAt}
                        error={page.syncError}
                      />
                    </TableCell>

                    {/* Edit */}
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => { e.stopPropagation(); navigate(`/sites/${id}/meta/${page.id}`) }}
                        className="h-7 px-2.5 text-[13px] text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-white/5 gap-1.5"
                      >
                        <Pencil className="size-3" />
                        Edit
                      </Button>
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
              {' · '}{meta.total.toLocaleString()} pages
            </span>
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className="h-7 px-2 text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-white/5 disabled:opacity-30"
              >
                <ChevronLeft className="size-4" />
                Prev
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setCurrentPage((p) => Math.min(meta.totalPages, p + 1))}
                disabled={currentPage >= meta.totalPages}
                className="h-7 px-2 text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-white/5 disabled:opacity-30"
              >
                Next
                <ChevronRightIcon className="size-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
