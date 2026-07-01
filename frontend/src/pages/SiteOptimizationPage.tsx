import { useEffect, useMemo, useState } from 'react'
import { useParams, Navigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  Zap, ShieldCheck, Play, RefreshCw, Search, ImageOff, Loader2, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table'
import Pagination from '@/components/Pagination'
import { useSite } from '@/hooks/useSites'
import {
  useOptimizationConfig, useUpdateOptimizationConfig, useOptimizationStats,
  useOptimizationImages, useStartOptimizationRun, useOptimizationRun,
  useCancelOptimizationRun, useReoptimizeImage,
} from '@/hooks/useOptimization'
import type { OptimizationScope, OptimizationState } from '@/api/optimization'

const LIMIT = 25
const ACCENT = '#4e8af4'

function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  if (n === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

const STATE_LABEL: Record<OptimizationState, string> = {
  not_optimized: 'Not optimized',
  queued: 'Queued',
  optimizing: 'Optimizing',
  optimized: 'Optimized',
  skipped: 'Skipped',
  failed: 'Failed',
}

const STATE_CLASS: Record<OptimizationState, string> = {
  not_optimized: 'text-[#9aa0a6] bg-white/5',
  queued: 'text-sky-300 bg-sky-400/10',
  optimizing: 'text-sky-300 bg-sky-400/10',
  optimized: 'text-emerald-300 bg-emerald-400/10',
  skipped: 'text-amber-300 bg-amber-400/10',
  failed: 'text-red-300 bg-red-400/10',
}

function StateBadge({ state, stale }: { state: OptimizationState; stale?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`px-2 py-0.5 rounded-md text-[11px] font-medium ${STATE_CLASS[state]}`}>
        {STATE_LABEL[state]}
      </span>
      {stale && (
        <span className="px-1.5 py-0.5 rounded-md text-[10px] text-amber-300/80 bg-amber-400/10" title="Optimized under older settings">
          stale
        </span>
      )}
    </span>
  )
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-[#9aa0a6]">{label}</div>
      <div className="text-xl font-semibold text-[#e8eaed] mt-1">{value}</div>
      {sub && <div className="text-[11px] text-[#9aa0a6] mt-0.5">{sub}</div>}
    </div>
  )
}

export default function SiteOptimizationPage() {
  const { id: siteId } = useParams<{ id: string }>()
  const { data: site } = useSite(siteId!)

  const { data: config, isLoading: configLoading } = useOptimizationConfig(siteId!)
  const { data: stats } = useOptimizationStats(siteId!)
  const updateConfig = useUpdateOptimizationConfig(siteId!)
  const startRun = useStartOptimizationRun(siteId!)
  const cancelRun = useCancelOptimizationRun(siteId!)
  const reoptimize = useReoptimizeImage(siteId!)

  // ── Run tracking (poll while active, mirroring PageSpeed) ──────────────────
  const [runId, setRunId] = useState<string | null>(null)
  const [runActive, setRunActive] = useState(false)
  const { data: run } = useOptimizationRun(siteId!, runId, runActive)
  useEffect(() => {
    if (run && run.status !== 'running') setRunActive(false)
  }, [run])

  // ── Settings form (local, synced from server) ──────────────────────────────
  const [form, setForm] = useState({ enabled: false, webpEnabled: true, quality: 80, maxWidth: '1600' })
  useEffect(() => {
    if (config) {
      setForm({
        enabled: config.enabled,
        webpEnabled: config.webpEnabled,
        quality: config.quality,
        maxWidth: config.maxWidth === null ? '' : String(config.maxWidth),
      })
    }
  }, [config])

  // ── Table state ────────────────────────────────────────────────────────────
  const [page, setPage] = useState(1)
  const [stateFilter, setStateFilter] = useState('')
  const [search, setSearch] = useState('')
  const [scope, setScope] = useState<OptimizationScope>('new_only')
  const { data: list, isLoading: listLoading } = useOptimizationImages(siteId!, {
    page, limit: LIMIT, state: stateFilter || undefined, search: search || undefined,
  })

  const dirty = useMemo(() => {
    if (!config) return false
    return (
      form.enabled !== config.enabled ||
      form.webpEnabled !== config.webpEnabled ||
      form.quality !== config.quality ||
      (form.maxWidth === '' ? null : Number(form.maxWidth)) !== config.maxWidth
    )
  }, [form, config])

  if (!siteId) return <Navigate to="/sites" replace />

  const saveConfig = () => {
    updateConfig.mutate(
      {
        enabled: form.enabled,
        webpEnabled: form.webpEnabled,
        quality: form.quality,
        maxWidth: form.maxWidth === '' ? null : Number(form.maxWidth),
      },
      {
        onSuccess: () => toast.success('Optimization settings saved'),
        onError: (e) => toast.error((e as Error).message),
      },
    )
  }

  const runNow = () => {
    startRun.mutate(scope, {
      onSuccess: ({ runId: id }) => {
        setRunId(id)
        setRunActive(true)
        toast.success('Optimization started — running in the background. You can keep working.')
      },
      onError: (e) => toast.error((e as Error).message),
    })
  }

  const progressPct = run && run.imagesConsidered > 0
    ? Math.round((run.processed / run.imagesConsidered) * 100)
    : 0

  return (
    <div className="max-w-4xl mx-auto px-6 py-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <Zap className="size-5" style={{ color: ACCENT }} />
            <h1 className="text-lg font-semibold text-[#e8eaed]">Image Optimization</h1>
          </div>
          <p className="text-[13px] text-[#9aa0a6] mt-1">
            Compress and convert the media library to WebP. {site?.name}
          </p>
        </div>
      </div>

      {/* Safety card — persistent trust surface */}
      <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.04] px-4 py-3 mb-5 flex gap-3">
        <ShieldCheck className="size-4 text-emerald-300 mt-0.5 flex-shrink-0" />
        <p className="text-[12px] text-[#c9cdd4] leading-relaxed">
          <span className="text-emerald-300 font-medium">Images never disappear.</span>{' '}
          Phase 1 only measures and stores optimization results locally — nothing on your live
          site changes yet. CDN upload and URL rewriting (with a guaranteed fallback to the
          original WordPress URL) arrive in later phases.
        </p>
      </div>

      {/* Settings */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 mb-5">
        <h2 className="text-[13px] font-medium text-[#e8eaed] mb-3">Settings</h2>
        {configLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center justify-between col-span-2">
              <div>
                <Label className="text-[#e8eaed]">Optimization enabled</Label>
                <p className="text-[11px] text-[#9aa0a6]">Master switch for this site.</p>
              </div>
              <Button
                variant={form.enabled ? 'default' : 'outline'}
                size="sm"
                onClick={() => setForm((f) => ({ ...f, enabled: !f.enabled }))}
              >
                {form.enabled ? 'On' : 'Off'}
              </Button>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label className="text-[#e8eaed]">Convert to WebP</Label>
                <p className="text-[11px] text-[#9aa0a6]">Off = mozjpeg JPEG.</p>
              </div>
              <Button
                variant={form.webpEnabled ? 'default' : 'outline'}
                size="sm"
                onClick={() => setForm((f) => ({ ...f, webpEnabled: !f.webpEnabled }))}
              >
                {form.webpEnabled ? 'WebP' : 'JPEG'}
              </Button>
            </div>

            <div>
              <Label className="text-[#e8eaed]">Quality (1–100)</Label>
              <Input
                type="number"
                min={1}
                max={100}
                value={form.quality}
                onChange={(e) =>
                  setForm((f) => ({ ...f, quality: Math.max(1, Math.min(100, Number(e.target.value) || 0)) }))
                }
                className="mt-1"
              />
            </div>

            <div className="col-span-2">
              <Label className="text-[#e8eaed]">Resize max width (px) — blank = no resize</Label>
              <Input
                type="number"
                min={320}
                max={8000}
                placeholder="No resize"
                value={form.maxWidth}
                onChange={(e) => setForm((f) => ({ ...f, maxWidth: e.target.value }))}
                className="mt-1 max-w-[200px]"
              />
              <p className="text-[11px] text-[#9aa0a6] mt-1">
                Only images wider than this are downscaled; narrower ones are untouched.
              </p>
            </div>

            <div className="col-span-2 flex justify-end">
              <Button size="sm" onClick={saveConfig} disabled={!dirty || updateConfig.isPending}>
                {updateConfig.isPending ? 'Saving…' : 'Save settings'}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Run controls */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 mb-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as OptimizationScope)}
              disabled={runActive}
              className="h-8 rounded-lg bg-white/[0.03] border border-white/10 text-[13px] text-[#e8eaed] px-2"
            >
              <option value="new_only">New / unoptimized only</option>
              <option value="all">All (re-do stale &amp; failed)</option>
              <option value="force_all">Force re-optimize everything</option>
            </select>
            <Button size="sm" onClick={runNow} disabled={runActive || startRun.isPending}>
              {runActive ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
              {runActive ? 'Running…' : 'Optimize library'}
            </Button>
          </div>
          {runActive && runId && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                cancelRun.mutate(runId, { onSuccess: () => toast.message('Cancelling after the current image…') })
              }
            >
              <X className="size-4" /> Cancel
            </Button>
          )}
        </div>

        {run && (runActive || run.status !== 'running') && (
          <div className="mt-3">
            <div className="h-2 rounded-full bg-white/5 overflow-hidden">
              <div
                className="h-full transition-all"
                style={{ width: `${progressPct}%`, background: ACCENT }}
              />
            </div>
            <div className="flex items-center justify-between mt-2 text-[12px] text-[#9aa0a6]">
              <span>
                {run.processed} / {run.imagesConsidered} processed
                {run.status !== 'running' && ` · ${run.status}`}
              </span>
              <span>
                <span className="text-emerald-300">{run.optimized} optimized</span> ·{' '}
                <span className="text-amber-300">{run.skipped} skipped</span> ·{' '}
                <span className="text-red-300">{run.failed} failed</span> ·{' '}
                {formatBytes(run.bytesSavedSum)} saved
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        <StatCard label="Optimized" value={stats?.optimizedCount ?? '—'} sub={`${stats?.inventoryTotal ?? 0} in library`} />
        <StatCard label="Bytes saved" value={formatBytes(stats?.bytesSaved)} sub={stats?.asOf ? `as of ${new Date(stats.asOf).toLocaleDateString()}` : undefined} />
        <StatCard label="% saved" value={stats ? `${stats.percentSaved}%` : '—'} sub="weighted by bytes" />
        <StatCard label="Skipped / Failed" value={`${stats?.skippedCount ?? 0} / ${stats?.failedCount ?? 0}`} sub={stats?.staleCount ? `${stats.staleCount} stale` : undefined} />
      </div>

      {/* Image table */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <select
              value={stateFilter}
              onChange={(e) => { setStateFilter(e.target.value); setPage(1) }}
              className="h-8 rounded-lg bg-white/[0.03] border border-white/10 text-[13px] text-[#e8eaed] px-2"
            >
              <option value="">All states</option>
              <option value="not_optimized">Not optimized</option>
              <option value="optimized">Optimized</option>
              <option value="skipped">Skipped</option>
              <option value="failed">Failed</option>
            </select>
          </div>
          <div className="relative">
            <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9aa0a6]" />
            <Input
              placeholder="Search by URL…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
              className="h-8 pl-8 w-56"
            />
          </div>
        </div>

        {listLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
          </div>
        ) : !list || list.data.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <ImageOff className="size-8 text-[#9aa0a6] mb-2" />
            <p className="text-[13px] text-[#e8eaed]">No images yet</p>
            <p className="text-[12px] text-[#9aa0a6] mt-1">
              Run an optimization to sync the media library and process images.
            </p>
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Image</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead className="text-right">Original → Optimized</TableHead>
                  <TableHead className="text-right">Saved</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.map((row) => (
                  <TableRow key={row.imageId}>
                    <TableCell className="max-w-[280px]">
                      <span className="block truncate text-[12px] text-[#c9cdd4]" title={row.canonicalUrl}>
                        {row.canonicalUrl}
                      </span>
                      {row.failureError && (
                        <span className="block truncate text-[11px] text-red-300/80" title={row.failureError}>
                          {row.failureError}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StateBadge state={row.state} stale={row.isStale} />
                      {row.skipReason && (
                        <span className="ml-1 text-[11px] text-[#9aa0a6]">({row.skipReason})</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-[12px] text-[#9aa0a6]">
                      {row.originalBytes !== null
                        ? `${formatBytes(row.originalBytes)} → ${formatBytes(row.optimizedBytes)}`
                        : '—'}
                      {row.outputFormat && <span className="ml-1 text-[11px] uppercase">{row.outputFormat}</span>}
                    </TableCell>
                    <TableCell className="text-right text-[12px] text-emerald-300">
                      {row.bytesSaved ? formatBytes(row.bytesSaved) : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={reoptimize.isPending}
                        onClick={() =>
                          reoptimize.mutate(row.imageId, {
                            onSuccess: () => toast.success('Re-optimized'),
                            onError: (e) => toast.error((e as Error).message),
                          })
                        }
                      >
                        <RefreshCw className="size-3.5" /> Re-optimize
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex justify-between items-center mt-3">
              <span className="text-[12px] text-[#9aa0a6]">{list.meta.total} images</span>
              <Pagination page={page} totalPages={list.meta.totalPages} onChange={setPage} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
