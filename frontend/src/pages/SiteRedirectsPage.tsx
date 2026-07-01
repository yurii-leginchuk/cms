import { useState, useRef, useEffect } from 'react'
import { Link, useParams, Navigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  ChevronRight, ChevronLeft, ChevronRight as ChevronRightIcon,
  ExternalLink, Search, Signpost, RefreshCw, AlertTriangle, Regex, ArrowRight, Trash2,
  Plus, Pencil, Power, GitMerge, Activity, Waypoints, ShieldCheck, Loader2, X,
  ClipboardCheck, ListChecks, SkipForward, ArrowUpCircle,
  Upload, Download, FileDown, Undo2, FileUp,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from '@/components/ui/sheet'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { StatusBadge } from '@/components/StatusBadge'
import { McpChangesPanel } from '@/components/McpChangesPanel'
import { RelativeClock } from '@/components/index-status/RelativeClock'
import { useSite } from '@/hooks/useSites'
import {
  useRedirectSummary, useRedirectList, useSyncRedirects,
  useRedirectDrift, useProposeRedirect, useResolveRedirectDrift,
  useRedirectIssues, useValidateRedirect, useResolveRedirect, useFlattenPreview,
  useAuditSummary, useAuditIssues, useRunAudit, useDeferIssue, useBatchFix,
  useImportDryRun, useImportApply, useRedirectBackups, useRestoreBackup,
} from '@/hooks/useRedirects'
import { redirectsApi } from '@/api/redirects'
import type {
  RedirectSummary, RedirectRow, RedirectWriteInput, RedirectDriftItem,
  ValidationResult, ResolveResult, RedirectChain, FlattenPreview,
  RedirectIssue as RedirectIssueT, DryRunResult, ImportDiffRow, ImportFormat, ImportMode,
} from '@/api/redirects'

const PAGE_LIMIT = 50

const STATUSES = [
  { value: '', label: 'Live (default)' },
  { value: 'enabled', label: 'Enabled only' },
  { value: 'disabled', label: 'Disabled only' },
  { value: 'deleted', label: 'Deleted in WP' },
  { value: 'all', label: 'All (incl. deleted)' },
]

const SORTS = [
  { value: 'position', label: 'Order (position)' },
  { value: 'hits', label: 'Most hits' },
  { value: 'source_asc', label: 'Source (A–Z)' },
  { value: 'recently_synced', label: 'Recently synced' },
]

const selectCls =
  'h-9 px-3 pr-8 rounded-lg bg-[#1a1d27] border border-white/8 text-[13px] text-[#e8eaed] focus:outline-none focus:ring-1 focus:ring-[#4e8af4]/50 appearance-none cursor-pointer'
const selectBg = {
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239aa0a6' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 10px center',
}

/** A redirect status-code chip — 301 permanent (emerald), 302/307 temporary
 *  (amber), 410/404 gone/error (red), anything else muted. */
function CodeChip({ code }: { code: number | null }) {
  if (code == null) return <span className="text-[#9aa0a6]/40 text-[13px]">—</span>
  const cls =
    code === 301 || code === 308
      ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20'
      : code === 302 || code === 307
        ? 'bg-amber-500/15 text-amber-400 border-amber-500/20'
        : code === 410 || code === 404
          ? 'bg-red-500/15 text-red-400 border-red-500/20'
          : 'bg-[#232635] text-[#9aa0a6] border-white/8'
  return (
    <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${cls}`}>
      {code}
    </span>
  )
}

export default function SiteRedirectsPage() {
  const { id } = useParams<{ id: string }>()
  const [currentPage, setCurrentPage] = useState(1)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [status, setStatus] = useState('')
  const [regexOnly, setRegexOnly] = useState(false)
  const [sort, setSort] = useState('position')
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [editing, setEditing] = useState<RedirectRow | 'new' | null>(null)

  const { data: site, isLoading: siteLoading } = useSite(id!)
  const { data: summary } = useRedirectSummary(id)
  const { data: drift } = useRedirectDrift(id)
  const { data: list, isLoading: listLoading, isFetching } = useRedirectList(id, {
    page: currentPage, limit: PAGE_LIMIT, search: debouncedSearch || undefined,
    status: status || undefined, regex: regexOnly, sort,
  })
  const sync = useSyncRedirects(id!)
  const propose = useProposeRedirect(id!)
  const resolveLive = useResolveRedirect(id!)
  const [liveTrail, setLiveTrail] = useState<{ row: RedirectRow; result: ResolveResult } | null>(null)
  const [ioOpen, setIoOpen] = useState(false)

  if (!id) return <Navigate to="/sites" replace />

  const rows = list?.data ?? []
  const meta = list?.meta

  function onSearch(v: string) {
    setSearch(v); setCurrentPage(1)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => setDebouncedSearch(v), 350)
  }

  async function syncNow() {
    try {
      const res = await sync.mutateAsync()
      if (res.redirectionActive === false) {
        toast.warning('The Redirection plugin isn\'t active on this site — nothing to sync.')
      } else if (res.fatalError) {
        toast.error(`Sync failed: ${res.fatalError}`)
      } else if (res.unchanged) {
        toast.success('Already up to date — no changes since the last sync.')
      } else {
        toast.success(
          `Synced ${res.redirectsFetched} redirect${res.redirectsFetched === 1 ? '' : 's'}` +
          ` · +${res.added} new, ${res.updated} changed, ${res.deleted} removed in WP.`,
        )
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't sync redirects. Try again.")
    }
  }

  async function proposeToggle(r: RedirectRow) {
    try {
      await propose.mutateAsync({ kind: 'toggle', id: r.id, enabled: !r.enabled })
      toast.success(`Queued: ${r.enabled ? 'disable' : 'enable'} redirect — approve below to apply.`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't queue the change.")
    }
  }

  async function proposeDelete(r: RedirectRow) {
    if (!window.confirm(`Queue deletion of the redirect for "${r.source}"? It won't be removed until you approve the change.`)) return
    try {
      await propose.mutateAsync({ kind: 'delete', id: r.id })
      toast.success('Queued: delete redirect — approve below to apply.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't queue the deletion.")
    }
  }

  async function editById(redirectId: string) {
    try {
      const detail = await redirectsApi.get(id!, redirectId)
      setEditing(detail)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't open the redirect.")
    }
  }

  async function checkLive(r: RedirectRow) {
    try {
      const result = await resolveLive.mutateAsync(r.id)
      setLiveTrail({ row: r, result })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't resolve the redirect live.")
    }
  }

  // Plugin-not-active is a distinct, honest state (not an error).
  const pluginInactive = summary && summary.redirectionActive === false
  const neverSynced = summary && summary.redirectionActive === null && !summary.lastRun

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
          <span className="text-[#e8eaed]">Redirects</span>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Signpost className="size-5 text-[#4e8af4]" />
            <h1 className="text-xl font-semibold text-[#e8eaed] tracking-tight">{site?.name}</h1>
            <span className="text-[#9aa0a6]/50 text-xl font-light">/</span>
            <span className="text-[#9aa0a6] text-[15px]">Redirects</span>
            {site && <StatusBadge status={site.status ?? 'idle'} />}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={syncNow}
              disabled={sync.isPending}
              title="Pull the latest redirects from the Redirection plugin now. Read-only — this never changes anything on the site."
              className="h-8 px-2.5 text-[12px] text-[#9aa0a6] hover:text-[#e8eaed] border border-white/8 gap-1.5"
            >
              <RefreshCw className={`size-3.5 ${sync.isPending ? 'animate-spin' : ''}`} />
              Sync now
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setIoOpen(true)}
              title="Bulk import / export redirects (CSV, Redirection JSON, .htaccess, nginx)"
              className="h-8 px-2.5 text-[12px] text-[#9aa0a6] hover:text-[#e8eaed] border border-white/8 gap-1.5"
            >
              <Upload className="size-3.5" />
              Import / Export
            </Button>
            <Button
              size="sm"
              onClick={() => setEditing('new')}
              disabled={pluginInactive === true}
              title={pluginInactive ? 'Redirection plugin not active' : 'Create a new redirect (staged for approval before it goes live)'}
              className="h-8 px-3 text-[13px] bg-[#4e8af4] hover:bg-[#4e8af4]/90 text-white gap-1.5 disabled:opacity-60"
            >
              <Plus className="size-3.5" />
              New redirect
            </Button>
          </div>
        </div>
      </div>

      <div className="px-8 py-6 space-y-6">
        {pluginInactive ? (
          <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.04] px-5 py-4 flex items-start gap-3">
            <AlertTriangle className="size-4 text-amber-400 mt-0.5 flex-shrink-0" />
            <div className="text-[13px] text-[#e8eaed]">
              <p className="font-medium">The Redirection plugin isn't active on this site.</p>
              <p className="text-[#9aa0a6] mt-1">
                Redirects are mirrored from the “Redirection” plugin (by John Godley). Install &amp;
                activate it, make sure the Poirier CMS connector plugin is v1.8.0+, then Sync.
              </p>
            </div>
          </div>
        ) : (
          <FreshnessStrip summary={summary} loading={!summary} />
        )}

        {/* Drift conflicts (WP changed under a pending CMS edit) */}
        {drift && drift.length > 0 && <DriftPanel siteId={id} items={drift} />}

        {/* Pending redirect changes awaiting approval (same gate as schema/meta) */}
        <McpChangesPanel siteId={id} focusModule="redirect" />

        {/* First-sync audit: ranked, enriched issues (batch fixes + judgment queue) */}
        {!pluginInactive && <AuditSection siteId={id} onEdit={editById} />}

        {/* Validation issues: chains (with live flatten proposals), conflicts, cycles */}
        {!pluginInactive && <IssuesSection siteId={id} />}

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative max-w-xs flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[#9aa0a6]" />
            <Input
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Filter by source or target…"
              className="pl-9 bg-[#1a1d27] border-white/8 text-[#e8eaed] placeholder:text-[#9aa0a6]/60 h-9"
            />
          </div>
          <select value={status} onChange={(e) => { setStatus(e.target.value); setCurrentPage(1) }} className={selectCls} style={selectBg}>
            {STATUSES.map((s) => <option key={s.value} value={s.value} className="bg-[#1a1d27]">{s.label}</option>)}
          </select>
          <label className="inline-flex items-center gap-2 text-[13px] text-[#9aa0a6] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={regexOnly}
              onChange={(e) => { setRegexOnly(e.target.checked); setCurrentPage(1) }}
              className="accent-[#4e8af4]"
            />
            <Regex className="size-3.5" />Regex only
          </label>
          <div className="flex-1" />
          <select value={sort} onChange={(e) => { setSort(e.target.value); setCurrentPage(1) }} className={selectCls} style={selectBg}>
            {SORTS.map((s) => <option key={s.value} value={s.value} className="bg-[#1a1d27]">{s.label}</option>)}
          </select>
        </div>

        {/* Table */}
        <div className="rounded-xl border border-white/8 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-white/8 hover:bg-transparent bg-[#1a1d27]">
                <TableHead className="text-[11px] font-medium uppercase tracking-widest text-[#9aa0a6] h-10">Source</TableHead>
                <TableHead className="text-[11px] font-medium uppercase tracking-widest text-[#9aa0a6] h-10">Target</TableHead>
                <TableHead className="text-[11px] font-medium uppercase tracking-widest text-[#9aa0a6] h-10 w-16">Code</TableHead>
                <TableHead className="text-[11px] font-medium uppercase tracking-widest text-[#9aa0a6] h-10 w-20 text-right">Hits</TableHead>
                <TableHead className="text-[11px] font-medium uppercase tracking-widest text-[#9aa0a6] h-10 w-24">State</TableHead>
                <TableHead className="text-[11px] font-medium uppercase tracking-widest text-[#9aa0a6] h-10 w-28">Synced</TableHead>
                <TableHead className="text-[11px] font-medium uppercase tracking-widest text-[#9aa0a6] h-10 w-28 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listLoading ? (
                [0, 1, 2, 3, 4].map((i) => (
                  <TableRow key={i} className="border-white/8 hover:bg-transparent">
                    {[260, 260, 40, 40, 70, 80, 90].map((w, j) => (
                      <TableCell key={j}><Skeleton className="h-4 bg-white/5 rounded" style={{ width: w }} /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow className="border-white/8 hover:bg-transparent">
                  <TableCell colSpan={7}>
                    <div className="flex flex-col items-center justify-center py-14 gap-3">
                      <div className="size-12 rounded-xl bg-[#1a1d27] border border-white/8 flex items-center justify-center">
                        <Signpost className="size-6 text-[#9aa0a6]" />
                      </div>
                      <p className="text-[#9aa0a6] text-sm text-center max-w-sm">
                        {debouncedSearch || status || regexOnly
                          ? 'No redirects match these filters'
                          : neverSynced
                            ? 'Not synced yet — click “Sync now” to mirror the site’s redirects'
                            : 'No redirects found in the Redirection plugin yet'}
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => {
                  const tombstoned = !!r.deletedInWpAt
                  return (
                    <TableRow
                      key={r.id}
                      className={`border-white/8 transition-colors ${tombstoned ? 'opacity-60' : ''} hover:bg-white/[0.02]`}
                    >
                      <TableCell className="max-w-[280px]">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {r.regex && (
                            <span title="Regex source — can't be fully resolved" className="flex-shrink-0">
                              <Regex className="size-3.5 text-[#c58af9]" />
                            </span>
                          )}
                          <span
                            className={`truncate max-w-[250px] text-[13px] ${tombstoned ? 'line-through text-[#9aa0a6]' : 'text-[#e8eaed]'}`}
                            title={r.source}
                          >
                            {r.source || '—'}
                          </span>
                        </div>
                        {r.title && (
                          <span className="mt-0.5 block text-[11px] text-[#9aa0a6]/70 truncate max-w-[250px]" title={r.title}>
                            {r.title}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[280px]">
                        {r.target ? (
                          <div className="flex items-center gap-1 min-w-0">
                            <ArrowRight className="size-3 text-[#9aa0a6]/50 flex-shrink-0" />
                            <a
                              href={/^https?:\/\//.test(r.target) ? r.target : `${site?.url ?? ''}${r.target}`}
                              target="_blank" rel="noopener noreferrer"
                              className="flex items-center gap-1 text-[13px] text-[#9aa0a6] hover:text-[#e8eaed] min-w-0"
                            >
                              <span className="truncate max-w-[230px]" title={r.target}>{r.target}</span>
                              <ExternalLink className="size-3 flex-shrink-0 opacity-50" />
                            </a>
                          </div>
                        ) : (
                          <span className="text-[12px] text-[#9aa0a6]/60">
                            {r.actionType && r.actionType !== 'url' ? r.actionType : '—'}
                          </span>
                        )}
                        {r.liveFinalStatus != null && <LiveStatusChip status={r.liveFinalStatus} hops={r.liveHops ?? null} />}
                      </TableCell>
                      <TableCell><CodeChip code={r.actionCode} /></TableCell>
                      <TableCell className="text-right">
                        <span className="text-[12px] tabular-nums text-[#9aa0a6]" title={r.wpLastAccess ? `Last hit: ${new Date(r.wpLastAccess).toLocaleString()}` : 'Never fired (or logging off)'}>
                          {r.wpLastCount.toLocaleString()}
                        </span>
                      </TableCell>
                      <TableCell>
                        {tombstoned ? (
                          <span className="inline-flex items-center gap-1 text-[12px] text-red-400/80" title={`Removed in WP ${new Date(r.deletedInWpAt!).toLocaleString()}`}>
                            <Trash2 className="size-3" />Deleted in WP
                          </span>
                        ) : r.enabled ? (
                          <span className="text-[12px] text-emerald-400/80">Enabled</span>
                        ) : (
                          <span className="text-[12px] text-[#9aa0a6]">Disabled</span>
                        )}
                      </TableCell>
                      <TableCell><RelativeClock ts={r.lastSyncedAt} /></TableCell>
                      <TableCell className="text-right">
                        {r.driftState === 'pending_cms' ? (
                          <span className="text-[11px] text-amber-400/90" title="A change is queued for this redirect awaiting approval">pending…</span>
                        ) : tombstoned ? (
                          <span className="text-[11px] text-[#9aa0a6]/40">—</span>
                        ) : (
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => checkLive(r)}
                              disabled={resolveLive.isPending}
                              title="Check live — follow the real HTTP redirect chain"
                              className="size-7 rounded-md flex items-center justify-center text-[#9aa0a6] hover:text-[#4e8af4] hover:bg-white/5 disabled:opacity-40"
                            >
                              {resolveLive.isPending && resolveLive.variables === r.id
                                ? <Loader2 className="size-3.5 animate-spin" />
                                : <Activity className="size-3.5" />}
                            </button>
                            <button
                              onClick={() => setEditing(r)}
                              title="Edit (queues a change for approval)"
                              className="size-7 rounded-md flex items-center justify-center text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-white/5"
                            >
                              <Pencil className="size-3.5" />
                            </button>
                            <button
                              onClick={() => proposeToggle(r)}
                              disabled={propose.isPending}
                              title={r.enabled ? 'Disable' : 'Enable'}
                              className={`size-7 rounded-md flex items-center justify-center hover:bg-white/5 disabled:opacity-40 ${r.enabled ? 'text-emerald-400/80 hover:text-emerald-300' : 'text-[#9aa0a6] hover:text-[#e8eaed]'}`}
                            >
                              <Power className="size-3.5" />
                            </button>
                            <button
                              onClick={() => proposeDelete(r)}
                              disabled={propose.isPending}
                              title="Delete (queues a change for approval)"
                              className="size-7 rounded-md flex items-center justify-center text-[#9aa0a6] hover:text-red-300 hover:bg-white/5 disabled:opacity-40"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })
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
              {' · '}{meta.total.toLocaleString()} redirects{isFetching ? ' · updating…' : ''}
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

      <RedirectEditSheet
        siteId={id}
        editing={editing}
        onClose={() => setEditing(null)}
      />

      <LiveTrailDialog data={liveTrail} onClose={() => setLiveTrail(null)} />
      <ImportExportDialog siteId={id} open={ioOpen} onClose={() => setIoOpen(false)} />
    </div>
  )
}

/* ── Import / Export wizard ───────────────────────────────────────────────── */

function download(filename: string, mime: string, content: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

const OP_TONE: Record<string, string> = {
  add: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  update: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
  delete: 'bg-red-500/15 text-red-400 border-red-500/20',
  noop: 'bg-[#232635] text-[#9aa0a6] border-white/8',
}

function ImportExportDialog({ siteId, open, onClose }: { siteId: string; open: boolean; onClose: () => void }) {
  const [content, setContent] = useState('')
  const [filename, setFilename] = useState<string | undefined>()
  const [format, setFormat] = useState<'' | ImportFormat>('')
  const [mode, setMode] = useState<ImportMode>('merge')
  const [dry, setDry] = useState<DryRunResult | null>(null)

  const dryRun = useImportDryRun(siteId)
  const apply = useImportApply(siteId)
  const restore = useRestoreBackup(siteId)
  const { data: backups } = useRedirectBackups(siteId, open)

  function reset() { setContent(''); setFilename(undefined); setFormat(''); setDry(null) }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFilename(file.name)
    setContent(await file.text())
    setDry(null)
  }

  async function runDry() {
    if (!content.trim()) { toast.error('Paste or upload a redirect file first.'); return }
    try {
      const res = await dryRun.mutateAsync({ content, format: format || undefined, mode, filename })
      setDry(res)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Dry-run failed.')
    }
  }

  async function runApply() {
    if (!dry) return
    try {
      const res = await apply.mutateAsync({ content, format: dry.format, mode, filename })
      toast.success(`Backup taken · queued ${res.queued.add} add / ${res.queued.update} update / ${res.queued.delete} delete for approval${res.skipped ? ` · ${res.skipped} skipped` : ''}.`)
      reset()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Apply failed.')
    }
  }

  async function doExport(kind: 'json' | 'csv' | 'apache' | 'nginx' | 'audit') {
    try {
      const res = kind === 'audit'
        ? await redirectsApi.exportRedirects(siteId, { mode: 'audit' })
        : await redirectsApi.exportRedirects(siteId, { mode: 'lossless', format: kind })
      download(res.filename, res.mime, res.content)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed.')
    }
  }

  async function doRestore(backupId: string) {
    if (!window.confirm('Restore this backup? Its redirects are re-queued for approval (nothing goes live until you approve).')) return
    try {
      const res = await restore.mutateAsync(backupId)
      toast.success(`Restore queued: ${res.queued.add} add / ${res.queued.update} update for approval.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Restore failed.')
    }
  }

  const applicable = dry ? dry.counts.add + dry.counts.update + dry.counts.delete : 0

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose() } }}>
      <DialogContent className="bg-[#15171f] border border-white/10 text-[#e8eaed] max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[15px] flex items-center gap-2"><Upload className="size-4 text-[#4e8af4]" /> Import / Export redirects</DialogTitle>
        </DialogHeader>

        {/* Export */}
        <div className="space-y-2">
          <p className="text-[12px] text-[#9aa0a6] flex items-center gap-1"><Download className="size-3.5" /> Export</p>
          <div className="flex flex-wrap gap-1.5">
            {(['json', 'csv', 'apache', 'nginx'] as const).map((f) => (
              <Button key={f} size="sm" variant="ghost" onClick={() => doExport(f)} className="h-7 px-2.5 text-[12px] text-[#9aa0a6] hover:text-[#e8eaed] border border-white/8">
                {f === 'json' ? 'Redirection JSON' : f.toUpperCase()}
              </Button>
            ))}
            <Button size="sm" variant="ghost" onClick={() => doExport('audit')} className="h-7 px-2.5 text-[12px] text-[#9aa0a6] hover:text-[#e8eaed] border border-white/8 gap-1">
              <FileDown className="size-3.5" /> Auditor CSV
            </Button>
          </div>
          <p className="text-[10px] text-[#9aa0a6]/60">Redirection JSON round-trips losslessly. The Auditor CSV is an enriched report (hits, live status, clicks, severity) — not for re-import.</p>
        </div>

        <div className="border-t border-white/8 my-1" />

        {/* Import */}
        <div className="space-y-3">
          <p className="text-[12px] text-[#9aa0a6] flex items-center gap-1"><FileUp className="size-3.5" /> Import (dry-run first — nothing is written until you approve)</p>

          <div className="flex items-center gap-2 flex-wrap">
            <label className="h-8 px-2.5 rounded-lg bg-[#1a1d27] border border-white/8 text-[12px] text-[#9aa0a6] hover:text-[#e8eaed] cursor-pointer inline-flex items-center gap-1.5">
              <Upload className="size-3.5" /> Choose file
              <input type="file" accept=".csv,.json,.htaccess,.conf,.txt" onChange={onFile} className="hidden" />
            </label>
            {filename && <span className="text-[11px] text-[#9aa0a6] truncate max-w-[160px]">{filename}</span>}
            <select value={format} onChange={(e) => { setFormat(e.target.value as ImportFormat | ''); setDry(null) }} className="h-8 px-2 rounded-lg bg-[#1a1d27] border border-white/8 text-[12px] text-[#e8eaed]">
              <option value="">Auto-detect</option>
              <option value="csv">CSV</option>
              <option value="json">Redirection JSON</option>
              <option value="apache">.htaccess</option>
              <option value="nginx">nginx</option>
            </select>
            <select value={mode} onChange={(e) => { setMode(e.target.value as ImportMode); setDry(null) }} className="h-8 px-2 rounded-lg bg-[#1a1d27] border border-white/8 text-[12px] text-[#e8eaed]">
              <option value="merge">Merge (add/update)</option>
              <option value="replace">Replace (also delete missing)</option>
            </select>
          </div>

          <textarea
            value={content}
            onChange={(e) => { setContent(e.target.value); setDry(null) }}
            placeholder="…or paste redirects here (CSV / Redirection JSON / .htaccess / nginx)"
            className="w-full h-24 px-3 py-2 rounded-lg bg-[#1a1d27] border border-white/8 text-[12px] text-[#e8eaed] font-mono placeholder:text-[#9aa0a6]/50 resize-y"
          />

          <div className="flex items-center gap-2">
            <Button size="sm" onClick={runDry} disabled={dryRun.isPending || !content.trim()} className="h-8 px-3 text-[12px] bg-[#4e8af4] hover:bg-[#4e8af4]/90 text-white gap-1.5">
              {dryRun.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />} Dry run
            </Button>
            {dry && (
              <Button size="sm" onClick={runApply} disabled={apply.isPending || applicable === 0} className="h-8 px-3 text-[12px] bg-emerald-600 hover:bg-emerald-600/90 text-white gap-1.5">
                {apply.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />} Apply {applicable} (auto-backup + approve)
              </Button>
            )}
          </div>

          {dry && <DryRunView dry={dry} />}
        </div>

        {/* Backups / restore */}
        {backups && backups.length > 0 && (
          <>
            <div className="border-t border-white/8 my-1" />
            <div className="space-y-1.5">
              <p className="text-[12px] text-[#9aa0a6] flex items-center gap-1"><Undo2 className="size-3.5" /> Backups (one-click restore)</p>
              {backups.slice(0, 5).map((b) => (
                <div key={b.id} className="flex items-center justify-between text-[11px] text-[#9aa0a6]">
                  <span>{b.reason} · {b.redirectCount} redirects · <RelativeClock ts={b.createdAt} /></span>
                  <Button size="sm" variant="ghost" onClick={() => doRestore(b.id)} disabled={restore.isPending} className="h-6 px-2 text-[11px] text-[#9aa0a6] hover:text-[#e8eaed]">Restore</Button>
                </div>
              ))}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function DryRunView({ dry }: { dry: DryRunResult }) {
  const c = dry.counts
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="text-[#9aa0a6]">Detected <span className="text-[#e8eaed]">{dry.format}</span> · {dry.totalRows} rows · as of a fresh backup</span>
        <span className="text-emerald-400">+{c.add} add</span>
        <span className="text-blue-400">{c.update} update</span>
        {c.delete > 0 && <span className="text-red-400">{c.delete} delete</span>}
        <span className="text-[#9aa0a6]">{c.noop} no-op</span>
        {c.warnings > 0 && <span className="text-amber-400">{c.warnings} warning{c.warnings === 1 ? '' : 's'}</span>}
        {c.blocked > 0 && <span className="text-red-400">{c.blocked} blocked</span>}
      </div>

      {dry.parseErrors.length > 0 && (
        <div className="rounded-md border border-amber-400/25 bg-amber-400/[0.05] px-3 py-2 text-[11px] text-amber-300 space-y-0.5 max-h-24 overflow-y-auto">
          {dry.parseErrors.map((e, i) => <div key={i}>Row {e.rowNumber}: {e.reason}</div>)}
        </div>
      )}

      <div className="rounded-lg border border-white/8 max-h-64 overflow-y-auto">
        <table className="w-full text-[11px]">
          <thead className="sticky top-0 bg-[#1a1d27]">
            <tr className="text-left text-[#9aa0a6]">
              <th className="px-2 py-1.5 font-medium">Op</th>
              <th className="px-2 py-1.5 font-medium">Source → Target</th>
              <th className="px-2 py-1.5 font-medium">Code</th>
              <th className="px-2 py-1.5 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody>
            {dry.diff.map((d: ImportDiffRow) => (
              <tr key={d.fingerprint} className={`border-t border-white/5 ${d.status === 'blocked' ? 'bg-red-500/[0.06]' : ''}`}>
                <td className="px-2 py-1.5"><span className={`inline-flex rounded border px-1 py-0.5 text-[10px] ${OP_TONE[d.op]}`}>{d.op}</span></td>
                <td className="px-2 py-1.5 text-[#e8eaed]"><span className="break-all">{d.source}</span> <span className="text-[#9aa0a6]/50">→</span> <span className="text-[#9aa0a6] break-all">{d.target ?? '—'}</span></td>
                <td className="px-2 py-1.5 tabular-nums text-[#9aa0a6]">{d.actionCode}</td>
                <td className={`px-2 py-1.5 ${d.status === 'blocked' ? 'text-red-400' : d.status === 'warning' ? 'text-amber-400' : 'text-[#9aa0a6]/50'}`}>{d.issues.join('; ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ── Live status chip + hop-trail dialog ─────────────────────────────────── */

function statusTone(status: number): string {
  if (status === 200) return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20'
  if (status >= 300 && status < 400) return 'bg-amber-500/15 text-amber-400 border-amber-500/20'
  if (status === 0) return 'bg-[#232635] text-[#9aa0a6] border-white/8'
  return 'bg-red-500/15 text-red-400 border-red-500/20'
}

function LiveStatusChip({ status, hops }: { status: number; hops: number | null }) {
  const label = status === 0 ? 'unreachable' : `live ${status}`
  return (
    <span
      className={`mt-0.5 inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${statusTone(status)}`}
      title={`Last live check · final HTTP ${status}${hops != null ? ` · ${hops} hop${hops === 1 ? '' : 's'}` : ''}`}
    >
      <Activity className="size-2.5" />{label}{hops != null && hops > 1 ? ` · ${hops} hops` : ''}
    </span>
  )
}

function LiveTrailDialog({ data, onClose }: { data: { row: RedirectRow; result: ResolveResult } | null; onClose: () => void }) {
  return (
    <Dialog open={!!data} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-[#15171f] border border-white/10 text-[#e8eaed] max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-[15px] flex items-center gap-2">
            <Activity className="size-4 text-[#4e8af4]" /> Live redirect trail
          </DialogTitle>
        </DialogHeader>
        {data && (
          <div className="space-y-3">
            <p className="text-[12px] text-[#9aa0a6] break-all">{data.row.source}</p>
            <div className="space-y-1">
              {data.result.trail.map((h) => (
                <div key={h.hop} className="flex items-center gap-2 text-[12px]">
                  <span className="text-[#9aa0a6]/50 tabular-nums w-5">{h.hop + 1}.</span>
                  <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium tabular-nums ${statusTone(h.status)}`}>
                    {h.status === 0 ? 'ERR' : h.status}
                  </span>
                  <span className="text-[#e8eaed] break-all truncate" title={h.url}>{h.url}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 text-[12px] pt-1 border-t border-white/8">
              {data.result.loop ? (
                <span className="text-red-400 flex items-center gap-1"><AlertTriangle className="size-3.5" /> Loop detected in the live chain</span>
              ) : data.result.finalStatus === 200 ? (
                <span className="text-emerald-400">Final: 200 OK ({data.result.hops} hop{data.result.hops === 1 ? '' : 's'})</span>
              ) : (
                <span className="text-amber-400">Final: HTTP {data.result.finalStatus ?? '—'} ({data.result.hops} hop{data.result.hops === 1 ? '' : 's'})</span>
              )}
              {data.result.cached && <span className="text-[#9aa0a6]/60">· cached</span>}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/* ── First-sync audit: summary strip + batch fixes + judgment queue ───────── */

const SEV_TONE: Record<string, string> = {
  critical: 'bg-red-500/15 text-red-400 border-red-500/20',
  high: 'bg-orange-500/15 text-orange-400 border-orange-500/20',
  medium: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
  low: 'bg-[#232635] text-[#9aa0a6] border-white/8',
}

function AuditSection({ siteId, onEdit }: { siteId: string; onEdit: (id: string) => void }) {
  const { data: summary } = useAuditSummary(siteId)
  const runAudit = useRunAudit(siteId)
  const batch = useBatchFix(siteId)
  const [judgePage, setJudgePage] = useState(1)
  const { data: judged } = useAuditIssues(siteId, { status: 'open', fixMode: 'judgment', page: judgePage, limit: 10 })

  async function run() {
    try {
      await runAudit.mutateAsync()
      toast.success('Audit complete — issues ranked by traffic & severity below.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't run the audit.")
    }
  }

  async function doBatch(kind: 'flatten' | 'duplicates' | 'dead', label: string) {
    try {
      const res = await batch.mutateAsync(kind) as { queued?: number; skipped?: number; errors?: number }
      toast.success(`${label}: queued ${res.queued ?? 0} for approval${res.skipped ? `, ${res.skipped} skipped` : ''}. Approve them above to apply.`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't run the batch fix.")
    }
  }

  if (!summary) return null

  if (!summary.hasAudited) {
    return (
      <div className="rounded-xl border border-white/8 bg-[#15171f] p-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <ClipboardCheck className="size-5 text-[#4e8af4] flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-[14px] font-medium text-[#e8eaed]">Run the redirect audit</p>
            <p className="text-[12px] text-[#9aa0a6]">Analyze loops, dead targets, chains, duplicates &amp; more — ranked by the traffic at stake.</p>
          </div>
        </div>
        <Button size="sm" onClick={run} disabled={runAudit.isPending} className="h-8 px-3 text-[13px] bg-[#4e8af4] hover:bg-[#4e8af4]/90 text-white gap-1.5 flex-shrink-0">
          {runAudit.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <ClipboardCheck className="size-3.5" />}
          Run audit
        </Button>
      </div>
    )
  }

  const sev = summary.bySeverity
  const t = summary.byType
  const judgments = judged?.data ?? []

  return (
    <div className="rounded-xl border border-white/8 bg-[#15171f] p-5 space-y-4">
      {/* Summary strip */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <ClipboardCheck className="size-4 text-[#4e8af4]" />
          <h3 className="text-[14px] font-semibold text-[#e8eaed]">Audit</h3>
          {(['critical', 'high', 'medium', 'low'] as const).map((s) =>
            sev[s] ? (
              <span key={s} className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${SEV_TONE[s]}`}>
                {sev[s]} {s}
              </span>
            ) : null,
          )}
          {summary.open === 0 && <span className="text-[12px] text-emerald-400">All clear</span>}
        </div>
        <Button size="sm" variant="ghost" onClick={run} disabled={runAudit.isPending} className="h-7 px-2.5 text-[12px] text-[#9aa0a6] hover:text-[#e8eaed] border border-white/8 gap-1.5">
          {runAudit.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          Re-run
        </Button>
      </div>

      {/* Evidence provenance */}
      {summary.lastRun && (
        <p className="text-[11px] text-[#9aa0a6]/80">
          Analyzed {summary.lastRun.redirectsAnalyzed} redirects · ranking backed by{' '}
          {summary.lastRun.gscConnected ? 'GSC clicks/impressions' : 'no GSC data'}
          {summary.lastRun.ga4Connected ? ` · GA4 organic${summary.lastRun.ga4OrganicRevenue != null ? ` ($${Math.round(summary.lastRun.ga4OrganicRevenue).toLocaleString()}/28d, site-level)` : ''}` : ''}
          {' · '}<RelativeClock ts={summary.lastRun.finishedAt ?? summary.lastRun.startedAt} />
        </p>
      )}

      {/* Batch mechanical fixes (each queues gate change requests) */}
      {(t.redirect_to_redirect_chain || t.duplicate || t.dead_redirect) && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[12px] text-[#9aa0a6] inline-flex items-center gap-1"><ListChecks className="size-3.5" /> Batch fixes:</span>
          {t.redirect_to_redirect_chain > 0 && (
            <Button size="sm" variant="ghost" disabled={batch.isPending} onClick={() => doBatch('flatten', 'Flatten chains')} className="h-7 px-2.5 text-[12px] text-[#9aa0a6] hover:text-[#e8eaed] border border-white/8">
              Flatten {t.redirect_to_redirect_chain} chain{t.redirect_to_redirect_chain === 1 ? '' : 's'}
            </Button>
          )}
          {t.duplicate > 0 && (
            <Button size="sm" variant="ghost" disabled={batch.isPending} onClick={() => doBatch('duplicates', 'Disable duplicates')} className="h-7 px-2.5 text-[12px] text-[#9aa0a6] hover:text-[#e8eaed] border border-white/8">
              Disable {t.duplicate} duplicate{t.duplicate === 1 ? '' : 's'}
            </Button>
          )}
          {t.dead_redirect > 0 && (
            <Button size="sm" variant="ghost" disabled={batch.isPending} onClick={() => doBatch('dead', 'Disable dead redirects')} className="h-7 px-2.5 text-[12px] text-[#9aa0a6] hover:text-[#e8eaed] border border-white/8">
              Disable {t.dead_redirect} dead
            </Button>
          )}
          <span className="text-[11px] text-[#9aa0a6]/60">— each queues for approval, nothing goes live directly.</span>
        </div>
      )}

      {/* Judgment queue — one at a time */}
      {judgments.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[12px] text-[#9aa0a6]">Needs your judgment ({judged?.meta.total ?? judgments.length})</p>
            {judged && judged.meta.totalPages > 1 && (
              <div className="flex items-center gap-1.5 text-[12px] text-[#9aa0a6]">
                <button onClick={() => setJudgePage((p) => Math.max(1, p - 1))} disabled={judgePage <= 1} className="disabled:opacity-30 hover:text-[#e8eaed]"><ChevronLeft className="size-4" /></button>
                <span>{judgePage}/{judged.meta.totalPages}</span>
                <button onClick={() => setJudgePage((p) => Math.min(judged.meta.totalPages, p + 1))} disabled={judgePage >= judged.meta.totalPages} className="disabled:opacity-30 hover:text-[#e8eaed]"><ChevronRightIcon className="size-4" /></button>
              </div>
            )}
          </div>
          {judgments.map((issue) => (
            <JudgmentCard key={issue.id} siteId={siteId} issue={issue} onEdit={onEdit} />
          ))}
        </div>
      )}
    </div>
  )
}

function JudgmentCard({ siteId, issue, onEdit }: { siteId: string; issue: RedirectIssueT; onEdit: (id: string) => void }) {
  const defer = useDeferIssue(siteId)
  const propose = useProposeRedirect(siteId)
  const e = issue.evidence
  const canPromote = issue.issueType === 'temporary_should_be_permanent' && !!issue.primaryRedirectId

  async function skip() {
    try { await defer.mutateAsync({ id: issue.id }); toast.success('Deferred — find it under the Deferred filter.') }
    catch (err) { toast.error(err instanceof Error ? err.message : "Couldn't defer.") }
  }

  async function promote() {
    if (!issue.primaryRedirectId) return
    try {
      await propose.mutateAsync({ kind: 'update', id: issue.primaryRedirectId, body: { actionCode: 301 } })
      toast.success('Queued: change to 301 — approve above to apply.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't queue the change.")
    }
  }

  return (
    <div className="rounded-lg border border-white/8 bg-[#1a1d27] px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${SEV_TONE[issue.severity]}`}>{issue.severity}</span>
            <span className="text-[13px] text-[#e8eaed] truncate" title={issue.title}>{issue.title}</span>
          </div>
          {issue.detail && <p className="text-[11px] text-[#9aa0a6] mb-1">{issue.detail}</p>}
          {/* Evidence: why it matters / why it ranks here */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-[#9aa0a6]/90">
            <span>{e?.sourceClicks != null ? `${e.sourceClicks} clicks · ${e.sourceImpressions ?? 0} impr (28d)` : 'no GSC data'}</span>
            {e?.sourceTransactional && <span className="text-amber-400/90">money page</span>}
            {e?.targetIndexed === false && <span className="text-red-400/90">target noindex</span>}
            {e?.liveFinalStatus != null && <span className={e.liveFinalStatus >= 400 ? 'text-red-400/90' : ''}>live {e.liveFinalStatus}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <Button size="sm" variant="ghost" onClick={skip} disabled={defer.isPending} title="Defer (S)" className="h-7 px-2 text-[12px] text-[#9aa0a6] hover:text-[#e8eaed]">
            <SkipForward className="size-3.5" /> Skip
          </Button>
          {canPromote ? (
            <Button size="sm" onClick={promote} disabled={propose.isPending} className="h-7 px-2.5 text-[12px] bg-[#4e8af4] hover:bg-[#4e8af4]/90 text-white gap-1">
              <ArrowUpCircle className="size-3.5" /> Change to 301
            </Button>
          ) : issue.primaryRedirectId ? (
            <Button size="sm" onClick={() => onEdit(issue.primaryRedirectId!)} className="h-7 px-2.5 text-[12px] bg-[#4e8af4] hover:bg-[#4e8af4]/90 text-white gap-1">
              <Pencil className="size-3.5" /> Fix
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/* ── Validation issues + live flatten proposals ──────────────────────────── */

function IssuesSection({ siteId }: { siteId: string }) {
  const { data: issues, isLoading } = useRedirectIssues(siteId)
  if (isLoading || !issues) return null
  const { counts } = issues
  if (counts.chains === 0 && counts.cycles === 0 && counts.conflicts === 0 && counts.duplicates === 0) return null

  return (
    <div className="rounded-xl border border-white/8 bg-[#15171f] p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Waypoints className="size-4 text-[#4e8af4]" />
        <h3 className="text-[14px] font-semibold text-[#e8eaed]">Redirect issues</h3>
        <span className="text-[11px] text-[#9aa0a6]">
          {counts.chains} chain{counts.chains === 1 ? '' : 's'} · {counts.cycles} loop{counts.cycles === 1 ? '' : 's'} · {counts.conflicts} conflict{counts.conflicts === 1 ? '' : 's'} · {counts.duplicates} duplicate{counts.duplicates === 1 ? '' : 's'}
        </span>
      </div>

      {issues.cycles.length > 0 && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/[0.04] px-4 py-3 space-y-1">
          <p className="text-[12px] font-medium text-red-300 flex items-center gap-1"><AlertTriangle className="size-3.5" /> Loops</p>
          {issues.cycles.map((c, i) => (
            <p key={i} className="text-[12px] text-[#9aa0a6] break-all">
              {c.nodes.join(' → ')} <span className="text-[10px]">({c.certainty})</span>
            </p>
          ))}
        </div>
      )}

      {issues.chains.length > 0 && (
        <div className="space-y-2">
          <p className="text-[12px] text-[#9aa0a6]">Chains can be shortened (A→B→C ⇒ A→C). Preview verifies the real chain live before proposing.</p>
          {issues.chains.map((chain) => (
            <ChainRow key={chain.headId} siteId={siteId} chain={chain} />
          ))}
        </div>
      )}
    </div>
  )
}

function ChainRow({ siteId, chain }: { siteId: string; chain: RedirectChain }) {
  const flatten = useFlattenPreview(siteId)
  const propose = useProposeRedirect(siteId)
  const [preview, setPreview] = useState<FlattenPreview | null>(null)

  async function loadPreview() {
    try {
      setPreview(await flatten.mutateAsync(chain.headId))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't preview the flatten.")
    }
  }

  async function apply() {
    if (!preview?.after) return
    try {
      await propose.mutateAsync({ kind: 'update', id: chain.headId, body: { source: preview.after.source, target: preview.after.target, actionCode: preview.after.actionCode } })
      toast.success('Flatten queued for approval — approve it to push to WordPress.')
      setPreview(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't queue the flatten.")
    }
  }

  return (
    <div className="rounded-lg border border-white/8 bg-[#1a1d27] px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 text-[13px]">
          <p className="text-[#e8eaed] break-all">{chain.hops.join(' → ')}</p>
          <p className="text-[11px] text-[#9aa0a6] mt-0.5">{chain.length} hops{chain.hasCycle ? ' · runs into a loop' : ''}</p>
        </div>
        <Button
          size="sm" variant="ghost"
          onClick={loadPreview}
          disabled={flatten.isPending}
          className="h-7 px-2.5 text-[12px] text-[#9aa0a6] hover:text-[#e8eaed] border border-white/8 flex-shrink-0"
        >
          {flatten.isPending ? <Loader2 className="size-3.5 animate-spin" /> : 'Preview flatten'}
        </Button>
      </div>

      {preview && (
        <div className="mt-3 border-t border-white/8 pt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            {preview.verdict === 'ready' ? (
              <span className="inline-flex items-center gap-1 text-emerald-400"><ShieldCheck className="size-3.5" /> Ready</span>
            ) : preview.verdict === 'needs_review' ? (
              <span className="inline-flex items-center gap-1 text-amber-400"><AlertTriangle className="size-3.5" /> Needs review</span>
            ) : (
              <span className="inline-flex items-center gap-1 text-red-400"><X className="size-3.5" /> Blocked</span>
            )}
            {preview.reason && <span className="text-[#9aa0a6]">{preview.reason}</span>}
          </div>
          {preview.after && (
            <div className="text-[12px] grid grid-cols-[70px_1fr] gap-1">
              <span className="text-[#9aa0a6]">Before</span>
              <span className="text-[#9aa0a6]/70 line-through break-all">{preview.before.source} → {preview.before.target ?? '—'} ({preview.before.actionCode ?? '—'})</span>
              <span className="text-[#9aa0a6]">After</span>
              <span className="text-emerald-300 break-all">{preview.after.source} → {preview.after.target} ({preview.after.actionCode})</span>
            </div>
          )}
          {preview.verdict === 'ready' && (
            <Button
              size="sm"
              onClick={apply}
              disabled={propose.isPending}
              className="h-7 px-3 text-[12px] bg-[#4e8af4] hover:bg-[#4e8af4]/90 text-white gap-1.5"
            >
              {propose.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Waypoints className="size-3.5" />}
              Queue flatten
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

/* ── Drift conflicts (keep WP / keep CMS) ────────────────────────────────── */

function DriftPanel({ siteId, items }: { siteId: string; items: RedirectDriftItem[] }) {
  const resolve = useResolveRedirectDrift(siteId)

  async function onResolve(id: string, resolution: 'keep_wp' | 'keep_cms') {
    try {
      await resolve.mutateAsync({ id, resolution })
      toast.success(
        resolution === 'keep_wp'
          ? 'Kept the WordPress version — the pending CMS change was discarded.'
          : 'Kept your CMS change — approve it below to push it to WordPress.',
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't resolve the conflict.")
    }
  }

  return (
    <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.04] p-5">
      <div className="flex items-center gap-2 mb-3">
        <GitMerge className="size-4 text-amber-400" />
        <h3 className="text-[14px] font-semibold text-[#e8eaed]">
          {items.length} redirect{items.length === 1 ? '' : 's'} changed in WordPress since your edit
        </h3>
      </div>
      <p className="text-[12px] text-[#9aa0a6] mb-4 max-w-2xl">
        These were edited directly in WordPress while a CMS change was pending. Nothing was
        overwritten — choose which version wins.
      </p>
      <div className="space-y-2">
        {items.map((it) => (
          <div key={it.id} className="rounded-lg border border-white/8 bg-[#1a1d27] px-4 py-3">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 text-[13px]">
                <p className="text-[#e8eaed] truncate" title={it.source}>{it.source}</p>
                <p className="text-[11px] text-[#9aa0a6] mt-0.5">
                  Now in WP: {it.target ?? '—'} ({it.actionCode ?? '—'}) ·{' '}
                  {it.cmsDesired ? `your change: ${it.cmsDesired.summary}` : 'your change'}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Button
                  size="sm" variant="ghost"
                  onClick={() => onResolve(it.id, 'keep_wp')}
                  disabled={resolve.isPending}
                  className="h-7 px-2.5 text-[12px] text-[#9aa0a6] hover:text-[#e8eaed] border border-white/8"
                >
                  Keep WP
                </Button>
                <Button
                  size="sm"
                  onClick={() => onResolve(it.id, 'keep_cms')}
                  disabled={resolve.isPending}
                  className="h-7 px-2.5 text-[12px] bg-[#4e8af4] hover:bg-[#4e8af4]/90 text-white"
                >
                  Keep CMS
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Create / edit redirect (Sheet) — stages a pending change ─────────────── */

const CODES = [301, 302, 307, 308, 410, 404]
const MATCH_TYPES = ['url', 'referrer', 'agent', 'login', 'header', 'cookie', 'role', 'server', 'ip']

function RedirectEditSheet({
  siteId, editing, onClose,
}: {
  siteId: string
  editing: RedirectRow | 'new' | null
  onClose: () => void
}) {
  const propose = useProposeRedirect(siteId)
  const validate = useValidateRedirect(siteId)
  const isNew = editing === 'new'
  const row = editing && editing !== 'new' ? editing : null

  const [form, setForm] = useState<RedirectWriteInput>({ source: '', target: '', actionCode: 301, matchType: 'url', regex: false, enabled: true })
  const [validation, setValidation] = useState<ValidationResult | null>(null)

  // Reset the form whenever a different redirect (or "new") opens.
  useEffect(() => {
    setValidation(null)
    if (!editing) return
    if (isNew) {
      setForm({ source: '', target: '', actionCode: 301, matchType: 'url', regex: false, enabled: true })
    } else if (row) {
      setForm({
        source: row.source,
        target: row.target ?? '',
        actionCode: row.actionCode ?? 301,
        matchType: row.matchType ?? 'url',
        regex: row.regex,
        enabled: row.enabled,
        title: row.title ?? '',
      })
    }
  }, [editing, isNew, row])

  const isError = actionCodeHasTarget(form.actionCode) && !(form.source ?? "").trim()

  async function runValidate(): Promise<ValidationResult | null> {
    try {
      const res = await validate.mutateAsync({ intended: form, excludeId: row?.id })
      setValidation(res)
      return res
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't validate.")
      return null
    }
  }

  async function submit() {
    if (!(form.source ?? "").trim()) {
      toast.error('A source URL is required.')
      return
    }
    // Block submit on a detected loop (errors); warnings are allowed through.
    const res = await runValidate()
    if (res?.blocked) {
      toast.error('This redirect would create a loop — fix the target before saving.')
      return
    }
    try {
      if (isNew) {
        await propose.mutateAsync({ kind: 'create', body: form })
      } else if (row) {
        await propose.mutateAsync({ kind: 'update', id: row.id, body: form })
      }
      toast.success('Change queued for approval — approve it to push to WordPress.')
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't queue the change.")
    }
  }

  const gone = form.actionCode === 410 || form.actionCode === 404

  return (
    <Sheet open={!!editing} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="bg-[#15171f] border-l border-white/10 text-[#e8eaed] w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-[15px] text-[#e8eaed]">
            {isNew ? 'New redirect' : 'Edit redirect'}
          </SheetTitle>
        </SheetHeader>

        <div className="px-4 py-4 space-y-4">
          <Field label="Source URL / path">
            <Input
              value={form.source}
              onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
              placeholder="/old-page"
              className="bg-[#1a1d27] border-white/8 text-[#e8eaed] h-9"
            />
          </Field>

          <Field label="Status code">
            <div className="flex flex-wrap gap-1.5">
              {CODES.map((c) => (
                <button
                  key={c}
                  onClick={() => setForm((f) => ({ ...f, actionCode: c }))}
                  className={`px-2.5 py-1 rounded-md text-[12px] tabular-nums border ${form.actionCode === c ? 'bg-[#4e8af4] text-white border-[#4e8af4]' : 'bg-[#1a1d27] text-[#9aa0a6] border-white/8 hover:text-[#e8eaed]'}`}
                >
                  {c}
                </button>
              ))}
            </div>
          </Field>

          {!gone && (
            <Field label="Target URL / path">
              <Input
                value={form.target ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, target: e.target.value }))}
                placeholder="/new-page"
                className="bg-[#1a1d27] border-white/8 text-[#e8eaed] h-9"
              />
              {isError && (
                <p className="mt-1 text-[11px] text-amber-400/90">A {form.actionCode} redirect needs a source.</p>
              )}
            </Field>
          )}
          {gone && (
            <p className="text-[12px] text-[#9aa0a6]">
              A {form.actionCode} tells search engines the URL is gone — no target needed.
            </p>
          )}

          <Field label="Match type">
            <select
              value={form.matchType ?? 'url'}
              onChange={(e) => setForm((f) => ({ ...f, matchType: e.target.value }))}
              className="h-9 w-full px-3 rounded-lg bg-[#1a1d27] border border-white/8 text-[13px] text-[#e8eaed]"
            >
              {MATCH_TYPES.map((m) => <option key={m} value={m} className="bg-[#1a1d27]">{m}</option>)}
            </select>
          </Field>

          <label className="flex items-center gap-2 text-[13px] text-[#9aa0a6] cursor-pointer select-none">
            <input type="checkbox" checked={!!form.regex} onChange={(e) => setForm((f) => ({ ...f, regex: e.target.checked }))} className="accent-[#4e8af4]" />
            <Regex className="size-3.5" /> Regex source
          </label>

          <label className="flex items-center gap-2 text-[13px] text-[#9aa0a6] cursor-pointer select-none">
            <input type="checkbox" checked={!!form.enabled} onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))} className="accent-[#4e8af4]" />
            <Power className="size-3.5" /> Enabled
          </label>

          <Field label="Title (optional)">
            <Input
              value={form.title ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              className="bg-[#1a1d27] border-white/8 text-[#e8eaed] h-9"
            />
          </Field>

          {/* Validation feedback (loop = blocking error, dup/conflict = warning) */}
          {validation && (validation.errors.length > 0 || validation.warnings.length > 0) && (
            <div className="space-y-1.5">
              {validation.errors.map((e, i) => (
                <div key={`e${i}`} className="rounded-md border border-red-500/25 bg-red-500/[0.06] px-3 py-2 text-[12px] text-red-300 flex items-start gap-2">
                  <AlertTriangle className="size-3.5 mt-0.5 flex-shrink-0" />
                  <span className="break-all">{e.message}</span>
                </div>
              ))}
              {validation.warnings.map((w, i) => (
                <div key={`w${i}`} className="rounded-md border border-amber-400/25 bg-amber-400/[0.06] px-3 py-2 text-[12px] text-amber-300 flex items-start gap-2">
                  <AlertTriangle className="size-3.5 mt-0.5 flex-shrink-0" />
                  <span className="break-all">{w.message}</span>
                </div>
              ))}
            </div>
          )}
          {validation && validation.errors.length === 0 && validation.warnings.length === 0 && (
            <div className="rounded-md border border-emerald-500/20 bg-emerald-500/[0.05] px-3 py-2 text-[12px] text-emerald-300 flex items-center gap-2">
              <ShieldCheck className="size-3.5" /> No duplicates, conflicts, or loops detected.
            </div>
          )}
        </div>

        <SheetFooter className="px-4 gap-2">
          <Button variant="ghost" onClick={onClose} className="text-[#9aa0a6]">Cancel</Button>
          <Button
            variant="ghost"
            onClick={runValidate}
            disabled={validate.isPending || !(form.source ?? "").trim()}
            className="text-[#9aa0a6] hover:text-[#e8eaed] border border-white/8 gap-1.5"
          >
            {validate.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}
            Validate
          </Button>
          <Button
            onClick={submit}
            disabled={propose.isPending || validate.isPending || !(form.source ?? "").trim() || validation?.blocked === true}
            className="bg-[#4e8af4] hover:bg-[#4e8af4]/90 text-white gap-1.5"
          >
            {propose.isPending ? <RefreshCw className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            Queue for approval
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[12px] text-[#9aa0a6]">{label}</label>
      {children}
    </div>
  )
}

function actionCodeHasTarget(code: number | null | undefined): boolean {
  return code !== 410 && code !== 404
}

/* ── Freshness & counts strip ────────────────────────────────────────────── */

function FreshnessStrip({ summary, loading }: { summary: RedirectSummary | undefined; loading: boolean }) {
  if (loading || !summary) return <Skeleton className="h-16 w-full bg-white/5 rounded-xl" />
  const { counts, freshness, lastRun } = summary
  return (
    <div className="rounded-xl border border-white/8 bg-[#1a1d27]/60 px-5 py-4 flex flex-wrap items-center gap-x-8 gap-y-3">
      <div className="text-[13px] text-[#e8eaed]">
        <span className="tabular-nums font-medium">{counts.live.toLocaleString()}</span>
        <span className="text-[#9aa0a6]"> live redirects</span>
        <span className="text-[#9aa0a6]"> · {counts.disabled} disabled · {counts.regex} regex</span>
        {counts.tombstoned > 0 && (
          <span className="text-red-400/80"> · {counts.tombstoned} deleted in WP</span>
        )}
      </div>
      <div className="text-[12px] text-[#9aa0a6] flex items-center gap-1.5">
        <span>Synced</span>
        <RelativeClock ts={freshness.lastSyncedAt} staleDays={2} emptyLabel="never" />
        {lastRun?.unchanged && <span className="text-[#9aa0a6]/60">· no changes</span>}
      </div>
      {lastRun?.fatalError && (
        <div className="text-[12px] text-red-400/80 flex items-center gap-1.5" title={lastRun.fatalError}>
          <AlertTriangle className="size-3.5" />Last sync failed
        </div>
      )}
    </div>
  )
}
