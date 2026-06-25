import { Link } from 'react-router-dom'
import { ChevronRight, Files } from 'lucide-react'
import { SeverityBadge, IncidentStatusBadge } from './SecurityHealthBadge'
import type { SecurityIncident } from '@/api/security'

const DETECTOR_LABEL: Record<string, string> = {
  redirect_cloak: 'Cloaked redirect',
  spam_lexicon: 'Spam content',
  injected_scripts: 'Injected script',
  content_diff: 'Content mismatch',
  unreachable: 'Unreachable',
}

export function SecurityIncidentCard({ siteId, incident }: { siteId: string; incident: SecurityIncident }) {
  const dim = ['dismissed', 'false_positive', 'resolved'].includes(incident.status)
  return (
    <Link
      to={`/sites/${siteId}/security/${incident.id}`}
      className={`block rounded-xl border transition-colors ${
        dim
          ? 'border-white/8 bg-[#1a1d27] opacity-60 hover:opacity-100'
          : incident.severity === 'critical' || incident.severity === 'high'
            ? 'border-red-500/30 bg-red-500/[0.04] hover:border-red-500/50'
            : 'border-white/8 bg-[#1a1d27] hover:border-[#4e8af4]/30 hover:bg-[#1d2130]'
      }`}
    >
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <SeverityBadge severity={incident.severity} />
            <IncidentStatusBadge status={incident.status} />
            <span className="text-[11px] text-[#9aa0a6]">{DETECTOR_LABEL[incident.detector] ?? incident.detector}</span>
          </div>
          <div className="text-[13px] text-[#e8eaed] font-medium mt-1.5 line-clamp-2" title={incident.title}>
            {incident.title}
          </div>
          {incident.affectedPageCount > 1 && (
            <div className="flex items-center gap-1 text-[11px] text-[#9aa0a6] mt-1">
              <Files className="size-3" />
              {incident.affectedPageCount} pages affected
            </div>
          )}
        </div>
        <ChevronRight className="size-4 text-[#9aa0a6]/50 flex-shrink-0 mt-1" />
      </div>
    </Link>
  )
}
