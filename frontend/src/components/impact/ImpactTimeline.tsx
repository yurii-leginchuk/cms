import { useMemo } from 'react'
import {
  ComposedChart, Area, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceArea, ReferenceLine,
  Brush, ResponsiveContainer, usePlotArea, useXAxisScale,
} from 'recharts'
import type { SeriesPoint, ChangeEvent, ChangeEventType } from '@/api/impact'

export type ImpactMetric = 'clicks' | 'impressions' | 'ctr' | 'position'
export type ImpactMetricSel = ImpactMetric | 'all'

export const METRIC_LABELS: Record<ImpactMetric, string> = {
  clicks: 'Clicks',
  impressions: 'Impressions',
  ctr: 'CTR %',
  position: 'Avg position',
}
export const METRIC_SEL_LABELS: Record<ImpactMetricSel, string> = {
  all: 'All', ...METRIC_LABELS,
}
const SMALL_MULTIPLE_ORDER: ImpactMetric[] = ['clicks', 'impressions', 'ctr', 'position']

export const TYPE_META: Record<ChangeEventType, { label: string; color: string }> = {
  meta: { label: 'Meta', color: '#4e8af4' },
  technical: { label: 'Technical', color: '#a78bfa' },
  schema: { label: 'Schema', color: '#34d399' },
  brief: { label: 'Brief', color: '#fbbf24' },
}

const LANE_ORDER: ChangeEventType[] = ['meta', 'technical', 'schema', 'brief']
const LANE_TOP_GAP = 12
const LANE_ROW_H = 16

function metricValue(p: SeriesPoint, metric: ImpactMetric): number {
  switch (metric) {
    case 'clicks': return +p.clicks.toFixed(p.clicks % 1 === 0 ? 0 : 1)
    case 'impressions': return +p.impressions.toFixed(p.impressions % 1 === 0 ? 0 : 1)
    case 'ctr': return p.impressions > 0 ? +(100 * p.clicks / p.impressions).toFixed(2) : 0
    case 'position': return +p.position.toFixed(1)
  }
}

/**
 * Trailing 7-day impression-weighted smoothing. Clicks/impressions become the
 * trailing mean; position is impression-weighted (never a mean of averages), so
 * the derived CTR stays consistent. Raw is always the default - smoothing is an
 * explicit, labeled toggle, never a silent substitution.
 */
function smoothPoints(points: SeriesPoint[], window = 7): SeriesPoint[] {
  return points.map((p, i) => {
    const slice = points.slice(Math.max(0, i - window + 1), i + 1)
    const clicks = slice.reduce((s, q) => s + q.clicks, 0)
    const impr = slice.reduce((s, q) => s + q.impressions, 0)
    const wpos = slice.reduce((s, q) => s + q.position * q.impressions, 0)
    return {
      date: p.date,
      clicks: clicks / slice.length,
      impressions: impr / slice.length,
      position: impr > 0 ? wpos / impr : 0,
      provisional: p.provisional,
    }
  })
}

interface LanesProps {
  events: ChangeEvent[]
  enabledTypes: ChangeEventType[]
  selectedId: string | null
  onSelect: (ev: ChangeEvent, cluster: ChangeEvent[]) => void
  onHoverDay: (day: string | null) => void
}

interface ClusterDot { x: number; events: ChangeEvent[] }

/**
 * SVG layer rendered inside the chart (recharts 3 hooks share the exact x-scale):
 * one lane per change type beneath the plot area, with clustered, clickable
 * markers. Must be a child of the chart so the hooks resolve.
 */
