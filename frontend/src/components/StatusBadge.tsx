import { Badge } from '@/components/ui/badge'
import { Loader2 } from 'lucide-react'

type ParseStatus = 'idle' | 'parsing' | 'done' | 'error'
type EmbedStatus = 'idle' | 'embedding' | 'done' | 'error'

const parseConfig: Record<ParseStatus, { label: string; className: string; spinning?: boolean }> = {
  idle: {
    label: 'Idle',
    className: 'bg-[#232635] text-[#9aa0a6] border-white/8 hover:bg-[#232635]',
  },
  parsing: {
    label: 'Parsing…',
    className: 'bg-amber-500/15 text-amber-400 border-amber-500/20 hover:bg-amber-500/15',
    spinning: true,
  },
  done: {
    label: 'Parsed',
    className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/15',
  },
  error: {
    label: 'Parse Error',
    className: 'bg-red-500/15 text-red-400 border-red-500/20 hover:bg-red-500/15',
  },
}

export function StatusBadge({ status }: { status: ParseStatus }) {
  const { label, className, spinning } = parseConfig[status] ?? parseConfig.idle
  return (
    <Badge variant="outline" className={`gap-1.5 text-[11px] font-medium ${className}`}>
      {spinning && <Loader2 className="size-3 animate-spin" />}
      {label}
    </Badge>
  )
}

const embedConfig: Record<EmbedStatus, { label: string; className: string; spinning?: boolean } | null> = {
  idle: null,
  done: {
    label: 'Embedded',
    className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/15',
  },
  embedding: {
    label: 'Embedding…',
    className: 'bg-blue-500/15 text-blue-400 border-blue-500/20 hover:bg-blue-500/15',
    spinning: true,
  },
  error: {
    label: 'Embedding failed',
    className: 'bg-red-500/15 text-red-400 border-red-500/20 hover:bg-red-500/15',
  },
}

export function EmbeddingBadge({ status, embedded, total }: {
  status: EmbedStatus
  embedded?: number
  total?: number
}) {
  // For legacy sites: status is 'idle' but embeddings already exist
  const effectiveStatus: EmbedStatus =
    status === 'idle' && embedded !== undefined && total !== undefined && total > 0 && embedded >= total
      ? 'done'
      : status

  const cfg = embedConfig[effectiveStatus]
  if (!cfg) return null
  return (
    <Badge variant="outline" className={`gap-1.5 text-[11px] font-medium ${cfg.className}`}>
      {cfg.spinning && <Loader2 className="size-3 animate-spin" />}
      {cfg.label}
      {cfg.spinning && embedded !== undefined && total !== undefined && (
        <span className="tabular-nums">{embedded}/{total}</span>
      )}
    </Badge>
  )
}
