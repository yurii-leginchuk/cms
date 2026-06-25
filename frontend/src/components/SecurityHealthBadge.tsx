import { Badge } from '@/components/ui/badge'
import { Loader2, ShieldCheck, ShieldAlert, ShieldX, ShieldQuestion } from 'lucide-react'
import type { SiteHealth, SecuritySeverity, IncidentStatus } from '@/api/security'

// Severity ≠ status — two distinct visual axes, reusing the existing palette.
const SEVERITY_STYLE: Record<SecuritySeverity, string> = {
  critical: 'bg-red-500/15 text-red-400 border-red-500/20',
  high: 'bg-orange-500/15 text-orange-400 border-orange-500/20',
  medium: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
  low: 'bg-[#232635] text-[#9aa0a6] border-white/8',
  info: 'bg-[#232635] text-[#9aa0a6] border-white/8',
}

export function SeverityBadge({ severity }: { severity: SecuritySeverity }) {
  return (
    <Badge variant="outline" className={`text-[11px] font-medium capitalize ${SEVERITY_STYLE[severity]}`}>
      {severity}
    </Badge>
  )
}

const STATUS_STYLE: Record<IncidentStatus, string> = {
  open: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
  confirmed: 'bg-red-500/15 text-red-400 border-red-500/20',
  snoozed: 'bg-[#232635] text-[#9aa0a6] border-white/8',
  dismissed: 'bg-[#232635] text-[#9aa0a6]/70 border-white/8',
  false_positive: 'bg-[#232635] text-[#9aa0a6]/70 border-white/8',
  resolved: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
}

const STATUS_LABEL: Record<IncidentStatus, string> = {
  open: 'Open',
  confirmed: 'Confirmed',
  snoozed: 'Snoozed',
  dismissed: 'Dismissed',
  false_positive: 'False positive',
  resolved: 'Resolved',
}

export function IncidentStatusBadge({ status }: { status: IncidentStatus }) {
  return (
    <Badge variant="outline" className={`text-[11px] font-medium ${STATUS_STYLE[status]}`}>
      {STATUS_LABEL[status]}
    </Badge>
  )
}

const HEALTH: Record<SiteHealth, { label: string; className: string; icon: React.ElementType; spin?: boolean }> = {
  never_scanned: {
    label: 'Not scanned yet',
    className: 'bg-[#232635] text-[#9aa0a6] border-white/8',
    icon: ShieldQuestion,
  },
  scanning: {
    label: 'Scanning…',
    className: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
    icon: Loader2,
    spin: true,
  },
  clean: {
    label: 'Clean',
    className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
    icon: ShieldCheck,
  },
  warning: {
    label: 'Needs review',
    className: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
    icon: ShieldAlert,
  },
  critical: {
    label: 'Critical',
    className: 'bg-red-500/15 text-red-400 border-red-500/20',
    icon: ShieldX,
  },
}

export function SecurityHealthBadge({ health }: { health: SiteHealth }) {
  const cfg = HEALTH[health]
  const Icon = cfg.icon
  return (
    <Badge variant="outline" className={`gap-1.5 text-[12px] font-medium px-2.5 py-1 ${cfg.className}`}>
      <Icon className={`size-3.5 ${cfg.spin ? 'animate-spin' : ''}`} />
      {cfg.label}
    </Badge>
  )
}
