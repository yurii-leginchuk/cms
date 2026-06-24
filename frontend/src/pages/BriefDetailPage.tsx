import { useState, useEffect } from 'react'
import { useParams, useLocation, useNavigate, Navigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, Save, Download, Trash2, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useBrief, useUpdateBrief, useDeleteBrief, useExportBrief } from '@/hooks/useBriefs'
import SiteChat from '@/components/SiteChat'
import type { Brief, BriefStatus, UpdateBriefPayload } from '@/api/briefs'

const STATUS_OPTIONS: { value: BriefStatus; label: string }[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'applied', label: 'Applied' },
]

// Local YYYY-MM-DD (not UTC) for the date input default.
function todayIso(): string {
  const d = new Date()
  const offset = d.getTimezoneOffset() * 60000
  return new Date(d.getTime() - offset).toISOString().slice(0, 10)
}

export default function BriefDetailPage() {
  const { id: siteId, briefId } = useParams<{ id: string; briefId: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const state = location.state as { sessionId?: string } | null

  const { data: brief, isLoading } = useBrief(siteId ?? '', briefId ?? null)
  const updateBrief = useUpdateBrief(siteId ?? '')
  const deleteBrief = useDeleteBrief(siteId ?? '')
  const exportBrief = useExportBrief(siteId ?? '')

  const [form, setForm] = useState<UpdateBriefPayload>({})

  useEffect(() => {
    if (brief) {
      setForm({
        name: brief.name,
        pageUrl: brief.pageUrl,
        proposedMetaTitle: brief.proposedMetaTitle,
        proposedMetaDescription: brief.proposedMetaDescription,
        proposedSlug: brief.proposedSlug,
        proposedContent: brief.proposedContent,
        proposedSchema: brief.proposedSchema,
        keywordStrategy: brief.keywordStrategy,
        status: brief.status,
        appliedAt: brief.appliedAt,
      })
    }
  }, [brief])

  if (!siteId || !briefId) return <Navigate to="/sites" replace />

  const set = <K extends keyof UpdateBriefPayload>(key: K, value: UpdateBriefPayload[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const handleStatusChange = (status: BriefStatus) => {
    setForm((f) => ({
      ...f,
      status,
      // Default the applied date to today when switching to "Applied"; clear it
      // otherwise so the backend doesn't reject a draft carrying a stale date.
      appliedAt: status === 'applied' ? f.appliedAt || todayIso() : null,
    }))
  }

  const handleSave = async () => {
    if (form.status === 'applied' && !form.appliedAt) {
      toast.error('Set the applied date for the "Applied" status')
      return
    }
    try {
      await updateBrief.mutateAsync({ id: briefId, payload: form })
      toast.success('Brief saved')
    } catch {
      toast.error('Save failed')
    }
  }

  const handleExport = async () => {
    try {
      const res = await exportBrief.mutateAsync(briefId)
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

  const handleDelete = async () => {
    if (!confirm('Delete this brief permanently?')) return
    try {
      await deleteBrief.mutateAsync(briefId)
      navigate(`/sites/${siteId}/briefs`)
    } catch {
      toast.error('Delete failed')
    }
  }

  const titleLen = form.proposedMetaTitle?.length ?? 0
  const descLen = form.proposedMetaDescription?.length ?? 0

  return (
    <div className="h-full flex overflow-hidden">
      {/* Editable brief */}
      <div className="flex-1 overflow-y-auto">
        <div className="border-b border-white/8 px-8 py-4 flex items-center gap-3 sticky top-0 z-10" style={{ background: 'var(--background)' }}>
          <button
            onClick={() => navigate(`/sites/${siteId}/briefs`)}
            className="flex items-center gap-1.5 text-[12px] text-[#9aa0a6] hover:text-[#e8eaed] transition-colors"
          >
            <ArrowLeft className="size-3.5" /> Briefs
          </button>
          <div className="flex-1" />
          <button
            onClick={handleSave}
            disabled={updateBrief.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#4e8af4] text-white hover:bg-[#4e8af4]/90 disabled:opacity-50 transition-colors"
          >
            {updateBrief.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            Save
          </button>
          <button
            onClick={handleExport}
            disabled={exportBrief.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] bg-white/5 text-[#e8eaed] hover:bg-white/10 disabled:opacity-50 transition-colors"
          >
            {exportBrief.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
            Export
          </button>
          <button
            onClick={handleDelete}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] text-red-400/80 hover:bg-red-500/10 transition-colors"
          >
            <Trash2 className="size-3.5" /> Delete
          </button>
        </div>

        {isLoading || !brief ? (
          <div className="flex items-center gap-2 text-[#9aa0a6] text-sm px-8 py-6">
            <Loader2 className="size-4 animate-spin" /> Loading brief…
          </div>
        ) : (
          <div className="px-8 py-6 max-w-3xl space-y-5">
            {brief.unverifiedClaims && brief.unverifiedClaims.length > 0 && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3">
                <div className="text-[13px] font-medium text-amber-300 mb-1">
                  ⚠ Unverified claims - confirm or remove before publishing
                </div>
                <p className="text-[12px] text-amber-200/80 mb-2">
                  These offerings/claims did not trace to the site content or Brand Card. Edit the
                  content above to remove or correct them, then dismiss this warning.
                </p>
                <ul className="list-disc pl-5 space-y-0.5 text-[12px] text-amber-100">
                  {brief.unverifiedClaims.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
                <button
                  onClick={async () => {
                    try {
                      await updateBrief.mutateAsync({ id: briefId, payload: { unverifiedClaims: [] } })
                      toast.success('Marked as verified')
                    } catch {
                      toast.error('Failed to update')
                    }
                  }}
                  className="mt-2 text-[12px] font-medium text-amber-200 hover:text-amber-100 underline"
                >
                  I&apos;ve verified these - dismiss
                </button>
              </div>
            )}

            <Field label="Brief Name">
              <Input
                value={form.name ?? ''}
                onChange={(v) => set('name', v || null)}
                placeholder="Custom name (optional)"
              />
            </Field>

            {/* Status */}
            <Field label="Status">
              <div className="flex items-center gap-3 flex-wrap">
                <select
                  value={form.status}
                  onChange={(e) => handleStatusChange(e.target.value as BriefStatus)}
                  className="bg-[#1a1d27] border border-white/8 rounded-lg px-3 py-2 text-[13px] text-[#e8eaed] focus:outline-none focus:border-[#4e8af4]/50"
                >
                  {STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                {form.status === 'applied' && (
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] text-[#9aa0a6]">Applied date</span>
                    <input
                      type="date"
                      value={form.appliedAt ?? ''}
                      max={todayIso()}
                      onChange={(e) => set('appliedAt', e.target.value || null)}
                      className="bg-[#1a1d27] border border-white/8 rounded-lg px-3 py-2 text-[13px] text-[#e8eaed] focus:outline-none focus:border-[#4e8af4]/50 [color-scheme:dark]"
                    />
                  </div>
                )}
              </div>
            </Field>

            <Field label="Page URL">
              <Input value={form.pageUrl ?? ''} onChange={(v) => set('pageUrl', v)} />
            </Field>

            <Field
              label="Meta Title"
              hint={<CharCount n={titleLen} max={60} />}
            >
              <Input value={form.proposedMetaTitle ?? ''} onChange={(v) => set('proposedMetaTitle', v)} />
            </Field>

            <Field
              label="Meta Description"
              hint={<CharCount n={descLen} max={155} />}
            >
              <Textarea value={form.proposedMetaDescription ?? ''} onChange={(v) => set('proposedMetaDescription', v)} rows={2} />
            </Field>

            <Field label="URL Slug">
              <Input value={form.proposedSlug ?? ''} onChange={(v) => set('proposedSlug', v)} />
            </Field>

            <Field label="Proposed Content (Markdown)">
              <Textarea value={form.proposedContent ?? ''} onChange={(v) => set('proposedContent', v)} rows={16} mono />
            </Field>

            <Field label="Keyword Strategy">
              <Textarea value={form.keywordStrategy ?? ''} onChange={(v) => set('keywordStrategy', v)} rows={3} />
            </Field>

            <Field label="Recommendations">
              <RecommendationsList recs={brief.recommendations} />
            </Field>

            <Field label="Structured Data (JSON-LD)">
              <Textarea value={form.proposedSchema ?? ''} onChange={(v) => set('proposedSchema', v)} rows={8} mono />
            </Field>
          </div>
        )}
      </div>

      {/* Persistent chat */}
      <div className="w-[440px] flex-shrink-0 border-l border-white/8">
        <SiteChat
          siteId={siteId}
          initialSessionId={state?.sessionId}
          scope="brief"
          hideSessionSidebar
        />
      </div>
    </div>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-wider text-[#9aa0a6] font-medium">{label}</span>
        {hint}
      </div>
      {children}
    </div>
  )
}

function CharCount({ n, max }: { n: number; max: number }) {
  return <span className={cn('text-[10px]', n > max ? 'text-red-400' : 'text-[#9aa0a6]')}>{n}/{max} chars</span>
}

function RecommendationsList({ recs }: { recs: Brief['recommendations'] }) {
  if (!recs) return <p className="text-[12px] text-[#9aa0a6]">No recommendations.</p>
  // Legacy briefs may hold a plain string.
  if (typeof recs === 'string') {
    return <p className="text-[13px] text-[#e8eaed] whitespace-pre-wrap">{recs}</p>
  }
  return (
    <div className="space-y-3">
      {recs.map((r, i) => (
        <div key={i} className="rounded-lg border border-white/8 bg-[#1a1d27] px-3 py-2.5 text-[12px] space-y-1">
          <div className="flex items-center gap-2">
            <span className="rounded bg-[#4e8af4]/15 text-[#8fb6ff] px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
              {r.action?.type ?? 'action'}
            </span>
            <span className="font-mono text-[12px] text-[#e8eaed]">{r.action?.targetUrl}</span>
          </div>
          {r.evidence?.metric && (
            <div className="text-[#9aa0a6]">
              <span className="text-[#cdd1d6] font-medium">Evidence:</span> {r.evidence.metric}
              {r.evidence.dateRange ? ` (${r.evidence.dateRange})` : ''}{' '}
              <span className="text-[10px] uppercase">[{r.evidence.source}]</span>
            </div>
          )}
          {r.reasoning && (
            <div className="text-[#9aa0a6]">
              <span className="text-[#cdd1d6] font-medium">Why:</span> {r.reasoning}
            </div>
          )}
          {r.action?.anchorText && (
            <div className="text-[#9aa0a6]">
              <span className="text-[#cdd1d6] font-medium">Link:</span> “{r.action.anchorText}”
              {r.action.sourcePage ? ` from ${r.action.sourcePage}` : ''}
            </div>
          )}
          {r.expectedImpact && (r.expectedImpact.estimate || r.expectedImpact.label) && (
            <div className="text-[#9aa0a6]">
              <span className="text-[#cdd1d6] font-medium">Impact:</span>{' '}
              {r.expectedImpact.estimate ?? 'directional'}{' '}
              <span className="text-[10px]">[{r.expectedImpact.label}]</span>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function Input({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full bg-[#1a1d27] border border-white/8 rounded-lg px-3 py-2 text-[13px] text-[#e8eaed] placeholder:text-[#9aa0a6]/50 focus:outline-none focus:border-[#4e8af4]/50"
    />
  )
}

function Textarea({
  value,
  onChange,
  rows,
  mono,
}: {
  value: string
  onChange: (v: string) => void
  rows: number
  mono?: boolean
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      className={cn(
        'w-full bg-[#1a1d27] border border-white/8 rounded-lg px-3 py-2 text-[13px] text-[#e8eaed] resize-y focus:outline-none focus:border-[#4e8af4]/50',
        mono && 'font-mono text-[12px]',
      )}
    />
  )
}
