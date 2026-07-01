import { useState, useRef } from 'react'
import { Link, useParams, Navigate } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'
import {
  ChevronRight, ExternalLink, Search,
  ChevronLeft, ChevronRight as ChevronRightIcon,
  FileText, Tag, Upload, CheckCircle2, XCircle, RefreshCw, Hash, AlignLeft,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import {
  Table, TableBody, TableCell,
  TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { useSite } from '@/hooks/useSites'
import { usePages, usePage, useUpdatePageMeta } from '@/hooks/usePages'
import { useSyncStatus } from '@/hooks/useSync'
import type { Page, PageSyncStatus } from '@/api/pages'

const PAGE_LIMIT = 50

function trunc(s: string | null | undefined, max: number) {
  if (!s) return null
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

const SORT_OPTIONS = [
  { value: 'url_asc', label: 'URL (A–Z)' },
  { value: 'transactional_first', label: 'Transactional first' },
  { value: 'custom_first', label: 'Modified first' },
  { value: 'modified_desc', label: 'Recently modified' },
]

/* ──────────────────────────────── Sync Status Cell ─────────────────────────── */

function SyncStatusCell({ status, appliedAt, error }: {
  status: PageSyncStatus
  appliedAt: string | null
  error: string | null
}) {
  if (status === 'idle') return <span className="text-[#9aa0a6]/30 text-[13px]">-</span>

  if (status === 'syncing') return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-[#4e8af4]">
      <RefreshCw className="size-3 animate-spin" />
      Syncing…
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
          <>
            {' '}
            <span className="text-[11px] text-[#9aa0a6]">
              {formatDistanceToNow(new Date(appliedAt), { addSuffix: true })}
            </span>
          </>
        )}
      </span>
    </span>
  )

  if (status === 'failed') return (
    <span
      className="inline-flex items-center gap-1.5 text-[12px] text-red-400 cursor-help"
      title={error ?? 'Unknown error'}
    >
      <XCircle className="size-3.5 flex-shrink-0" />
      Failed
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
          {[280, 80, 100].map((w, j) => (
            <TableCell key={j}>
              <Skeleton className="h-4 bg-white/5 rounded" style={{ width: w }} />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  )
}

/* ──────────────────────────── Page Structure Sheet ─────────────────────────── */

function StructureField({ icon: Icon, label, value, mono }: {
  icon: React.ElementType
  label: string
  value: string | null | undefined
  mono?: boolean
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-widest text-[#9aa0a6]">
        <Icon className="size-3" />
        {label}
      </div>
      {value ? (
        <p className={`text-[13px] text-[#e8eaed] leading-relaxed ${mono ? 'font-mono break-all' : ''}`}>
          {value}
        </p>
      ) : (
        <p className="text-[13px] text-[#9aa0a6]/40 italic">-</p>
      )}
    </div>
  )
}

function PageStructureSheet({
  siteId,
  page,
  onClose,
}: {
  siteId: string
  page: Page | null
  onClose: () => void
}) {
  // Fetch the full page (incl. cleanContent) when a row is opened.
  const { data: full, isLoading } = usePage(siteId, page?.id ?? null)

  const title = full?.customMetaTitle ?? full?.metaTitle ?? page?.metaTitle
  const description = full?.customMetaDescription ?? full?.metaDescription ?? page?.metaDescription
  const path = page?.url.replace(/^https?:\/\/[^/]+/, '') || '/'

  return (
    <Sheet open={!!page} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-[560px] sm:max-w-[560px] bg-[#1a1d27] border-l border-white/8 flex flex-col p-0"
      >
        <SheetHeader className="px-6 py-4 border-b border-white/8 flex-shrink-0">
          <SheetTitle className="text-[#e8eaed] text-[15px] font-semibold">
            Page Structure
          </SheetTitle>
          {page && (
            <a
              href={page.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[12px] text-[#4e8af4] hover:underline mt-0.5 inline-flex items-center gap-1 truncate"
              title={page.url}
            >
              <span className="truncate">{path}</span>
              <ExternalLink className="size-3 flex-shrink-0" />
            </a>
          )}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Meta */}
          <StructureField icon={Tag} label="Meta Title" value={title} />
          <StructureField icon={AlignLeft} label="Meta Description" value={description} />
          <StructureField icon={Hash} label="H1" value={full?.h1Text} />

          {/* Content structure from Jina */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-widest text-[#9aa0a6]">
              <FileText className="size-3" />
              Content Structure
              {full?.lastScrapedAt && (
                <span className="ml-auto normal-case tracking-normal text-[#9aa0a6]/50 font-normal">
                  scraped {formatDistanceToNow(new Date(full.lastScrapedAt), { addSuffix: true })}
                </span>
              )}
            </div>

            {isLoading ? (
              <div className="space-y-2 pt-1">
                {[90, 75, 85, 60, 80].map((w, i) => (
                  <Skeleton key={i} className="h-3.5 bg-white/5 rounded" style={{ width: `${w}%` }} />
                ))}
              </div>
            ) : full?.cleanContent ? (
              <pre className="text-[12.5px] text-[#c4c7cc] leading-relaxed whitespace-pre-wrap break-words font-sans bg-[#0f1117] border border-white/8 rounded-lg p-4 max-h-none">
                {full.cleanContent}
              </pre>
            ) : (
              <div className="flex flex-col items-center justify-center py-10 gap-2 bg-[#0f1117] border border-white/8 rounded-lg">
                <FileText className="size-6 text-[#9aa0a6]/40" />
                <p className="text-[13px] text-[#9aa0a6]/60">
                  No structure captured yet. Re-parse the site to build it.
                </p>
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

/* ──────────────────────────────── Main Page ────────────────────────────────── */

export default function SitePagesPage() {
  const { id } = useParams<{ id: string }>()
  const [currentPage, setCurrentPage] = useState(1)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [sort, setSort] = useState<string>(
    () => localStorage.getItem('pages-sort') ?? 'url_asc',
  )
  const [selectedPage, setSelectedPage] = useState<Page | null>(null)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { data: site, isLoading: siteLoading } = useSite(id!)
  const isParsing = site?.status === 'parsing'

  const { data: syncStatus } = useSyncStatus(id!)
  const isSyncing = (syncStatus?.syncing ?? 0) > 0

  const { data: pagesData, isLoading: pagesLoading } = usePages(
    id!, currentPage, PAGE_LIMIT, debouncedSearch, isParsing || isSyncing, sort,
  )
  const updateMeta = useUpdatePageMeta(id!)

  if (!id) return <Navigate to="/sites" replace />

  const pages = pagesData?.data ?? []
  const meta = pagesData?.meta

  function handleSortChange(value: string) {
    setSort(value)
    localStorage.setItem('pages-sort', value)
    setCurrentPage(1)
  }

  function handleSearch(v: string) {
    setSearch(v)
    setCurrentPage(1)
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => setDebouncedSearch(v), 350)
  }

  async function handleToggleTransactional(page: Page) {
    try {
      await updateMeta.mutateAsync({
        pageId: page.id,
        payload: { isTransactional: !page.isTransactional },
      })
    } catch {
      toast.error("Couldn't update the page. Try again.")
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
          <Link to={`/sites/${id}`} className="text-[#9aa0a6] hover:text-[#e8eaed] transition-colors">
            {siteLoading ? <Skeleton className="h-4 w-24 bg-white/5 inline-block" /> : site?.name}
          </Link>
          <ChevronRight className="size-3.5 text-[#9aa0a6]/40" />
          <span className="text-[#e8eaed]">Pages</span>
        </div>

        <h1 className="text-xl font-semibold text-[#e8eaed] tracking-tight">Pages</h1>
        <p className="text-[13px] text-[#9aa0a6] mt-1">
          {meta ? `${meta.total.toLocaleString()} pages` : 'Site pages indexed from the sitemap'}
          {' · '}click a row to view its captured structure
        </p>
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
                {['URL', 'Transactional', 'WP Sync'].map((h) => (
                  <TableHead key={h} className="text-[11px] font-medium uppercase tracking-widest text-[#9aa0a6] h-10">
                    {h === 'Transactional' ? (
                      <span className="flex items-center gap-1.5"><Tag className="size-3" />{h}</span>
                    ) : h === 'WP Sync' ? (
                      <span className="flex items-center gap-1.5"><Upload className="size-3" />{h}</span>
                    ) : h}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagesLoading ? (
                <SkeletonRows />
              ) : pages.length === 0 ? (
                <TableRow className="border-white/8 hover:bg-transparent">
                  <TableCell colSpan={3}>
                    <div className="flex flex-col items-center justify-center py-14 gap-3">
                      <div className="size-12 rounded-xl bg-[#1a1d27] border border-white/8 flex items-center justify-center">
                        <FileText className="size-6 text-[#9aa0a6]" />
                      </div>
                      <p className="text-[#9aa0a6] text-sm">
                        {debouncedSearch
                          ? 'No pages match your search'
                          : 'No pages yet. Parse the sitemap to get started.'}
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                pages.map((page) => (
                  <TableRow
                    key={page.id}
                    onClick={() => setSelectedPage(page)}
                    className={`border-white/8 transition-colors cursor-pointer ${page.isTransactional ? 'bg-[#4e8af4]/[0.05] hover:bg-[#4e8af4]/[0.08]' : 'hover:bg-white/[0.02]'}`}
                  >
                    {/* URL */}
                    <TableCell className="max-w-[260px]">
                      <div className="flex items-center gap-1.5 text-[13px] text-[#e8eaed]">
                        <span className="truncate max-w-[220px]" title={page.url}>
                          {trunc(page.url.replace(/^https?:\/\/[^/]+/, ''), 60) || '/'}
                        </span>
                        <a
                          href={page.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-[#9aa0a6]/50 hover:text-[#4e8af4] transition-colors flex-shrink-0"
                          title="Open page in new tab"
                        >
                          <ExternalLink className="size-3" />
                        </a>
                      </div>
                    </TableCell>

                    {/* Transactional toggle */}
                    <TableCell>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleToggleTransactional(page) }}
                        title={page.isTransactional ? 'Mark as non-transactional' : 'Mark as transactional'}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                          page.isTransactional
                            ? 'bg-[#4e8af4]/15 text-[#4e8af4] border border-[#4e8af4]/30 hover:bg-[#4e8af4]/25'
                            : 'bg-white/5 text-[#9aa0a6]/50 border border-white/8 hover:bg-white/8 hover:text-[#9aa0a6]'
                        }`}
                      >
                        <Tag className="size-3" />
                        {page.isTransactional ? 'Yes' : 'No'}
                      </button>
                    </TableCell>

                    {/* WP Sync */}
                    <TableCell>
                      <SyncStatusCell
                        status={page.syncStatus}
                        appliedAt={page.syncAppliedAt}
                        error={page.syncError}
                      />
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

      <PageStructureSheet siteId={id} page={selectedPage} onClose={() => setSelectedPage(null)} />
    </div>
  )
}
