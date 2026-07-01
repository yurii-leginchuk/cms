import { useState, useEffect } from 'react'
import { Link, useParams, Navigate } from 'react-router-dom'
import { toast } from 'sonner'
import { McpChangesBanner } from '@/components/McpChangesBanner'
import {
  ChevronRight, ExternalLink, Search, Braces,
  CheckCircle2, AlertTriangle, XCircle, UploadCloud, Bookmark, RefreshCw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import Pagination from '@/components/Pagination'
import SchemaCoverageBadge from '@/components/SchemaCoverageBadge'
import { ApplyAllSchemasDialog } from '@/components/ApplyAllSchemasDialog'
import { useSite } from '@/hooks/useSites'
import { useSchemaPages, useDetectAllSchemas, useSchemaCoverage } from '@/hooks/useSchema'
import type { SchemaPageOverview, SchemaValidity } from '@/api/schema'

const VALIDITY_CHIP: Record<SchemaValidity, string> = {
  valid: 'border-emerald-500/30 text-emerald-400 bg-emerald-500/5',
  warnings: 'border-amber-500/30 text-amber-400 bg-amber-500/5',
  errors: 'border-red-500/30 text-red-400 bg-red-500/5',
}

function ValidityDot({ validity }: { validity: SchemaValidity }) {
  if (validity === 'valid') return <CheckCircle2 className="size-3 text-emerald-400" />
  if (validity === 'warnings') return <AlertTriangle className="size-3 text-amber-400" />
  return <XCircle className="size-3 text-red-400" />
}

function SchemaRow({ siteId, page }: { siteId: string; page: SchemaPageOverview }) {
  const path = page.url.replace(/^https?:\/\/[^/]+/, '') || '/'
  const hasPending = page.pendingCount > 0

  // Stretched-link pattern: the row is a DIV and the detail link covers it via
  // an absolute overlay, while the external "Open page" anchor sits ABOVE the
  // overlay (z-10). Nesting the <a> inside a <Link> was invalid HTML
  // (validateDOMNesting warning) and made click behavior browser-dependent.
  return (
    <div
      className={`relative block rounded-xl border transition-colors ${
        hasPending
          ? 'border-amber-500/40 bg-amber-500/[0.04] hover:border-amber-500/60 hover:bg-amber-500/[0.07]'
          : 'border-white/8 bg-[#1a1d27] hover:border-[#4e8af4]/30 hover:bg-[#1d2130]'
      }`}
    >
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <Link
            to={`/sites/${siteId}/schemas/${page.pageId}`}
            className="block text-[13px] text-[#e8eaed] font-medium truncate rounded-xl after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-[#4e8af4]/60 focus-visible:after:rounded-xl"
            title={page.url}
          >
            {path}
          </Link>

          {/* Inline schema summary */}
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            {page.detected === null ? (
              <span className="text-[11px] text-[#9aa0a6]/50">Not checked yet</span>
            ) : page.schemas.length === 0 ? (
              <span className="text-[11px] text-amber-400/80">No JSON-LD on page</span>
            ) : (
              page.schemas.map((s, i) => (
                <span
                  key={i}
                  className={`inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border ${VALIDITY_CHIP[s.validity]}`}
                  title={`${s.source} · ${s.validity}`}
                >
                  <ValidityDot validity={s.validity} />
                  {s.type}
                </span>
              ))
            )}
          </div>
        </div>

        {/* Right-side counts */}
        <div className="flex items-center gap-2 flex-shrink-0 pt-0.5">
          {page.managedCount > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] text-[#4e8af4]" title="Managed schemas">
              <Bookmark className="size-3" />
              {page.managedCount}
            </span>
          )}
          {page.pendingCount > 0 && (
            <span
              className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-300 bg-amber-500/15 border border-amber-500/30 rounded-full px-1.5 py-0.5"
              title="Changes awaiting Apply"
            >
              <UploadCloud className="size-3" />
              {page.pendingCount} pending
            </span>
          )}
          <a
            href={page.url}
            target="_blank"
            rel="noopener noreferrer"
            className="relative z-10 text-[#9aa0a6] hover:text-[#4e8af4] p-1"
            title="Open page"
          >
            <ExternalLink className="size-3.5" />
          </a>
          <ChevronRight className="size-4 text-[#9aa0a6]/50" />
        </div>
      </div>
    </div>
  )
}

