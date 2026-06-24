import { useState } from 'react'
import { toast } from 'sonner'
import {
  UploadCloud, Loader2, Plus, Pencil, Trash2, AlertTriangle,
  CheckCircle2, XCircle, ExternalLink,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogPortal,
  DialogOverlay,
} from '@/components/ui/dialog'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { usePendingSummary, useApplyAll } from '@/hooks/useSchema'
import type { PendingAction, PendingSummaryItem } from '@/api/schema'

interface ApplyAllSchemasDialogProps {
  open: boolean
  onClose: () => void
  siteId: string
}

const ACTION_META: Record<
  PendingAction,
  { label: string; chip: string; Icon: typeof Plus }
> = {
  add: { label: 'Add', chip: 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10', Icon: Plus },
  edit: { label: 'Edit', chip: 'border-amber-500/30 text-amber-400 bg-amber-500/10', Icon: Pencil },
  remove: { label: 'Remove', chip: 'border-red-500/30 text-red-400 bg-red-500/10', Icon: Trash2 },
}

function ActionBadge({ action }: { action: PendingAction }) {
  const { label, chip, Icon } = ACTION_META[action]
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded border ${chip}`}>
      <Icon className="size-3" />
      {label}
    </span>
  )
}

function ValidityIcon({ status }: { status: PendingSummaryItem['validationStatus'] }) {
  if (status === 'valid') return <CheckCircle2 className="size-3 text-emerald-400" />
  if (status === 'warnings') return <AlertTriangle className="size-3 text-amber-400" />
  if (status === 'errors') return <XCircle className="size-3 text-red-400" />
  return null
}

function SummaryStat({ count, label, color }: { count: number; label: string; color: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className={`text-[15px] font-semibold tabular-nums ${color}`}>{count}</span>
      <span className="text-[12px] text-[#9aa0a6]">{label}</span>
    </div>
  )
}

export function ApplyAllSchemasDialog({ open, onClose, siteId }: ApplyAllSchemasDialogProps) {
  const { data: summary, isLoading, isError } = usePendingSummary(siteId, open)
  const applyAll = useApplyAll(siteId)
  const [applying, setApplying] = useState(false)

  const hasChanges = !!summary && summary.totalChanges > 0

  async function handleApply() {
    setApplying(true)
    try {
      const res = await applyAll.mutateAsync()
      if (res.failed === 0) {
        toast.success(`Applied changes to ${res.applied} page${res.applied === 1 ? '' : 's'}`)
      } else {
        const failedUrls = res.perPage
          .filter((p) => p.error)
          .map((p) => p.url.replace(/^https?:\/\/[^/]+/, '') || '/')
        toast.error(
          `Applied ${res.applied} page(s), ${res.failed} failed: ${failedUrls.join(', ')}`,
          { duration: 8000 },
        )
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
            data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95
            duration-150"
          style={{ maxWidth: '720px', maxHeight: '85vh' }}
        >
          {/* Header */}
          <div className="flex items-center gap-3 px-6 py-4 border-b border-white/8 flex-shrink-0">
            <div className="size-8 rounded-lg bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
              <UploadCloud className="size-4 text-emerald-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-[15px] font-semibold text-[#e8eaed]">Apply All to WordPress</h2>
              <p className="text-[12px] text-[#9aa0a6] mt-0.5">
                Check every pending change before it goes live
              </p>
            </div>
            <DialogPrimitive.Close
              className="size-7 flex items-center justify-center rounded-lg text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-white/8 transition-colors ml-1 disabled:opacity-40"
              aria-label="Close"
              disabled={applying}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </DialogPrimitive.Close>
          </div>

          {/* Summary bar (sticky) */}
          {hasChanges && (
            <div className="flex-shrink-0 px-6 py-3 border-b border-white/8 bg-[#161925] space-y-2">
              <div className="flex items-center gap-5 flex-wrap">
                <SummaryStat count={summary.totalAdds} label="adds" color="text-emerald-400" />
                <SummaryStat count={summary.totalEdits} label="edits" color="text-amber-400" />
                <SummaryStat count={summary.totalRemoves} label="removes" color="text-red-400" />
                <div className="h-4 w-px bg-white/10" />
                <span className="text-[12px] text-[#9aa0a6]">
                  across <span className="text-[#e8eaed] font-medium">{summary.totalPages}</span>{' '}
                  page{summary.totalPages === 1 ? '' : 's'}
                </span>
              </div>
              {summary.schemasWithErrors > 0 && (
                <div className="flex items-center gap-2 text-[12px] text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-1.5">
                  <AlertTriangle className="size-3.5 flex-shrink-0" />
                  {summary.schemasWithErrors} schema{summary.schemasWithErrors === 1 ? '' : 's'} have
                  validation errors. They'll still be applied, so review them first.
                </div>
              )}
            </div>
          )}

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {isLoading ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-20 bg-white/5 rounded-xl" />
                ))}
              </div>
            ) : isError ? (
              <div className="py-10 text-center text-[13px] text-red-400">
                Couldn't load pending changes. Close and reopen to retry.
              </div>
            ) : !hasChanges ? (
              <div className="py-12 flex flex-col items-center gap-2 text-center">
                <CheckCircle2 className="size-7 text-emerald-400/60" />
                <p className="text-[13px] text-[#9aa0a6]">All caught up - nothing waiting to apply.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {summary.pages.map((p) => {
                  const path = p.url.replace(/^https?:\/\/[^/]+/, '') || '/'
                  return (
                    <div
                      key={p.pageId}
                      className="rounded-xl border border-white/8 bg-[#161925] overflow-hidden"
                    >
                      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/8 bg-white/[0.02]">
                        <span
                          className="text-[12px] text-[#e8eaed] font-medium truncate"
                          title={p.url}
                        >
                          {path}
                        </span>
                        <a
                          href={p.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#9aa0a6] hover:text-[#4e8af4] flex-shrink-0"
                          title="Open page"
                        >
                          <ExternalLink className="size-3" />
                        </a>
                        <span className="ml-auto text-[11px] text-[#9aa0a6] tabular-nums flex-shrink-0">
                          {p.items.length} change{p.items.length === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div className="divide-y divide-white/5">
                        {p.items.map((item) => (
                          <div
                            key={item.schemaId}
                            className="flex items-center gap-2.5 px-4 py-2"
                          >
                            <ActionBadge action={item.action} />
                            <span className="text-[12px] text-[#e8eaed] font-medium truncate">
                              {item.type}
                            </span>
                            <span className="text-[11px] text-[#9aa0a6]/70 truncate">
                              {item.source}
                            </span>
                            <span className="ml-auto flex-shrink-0">
                              <ValidityIcon status={item.validationStatus} />
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center gap-3 px-6 py-4 border-t border-white/8 flex-shrink-0 bg-[#161925]">
            <Button
              variant="ghost"
              onClick={onClose}
              disabled={applying}
              className="h-10 px-4 text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-white/5"
            >
              Cancel
            </Button>
            <div className="flex-1" />
            <Button
              onClick={handleApply}
              disabled={applying || !hasChanges}
              className="h-10 px-5 gap-2 bg-emerald-600 hover:bg-emerald-600/90 text-white text-[13px] disabled:opacity-50"
            >
              {applying ? (
                <><Loader2 className="size-3.5 animate-spin" /> Applying…</>
              ) : (
                <><UploadCloud className="size-3.5" /> Apply All to WordPress</>
              )}
            </Button>
          </div>
        </DialogPrimitive.Popup>
      </DialogPortal>
    </Dialog>
  )
}
