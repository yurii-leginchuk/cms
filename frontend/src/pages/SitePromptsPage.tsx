import { useState, useEffect } from 'react'
import { Link, useParams, Navigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  ChevronRight, BookOpen, Pencil, RefreshCw,
  ChevronDown, ChevronUp, RotateCcw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet'
import { useSite } from '@/hooks/useSites'
import { useSitePrompts, useUpsertSitePrompt, useResetSitePrompt } from '@/hooks/usePrompts'
import type { AiPrompt } from '@/api/prompts'

const TEMPLATE_VARS = [
  { variable: '{{site.name}}', description: 'The site name' },
  { variable: '{{site.url}}', description: 'The site URL' },
  { variable: '{{page.url}}', description: 'The page URL' },
  { variable: '{{page.cleanContent}}', description: 'Extracted readable text content (up to 5000 chars)' },
  { variable: '{{page.metaTitle}}', description: 'The scraped meta title' },
  { variable: '{{page.metaDescription}}', description: 'The scraped meta description' },
]

const VAR_COLORS = [
  'text-[#4e8af4] bg-[#4e8af4]/10 border-[#4e8af4]/20',
  'text-violet-400 bg-violet-400/10 border-violet-400/20',
  'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
  'text-amber-400 bg-amber-400/10 border-amber-400/20',
  'text-pink-400 bg-pink-400/10 border-pink-400/20',
  'text-cyan-400 bg-cyan-400/10 border-cyan-400/20',
]

/* ──────────────────────────────── Prompt Card ────────────────────────────── */

function PromptCard({ prompt, onEdit }: { prompt: AiPrompt; onEdit: (p: AiPrompt) => void }) {
  const isOverride = prompt.siteId !== null

  return (
    <div className={`rounded-xl border bg-[#1a1d27] p-5 hover:border-white/15 transition-all ${
      isOverride ? 'border-amber-400/20' : 'border-white/8'
    }`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <h3 className="text-[14px] font-semibold text-[#e8eaed]">{prompt.name}</h3>
            {isOverride ? (
              <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-400/10 text-amber-400 border border-amber-400/20">
                site override
              </span>
            ) : (
              <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/5 text-[#9aa0a6] border border-white/8">
                global default
              </span>
            )}
            {prompt.model && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-400/10 text-emerald-400 border border-emerald-400/20">
                {prompt.model}
              </span>
            )}
          </div>
          <code className="text-[11px] text-[#9aa0a6] bg-white/5 px-2 py-0.5 rounded font-mono">
            {prompt.slug}
          </code>
          {prompt.description && (
            <p className="text-[13px] text-[#9aa0a6] mt-2 leading-relaxed">{prompt.description}</p>
          )}
          <div className="mt-3 p-3 rounded-lg bg-[#0f1117] border border-white/5">
            <p className="text-[11px] text-[#9aa0a6]/60 font-mono leading-relaxed line-clamp-3 whitespace-pre-wrap">
              {prompt.content}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onEdit(prompt)}
          className="h-8 px-3 text-[13px] text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-white/5 flex-shrink-0"
        >
          <Pencil className="size-3 mr-1.5" />
          {prompt.siteId ? 'Edit override' : 'Override'}
        </Button>
      </div>
    </div>
  )
}

/* ──────────────────────────────── Edit Sheet ─────────────────────────────── */

interface EditSheetProps {
  prompt: AiPrompt | null
  siteId: string
  onClose: () => void
}

function EditPromptSheet({ prompt, siteId, onClose }: EditSheetProps) {
  const [content, setContent] = useState(prompt?.content ?? '')
  const [showVars, setShowVars] = useState(false)
  const upsert = useUpsertSitePrompt(siteId)
  const reset = useResetSitePrompt(siteId)

  const promptId = prompt?.id
  const isOverride = prompt?.siteId === siteId

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (prompt) setContent(prompt.content)
  }, [promptId])

  async function handleSave() {
    if (!prompt) return
    try {
      await upsert.mutateAsync({ slug: prompt.slug, content })
      toast.success('Site prompt saved')
      onClose()
    } catch {
      toast.error('Failed to save prompt')
    }
  }

  async function handleReset() {
    if (!prompt) return
    if (!confirm(`Remove site override for "${prompt.name}"? The global default will be used.`)) return
    try {
      await reset.mutateAsync(prompt.slug)
      toast.success('Reverted to global default')
      onClose()
    } catch {
      toast.error('Failed to reset prompt')
    }
  }

  return (
    <Sheet open={!!prompt} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-[580px] sm:max-w-[580px] bg-[#1a1d27] border-l border-white/8 flex flex-col p-0"
      >
        <SheetHeader className="px-6 py-4 border-b border-white/8 flex-shrink-0">
          <div className="flex items-center gap-2">
            <SheetTitle className="text-[#e8eaed] text-[15px] font-semibold flex-1">
              {prompt?.name}
            </SheetTitle>
            {isOverride ? (
              <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-400/10 text-amber-400 border border-amber-400/20">
                site override
              </span>
            ) : (
              <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/5 text-[#9aa0a6] border border-white/8">
                using global
              </span>
            )}
          </div>
          {prompt && (
            <div className="flex items-center gap-2 mt-0.5">
              <code className="text-[11px] text-[#9aa0a6] bg-white/5 px-2 py-0.5 rounded font-mono">
                {prompt.slug}
              </code>
              {prompt.description && (
                <span className="text-[12px] text-[#9aa0a6]">{prompt.description}</span>
              )}
            </div>
          )}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {!isOverride && (
            <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-[#4e8af4]/5 border border-[#4e8af4]/15 text-[12px] text-[#9aa0a6]">
              <span className="text-[#4e8af4] mt-0.5">ℹ</span>
              Editing will create a site-specific override. The global default is shown below.
            </div>
          )}

          <div className="space-y-2">
            <Label className="text-[#9aa0a6] text-[11px] font-medium uppercase tracking-widest">
              Prompt Content
            </Label>
            <textarea
              key={promptId}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={18}
              className="w-full bg-[#0f1117] border border-white/8 rounded-lg px-3 py-2.5 text-[13px] text-[#e8eaed] placeholder:text-[#9aa0a6]/40 resize-none focus:outline-none focus:ring-1 focus:ring-[#4e8af4]/50 focus:border-[#4e8af4]/40 transition-colors font-mono leading-relaxed"
              spellCheck={false}
            />
          </div>

          {/* Template variables */}
          <div className="rounded-lg border border-white/8 overflow-hidden">
            <button
              type="button"
              onClick={() => setShowVars((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3 text-[12px] font-medium text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-white/5 transition-colors"
            >
              <span>Available template variables</span>
              {showVars ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            </button>
            {showVars && (
              <div className="px-4 pb-4 border-t border-white/8 pt-3 grid grid-cols-1 gap-2">
                {TEMPLATE_VARS.map((v, i) => (
                  <div key={v.variable} className="flex items-center gap-3">
                    <code className={`text-[11px] font-mono px-2 py-0.5 rounded border font-semibold flex-shrink-0 ${VAR_COLORS[i % VAR_COLORS.length]}`}>
                      {v.variable}
                    </code>
                    <span className="text-[12px] text-[#9aa0a6]">{v.description}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <SheetFooter className="px-6 py-4 border-t border-white/8 flex-shrink-0 flex items-center gap-3">
          {isOverride && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              disabled={reset.isPending}
              className="h-9 px-3 text-[12px] text-amber-400/70 hover:text-amber-400 hover:bg-amber-400/10 gap-1.5"
            >
              <RotateCcw className="size-3" />
              Reset to Global
            </Button>
          )}
          <div className="flex-1" />
          <Button
            variant="ghost"
            onClick={onClose}
            className="h-10 px-4 text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-white/5"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={upsert.isPending}
            className="h-10 px-5 bg-[#4e8af4] hover:bg-[#4e8af4]/90 text-white text-[13px]"
          >
            {upsert.isPending ? (
              <><RefreshCw className="size-3.5 mr-2 animate-spin" />Saving…</>
            ) : (
              isOverride ? 'Save Override' : 'Save as Override'
            )}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

/* ──────────────────────────────── Page ──────────────────────────────────── */

export default function SitePromptsPage() {
  const { id: siteId } = useParams<{ id: string }>()
  const { data: site } = useSite(siteId!)
  const { data: prompts = [], isLoading } = useSitePrompts(siteId!)
  const [editPrompt, setEditPrompt] = useState<AiPrompt | null>(null)

  if (!siteId) return <Navigate to="/sites" replace />

  return (
    <div className="min-h-full">
      {/* Header */}
      <div className="border-b border-white/8 px-8 py-5">
        <div className="flex items-center gap-1.5 text-[13px] mb-3 text-[#9aa0a6]">
          <Link to="/sites" className="hover:text-[#e8eaed] transition-colors">Sites</Link>
          <ChevronRight className="size-3.5" />
          <Link to={`/sites/${siteId}`} className="hover:text-[#e8eaed] transition-colors">
            {site?.name ?? '…'}
          </Link>
          <ChevronRight className="size-3.5" />
          <span className="text-[#e8eaed]">Prompts</span>
        </div>

        <div className="flex items-center gap-3">
          <div className="size-9 rounded-lg bg-violet-500/15 flex items-center justify-center">
            <BookOpen className="size-4 text-violet-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-[#e8eaed] tracking-tight">Site Prompts</h1>
            <p className="text-[13px] text-[#9aa0a6] mt-0.5">
              Override global AI prompts for <span className="text-[#e8eaed]">{site?.name}</span>.
              Unchanged prompts fall back to global defaults.
            </p>
          </div>
        </div>
      </div>

      <div className="px-8 py-6 max-w-3xl space-y-3">
        {isLoading ? (
          <>
            {[1, 2, 3].map((i) => (
              <div key={i} className="rounded-xl border border-white/8 bg-[#1a1d27] p-5 space-y-3">
                <Skeleton className="h-4 w-48 bg-white/5" />
                <Skeleton className="h-3 w-24 bg-white/5" />
                <Skeleton className="h-16 w-full bg-white/5 rounded-lg" />
              </div>
            ))}
          </>
        ) : (
          prompts.map((prompt) => (
            <PromptCard key={prompt.id} prompt={prompt} onEdit={setEditPrompt} />
          ))
        )}
      </div>

      <EditPromptSheet
        prompt={editPrompt}
        siteId={siteId}
        onClose={() => setEditPrompt(null)}
      />
    </div>
  )
}
