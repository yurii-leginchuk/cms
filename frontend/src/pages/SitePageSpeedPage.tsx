import { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ExternalLink } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Cell, Legend,
} from 'recharts'
import {
  usePsiProgress, usePsiStats, usePsiResults,
  usePsiPageHistory, useTriggerScan,
} from '../hooks/usePageSpeed'
import { useCruxProgress, useCruxStats, useCruxResults, useTriggerCruxFetch } from '../hooks/useCrux'
import { pagespeedApi, PsiStrategy, PsiScanMode, PsiCategory, PsiHistoryPoint, AuditIssue } from '../api/pagespeed'
import { CruxMetrics, CwvCategory } from '../api/crux'

// ── Helpers ────────────────────────────────────────────────────────────────

const CAT_COLOR: Record<PsiCategory, string> = {
  good: '#34a853',
  needs_improvement: '#fbbc04',
  poor: '#ea4335',
}
const CAT_LABEL: Record<PsiCategory, string> = {
  good: 'Good',
  needs_improvement: 'Needs Improvement',
  poor: 'Poor',
}

function scoreColor(score: number) {
  if (score >= 90) return '#34a853'
  if (score >= 50) return '#fbbc04'
  return '#ea4335'
}

function fmtMs(ms: number | null) {
  if (ms == null) return '-'
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
  return `${ms}ms`
}

function fmtCls(cls: number | null) {
  if (cls == null) return '-'
  return cls.toFixed(3)
}

// Google PageSpeed Insights deep-link for a given page URL
function psiInsightsUrl(url: string) {
  return `https://pagespeed.web.dev/analysis?url=${encodeURIComponent(url)}`
}

function ScoreBadge({ score }: { score: number }) {
  return (
    <span
      className="inline-flex items-center justify-center w-10 h-10 rounded-full text-sm font-bold"
      style={{ background: scoreColor(score) + '22', color: scoreColor(score), border: `2px solid ${scoreColor(score)}` }}
    >
      {score}
    </span>
  )
}

function CategoryChip({ category }: { category: PsiCategory }) {
  return (
    <span
      className="inline-block px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ background: CAT_COLOR[category] + '22', color: CAT_COLOR[category] }}
    >
      {CAT_LABEL[category]}
    </span>
  )
}

// ── Page history drawer ────────────────────────────────────────────────────

