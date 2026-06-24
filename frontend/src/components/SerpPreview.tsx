interface SerpPreviewProps {
  title: string
  description: string
  url: string
  favicon?: string | null
}

const TITLE_LIMIT = 60
const DESC_LIMIT = 160

function truncate(str: string, max: number) {
  if (!str) return ''
  return str.length > max ? str.slice(0, max - 1) + '…' : str
}

export function SerpPreview({ title, description, url, favicon }: SerpPreviewProps) {
  const displayTitle = title || 'Page Title'
  const displayDesc = description || 'Meta description will appear here.'

  const titleTruncated = truncate(displayTitle, TITLE_LIMIT)
  const descTruncated = truncate(displayDesc, DESC_LIMIT)

  const titleOver = title.length > TITLE_LIMIT
  const descOver = description.length > DESC_LIMIT

  return (
    <div className="rounded-lg border border-white/8 bg-[#1e2132] p-4 space-y-1">
      <p className="text-[11px] font-medium uppercase tracking-widest text-[#9aa0a6] mb-3">
        SERP Preview
      </p>

      {/* Favicon + URL row */}
      <div className="flex items-center gap-2">
        {favicon ? (
          <img
            src={favicon}
            className="size-4 rounded-sm object-contain flex-shrink-0"
            alt=""
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
          />
        ) : (
          <div className="size-4 rounded-sm bg-[#232635] flex items-center justify-center text-[8px] text-[#9aa0a6] flex-shrink-0">
            ☆
          </div>
        )}
        <div className="flex flex-col leading-none">
          <span className="text-[13px] text-[#e8eaed]">
            {new URL(url.startsWith('http') ? url : `https://${url}`).hostname}
          </span>
          <span className="text-[11px] text-[#9aa0a6] truncate max-w-[280px]">{url}</span>
        </div>
      </div>

      {/* Title */}
      <p
        className={`text-[19px] leading-snug font-normal ${
          titleOver ? 'text-amber-400' : 'text-[#4e8af4]'
        }`}
      >
        {titleTruncated}
      </p>

      {/* Description */}
      <p className="text-[13px] text-[#9aa0a6] leading-relaxed">
        {descTruncated}
      </p>

      {/* Char counters */}
      <div className="flex gap-4 pt-2 text-[11px]">
        <span className={titleOver ? 'text-amber-400' : 'text-[#9aa0a6]'}>
          Title: {title.length}/{TITLE_LIMIT}
        </span>
        <span className={descOver ? 'text-amber-400' : 'text-[#9aa0a6]'}>
          Desc: {description.length}/{DESC_LIMIT}
        </span>
      </div>
    </div>
  )
}
