import { Link, useParams, Navigate } from 'react-router-dom'
import { ChevronRight, ExternalLink, Braces, Sparkles } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import SchemaPanel from '@/components/SchemaPanel'
import SchemaAssistantPanel from '@/components/SchemaAssistantPanel'
import { useSite } from '@/hooks/useSites'
import { usePage } from '@/hooks/usePages'

export default function SchemaDetailPage() {
  const { id, pageId } = useParams<{ id: string; pageId: string }>()
  const { data: site, isLoading: siteLoading } = useSite(id!)
  const { data: page, isLoading } = usePage(id!, pageId ?? null)

  if (!id || !pageId) return <Navigate to="/sites" replace />

  const path = page?.url.replace(/^https?:\/\/[^/]+/, '') || '/'

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="px-8 pt-8 pb-4 border-b border-white/8 flex-shrink-0">
        <div className="flex items-center gap-2 text-[13px] mb-4">
          <Link to="/sites" className="text-[#9aa0a6] hover:text-[#e8eaed] transition-colors">
            Sites
          </Link>
          <ChevronRight className="size-3.5 text-[#9aa0a6]/40" />
          <Link to={`/sites/${id}`} className="text-[#9aa0a6] hover:text-[#e8eaed] transition-colors">
            {siteLoading ? <Skeleton className="h-4 w-24 bg-white/5 inline-block" /> : site?.name}
          </Link>
          <ChevronRight className="size-3.5 text-[#9aa0a6]/40" />
          <Link to={`/sites/${id}/schemas`} className="text-[#9aa0a6] hover:text-[#e8eaed] transition-colors">
            Schemas
          </Link>
          <ChevronRight className="size-3.5 text-[#9aa0a6]/40" />
          <span className="text-[#e8eaed] truncate max-w-[280px]" title={page?.url}>
            {isLoading ? <Skeleton className="h-4 w-40 bg-white/5 inline-block" /> : path}
          </span>
        </div>

        <h1 className="text-xl font-semibold text-[#e8eaed] tracking-tight flex items-center gap-2">
          <Braces className="size-5 text-[#4e8af4]" />
          Structured Data
        </h1>
        {page && (
          <a
            href={page.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[12px] text-[#4e8af4] hover:underline mt-1 inline-flex items-center gap-1"
            title={page.url}
          >
            <span className="truncate max-w-[480px]">{path}</span>
            <ExternalLink className="size-3 flex-shrink-0" />
          </a>
        )}
      </div>

      {/* Two columns: left = managed schemas, right = AI assistant */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left: schema panel (scrolls) */}
        <div className="flex-1 min-w-0 overflow-y-auto px-8 py-6">
          <div className="max-w-3xl">
            {isLoading ? (
              <div className="space-y-3">
                {[90, 70, 80].map((w, i) => (
                  <Skeleton key={i} className="h-10 bg-white/5 rounded-lg" style={{ width: `${w}%` }} />
                ))}
              </div>
            ) : (
              <SchemaPanel siteId={id} pageId={pageId} />
            )}
          </div>
        </div>

        {/* Right: schema assistant */}
        <div className="w-[40%] min-w-[480px] max-w-[680px] flex-shrink-0 flex flex-col min-h-0 border-l border-white/8">
          <div className="flex-shrink-0 px-4 py-3 border-b border-white/8 flex items-center gap-2">
            <Sparkles className="size-4 text-[#4e8af4]" />
            <span className="text-[13px] font-semibold text-[#e8eaed]">Schema assistant</span>
          </div>
          <div className="flex-1 min-h-0">
            <SchemaAssistantPanel siteId={id} pageId={pageId} pageUrl={page?.url} />
          </div>
        </div>
      </div>
    </div>
  )
}