function MarkerLanes({ events, enabledTypes, selectedId, onSelect, onHoverDay }: LanesProps) {
  const plot = usePlotArea()
  const scale = useXAxisScale()
  if (!plot || !scale) return null
  const laneTop = plot.y + plot.height + LANE_TOP_GAP

  const lanes = LANE_ORDER.filter((t) => enabledTypes.includes(t))

  return (
    <g>
      {lanes.map((type, li) => {
        const y = laneTop + li * LANE_ROW_H + LANE_ROW_H / 2
        const color = TYPE_META[type].color
        const placed: ClusterDot[] = []
        for (const ev of events) {
          if (ev.type !== type) continue
          const x = scale(ev.day)
          if (x === undefined || Number.isNaN(x)) continue
          const cx = x
          const near = placed.find((c) => Math.abs(c.x - cx) < 9)
          if (near) near.events.push(ev)
          else placed.push({ x: cx, events: [ev] })
        }
        return (
          <g key={type}>
            <text x={plot.x - 8} y={y + 3} textAnchor="end" fontSize={9} fill="#9aa0a6">
              {TYPE_META[type].label}
            </text>
            <line
              x1={plot.x} x2={plot.x + plot.width} y1={y} y2={y}
              stroke="#ffffff0d" strokeWidth={1}
            />
            {placed.map((c) => {
              const lead = c.events[0]
              const selected = c.events.some((e) => e.id === selectedId)
              const pending = lead.effectStatus === 'pending'
              const dead = lead.effectStatus === 'no_data' || lead.measurable === false
              const r = selected ? 5.5 : 4.5
              return (
                <g
                  key={lead.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => onSelect(lead, c.events)}
                  onMouseEnter={() => onHoverDay(lead.day)}
                  onMouseLeave={() => onHoverDay(null)}
                >
                  <title>
                    {lead.summary}
                    {c.events.length > 1 ? ` (+${c.events.length - 1} more)` : ''} · {lead.day}
                  </title>
                  <circle cx={c.x} cy={y} r={9} fill="transparent" />
                  <circle
                    cx={c.x} cy={y} r={r}
                    fill={dead || pending ? '#1a1d27' : color}
                    stroke={color}
                    strokeWidth={1.5}
                    strokeDasharray={dead ? '2 2' : undefined}
                  />
                  {selected && <circle cx={c.x} cy={y} r={r + 3} fill="none" stroke={color} strokeOpacity={0.4} />}
                  {c.events.length > 1 && (
                    <text x={c.x} y={y - 8} textAnchor="middle" fontSize={9} fill={color} fontWeight={600}>
                      {c.events.length}
                    </text>
                  )}
                </g>
              )
            })}
          </g>
        )
      })}
    </g>
  )
}

/**
 * One metric curve. Optionally hosts the marker lanes (single-metric view, or the
 * shared lane strip at the bottom of the small-multiples stack) and/or the X-axis
 * ticks. All panels share identical left/right margins so their x-scales - and
 * therefore the markers - line up vertically.
 */
const BRUSH_H = 22