export default function SiteSchemasPage() {
  const { id } = useParams<{ id: string }>()
  const { data: site, isLoading: siteLoading } = useSite(id!)
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [page, setPage] = useState(1)

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search)
      setPage(1) // reset to first page when the filter changes
    }, 300)
    return () => clearTimeout(t)
  }, [search])

  const [applyAllOpen, setApplyAllOpen] = useState(false)

  const { data, isLoading } = useSchemaPages(id!, page, 25, debounced)
  const pages = data?.data
  const meta = data?.meta

  const { data: coverage } = useSchemaCoverage(id!)
  const pendingChanges = coverage?.pendingChanges ?? 0
  const hasWpKey = !!site?.wpApiKey
  const applyDisabled = pendingChanges === 0 || !hasWpKey
  const applyTitle = !hasWpKey
    ? 'Add a WP API key in site settings to apply changes'
    : pendingChanges === 0
      ? 'No pending changes to apply'
      : `Apply ${pendingChanges} pending change(s) across the site`

  const detectAll = useDetectAllSchemas(id!)
  const runDetectAll = () =>
    detectAll.mutate(undefined, {
      onSuccess: (r) => {
        if (r.pagesTotal === 0) {
          toast.info('No pages yet - parse the site first')
        } else if (r.detected === 0) {
          toast.info(`No parsed pages yet (${r.skippedNoHtml} awaiting scrape)`)
        } else {
          toast.success(
            `Detected ${r.detected} page(s)` +
              (r.skippedNoHtml > 0 ? ` · ${r.skippedNoHtml} not parsed yet` : ''),
          )
        }
      },
      onError: (e) => toast.error((e as Error)?.message ?? 'Detect failed'),
    })

  if (!id) return <Navigate to="/sites" replace />

  return (
    <div>
      {/* Header */}
      <div className="px-8 pt-8 pb-4 border-b border-white/8">
        <div className="flex items-center gap-2 text-[13px] mb-4">
          <Link to="/sites" className="text-[#9aa0a6] hover:text-[#e8eaed] transition-colors">
            Sites
          </Link>
          <ChevronRight className="size-3.5 text-[#9aa0a6]/40" />
          <Link to={`/sites/${id}`} className="text-[#9aa0a6] hover:text-[#e8eaed] transition-colors">
            {siteLoading ? <Skeleton className="h-4 w-24 bg-white/5 inline-block" /> : site?.name}
          </Link>
          <ChevronRight className="size-3.5 text-[#9aa0a6]/40" />
          <span className="text-[#e8eaed]">Schemas</span>
        </div>

        <h1 className="text-xl font-semibold text-[#e8eaed] tracking-tight flex items-center gap-2">
          <Braces className="size-5 text-[#4e8af4]" />
          Structured Data
        </h1>
        <p className="text-[13px] text-[#9aa0a6] mt-1">
          Detect, validate, generate and publish JSON-LD schema per URL
        </p>
      </div>

      <div className="px-8 py-6 space-y-5">
        <McpChangesBanner siteId={id} module="schema" />
        {/* Search + coverage */}
        <div className="flex items-center gap-3">
          <div className="relative max-w-md flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[#9aa0a6]" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by URL…"
              className="pl-9 bg-[#1a1d27] border-white/8 text-[#e8eaed] placeholder:text-[#9aa0a6]/60 focus-visible:ring-[#4e8af4]/50 focus-visible:border-[#4e8af4]/50 h-9"
            />
          </div>
          <SchemaCoverageBadge siteId={id} />
          <Button
            size="sm"
            variant="outline"
            className="ml-auto h-9 text-[13px] border-white/10 bg-transparent text-[#e8eaed] hover:bg-white/5"
            disabled={detectAll.isPending}
            onClick={runDetectAll}
            title="Detect & validate JSON-LD on every parsed page"
          >
            <RefreshCw className={`size-3.5 ${detectAll.isPending ? 'animate-spin' : ''}`} />
            {detectAll.isPending ? 'Detecting…' : 'Detect all'}
          </Button>
          <Button
            size="sm"
            className="h-9 text-[13px] bg-emerald-600 text-white hover:bg-emerald-600/90 disabled:opacity-50"
            disabled={applyDisabled}
            onClick={() => setApplyAllOpen(true)}
            title={applyTitle}
          >
            <UploadCloud className="size-3.5" />
            Apply All{pendingChanges > 0 ? ` (${pendingChanges})` : ''}
          </Button>
        </div>

        {/* Pending-changes banner */}
        {pendingChanges > 0 && (
          <button
            type="button"
            onClick={() => !applyDisabled && setApplyAllOpen(true)}
            className="w-full flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-left transition-colors hover:bg-amber-500/15 disabled:cursor-default"
            disabled={!hasWpKey}
          >
            <div className="size-8 rounded-lg bg-amber-500/15 flex items-center justify-center flex-shrink-0">
              <UploadCloud className="size-4 text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-amber-200">
                {pendingChanges} change{pendingChanges === 1 ? '' : 's'} pending Apply
              </p>
              <p className="text-[12px] text-amber-300/70 mt-0.5">
                {hasWpKey
                  ? 'Review and push all pending schema changes to WordPress.'
                  : 'Add a WP API key in site settings before you can apply.'}
              </p>
            </div>
            {hasWpKey && (
              <span className="text-[12px] text-amber-300 font-medium flex items-center gap-1 flex-shrink-0">
                Review <ChevronRight className="size-3.5" />
              </span>
            )}
          </button>
        )}

        {/* List */}
        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-16 bg-white/5 rounded-xl" />
            ))}
          </div>
        ) : !pages || pages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2">
            <Braces className="size-8 text-[#9aa0a6]/30" />
            <p className="text-[13px] text-[#9aa0a6]/60">
              {debounced ? 'No URLs match your filter' : 'No pages indexed yet - parse the site first'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {pages.map((p) => (
              <SchemaRow key={p.pageId} siteId={id} page={p} />
            ))}
          </div>
        )}

        {/* Pagination */}
        {meta && meta.totalPages > 1 && (
          <div className="flex items-center justify-between text-[13px] text-[#9aa0a6]">
            <span>{meta.total.toLocaleString()} URLs</span>
            <Pagination page={meta.page} totalPages={meta.totalPages} onChange={setPage} />
          </div>
        )}
      </div>

      <ApplyAllSchemasDialog
        open={applyAllOpen}
        onClose={() => setApplyAllOpen(false)}
        siteId={id}
      />
    </div>
  )
}
