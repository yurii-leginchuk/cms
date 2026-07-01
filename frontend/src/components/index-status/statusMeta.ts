import type { DerivedStatus } from '@/api/crawl'

export interface StatusMeta {
  label: string
  /** pill classes (bg/text/border) */
  cls: string
  /** small leading dot color class */
  dot: string
  /** loud states pulse (unknown = fail-loud) */
  pulse?: boolean
}

/**
 * Visual mapping for derived index status. Honesty rules from the plan:
 *  - `null` (never checked) is NEUTRAL zinc — never red or green.
 *  - `unknown` is LOUD (violet + pulse) — an unrecognised Google state must be
 *    obvious, never silently shown as "not indexed".
 */
const META: Record<DerivedStatus, StatusMeta> = {
  indexed: {
    label: 'Indexed',
    cls: 'bg-emerald-400/10 text-emerald-300 border-emerald-400/25',
    dot: 'bg-emerald-400',
  },
  crawled_not_indexed: {
    label: 'Crawled – not indexed',
    cls: 'bg-amber-400/10 text-amber-300 border-amber-400/25',
    dot: 'bg-amber-400',
  },
  discovered_not_indexed: {
    label: 'Discovered – not indexed',
    cls: 'bg-orange-400/10 text-orange-300 border-orange-400/25',
    dot: 'bg-orange-400',
  },
  excluded_noindex: {
    label: 'Excluded (noindex)',
    cls: 'bg-slate-400/10 text-slate-300 border-slate-400/25',
    dot: 'bg-slate-400',
  },
  blocked_robots: {
    label: 'Blocked by robots',
    cls: 'bg-slate-400/10 text-slate-300 border-slate-400/25',
    dot: 'bg-slate-400',
  },
  canonical_alternate: {
    label: 'Alternate (canonical)',
    cls: 'bg-sky-400/10 text-sky-300 border-sky-400/25',
    dot: 'bg-sky-400',
  },
  redirect: {
    label: 'Redirect',
    cls: 'bg-slate-400/10 text-slate-300 border-slate-400/25',
    dot: 'bg-slate-400',
  },
  not_found: {
    label: 'Not found (404)',
    cls: 'bg-red-400/10 text-red-300 border-red-400/25',
    dot: 'bg-red-400',
  },
  soft_404: {
    label: 'Soft 404',
    cls: 'bg-red-400/10 text-red-300 border-red-400/25',
    dot: 'bg-red-400',
  },
  server_error: {
    label: 'Server error',
    cls: 'bg-red-400/10 text-red-300 border-red-400/25',
    dot: 'bg-red-400',
  },
  forbidden: {
    label: 'Forbidden',
    cls: 'bg-red-400/10 text-red-300 border-red-400/25',
    dot: 'bg-red-400',
  },
  unknown_to_google: {
    label: 'Unknown to Google',
    cls: 'bg-zinc-400/10 text-zinc-300 border-zinc-400/25',
    dot: 'bg-zinc-400',
  },
  unknown: {
    label: 'Unknown status',
    cls: 'bg-violet-400/15 text-violet-300 border-violet-400/40',
    dot: 'bg-violet-400',
    pulse: true,
  },
}

/** Neutral "never checked" state (no status row yet). */
export const NEVER_CHECKED: StatusMeta = {
  label: 'Never checked',
  cls: 'bg-white/[0.03] text-[#9aa0a6] border-white/10',
  dot: 'bg-[#9aa0a6]/40',
}

export function statusMeta(status: DerivedStatus | null | undefined): StatusMeta {
  if (!status) return NEVER_CHECKED
  return META[status] ?? META.unknown
}
