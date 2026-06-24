import { useState, useRef, useEffect } from 'react'
import { Link, useParams, Navigate } from 'react-router-dom'
import { formatDistanceToNow, format } from 'date-fns'
import { toast } from 'sonner'
import {
  ChevronRight, ExternalLink, RefreshCw, Search,
  Pencil, ChevronLeft, ChevronRight as ChevronRightIcon,
  FileText, Clock, ArrowRight, Upload, CheckCircle2, XCircle,
  EyeOff, Link2, Tag, Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from '@/components/ui/sheet'
import {
  Table, TableBody, TableCell,
  TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { StatusBadge } from '@/components/StatusBadge'
import { SerpPreview } from '@/components/SerpPreview'
import { WpPluginStatus } from '@/components/WpPluginStatus'
import { AiReviewDialog } from '@/components/AiReviewDialog'
import { useSite } from '@/hooks/useSites'
import { usePages, usePageHistory, useUpdatePageMeta, useGenerateMeta } from '@/hooks/usePages'
import { useSyncStatus, useTriggerSync } from '@/hooks/useSync'
import type { Page, MetaHistoryEntry, PageSyncStatus } from '@/api/pages'

const PAGE_LIMIT = 50
const TITLE_LIMIT = 60
const DESC_LIMIT = 160

function trunc(s: string | null | undefined, max: number) {
  if (!s) return null
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

function relativeTime(date: string | null) {
  if (!date) return 'Never'
  return formatDistanceToNow(new Date(date), { addSuffix: true })
}

/* ──────────────────────────────── History Timeline ─────────────────────────── */

const FIELD_STYLES: Record<string, { color: string; bg: string; label: string }> = {
  title: { color: 'text-[#4e8af4]', bg: 'bg-[#4e8af4]/15', label: 'Title' },
  description: { color: 'text-violet-400', bg: 'bg-violet-400/15', label: 'Description' },
  noindex: { color: 'text-amber-400', bg: 'bg-amber-400/15', label: 'Noindex' },
  canonical: { color: 'text-emerald-400', bg: 'bg-emerald-400/15', label: 'Canonical' },
}

function HistoryTimeline({ entries, isLoading }: { entries: MetaHistoryEntry[]; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="size-6 rounded-full bg-white/5 flex-shrink-0 mt-0.5" />
            <div className="space-y-1.5 flex-1">
              <Skeleton className="h-3 w-20 bg-white/5 rounded" />
              <Skeleton className="h-3 w-full bg-white/5 rounded" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (entries.length === 0) {
    return <p className="text-[12px] text-[#9aa0a6] italic py-2">No changes yet</p>
  }

  return (
    <div className="space-y-0">
      {entries.map((entry, i) => {
        const style = FIELD_STYLES[entry.field] ?? FIELD_STYLES.title
        return (
          <div key={entry.id} className="flex gap-3 group">
            <div className="flex flex-col items-center flex-shrink-0">
              <div className={`size-2 rounded-full mt-1.5 flex-shrink-0 ${style.color.replace('text-', 'bg-')}`} />
              {i < entries.length - 1 && <div className="w-px flex-1 bg-white/8 mt-1" />}
            </div>
            <div className="pb-4 flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${style.bg} ${style.color}`}>
                  {style.label}
                </span>
                <span className="text-[11px] text-[#9aa0a6]">{relativeTime(entry.createdAt)}</span>
                <span className="text-[10px] text-[#9aa0a6]/40 ml-auto">
                  {format(new Date(entry.createdAt), 'MMM d, HH:mm')}
                </span>
              </div>
              <div className="space-y-1">
                {entry.oldValue && (
                  <div className="flex items-start gap-1.5">
                    <span className="text-[10px] text-[#9aa0a6]/50 uppercase mt-0.5 w-5 flex-shrink-0">was</span>
                    <p className="text-[12px] text-[#9aa0a6] line-through leading-snug break-words min-w-0">
                      {trunc(entry.oldValue, 80)}
                    </p>
                  </div>
                )}
                <div className="flex items-start gap-1.5">
                  <span className="text-[10px] text-emerald-400/70 uppercase mt-0.5 w-5 flex-shrink-0">now</span>
                  <p className="text-[12px] text-[#e8eaed] leading-snug break-words min-w-0">
                    {entry.newValue ? trunc(entry.newValue, 80) : <span className="italic text-[#9aa0a6]">cleared</span>}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ──────────────────────────────── Edit Meta Sheet ──────────────────────────── */

interface EditSheetProps {
  page: Page | null
  siteId: string
  siteFavicon?: string | null
  onClose: () => void
}

function EditMetaSheet({ page, siteId, siteFavicon, onClose }: EditSheetProps) {
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [noindex, setNoindex] = useState(false)
  const [canonical, setCanonical] = useState('')
  const initialRef = useRef({ title: '', desc: '', noindex: false, canonical: '' })
  const [aiReview, setAiReview] = useState<{ metaTitle: string | null; metaDescription: string | null; tokensUsed: number } | null>(null)
  const update = useUpdatePageMeta(siteId)
  const generateMeta = useGenerateMeta(siteId)
  const { data: history = [], isLoading: historyLoading } = usePageHistory(siteId, page?.id ?? null)

  useEffect(() => {
    if (page) {
      const t = page.customMetaTitle || page.metaTitle || ''
      const d = page.customMetaDescription || page.metaDescription || ''
      const n = page.noindex
      const c = page.canonical || ''
      setTitle(t)
      setDesc(d)
      setNoindex(n)
      setCanonical(c)
      initialRef.current = { title: t, desc: d, noindex: n, canonical: c }
    }
  }, [page?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleGenerate() {
    if (!page) return
    try {
      const result = await generateMeta.mutateAsync({ pageId: page.id })
      setAiReview(result)
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      toast.error(message ?? "Couldn't generate meta. Try again in a moment.")
    }
  }

  function handleApplyAi(newTitle: string | null, newDesc: string | null) {
    if (newTitle !== null) setTitle(newTitle)
    if (newDesc !== null) setDesc(newDesc)
    toast.success("Applied to the draft - review and save when you're ready")
  }

  async function handleSave() {
    if (!page) return
    try {
      const payload: Parameters<typeof update.mutateAsync>[0]['payload'] = {}
      if ((title.trim() || null) !== (initialRef.current.title.trim() || null))
        payload.customMetaTitle = title.trim() || null
      if ((desc.trim() || null) !== (initialRef.current.desc.trim() || null))
        payload.customMetaDescription = desc.trim() || null
      if (noindex !== initialRef.current.noindex)
        payload.noindex = noindex
      if ((canonical.trim() || null) !== (initialRef.current.canonical.trim() || null))
        payload.canonical = canonical.trim() || null

      if (Object.keys(payload).length === 0) { onClose(); return }
      await update.mutateAsync({ pageId: page.id, payload })
      toast.success('Saved - queued to push to WordPress')
      onClose()
    } catch {
      toast.error('Failed to save meta')
    }
  }

  const titleOver = title.length > TITLE_LIMIT
  const descOver = desc.length > DESC_LIMIT

  return (
    <Sheet open={!!page} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-[660px] sm:max-w-[660px] bg-[#1a1d27] border-l border-white/8 flex flex-col p-0"
      >
        <SheetHeader className="px-6 py-4 border-b border-white/8 flex-shrink-0">
          <SheetTitle className="text-[#e8eaed] text-[15px] font-semibold">Edit Meta</SheetTitle>
          {page && (
            <a
              href={page.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-[12px] text-[#9aa0a6] hover:text-[#4e8af4] transition-colors mt-0.5 w-fit"
            >
              <span className="truncate max-w-[400px]">{page.url}</span>
              <ExternalLink className="size-3 flex-shrink-0" />
            </a>
          )}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          <div className="px-6 py-5 space-y-5">
            {/* AI Generate */}
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generateMeta.isPending}
              className="flex items-center gap-2 bg-[#4e8af4]/10 border border-[#4e8af4]/20 text-[#4e8af4] hover:bg-[#4e8af4]/20 h-9 px-3 text-[13px] rounded-lg transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {generateMeta.isPending ? (
                <><RefreshCw className="size-3.5 animate-spin" />Generating…</>
              ) : (
                <><Sparkles className="size-3.5" />Generate with AI</>
              )}
            </button>

            {/* Meta Title */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-[#9aa0a6] text-[11px] font-medium uppercase tracking-widest">
                  Meta Title
                </Label>
                <span className={`text-[11px] tabular-nums ${titleOver ? 'text-amber-400' : 'text-[#9aa0a6]'}`}>
                  {title.length} / {TITLE_LIMIT}
                </span>
              </div>
              <textarea
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Write a meta title - aim for 50-60 characters"
                rows={2}
                className="w-full bg-[#0f1117] border border-white/8 rounded-lg px-3 py-2.5 text-sm text-[#e8eaed] placeholder:text-[#9aa0a6]/40 resize-none focus:outline-none focus:ring-1 focus:ring-[#4e8af4]/50 focus:border-[#4e8af4]/40 transition-colors"
              />
              {page?.metaTitle && (
                <p className="text-[11px] text-[#9aa0a6]">
                  Scraped: <span className="text-[#e8eaed]/60">{trunc(page.metaTitle, 90)}</span>
                </p>
              )}
            </div>

            {/* Meta Description */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-[#9aa0a6] text-[11px] font-medium uppercase tracking-widest">
                  Meta Description
                </Label>
                <span className={`text-[11px] tabular-nums ${descOver ? 'text-amber-400' : 'text-[#9aa0a6]'}`}>
                  {desc.length} / {DESC_LIMIT}
                </span>
              </div>
              <textarea
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder="Write a meta description - aim for 120-160 characters"
                rows={4}
                className="w-full bg-[#0f1117] border border-white/8 rounded-lg px-3 py-2.5 text-sm text-[#e8eaed] placeholder:text-[#9aa0a6]/40 resize-none focus:outline-none focus:ring-1 focus:ring-[#4e8af4]/50 focus:border-[#4e8af4]/40 transition-colors"
              />
              {page?.metaDescription && (
                <p className="text-[11px] text-[#9aa0a6]">
                  Scraped: <span className="text-[#e8eaed]/60">{trunc(page.metaDescription, 110)}</span>
                </p>
              )}
            </div>

            {/* Indexing + Canonical row */}
            <div className="grid grid-cols-2 gap-4">
              {/* Noindex toggle */}
              <div className="space-y-2">
                <Label className="text-[#9aa0a6] text-[11px] font-medium uppercase tracking-widest">
                  Indexing
                </Label>
                <button
                  type="button"
                  onClick={() => setNoindex((v) => !v)}
                  className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg border text-[13px] font-medium transition-all ${
                    noindex
                      ? 'bg-amber-400/10 border-amber-400/30 text-amber-400 hover:bg-amber-400/15'
                      : 'bg-[#0f1117] border-white/8 text-[#e8eaed]/70 hover:bg-white/5'
                  }`}
                >
                  <EyeOff className="size-3.5 flex-shrink-0" />
                  {noindex ? 'noindex' : 'index'}
                </button>
                <p className="text-[10px] text-[#9aa0a6]/50 leading-relaxed">
                  {noindex
                    ? 'Search engines will be told not to index this page'
                    : 'Open to search engines'}
                </p>
              </div>

              {/* Scraped robots */}
              {page && (
                <div className="space-y-2">
                  <Label className="text-[#9aa0a6] text-[11px] font-medium uppercase tracking-widest">
                    Scraped robots
                  </Label>
                  <div className="px-3 py-2.5 rounded-lg bg-[#0f1117] border border-white/8 text-[13px] text-[#e8eaed]/40 italic">
                    Not scraped yet
                  </div>
                </div>
              )}
            </div>

            {/* Canonical */}
            <div className="space-y-2">
              <Label className="text-[#9aa0a6] text-[11px] font-medium uppercase tracking-widest flex items-center gap-1.5">
                <Link2 className="size-3" />
                Canonical URL
              </Label>
              <input
                type="url"
                value={canonical}
                onChange={(e) => setCanonical(e.target.value)}
                placeholder={page?.url ?? 'https://…'}
                className="w-full bg-[#0f1117] border border-white/8 rounded-lg px-3 py-2.5 text-sm text-[#e8eaed] placeholder:text-[#9aa0a6]/40 font-mono focus:outline-none focus:ring-1 focus:ring-[#4e8af4]/50 focus:border-[#4e8af4]/40 transition-colors"
              />
              <p className="text-[10px] text-[#9aa0a6]/50 leading-relaxed">
                Leave empty to use the page URL as canonical.
              </p>
            </div>

            {/* SERP Preview */}
            {page && (
              <SerpPreview title={title} description={desc} url={canonical || page.url} favicon={siteFavicon} />
            )}
          </div>

          {/* History */}
          <Separator className="bg-white/8" />
          <div className="px-6 py-5">
            <div className="flex items-center gap-2 mb-4">
              <Clock className="size-3.5 text-[#9aa0a6]" />
              <h3 className="text-[11px] font-medium uppercase tracking-widest text-[#9aa0a6]">
                Change History
              </h3>
              {history.length > 0 && (
                <span className="text-[10px] bg-white/8 text-[#9aa0a6] px-1.5 py-0.5 rounded-full ml-auto">
                  {history.length}
                </span>
              )}
            </div>
            <HistoryTimeline entries={history} isLoading={historyLoading} />
          </div>
        </div>

        <SheetFooter className="px-6 py-5 border-t border-white/8 flex-shrink-0 flex gap-3">
          <Button
            variant="ghost"
            onClick={onClose}
            className="flex-1 h-10 text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-white/5"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={update.isPending}
            className="flex-1 h-10 bg-[#4e8af4] hover:bg-[#4e8af4]/90 text-white"
          >
            {update.isPending
              ? <><RefreshCw className="size-4 mr-2 animate-spin" />Saving…</>
              : 'Save Changes'
            }
          </Button>
        </SheetFooter>
      </SheetContent>

      {aiReview && page && (
        <AiReviewDialog
          open={!!aiReview}
          onClose={() => setAiReview(null)}
          onApply={handleApplyAi}
          current={{ title, desc }}
          generated={aiReview}
          pageUrl={page.url}
          siteFavicon={siteFavicon}
        />
      )}
    </Sheet>
  )
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
          {[220, 180, 180, 80, 120, 80, 60].map((w, j) => (
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
  const [currentPage, setCurrentPage] = useState(1)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [sort, setSort] = useState<string>(
    () => localStorage.getItem('meta-sort') ?? 'url_asc',
  )
  const [editPage, setEditPage] = useState<Page | null>(null)
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
                  <TableCell colSpan={7}>
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
                    className={`border-white/8 transition-colors ${page.isTransactional ? 'bg-[#4e8af4]/[0.05] hover:bg-[#4e8af4]/[0.08]' : 'hover:bg-white/[0.02]'}`}
                  >
                    {/* URL */}
                    <TableCell className="max-w-[220px]">
                      <a
                        href={page.url}
                        target="_blank"
                        rel="noopener noreferrer"
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
                    </TableCell>

                    {/* Canonical */}
                    <TableCell className="max-w-[180px]">
                      {page.canonical ? (
                        <a
                          href={page.canonical}
                          target="_blank"
                          rel="noopener noreferrer"
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
                        onClick={() => setEditPage(page)}
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

      <EditMetaSheet
        page={editPage}
        siteId={id!}
        siteFavicon={site?.favicon}
        onClose={() => setEditPage(null)}
      />
    </div>
  )
}
