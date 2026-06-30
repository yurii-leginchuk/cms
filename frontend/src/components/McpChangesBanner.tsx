import { Link } from 'react-router-dom'
import { Sparkles, ChevronRight } from 'lucide-react'
import { useMcpChangeCounts } from '@/hooks/useMcpChanges'
import type { McpChangeModule } from '@/api/mcpChanges'

/**
 * Quiet, persistent blue banner shown on a module page (Meta / Schema / Images)
 * when AI proposals await review. Links to the Overview filtered to that module.
 * Renders nothing when there are no pending changes for the module.
 */
export function McpChangesBanner({
  siteId,
  module,
}: {
  siteId: string
  module: McpChangeModule
}) {
  const { data: counts } = useMcpChangeCounts(siteId)
  const n = counts?.[module] ?? 0
  if (!n) return null

  return (
    <Link
      to={`/sites/${siteId}?module=${module}`}
      className="flex items-center justify-between gap-3 rounded-lg border border-[#4e8af4]/30 bg-[#4e8af4]/10 px-4 py-2.5 hover:bg-[#4e8af4]/15 transition-colors"
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <Sparkles className="size-4 text-[#4e8af4] flex-shrink-0" />
        <span className="text-[13px] text-[#e8eaed]">
          <strong className="font-semibold">{n}</strong> AI change{n === 1 ? '' : 's'} awaiting
          review
        </span>
      </div>
      <span className="flex items-center gap-1 text-[12px] text-[#4e8af4] font-medium flex-shrink-0">
        Review
        <ChevronRight className="size-3.5" />
      </span>
    </Link>
  )
}
