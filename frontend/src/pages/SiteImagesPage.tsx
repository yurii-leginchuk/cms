import { useState } from 'react'
import { useParams, Navigate } from 'react-router-dom'
import { toast } from 'sonner'
import { McpChangesBanner } from '@/components/McpChangesBanner'
import {
  Image as ImageIcon, Search, RefreshCw, Sparkles, UploadCloud, ImageOff,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import Pagination from '@/components/Pagination'
import { ImageAltRow } from '@/components/ImageAltRow'
import { ApplyAllImagesDialog } from '@/components/ApplyAllImagesDialog'
import { useSite } from '@/hooks/useSites'
import {
  useImages, useImageCoverage, useReconcileImages, useGenerateMissing,
} from '@/hooks/useImages'

const LIMIT = 25

function CoverageBadge({ siteId }: { siteId: string }) {
  const { data: c } = useImageCoverage(siteId)
  if (!c) return null
  const placementPct = c.placementsTotal
    ? Math.round((c.placementsWithAlt / c.placementsTotal) * 100)
    : 0
  return (
    <div className="flex items-center gap-3 text-[12px]">
      <span className="text-[#9aa0a6]">
        <span className="text-[#e8eaed] font-medium">{c.imagesTotal - c.imagesMissing}</span>/
        {c.imagesTotal} images with alt
      </span>
      <span className="h-3 w-px bg-white/10" />
      <span className="text-[#9aa0a6]">{placementPct}% of placements covered</span>
      {c.pendingChanges > 0 && (
        <>
          <span className="h-3 w-px bg-white/10" />
          <span className="text-amber-400">{c.pendingChanges} pending</span>
        </>
      )}
      {c.asOf && (
        <span className="text-[#9aa0a6]/50" title="Oldest contributing page scrape">
          · as of {new Date(c.asOf).toLocaleDateString()}
        </span>
      )}
    </div>
  )
}

export default function SiteImagesPage() {
  const { id: siteId } = useParams<{ id: string }>()
  const { data: site } = useSite(siteId!)
  const [page, setPage] = useState(1)
  const [missingOnly, setMissingOnly] = useState(false)
  const [search, setSearch] = useState('')
  const [applyOpen, setApplyOpen] = useState(false)

  const { data, isLoading } = useImages(siteId!, { page, limit: LIMIT, missingOnly, search })
  const { data: coverage } = useImageCoverage(siteId!)
  const reconcile = useReconcileImages(siteId!)
  const generateMissing = useGenerateMissing(siteId!)

  if (!siteId) return <Navigate to="/sites" replace />

  const pending = coverage?.pendingChanges ?? 0
  const noWpKey = site && !site.wpApiKey

  return (
    <div className="max-w-4xl mx-auto px-6 py-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-1">
        <div className="size-8 rounded-lg bg-[#4e8af4]/15 grid place-items-center">
          <ImageIcon className="size-4 text-[#4e8af4]" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-[18px] font-semibold text-[#e8eaed]">Image ALT Text</h1>
          <p className="text-[12px] text-[#9aa0a6]">
            Write, review, and publish accessible alt text for {site?.name}
          </p>
        </div>
      </div>

      <div className="mb-4"><CoverageBadge siteId={siteId} /></div>

      <div className="mb-4"><McpChangesBanner siteId={siteId} module="alt" /></div>

      {/* Pending banner */}
      {pending > 0 && (
        <button
          onClick={() => setApplyOpen(true)}
          className="w-full flex items-center gap-2 mb-4 rounded-xl border border-amber-500/40 bg-amber-500/[0.06] px-4 py-2.5 text-[13px] text-amber-300 hover:bg-amber-500/[0.1]"
        >
          <UploadCloud className="size-4" />
          {pending} alt change{pending === 1 ? '' : 's'} ready - review and apply to WordPress
        </button>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-[#9aa0a6]" />
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            placeholder="Filter by image URL…"
            className="pl-8 h-8 text-[13px]"
          />
        </div>
        <div className="inline-flex rounded-lg border border-white/10 overflow-hidden">
          <button
            onClick={() => { setMissingOnly(false); setPage(1) }}
            className={`px-3 h-8 text-[12px] ${!missingOnly ? 'bg-[#4e8af4]/15 text-[#4e8af4]' : 'text-[#9aa0a6]'}`}
          >All</button>
          <button
            onClick={() => { setMissingOnly(true); setPage(1) }}
            className={`px-3 h-8 text-[12px] ${missingOnly ? 'bg-[#4e8af4]/15 text-[#4e8af4]' : 'text-[#9aa0a6]'}`}
          >Missing alt</button>
        </div>
        <Button
          size="sm" variant="outline" className="h-8"
          title={noWpKey ? 'Add a WordPress API key in site settings to sync the media library' : 'Pull in the WordPress media library, then map where each image is used'}
          onClick={() => reconcile.mutate(undefined, {
            onSuccess: (r) => toast.success(
              `Pulled ${r.media.fetched} media items (${r.media.created} new), mapped across ${r.pages} pages`,
            ),
            onError: (e) => toast.error((e as Error).message),
          })}
          disabled={reconcile.isPending || !!noWpKey}
        >
          <RefreshCw className={`size-3.5 ${reconcile.isPending ? 'animate-spin' : ''}`} /> Sync from WordPress
        </Button>
        <Button
          size="sm" variant="outline" className="h-8"
          onClick={() => generateMissing.mutate(undefined, {
            onSuccess: (r) => toast.success(`Generated ${r.generated} - ${r.needsReview} to review, ${r.failed} failed`),
            onError: (e) => toast.error((e as Error).message),
          })}
          disabled={generateMissing.isPending}
        >
          <Sparkles className={`size-3.5 ${generateMissing.isPending ? 'animate-pulse' : ''}`} />
          Generate all missing
        </Button>
        <Button
          size="sm" className="h-8" disabled={pending === 0 || !!noWpKey}
          title={noWpKey ? 'Add a WP API key in site settings to apply changes' : undefined}
          onClick={() => setApplyOpen(true)}
        >
          <UploadCloud className="size-3.5" /> Apply ({pending})
        </Button>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : !data || data.data.length === 0 ? (
        <div className="text-center py-16">
          <ImageOff className="size-8 text-[#9aa0a6]/40 mx-auto mb-3" />
          <p className="text-[13px] text-[#9aa0a6]">
            {missingOnly
              ? 'Every scanned image has alt text. Nice work.'
              : 'No images yet - sync from WordPress to build the library from your parsed pages.'}
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {data.data.map((img) => (
              <ImageAltRow key={img.id} siteId={siteId} image={img} />
            ))}
          </div>
          {data.meta.totalPages > 1 && (
            <div className="mt-4">
              <Pagination
                page={data.meta.page}
                totalPages={data.meta.totalPages}
                onChange={setPage}
              />
            </div>
          )}
        </>
      )}

      <ApplyAllImagesDialog open={applyOpen} onClose={() => setApplyOpen(false)} siteId={siteId} />
    </div>
  )
}
