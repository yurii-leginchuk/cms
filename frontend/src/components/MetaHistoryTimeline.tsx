import { formatDistanceToNow, format } from 'date-fns'
import { Skeleton } from '@/components/ui/skeleton'
import type { MetaHistoryEntry, MetaHistoryField } from '@/api/pages'

function trunc(s: string | null | undefined, max: number) {
  if (!s) return null
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

function relativeTime(date: string | null) {
  if (!date) return 'Never'
  return formatDistanceToNow(new Date(date), { addSuffix: true })
}

const FIELD_STYLES: Record<MetaHistoryField, { color: string; bg: string; label: string }> = {
  title: { color: 'text-[#4e8af4]', bg: 'bg-[#4e8af4]/15', label: 'Title' },
  description: { color: 'text-violet-400', bg: 'bg-violet-400/15', label: 'Description' },
  noindex: { color: 'text-amber-400', bg: 'bg-amber-400/15', label: 'Robots' },
  nofollow: { color: 'text-amber-400', bg: 'bg-amber-400/15', label: 'Nofollow' },
  canonical: { color: 'text-emerald-400', bg: 'bg-emerald-400/15', label: 'Canonical' },
  ogTitle: { color: 'text-sky-400', bg: 'bg-sky-400/15', label: 'OG Title' },
  ogDescription: { color: 'text-sky-400', bg: 'bg-sky-400/15', label: 'OG Desc' },
  ogImage: { color: 'text-sky-400', bg: 'bg-sky-400/15', label: 'OG Image' },
}

export function MetaHistoryTimeline({
  entries,
  isLoading,
}: {
  entries: MetaHistoryEntry[]
  isLoading: boolean
}) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="size-6 rounded-full bg-white/5 flex-shrink-0 mt-0.5" />
            <div className="space-y-1.5 flex-1">
              <Skeleton className="h-3 w-20 bg-white/5 rounded" />
              <Skeleton className="h-3 w-full bg-white/5 rounded" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (entries.length === 0) {
    return <p className="text-[12px] text-[#9aa0a6] italic py-2">No changes yet</p>
  }

  return (
    <div className="space-y-0">
      {entries.map((entry, i) => {
        const style = FIELD_STYLES[entry.field] ?? FIELD_STYLES.title
        return (
          <div key={entry.id} className="flex gap-3 group">
            <div className="flex flex-col items-center flex-shrink-0">
              <div className={`size-2 rounded-full mt-1.5 flex-shrink-0 ${style.color.replace('text-', 'bg-')}`} />
              {i < entries.length - 1 && <div className="w-px flex-1 bg-white/8 mt-1" />}
            </div>
            <div className="pb-4 flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${style.bg} ${style.color}`}>
                  {style.label}
                </span>
                <span className="text-[11px] text-[#9aa0a6]">{relativeTime(entry.createdAt)}</span>
                <span className="text-[10px] text-[#9aa0a6]/40 ml-auto">
                  {format(new Date(entry.createdAt), 'MMM d, HH:mm')}
                </span>
              </div>
              <div className="space-y-1">
                {entry.oldValue && (
                  <div className="flex items-start gap-1.5">
                    <span className="text-[10px] text-[#9aa0a6]/50 uppercase mt-0.5 w-5 flex-shrink-0">was</span>
                    <p className="text-[12px] text-[#9aa0a6] line-through leading-snug break-words min-w-0">
                      {trunc(entry.oldValue, 80)}
                    </p>
                  </div>
                )}
                <div className="flex items-start gap-1.5">
                  <span className="text-[10px] text-emerald-400/70 uppercase mt-0.5 w-5 flex-shrink-0">now</span>
                  <p className="text-[12px] text-[#e8eaed] leading-snug break-words min-w-0">
                    {entry.newValue ? trunc(entry.newValue, 80) : <span className="italic text-[#9aa0a6]">cleared</span>}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
