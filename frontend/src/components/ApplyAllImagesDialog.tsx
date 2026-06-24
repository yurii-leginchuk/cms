import { useState } from 'react'
import { toast } from 'sonner'
import { UploadCloud, AlertTriangle, Sparkles, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogPortal, DialogOverlay } from '@/components/ui/dialog'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useImagePendingSummary, useApplyAllImages } from '@/hooks/useImages'

interface Props {
  open: boolean
  onClose: () => void
  siteId: string
}

export function ApplyAllImagesDialog({ open, onClose, siteId }: Props) {
  const { data: summary, isLoading, isError } = useImagePendingSummary(siteId, open)
  const applyAll = useApplyAllImages(siteId)
  const [applying, setApplying] = useState(false)
  // The review-before-apply gate: unreviewed AI suggestions excluded by default.
  const [includeUnreviewed, setIncludeUnreviewed] = useState(false)

  const reviewed = summary?.reviewed ?? 0
  const unreviewed = summary?.unreviewed ?? 0
  const willApply = reviewed + (includeUnreviewed ? unreviewed : 0)

  async function handleApply() {
    setApplying(true)
    try {
      const res = await applyAll.mutateAsync(includeUnreviewed)
      if (res.failed === 0) {
        toast.success(`Applied alt text to ${res.applied} image${res.applied === 1 ? '' : 's'}`)
      } else {
        toast.error(`Applied ${res.applied}, ${res.failed} failed`, { duration: 8000 })
      }
      onClose()
    } catch (err) {
      toast.error((err as Error)?.message ?? "Couldn't apply the changes. Try again.")
    } finally {
      setApplying(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !applying && onClose()}>
      <DialogPortal>
        <DialogOverlay className="bg-black/60 backdrop-blur-sm" />
        <DialogPrimitive.Popup
          className="fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-full flex flex-col
            bg-[#1a1d27] border border-white/10 rounded-2xl shadow-2xl overflow-hidden
            data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95
            data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 duration-150"
          style={{ maxWidth: '680px', maxHeight: '85vh' }}
        >
          <div className="flex items-center gap-3 px-6 py-4 border-b border-white/8 flex-shrink-0">
            <div className="size-8 rounded-lg bg-emerald-500/15 flex items-center justify-center">
              <UploadCloud className="size-4 text-emerald-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-[15px] font-semibold text-[#e8eaed]">Apply ALT Text to WordPress</h2>
              <p className="text-[12px] text-[#9aa0a6] mt-0.5">Check every alt change before it goes live</p>
            </div>
            <DialogPrimitive.Close
              className="size-7 grid place-items-center rounded-lg text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-white/8 disabled:opacity-40"
              aria-label="Close" disabled={applying}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </DialogPrimitive.Close>
          </div>

          {summary && (
            <div className="flex-shrink-0 px-6 py-3 border-b border-white/8 bg-[#161925] space-y-2">
              <div className="flex items-center gap-5 flex-wrap text-[12px]">
                <span className="inline-flex items-center gap-1 text-amber-400">
                  <Pencil className="size-3" /> {summary.totalSets} set
                </span>
                <span className="inline-flex items-center gap-1 text-red-400">
                  <Trash2 className="size-3" /> {summary.totalClears} clear
                </span>
                <div className="h-4 w-px bg-white/10" />
                <span className="text-emerald-400">{reviewed} reviewed</span>
                {unreviewed > 0 && (
                  <span className="inline-flex items-center gap-1 text-[#4e8af4]">
                    <Sparkles className="size-3" /> {unreviewed} unreviewed AI
                  </span>
                )}
              </div>
              {unreviewed > 0 && (
                <label className="flex items-start gap-2 text-[12px] text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeUnreviewed}
                    onChange={(e) => setIncludeUnreviewed(e.target.checked)}
                    className="mt-0.5 accent-[#4e8af4]"
                  />
                  <span className="flex items-center gap-1.5">
                    <AlertTriangle className="size-3.5 flex-shrink-0" />
                    I've reviewed these - include the {unreviewed} AI suggestion
                    {unreviewed === 1 ? '' : 's'} that haven't been checked yet.
                  </span>
                </label>
              )}
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-6 py-4">
            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
              </div>
            ) : isError ? (
              <p className="text-[13px] text-red-400">Couldn't load pending changes. Close and reopen to retry.</p>
            ) : !summary || summary.totalImages === 0 ? (
              <p className="text-[13px] text-[#9aa0a6]">Nothing waiting to apply.</p>
            ) : (
              <div className="space-y-1.5">
                {summary.items.map((it) => (
                  <div
                    key={it.imageId}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${
                      it.needsReview ? 'border-[#4e8af4]/20 bg-[#4e8af4]/[0.03]' : 'border-white/8 bg-[#161925]'
                    }`}
                  >
                    <span className="text-[11px] text-[#9aa0a6] truncate flex-1" title={it.canonicalUrl}>
                      {it.canonicalUrl.replace(/^https?:\/\//, '')}
                    </span>
                    {it.needsReview && (
                      <span className="text-[10px] text-[#4e8af4] inline-flex items-center gap-0.5">
                        <Sparkles className="size-3" /> review
                      </span>
                    )}
                    <span className="text-[11px] text-[#9aa0a6]">×{it.usageCount}</span>
                    <span className="text-[12px] text-[#e8eaed] truncate max-w-[45%]" title={it.alt}>
                      {it.action === 'clear' ? '(clear)' : it.alt || '(empty)'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-white/8 flex-shrink-0">
            <Button variant="ghost" onClick={onClose} disabled={applying}>Cancel</Button>
            <Button onClick={handleApply} disabled={applying || willApply === 0}>
              <UploadCloud className="size-4" />
              {applying ? 'Applying…' : `Apply ${willApply}`}
            </Button>
          </div>
        </DialogPrimitive.Popup>
      </DialogPortal>
    </Dialog>
  )
}
