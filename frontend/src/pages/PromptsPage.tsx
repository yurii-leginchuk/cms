import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import {
  ChevronLeft, BookOpen, Pencil, RefreshCw, ChevronDown, ChevronUp,
  RotateCcw, Cpu,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet'
import { usePrompts, useUpsertPrompt } from '@/hooks/usePrompts'
import type { AiPrompt } from '@/api/prompts'

const MODEL_OPTIONS = [
  { value: '', label: 'Default (from Settings)' },
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  { value: 'gpt-4o', label: 'GPT-4o' },
  { value: 'gpt-3.5-turbo-0125', label: 'GPT-3.5 Turbo' },
]

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

function PromptCard({
  prompt,
  onEdit,
}: {
  prompt: AiPrompt
  onEdit: (prompt: AiPrompt) => void
}) {
  return (
    <div className="rounded-xl border border-white/8 bg-[#1a1d27] p-5 hover:border-white/15 transition-all">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <h3 className="text-[14px] font-semibold text-[#e8eaed]">{prompt.name}</h3>
            {prompt.isDefault && (
              <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#4e8af4]/10 text-[#4e8af4] border border-[#4e8af4]/20">
                default
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
          Edit
        </Button>
      </div>
    </div>
  )
}

interface EditSheetProps {
  prompt: AiPrompt | null
  onClose: () => void
}

function EditPromptSheet({ prompt, onClose }: EditSheetProps) {
  const [content, setContent] = useState(prompt?.content ?? '')
  const [model, setModel] = useState(prompt?.model ?? '')
  const [showVars, setShowVars] = useState(false)
  const upsert = useUpsertPrompt()

  const promptId = prompt?.id
  const isSaving = upsert.isPending

  // Sync content when the selected prompt changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (prompt) {
      setContent(prompt.content)
      setModel(prompt.model ?? '')
    }
  }, [promptId])

  async function handleSave() {
    if (!prompt) return
    try {
      await upsert.mutateAsync({ slug: prompt.slug, content, name: prompt.name, model: model || null })
      toast.success('Prompt saved')
      onClose()
    } catch {
      toast.error('Failed to save prompt')
    }
  }

  async function handleReset() {
    if (!prompt) return
    if (!confirm(`Reset "${prompt.name}" to its default content?`)) return
    setContent(prompt.content)
    toast.info('Content reset to saved state - click Save to persist')
  }

  return (
    <Sheet
      open={!!prompt}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <SheetContent
        side="right"
        className="w-[580px] sm:max-w-[580px] bg-[#1a1d27] border-l border-white/8 flex flex-col p-0"
      >
        <SheetHeader className="px-6 py-4 border-b border-white/8 flex-shrink-0">
          <SheetTitle className="text-[#e8eaed] text-[15px] font-semibold">
            {prompt?.name}
          </SheetTitle>
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

          {/* Model selector */}
          <div className="space-y-2">
            <Label className="text-[#9aa0a6] text-[11px] font-medium uppercase tracking-widest flex items-center gap-1.5">
              <Cpu className="size-3" />
              Model
            </Label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full h-10 px-3 pr-8 rounded-lg bg-[#0f1117] border border-white/8 text-[13px] text-[#e8eaed] focus:outline-none focus:ring-1 focus:ring-[#4e8af4]/50 focus:border-[#4e8af4]/50 appearance-none cursor-pointer"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239aa0a6' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 10px center',
              }}
            >
              {MODEL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value} className="bg-[#1a1d27]">
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Available Variables */}
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
                    <code
                      className={`text-[11px] font-mono px-2 py-0.5 rounded border font-semibold flex-shrink-0 ${VAR_COLORS[i % VAR_COLORS.length]}`}
                    >
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
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            className="h-9 px-3 text-[12px] text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-white/5 gap-1.5"
          >
            <RotateCcw className="size-3" />
            Reset
          </Button>
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
            disabled={isSaving}
            className="h-10 px-5 bg-[#4e8af4] hover:bg-[#4e8af4]/90 text-white text-[13px]"
          >
            {isSaving ? (
              <><RefreshCw className="size-3.5 mr-2 animate-spin" />Saving…</>
            ) : (
              'Save Prompt'
            )}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

export default function PromptsPage() {
  const [editPrompt, setEditPrompt] = useState<AiPrompt | null>(null)
  const { data: prompts = [], isLoading } = usePrompts()

  return (
    <div className="min-h-full">
      {/* Header */}
      <div className="border-b border-white/8 px-8 py-5">
        <div className="flex items-center gap-1.5 text-[13px] mb-3">
          <Link
            to="/settings"
            className="text-[#9aa0a6] hover:text-[#e8eaed] transition-colors flex items-center gap-1"
          >
            <ChevronLeft className="size-3.5" />
            Settings
          </Link>
          <span className="text-[#9aa0a6]/40">/</span>
          <span className="text-[#e8eaed]">Prompt Library</span>
        </div>

        <div className="flex items-center gap-3">
          <div className="size-9 rounded-lg bg-violet-500/15 flex items-center justify-center">
            <BookOpen className="size-4 text-violet-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-[#e8eaed] tracking-tight">Prompt Library</h1>
            <p className="text-[13px] text-[#9aa0a6] mt-0.5">
              Customize AI prompts used for meta generation. Use{' '}
              <code className="text-[12px] text-violet-400 bg-violet-400/10 px-1 py-0.5 rounded">
                {'{{variable}}'}
              </code>{' '}
              syntax for dynamic content.
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
        ) : prompts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="size-12 rounded-xl bg-[#1a1d27] border border-white/8 flex items-center justify-center">
              <BookOpen className="size-6 text-[#9aa0a6]" />
            </div>
            <p className="text-[#9aa0a6] text-sm">No prompts found</p>
          </div>
        ) : (
          prompts.map((prompt) => (
            <PromptCard key={prompt.id} prompt={prompt} onEdit={setEditPrompt} />
          ))
        )}
      </div>

      <EditPromptSheet
        prompt={editPrompt}
        onClose={() => setEditPrompt(null)}
      />
    </div>
  )
}
