import { useState } from 'react'
import { ImageOff, ImageIcon } from 'lucide-react'

interface SocialPreviewProps {
  /** Resolved OG title (falls back to meta title upstream). */
  ogTitle: string
  /** Resolved OG description (falls back to meta description upstream). */
  ogDescription: string
  /** OG image URL, or '' to show the fallback placeholder. */
  ogImage: string
  url: string
  /** True when the title/description shown is inherited, not explicitly set. */
  titleInherited?: boolean
  descInherited?: boolean
}

/**
 * Facebook / LinkedIn-style large summary card. Mirrors SerpPreview's visual
 * construction and reflects Yoast's live fallback chain: empty OG fields show
 * the inherited meta value rather than a blank box.
 */
export function SocialPreview({
  ogTitle,
  ogDescription,
  ogImage,
  url,
  titleInherited,
  descInherited,
}: SocialPreviewProps) {
  const [broken, setBroken] = useState(false)

  let hostname = url
  try {
    hostname = new URL(url.startsWith('http') ? url : `https://${url}`).hostname
  } catch {
    /* keep raw */
  }

  return (
    <div className="rounded-lg border border-white/8 bg-[#1e2132] overflow-hidden">
      <p className="text-[11px] font-medium uppercase tracking-widest text-[#9aa0a6] px-4 pt-4 pb-3">
        Social Preview
      </p>

      {/* Image area at OG aspect (1.91:1) */}
      <div className="relative w-full aspect-[1.91/1] bg-[#0f1117] border-y border-white/8 flex items-center justify-center">
        {ogImage && !broken ? (
          <img
            src={ogImage}
            alt=""
            className="w-full h-full object-cover"
            onError={() => setBroken(true)}
          />
        ) : ogImage && broken ? (
          <div className="flex flex-col items-center gap-1.5 text-red-400">
            <ImageOff className="size-6" />
            <span className="text-[11px]">Image can’t be loaded — it won’t render on social</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1.5 text-[#9aa0a6]/50">
            <ImageIcon className="size-6" />
            <span className="text-[11px]">No social image — uses the site’s default OG image</span>
          </div>
        )}
      </div>

      {/* Card text */}
      <div className="px-4 py-3 space-y-0.5">
        <p className="text-[10px] uppercase tracking-wide text-[#9aa0a6]/70 truncate">{hostname}</p>
        <p className="text-[14px] text-[#e8eaed] font-medium leading-snug line-clamp-2">
          {ogTitle || 'Untitled'}
          {titleInherited && (
            <span className="ml-1.5 text-[10px] font-normal text-[#9aa0a6]/60 align-middle">inherited</span>
          )}
        </p>
        <p className="text-[12px] text-[#9aa0a6] leading-snug line-clamp-2">
          {ogDescription || 'No description'}
          {descInherited && ogDescription && (
            <span className="ml-1.5 text-[10px] text-[#9aa0a6]/60">inherited</span>
          )}
        </p>
      </div>
    </div>
  )
}
