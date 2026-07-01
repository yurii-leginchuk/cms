import { BarChart3, AlertTriangle } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { DeltaMetric } from './EffectCard'
import { useGa4Status, useGa4Summary, useGa4Series } from '@/hooks/useGa4'

/** Tiny inline conversions sparkline aligned to the range. */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null
  const max = Math.max(1, ...values)
  const w = 160, h = 28
  const step = w / (values.length - 1)
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * (h - 4) - 2).toFixed(1)}`).join(' ')
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline points={pts} fill="none" stroke="#34d399" strokeWidth={1.5} />
    </svg>
  )
}

/**
 * Organic-search business outcomes from GA4 for the selected range, current vs
 * the immediately-preceding equal period. Turns Impact from "rankings/clicks"
 * into "sessions, conversions, revenue" — honestly still correlation, read
 * against the change markers above, not proof of causation.
 */
export function Ga4OutcomesCard({
  siteId, from, to, prevFrom, prevTo,
}: {
  siteId: string
  from: string
  to: string
  prevFrom: string
  prevTo: string
}) {
  const { data: status, isLoading: statusLoading } = useGa4Status(siteId)
  const connected = status?.connected === true
  const cur = useGa4Summary(siteId, from, to, connected)
  const prev = useGa4Summary(siteId, prevFrom, prevTo, connected)
  const series = useGa4Series(siteId, from, to, connected)

  if (statusLoading) return <Skeleton className="h-24 w-full bg-white/5 rounded-xl" />
  if (!connected) {
    // Silent when simply not set up; a gentle hint only on access problems.
    if (status?.reason === 'access_denied' || status?.reason === 'error') {
      return (
        <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.04] px-4 py-3 flex items-start gap-2 text-[12px] text-[#e8eaed]">
          <AlertTriangle className="size-4 text-amber-400 mt-0.5 flex-shrink-0" />
          GA4 is connected but this property isn't accessible to the service account — add it as a Viewer in GA4 Access Management to see organic conversions here.
        </div>
      )
    }
    return null
  }

  const revenueTracked = (cur.data?.revenue ?? 0) > 0 || (prev.data?.revenue ?? 0) > 0
  const loading = cur.isLoading || prev.isLoading

  return (
    <div className="rounded-xl border border-white/8 bg-[#14161f] p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="size-4 text-emerald-400" />
          <span className="text-[13px] font-medium text-[#e8eaed]">Organic outcomes</span>
          <span className="text-[11px] text-[#9aa0a6]">GA4{status?.displayName ? ` · ${status.displayName}` : ''} · vs previous period</span>
        </div>
        {series.data && series.data.length > 1 && (
          <div className="flex items-center gap-1.5" title="Organic conversions per day">
            <span className="text-[10px] text-[#9aa0a6] uppercase tracking-wider">Conversions</span>
            <Sparkline values={series.data.map((p) => p.conversions)} />
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex gap-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 flex-1 bg-white/5" />)}</div>
      ) : (
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          <DeltaMetric label="Sessions" before={prev.data?.sessions ?? 0} after={cur.data?.sessions ?? 0} />
          <DeltaMetric label="Conversions" before={prev.data?.conversions ?? 0} after={cur.data?.conversions ?? 0} />
          {revenueTracked && (
            <DeltaMetric label="Revenue" before={prev.data?.revenue ?? 0} after={cur.data?.revenue ?? 0} decimals={2} />
          )}
          <DeltaMetric label="Users" before={prev.data?.users ?? 0} after={cur.data?.users ?? 0} />
        </div>
      )}
      <p className="text-[11px] text-[#9aa0a6]/70 mt-2">
        Organic Search channel. Read these against the change markers above — movement here is correlation over the period, not proof any single change caused it.
      </p>
    </div>
  )
}
