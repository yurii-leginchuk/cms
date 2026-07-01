import type { DerivedStatus } from '@/api/crawl'
import { statusMeta } from './statusMeta'

/** A single derived-status pill. `null` renders the neutral "Never checked". */
export function IndexStatusChip({ status }: { status: DerivedStatus | null | undefined }) {
  const m = statusMeta(status)
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium border ${m.cls}`}
    >
      <span className={`size-1.5 rounded-full ${m.dot} ${m.pulse ? 'animate-pulse' : ''}`} />
      {m.label}
    </span>
  )
}
