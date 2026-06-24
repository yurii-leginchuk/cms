import { useMemo, useState } from 'react'
import { ArrowUpDown, ExternalLink, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table'
import Pagination from '@/components/Pagination'
import { isStrikingDistance } from '@/lib/seoCtrCurve'
import { TYPE_META } from './ImpactTimeline'
import type { ChangeEvent } from '@/api/impact'
import type { OptimizationEffect } from '@/api/optimizationEffects'

const PAGE_SIZE = 15
type SortKey = 'date' | 'clicks' | 'position'
type WinnerFilter = 'all' | 'winners' | 'losers'

function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)
}

interface Row {
  event: ChangeEvent
  clicksDelta: number | null
  positionDelta: number | null
  striking: boolean
  status: string
}

export function ChangesTable({
  events, effects, onSelectEvent,
}: {
  events: ChangeEvent[]
  effects: OptimizationEffect[]
  onSelectEvent: (ev: ChangeEvent) => void
}) {
  const [sort, setSort] = useState<SortKey>('clicks')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [winner, setWinner] = useState<WinnerFilter>('all')
  const [page, setPage] = useState(1)

  const rows = useMemo<Row[]>(() => events.map((ev) => {
    const eff = effects.find(
      (e) => e.pageId === ev.pageId && Math.abs(dayDiff(e.appliedAt.slice(0, 10), ev.day)) <= 2,
    )
    const measured = eff?.status === 'measured'
    const clicksDelta = measured && eff!.resultClicks != null ? eff!.resultClicks - eff!.baselineClicks : null
    const positionDelta = measured && eff!.resultPosition != null ? eff!.resultPosition - eff!.baselinePosition : null
    const striking = !!eff && (isStrikingDistance(eff.baselinePosition) || (eff.resultPosition != null && isStrikingDistance(eff.resultPosition)))
    return {
      event: ev,
      clicksDelta,
      positionDelta,
      striking,
      status: eff?.status ?? (ev.measurable ? '-' : 'n/a'),
    }
  }), [events, effects])

  const filtered = useMemo(() => {
    let r = rows
    if (statusFilter !== 'all') r = r.filter((x) => x.status === statusFilter)
    if (winner === 'winners') r = r.filter((x) => (x.clicksDelta ?? 0) > 0)
    if (winner === 'losers') r = r.filter((x) => (x.clicksDelta ?? 0) < 0)
    const sorted = [...r].sort((a, b) => {
      let cmp = 0
      if (sort === 'date') cmp = a.event.day < b.event.day ? -1 : a.event.day > b.event.day ? 1 : 0
      else if (sort === 'clicks') cmp = (a.clicksDelta ?? -Infinity) - (b.clicksDelta ?? -Infinity)
      else cmp = (a.positionDelta ?? Infinity) - (b.positionDelta ?? Infinity)
      return dir === 'asc' ? cmp : -cmp
    })
    return sorted
  }, [rows, statusFilter, winner, sort, dir])

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function toggleSort(key: SortKey) {
    if (sort === key) setDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSort(key); setDir(key === 'position' ? 'asc' : 'desc') }
    setPage(1)
  }

  const SortHead = ({ k, label, className }: { k: SortKey; label: string; className?: string }) => (
    <TableHead className={cn('cursor-pointer select-none whitespace-nowrap', className)} onClick={() => toggleSort(k)}>
      <span className="inline-flex items-center gap-1">
        {label}<ArrowUpDown className={cn('size-3', sort === k ? 'text-[#4e8af4]' : 'opacity-30')} />
      </span>
    </TableHead>
  )

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <FilterChips label="Status" value={statusFilter} onChange={(v) => { setStatusFilter(v); setPage(1) }}
          options={[['all', 'All'], ['measured', 'Measured'], ['pending', 'Pending'], ['no_data', 'No data']]} />
        <FilterChips label="Movement" value={winner} onChange={(v) => { setWinner(v as WinnerFilter); setPage(1) }}
          options={[['all', 'All'], ['winners', 'Winners'], ['losers', 'Losers']]} />
        <span className="text-[#9aa0a6]/60 ml-auto">{filtered.length} change{filtered.length === 1 ? '' : 's'}</span>
      </div>

      <div className="rounded-xl border border-white/8 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-white/8 hover:bg-transparent">
              <TableHead className="text-[#9aa0a6]">Page</TableHead>
              <TableHead className="text-[#9aa0a6]">Change</TableHead>
              <SortHead k="date" label="Date" className="text-[#9aa0a6]" />
              <TableHead className="text-[#9aa0a6]">Status</TableHead>
              <SortHead k="clicks" label="Clicks Δ" className="text-[#9aa0a6] text-right" />
              <SortHead k="position" label="Pos Δ" className="text-[#9aa0a6] text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.map((r) => {
              const tm = TYPE_META[r.event.type]
              return (
                <TableRow key={r.event.id}
                  className="border-white/5 cursor-pointer hover:bg-white/[0.03]"
                  onClick={() => onSelectEvent(r.event)}>
                  <TableCell className="max-w-[260px]">
                    <a href={r.event.pageUrl} target="_blank" rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-[12px] text-[#e8eaed] hover:text-[#4e8af4] inline-flex items-center gap-1 truncate max-w-full">
                      <span className="truncate">{r.event.pageUrl}</span>
                      <ExternalLink className="size-3 opacity-40 flex-shrink-0" />
                    </a>
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5 text-[12px] text-[#c8cad0]">
                      <span className="size-2 rounded-full flex-shrink-0" style={{ background: tm.color }} />
                      {r.event.subtype}
                      {r.event.confoundedWith > 0 && (
                        <AlertTriangle className="size-3 text-amber-400/80" />
                      )}
                      {r.striking && (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-[#4e8af4]/15 text-[#4e8af4]">SD</span>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="text-[12px] text-[#9aa0a6] whitespace-nowrap">{r.event.day}</TableCell>
                  <TableCell><StatusPill status={r.status} /></TableCell>
                  <TableCell className="text-right tabular-nums">
                    <DeltaCell value={r.clicksDelta} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <DeltaCell value={r.positionDelta} lowerIsBetter decimals={1} />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
      <Pagination page={page} totalPages={totalPages} onChange={setPage} />
    </div>
  )
}

function DeltaCell({ value, lowerIsBetter = false, decimals = 0 }: { value: number | null; lowerIsBetter?: boolean; decimals?: number }) {
  if (value == null) return <span className="text-[#9aa0a6]/40">-</span>
  const improved = lowerIsBetter ? value < 0 : value > 0
  const worse = lowerIsBetter ? value > 0 : value < 0
  const color = improved ? 'text-emerald-400' : worse ? 'text-red-400' : 'text-[#9aa0a6]'
  return <span className={cn('text-[12px]', color)}>{value > 0 ? '+' : ''}{value.toFixed(decimals)}</span>
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    measured: 'bg-emerald-500/15 text-emerald-400',
    pending: 'bg-amber-500/15 text-amber-400',
    no_data: 'bg-white/10 text-[#9aa0a6]',
  }
  const label: Record<string, string> = { measured: 'Measured', pending: 'Pending', no_data: 'No data', '-': '-', 'n/a': 'n/a' }
  return <span className={cn('text-[10px] px-2 py-0.5 rounded-full', map[status] ?? 'bg-white/5 text-[#9aa0a6]')}>{label[status] ?? status}</span>
}

function FilterChips({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: [string, string][]
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[#9aa0a6]/70">{label}:</span>
      <div className="flex items-center rounded-lg bg-white/5 p-0.5">
        {options.map(([v, l]) => (
          <button key={v} onClick={() => onChange(v)}
            className={cn('px-2 py-0.5 rounded-md transition-colors',
              value === v ? 'bg-[#4e8af4]/20 text-[#4e8af4] font-medium' : 'text-[#9aa0a6] hover:text-[#e8eaed]')}>
            {l}
          </button>
        ))}
      </div>
    </div>
  )
}
