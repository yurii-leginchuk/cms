import type { ChangeEvent, ChangeEventCategory } from '@/api/impact'

/**
 * Display-clustering window (days) — MUST match the backend GROUP_WINDOW_DAYS.
 * The frontend re-clusters the *enabled* events so toggling a category re-runs
 * the sweep (a schema+meta cluster becomes just meta when schema is hidden).
 */
export const GROUP_WINDOW_DAYS = 2

/** Per-category label + color + whether it moves the clicks/impressions curve. */
export const CATEGORY_META: Record<
  ChangeEventCategory,
  { label: string; color: string; measurable: boolean }
> = {
  'meta-title': { label: 'Title', color: '#4e8af4', measurable: true },
  'meta-description': { label: 'Description', color: '#38bdf8', measurable: true },
  technical: { label: 'Technical', color: '#a78bfa', measurable: true },
  schema: { label: 'Schema', color: '#34d399', measurable: false },
  alt: { label: 'ALT text', color: '#fbbf24', measurable: false },
  task: { label: 'Tasks', color: '#fb7185', measurable: false },
  manual: { label: 'Manual', color: '#94a3b8', measurable: false },
}

export const CATEGORY_ORDER: ChangeEventCategory[] = [
  'meta-title', 'meta-description', 'technical', 'schema', 'alt', 'task', 'manual',
]

/** Inclusive whole-day difference b - a (both YYYY-MM-DD), UTC-noon anchored. */
export function diffDays(a: string, b: string): number {
  const ta = Date.parse(`${a}T12:00:00Z`)
  const tb = Date.parse(`${b}T12:00:00Z`)
  return Math.round((tb - ta) / 86_400_000)
}

/** Total order (day, ts, id) — deterministic, matching the backend sort. */
function cmpAsc(a: ChangeEvent, b: ChangeEvent): number {
  if (a.day !== b.day) return a.day < b.day ? -1 : 1
  if (a.ts !== b.ts) return a.ts < b.ts ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export interface EventCluster {
  anchorDay: string
  firstDay: string
  lastDay: string
  events: ChangeEvent[]
}

/**
 * Anchor-fixed greedy clustering over the given (already category-filtered)
 * events. Mirrors backend change-cluster.ts so the dot count, CSV and dialog
 * always agree regardless of zoom.
 */
export function clusterEvents(
  events: ChangeEvent[],
  windowDays = GROUP_WINDOW_DAYS,
): EventCluster[] {
  const sorted = [...events].sort(cmpAsc)
  const out: EventCluster[] = []
  let i = 0
  while (i < sorted.length) {
    const anchor = sorted[i]
    const members: ChangeEvent[] = [anchor]
    let j = i + 1
    while (j < sorted.length && diffDays(anchor.day, sorted[j].day) <= windowDays) {
      members.push(sorted[j])
      j++
    }
    out.push({
      anchorDay: anchor.day,
      firstDay: members[0].day,
      lastDay: members[members.length - 1].day,
      events: members,
    })
    i = j
  }
  return out
}

/** Distinct categories in a cluster with their event counts, in canonical order. */
export function categoryMix(events: ChangeEvent[]): { category: ChangeEventCategory; count: number }[] {
  const counts = new Map<ChangeEventCategory, number>()
  for (const e of events) counts.set(e.category, (counts.get(e.category) ?? 0) + 1)
  return CATEGORY_ORDER.filter((c) => counts.has(c)).map((c) => ({ category: c, count: counts.get(c)! }))
}

/** Distinct affected pages (non-null pageId) in a cluster. */
export function clusterPageCount(events: ChangeEvent[]): number {
  return new Set(events.filter((e) => e.pageId).map((e) => e.pageId)).size
}
