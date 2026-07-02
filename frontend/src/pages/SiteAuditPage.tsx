import { useMemo, useRef, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  AlertTriangle, ChevronLeft, ChevronRight, ChevronRight as ChevronRightIcon,
  Play, RefreshCw, Search, ShieldCheck, Wrench,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { StatusBadge } from '@/components/StatusBadge'
import { RelativeClock } from '@/components/index-status/RelativeClock'
import { useSite } from '@/hooks/useSites'
import { useAuditFindings, useAuditSummary, useRunAudit } from '@/hooks/useAudit'
import type { AuditSummary } from '@/api/audit'
import { AuditTrustStrip } from '@/components/audit/AuditTrustStrip'
import { AuditChangeDigest } from '@/components/audit/AuditChangeDigest'
import { SeverityBar } from '@/components/audit/SeverityBar'
import { FindingSheet } from '@/components/audit/FindingSheet'
import { DIFF_META, SEVERITY_META } from '@/components/audit/auditMeta'

const PAGE_LIMIT = 50
const STALE_RUN_DAYS = 8

const SEVERITIES = [
  { value: '', label: 'All severities' },
  { value: 'critical', label: 'Critical' },
  { value: 'warning', label: 'Warning' },
  { value: 'notice', label: 'Notice' },
]

const DIFFS = [
  { value: '', label: 'Diff: all' },
  { value: 'new', label: 'New this run' },
  { value: 'persisting', label: 'Persisting' },
  { value: 'unconfirmed', label: 'Not re-checked' },
]

const selectCls =
  'h-9 px-3 pr-8 rounded-lg bg-[#1a1d27] border border-white/8 text-[13px] text-[#e8eaed] focus:outline-none focus:ring-1 focus:ring-[#4e8af4]/50 appearance-none cursor-pointer'
const selectBg = {
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239aa0a6' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 10px center',
}

export default function SiteAuditPage() {
  const { id } = useParams<{ id: string }>()
  const [currentPage, setCurrentPage] = useState(1)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [severity, setSeverity] = useState('')
  const [checkType, setCheckType] = useState('')
  const [diff, setDiff] = useState('')
  const [showMuted, setShowMuted] = useState(false)
  const [openFindingId, setOpenFindingId] = useState<string | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { data: site, isLoading: siteLoading } = useSite(id!)
  const [live, setLive] = useState(false)
  const { data: summary } = useAuditSummary(id, live)
  const isRunning = !!summary?.running
  if (isRunning !== live) setLive(isRunning)

  const { data: findingList, isLoading: findingsLoading, isFetching } = useAuditFindings(id, {
    severity: severity || undefined,
    checkType: checkType || undefined,
    diff: diff || undefined,
    showMuted,
    search: debouncedSearch || undefined,
    page: currentPage,
    limit: PAGE_LIMIT,
  }, isRunning)
  const runAudit = useRunAudit(id!)

  const checkTypes = useMemo(() => ([
    { value: '', label: 'All checks' },
    ...(summary?.detectorCatalog ?? []).map((d) => ({ value: d.checkType, label: d.label })),
  ]), [summary?.detectorCatalog])

  if (!id) return <Navigate to="/sites" replace />

  function onSearch(v: string) {
    setSearch(v); setCurrentPage(1)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => setDebouncedSearch(v), 350)
  }

  async function handleRunNow() {
    try {
      await runAudit.mutateAsync()
      toast.success('Audit started — results appear as the run completes.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't start the audit.")
    }
  }

  const rows = findingList?.data ?? []
  const meta = findingList?.meta

  const lastRunAgeDays = summary?.lastRun?.finishedAt
    ? (Date.now() - new Date(summary.lastRun.finishedAt).getTime()) / 86_400_000
    : null
  const staleRun = lastRunAgeDays != null && lastRunAgeDays > STALE_RUN_DAYS

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
          <span className="text-[#e8eaed]">Site Audit</span>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <ShieldCheck className="size-5 text-[#4e8af4]" />
            <h1 className="text-xl font-semibold text-[#e8eaed] tracking-tight">{site?.name}</h1>
            <span className="text-[#9aa0a6]/50 text-xl font-light">/</span>
            <span className="text-[#9aa0a6] text-[15px]">Site Audit</span>
            {site && <StatusBadge status={site.status ?? 'idle'} />}
          </div>
          <Button
            size="sm"
            onClick={handleRunNow}
            disabled={runAudit.isPending || isRunning || summary?.enabled === false}
            className="h-8 px-3 text-[12px] bg-[#4e8af4] hover:bg-[#4e8af4]/90 text-white gap-1.5 disabled:opacity-60"
            title="Re-run all detectors now (1/hour cooldown; shares the live-fetch budget)"
          >
            {isRunning || runAudit.isPending
              ? <RefreshCw className="size-3.5 animate-spin" />
              : <Play className="size-3.5" />}
            {isRunning ? 'Running…' : 'Run now'}
          </Button>
        </div>
      </div>

      <div className="px-8 py-6 space-y-6">
        {summary?.enabled === false && (
          <Banner tone="amber">
            The audit is disabled for this site (kill switch in audit settings). Scheduled and
            manual runs are skipped.
          </Banner>
        )}

        {summary && !summary.hasRun ? (
          <FirstRunCard summary={summary} onRun={handleRunNow} starting={runAudit.isPending || isRunning} />
        ) : (
          <>
            {isRunning && (
              <Banner tone="blue">
                <RefreshCw className="size-3.5 animate-spin inline mr-1.5" />
                Audit in progress — previous findings stay visible below until the run completes.
              </Banner>
            )}
            {staleRun && !isRunning && (
              <Banner tone="amber">
                <AlertTriangle className="size-3.5 inline mr-1.5" />
                Last audit finished {Math.floor(lastRunAgeDays!)} days ago — the Sunday-night run
                probably failed. Silence is not health; consider [Run now].
              </Banner>
            )}
            {summary?.lastRun?.status === 'failed' && (
              <Banner tone="red">
                The last run failed{summary.lastRun.fatalError ? `: ${summary.lastRun.fatalError}` : '.'}
              </Banner>
            )}

            <AuditTrustStrip summary={summary} />
            {summary?.lastRun?.status === 'partial' && <PartialDetectors summary={summary} />}
            {summary && (
              <AuditChangeDigest summary={summary} onOpenFinding={setOpenFindingId} />
            )}
            {summary && summary.counts.open > 0 && (
              <SeverityBar summary={summary} active={severity} onPick={(s) => { setSeverity(s); setCurrentPage(1) }} />
            )}
            {summary && summary.counts.open === 0 && summary.lastRun?.status === 'complete' && (
              <AllClearCard summary={summary} />
            )}

            {/* Filters */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative max-w-xs flex-1 min-w-[220px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[#9aa0a6]" />
                <Input
                  value={search}
                  onChange={(e) => onSearch(e.target.value)}
                  placeholder="Filter findings…"
                  className="pl-9 bg-[#1a1d27] border-white/8 text-[#e8eaed] placeholder:text-[#9aa0a6]/60 h-9"
                />
              </div>
              <select value={severity} onChange={(e) => { setSeverity(e.target.value); setCurrentPage(1) }} className={selectCls} style={selectBg}>
                {SEVERITIES.map((s) => <option key={s.value} value={s.value} className="bg-[#1a1d27]">{s.label}</option>)}
              </select>
              <select value={checkType} onChange={(e) => { setCheckType(e.target.value); setCurrentPage(1) }} className={selectCls} style={selectBg}>
                {checkTypes.map((s) => <option key={s.value} value={s.value} className="bg-[#1a1d27]">{s.label}</option>)}
              </select>
              <select value={diff} onChange={(e) => { setDiff(e.target.value); setCurrentPage(1) }} className={selectCls} style={selectBg}>
                {DIFFS.map((s) => <option key={s.value} value={s.value} className="bg-[#1a1d27]">{s.label}</option>)}
              </select>
              <label className="inline-flex items-center gap-2 text-[13px] text-[#9aa0a6] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showMuted}
                  onChange={(e) => { setShowMuted(e.target.checked); setCurrentPage(1) }}
                  className="accent-[#4e8af4]"
                />
                show muted{summary && summary.counts.muted > 0 ? ` (${summary.counts.muted})` : ''}
              </label>
            </div>

            {/* Findings table — one issue = one row */}
            <div className="rounded-xl border border-white/8 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="border-white/8 hover:bg-transparent bg-[#1a1d27]">
                    <TableHead className="text-[11px] font-medium uppercase tracking-widest text-[#9aa0a6] h-10">Severity</TableHead>
                    <TableHead className="text-[11px] font-medium uppercase tracking-widest text-[#9aa0a6] h-10">Finding</TableHead>
                    <TableHead className="text-[11px] font-medium uppercase tracking-widest text-[#9aa0a6] h-10">Diff</TableHead>
                    <TableHead className="text-[11px] font-medium uppercase tracking-widest text-[#9aa0a6] h-10">First seen</TableHead>
                    <TableHead className="text-[11px] font-medium uppercase tracking-widest text-[#9aa0a6] h-10">We checked</TableHead>
                    <TableHead className="text-[11px] font-medium uppercase tracking-widest text-[#9aa0a6] h-10 w-28">Fix</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {findingsLoading ? (
                    [0, 1, 2, 3].map((i) => (
                      <TableRow key={i} className="border-white/8 hover:bg-transparent">
                        {[70, 320, 80, 90, 90, 70].map((w, j) => (
                          <TableCell key={j}><Skeleton className="h-4 bg-white/5 rounded" style={{ width: w }} /></TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : rows.length === 0 ? (
                    <TableRow className="border-white/8 hover:bg-transparent">
                      <TableCell colSpan={6}>
                        <div className="flex flex-col items-center justify-center py-14 gap-3">
                          <div className="size-12 rounded-xl bg-[#1a1d27] border border-white/8 flex items-center justify-center">
                            <ShieldCheck className="size-6 text-[#9aa0a6]" />
                          </div>
                          <p className="text-[#9aa0a6] text-sm">
                            {debouncedSearch || severity || checkType || diff || showMuted
                              ? 'No findings match these filters'
                              : 'No open findings'}
                          </p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((r) => {
                      const sev = SEVERITY_META[r.severity]
                      const dm = r.diffState ? DIFF_META[r.diffState] : null
                      const dimmed = r.status === 'muted'
                      return (
                        <TableRow
                          key={r.id}
                          onClick={() => setOpenFindingId(r.id)}
                          className={`border-white/8 transition-colors cursor-pointer hover:bg-white/[0.02] ${dimmed ? 'opacity-45' : ''}`}
                        >
                          <TableCell>
                            <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide border ${sev.cls}`}>
                              {sev.label}
                            </span>
                          </TableCell>
                          <TableCell className="max-w-[380px]">
                            <span className="block text-[13px] text-[#e8eaed] truncate" title={r.title}>{r.title}</span>
                            <span className="block text-[11px] text-[#9aa0a6]">
                              {r.checkLabel}
                              {r.affectedCount > 1 && <> · {r.affectedCount} pages</>}
                              {dimmed && r.muteReason && <> · muted: “{r.muteReason}”</>}
                              {r.status === 'accepted' && <> · accepted as intended</>}
                            </span>
                          </TableCell>
                          <TableCell>
                            {dm ? (
                              <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium border ${dm.cls}`}>
                                {dm.symbol} {dm.label}
                              </span>
                            ) : <span className="text-[#9aa0a6]/30 text-[12px]">—</span>}
                          </TableCell>
                          <TableCell><RelativeClock ts={r.firstSeenAt} /></TableCell>
                          <TableCell><RelativeClock ts={r.lastEvaluatedAt} staleDays={STALE_RUN_DAYS} /></TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            {r.fixRoute ? (
                              <Link
                                to={`${r.fixRoute}?from=audit&finding=${r.id}`}
                                className="inline-flex items-center gap-1 text-[12px] text-[#4e8af4] hover:underline"
                              >
                                <Wrench className="size-3" />Fix in CMS
                              </Link>
                            ) : (
                              <span className="text-[#9aa0a6]/40 text-[11px]" title="No CMS surface can fix this — it needs theme/server work.">task-only</span>
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
                  {' · '}{meta.total.toLocaleString()} findings{isFetching ? ' · updating…' : ''}
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
          </>
        )}
      </div>

      <FindingSheet siteId={id} findingId={openFindingId} onClose={() => setOpenFindingId(null)} />
    </div>
  )
}

/* ── Honest states ────────────────────────────────────────────────────────── */

function Banner({ tone, children }: { tone: 'amber' | 'blue' | 'red'; children: React.ReactNode }) {
  const cls = {
    amber: 'border-amber-400/20 bg-amber-400/[0.04] text-[#e8eaed]',
    blue: 'border-[#4e8af4]/20 bg-[#4e8af4]/[0.05] text-[#e8eaed]',
    red: 'border-red-400/25 bg-red-400/[0.05] text-red-200',
  }[tone]
  return <div className={`rounded-xl border px-5 py-3 text-[13px] ${cls}`}>{children}</div>
}

/** First run: teach what the audit checks, then earn trust with a real run. */
function FirstRunCard({
  summary, onRun, starting,
}: {
  summary: AuditSummary
  onRun: () => void
  starting: boolean
}) {
  return (
    <div className="rounded-xl border border-white/8 bg-[#1a1d27]/60 px-6 py-6 max-w-3xl">
      <div className="flex items-center gap-2.5 mb-2">
        <ShieldCheck className="size-5 text-[#4e8af4]" />
        <h2 className="text-[15px] font-semibold text-[#e8eaed]">No audit has run yet</h2>
      </div>
      <p className="text-[13px] text-[#9aa0a6] mb-4 leading-relaxed">
        The audit runs every Monday at 5:00 AM ET and pages you <span className="text-[#e8eaed]">only on change</span> —
        what broke this week, what got fixed. It reads the data the CMS already collects nightly,
        plus a small budget of live checks. These are the {summary.detectorCatalog.length} regression detectors:
      </p>
      <ul className="space-y-2 mb-5">
        {summary.detectorCatalog.map((d) => (
          <li key={d.checkType} className="text-[13px]">
            <span className="text-[#e8eaed] font-medium">{d.label}</span>
            <span className="text-[#9aa0a6]"> — {d.description}</span>
          </li>
        ))}
      </ul>
      <Button
        onClick={onRun}
        disabled={starting}
        className="h-9 px-4 text-[13px] bg-[#4e8af4] hover:bg-[#4e8af4]/90 text-white gap-1.5"
      >
        {starting ? <RefreshCw className="size-4 animate-spin" /> : <Play className="size-4" />}
        Run first audit now
      </Button>
    </div>
  )
}

/** Zero findings must feel EARNED — list what was checked and passed. */
function AllClearCard({ summary }: { summary: AuditSummary }) {
  const coverage = summary.lastRun?.coverage ?? {}
  return (
    <div className="rounded-xl border border-emerald-400/15 bg-emerald-400/[0.03] px-5 py-4">
      <p className="text-[13px] text-emerald-300 font-medium mb-2">
        All clear — every detector ran to completion and found nothing open.
      </p>
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        {summary.detectorCatalog.map((d) => {
          const c = coverage[d.checkType]
          return (
            <span key={d.checkType} className="text-[12px] text-[#9aa0a6]">
              ✓ {d.label}
              {c && c.subjectsSelected > 0 && (
                <span className="text-[#9aa0a6]/60"> ({c.subjectsEvaluated}/{c.subjectsSelected})</span>
              )}
            </span>
          )
        })}
      </div>
    </div>
  )
}

/** Partial run: name the incomplete detectors — never a silent half-truth. */
function PartialDetectors({ summary }: { summary: AuditSummary }) {
  const coverage = summary.lastRun?.coverage ?? {}
  const catalog = new Map<string, string>(summary.detectorCatalog.map((d) => [d.checkType, d.label]))
  const partial = Object.entries(coverage).filter(([, c]) => !c.scopeComplete)
  if (partial.length === 0) return null
  return (
    <Banner tone="amber">
      <AlertTriangle className="size-3.5 inline mr-1.5" />
      This run was partial — {partial.map(([k, c], i) => (
        <span key={k}>
          {i > 0 && ', '}
          <span className="text-[#e8eaed]">{catalog.get(k) ?? k}</span>
          {' '}({c.subjectsEvaluated}/{c.subjectsSelected} checked)
        </span>
      ))}. Findings from these detectors keep their previous state (“not re-checked”), they were
      NOT silently resolved.
    </Banner>
  )
}
