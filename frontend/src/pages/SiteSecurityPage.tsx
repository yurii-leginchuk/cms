import { Link, useParams, Navigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ChevronRight, Shield, ShieldCheck, Play, Loader2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useSite } from '@/hooks/useSites'
import { useSecurityOverview, useSecurityProgress, useSecurityIncidents, useScanNow } from '@/hooks/useSecurity'
import { SecurityHealthBadge } from '@/components/SecurityHealthBadge'
import { SecurityIncidentCard } from '@/components/SecurityIncidentCard'

function timeAgo(iso: string | null): string {
  if (!iso) return 'never'
  const diff = Date.now() - new Date(iso).getTime()
  const h = Math.floor(diff / 3_600_000)
  if (h < 1) return 'under an hour ago'
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function SiteSecurityPage() {
  const { id } = useParams<{ id: string }>()
  const { data: site, isLoading: siteLoading } = useSite(id!)
  const { data: overview, isLoading } = useSecurityOverview(id!)
  const isRunning = overview?.isRunning ?? false
  const { data: progress } = useSecurityProgress(id!, isRunning)
  const { data: incidents } = useSecurityIncidents(id!)
  const scanNow = useScanNow(id!)

  if (!id) return <Navigate to="/sites" replace />

  const runScan = () =>
    scanNow.mutate(undefined, {
      onSuccess: (r) => {
        if (r.queued === 0) toast.info('No pages to scan yet — parse the site first')
        else toast.success(`Scanning ${r.queued} page(s)…`)
      },
      onError: (e) => toast.error((e as Error)?.message ?? 'Scan failed'),
    })

  const open = (incidents ?? []).filter((i) => ['open', 'confirmed', 'snoozed'].includes(i.status))
  const triaged = (incidents ?? []).filter((i) => !['open', 'confirmed', 'snoozed'].includes(i.status))
  const staleScan = overview?.lastScanAt
    ? Date.now() - new Date(overview.lastScanAt).getTime() > 36 * 3_600_000
    : false

  return (
    <div>
      {/* Header */}
      <div className="px-8 pt-8 pb-4 border-b border-white/8">
        <div className="flex items-center gap-2 text-[13px] mb-4">
          <Link to="/sites" className="text-[#9aa0a6] hover:text-[#e8eaed]">Sites</Link>
          <ChevronRight className="size-3.5 text-[#9aa0a6]/40" />
          <Link to={`/sites/${id}`} className="text-[#9aa0a6] hover:text-[#e8eaed]">
            {siteLoading ? <Skeleton className="h-4 w-24 bg-white/5 inline-block" /> : site?.name}
          </Link>
          <ChevronRight className="size-3.5 text-[#9aa0a6]/40" />
          <span className="text-[#e8eaed]">Security</span>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-[#e8eaed] tracking-tight flex items-center gap-2">
              <Shield className="size-5 text-[#4e8af4]" />
              Cloaking & Hacked-site Detection
            </h1>
            <p className="text-[13px] text-[#9aa0a6] mt-1">
              Nightly compares what Googlebot sees vs. what visitors see, to catch cloaking and injected spam
            </p>
          </div>
          <Button
            size="sm"
            className="h-9 text-[13px] bg-[#4e8af4] text-white hover:bg-[#4e8af4]/90"
            disabled={scanNow.isPending || isRunning}
            onClick={runScan}
          >
            {scanNow.isPending || isRunning ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
            {isRunning ? 'Scanning…' : 'Scan now'}
          </Button>
        </div>
      </div>

      <div className="px-8 py-6 space-y-5">
        {/* Health header */}
        {isLoading ? (
          <Skeleton className="h-20 bg-white/5 rounded-xl" />
        ) : (
          <div className="rounded-xl border border-white/8 bg-[#1a1d27] px-5 py-4 flex items-center gap-5 flex-wrap">
            {overview && <SecurityHealthBadge health={overview.health} />}
            {overview?.health === 'never_scanned' ? (
              <span className="text-[13px] text-[#9aa0a6]">
                No scan has run yet — “not scanned” is not the same as “safe”. Run the first scan to establish a baseline.
              </span>
            ) : isRunning ? (
              <span className="text-[13px] text-amber-400">
                Scanning {progress?.completed ?? 0}/{progress?.total ?? 0} pages…
              </span>
            ) : (
              <div className="text-[13px] text-[#9aa0a6] flex items-center gap-4 flex-wrap">
                <span>Last scan {timeAgo(overview?.lastScanAt ?? null)}</span>
                <span>{overview?.pagesScanned ?? 0}/{overview?.pagesTotal ?? 0} pages</span>
                <span>{overview?.openIncidents ?? 0} open incident(s)</span>
                {!!overview?.pagesUnreachable && (
                  <span className="text-amber-400 flex items-center gap-1">
                    <AlertTriangle className="size-3.5" />
                    {overview.pagesUnreachable} unreachable
                  </span>
                )}
                {staleScan && <span className="text-amber-400/80">⚠ last scan is over 36h old</span>}
              </div>
            )}
          </div>
        )}

        {/* Incident queue */}
        {!isLoading && overview?.health === 'never_scanned' ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Shield className="size-8 text-[#9aa0a6]/30" />
            <p className="text-[13px] text-[#9aa0a6]/70">Run the first scan to start monitoring this site.</p>
            <Button size="sm" disabled={scanNow.isPending} onClick={runScan}
              className="h-9 bg-[#4e8af4] text-white hover:bg-[#4e8af4]/90">
              <Play className="size-3.5" /> Run first scan
            </Button>
          </div>
        ) : open.length === 0 && triaged.length === 0 ? (
          !isLoading && (
            <div className="flex flex-col items-center justify-center py-16 gap-2">
              <ShieldCheck className="size-8 text-emerald-400/40" />
              <p className="text-[13px] text-[#9aa0a6]/70">No security incidents detected.</p>
            </div>
          )
        ) : (
          <div className="space-y-5">
            {open.length > 0 && (
              <div className="space-y-2">
                <p className="text-[12px] text-[#9aa0a6] uppercase tracking-wide">Needs review ({open.length})</p>
                {open.map((inc) => <SecurityIncidentCard key={inc.id} siteId={id} incident={inc} />)}
              </div>
            )}
            {triaged.length > 0 && (
              <div className="space-y-2">
                <p className="text-[12px] text-[#9aa0a6] uppercase tracking-wide">Triaged ({triaged.length})</p>
                {triaged.map((inc) => <SecurityIncidentCard key={inc.id} siteId={id} incident={inc} />)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
