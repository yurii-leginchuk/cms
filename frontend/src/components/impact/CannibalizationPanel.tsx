import { Loader2, GitFork, ExternalLink } from 'lucide-react'
import { useCannibalization } from '@/hooks/useImpact'

/**
 * Site-wide keyword cannibalization: queries where 2+ of the site's pages draw
 * impressions and split ranking signals. Read-time off GSC (24h cache). Each
 * entry lists the competing pages, best (lowest) average position first.
 */
export function CannibalizationPanel({
  siteId, from, to,
}: {
  siteId: string
  from: string
  to: string
}) {
  const { data, isLoading, isError } = useCannibalization(siteId, { from, to })
  const conflicts = data?.conflicts ?? []

  return (
    <div className="rounded-xl border border-white/8 bg-[#14161f] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/8">
        <GitFork className="size-3.5 text-[#a78bfa]" />
        <span className="text-[12px] font-medium text-[#e8eaed]">Keyword cannibalization</span>
        {data && (
          <span className="text-[11px] text-[#9aa0a6]/70">
            · {conflicts.length} quer{conflicts.length === 1 ? 'y' : 'ies'} with competing pages
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 px-4 py-6 text-[12px] text-[#9aa0a6]">
          <Loader2 className="size-3.5 animate-spin" /> Scanning queries…
        </div>
      ) : isError ? (
        <div className="px-4 py-6 text-[12px] text-[#9aa0a6]">Couldn't load cannibalization data. Try again in a moment.</div>
      ) : conflicts.length === 0 ? (
        <div className="px-4 py-6 text-[12px] text-[#9aa0a6]/80">
          No cannibalization here - no single query has two or more of your pages competing above the
          impression threshold in this range.
        </div>
      ) : (
        <div className="divide-y divide-white/5">
          {conflicts.map((c) => (
            <div key={c.query} className="px-4 py-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] text-[#e8eaed] truncate" title={c.query}>{c.query}</span>
                <span className="text-[11px] text-[#9aa0a6] tabular-nums flex-shrink-0">
                  {c.totalImpressions.toLocaleString('en-US')} impr · {c.totalClicks.toLocaleString('en-US')} clk
                </span>
              </div>
              <div className="mt-1 space-y-0.5">
                {c.competingPages.map((p, i) => (
                  <div key={p.page} className="flex items-center gap-2 text-[11px]">
                    <span className={i === 0 ? 'text-emerald-400 tabular-nums w-12' : 'text-[#9aa0a6] tabular-nums w-12'}>
                      #{p.position.toFixed(1)}
                    </span>
                    <a href={p.page} target="_blank" rel="noopener noreferrer"
                      className="text-[#9aa0a6] hover:text-[#4e8af4] inline-flex items-center gap-1 truncate min-w-0"
                      title={p.page}>
                      <span className="truncate">{p.page}</span>
                      <ExternalLink className="size-2.5 flex-shrink-0 opacity-50" />
                    </a>
                    <span className="text-[#9aa0a6]/50 tabular-nums flex-shrink-0 ml-auto">
                      {p.clicks.toLocaleString('en-US')} clk
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="px-4 py-2 text-[10px] text-[#9aa0a6]/60">
            Sorted by best average position first. Consider merging or differentiating these pages so
            they stop splitting ranking signals. This is average position, not a literal rank.
          </div>
        </div>
      )}
    </div>
  )
}
