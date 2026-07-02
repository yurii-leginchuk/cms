import { Link } from 'react-router-dom'
import { Wrench } from 'lucide-react'
import type { AuditFindingLite, AuditSummary } from '@/api/audit'
import { SEVERITY_META } from './auditMeta'

/**
 * "What changed this week" — the diff is the hero (▲ new / ● persisting /
 * ✓ resolved), severity only organizes. Resolved lines say WHY they're
 * believable: verified absent in a complete re-check.
 */
export function AuditChangeDigest({
  summary,
  onOpenFinding,
}: {
  summary: AuditSummary
  onOpenFinding: (id: string) => void
}) {
  const digest = summary.digest
  if (!digest) return null
  const hasAnything =
    digest.newCount > 0 || digest.resolvedCount > 0 || digest.persistingCount > 0 || digest.unconfirmedCount > 0

  return (
    <div className="rounded-xl border border-white/8 bg-[#1a1d27]/60 px-5 py-4">
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <p className="text-[11px] uppercase tracking-widest text-[#9aa0a6]">What changed this week</p>
        <div className="flex items-center gap-2 text-[12px]">
          <Chip cls="text-red-300 bg-red-400/10 border-red-400/25">▲ {digest.newCount} new</Chip>
          <Chip cls="text-[#9aa0a6] bg-white/5 border-white/10">● {digest.persistingCount} persisting</Chip>
          <Chip cls="text-emerald-300 bg-emerald-400/10 border-emerald-400/25">✓ {digest.resolvedCount} resolved</Chip>
          {digest.unconfirmedCount > 0 && (
            <Chip cls="text-violet-300 bg-violet-400/15 border-violet-400/30">
              ? {digest.unconfirmedCount} not re-checked
            </Chip>
          )}
        </div>
      </div>

      {!hasAnything ? (
        <p className="text-[13px] text-[#9aa0a6]">
          No changes versus the previous run — nothing new, nothing to re-verify.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {digest.newFindings.map((f) => (
            <DigestRow key={f.id} f={f} symbol="▲" symbolCls="text-red-300" onOpen={onOpenFinding} />
          ))}
          {digest.resolvedFindings.map((f) => (
            <DigestRow
              key={f.id} f={f} symbol="✓" symbolCls="text-emerald-300"
              suffix="verified absent this run" onOpen={onOpenFinding}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function Chip({ cls, children }: { cls: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-medium border ${cls}`}>
      {children}
    </span>
  )
}

function DigestRow({
  f, symbol, symbolCls, suffix, onOpen,
}: {
  f: AuditFindingLite
  symbol: string
  symbolCls: string
  suffix?: string
  onOpen: (id: string) => void
}) {
  const sev = SEVERITY_META[f.severity]
  return (
    <li className="flex items-center gap-2.5 text-[12px]">
      <span className={`${symbolCls} w-3 text-center flex-shrink-0`}>{symbol}</span>
      <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide border ${sev.cls}`}>
        {sev.label}
      </span>
      <button
        onClick={() => onOpen(f.id)}
        className="text-[#e8eaed] hover:text-[#4e8af4] truncate max-w-[440px] text-left"
        title={f.title}
      >
        {f.title}
      </button>
      {f.affectedCount > 1 && <span className="text-[#9aa0a6]">— {f.affectedCount} pages</span>}
      {suffix && <span className="text-emerald-300/70">· {suffix}</span>}
      {f.fixRoute && f.status === 'open' && (
        <Link
          to={`${f.fixRoute}?from=audit&finding=${f.id}`}
          className="inline-flex items-center gap-1 text-[11px] text-[#4e8af4] hover:underline flex-shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <Wrench className="size-3" />Fix in CMS
        </Link>
      )}
    </li>
  )
}
