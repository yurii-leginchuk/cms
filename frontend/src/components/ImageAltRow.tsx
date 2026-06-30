import { useState } from 'react'
import {
  ImageOff, ExternalLink, Sparkles, Check, X, RotateCcw,
  ChevronDown, UploadCloud, AlertTriangle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { SiteImageRow, ImageAltStatus } from '@/api/images'
import {
  useGenerateForImage, useSetImageAlt, useApproveImage,
  useRevertImage, useApplyImage,
} from '@/hooks/useImages'
import { toast } from 'sonner'

const STATE_CHIP: Record<ImageAltStatus, { label: string; cls: string }> = {
  synced: { label: 'Synced', cls: 'border-white/10 text-[#9aa0a6] bg-white/[0.03]' },
  ai_suggested: { label: 'AI · review', cls: 'border-[#4e8af4]/40 text-[#4e8af4] bg-[#4e8af4]/[0.08]' },
  modified: { label: 'Edited', cls: 'border-amber-500/40 text-amber-400 bg-amber-500/[0.06]' },
  removed: { label: 'Cleared', cls: 'border-red-500/40 text-red-400 bg-red-500/[0.06]' },
}

const MAX_ALT = 125

export function ImageAltRow({ siteId, image }: { siteId: string; image: SiteImageRow }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(image.draftAlt ?? image.observedAlt ?? '')
  const [thumbBroken, setThumbBroken] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const generate = useGenerateForImage(siteId)
  const setAlt = useSetImageAlt(siteId)
  const approve = useApproveImage(siteId)
  const revert = useRevertImage(siteId)
  const apply = useApplyImage(siteId)

  const chip = STATE_CHIP[image.status]
  const currentAlt = image.draftAlt ?? image.observedAlt ?? ''
  const hasForbidden = image.unverifiedClaims.some((c) => c.startsWith('Forbidden'))
  const pending = image.status === 'modified' || image.status === 'removed'

  const save = () => {
    setAlt.mutate(
      { imageId: image.id, alt: draft },
      { onSuccess: () => setEditing(false), onError: (e) => toast.error((e as Error).message) },
    )
  }

  return (
    <div
      className={`rounded-xl border ${
        image.status === 'ai_suggested'
          ? 'border-[#4e8af4]/30 bg-[#4e8af4]/[0.03]'
          : pending
            ? 'border-amber-500/30 bg-amber-500/[0.03]'
            : 'border-white/8 bg-[#1a1d27]'
      }`}
    >
      <div className="flex items-start gap-3 px-3 py-3">
        {/* Thumbnail */}
        <div className="size-14 flex-shrink-0 rounded-lg overflow-hidden bg-white/5 grid place-items-center">
          {thumbBroken ? (
            <ImageOff className="size-5 text-[#9aa0a6]/40" />
          ) : (
            <img
              src={image.canonicalUrl}
              alt=""
              loading="lazy"
              className="size-full object-cover"
              onError={() => setThumbBroken(true)}
            />
          )}
        </div>

        {/* Main */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${chip.cls}`}>{chip.label}</span>
            {image.source === 'ai_generated' && (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-[#4e8af4]">
                <Sparkles className="size-3" /> AI
              </span>
            )}
            {image.needsReview && (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-400" title="Generated from thin context - review carefully">
                <AlertTriangle className="size-3" /> needs review
              </span>
            )}
            <button
              onClick={() => setExpanded((e) => !e)}
              className="ml-auto text-[11px] text-[#9aa0a6] hover:text-[#e8eaed] inline-flex items-center gap-1"
            >
              {image.usageCount} page{image.usageCount === 1 ? '' : 's'}
              <ChevronDown className={`size-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            </button>
          </div>

          <div className="text-[11px] text-[#9aa0a6]/70 truncate mt-0.5" title={image.canonicalUrl}>
            {image.canonicalUrl.replace(/^https?:\/\//, '')}
          </div>

          {/* ALT value / editor */}
          {editing ? (
            <div className="mt-2">
              <textarea
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') save()
                  if (e.key === 'Escape') setEditing(false)
                }}
                rows={2}
                className="w-full text-[13px] bg-[#11131a] border border-white/10 rounded-md px-2 py-1.5 text-[#e8eaed] resize-none focus:border-[#4e8af4]/50 outline-none"
                placeholder="Describe the image (5–15 words)…"
              />
              <div className="flex items-center justify-between mt-1">
                <span className={`text-[10px] ${draft.length > MAX_ALT ? 'text-red-400' : 'text-[#9aa0a6]/60'}`}>
                  {draft.length}/{MAX_ALT}
                </span>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => setEditing(false)}>
                    <X className="size-3" /> Cancel
                  </Button>
                  <Button size="sm" className="h-6 text-[11px]" onClick={save} disabled={setAlt.isPending}>
                    <Check className="size-3" /> Save
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div
              className="mt-1.5 text-[13px] text-[#e8eaed] cursor-text"
              onClick={() => { setDraft(currentAlt); setEditing(true) }}
            >
              {currentAlt ? (
                <span>
                  {image.observedAlt && image.draftAlt && image.observedAlt !== image.draftAlt && (
                    <span className="line-through text-[#9aa0a6]/50 mr-2">{image.observedAlt}</span>
                  )}
                  {currentAlt}
                </span>
              ) : (
                <span className="italic text-amber-400/70">no alt - click to add, or Generate</span>
              )}
            </div>
          )}

          {hasForbidden && (
            <div className="mt-1 text-[11px] text-red-400">
              Brand Card violation - edit before applying: {image.unverifiedClaims.join('; ')}
            </div>
          )}
          {image.aiRationale && image.status === 'ai_suggested' && (
            <div className="mt-1 text-[11px] text-[#9aa0a6]/80 italic">{image.aiRationale}</div>
          )}

          {/* Where used */}
          {expanded && (
            <div className="mt-2 space-y-1 border-t border-white/5 pt-2">
              {image.pages.map((p) => (
                <a
                  key={p.pageId}
                  href={p.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-[11px] text-[#4e8af4] hover:underline"
                >
                  <ExternalLink className="size-3" />
                  {p.url.replace(/^https?:\/\/[^/]+/, '') || '/'}
                </a>
              ))}
            </div>
          )}

          {/* Actions */}
          {!editing && (
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              <Button
                size="sm" variant="outline" className="h-6 text-[11px]"
                onClick={() => generate.mutate(image.id, { onError: (e) => toast.error((e as Error).message) })}
                disabled={generate.isPending}
              >
                <Sparkles className={`size-3 ${generate.isPending ? 'animate-pulse' : ''}`} />
                {generate.isPending ? 'Generating…' : 'Generate'}
              </Button>
              {image.status === 'ai_suggested' && (
                <Button
                  size="sm" className="h-6 text-[11px]" disabled={hasForbidden || approve.isPending}
                  onClick={() => approve.mutate(image.id)}
                  title={hasForbidden ? 'Resolve the Brand Card violation first' : 'Approve as-is'}
                >
                  <Check className="size-3" /> Approve
                </Button>
              )}
              {pending && (
                <Button
                  size="sm" className="h-6 text-[11px]" disabled={hasForbidden || apply.isPending}
                  onClick={() => apply.mutate(image.id, {
                    onSuccess: () => toast.success('Applied to WordPress'),
                    onError: (e) => toast.error((e as Error).message),
                  })}
                >
                  <UploadCloud className="size-3" /> Apply
                </Button>
              )}
              {(pending || image.status === 'ai_suggested') && (
                <Button size="sm" variant="ghost" className="h-6 text-[11px] text-[#9aa0a6]"
                  onClick={() => revert.mutate(image.id)}>
                  <RotateCcw className="size-3" /> Revert
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