function MetricPanel({
  points, metric, height, showXTicks, hideArea, lanes, selectedDay, hoveredDay, dateSet,
  smooth, enableBrush, annotations, annotationLabels, comparePoints, onHoverDay, syncId, hideTooltip,
}: {
  points: SeriesPoint[]
  metric: ImpactMetric
  height: number
  showXTicks: boolean
  hideArea?: boolean
  lanes?: LanesProps
  selectedDay?: string
  hoveredDay: string | null
  dateSet: Set<string>
  smooth?: boolean
  enableBrush?: boolean
  annotations?: { date: string; label: string }[]
  annotationLabels?: boolean
  comparePoints?: SeriesPoint[]
  onHoverDay?: (day: string | null) => void
  syncId?: string
  hideTooltip?: boolean
}) {
  const effPoints = useMemo(() => (smooth ? smoothPoints(points) : points), [points, smooth])
  const effCompare = useMemo(
    () => (comparePoints ? (smooth ? smoothPoints(comparePoints) : comparePoints) : null),
    [comparePoints, smooth],
  )
  // Impressions context shown faintly behind the position/CTR curve so you can
  // see how much volume a rank is built on. Uses raw impressions (not smoothed).
  const showImpr = metric === 'position' || metric === 'ctr'
  const chartData = useMemo(
    () => effPoints.map((p, i) => ({
      date: p.date, value: metricValue(p, metric), provisional: p.provisional,
      impr: showImpr ? points[i]?.impressions ?? 0 : 0,
      cmp: effCompare && effCompare[i] ? metricValue(effCompare[i], metric) : undefined,
    })),
    [effPoints, effCompare, points, metric, showImpr],
  )
  const provisional = points.filter((p) => p.provisional)
  const firstProvisional = provisional[0]?.date
  const lastDate = points[points.length - 1]?.date
  const laneCount = lanes ? LANE_ORDER.filter((t) => lanes.enabledTypes.includes(t)).length : 0
  const bottomMargin =
    (lanes ? LANE_TOP_GAP + laneCount * LANE_ROW_H : 0) + (showXTicks ? 22 : 6) + (enableBrush ? BRUSH_H + 6 : 0)

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart
        data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: bottomMargin }}
        syncId={syncId}
        onMouseMove={onHoverDay ? (s: any) => onHoverDay(s?.activeLabel ?? null) : undefined}
        onMouseLeave={onHoverDay ? () => onHoverDay(null) : undefined}
      >
        <defs>
          <linearGradient id={`impactFill-${metric}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4e8af4" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#4e8af4" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff0d" vertical={false} />
        <XAxis
          dataKey="date" scale="point" padding={{ left: 6, right: 6 }}
          tick={showXTicks ? { fontSize: 10, fill: '#9aa0a6' } : false}
          axisLine={showXTicks} tickLine={showXTicks}
          height={showXTicks ? undefined : 6}
          minTickGap={40} tickMargin={6}
        />
        <YAxis
          tick={{ fontSize: 10, fill: '#9aa0a6' }} width={44}
          reversed={metric === 'position'}
          domain={metric === 'position' ? [1, 'auto'] : [0, 'auto']}
          allowDecimals={metric === 'ctr'}
        />
        {showImpr && <YAxis yAxisId="impr" hide domain={[0, 'auto']} />}
        {showImpr && (
          <Bar yAxisId="impr" dataKey="impr" fill="#9aa0a6" fillOpacity={0.12} isAnimationActive={false} />
        )}
        {!hideTooltip && (
          <Tooltip
            contentStyle={{ background: '#1a1d2e', border: '1px solid #ffffff20', borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: '#e8eaed' }}
            formatter={(v: any) => [metric === 'ctr' ? `${v}%` : v, METRIC_LABELS[metric]]}
          />
        )}
        {firstProvisional && lastDate && (
          <ReferenceArea x1={firstProvisional} x2={lastDate} fill="#ffffff" fillOpacity={0.04} stroke="none" ifOverflow="extendDomain" />
        )}
        {hoveredDay && dateSet.has(hoveredDay) && (
          <ReferenceLine x={hoveredDay} stroke="#ffffff30" strokeWidth={1} />
        )}
        {selectedDay && dateSet.has(selectedDay) && (
          <ReferenceLine x={selectedDay} stroke="#4e8af4" strokeWidth={1.5} strokeDasharray="4 2" />
        )}
        {annotations?.map((a) => dateSet.has(a.date) && (
          <ReferenceLine
            key={a.date + a.label} x={a.date} stroke="#fbbf24" strokeOpacity={0.5} strokeDasharray="2 3"
            label={annotationLabels ? { value: a.label, position: 'insideTopRight', fontSize: 9, fill: '#fbbf24' } : undefined}
          />
        ))}
        {effCompare && (
          <Area
            type="monotone" dataKey="cmp" stroke="#9aa0a6" strokeOpacity={0.6} strokeWidth={1.5}
            strokeDasharray="3 3" fill="none" dot={false} isAnimationActive={false}
          />
        )}
        <Area
          type="monotone" dataKey="value" stroke={hideArea ? 'none' : '#4e8af4'} strokeWidth={2}
          fill={hideArea ? 'none' : `url(#impactFill-${metric})`} dot={false} isAnimationActive={false}
        />
        {lanes && <MarkerLanes {...lanes} />}
        {enableBrush && chartData.length > 1 && (
          <Brush
            dataKey="date" height={BRUSH_H} y={height - BRUSH_H - 1}
            travellerWidth={8} stroke="#4e8af4" fill="#14161f"
            tickFormatter={() => ''}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  )
}

export function ImpactTimeline({
  points, events, metric, enabledTypes, selectedId, onSelectEvent, onHoverDay, hoveredDay, smooth,
  annotations, comparePoints,
}: {
  points: SeriesPoint[]
  events: ChangeEvent[]
  metric: ImpactMetricSel
  enabledTypes: ChangeEventType[]
  selectedId: string | null
  onSelectEvent: (ev: ChangeEvent, cluster: ChangeEvent[]) => void
  onHoverDay: (day: string | null) => void
  hoveredDay: string | null
  smooth?: boolean
  annotations?: { date: string; label: string }[]
  comparePoints?: SeriesPoint[]
}) {
  const dateSet = useMemo(() => new Set(points.map((p) => p.date)), [points])
  const selectedDay = events.find((e) => e.id === selectedId)?.day
  const lanes: LanesProps = { events, enabledTypes, selectedId, onSelect: onSelectEvent, onHoverDay }
  const laneCount = LANE_ORDER.filter((t) => enabledTypes.includes(t)).length

  if (metric === 'all') {
    return (
      <div className="space-y-1">
        {/* Shared cross-hair readout: all four metrics for the hovered day at once. */}
        <CrosshairReadout points={points} hoveredDay={hoveredDay} smooth={smooth} />
        {SMALL_MULTIPLE_ORDER.map((m) => (
          <div key={m}>
            <div className="text-[10px] uppercase tracking-wider text-[#9aa0a6]/70 pl-12 -mb-1">
              {METRIC_LABELS[m]}{m === 'position' && ' · lower is better'}{smooth && ' · 7-day smoothed'}
            </div>
            <MetricPanel
              points={points} metric={m} height={96} showXTicks={false} smooth={smooth}
              annotations={annotations} onHoverDay={onHoverDay} syncId="impact-all"
              selectedDay={selectedDay} hoveredDay={hoveredDay} dateSet={dateSet}
            />
          </div>
        ))}
        {/* Shared event lane strip + x-axis, aligned to the curves above. */}
        <MetricPanel
          points={points} metric="clicks" height={44 + LANE_TOP_GAP + laneCount * LANE_ROW_H}
          showXTicks hideArea lanes={lanes} annotations={annotations} annotationLabels
          onHoverDay={onHoverDay} syncId="impact-all" hideTooltip
          selectedDay={selectedDay} hoveredDay={hoveredDay} dateSet={dateSet}
        />
      </div>
    )
  }

  const bottomExtra = LANE_TOP_GAP + laneCount * LANE_ROW_H
  return (
    <MetricPanel
      points={points} metric={metric} height={150 + bottomExtra + 22 + BRUSH_H + 6}
      showXTicks enableBrush smooth={smooth} lanes={lanes} onHoverDay={onHoverDay}
      annotations={annotations} annotationLabels comparePoints={comparePoints}
      selectedDay={selectedDay} hoveredDay={hoveredDay} dateSet={dateSet}
    />
  )
}

/**
 * Compact readout pinned above the small-multiples stack: shows every metric for
 * the cross-hair day at once, so the shared vertical line is actually legible as
 * numbers. Mirrors the curves - smoothed when smoothing is on - so it never
 * contradicts what's drawn. Reserves its height to avoid layout shift on hover.
 */
function CrosshairReadout({
  points, hoveredDay, smooth,
}: {
  points: SeriesPoint[]
  hoveredDay: string | null
  smooth?: boolean
}) {
  const effPoints = useMemo(() => (smooth ? smoothPoints(points) : points), [points, smooth])
  const p = hoveredDay ? effPoints.find((q) => q.date === hoveredDay) : undefined
  const fmt = (n: number) => n.toLocaleString('en-US')
  return (
    <div className="flex items-center gap-x-4 gap-y-0.5 flex-wrap pl-12 h-5 text-[11px]">
      {p ? (
        <>
          <span className="text-[#e8eaed] font-medium tabular-nums">{p.date}</span>
          <span className="text-[#9aa0a6]">Clicks <span className="text-[#e8eaed] tabular-nums">{fmt(metricValue(p, 'clicks'))}</span></span>
          <span className="text-[#9aa0a6]">Impr <span className="text-[#e8eaed] tabular-nums">{fmt(metricValue(p, 'impressions'))}</span></span>
          <span className="text-[#9aa0a6]">CTR <span className="text-[#e8eaed] tabular-nums">{metricValue(p, 'ctr')}%</span></span>
          <span className="text-[#9aa0a6]">Pos <span className="text-[#e8eaed] tabular-nums">{metricValue(p, 'position')}</span></span>
          {p.provisional && <span className="text-amber-400/70">provisional</span>}
        </>
      ) : (
        <span className="text-[#9aa0a6]/50">Hover any chart to read all four metrics for that day</span>
      )}
    </div>
  )
}
