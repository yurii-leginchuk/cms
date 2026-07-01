import { ExternalLink, AlertTriangle, Layers } from 'lucide-react'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet'
import { EffectQueriesSection } from './EffectCard'
import { CATEGORY_META, CATEGORY_ORDER, categoryMix, clusterPageCount } from './cluster'
import type { ChangeEvent, ChangeEventCategory } from '@/api/impact'

/** firstDay + 42 (the earliest a post-change read is trustworthy). */
function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

function pagePath(url: string): string {
  return url.replace(/^https?:\/\/[^/]+/, '') || url || '/'
}

/**
 * The grouped-marker breakdown, in a Sheet. Shows every change in the clustered
 * window — grouped by category, then page — with the honest correlation callout
 * (grouping CREATES confounding), the confounder verdict, and the per-query
 * drill-down for measured meta changes. NEVER a rolled-up "+X clicks" total.
 */
export function ClusterSheet({
  cluster, siteId, onClose, onOpenPage,
}: {
  cluster: ChangeEvent[] | null
  siteId: string
  onClose: () => void
  onOpenPage?: (pageId: string, pageUrl: string) => void
}) {
  const open = !!cluster && cluster.length > 0
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent side="right" className="sm:max-w-xl w-full overflow-y-auto">
        {open && cluster && <ClusterBody events={cluster} siteId={siteId} onOpenPage={onOpenPage} />}
      </SheetContent>
    </Sheet>
  )
}

function ClusterBody({
  events, siteId, onOpenPage,
}: {
  events: ChangeEvent[]
  siteId: string
  onOpenPage?: (pageId: string, pageUrl: string) => void
}) {
  const mix = categoryMix(events)
  const pages = clusterPageCount(events)
  const days = events.map((e) => e.day).sort()
  const firstDay = days[0]
  const lastDay = days[days.length - 1]
  const range = firstDay === lastDay ? firstDay : `${firstDay} – ${lastDay}`
  const multi = mix.length > 1 || events.length > 1
  const confounded = events.filter((e) => e.confoundedWith > 0).length

  const byCategory = CATEGORY_ORDER
    .map((cat) => ({ cat, rows: events.filter((e) => e.category === cat) }))
    .filter((g) => g.rows.length > 0)

  return (
    <>
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Layers className="size-4 text-[#4e8af4]" />
            {events.length} change{events.length === 1 ? '' : 's'}
            {pages > 0 && <span className="text-[#9aa0a6] font-normal">· {pages} page{pages === 1 ? '' : 's'}</span>}
          </SheetTitle>
          <SheetDescription>{range}</SheetDescription>
        </SheetHeader>

        <div className="px-4 pb-6 space-y-4 overflow-y-auto">
          {/* Category mix */}
          <div className="flex flex-wrap gap-1.5">
            {mix.map((m) => (
              <span key={m.category} className="inline-flex items-center gap-1.5 text-[11px] text-[#c8cad0] bg-white/5 rounded-md px-2 py-0.5">
                <span className="size-2 rounded-full" style={{ background: CATEGORY_META[m.category].color }} />
                {m.count} {CATEGORY_META[m.category].label}
              </span>
            ))}
          </div>

          {/* Correlation callout — grouping creates confounding by definition */}
          {multi && (
            <div className="rounded-lg border border-amber-400/25 bg-amber-400/[0.06] px-3 py-2.5 flex items-start gap-2">
              <AlertTriangle className="size-4 text-amber-400 mt-0.5 flex-shrink-0" />
              <p className="text-[12px] text-[#e8eaed] leading-relaxed">
                These changed together in this window — you <span className="font-medium">can't separate their individual effects</span> on the curve.
              </p>
            </div>
          )}

          {/* Confounder verdict */}
          {confounded > 0 && (
            <p className="text-[12px] text-[#9aa0a6]">
              {confounded} of these {confounded === 1 ? 'change shares its page' : 'changes share their page'} with other changes in the 28-day measurement window.
            </p>
          )}

          {/* Earliest trustworthy read */}
          <p className="text-[11px] text-[#9aa0a6]/70">
            Earliest trustworthy read: <span className="text-[#c8cad0]">{addDays(firstDay, 42)}</span> (≈6 weeks after the change; Google needs time to re-crawl, re-index and settle).
          </p>

          {/* Grouped by category → page */}
          <div className="space-y-4">
            {byCategory.map(({ cat, rows }) => (
              <CategoryGroup
                key={cat}
                cat={cat}
                rows={rows}
                siteId={siteId}
                onOpenPage={onOpenPage}
              />
            ))}
          </div>
        </div>
    </>
  )
}

function CategoryGroup({
  cat, rows, siteId, onOpenPage,
}: {
  cat: ChangeEventCategory
  rows: ChangeEvent[]
  siteId: string
  onOpenPage?: (pageId: string, pageUrl: string) => void
}) {
  const meta = CATEGORY_META[cat]
  return (
    <div className="rounded-xl border border-white/8 bg-[#14161f] overflow-hidden">
      <div className="px-3 py-2 border-b border-white/8 flex items-center gap-2">
        <span className="size-2 rounded-full" style={{ background: meta.color }} />
        <span className="text-[12px] font-semibold text-[#e8eaed]">{meta.label}</span>
        <span className="text-[11px] text-[#9aa0a6]">{rows.length}</span>
        {!meta.measurable && (
          <span className="ml-auto text-[10px] text-[#9aa0a6]/70">timing only — not in the clicks curve</span>
        )}
      </div>
      <div className="divide-y divide-white/6">
        {rows.map((e) => (
          <div key={e.id} className="px-3 py-2.5 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] text-[#e8eaed] truncate">{e.summary}</span>
              <div className="flex items-center gap-2 flex-shrink-0">
                {e.taskUrl && (
                  <a href={e.taskUrl} target="_blank" rel="noopener noreferrer" className="text-[#9aa0a6] hover:text-[#e8eaed]" title="Open in Asana">
                    <ExternalLink className="size-3.5" />
                  </a>
                )}
                {e.pageId && onOpenPage && (
                  <button
                    onClick={() => onOpenPage(e.pageId!, e.pageUrl)}
                    className="text-[11px] text-[#4e8af4] hover:underline"
                    title="Open this page's timeline"
                  >
                    {pagePath(e.pageUrl)}
                  </button>
                )}
                {!e.pageId && e.scope === 'sitewide' && (
                  <span className="text-[11px] text-[#9aa0a6]">sitewide</span>
                )}
              </div>
            </div>
            {(e.before || e.after) && (
              <div className="flex items-center gap-2 text-[11px] min-w-0 flex-wrap">
                {e.before && <span className="text-[#9aa0a6]/70 line-through break-all">{e.before}</span>}
                <span className="text-[#4e8af4] break-all">{e.after}</span>
              </div>
            )}
            {/* Per-query drill-down for a measured meta change (reused verbatim). */}
            {e.effectId && (
              <EffectQueriesSection siteId={siteId} effectId={e.effectId} measured={e.effectStatus === 'measured'} />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
