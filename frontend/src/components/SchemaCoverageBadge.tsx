import { Braces, AlertTriangle, Upload, UploadCloud } from 'lucide-react'
import { useSchemaCoverage } from '@/hooks/useSchema'

/** Compact site-wide structured-data coverage stat for the Pages header. */
export default function SchemaCoverageBadge({ siteId }: { siteId: string }) {
  const { data } = useSchemaCoverage(siteId)
  if (!data || data.checked === 0) return null

  const pct = data.checked > 0 ? Math.round((data.withSchema / data.checked) * 100) : 0

  return (
    <div className="flex items-center gap-3 text-[12px] text-[#9aa0a6] flex-shrink-0">
      <span className="inline-flex items-center gap-1.5" title="Pages with schema / pages checked">
        <Braces className="size-3.5 text-[#4e8af4]" />
        {data.withSchema}/{data.checked} ({pct}%)
      </span>
      {data.withErrors > 0 && (
        <span className="inline-flex items-center gap-1 text-amber-400" title="Pages with schema errors">
          <AlertTriangle className="size-3.5" />
          {data.withErrors}
        </span>
      )}
      {data.publishedPages > 0 && (
        <span className="inline-flex items-center gap-1 text-emerald-400" title="Pages synced to WordPress">
          <Upload className="size-3.5" />
          {data.publishedPages}
        </span>
      )}
      {data.pendingChanges > 0 && (
        <span className="inline-flex items-center gap-1 text-amber-400" title="Schema changes awaiting Apply">
          <UploadCloud className="size-3.5" />
          {data.pendingChanges}
        </span>
      )}
    </div>
  )
}
