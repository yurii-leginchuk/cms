import { Link } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { ScanSearch, ChevronRight, AlertTriangle } from 'lucide-react'
import { useCrawlSummary, useCrawlLatestDigest } from '@/hooks/useCrawl'
import { ChangeDigestChips } from './ChangeDigest'

/**
 * Compact Index-Status summary for the site Overview: honest coverage (with
 * denominators) + what the last scan changed. Deep-links into the full module.
 */
export function IndexStatusOverviewCard({ siteId, parsing }: { siteId: string; parsing?: boolean }) {
  const { data: summary } = useCrawlSummary(siteId, parsing)
  const { data: digest } = useCrawlLatestDigest(siteId, parsing)

  const to = `/sites/${siteId}/index-status`

  return (
    <Link
      to={to}
      className="block rounded-xl border border-white/8 bg-[#1a1d27] px-5 py-4 hover:bg-[#1f222e] hover:border-white/12 transition-colors group"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="size-10 rounded-lg bg-[#4e8af4]/15 flex items-center justify-center flex-shrink-0">
            <ScanSearch className="size-5 text-[#4e8af4]" />
          </div>
          <div className="min-w-0">
            <p className="text-[14px] font-medium text-[#e8eaed]">Index Status</p>
            {!summary ? (
              <p className="text-[12px] text-[#9aa0a6] mt-0.5">Loading…</p>
            ) : !summary.connected ? (
              <p className="text-[12px] text-[#9aa0a6] mt-0.5 inline-flex items-center gap-1">
                <AlertTriangle className="size-3 text-amber-400" />
                Connect Search Console to see index status
              </p>
            ) : (
              <p className="text-[12px] text-[#9aa0a6] mt-0.5">
                <span className="text-emerald-400">{summary.coverage.indexed} indexed</span>
                {' · '}
                <span className="text-amber-400">{summary.coverage.notIndexed} not indexed</span>
                {summary.coverage.neverChecked > 0 && <> · {summary.coverage.neverChecked} never checked</>}
                <span className="text-[#9aa0a6]/60"> · of {summary.coverage.total}</span>
              </p>
            )}
          </div>
        </div>
        <ChevronRight className="size-5 text-[#9aa0a6] group-hover:text-[#e8eaed] transition-colors flex-shrink-0" />
      </div>

      {summary?.connected && digest && (digest.hasChanges || digest.finishedAt) && (
        <div className="mt-3 pt-3 border-t border-white/8 flex items-center justify-between gap-3">
          <ChangeDigestChips digest={digest} />
          {(digest.finishedAt || digest.startedAt) && (
            <span className="text-[11px] text-[#9aa0a6]/60 flex-shrink-0">
              scanned {formatDistanceToNow(new Date(digest.finishedAt ?? digest.startedAt!), { addSuffix: true })}
            </span>
          )}
        </div>
      )}
    </Link>
  )
}
