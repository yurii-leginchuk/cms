import { useState, useEffect } from 'react'
import { Sparkles, ArrowRight, Zap, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogPortal,
  DialogOverlay,
} from '@/components/ui/dialog'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { SerpPreview } from '@/components/SerpPreview'

const TITLE_LIMIT = 60
const DESC_LIMIT = 160

interface AiReviewDialogProps {
  open: boolean
  onClose: () => void
  onApply: (title: string | null, desc: string | null) => void | Promise<void>
  current: { title: string; desc: string }
  generated: { metaTitle: string | null; metaDescription: string | null; tokensUsed: number }
  pageUrl: string
  siteFavicon?: string | null
}

function ReadOnlyField({ value, label }: { value: string; label: string }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9aa0a6]/60">{label}</p>
      <div className="min-h-[60px] rounded-lg bg-[#0f1117]/50 border border-white/5 px-3 py-2.5">
        {value ? (
          <p className="text-[13px] text-[#9aa0a6] leading-relaxed break-words">{value}</p>
        ) : (
          <p className="text-[13px] text-[#9aa0a6]/30 italic">Not set</p>
        )}
      </div>
    </div>
  )
}

export function AiReviewDialog({
  open,
  onClose,
  onApply,
  current,
  generated,
  pageUrl,
  siteFavicon,
}: AiReviewDialogProps) {
  const [title, setTitle] = useState(generated.metaTitle ?? '')
  const [desc, setDesc] = useState(generated.metaDescription ?? '')

  useEffect(() => {
    if (open) {
      setTitle(generated.metaTitle ?? '')
      setDesc(generated.metaDescription ?? '')
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const [applying, setApplying] = useState(false)

  const titleOver = title.length > TITLE_LIMIT
  const descOver = desc.length > DESC_LIMIT

  async function handleApply() {
    setApplying(true)
    try {
      await onApply(title.trim() || null, desc.trim() || null)
      onClose()
    } catch (err) {
      console.error('Failed to apply:', err)
    } finally {
      setApplying(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPortal>
        <DialogOverlay className="bg-black/60 backdrop-blur-sm" />
        <DialogPrimitive.Popup
          className="fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-full flex flex-col
            bg-[#1a1d27] border border-white/10 rounded-2xl shadow-2xl overflow-hidden
            data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95
            data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95
            duration-150"
          style={{ maxWidth: '920px', maxHeight: '90vh' }}
        >
          {/* Header */}
          <div className="flex items-center gap-3 px-6 py-4 border-b border-white/8 flex-shrink-0">
            <div className="size-8 rounded-lg bg-[#4e8af4]/15 flex items-center justify-center flex-shrink-0">
              <Sparkles className="size-4 text-[#4e8af4]" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-[15px] font-semibold text-[#e8eaed]">AI Review</h2>
              <p className="text-[12px] text-[#9aa0a6] mt-0.5">
                Edit the suggestion, then apply it when it looks right
              </p>
            </div>
            {generated.tokensUsed > 0 && (
              <div className="flex items-center gap-1.5 text-[11px] text-[#9aa0a6] bg-white/5 border border-white/8 rounded-full px-2.5 py-1">
                <Zap className="size-3 text-amber-400" />
                {generated.tokensUsed} tokens
              </div>
            )}
            <DialogPrimitive.Close
              className="size-7 flex items-center justify-center rounded-lg text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-white/8 transition-colors ml-1"
              aria-label="Close"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </DialogPrimitive.Close>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto">
            <div className="grid grid-cols-2 divide-x divide-white/8 min-h-0">
              {/* Left - Current */}
              <div className="px-6 py-5 space-y-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[11px] font-semibold uppercase tracking-widest text-[#9aa0a6]">
                    Current
                  </span>
                </div>
                <ReadOnlyField label="Meta Title" value={current.title} />
                <ReadOnlyField label="Meta Description" value={current.desc} />
                {(current.title || current.desc) && (
                  <div className="pt-1">
                    <SerpPreview
                      title={current.title}
                      description={current.desc}
                      url={pageUrl}
                      favicon={siteFavicon}
                    />
                  </div>
                )}
              </div>

              {/* Right - AI Suggestion */}
              <div className="px-6 py-5 space-y-4">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="size-3 text-[#4e8af4]" />
                  <span className="text-[11px] font-semibold uppercase tracking-widest text-[#4e8af4]">
                    AI Suggestion
                  </span>
                </div>

                {/* Title */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-[10px] font-semibold uppercase tracking-widest text-[#9aa0a6]/60">
                      Meta Title
                    </Label>
                    <span className={`text-[11px] tabular-nums ${titleOver ? 'text-amber-400' : 'text-[#9aa0a6]/60'}`}>
                      {title.length} / {TITLE_LIMIT}
                    </span>
                  </div>
                  <textarea
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    rows={2}
                    className="w-full bg-[#0f1117] border border-[#4e8af4]/30 rounded-lg px-3 py-2.5 text-[13px] text-[#e8eaed] placeholder:text-[#9aa0a6]/40 resize-none focus:outline-none focus:ring-1 focus:ring-[#4e8af4]/50 focus:border-[#4e8af4]/60 transition-colors"
                    placeholder="No title suggested - type your own"
                  />
                </div>

                {/* Description */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-[10px] font-semibold uppercase tracking-widest text-[#9aa0a6]/60">
                      Meta Description
                    </Label>
                    <span className={`text-[11px] tabular-nums ${descOver ? 'text-amber-400' : 'text-[#9aa0a6]/60'}`}>
                      {desc.length} / {DESC_LIMIT}
                    </span>
                  </div>
                  <textarea
                    value={desc}
                    onChange={(e) => setDesc(e.target.value)}
                    rows={3}
                    className="w-full bg-[#0f1117] border border-[#4e8af4]/30 rounded-lg px-3 py-2.5 text-[13px] text-[#e8eaed] placeholder:text-[#9aa0a6]/40 resize-none focus:outline-none focus:ring-1 focus:ring-[#4e8af4]/50 focus:border-[#4e8af4]/60 transition-colors"
                    placeholder="No description suggested - type your own"
                  />
                </div>

                {/* SERP preview */}
                <SerpPreview
                  title={title}
                  description={desc}
                  url={pageUrl}
                  favicon={siteFavicon}
                />
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center gap-3 px-6 py-4 border-t border-white/8 flex-shrink-0 bg-[#161925]">
            <Button
              variant="ghost"
              onClick={onClose}
              className="h-10 px-4 text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-white/5"
            >
              Discard
            </Button>
            <div className="flex-1" />
            <Button
              onClick={handleApply}
              disabled={applying}
              className="h-10 px-5 gap-2 bg-[#4e8af4] hover:bg-[#4e8af4]/90 text-white text-[13px] disabled:opacity-60"
            >
              {applying ? (
                <><Loader2 className="size-3.5 animate-spin" /> Applying…</>
              ) : (
                <>Apply Changes <ArrowRight className="size-3.5" /></>
              )}
            </Button>
          </div>
        </DialogPrimitive.Popup>
      </DialogPortal>
    </Dialog>
  )
}
