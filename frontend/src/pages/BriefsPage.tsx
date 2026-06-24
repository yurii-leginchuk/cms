import { useNavigate, useParams, Navigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  FileText, ExternalLink, Loader2, Trash2, Pencil, Download, Plus,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useBriefs, useDeleteBrief, useExportBrief } from '@/hooks/useBriefs'
import { useCreateSession } from '@/hooks/useAgent'
import type { Brief } from '@/api/briefs'

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  in_progress: 'In Progress',
  applied: 'Applied',
}
const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-[#4e8af4]/15 text-[#4e8af4]',
  in_progress: 'bg-amber-500/15 text-amber-400',
  applied: 'bg-emerald-500/15 text-emerald-400',
}

function briefType(b: Brief): 'new_page_draft' | 'existing_page_rewrite' {
  return b.briefType ?? (b.pageId ? 'existing_page_rewrite' : 'new_page_draft')
}

function BriefCard({ brief, siteId }: { brief: Brief; siteId: string }) {
  const navigate = useNavigate()
  const del = useDeleteBrief(siteId)
  const exportBrief = useExportBrief(siteId)

  const type = briefType(brief)

  const handleExport = async () => {
    try {
      const res = await exportBrief.mutateAsync(brief.id)
      if (res.kind === 'gdoc' && res.url) {
        window.open(res.url, '_blank', 'noopener,noreferrer')
        toast.success('Google Doc created')
      } else {
        toast.success('Downloaded .docx')
      }
    } catch {
      toast.error('Export failed')
    }
  }

  return (
    <div className="rounded-xl border border-white/8 bg-[#1a1d27] overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        <FileText className="size-4 text-[#4e8af4] flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-medium text-[#e8eaed] truncate">
              {brief.name || brief.proposedMetaTitle || brief.pageUrl}
            </span>
            <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0', STATUS_STYLES[brief.status])}>
              {STATUS_LABEL[brief.status] ?? brief.status}
            </span>
            <span
              className={cn(
                'text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0',
                type === 'new_page_draft'
                  ? 'bg-violet-500/15 text-violet-400'
                  : 'bg-white/10 text-[#9aa0a6]',
              )}
            >
              {type === 'new_page_draft' ? 'New page' : 'Page rewrite'}
            </span>
          </div>
          <a
            href={brief.pageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-[#9aa0a6] hover:text-[#4e8af4] inline-flex items-center gap-1 mt-0.5 truncate max-w-full"
          >
            {brief.pageUrl}
            <ExternalLink className="size-2.5 flex-shrink-0" />
          </a>
        </div>
        <div className="flex flex-col items-end text-[10px] text-[#9aa0a6]/70 flex-shrink-0">
          <span>Created {new Date(brief.createdAt).toLocaleDateString()}</span>
          <span>Updated {new Date(brief.updatedAt).toLocaleDateString()}</span>
          {brief.status === 'applied' && brief.appliedAt && (
            <span className="text-emerald-400/80">
              Applied {new Date(brief.appliedAt).toLocaleDateString()}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={() => navigate(`/sites/${siteId}/briefs/${brief.id}`)}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-[#4e8af4]/10 text-[#4e8af4] hover:bg-[#4e8af4]/20 transition-colors"
          >
            <Pencil className="size-3" /> Open
          </button>
          <button
            onClick={handleExport}
            disabled={exportBrief.isPending}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-white/5 text-[#e8eaed] hover:bg-white/10 disabled:opacity-50 transition-colors"
          >
            {exportBrief.isPending ? <Loader2 className="size-3 animate-spin" /> : <Download className="size-3" />}
            Export
          </button>
          <button
            onClick={() => {
              if (confirm('Delete this brief permanently?')) del.mutate(brief.id)
            }}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-red-400/80 hover:bg-red-500/10 transition-colors"
          >
            <Trash2 className="size-3" /> Delete
          </button>
        </div>
      </div>
    </div>
  )
}

export default function BriefsPage() {
  const { id: siteId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: briefs = [], isLoading } = useBriefs(siteId ?? '')
  const createSession = useCreateSession(siteId ?? '')

  if (!siteId) return <Navigate to="/sites" replace />

  const handleGenerate = async () => {
    try {
      const session = await createSession.mutateAsync()
      navigate(`/sites/${siteId}/chat`, {
        state: {
          sessionId: session.id,
          seedPrompt:
            'Generate a content brief. Tell me which page URL to optimize, or describe the new page you want to create.',
        },
      })
    } catch {
      toast.error("Couldn't start a brief - try again")
    }
  }

  return (
    <div className="min-h-full">
      <div className="border-b border-white/8 px-8 py-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#e8eaed] tracking-tight">Briefs</h1>
          <p className="text-[13px] text-[#9aa0a6] mt-1">
            Page rewrites and new-page drafts you've saved from the AI assistant.
          </p>
        </div>
        <button
          onClick={handleGenerate}
          disabled={createSession.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#4e8af4] text-white hover:bg-[#4e8af4]/90 disabled:opacity-50 transition-colors"
        >
          {createSession.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          Generate brief
        </button>
      </div>

      <div className="px-8 py-6 max-w-4xl space-y-3">
        {isLoading ? (
          <div className="flex items-center gap-2 text-[#9aa0a6] text-sm">
            <Loader2 className="size-4 animate-spin" /> Loading briefs…
          </div>
        ) : briefs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 px-6 py-12 text-center">
            <FileText className="size-8 text-[#4e8af4]/40 mx-auto mb-3" />
            <p className="text-[#e8eaed] text-sm font-medium">No saved briefs yet</p>
            <p className="text-[#9aa0a6] text-[13px] mt-1">
              Ask the AI assistant to rewrite a page or draft a new one - every brief lands here automatically.
            </p>
          </div>
        ) : (
          briefs.map((b) => <BriefCard key={b.id} brief={b} siteId={siteId} />)
        )}
      </div>
    </div>
  )
}
