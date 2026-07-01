import { useEffect, useMemo, useState } from 'react'
import { useParams, Navigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  Zap, ShieldCheck, Play, RefreshCw, Search, ImageOff, Loader2, X,
  Cloud, AlertTriangle, CheckCircle2, Database, Globe, Power, Link2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogPortal, DialogOverlay } from '@/components/ui/dialog'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table'
import Pagination from '@/components/Pagination'
import { useSite } from '@/hooks/useSites'
import {
  useOptimizationConfig, useUpdateOptimizationConfig, useOptimizationStats,
  useOptimizationImages, useStartOptimizationRun, useOptimizationRun,
  useCancelOptimizationRun, useReoptimizeImage,
  useUpdateR2Config, useCreateR2Bucket, useTestR2Connection,
  useProvisionCdn, useCdnStatus, useEnableRewrite, useDisableRewrite,
  useConnectWebhook, useDisconnectWebhook, useRunAutopilot, useOptimizationRuns,
} from '@/hooks/useOptimization'
import type { OptimizationScope, OptimizationState, R2Status, DnsStatus } from '@/api/optimization'

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

function R2StatusChip({ status }: { status: R2Status }) {
  const map: Record<R2Status, { label: string; cls: string }> = {
    untested: { label: 'R2: not tested', cls: 'text-[#9aa0a6] bg-white/5' },
    verified: { label: 'R2: verified', cls: 'text-emerald-300 bg-emerald-400/10' },
    failed: { label: 'R2: failed', cls: 'text-red-300 bg-red-400/10' },
  }
  const s = map[status]
  return <span className={`px-2 py-0.5 rounded-md text-[11px] font-medium ${s.cls}`}>{s.label}</span>
}

function DnsStatusChip({ status }: { status: DnsStatus }) {
  const map: Record<DnsStatus, { label: string; cls: string }> = {
    none: { label: 'DNS: not set', cls: 'text-[#9aa0a6] bg-white/5' },
    pending: { label: 'DNS: provisioning', cls: 'text-sky-300 bg-sky-400/10' },
    active: { label: 'DNS: active', cls: 'text-emerald-300 bg-emerald-400/10' },
    error: { label: 'DNS: error', cls: 'text-red-300 bg-red-400/10' },
  }
  const s = map[status]
  return <span className={`px-2 py-0.5 rounded-md text-[11px] font-medium ${s.cls}`}>{s.label}</span>
}

/** Header rewrite badge: Active / Off / Fallback-only. */
function RewriteBadge({ enabled, liveCount }: { enabled: boolean; liveCount: number }) {
  let cls = 'text-[#9aa0a6] bg-white/5'
  let label = 'Rewrite: Off'
  if (enabled && liveCount > 0) { cls = 'text-emerald-300 bg-emerald-400/10'; label = 'Rewrite: Active' }
  else if (enabled && liveCount === 0) { cls = 'text-amber-300 bg-amber-400/10'; label = 'Rewrite: Fallback-only' }
  return <span className={`px-2 py-0.5 rounded-md text-[11px] font-medium ${cls}`}>{label}</span>
}

