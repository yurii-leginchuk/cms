import { useState, useRef, useEffect, useMemo } from 'react'
import { useParams, useNavigate, Navigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  ChevronRight, ExternalLink, RefreshCw, Clock, Upload,
  EyeOff, Link2, Sparkles, ImageIcon, ImageOff, AlertTriangle, X, Search,
  CheckCircle2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { SerpPreview } from '@/components/SerpPreview'
import { SocialPreview } from '@/components/SocialPreview'
import { MetaHistoryTimeline } from '@/components/MetaHistoryTimeline'
import { WpPluginStatus } from '@/components/WpPluginStatus'
import { AiReviewDialog } from '@/components/AiReviewDialog'
import { useSite } from '@/hooks/useSites'
import { usePage, usePageHistory, useUpdatePageMeta, useGenerateMeta } from '@/hooks/usePages'
import { useImages, useUploadOgImage } from '@/hooks/useImages'
import { useTriggerPageSync } from '@/hooks/useSync'
import type { IndexDirective, UpdatePageMetaPayload } from '@/api/pages'

const TITLE_LIMIT = 60
const DESC_LIMIT = 160
const OG_TITLE_LIMIT = 90
const OG_DESC_LIMIT = 200

const SECTION_LABEL =
  'text-[11px] font-semibold uppercase tracking-widest text-[#9aa0a6]'
const FIELD_LABEL =
  'text-[#9aa0a6] text-[11px] font-medium uppercase tracking-widest'
const INPUT_CLS =
  'w-full bg-[#0f1117] border border-white/8 rounded-lg px-3 py-2.5 text-sm text-[#e8eaed] placeholder:text-[#9aa0a6]/40 focus:outline-none focus:ring-1 focus:ring-[#4e8af4]/50 focus:border-[#4e8af4]/40 transition-colors'

function isAbsoluteHttpUrl(v: string): boolean {
  try {
    const u = new URL(v)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/* ───────────────────────── OG image library picker ─────────────────────── */

function OgImagePicker({
  siteId,
  open,
  onClose,
  onPick,
}: {
  siteId: string
  open: boolean
  onClose: () => void
  onPick: (url: string, attachmentId: number | null) => void
}) {
  const [search, setSearch] = useState('')
  const { data, isLoading } = useImages(siteId, {
    page: 1,
    limit: 60,
    missingOnly: false,
    search,
  })
  const images = data?.data ?? []

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl bg-[#1a1d27] border-white/8 p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-white/8">
          <h3 className="text-[14px] font-semibold text-[#e8eaed] mb-3">Choose OG image from library</h3>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[#9aa0a6]" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by URL…"
              className="pl-9 bg-[#0f1117] border-white/8 text-[#e8eaed] h-9"
            />
          </div>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-5">
          {isLoading ? (
            <div className="grid grid-cols-4 gap-3">
              {[...Array(8)].map((_, i) => (
                <Skeleton key={i} className="aspect-square bg-white/5 rounded-lg" />
              ))}
            </div>
          ) : images.length === 0 ? (
            <p className="text-[13px] text-[#9aa0a6] text-center py-10">
              No images in the library yet — reconcile images on the Image ALT page first.
            </p>
          ) : (
            <div className="grid grid-cols-4 gap-3">
              {images.map((img) => (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => onPick(img.canonicalUrl, img.wpAttachmentId)}
                  className="group relative aspect-square rounded-lg overflow-hidden border border-white/8 bg-[#0f1117] hover:border-[#4e8af4]/50 transition-colors grid place-items-center"
                  title={img.canonicalUrl}
                >
                  <ImageOff className="absolute size-5 text-[#9aa0a6]/25" />
                  <img
                    src={img.canonicalUrl}
                    alt=""
                    className="relative w-full h-full object-cover"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0' }}
                  />
                  {img.wpAttachmentId != null && (
                    <span className="absolute top-1 right-1 text-[9px] bg-emerald-400/20 text-emerald-300 px-1 rounded">
                      #{img.wpAttachmentId}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/* ─────────────────────────── Robots segmented ──────────────────────────── */

function Segmented<T extends string>({
  value, options, onChange,
}: {
  value: T
  options: { value: T; label: string; danger?: boolean }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="inline-flex rounded-lg border border-white/8 bg-[#0f1117] p-0.5">
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`px-3 py-1.5 text-[12px] font-medium rounded-md transition-colors ${
              active
                ? opt.danger
                  ? 'bg-amber-400/15 text-amber-400'
                  : 'bg-[#4e8af4]/15 text-[#4e8af4]'
                : 'text-[#9aa0a6] hover:text-[#e8eaed]'
            }`}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

/* ──────────────────────────────── Page ─────────────────────────────────── */

export default function MetaEditPage() {
  const { id, pageId } = useParams<{ id: string; pageId: string }>()
  const navigate = useNavigate()

  const { data: site, isLoading: siteLoading } = useSite(id!)
  const { data: page, isLoading } = usePage(id!, pageId ?? null)
  const { data: history = [], isLoading: historyLoading } = usePageHistory(id!, pageId ?? null)
  const update = useUpdatePageMeta(id!)
  const generateMeta = useGenerateMeta(id!)
  const triggerPageSync = useTriggerPageSync(id!, pageId!)
  const uploadOg = useUploadOgImage(id!)
  const ogFileRef = useRef<HTMLInputElement>(null)

  // ── Draft state ──
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [directive, setDirective] = useState<IndexDirective>('default')
  const [nofollow, setNofollow] = useState(false)
  const [canonical, setCanonical] = useState('')
  const [ogTitle, setOgTitle] = useState('')
  const [ogDescription, setOgDescription] = useState('')
  const [ogImage, setOgImage] = useState('')
  const [ogImageId, setOgImageId] = useState<number | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [aiReview, setAiReview] = useState<{ metaTitle: string | null; metaDescription: string | null; tokensUsed: number } | null>(null)

  const initialRef = useRef<Record<string, unknown>>({})
  const [savedTick, setSavedTick] = useState(0)

  useEffect(() => {
    if (!page) return
    const t = page.customMetaTitle || page.metaTitle || ''
    const d = page.customMetaDescription || page.metaDescription || ''
    const dir = page.indexDirective ?? 'default'
    const nf = page.nofollow ?? false
    const c = page.canonical || ''
    const ot = page.ogTitle || ''
    const od = page.ogDescription || ''
    const oi = page.ogImage || ''
    const oid = page.ogImageId ?? null
    setTitle(t); setDesc(d); setDirective(dir); setNofollow(nf); setCanonical(c)
    setOgTitle(ot); setOgDescription(od); setOgImage(oi); setOgImageId(oid)
    initialRef.current = { t, d, dir, nf, c, ot, od, oi, oid }
  }, [page?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = useMemo(() => {
    const r = initialRef.current
    return (
      title !== r.t || desc !== r.d || directive !== r.dir || nofollow !== r.nf ||
      canonical !== r.c || ogTitle !== r.ot || ogDescription !== r.od ||
      ogImage !== r.oi || ogImageId !== r.oid
    )
  }, [title, desc, directive, nofollow, canonical, ogTitle, ogDescription, ogImage, ogImageId, savedTick])

  // Warn on browser unload when there are unsaved changes.
  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  function guardedNav(to: string) {
    if (dirty && !window.confirm('You have unsaved changes. Leave without saving?')) return
    navigate(to)
  }

  if (!id || !pageId) return <Navigate to="/sites" replace />

  const path = page?.url.replace(/^https?:\/\/[^/]+/, '') || '/'
  const noWpKey = site && !site.wpApiKey
  const pageSyncStatus = page?.syncStatus ?? 'idle'

  // Resolved OG values (Yoast fallback chain) for the social preview.
  const resolvedOgTitle = ogTitle || title
  const resolvedOgDesc = ogDescription || desc
  const canonicalInvalid = canonical.trim() !== '' && !isAbsoluteHttpUrl(canonical.trim())
  const canonicalLooksSelf =
    canonical.trim() !== '' && page?.url &&
    canonical.trim().replace(/\/+$/, '') === page.url.replace(/\/+$/, '')

  const effectiveIndex =
    directive === 'noindex' ? 'noindex' : directive === 'index' ? 'index' : 'index'
  const effectiveFollow = nofollow ? 'nofollow' : 'follow'

  async function handleGenerate() {
    if (!page) return
    try {
      const result = await generateMeta.mutateAsync({ pageId: page.id })
      setAiReview(result)
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      toast.error(message ?? "Couldn't generate meta. Try again in a moment.")
    }
  }

  function handleApplyAi(newTitle: string | null, newDesc: string | null) {
    if (newTitle !== null) setTitle(newTitle)
    if (newDesc !== null) setDesc(newDesc)
    setAiReview(null)
    toast.success("Applied to the draft - review and save when you're ready")
  }

  async function handleSave() {
    if (!page) return
    const r = initialRef.current
    const payload: UpdatePageMetaPayload = {}
    if (title !== r.t) payload.customMetaTitle = title.trim() || null
    if (desc !== r.d) payload.customMetaDescription = desc.trim() || null
    if (directive !== r.dir) payload.indexDirective = directive
    if (nofollow !== r.nf) payload.nofollow = nofollow
    if (canonical !== r.c) payload.canonical = canonical.trim() || null
    if (ogTitle !== r.ot) payload.ogTitle = ogTitle.trim() || null
    if (ogDescription !== r.od) payload.ogDescription = ogDescription.trim() || null
    if (ogImage !== r.oi) payload.ogImage = ogImage.trim() || null
    if (ogImageId !== r.oid) payload.ogImageId = ogImageId

    if (Object.keys(payload).length === 0) return
    try {
      await update.mutateAsync({ pageId: page.id, payload })
      // refresh the baseline so the page is no longer "dirty"
      initialRef.current = {
        t: title, d: desc, dir: directive, nf: nofollow, c: canonical,
        ot: ogTitle, od: ogDescription, oi: ogImage, oid: ogImageId,
      }
      setSavedTick((t) => t + 1)
      toast.success('Saved - queued to push to WordPress')
    } catch {
      toast.error('Failed to save meta')
    }
  }

  async function handleApplyToWp() {
    try {
      await triggerPageSync.mutateAsync()
      toast.success('Pushing this page to WordPress…')
    } catch {
      toast.error("Couldn't start the sync. Try again.")
    }
  }

  async function handleOgFile(file: File | undefined | null) {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image file.')
      return
    }
    try {
      const media = await uploadOg.mutateAsync(file)
      setOgImage(media.url)
      setOgImageId(media.id)
      toast.success('Uploaded to the WordPress media library')
    } catch (e) {
      toast.error((e as Error).message || 'Upload failed')
    } finally {
      if (ogFileRef.current) ogFileRef.current.value = ''
    }
  }

  const titleOver = title.length > TITLE_LIMIT
  const descOver = desc.length > DESC_LIMIT
  const pagePending = pageSyncStatus === 'pending' || pageSyncStatus === 'failed'

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="px-8 pt-8 pb-4 border-b border-white/8 flex-shrink-0">
        <div className="flex items-center gap-2 text-[13px] mb-4">
          <button onClick={() => guardedNav('/sites')} className="text-[#9aa0a6] hover:text-[#e8eaed] transition-colors">Sites</button>
          <ChevronRight className="size-3.5 text-[#9aa0a6]/40" />
          <button onClick={() => guardedNav(`/sites/${id}`)} className="text-[#9aa0a6] hover:text-[#e8eaed] transition-colors">
            {siteLoading ? <Skeleton className="h-4 w-24 bg-white/5 inline-block" /> : site?.name}
          </button>
          <ChevronRight className="size-3.5 text-[#9aa0a6]/40" />
          <button onClick={() => guardedNav(`/sites/${id}/meta`)} className="text-[#9aa0a6] hover:text-[#e8eaed] transition-colors">Meta</button>
          <ChevronRight className="size-3.5 text-[#9aa0a6]/40" />
          <span className="text-[#e8eaed] truncate max-w-[280px]" title={page?.url}>
            {isLoading ? <Skeleton className="h-4 w-40 bg-white/5 inline-block" /> : path}
          </span>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-[#e8eaed] tracking-tight flex items-center gap-2">
              Edit Meta
            </h1>
            {page && (
              <a href={page.url} target="_blank" rel="noopener noreferrer"
                className="text-[12px] text-[#4e8af4] hover:underline mt-1 inline-flex items-center gap-1" title={page.url}>
                <span className="truncate max-w-[480px]">{path}</span>
                <ExternalLink className="size-3 flex-shrink-0" />
              </a>
            )}
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <WpPluginStatus siteId={id!} />
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="px-8 py-6 space-y-3 max-w-2xl">
          {[90, 70, 80, 60].map((w, i) => (
            <Skeleton key={i} className="h-10 bg-white/5 rounded-lg" style={{ width: `${w}%` }} />
          ))}
        </div>
      ) : !page ? (
        <div className="px-8 py-16 text-center">
          <p className="text-[#9aa0a6] text-sm mb-3">This page isn’t in the library.</p>
          <Button variant="ghost" onClick={() => navigate(`/sites/${id}/meta`)} className="text-[#4e8af4]">
            Back to Meta
          </Button>
        </div>
      ) : (
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Left: form */}
          <div className="flex-1 min-w-0 overflow-y-auto px-8 py-6">
            <div className="max-w-2xl space-y-8 pb-24">
              {/* AI generate */}
              <button
                type="button"
                onClick={handleGenerate}
                disabled={generateMeta.isPending}
                className="flex items-center gap-2 bg-[#4e8af4]/10 border border-[#4e8af4]/20 text-[#4e8af4] hover:bg-[#4e8af4]/20 h-9 px-3 text-[13px] rounded-lg transition-all disabled:opacity-60"
              >
                {generateMeta.isPending
                  ? <><RefreshCw className="size-3.5 animate-spin" />Generating…</>
                  : <><Sparkles className="size-3.5" />Generate title &amp; description with AI</>}
              </button>

              {/* ── Search appearance ── */}
              <section className="space-y-5">
                <h2 className={SECTION_LABEL}>Search appearance</h2>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className={FIELD_LABEL}>Meta Title</Label>
                    <span className={`text-[11px] tabular-nums ${titleOver ? 'text-amber-400' : 'text-[#9aa0a6]'}`}>{title.length} / {TITLE_LIMIT}</span>
                  </div>
                  <textarea value={title} onChange={(e) => setTitle(e.target.value)} rows={2}
                    placeholder="Write a meta title - aim for 50-60 characters" className={`${INPUT_CLS} resize-none`} />
                  {page.metaTitle && <p className="text-[11px] text-[#9aa0a6]">Scraped: <span className="text-[#e8eaed]/60">{page.metaTitle}</span></p>}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className={FIELD_LABEL}>Meta Description</Label>
                    <span className={`text-[11px] tabular-nums ${descOver ? 'text-amber-400' : 'text-[#9aa0a6]'}`}>{desc.length} / {DESC_LIMIT}</span>
                  </div>
                  <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={4}
                    placeholder="Write a meta description - aim for 120-160 characters" className={`${INPUT_CLS} resize-none`} />
                </div>

                <div className="space-y-2">
                  <Label className={`${FIELD_LABEL} flex items-center gap-1.5`}><Link2 className="size-3" />Canonical URL</Label>
                  <input type="url" value={canonical} onChange={(e) => setCanonical(e.target.value)}
                    placeholder={page.url} className={`${INPUT_CLS} font-mono`} />
                  {canonicalInvalid ? (
                    <p className="text-[11px] text-amber-400 flex items-center gap-1"><AlertTriangle className="size-3" />Enter an absolute http(s) URL.</p>
                  ) : canonicalLooksSelf ? (
                    <p className="text-[11px] text-amber-400 flex items-center gap-1"><AlertTriangle className="size-3" />Same as the page URL — leave empty for a self-referencing canonical instead.</p>
                  ) : (
                    <p className="text-[10px] text-[#9aa0a6]/50">Leave empty to use the page URL as canonical.</p>
                  )}
                </div>
              </section>

              <Separator className="bg-white/8" />

              {/* ── Robots ── */}
              <section className="space-y-5">
                <h2 className={SECTION_LABEL}>Robots</h2>
                <div className="space-y-2">
                  <Label className={`${FIELD_LABEL} flex items-center gap-1.5`}><EyeOff className="size-3" />Indexing</Label>
                  <Segmented<IndexDirective>
                    value={directive}
                    onChange={setDirective}
                    options={[
                      { value: 'default', label: 'Yoast default' },
                      { value: 'index', label: 'Index' },
                      { value: 'noindex', label: 'Noindex', danger: true },
                    ]}
                  />
                  <p className="text-[10px] text-[#9aa0a6]/50">
                    {directive === 'default'
                      ? 'Inherits the post-type default configured in Yoast.'
                      : directive === 'index'
                      ? 'Forces an explicit index directive (pins the page).'
                      : 'Tells search engines not to index this page.'}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label className={FIELD_LABEL}>Link following</Label>
                  <Segmented<'follow' | 'nofollow'>
                    value={nofollow ? 'nofollow' : 'follow'}
                    onChange={(v) => setNofollow(v === 'nofollow')}
                    options={[
                      { value: 'follow', label: 'Follow' },
                      { value: 'nofollow', label: 'Nofollow', danger: true },
                    ]}
                  />
                </div>

                {/* Effective directive + warnings */}
                <div className="rounded-lg border border-white/8 bg-[#0f1117] px-3 py-2.5 space-y-2">
                  <p className="text-[11px] text-[#9aa0a6]">
                    Google sees:{' '}
                    <span className={`font-medium ${directive === 'noindex' || nofollow ? 'text-amber-400' : 'text-emerald-400'}`}>
                      {effectiveIndex}, {effectiveFollow}
                    </span>
                  </p>
                  {effectiveIndex !== 'noindex' && nofollow && (
                    <p className="text-[11px] text-amber-400 flex items-start gap-1"><AlertTriangle className="size-3 mt-0.5 flex-shrink-0" />Unusual — indexes the page but trusts none of its links.</p>
                  )}
                  {directive === 'noindex' && nofollow && (
                    <p className="text-[11px] text-amber-400 flex items-start gap-1"><AlertTriangle className="size-3 mt-0.5 flex-shrink-0" />Aggressive — removes the page and drops its link signals. Most thin pages want noindex, follow.</p>
                  )}
                </div>
              </section>

              <Separator className="bg-white/8" />

              {/* ── Open Graph ── */}
              <section className="space-y-5">
                <h2 className={SECTION_LABEL}>Open Graph (social sharing)</h2>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className={FIELD_LABEL}>OG Title</Label>
                    <span className="text-[11px] tabular-nums text-[#9aa0a6]">{ogTitle.length} / {OG_TITLE_LIMIT}</span>
                  </div>
                  <input value={ogTitle} onChange={(e) => setOgTitle(e.target.value)}
                    placeholder={title ? `Inherits: ${title}` : 'Inherits the meta title'} className={INPUT_CLS} />
                  <p className="text-[10px] text-[#9aa0a6]/50">Leave empty to inherit the meta title.</p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className={FIELD_LABEL}>OG Description</Label>
                    <span className="text-[11px] tabular-nums text-[#9aa0a6]">{ogDescription.length} / {OG_DESC_LIMIT}</span>
                  </div>
                  <textarea value={ogDescription} onChange={(e) => setOgDescription(e.target.value)} rows={3}
                    placeholder={desc ? `Inherits: ${desc}` : 'Inherits the meta description'} className={`${INPUT_CLS} resize-none`} />
                </div>

                <div className="space-y-2">
                  <Label className={`${FIELD_LABEL} flex items-center gap-1.5`}><ImageIcon className="size-3" />OG Image</Label>
                  <input
                    ref={ogFileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => handleOgFile(e.target.files?.[0])}
                  />
                  <div className="flex items-start gap-3">
                    <div className="size-16 flex-shrink-0 rounded-lg overflow-hidden bg-[#0f1117] border border-white/8 grid place-items-center">
                      {ogImage ? (
                        <img src={ogImage} alt="" className="size-full object-cover"
                          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
                      ) : (
                        <ImageIcon className="size-5 text-[#9aa0a6]/40" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="ghost" disabled={uploadOg.isPending}
                          onClick={() => ogFileRef.current?.click()}
                          className="h-8 px-3 text-[12px] bg-[#4e8af4]/10 border border-[#4e8af4]/20 text-[#4e8af4] hover:bg-[#4e8af4]/20 gap-1.5">
                          <Upload className={`size-3.5 ${uploadOg.isPending ? 'animate-pulse' : ''}`} />
                          {uploadOg.isPending ? 'Uploading…' : 'Upload from computer'}
                        </Button>
                        <Button type="button" variant="ghost" onClick={() => setPickerOpen(true)}
                          className="h-8 px-3 text-[12px] text-[#9aa0a6] hover:text-[#e8eaed] border border-white/8">Choose from library</Button>
                        {ogImage && (
                          <Button type="button" variant="ghost" onClick={() => { setOgImage(''); setOgImageId(null) }}
                            className="h-8 px-2 text-[#9aa0a6] hover:text-red-400" title="Clear"><X className="size-4" /></Button>
                        )}
                      </div>
                      {ogImage ? (
                        <>
                          <p className="text-[11px] text-[#9aa0a6]/70 font-mono truncate" title={ogImage}>{ogImage.replace(/^https?:\/\//, '')}</p>
                          {ogImageId != null ? (
                            <p className="text-[10px] text-emerald-400/80 flex items-center gap-1"><CheckCircle2 className="size-3" />Stored in WordPress media · attachment #{ogImageId}</p>
                          ) : (
                            <p className="text-[10px] text-[#9aa0a6]/60">Linked image (not tracked as a media attachment).</p>
                          )}
                        </>
                      ) : (
                        <p className="text-[10px] text-[#9aa0a6]/50">Upload a file or pick from the library. Recommended ≥ 1200×630 (1.91:1). Leave empty to use the site default.</p>
                      )}
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>

          {/* Right rail */}
          <div className="w-[40%] min-w-[420px] max-w-[560px] flex-shrink-0 flex flex-col min-h-0 border-l border-white/8">
            <div className="flex-1 overflow-y-auto px-5 py-6 space-y-5">
              <SerpPreview title={title} description={desc} url={canonical || page.url} favicon={site?.favicon} />
              <SocialPreview
                ogTitle={resolvedOgTitle}
                ogDescription={resolvedOgDesc}
                ogImage={ogImage}
                url={page.url}
                titleInherited={!ogTitle}
                descInherited={!ogDescription}
              />

              {/* WP sync */}
              <div className="rounded-lg border border-white/8 bg-[#1e2132] p-4 space-y-3">
                <p className="text-[11px] font-medium uppercase tracking-widest text-[#9aa0a6]">WordPress sync</p>
                <div className="flex items-center justify-between">
                  <span className="text-[13px] text-[#e8eaed] capitalize">{pageSyncStatus}</span>
                  <Button
                    size="sm"
                    onClick={handleApplyToWp}
                    disabled={!!noWpKey || triggerPageSync.isPending || !pagePending}
                    title={
                      noWpKey
                        ? 'Add a WordPress API key in site settings to apply'
                        : !pagePending
                          ? 'Nothing to push — save a change first'
                          : 'Push this page to WordPress'
                    }
                    className="h-8 px-3 text-[12px] bg-[#4e8af4] hover:bg-[#4e8af4]/90 text-white gap-1.5 disabled:opacity-50"
                  >
                    <Upload className="size-3.5" />Apply
                  </Button>
                </div>
                {noWpKey && <p className="text-[11px] text-amber-400">No WordPress API key configured for this site.</p>}
              </div>

              {/* History */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Clock className="size-3.5 text-[#9aa0a6]" />
                  <h3 className="text-[11px] font-medium uppercase tracking-widest text-[#9aa0a6]">Change History</h3>
                  {history.length > 0 && <span className="text-[10px] bg-white/8 text-[#9aa0a6] px-1.5 py-0.5 rounded-full ml-auto">{history.length}</span>}
                </div>
                <MetaHistoryTimeline entries={history} isLoading={historyLoading} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sticky save bar */}
      {page && dirty && (
        <div className="flex-shrink-0 border-t border-white/8 bg-[#1a1d27] px-8 py-3 flex items-center justify-between">
          <span className="text-[12px] text-amber-400">Unsaved changes</span>
          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => guardedNav(`/sites/${id}/meta`)} className="h-9 text-[#9aa0a6] hover:text-[#e8eaed]">Cancel</Button>
            <Button onClick={handleSave} disabled={update.isPending || canonicalInvalid}
              className="h-9 px-5 bg-[#4e8af4] hover:bg-[#4e8af4]/90 text-white">
              {update.isPending ? <><RefreshCw className="size-4 mr-2 animate-spin" />Saving…</> : 'Save Changes'}
            </Button>
          </div>
        </div>
      )}

      <OgImagePicker
        siteId={id!}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(url, attId) => { setOgImage(url); setOgImageId(attId); setPickerOpen(false) }}
      />

      {aiReview && page && (
        <AiReviewDialog
          open={!!aiReview}
          onClose={() => setAiReview(null)}
          onApply={handleApplyAi}
          current={{ title, desc }}
          generated={aiReview}
          pageUrl={page.url}
          siteFavicon={site?.favicon}
        />
      )}
    </div>
  )
}
