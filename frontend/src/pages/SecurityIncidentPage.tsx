import { Link, useParams, Navigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ChevronRight, ExternalLink, Download, Check, XCircle, Clock, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useSecurityIncident, useTriageIncident } from '@/hooks/useSecurity'
import { securityApi } from '@/api/security'
import { SeverityBadge, IncidentStatusBadge } from '@/components/SecurityHealthBadge'
import { SecurityDiffView } from '@/components/SecurityDiffView'
import { downloadCsv } from '@/lib/csv'

type Action = 'confirm' | 'dismiss' | 'snooze' | 'resolve' | 'reopen'

export default function SecurityIncidentPage() {
  const { id, incidentId } = useParams<{ id: string; incidentId: string }>()
  const { data, isLoading } = useSecurityIncident(id!, incidentId!)
  const triage = useTriageIncident(id!)

  if (!id || !incidentId) return <Navigate to="/sites" replace />

  const incident = data?.incident

  const act = (action: Action, label: string) =>
    triage.mutate(
      { id: incidentId, action },
      {
        onSuccess: () => {
          if (action === 'reopen') {
            toast.success('Reopened')
            return
          }
          toast.success(label, {
            action: {
              label: 'Undo',
              onClick: () => triage.mutate({ id: incidentId, action: 'reopen' }),
            },
          })
        },
        onError: (e) => toast.error((e as Error)?.message ?? 'Action failed'),
      },
    )

  const exportEvidence = async () => {
    try {
      const { rows } = await securityApi.getEvidence(id, incidentId)
      downloadCsv(
        `incident-${incidentId.slice(0, 8)}.csv`,
        ['pageUrl', 'severity', 'score', 'detector', 'code', 'malicious', 'message', 'evidence', 'axisAStatus', 'axisBStatus', 'detectedAt'],
        rows.map((r) => [r.pageUrl, r.severity, r.score, r.detector, r.code, String(r.malicious), r.message, r.evidence, r.axisAStatus, r.axisBStatus, r.detectedAt]),
      )
    } catch (e) {
      toast.error((e as Error)?.message ?? 'Export failed')
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="px-8 pt-8 pb-4 border-b border-white/8">
        <div className="flex items-center gap-2 text-[13px] mb-4">
          <Link to={`/sites/${id}/security`} className="text-[#9aa0a6] hover:text-[#e8eaed]">Security</Link>
          <ChevronRight className="size-3.5 text-[#9aa0a6]/40" />
          <span className="text-[#e8eaed]">Incident</span>
        </div>

        {isLoading || !incident ? (
          <Skeleton className="h-8 w-96 bg-white/5" />
        ) : (
          <>
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <SeverityBadge severity={incident.severity} />
              <IncidentStatusBadge status={incident.status} />
              {incident.affectedPageCount > 1 && (
                <span className="text-[12px] text-[#9aa0a6]">{incident.affectedPageCount} pages affected</span>
              )}
            </div>
            <h1 className="text-lg font-semibold text-[#e8eaed] tracking-tight">{incident.title}</h1>
          </>
        )}
      </div>

      <div className="px-8 py-6 space-y-6">
        {isLoading || !data ? (
          <Skeleton className="h-64 bg-white/5 rounded-xl" />
        ) : (
          <>
            {/* Triage controls */}
            <div className="flex items-center gap-2 flex-wrap">
              <Button size="sm" variant="outline" className="h-8 border-red-500/30 text-red-400 hover:bg-red-500/10"
                disabled={triage.isPending} onClick={() => act('confirm', 'Confirmed as a real issue')}>
                <Check className="size-3.5" /> Confirm hack
              </Button>
              <Button size="sm" variant="outline" className="h-8 border-white/10 text-[#e8eaed] hover:bg-white/5"
                disabled={triage.isPending} onClick={() => act('dismiss', 'Dismissed — pattern suppressed')}>
                <XCircle className="size-3.5" /> False positive
              </Button>
              <Button size="sm" variant="outline" className="h-8 border-white/10 text-[#e8eaed] hover:bg-white/5"
                disabled={triage.isPending} onClick={() => act('snooze', 'Snoozed for 7 days')}>
                <Clock className="size-3.5" /> Snooze
              </Button>
              <Button size="sm" variant="outline" className="h-8 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                disabled={triage.isPending} onClick={() => act('resolve', 'Marked resolved')}>
                <CheckCircle2 className="size-3.5" /> Resolve
              </Button>
              <Button size="sm" variant="outline" className="h-8 border-white/10 text-[#e8eaed] hover:bg-white/5 ml-auto"
                onClick={exportEvidence}>
                <Download className="size-3.5" /> Export evidence
              </Button>
            </div>

            {/* Diff */}
            <SecurityDiffView detail={data} />

            {/* Affected pages */}
            {data.affectedPages.length > 0 && (
              <div className="rounded-xl border border-white/8 bg-[#1a1d27] px-4 py-3">
                <p className="text-[11px] text-[#9aa0a6] mb-2">Affected pages ({data.affectedPages.length})</p>
                <div className="space-y-1">
                  {data.affectedPages.map((url) => (
                    <a key={url} href={url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-[12px] text-[#4e8af4] hover:underline">
                      <ExternalLink className="size-3" /> {url}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