/** Minimal confirm dialog for the dangerous, hard-to-reverse actions. */
function ConfirmDialog({
  open, onOpenChange, title, body, confirmLabel, onConfirm, danger, busy,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  body: React.ReactNode
  confirmLabel: string
  onConfirm: () => void
  danger?: boolean
  busy?: boolean
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay className="bg-black/60 backdrop-blur-sm" />
        <DialogPrimitive.Popup
          className="fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-full flex flex-col
            bg-[#1a1d27] border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
          style={{ maxWidth: '520px' }}
        >
          <div className="px-6 py-4 border-b border-white/8">
            <h2 className="text-[15px] font-semibold text-[#e8eaed]">{title}</h2>
          </div>
          <div className="px-6 py-4 text-[13px] text-[#c9cdd4] leading-relaxed">{body}</div>
          <div className="px-6 py-4 border-t border-white/8 flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
            <Button
              size="sm"
              variant={danger ? 'destructive' : 'default'}
              onClick={onConfirm}
              disabled={busy}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              {confirmLabel}
            </Button>
          </div>
        </DialogPrimitive.Popup>
      </DialogPortal>
    </Dialog>
  )
}

/** Masked secret input: shows "•••• set" placeholder when already stored. */
function SecretInput({
  label, isSet, value, onChange, placeholder,
}: { label: string; isSet: boolean; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <Label className="text-[#e8eaed]">{label}</Label>
      <Input
        type="password"
        autoComplete="off"
        value={value}
        placeholder={isSet ? '•••• set — leave blank to keep' : placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1"
      />
    </div>
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
  const updateR2 = useUpdateR2Config(siteId!)
  const createBucket = useCreateR2Bucket(siteId!)
  const testR2 = useTestR2Connection(siteId!)
  const provisionCdn = useProvisionCdn(siteId!)
  const enableRewrite = useEnableRewrite(siteId!)
  const disableRewrite = useDisableRewrite(siteId!)
  const connectWebhook = useConnectWebhook(siteId!)
  const disconnectWebhook = useDisconnectWebhook(siteId!)
  const runAutopilot = useRunAutopilot(siteId!)
  const { data: runs } = useOptimizationRuns(siteId!)

  // ── R2 credential form (write-only; blank = keep existing) ─────────────────
  const [r2Form, setR2Form] = useState({ r2AccountId: '', r2AccessKeyId: '', r2Secret: '', cfApiToken: '' })
  const [bucketName, setBucketName] = useState('')

  // ── CDN + rewrite state ────────────────────────────────────────────────────
  const [cdnForm, setCdnForm] = useState({ cdnDomain: '', cfZoneId: '' })
  const [provisionConfirm, setProvisionConfirm] = useState(false)
  const [killConfirm, setKillConfirm] = useState(false)
  const dnsPending = config?.dnsStatus === 'pending'
  useCdnStatus(siteId!, dnsPending) // polls + invalidates config while provisioning

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

  const saveR2 = () => {
    const patch: Record<string, string> = {}
    if (r2Form.r2AccountId.trim()) patch.r2AccountId = r2Form.r2AccountId.trim()
    if (r2Form.r2AccessKeyId.trim()) patch.r2AccessKeyId = r2Form.r2AccessKeyId.trim()
    if (r2Form.r2Secret) patch.r2Secret = r2Form.r2Secret
    if (r2Form.cfApiToken) patch.cfApiToken = r2Form.cfApiToken
    if (Object.keys(patch).length === 0) { toast.message('Nothing to save'); return }
    updateR2.mutate(patch, {
      onSuccess: () => {
        toast.success('R2 credentials saved (encrypted)')
        setR2Form({ r2AccountId: '', r2AccessKeyId: '', r2Secret: '', cfApiToken: '' })
      },
      onError: (e) => toast.error((e as Error).message),
    })
  }

  const doCreateBucket = () => {
    createBucket.mutate(bucketName.trim() || undefined, {
      onSuccess: (r) =>
        toast.success(r.existed ? `Using existing bucket "${r.bucket}"` : `Bucket "${r.bucket}" created`),
      onError: (e) => toast.error((e as Error).message),
    })
  }

  const doTestR2 = () => {
    testR2.mutate(undefined, {
      onSuccess: (c) =>
        c.r2Status === 'verified'
          ? toast.success('R2 connection verified')
          : toast.error(c.r2LastError || 'R2 test failed'),
      onError: (e) => toast.error((e as Error).message),
    })
  }

  const canCreateBucket = !!config && config.r2AccountIdSet && config.cfApiTokenSet
  const canTestR2 = !!config && config.r2AccessKeyIdSet && config.r2SecretSet && !!config.r2Bucket

  const r2Verified = config?.r2Status === 'verified'
  const dnsActive = config?.dnsStatus === 'active'
  const canProvision = r2Verified && cdnForm.cdnDomain.trim() !== '' && cdnForm.cfZoneId.trim() !== ''
  const canEnableRewrite = r2Verified && dnsActive

  const doProvision = () => {
    setProvisionConfirm(false)
    provisionCdn.mutate(
      { cdnDomain: cdnForm.cdnDomain.trim(), cfZoneId: cdnForm.cfZoneId.trim() },
      {
        onSuccess: () => toast.success('CDN domain binding started — Cloudflare is provisioning DNS + TLS.'),
        onError: (e) => toast.error((e as Error).message),
      },
    )
  }

  const doEnableRewrite = () => {
    enableRewrite.mutate(undefined, {
      onSuccess: ({ publish }) =>
        toast.success(`Rewriting enabled — ${publish.verified} verified image(s) now served from the CDN.`),
      onError: (e) => toast.error((e as Error).message),
    })
  }

  const doDisableRewrite = () => {
    setKillConfirm(false)
    disableRewrite.mutate(undefined, {
      onSuccess: () => toast.success('Kill-switch on — all images now serve from their original WordPress URLs. Nothing was deleted.'),
      onError: (e) => toast.error((e as Error).message),
    })
  }

  const doConnectWebhook = () =>
    connectWebhook.mutate(undefined, {
      onSuccess: () => toast.success('Auto-optimize on upload connected — new images optimize instantly.'),
      onError: (e) => toast.error((e as Error).message),
    })
  const doDisconnectWebhook = () =>
    disconnectWebhook.mutate(undefined, {
      onSuccess: () => toast.success('Auto-optimize on upload disconnected.'),
      onError: (e) => toast.error((e as Error).message),
    })
  const toggleAutopilot = () =>
    updateConfig.mutate({ autopilotEnabled: !config?.autopilotEnabled }, {
      onSuccess: () => toast.success('Automation saved'),
      onError: (e) => toast.error((e as Error).message),
    })
  const doRunAutopilot = () =>
    runAutopilot.mutate(undefined, {
      onSuccess: (r) =>
        toast.success(r.skipped ? `Autopilot skipped: ${r.skipped}` : `Autopilot: +${r.optimized ?? 0} optimized, ${r.skippedImages ?? 0} skipped`),
      onError: (e) => toast.error((e as Error).message),
    })

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
        <div className="flex items-center gap-2">
          {config && <RewriteBadge enabled={config.rewriteEnabled} liveCount={stats?.rewriteLiveCount ?? 0} />}
          {config && <R2StatusChip status={config.r2Status} />}
        </div>
      </div>

      {/* Safety card — persistent trust surface */}
      <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.04] px-4 py-3 mb-4 flex gap-3">
        <ShieldCheck className="size-4 text-emerald-300 mt-0.5 flex-shrink-0" />
        <p className="text-[12px] text-[#c9cdd4] leading-relaxed">
          <span className="text-emerald-300 font-medium">Images never disappear.</span>{' '}
          Optimized copies are uploaded to your private Cloudflare R2 bucket; your live site
          still serves the original WordPress URLs. URL rewriting (with a guaranteed fallback to
          the original) arrives in a later phase — nothing on the live site changes yet.
        </p>
      </div>

      {/* R2-down alert — pause uploads, existing data unaffected */}
      {config?.r2Status === 'failed' && (
        <div className="rounded-xl border border-amber-400/30 bg-amber-400/[0.06] px-4 py-3 mb-4 flex gap-3">
          <AlertTriangle className="size-4 text-amber-300 mt-0.5 flex-shrink-0" />
          <p className="text-[12px] text-[#e8d9b0] leading-relaxed">
            <span className="text-amber-300 font-medium">R2 is unreachable — uploads are paused.</span>{' '}
            {config.r2LastError}{' '}
            Local optimization still works and existing data is unaffected. Fix the credentials
            and re-test to resume uploads.
          </p>
        </div>
      )}

      {/* Connect R2 */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 mb-5">
        <div className="flex items-center gap-2 mb-1">
          <Cloud className="size-4" style={{ color: ACCENT }} />
          <h2 className="text-[13px] font-medium text-[#e8eaed]">Connect Cloudflare R2</h2>
          {config && <R2StatusChip status={config.r2Status} />}
        </div>
        <p className="text-[11px] text-[#9aa0a6] mb-3">
          One R2 Access Key/Secret is reused across your sites but stored per-site (encrypted at
          rest). Credentials are write-only — they’re never sent back to the browser.
        </p>

        {configLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4">
              <SecretInput
                label="Cloudflare Account ID"
                isSet={!!config?.r2AccountIdSet}
                value={r2Form.r2AccountId}
                onChange={(v) => setR2Form((f) => ({ ...f, r2AccountId: v }))}
                placeholder="e.g. a1b2c3…"
              />
              <SecretInput
                label="Cloudflare API token (R2: Edit)"
                isSet={!!config?.cfApiTokenSet}
                value={r2Form.cfApiToken}
                onChange={(v) => setR2Form((f) => ({ ...f, cfApiToken: v }))}
              />
              <SecretInput
                label="R2 Access Key ID"
                isSet={!!config?.r2AccessKeyIdSet}
                value={r2Form.r2AccessKeyId}
                onChange={(v) => setR2Form((f) => ({ ...f, r2AccessKeyId: v }))}
              />
              <SecretInput
                label="R2 Secret Access Key"
                isSet={!!config?.r2SecretSet}
                value={r2Form.r2Secret}
                onChange={(v) => setR2Form((f) => ({ ...f, r2Secret: v }))}
              />
            </div>

            <div className="flex justify-end mt-3">
              <Button size="sm" onClick={saveR2} disabled={updateR2.isPending}>
                {updateR2.isPending ? 'Saving…' : 'Save credentials'}
              </Button>
            </div>

            <div className="h-px bg-white/8 my-4" />

            <div className="flex items-end justify-between gap-3 flex-wrap">
              <div className="flex items-end gap-2">
                <div>
                  <Label className="text-[#e8eaed]">Bucket</Label>
                  <Input
                    value={bucketName}
                    onChange={(e) => setBucketName(e.target.value)}
                    placeholder={config?.r2Bucket ?? 'auto from domain'}
                    className="mt-1 w-56 h-8"
                  />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={doCreateBucket}
                  disabled={!canCreateBucket || createBucket.isPending}
                  title={canCreateBucket ? '' : 'Save Account ID + CF token first'}
                >
                  <Database className="size-4" />
                  {createBucket.isPending ? 'Creating…' : 'Create / reuse bucket'}
                </Button>
              </div>
              <div className="flex items-center gap-2">
                {config?.r2Bucket && (
                  <span className="text-[12px] text-[#9aa0a6]">
                    bucket: <span className="text-[#e8eaed]">{config.r2Bucket}</span>
                  </span>
                )}
                <Button
                  size="sm"
                  onClick={doTestR2}
                  disabled={!canTestR2 || testR2.isPending}
                  title={canTestR2 ? '' : 'Set keys and create a bucket first'}
                >
                  {testR2.isPending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                  {testR2.isPending ? 'Testing…' : 'Test connection'}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* CDN domain */}
      <div className={`rounded-xl border border-white/10 bg-white/[0.02] p-4 mb-5 ${!r2Verified ? 'opacity-60' : ''}`}>
        <div className="flex items-center gap-2 mb-1">
          <Globe className="size-4" style={{ color: ACCENT }} />
          <h2 className="text-[13px] font-medium text-[#e8eaed]">CDN custom domain</h2>
          {config && <DnsStatusChip status={config.dnsStatus} />}
        </div>
        <p className="text-[11px] text-[#9aa0a6] mb-3">
          {r2Verified
            ? 'Bind a domain (e.g. cdn.yoursite.com) to the R2 bucket. Cloudflare auto-provisions the DNS record + TLS — do not add a CNAME yourself.'
            : 'Verify the R2 connection above before provisioning a CDN domain.'}
        </p>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-[#e8eaed]">CDN domain</Label>
            <Input
              value={cdnForm.cdnDomain}
              onChange={(e) => setCdnForm((f) => ({ ...f, cdnDomain: e.target.value }))}
              placeholder={config?.cdnDomain ?? 'cdn.yoursite.com'}
              disabled={!r2Verified}
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-[#e8eaed]">Cloudflare Zone ID</Label>
            <Input
              value={cdnForm.cfZoneId}
              onChange={(e) => setCdnForm((f) => ({ ...f, cfZoneId: e.target.value }))}
              placeholder={config?.cfZoneId ?? 'zone id for that domain'}
              disabled={!r2Verified}
              className="mt-1"
            />
          </div>
        </div>

        {config?.dnsStatus === 'error' && config.dnsError && (
          <p className="text-[12px] text-red-300 mt-2">{config.dnsError}</p>
        )}

        <div className="flex items-center justify-between mt-3">
          <p className="text-[11px] text-[#9aa0a6]">
            Prefer manual? Add a proxied CNAME for the domain in Cloudflare, then poll status.
          </p>
          <div className="flex items-center gap-2">
            {dnsPending && (
              <span className="text-[12px] text-sky-300 inline-flex items-center gap-1">
                <Loader2 className="size-3.5 animate-spin" /> provisioning…
              </span>
            )}
            <Button
              size="sm"
              onClick={() => setProvisionConfirm(true)}
              disabled={!canProvision || provisionCdn.isPending}
            >
              <Link2 className="size-4" />
              {config?.cdnDomain ? 'Re-bind domain' : 'Create record'}
            </Button>
          </div>
        </div>
      </div>

      {/* Enable rewriting */}
      <div className={`rounded-xl border border-white/10 bg-white/[0.02] p-4 mb-5 ${!canEnableRewrite && !config?.rewriteEnabled ? 'opacity-60' : ''}`}>
        <div className="flex items-center gap-2 mb-1">
          <Power className="size-4" style={{ color: ACCENT }} />
          <h2 className="text-[13px] font-medium text-[#e8eaed]">Live URL rewriting</h2>
          {config && <RewriteBadge enabled={config.rewriteEnabled} liveCount={stats?.rewriteLiveCount ?? 0} />}
        </div>
        <p className="text-[11px] text-[#9aa0a6] mb-3">
          {canEnableRewrite || config?.rewriteEnabled
            ? 'The plugin rewrites an image URL ONLY when the CMS has a verified CDN copy for it — every other image keeps serving its original WordPress URL. The kill-switch reverts instantly and deletes nothing.'
            : 'Reachable once R2 is verified and the CDN domain is active.'}
        </p>

        <div className="flex items-center gap-2">
          {!config?.rewriteEnabled ? (
            <Button size="sm" onClick={doEnableRewrite} disabled={!canEnableRewrite || enableRewrite.isPending}>
              {enableRewrite.isPending ? <Loader2 className="size-4 animate-spin" /> : <Power className="size-4" />}
              Enable rewriting
            </Button>
          ) : (
            <>
              <Button size="sm" variant="outline" onClick={doEnableRewrite} disabled={enableRewrite.isPending}>
                <RefreshCw className="size-4" /> Re-publish verified maps
              </Button>
              <Button size="sm" variant="destructive" onClick={() => setKillConfirm(true)} disabled={disableRewrite.isPending}>
                <Power className="size-4" /> Kill-switch (disable)
              </Button>
            </>
          )}
          {config?.rewriteEnabled && (stats?.rewriteLiveCount ?? 0) === 0 && (
            <span className="text-[12px] text-amber-300">
              Enabled but 0 verified mappings — everything is still serving originals.
            </span>
          )}
        </div>
      </div>

      {/* Automation */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 mb-5">
        <div className="flex items-center gap-2 mb-2">
          <Zap className="size-4" style={{ color: ACCENT }} />
          <h2 className="text-[13px] font-medium text-[#e8eaed]">Automation</h2>
        </div>

        {/* Auto-optimize new uploads (webhook) */}
        <div className="flex items-center justify-between py-2">
          <div>
            <Label className="text-[#e8eaed]">Auto-optimize new uploads</Label>
            <p className="text-[11px] text-[#9aa0a6]">
              {config?.webhookConfigured && config?.webhookEnabled
                ? `Connected${config.webhookLastReceivedAt ? ` · last received ${new Date(config.webhookLastReceivedAt).toLocaleString()}` : ' · no uploads yet'}`
                : 'The plugin signals the CMS the moment an image is uploaded to WordPress.'}
            </p>
          </div>
          {config?.webhookEnabled ? (
            <Button size="sm" variant="outline" onClick={doDisconnectWebhook} disabled={disconnectWebhook.isPending}>
              Disconnect
            </Button>
          ) : (
            <Button size="sm" onClick={doConnectWebhook} disabled={!r2Verified || connectWebhook.isPending} title={r2Verified ? '' : 'Verify R2 first'}>
              Connect
            </Button>
          )}
        </div>

        <div className="h-px bg-white/8 my-1" />

        {/* Nightly autopilot */}
        <div className="flex items-center justify-between py-2">
          <div>
            <Label className="text-[#e8eaed]">Nightly autopilot</Label>
            <p className="text-[11px] text-[#9aa0a6]">
              Optimizes only NEW images each night — never re-touches already-optimized ones.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={doRunAutopilot} disabled={!r2Verified || runAutopilot.isPending}>
              {runAutopilot.isPending ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} Run now
            </Button>
            <Button
              size="sm"
              variant={config?.autopilotEnabled ? 'default' : 'outline'}
              onClick={toggleAutopilot}
              disabled={updateConfig.isPending}
            >
              {config?.autopilotEnabled ? 'On' : 'Off'}
            </Button>
          </div>
        </div>

        {runs && runs.length > 0 && (
          <>
            <div className="h-px bg-white/8 my-2" />
            <div className="text-[11px] uppercase tracking-wide text-[#9aa0a6] mb-2">Recent runs</div>
            <div className="space-y-1">
              {runs.slice(0, 5).map((r) => (
                <div key={r.id} className="flex items-center justify-between text-[12px]">
                  <span className="text-[#9aa0a6]">
                    {new Date(r.startedAt).toLocaleString()} · {r.triggeredBy} · {r.scope}
                  </span>
                  <span className="text-[#c9cdd4]">
                    <span className="text-emerald-300">{r.optimized}</span> opt · {r.skipped} skip ·{' '}
                    <span className="text-red-300">{r.failed}</span> fail · {formatBytes(r.bytesSavedSum)}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
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
                      {row.r2Uploaded && (
                        <span className="ml-1 text-[10px] text-emerald-300/80" title="Uploaded to R2">· R2</span>
                      )}
                      {row.rewriteLive && (
                        <span className="ml-1 text-[10px] text-emerald-300" title="Served from CDN (verified)">· CDN</span>
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

      {/* Confirm: provision CDN (external, slow to reverse) */}
      <ConfirmDialog
        open={provisionConfirm}
        onOpenChange={setProvisionConfirm}
        title="Create the CDN domain record?"
        confirmLabel="Create record"
        onConfirm={doProvision}
        busy={provisionCdn.isPending}
        body={
          <div className="space-y-2">
            <p>Cloudflare will bind this domain to your R2 bucket and auto-provision a proxied DNS record + TLS certificate:</p>
            <div className="rounded-lg bg-white/[0.03] border border-white/10 px-3 py-2 font-mono text-[12px] text-[#e8eaed]">
              CNAME {cdnForm.cdnDomain || 'cdn.yoursite.com'} → (R2 bucket {config?.r2Bucket ?? '—'})
            </div>
            <p className="text-amber-300/90 text-[12px]">
              This is an external change and can be slow to reverse. Nothing on your live site
              is affected until you separately enable rewriting.
            </p>
          </div>
        }
      />

      {/* Confirm: kill-switch */}
      <ConfirmDialog
        open={killConfirm}
        onOpenChange={setKillConfirm}
        title="Turn off URL rewriting?"
        confirmLabel="Disable rewriting"
        danger
        onConfirm={doDisableRewrite}
        busy={disableRewrite.isPending}
        body={
          <p>
            This disables optimization rewriting in the CMS and tells the plugin to stop
            rewriting URLs. Every image immediately serves from its original WordPress URL.
            <span className="text-emerald-300"> No files are deleted</span> — you can re-enable anytime.
          </p>
        }
      />
    </div>
  )
}
