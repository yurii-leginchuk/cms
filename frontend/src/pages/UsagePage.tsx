import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Coins, TrendingUp, Cpu, Calendar, AlertTriangle, Zap } from 'lucide-react'
import { tokenUsageApi, UsageStats } from '@/api/tokenUsage'

const DAYS_OPTIONS = [
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
]

const FEATURE_LABELS: Record<string, string> = {
  meta_generation: 'Meta Generation',
  agent_chat: 'Agent Chat',
  jina_scraping: 'Jina Scraping',
}

function formatCost(usd: number): string {
  if (usd < 0.001) return '< $0.001'
  return `$${usd.toFixed(4)}`
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function StatCard({ icon: Icon, label, value, sub }: {
  icon: React.ElementType
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="rounded-xl border border-white/8 bg-[#1a1d27] p-5 flex flex-col gap-2">
      <div className="flex items-center gap-2 text-[#9aa0a6] text-[13px]">
        <Icon className="size-4" />
        {label}
      </div>
      <div className="text-2xl font-semibold text-[#e8eaed]">{value}</div>
      {sub && <div className="text-[12px] text-[#9aa0a6]">{sub}</div>}
    </div>
  )
}

function BreakdownTable({ rows, keyLabel, keyAccessor }: {
  rows: { tokens: number; costUsd: number; calls: number }[]
  keyLabel: string
  keyAccessor: (r: any) => string
}) {
  if (rows.length === 0) {
    return <div className="text-[13px] text-[#9aa0a6] py-4 text-center">No data</div>
  }
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr className="border-b border-white/8 text-[#9aa0a6]">
          <th className="text-left pb-2 font-normal">{keyLabel}</th>
          <th className="text-right pb-2 font-normal">Calls</th>
          <th className="text-right pb-2 font-normal">Tokens</th>
          <th className="text-right pb-2 font-normal">Cost</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r: any, i) => (
          <tr key={i} className="border-b border-white/5 last:border-0">
            <td className="py-2 text-[#e8eaed]">{keyAccessor(r)}</td>
            <td className="py-2 text-right text-[#9aa0a6]">{r.calls}</td>
            <td className="py-2 text-right text-[#9aa0a6]">{formatTokens(r.tokens)}</td>
            <td className="py-2 text-right text-[#e8eaed] font-medium">{formatCost(r.costUsd)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function JinaQuotaCard({ quota }: { quota: UsageStats['jinaQuota'] }) {
  if (!quota) {
    return (
      <div className="rounded-xl border border-white/8 bg-[#1a1d27] p-5">
        <div className="flex items-center gap-2 text-[#e8eaed] text-[14px] font-medium mb-3">
          <Zap className="size-4 text-amber-400" />
          Jina Reader API
        </div>
        <p className="text-[13px] text-[#9aa0a6]">
          No quota data yet. Add your Jina API key in Settings and run a crawl, and it'll show up here.
        </p>
      </div>
    )
  }

  const pct = quota.limit > 0 ? (quota.remaining / quota.limit) * 100 : 0
  const LOW_THRESHOLD = 1_000_000
  const isLow = quota.remaining < LOW_THRESHOLD

  let barColor = 'bg-emerald-500'
  if (pct < 10) barColor = 'bg-red-500'
  else if (pct < 25) barColor = 'bg-amber-500'

  return (
    <div className={`rounded-xl border bg-[#1a1d27] p-5 ${isLow ? 'border-amber-500/40' : 'border-white/8'}`}>
      <div className="flex items-center gap-2 text-[#e8eaed] text-[14px] font-medium mb-1">
        <Zap className="size-4 text-amber-400" />
        Jina Reader API
        <span className="ml-auto text-[12px] font-normal text-[#9aa0a6]">
          {formatTokens(quota.remaining)} / {formatTokens(quota.limit)} remaining
        </span>
      </div>

      {isLow && (
        <div className="flex items-center gap-2 text-[12px] text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 mb-3">
          <AlertTriangle className="size-3.5 flex-shrink-0" />
          Running low - under {formatTokens(LOW_THRESHOLD)} tokens left. Add another API key in Settings to keep going.
        </div>
      )}

      <div className="mt-3 h-2.5 rounded-full bg-white/8 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${Math.max(pct, 0.5)}%` }}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-[#9aa0a6]">
        <span>{pct.toFixed(1)}% remaining</span>
        <span>Free tier: {formatTokens(quota.limit)}</span>
      </div>
    </div>
  )
}

function DailyBar({ daily }: { daily: UsageStats['daily'] }) {
  if (daily.length === 0) {
    return <div className="text-[13px] text-[#9aa0a6] py-4 text-center">No data</div>
  }
  const maxCost = Math.max(...daily.map((d) => d.costUsd), 0.0001)
  return (
    <div className="space-y-1.5">
      {daily.slice().reverse().map((d) => (
        <div key={d.date} className="flex items-center gap-3 text-[13px]">
          <span className="text-[#9aa0a6] w-24 flex-shrink-0">{d.date}</span>
          <div className="flex-1 h-5 bg-white/5 rounded overflow-hidden">
            <div
              className="h-full bg-[#4e8af4]/60 rounded transition-all"
              style={{ width: `${(d.costUsd / maxCost) * 100}%` }}
            />
          </div>
          <span className="text-[#e8eaed] w-20 text-right flex-shrink-0">{formatCost(d.costUsd)}</span>
          <span className="text-[#9aa0a6] w-16 text-right flex-shrink-0">{formatTokens(d.tokens)}</span>
        </div>
      ))}
    </div>
  )
}

export default function UsagePage() {
  const [days, setDays] = useState(30)

  const { data: stats, isLoading } = useQuery<UsageStats>({
    queryKey: ['token-usage', days],
    queryFn: () => tokenUsageApi.getStats({ days }),
  })

  return (
    <div className="min-h-full">
      <div className="border-b border-white/8 px-8 py-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#e8eaed] tracking-tight">Token Usage</h1>
          <p className="text-[13px] text-[#9aa0a6] mt-1">What the AI has used and roughly what it cost.</p>
        </div>
        <div className="flex gap-1 bg-white/5 rounded-lg p-1">
          {DAYS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setDays(opt.value)}
              className={`px-3 py-1.5 rounded-md text-[13px] transition-colors ${
                days === opt.value
                  ? 'bg-[#4e8af4]/20 text-[#4e8af4]'
                  : 'text-[#9aa0a6] hover:text-[#e8eaed]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-8 py-6 max-w-4xl space-y-6">
        {isLoading ? (
          <div className="text-[#9aa0a6] text-[13px]">Loading…</div>
        ) : stats ? (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-3 gap-4">
              <StatCard
                icon={Coins}
                label="Total Cost"
                value={formatCost(stats.totalCostUsd)}
              />
              <StatCard
                icon={TrendingUp}
                label="Total Tokens"
                value={formatTokens(stats.totalTokens)}
              />
              <StatCard
                icon={Cpu}
                label="Total Calls"
                value={String(stats.byFeature.reduce((s, f) => s + f.calls, 0))}
              />
            </div>

            {/* By feature */}
            <div className="rounded-xl border border-white/8 bg-[#1a1d27] p-5">
              <h2 className="text-[14px] font-medium text-[#e8eaed] mb-4">By Feature</h2>
              <BreakdownTable
                rows={stats.byFeature}
                keyLabel="Feature"
                keyAccessor={(r) => FEATURE_LABELS[r.feature] ?? r.feature}
              />
            </div>

            {/* By model */}
            <div className="rounded-xl border border-white/8 bg-[#1a1d27] p-5">
              <h2 className="text-[14px] font-medium text-[#e8eaed] mb-4">By Model</h2>
              <BreakdownTable
                rows={stats.byModel}
                keyLabel="Model"
                keyAccessor={(r) => r.model}
              />
            </div>

            {/* Daily */}
            <div className="rounded-xl border border-white/8 bg-[#1a1d27] p-5">
              <div className="flex items-center gap-2 text-[#e8eaed] text-[14px] font-medium mb-4">
                <Calendar className="size-4" />
                Daily Breakdown
              </div>
              <DailyBar daily={stats.daily} />
            </div>

            {/* Jina quota */}
            <JinaQuotaCard quota={stats.jinaQuota} />
          </>
        ) : null}
      </div>
    </div>
  )
}
