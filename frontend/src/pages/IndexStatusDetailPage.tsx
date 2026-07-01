import { useParams, Link, Navigate } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'
import {
  ChevronRight, ChevronLeft, ExternalLink, ScanSearch, RefreshCw,
  AlertTriangle, Tag, Copy, Clock,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useCrawlPage, useCrawlHistory, useInspectPages } from '@/hooks/useCrawl'
import type { CrawlHistoryEntry } from '@/api/crawl'
import { IndexStatusChip } from '@/components/index-status/IndexStatusChip'
import { statusMeta } from '@/components/index-status/statusMeta'
import { RelativeClock } from '@/components/index-status/RelativeClock'

export default function IndexStatusDetailPage() {
  const { id, pageId } = useParams<{ id: string; pageId: string }>()
  const { data: detail, isLoading } = useCrawlPage(id, pageId)
  const { data: history } = useCrawlHistory(id, pageId)
  const inspect = useInspectPages(id!)

  if (!id || !pageId) return <Navigate to="/sites" replace />

  const status = detail?.status
  const path = detail ? detail.url.replace(/^https?:\/\/[^/]+/, '') || '/' : ''

  async function reinspect() {
    try {
      const res = await inspect.mutateAsync([pageId!])
      const r = res.results[0]
      if (r?.ok) toast.success(r.changed ? 'Re-inspected — state changed.' : 'Re-inspected — no change.')
      else toast.warning(r?.error === 'daily_quota_exhausted' ? 'Daily inspection quota is spent — try tomorrow.' : `Inspection failed: ${r?.error ?? 'unknown'}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't re-inspect.")
    }
  }

  return (
    <div className="min-h-full">
      {/* Header */}
      <div className="border-b border-white/8 px-8 py-5">
        <div className="flex items-center gap-1.5 text-[13px] mb-3">
          <Link to="/sites" className="text-[#9aa0a6] hover:text-[#e8eaed] flex items-center gap-1">
            <ChevronLeft className="size-3.5" />Sites
          </Link>
          <ChevronRight className="size-3.5 text-[#9aa0a6]/40" />
          <Link to={`/sites/${id}/index-status`} className="text-[#9aa0a6] hover:text-[#e8eaed]">Index Status</Link>
          <ChevronRight className="size-3.5 text-[#9aa0a6]/40" />
          <span className="text-[#e8eaed] truncate max-w-[360px]" title={path}>{path}</span>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <ScanSearch className="size-5 text-[#4e8af4] flex-shrink-0" />
            {isLoading ? (
              <Skeleton className="h-6 w-72 bg-white/5" />
            ) : (
              <>
                <a href={detail?.url} target="_blank" rel="noopener noreferrer" className="text-[15px] text-[#e8eaed] hover:text-[#4e8af4] truncate max-w-[420px] flex items-center gap-1.5">
                  {path}<ExternalLink className="size-3.5 opacity-50" />
                </a>
                <IndexStatusChip status={status?.derivedStatus} />
                {detail?.isTransactional && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-[#4e8af4]/70"><Tag className="size-2.5" />transactional</span>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button size="sm" onClick={reinspect} disabled={inspect.isPending} className="h-8 px-3 text-[13px] bg-[#4e8af4] hover:bg-[#4e8af4]/90 text-white gap-1.5 disabled:opacity-60">
              {inspect.isPending ? <RefreshCw className="size-3.5 animate-spin" /> : <ScanSearch className="size-3.5" />}
              Re-inspect (spends 1)
            </Button>
            {detail?.latest?.inspectionResultLink && (
              <a href={detail.latest.inspectionResultLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-white/10 text-[12px] text-[#9aa0a6] hover:text-[#e8eaed]">
                Open in GSC <ExternalLink className="size-3" />
              </a>
            )}
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="px-8 py-6"><Skeleton className="h-40 w-full bg-white/5 rounded-xl" /></div>
      ) : !status ? (
        <div className="px-8 py-10">
          <div className="rounded-xl border border-white/8 bg-[#1a1d27]/60 px-6 py-8 text-center">
            <Clock className="size-8 text-[#9aa0a6] mx-auto mb-3" />
            <p className="text-[#e8eaed] text-sm font-medium">Never checked</p>
            <p className="text-[#9aa0a6] text-[13px] mt-1">
              This page hasn't been inspected yet — "never checked" is not "not indexed". Re-inspect
              now to pull its live index status from Google.
            </p>
          </div>
        </div>
      ) : (
        <div className="px-8 py-6 space-y-6 max-w-4xl">
          {/* Two clocks — never merged */}
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl border border-white/8 bg-[#1a1d27]/60 px-5 py-4">
              <p className="text-[11px] uppercase tracking-widest text-[#9aa0a6]">Google last crawled</p>
              <p className="text-[15px] text-[#e8eaed] mt-1.5">
                {status.googleLastCrawlTime ? formatDistanceToNow(new Date(status.googleLastCrawlTime), { addSuffix: true }) : 'Not reported'}
              </p>
              <p className="text-[11px] text-[#9aa0a6]/70 mt-1">
                {status.googleLastCrawlTime ? new Date(status.googleLastCrawlTime).toLocaleString() : '—'} · Google's clock
              </p>
            </div>
            <div className="rounded-xl border border-white/8 bg-[#1a1d27]/60 px-5 py-4">
              <p className="text-[11px] uppercase tracking-widest text-[#9aa0a6]">We last checked</p>
              <p className="text-[15px] text-[#e8eaed] mt-1.5">
                {status.lastInspectedAt ? formatDistanceToNow(new Date(status.lastInspectedAt), { addSuffix: true }) : '—'}
              </p>
              <p className="text-[11px] text-[#9aa0a6]/70 mt-1">
                {status.lastInspectedAt ? new Date(status.lastInspectedAt).toLocaleString() : '—'} · freshness of this data
              </p>
            </div>
          </div>

          {status.lastError && (
            <div className="rounded-lg border border-red-400/20 bg-red-400/[0.04] px-4 py-2.5 text-[12px] text-red-300 flex items-center gap-2">
              <AlertTriangle className="size-3.5" />Last inspection attempt failed: {status.lastError}
            </div>
          )}

          {/* Status + raw Google enums (the trust substrate) */}
          <div className="rounded-xl border border-white/8 overflow-hidden">
            <div className="px-5 py-3 bg-[#1a1d27] border-b border-white/8 flex items-center justify-between">
              <span className="text-[13px] text-[#e8eaed] flex items-center gap-2">Our status: <IndexStatusChip status={status.derivedStatus} /></span>
              <button
                onClick={() => { navigator.clipboard.writeText(JSON.stringify(detail?.latest?.rawPayload ?? {}, null, 2)); toast.success('Raw payload copied') }}
                className="inline-flex items-center gap-1.5 text-[11px] text-[#9aa0a6] hover:text-[#e8eaed]"
              >
                <Copy className="size-3" />Copy raw JSON
              </button>
            </div>
            <div className="px-5 py-4 grid grid-cols-2 gap-x-8 gap-y-2.5 text-[12px]">
              <RawRow label="coverageState" value={status.coverageStateRaw} loud={status.derivedStatus === 'unknown'} />
              <RawRow label="verdict" value={status.verdict} />
              <RawRow label="indexingState" value={status.indexingState} />
              <RawRow label="robotsTxtState" value={status.robotsTxtState} />
              <RawRow label="pageFetchState" value={status.pageFetchState} />
              <RawRow label="crawledAs" value={status.crawledAs} />
            </div>
          </div>

          {/* Canonical */}
          <div className={`rounded-xl border px-5 py-4 ${status.canonicalConflict ? 'border-amber-400/30 bg-amber-400/[0.04]' : 'border-white/8 bg-[#1a1d27]/60'}`}>
            <p className="text-[11px] uppercase tracking-widest text-[#9aa0a6] mb-3 flex items-center gap-1.5">
              Canonical {status.canonicalConflict && <span className="text-amber-400 inline-flex items-center gap-1"><AlertTriangle className="size-3" />conflict</span>}
            </p>
            <div className="space-y-2 text-[12px]">
              <div className="flex gap-3">
                <span className="text-[#9aa0a6] w-32 flex-shrink-0">You declared</span>
                <span className="text-[#e8eaed] break-all">{detail?.declaredCanonical || status.userCanonical || <span className="text-[#9aa0a6]/40">none</span>}</span>
              </div>
              <div className="flex gap-3">
                <span className="text-[#9aa0a6] w-32 flex-shrink-0">Google selected</span>
                <span className={`break-all ${status.canonicalConflict ? 'text-amber-300' : 'text-[#e8eaed]'}`}>{status.googleCanonical || <span className="text-[#9aa0a6]/40">none</span>}</span>
              </div>
            </div>
            <Link to={`/sites/${id}/meta/${pageId}`} className="inline-flex items-center gap-1 mt-3 text-[12px] text-[#4e8af4] hover:text-[#4e8af4]/80">
              Edit Meta <ChevronRight className="size-3" />
            </Link>
          </div>

          {/* History */}
          <div className="rounded-xl border border-white/8 bg-[#1a1d27]/60 px-5 py-4">
            <p className="text-[11px] uppercase tracking-widest text-[#9aa0a6] mb-3">State changes (we checked)</p>
            {!history || history.length === 0 ? (
              <p className="text-[13px] text-[#9aa0a6]/70">No recorded changes yet.</p>
            ) : (
              <ul className="space-y-2.5">
                {history.map((h) => <HistoryRow key={h.id} h={h} />)}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function RawRow({ label, value, loud }: { label: string; value: string | null; loud?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[#9aa0a6] font-mono">{label}</span>
      <span className={`font-mono ${loud ? 'text-violet-300' : 'text-[#e8eaed]'} break-all`}>{value ?? <span className="text-[#9aa0a6]/40">—</span>}</span>
    </div>
  )
}

function HistoryRow({ h }: { h: CrawlHistoryEntry }) {
  const m = statusMeta(h.derivedStatus)
  return (
    <li className="flex items-start gap-3 text-[12px]">
      <span className={`size-2 rounded-full mt-1.5 flex-shrink-0 ${m.dot} ${h.isDeindexation ? 'ring-2 ring-red-400/50' : ''}`} />
      <div>
        <span className="text-[#e8eaed]">{m.label}</span>
        {h.isFirstSeen && <span className="ml-2 text-[10px] text-[#9aa0a6]">first seen</span>}
        {h.isDeindexation && <span className="ml-2 text-[10px] text-red-400">deindexed</span>}
        {h.coverageStateRaw && <span className="ml-2 text-[#9aa0a6]/60 font-mono">{h.coverageStateRaw}</span>}
        <span className="block text-[11px] text-[#9aa0a6]/70">
          <RelativeClock ts={h.observedAt} />
        </span>
      </div>
    </li>
  )
}
