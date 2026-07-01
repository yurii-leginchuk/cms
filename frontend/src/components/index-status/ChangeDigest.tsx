import { formatDistanceToNow } from 'date-fns'
import {
  ArrowDownCircle, ArrowUpCircle, Sparkle, HelpCircle, RefreshCcw, ExternalLink,
} from 'lucide-react'
import type { ChangeCategory, ChangeDigest, ChangeItem } from '@/api/crawl'
import { statusMeta } from './statusMeta'

interface CatMeta {
  label: string
  cls: string
  icon: React.ElementType
}

export const CATEGORY_META: Record<ChangeCategory, CatMeta> = {
  deindexed: { label: 'Deindexed', cls: 'text-red-300 bg-red-400/10 border-red-400/25', icon: ArrowDownCircle },
  became_unknown: { label: 'Unknown status', cls: 'text-violet-300 bg-violet-400/15 border-violet-400/30', icon: HelpCircle },
  reindexed: { label: 'Newly indexed', cls: 'text-emerald-300 bg-emerald-400/10 border-emerald-400/25', icon: ArrowUpCircle },
  status_change: { label: 'Status changed', cls: 'text-amber-300 bg-amber-400/10 border-amber-400/25', icon: RefreshCcw },
  first_seen: { label: 'Newly tracked', cls: 'text-sky-300 bg-sky-400/10 border-sky-400/25', icon: Sparkle },
}

const ORDER: ChangeCategory[] = ['deindexed', 'became_unknown', 'reindexed', 'status_change', 'first_seen']

/** Compact one-line count chips — used on the site Overview card. */
export function ChangeDigestChips({ digest }: { digest: ChangeDigest }) {
  const chips = ORDER.filter((c) => digest.categories[c] > 0)
  if (chips.length === 0) {
    return <span className="text-[12px] text-[#9aa0a6]">No changes in the last scan</span>
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((c) => {
        const m = CATEGORY_META[c]
        const Icon = m.icon
        return (
          <span key={c} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-medium border ${m.cls}`}>
            <Icon className="size-3" />{digest.categories[c]} {m.label.toLowerCase()}
          </span>
        )
      })}
    </div>
  )
}

/** Full "what changed after the last scan" panel — used on the Index Status page. */
export function ChangeDigestPanel({ digest }: { digest: ChangeDigest }) {
  const when = digest.finishedAt ?? digest.startedAt
  return (
    <div className="rounded-xl border border-white/8 bg-[#1a1d27]/60 px-5 py-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] uppercase tracking-widest text-[#9aa0a6]">
          What changed · last scan
          {digest.trigger && <span className="ml-2 text-[#9aa0a6]/60 lowercase">({digest.trigger})</span>}
        </p>
        <span className="text-[11px] text-[#9aa0a6]/70">
          {when ? formatDistanceToNow(new Date(when), { addSuffix: true }) : '—'} · {digest.pagesInspected} inspected
        </span>
      </div>

      {!digest.hasChanges ? (
        <p className="text-[13px] text-[#9aa0a6]">
          No state changes in the last scan — every inspected page held its previous status.
        </p>
      ) : (
        <>
          <div className="mb-3"><ChangeDigestChips digest={digest} /></div>
          <ul className="space-y-1.5">
            {digest.highlights.map((h) => <ChangeRow key={h.id} item={h} />)}
          </ul>
        </>
      )}
    </div>
  )
}

function ChangeRow({ item }: { item: ChangeItem }) {
  const m = CATEGORY_META[item.category]
  const Icon = m.icon
  const from = item.from ? statusMeta(item.from).label : null
  const to = item.to ? statusMeta(item.to).label : null
  const path = item.url.replace(/^https?:\/\/[^/]+/, '') || '/'
  return (
    <li className="flex items-center gap-2.5 text-[12px]">
      <Icon className={`size-3.5 flex-shrink-0 ${m.cls.split(' ')[0]}`} />
      <a
        href={item.url} target="_blank" rel="noopener noreferrer"
        className="text-[#9aa0a6] hover:text-[#e8eaed] truncate max-w-[280px] inline-flex items-center gap-1"
      >
        {path}<ExternalLink className="size-2.5 opacity-40" />
      </a>
      <span className="text-[#9aa0a6]/70">
        {from ? <>{from} → <span className="text-[#e8eaed]">{to}</span></> : <span className="text-[#e8eaed]">{to}</span>}
      </span>
    </li>
  )
}
