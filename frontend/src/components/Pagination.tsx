import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Windowed page list with ellipsis, e.g. [1, '…', 4, 5, 6, '…', 12]. */
function buildPages(current: number, total: number): (number | 'gap')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)

  const pages = new Set<number>([1, total, current, current - 1, current + 1])
  // Keep the ends padded so the control doesn't jump width near the edges.
  if (current <= 3) [2, 3, 4].forEach((p) => pages.add(p))
  if (current >= total - 2) [total - 1, total - 2, total - 3].forEach((p) => pages.add(p))

  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b)
  const out: (number | 'gap')[] = []
  let prev = 0
  for (const p of sorted) {
    if (p - prev > 1) out.push('gap')
    out.push(p)
    prev = p
  }
  return out
}

export default function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number
  totalPages: number
  onChange: (page: number) => void
}) {
  if (totalPages <= 1) return null
  const items = buildPages(page, totalPages)

  const btn =
    'h-7 min-w-7 px-2 inline-flex items-center justify-center rounded-md text-[12px] transition-colors disabled:opacity-30'

  return (
    <div className="flex items-center gap-1">
      <button
        className={cn(btn, 'text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-white/5')}
        onClick={() => onChange(Math.max(1, page - 1))}
        disabled={page <= 1}
        aria-label="Previous page"
      >
        <ChevronLeft className="size-4" />
      </button>

      {items.map((it, i) =>
        it === 'gap' ? (
          <span key={`gap-${i}`} className="h-7 px-1 inline-flex items-center text-[#9aa0a6]/50">
            …
          </span>
        ) : (
          <button
            key={it}
            onClick={() => onChange(it)}
            aria-current={it === page ? 'page' : undefined}
            className={cn(
              btn,
              it === page
                ? 'bg-[#4e8af4]/15 text-[#4e8af4] font-medium'
                : 'text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-white/5',
            )}
          >
            {it}
          </button>
        ),
      )}

      <button
        className={cn(btn, 'text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-white/5')}
        onClick={() => onChange(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
        aria-label="Next page"
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  )
}
