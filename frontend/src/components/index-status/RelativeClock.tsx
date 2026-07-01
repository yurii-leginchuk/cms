import { formatDistanceToNow } from 'date-fns'

/**
 * A single timestamp rendered as relative age with the absolute value on hover.
 * The two clocks (Google's crawl time vs our inspection time) are NEVER merged —
 * callers place them in separate, subject-verb-labelled columns/cards.
 */
export function RelativeClock({
  ts,
  emptyLabel = '—',
  staleDays,
}: {
  ts: string | null | undefined
  emptyLabel?: string
  /** if the age exceeds this, render amber (stale ≠ broken) */
  staleDays?: number
}) {
  if (!ts) return <span className="text-[#9aa0a6]/30 text-[13px]">{emptyLabel}</span>
  const d = new Date(ts)
  const ageDays = (Date.now() - d.getTime()) / 86_400_000
  const stale = staleDays != null && ageDays > staleDays
  return (
    <span
      className={`text-[12px] tabular-nums ${stale ? 'text-amber-400/90' : 'text-[#9aa0a6]'}`}
      title={d.toLocaleString()}
    >
      {formatDistanceToNow(d, { addSuffix: true })}
    </span>
  )
}