function PageHistoryDrawer({
  siteId, pageId, url, strategy, onClose,
}: {
  siteId: string; pageId: string; url: string; strategy: PsiStrategy; onClose: () => void
}) {
  const { data: history = [], isLoading } = usePsiPageHistory(siteId, pageId, strategy)

  const chartData = [...history].reverse().map((h: PsiHistoryPoint) => ({
    date: new Date(h.fetchedAt).toLocaleDateString('en', { month: 'short', day: 'numeric' }),
    score: h.performanceScore,
    lcp: h.lcp ? Math.round(h.lcp / 100) / 10 : null,
    fcp: h.fcp ? Math.round(h.fcp / 100) / 10 : null,
    cls: h.cls ? parseFloat(h.cls.toFixed(3)) : null,
    tbt: h.tbt,
  }))

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-[#1a1d2e] h-full overflow-y-auto shadow-2xl flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-white/8">
          <div>
            <div className="text-xs text-[#9aa0a6] mb-1">Page history</div>
            <div className="text-sm font-medium text-white truncate max-w-md">{url}</div>
          </div>
          <button onClick={onClose} className="text-[#9aa0a6] hover:text-white text-xl leading-none">×</button>
        </div>

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center text-[#9aa0a6]">Loading…</div>
        ) : history.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-[#9aa0a6]">No data yet</div>
        ) : (
          <div className="p-5 space-y-6">
            {/* Score trend */}
            <div>
              <div className="text-xs font-medium text-[#9aa0a6] uppercase tracking-wider mb-3">Performance Score</div>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9aa0a6' }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#9aa0a6' }} />
                  <Tooltip
                    contentStyle={{ background: '#1a1d2e', border: '1px solid #ffffff20', borderRadius: 8 }}
                    labelStyle={{ color: '#e8eaed' }}
                  />
                  <Line
                    type="monotone" dataKey="score" stroke="#4285f4" strokeWidth={2}
                    dot={(props: any) => {
                      const { cx, cy, payload } = props
                      return <circle key={payload.date} cx={cx} cy={cy} r={4} fill={scoreColor(payload.score)} stroke="none" />
                    }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* CWV trends */}
            <div>
              <div className="text-xs font-medium text-[#9aa0a6] uppercase tracking-wider mb-3">Core Web Vitals (seconds / score)</div>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9aa0a6' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#9aa0a6' }} />
                  <Tooltip
                    contentStyle={{ background: '#1a1d2e', border: '1px solid #ffffff20', borderRadius: 8 }}
                    labelStyle={{ color: '#e8eaed' }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="lcp" stroke="#fbbc04" strokeWidth={2} dot={false} name="LCP (s)" />
                  <Line type="monotone" dataKey="fcp" stroke="#34a853" strokeWidth={2} dot={false} name="FCP (s)" />
                  <Line type="monotone" dataKey="cls" stroke="#ea4335" strokeWidth={2} dot={false} name="CLS" />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* History table */}
            <div>
              <div className="text-xs font-medium text-[#9aa0a6] uppercase tracking-wider mb-3">All Scans</div>
              <div className="space-y-2">
                {history.map((h: PsiHistoryPoint) => (
                  <div key={h.id} className="flex items-center gap-3 rounded-lg bg-white/4 px-3 py-2.5">
                    <ScoreBadge score={h.performanceScore} />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-[#9aa0a6]">
                        {new Date(h.fetchedAt).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </div>
                      <div className="flex gap-3 mt-1 text-xs text-[#e8eaed]">
                        <span>LCP {fmtMs(h.lcp)}</span>
                        <span>FCP {fmtMs(h.fcp)}</span>
                        <span>CLS {fmtCls(h.cls)}</span>
                        <span>TBT {fmtMs(h.tbt)}</span>
                      </div>
                    </div>
                    <CategoryChip category={h.category} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── CrUX metric cell ───────────────────────────────────────────────────────

const CAT_TEXT: Record<string, string> = {
  good: 'text-emerald-400',
  needs_improvement: 'text-yellow-400',
  poor: 'text-red-400',
}

function fmtCrux(field: string, m: CruxMetrics): string {
  const v = m[`${field}P75` as keyof CruxMetrics] as number | null
  if (v == null) return '-'
  if (field === 'cls') return v.toFixed(3)
  if (v >= 1000) return `${(v / 1000).toFixed(1)}s`
  return `${v}ms`
}

function CruxMetricCell({
  m, field, border,
}: { m: CruxMetrics | null; field: 'lcp' | 'cls' | 'inp' | 'fcp'; border?: boolean }) {
  const cls = border ? 'border-l border-white/8' : ''
  if (!m || !m.hasData) {
    return <td className={`px-3 py-2.5 text-[#9aa0a6]/40 ${cls}`}>-</td>
  }
  const cat = m[`${field}Category` as keyof CruxMetrics] as CwvCategory
  const color = cat ? CAT_TEXT[cat] : 'text-[#9aa0a6]'
  return (
    <td className={`px-3 py-2.5 font-medium ${color} ${cls}`}>
      {fmtCrux(field, m)}
    </td>
  )
}

// ── Run Scan dropdown ──────────────────────────────────────────────────────

function RunScanButton({
  isRunning, isPending, onScan,
}: {
  isRunning: boolean; isPending: boolean; onScan: (mode: PsiScanMode) => void
}) {
  const [open, setOpen] = useState(false)
  const disabled = isRunning || isPending

  const choose = (mode: PsiScanMode) => {
    setOpen(false)
    onScan(mode)
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-[#4285f4] hover:bg-[#3b78e7] text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isRunning ? (
          <>
            <span className="inline-block w-3 h-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />
            Scanning…
          </>
        ) : (
          <>
            Run Scan
            <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
          </>
        )}
      </button>

      {open && !disabled && (
        <>
          {/* Click-outside backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 z-50 w-64 rounded-lg bg-[#232635] border border-white/8 shadow-2xl overflow-hidden py-1">
            <button
              onClick={() => choose('all')}
              className="w-full text-left px-3 py-2 text-sm text-[#e8eaed] hover:bg-white/6 transition-colors"
            >
              Scan all pages
            </button>
            <button
              onClick={() => choose('needs_improvement')}
              className="w-full text-left px-3 py-2 text-sm text-[#e8eaed] hover:bg-white/6 transition-colors"
            >
              Scan pages that need improvement
              <span className="block text-xs text-[#9aa0a6] mt-0.5">Anything scoring below 90</span>
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function SitePageSpeedPage() {
  const { id: siteId = '' } = useParams<{ id: string }>()
  const [strategy, setStrategy] = useState<PsiStrategy>('mobile')
  const [selectedPage, setSelectedPage] = useState<{ pageId: string; url: string } | null>(null)
  const [audits, setAudits] = useState<Record<string, { status: 'loading' | 'done' | 'error'; issues?: AuditIssue[]; error?: string }>>({})

  const analyzeRow = async (pageId: string) => {
    setAudits((prev) => ({ ...prev, [pageId]: { status: 'loading' } }))
    try {
      const result = await pagespeedApi.analyzePage(siteId, pageId, strategy)
      setAudits((prev) => ({ ...prev, [pageId]: { status: 'done', issues: result.issues } }))
    } catch (e: any) {
      setAudits((prev) => ({ ...prev, [pageId]: { status: 'error', error: e?.message ?? String(e) } }))
    }
  }

  const qc = useQueryClient()

  // Lab data (PSI)
  const trigger = useTriggerScan(siteId)
  const { data: progress } = usePsiProgress(siteId, strategy, true)
  const { data: stats, isLoading: statsLoading } = usePsiStats(siteId, strategy)
  const { data: results = [], isLoading: resultsLoading } = usePsiResults(siteId, strategy)

  // Field data (CrUX)
  const cruxFetch = useTriggerCruxFetch(siteId)
  const [cruxPolling, setCruxPolling] = useState(false)
  const { data: cruxProgress } = useCruxProgress(siteId, cruxPolling)
  const { data: cruxStats } = useCruxStats(siteId)
  const { data: cruxResults = [] } = useCruxResults(siteId)
  const cruxRunning = cruxProgress?.isRunning ?? false
  const prevCruxRunning = useRef(false)

  useEffect(() => {
    if (cruxRunning) setCruxPolling(true)
    if (prevCruxRunning.current && !cruxRunning && cruxPolling) {
      setCruxPolling(false)
      qc.invalidateQueries({ queryKey: ['crux-stats', siteId] })
      qc.invalidateQueries({ queryKey: ['crux-results', siteId] })
    }
    prevCruxRunning.current = cruxRunning
  }, [cruxRunning, siteId, qc, cruxPolling])

  const isRunning = progress?.isRunning ?? false
  const prevRunning = useRef(false)

  // Refetch results + stats when scan finishes
  useEffect(() => {
    if (prevRunning.current && !isRunning) {
      qc.invalidateQueries({ queryKey: ['psi-stats', siteId, strategy] })
      qc.invalidateQueries({ queryKey: ['psi-results', siteId, strategy] })
    }
    prevRunning.current = isRunning
  }, [isRunning, siteId, strategy, qc])

  const progressPct = progress && progress.total > 0
    ? Math.round((progress.completed / progress.total) * 100)
    : 0

  const categoryData = stats ? [
    { name: 'Good', value: stats.good, color: '#34a853' },
    { name: 'Needs Improvement', value: stats.needs_improvement, color: '#fbbc04' },
    { name: 'Poor', value: stats.poor, color: '#ea4335' },
  ] : []

  const total = categoryData.reduce((s, d) => s + d.value, 0)

  return (
    <div className="min-h-screen bg-[#13151f] text-[#e8eaed]">
      {/* Header */}
      <div className="border-b border-white/8 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">PageSpeed</h1>
          <p className="text-xs text-[#9aa0a6] mt-0.5">
            {stats?.lastScanAt
              ? `Last scan ${new Date(stats.lastScanAt).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
              : 'No scan yet'}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Strategy toggle */}
          <div className="flex rounded-lg overflow-hidden border border-white/8">
            {(['mobile', 'desktop'] as PsiStrategy[]).map((s) => (
              <button
                key={s}
                onClick={() => setStrategy(s)}
                className={`px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                  strategy === s
                    ? 'bg-[#4285f4] text-white'
                    : 'bg-[#232635] text-[#9aa0a6] hover:text-white'
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          <RunScanButton
            isRunning={isRunning}
            isPending={trigger.isPending}
            onScan={(mode) => trigger.mutate({ strategy, mode })}
          />
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Progress bar */}
        {isRunning && (
          <div className="rounded-xl bg-[#232635] border border-white/8 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Scanning pages…</span>
              <span className="text-sm text-[#9aa0a6]">{progress?.completed ?? 0} / {progress?.total ?? 0}</span>
            </div>
            <div className="h-2 rounded-full bg-white/8 overflow-hidden">
              <div
                className="h-full bg-[#4285f4] rounded-full transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            {(progress?.currentUrls?.length ?? 0) > 0 && (
              <div className="mt-2 space-y-0.5">
                {progress!.currentUrls!.map((url, i) => (
                  <p key={i} className="text-xs text-[#9aa0a6] truncate">
                    <span className="text-[#4285f4]">●</span> {url}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Stats row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Average score */}
          <div className="rounded-xl bg-[#232635] border border-white/8 p-4 flex items-center gap-4">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold flex-shrink-0"
              style={{
                background: stats ? scoreColor(stats.avgScore) + '22' : '#ffffff10',
                color: stats ? scoreColor(stats.avgScore) : '#9aa0a6',
                border: `3px solid ${stats ? scoreColor(stats.avgScore) : '#ffffff20'}`,
              }}
            >
              {stats?.avgScore ?? '-'}
            </div>
            <div>
              <div className="text-xs text-[#9aa0a6]">Avg Score</div>
              <div className="text-sm font-medium mt-0.5">{strategy}</div>
            </div>
          </div>

          {/* Good / NI / Poor */}
          {[
            { label: 'Good', value: stats?.good, color: '#34a853' },
            { label: 'Needs Improvement', value: stats?.needs_improvement, color: '#fbbc04' },
            { label: 'Poor', value: stats?.poor, color: '#ea4335' },
          ].map((c) => (
            <div key={c.label} className="rounded-xl bg-[#232635] border border-white/8 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[#9aa0a6]">{c.label}</span>
                <span className="text-xs text-[#9aa0a6]">
                  {total > 0 && c.value != null ? `${Math.round((c.value / total) * 100)}%` : ''}
                </span>
              </div>
              <div className="text-2xl font-bold mt-1" style={{ color: c.color }}>
                {statsLoading ? '-' : c.value ?? 0}
              </div>
              <div className="mt-2 h-1 rounded-full bg-white/8 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: total > 0 && c.value != null ? `${(c.value / total) * 100}%` : '0%',
                    background: c.color,
                  }}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Charts row */}
        {stats && (stats.good + stats.needs_improvement + stats.poor > 0) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Distribution bar */}
            <div className="rounded-xl bg-[#232635] border border-white/8 p-4">
              <div className="text-xs font-medium text-[#9aa0a6] uppercase tracking-wider mb-4">Distribution</div>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={categoryData} barSize={40}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#9aa0a6' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#9aa0a6' }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: '#1a1d2e', border: '1px solid #ffffff20', borderRadius: 8 }}
                    labelStyle={{ color: '#e8eaed' }}
                    cursor={{ fill: '#ffffff08' }}
                  />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                    {categoryData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Score trend */}
            <div className="rounded-xl bg-[#232635] border border-white/8 p-4">
              <div className="text-xs font-medium text-[#9aa0a6] uppercase tracking-wider mb-4">Avg Score Trend (30 days)</div>
              {stats.trend.length > 1 ? (
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={stats.trend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: '#9aa0a6' }}
                      tickFormatter={(v) => v.slice(5)}
                    />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#9aa0a6' }} />
                    <Tooltip
                      contentStyle={{ background: '#1a1d2e', border: '1px solid #ffffff20', borderRadius: 8 }}
                      labelStyle={{ color: '#e8eaed' }}
                    />
                    <Line type="monotone" dataKey="avgScore" stroke="#4285f4" strokeWidth={2} dot={false} name="Avg Score" />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[180px] flex items-center justify-center text-sm text-[#9aa0a6]">
                  Not enough history yet - run a few more scans to see the trend
                </div>
              )}
            </div>
          </div>
        )}

        {/* Pages table */}
        <div className="rounded-xl bg-[#232635] border border-white/8 overflow-hidden">
          <div className="px-4 py-3 border-b border-white/8 flex items-center justify-between">
            <span className="text-sm font-medium">Pages</span>
            <span className="text-xs text-[#9aa0a6]">{results.length} scanned</span>
          </div>

          {resultsLoading ? (
            <div className="p-8 text-center text-[#9aa0a6] text-sm">Loading…</div>
          ) : results.length === 0 ? (
            <div className="p-8 text-center text-[#9aa0a6] text-sm">
              No results yet.{' '}
              <button onClick={() => trigger.mutate({ strategy })} className="text-[#4285f4] hover:underline">
                Run a scan
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/8 text-left">
                    <th className="px-4 py-2.5 text-xs font-medium text-[#9aa0a6]">Score</th>
                    <th className="px-4 py-2.5 text-xs font-medium text-[#9aa0a6]">Page</th>
                    <th className="px-4 py-2.5 text-xs font-medium text-[#9aa0a6] text-right">LCP</th>
                    <th className="px-4 py-2.5 text-xs font-medium text-[#9aa0a6] text-right">FCP</th>
                    <th className="px-4 py-2.5 text-xs font-medium text-[#9aa0a6] text-right">CLS</th>
                    <th className="px-4 py-2.5 text-xs font-medium text-[#9aa0a6] text-right">TBT</th>
                    <th className="px-4 py-2.5 text-xs font-medium text-[#9aa0a6]">Status</th>
                    <th className="px-4 py-2.5 text-xs font-medium text-[#9aa0a6]"></th>
                  </tr>
                </thead>
                <tbody>
                  {results
                    .slice()
                    .sort((a, b) => a.performanceScore - b.performanceScore)
                    .map((r) => (
                      <tr
                        key={r.pageId}
                        className="border-b border-white/4 hover:bg-white/3 transition-colors"
                      >
                        <td className="px-4 py-3">
                          <ScoreBadge score={r.performanceScore} />
                        </td>
                        <td className="px-4 py-3 max-w-xs">
                          <a
                            href={r.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#4285f4] hover:underline text-xs truncate block"
                          >
                            {r.url.replace(/^https?:\/\/[^/]+/, '') || '/'}
                          </a>
                          {audits[r.pageId]?.status === 'loading' && (
                            <p className="mt-1 text-xs text-[#9aa0a6] animate-pulse">Analyzing…</p>
                          )}
                          {audits[r.pageId]?.status === 'error' && (
                            <p className="mt-1 text-xs text-red-400">{audits[r.pageId].error}</p>
                          )}
                          {audits[r.pageId]?.status === 'done' && (audits[r.pageId].issues?.length ?? 0) === 0 && (
                            <p className="mt-1 text-xs text-emerald-400">No major issues</p>
                          )}
                          {audits[r.pageId]?.status === 'done' && (audits[r.pageId].issues?.length ?? 0) > 0 && (
                            <ul className="mt-1.5 space-y-0.5">
                              {audits[r.pageId].issues!.map((issue) => (
                                <li key={issue.id} className="flex items-start gap-1 text-xs text-[#9aa0a6]">
                                  <span className="text-red-400 shrink-0 mt-px">▸</span>
                                  <span>
                                    {issue.title}
                                    {issue.displayValue ? <span className="text-[#9aa0a6]/60"> - {issue.displayValue}</span> : null}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-xs text-[#9aa0a6]">{fmtMs(r.lcp)}</td>
                        <td className="px-4 py-3 text-right text-xs text-[#9aa0a6]">{fmtMs(r.fcp)}</td>
                        <td className="px-4 py-3 text-right text-xs text-[#9aa0a6]">{fmtCls(r.cls)}</td>
                        <td className="px-4 py-3 text-right text-xs text-[#9aa0a6]">{fmtMs(r.tbt)}</td>
                        <td className="px-4 py-3">
                          <CategoryChip category={r.category} />
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex flex-col gap-1">
                            <button
                              onClick={() => setSelectedPage({ pageId: r.pageId, url: r.url })}
                              className="text-xs text-[#9aa0a6] hover:text-white transition-colors text-left"
                            >
                              History →
                            </button>
                            <button
                              onClick={() => analyzeRow(r.pageId)}
                              disabled={audits[r.pageId]?.status === 'loading'}
                              className="text-xs text-[#fbbc04]/70 hover:text-[#fbbc04] transition-colors text-left disabled:opacity-50"
                            >
                              {audits[r.pageId]?.status === 'done' ? 'Re-analyze' : 'Analyze'}
                            </button>
                            <a
                              href={psiInsightsUrl(r.url)}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Open in Google PageSpeed Insights"
                              className="flex items-center gap-1 text-xs text-[#9aa0a6] hover:text-[#4285f4] transition-colors"
                            >
                              PSI Insights <ExternalLink size={11} />
                            </a>
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Field Data (CrUX) ──────────────────────────────────────────── */}
        <div className="rounded-xl bg-[#232635] border border-white/8 overflow-hidden">
          <div className="px-4 py-3 border-b border-white/8 flex items-center justify-between gap-3">
            <div>
              <span className="text-sm font-medium">Field Data</span>
              <span className="ml-2 text-xs text-[#9aa0a6]">Chrome UX Report - real user experience</span>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              {cruxStats?.lastFetchedAt && (
                <span className="text-xs text-[#9aa0a6]">
                  Updated {new Date(cruxStats.lastFetchedAt).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              )}
              <button
                onClick={() => { cruxFetch.mutate(); setCruxPolling(true) }}
                disabled={cruxRunning || cruxFetch.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#4285f4]/15 hover:bg-[#4285f4]/25 text-[#4285f4] text-xs font-medium disabled:opacity-50 transition-colors"
              >
                {cruxRunning ? (
                  <><span className="inline-block w-3 h-3 rounded-full border-2 border-[#4285f4]/30 border-t-[#4285f4] animate-spin" />Fetching…</>
                ) : 'Fetch CrUX Data'}
              </button>
            </div>
          </div>

          {/* CrUX progress */}
          {cruxRunning && cruxProgress && (
            <div className="px-4 py-3 border-b border-white/8 bg-[#1a1d2e]">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-[#9aa0a6]">Fetching field data…</span>
                <span className="text-xs text-[#9aa0a6]">{cruxProgress.completed} / {cruxProgress.total}</span>
              </div>
              <div className="h-1.5 rounded-full bg-white/8 overflow-hidden">
                <div
                  className="h-full bg-[#4285f4] rounded-full transition-all duration-500"
                  style={{ width: `${cruxProgress.total > 0 ? Math.round(cruxProgress.completed / cruxProgress.total * 100) : 0}%` }}
                />
              </div>
            </div>
          )}

          {/* CrUX stats summary */}
          {cruxStats && (cruxStats.phone.good + cruxStats.phone.ni + cruxStats.phone.poor > 0) && (
            <div className="px-4 py-3 border-b border-white/8 grid grid-cols-2 gap-4">
              {(['phone', 'desktop'] as const).map((ff) => {
                const t = cruxStats[ff]
                const total = t.good + t.ni + t.poor + t.noData
                return (
                  <div key={ff}>
                    <div className="text-xs font-medium text-[#9aa0a6] mb-2 uppercase tracking-wider">
                      {ff === 'phone' ? '📱 Mobile (PHONE)' : '🖥️ Desktop'}
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-emerald-400 font-medium">{t.good} good</span>
                      <span className="text-yellow-400 font-medium">{t.ni} NI</span>
                      <span className="text-red-400 font-medium">{t.poor} poor</span>
                      {t.noData > 0 && <span className="text-[#9aa0a6]">{t.noData} no data</span>}
                    </div>
                    {total > 0 && (
                      <div className="flex h-1.5 rounded-full overflow-hidden mt-1.5 gap-px">
                        {t.good  > 0 && <div style={{ width: `${t.good  / total * 100}%` }} className="bg-emerald-500" />}
                        {t.ni    > 0 && <div style={{ width: `${t.ni    / total * 100}%` }} className="bg-yellow-500" />}
                        {t.poor  > 0 && <div style={{ width: `${t.poor  / total * 100}%` }} className="bg-red-500" />}
                        {t.noData > 0 && <div style={{ width: `${t.noData / total * 100}%` }} className="bg-white/10" />}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* CrUX table */}
          {cruxResults.length === 0 ? (
            <div className="p-8 text-center text-[#9aa0a6] text-sm">
              No field data yet.{' '}
              <button onClick={() => { cruxFetch.mutate(); setCruxPolling(true) }} className="text-[#4285f4] hover:underline">
                Fetch CrUX data
              </button>
              {' '}- only shows for URLs with enough real Chrome traffic.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/8 text-left">
                    <th className="px-4 py-2.5 text-[#9aa0a6] font-medium">Page</th>
                    <th colSpan={4} className="px-4 py-2 text-[#9aa0a6] font-medium border-l border-white/8">
                      📱 Mobile (p75)
                    </th>
                    <th colSpan={4} className="px-4 py-2 text-[#9aa0a6] font-medium border-l border-white/8">
                      🖥️ Desktop (p75)
                    </th>
                  </tr>
                  <tr className="border-b border-white/4 text-left">
                    <th className="px-4 py-1.5 text-[#9aa0a6]"></th>
                    <th className="px-3 py-1.5 text-[#9aa0a6] border-l border-white/8">LCP</th>
                    <th className="px-3 py-1.5 text-[#9aa0a6]">CLS</th>
                    <th className="px-3 py-1.5 text-[#9aa0a6]">INP</th>
                    <th className="px-3 py-1.5 text-[#9aa0a6]">FCP</th>
                    <th className="px-3 py-1.5 text-[#9aa0a6] border-l border-white/8">LCP</th>
                    <th className="px-3 py-1.5 text-[#9aa0a6]">CLS</th>
                    <th className="px-3 py-1.5 text-[#9aa0a6]">INP</th>
                    <th className="px-3 py-1.5 text-[#9aa0a6]">FCP</th>
                  </tr>
                </thead>
                <tbody>
                  {cruxResults.map((r) => (
                    <tr key={r.pageId} className="border-b border-white/4 hover:bg-white/3 transition-colors">
                      <td className="px-4 py-2.5 max-w-xs">
                        <div className="flex items-center gap-1.5">
                          <a href={r.url} target="_blank" rel="noopener noreferrer"
                            className="text-[#4285f4] hover:underline truncate block max-w-[200px]">
                            {r.url.replace(/^https?:\/\/[^/]+/, '') || '/'}
                          </a>
                          {(r.phone?.isOriginFallback || r.desktop?.isOriginFallback) && (
                            <span title="Origin-level fallback (URL had insufficient traffic)" className="text-[#9aa0a6] cursor-help">~</span>
                          )}
                        </div>
                      </td>
                      <CruxMetricCell m={r.phone} field="lcp" border />
                      <CruxMetricCell m={r.phone} field="cls" />
                      <CruxMetricCell m={r.phone} field="inp" />
                      <CruxMetricCell m={r.phone} field="fcp" />
                      <CruxMetricCell m={r.desktop} field="lcp" border />
                      <CruxMetricCell m={r.desktop} field="cls" />
                      <CruxMetricCell m={r.desktop} field="inp" />
                      <CruxMetricCell m={r.desktop} field="fcp" />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Page history drawer */}
      {selectedPage && (
        <PageHistoryDrawer
          siteId={siteId}
          pageId={selectedPage.pageId}
          url={selectedPage.url}
          strategy={strategy}
          onClose={() => setSelectedPage(null)}
        />
      )}
    </div>
  )
}
