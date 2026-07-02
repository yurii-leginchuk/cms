import type { AuditDiffState, AuditSeverity } from '@/api/audit'

/** Max 3 severity tiers (UX advisory) — red / amber / sky, reusing chip styling. */
export const SEVERITY_META: Record<AuditSeverity, { label: string; cls: string; dot: string }> = {
  critical: {
    label: 'Critical',
    cls: 'text-red-300 bg-red-400/10 border-red-400/25',
    dot: 'bg-red-400',
  },
  warning: {
    label: 'Warning',
    cls: 'text-amber-300 bg-amber-400/10 border-amber-400/25',
    dot: 'bg-amber-400',
  },
  notice: {
    label: 'Notice',
    cls: 'text-sky-300 bg-sky-400/10 border-sky-400/25',
    dot: 'bg-sky-400',
  },
}

export const DIFF_META: Record<Exclude<AuditDiffState, null>, { label: string; cls: string; symbol: string }> = {
  new: { label: 'New', cls: 'text-red-300 bg-red-400/10 border-red-400/25', symbol: '▲' },
  persisting: { label: 'Persisting', cls: 'text-[#9aa0a6] bg-white/5 border-white/10', symbol: '●' },
  unconfirmed: { label: 'Not re-checked', cls: 'text-violet-300 bg-violet-400/15 border-violet-400/30', symbol: '?' },
  resolved: { label: 'Resolved', cls: 'text-emerald-300 bg-emerald-400/10 border-emerald-400/25', symbol: '✓' },
}

export const SEVERITY_ORDER: AuditSeverity[] = ['critical', 'warning', 'notice']
