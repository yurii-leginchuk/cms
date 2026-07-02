import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import {
  BellOff, Bell, CheckCircle2, ExternalLink, History, RefreshCw, Wrench, Check,
} from 'lucide-react'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { RelativeClock } from '@/components/index-status/RelativeClock'
import { useAuditFinding, useMuteFinding, useUnmuteFinding, useAcceptFinding } from '@/hooks/useAudit'
import { DIFF_META, SEVERITY_META } from './auditMeta'

const URL_CAP = 20

/**
 * Right-hand finding detail: verbatim evidence rendered as FACT (no AI in
 * Phase 1 — when AI lands in Phase 3 it gets its own visually-distinct zone),
 * affected URLs (capped), the present/absent observation history, and the
 * human actions: Fix-in-CMS deep link (with return context), mute-with-reason,
 * accept-as-intended.
 */
export function FindingSheet({
  siteId,
  findingId,
  onClose,
}: {
  siteId: string
  findingId: string | null
  onClose: () => void
}) {
  const { data: finding, isLoading } = useAuditFinding(siteId, findingId ?? undefined)
  const mute = useMuteFinding(siteId)
  const unmute = useUnmuteFinding(siteId)
  const accept = useAcceptFinding(siteId)
  const [muteMode, setMuteMode] = useState(false)
  const [muteReason, setMuteReason] = useState('')

  async function handleMute() {
    if (!finding || !muteReason.trim()) return
    try {
      await mute.mutateAsync({ id: finding.id, reason: muteReason.trim() })
      toast.success('Finding muted — it will auto-resurface if it worsens.')
      setMuteMode(false)
      setMuteReason('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't mute the finding.")
    }
  }

  async function handleUnmute() {
    if (!finding) return
    try {
      await unmute.mutateAsync(finding.id)
      toast.success('Finding unmuted.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't unmute the finding.")
    }
  }

  async function handleAccept() {
    if (!finding) return
    try {
      await accept.mutateAsync({ id: finding.id })
      toast.success('Accepted as intended — kept visible, no longer alarms.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't accept the finding.")
    }
  }

  const sev = finding ? SEVERITY_META[finding.severity] : null
  const diff = finding?.diffState ? DIFF_META[finding.diffState] : null

  return (
    <Sheet open={findingId != null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="bg-[#151823] border-white/10 text-[#e8eaed] data-[side=right]:sm:max-w-xl overflow-y-auto"
      >
        {isLoading || !finding ? (
          <div className="p-6 flex items-center gap-2 text-[#9aa0a6] text-[13px]">
            <RefreshCw className="size-4 animate-spin" />Loading finding…
          </div>
        ) : (
          <>
            <SheetHeader className="pb-2">
              <div className="flex items-center gap-2 flex-wrap pr-8">
                {sev && (
                  <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide border ${sev.cls}`}>
                    {sev.label}
                  </span>
                )}
                {diff && (
                  <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium border ${diff.cls}`}>
                    {diff.symbol} {diff.label}
                  </span>
                )}
                <span className="text-[11px] text-[#9aa0a6]">{finding.checkLabel}</span>
                {finding.status === 'muted' && (
                  <span className="text-[11px] text-[#9aa0a6] inline-flex items-center gap-1">
                    <BellOff className="size-3" />muted
                  </span>
                )}
                {finding.status === 'accepted' && (
                  <span className="text-[11px] text-emerald-300/80 inline-flex items-center gap-1">
                    <Check className="size-3" />accepted as intended
                  </span>
                )}
              </div>
              <SheetTitle className="text-[#e8eaed] text-[15px] leading-snug">{finding.title}</SheetTitle>
              <SheetDescription className="text-[#9aa0a6] text-[12px]">
                First seen <RelativeClock ts={finding.firstSeenAt} /> · we last checked{' '}
                <RelativeClock ts={finding.lastEvaluatedAt} />
                {finding.regressionCount > 0 && (
                  <span className="text-amber-300/90"> · regressed {finding.regressionCount}×</span>
                )}
              </SheetDescription>
            </SheetHeader>

            <div className="px-4 pb-6 space-y-5">
              {/* Actions */}
              <div className="flex items-center gap-2 flex-wrap">
                {finding.fixRoute && finding.status !== 'resolved' && (
                  <Button
                    size="sm"
                    className="h-8 px-3 text-[12px] bg-[#4e8af4] hover:bg-[#4e8af4]/90 text-white gap-1.5"
                    render={
                      <Link to={`${finding.fixRoute}?from=audit&finding=${finding.id}`} />
                    }
                  >
                    <Wrench className="size-3.5" />Fix in CMS
                  </Button>
                )}
                {finding.status === 'open' && (
                  <>
                    <Button
                      size="sm" variant="ghost"
                      onClick={() => setMuteMode((v) => !v)}
                      className="h-8 px-2.5 text-[12px] text-[#9aa0a6] hover:text-[#e8eaed] border border-white/8 gap-1.5"
                    >
                      <BellOff className="size-3.5" />Mute
                    </Button>
                    <Button
                      size="sm" variant="ghost"
                      onClick={handleAccept}
                      disabled={accept.isPending}
                      className="h-8 px-2.5 text-[12px] text-[#9aa0a6] hover:text-[#e8eaed] border border-white/8 gap-1.5"
                      title="Keep it visible, stop alarming — for intentional configuration (e.g. syndication canonicals)."
                    >
                      <CheckCircle2 className="size-3.5" />Accept as intended
                    </Button>
                  </>
                )}
                {finding.status === 'muted' && (
                  <Button
                    size="sm" variant="ghost"
                    onClick={handleUnmute}
                    disabled={unmute.isPending}
                    className="h-8 px-2.5 text-[12px] text-[#9aa0a6] hover:text-[#e8eaed] border border-white/8 gap-1.5"
                  >
                    <Bell className="size-3.5" />Unmute
                  </Button>
                )}
              </div>

              {muteMode && finding.status === 'open' && (
                <div className="rounded-lg border border-white/8 bg-[#1a1d27] p-3 space-y-2">
                  <p className="text-[12px] text-[#9aa0a6]">
                    Why is this fine to silence? (required — the reason persists across runs; the
                    finding resurfaces automatically if it worsens)
                  </p>
                  <textarea
                    value={muteReason}
                    onChange={(e) => setMuteReason(e.target.value)}
                    rows={2}
                    placeholder="e.g. template page — intentionally noindexed by the theme"
                    className="w-full rounded-md bg-[#12141d] border border-white/8 text-[13px] text-[#e8eaed] p-2 focus:outline-none focus:ring-1 focus:ring-[#4e8af4]/50"
                  />
                  <div className="flex items-center gap-2 justify-end">
                    <Button size="sm" variant="ghost" onClick={() => setMuteMode(false)} className="h-7 text-[12px] text-[#9aa0a6]">
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleMute}
                      disabled={!muteReason.trim() || mute.isPending}
                      className="h-7 px-3 text-[12px] bg-[#4e8af4] hover:bg-[#4e8af4]/90 text-white disabled:opacity-50"
                    >
                      Mute finding
                    </Button>
                  </div>
                </div>
              )}

              {finding.muteReason && finding.status !== 'open' && (
                <div className="rounded-lg border border-white/8 bg-[#1a1d27] px-3 py-2 text-[12px] text-[#9aa0a6]">
                  <span className="text-[#e8eaed]">Reason:</span> {finding.muteReason}
                  {finding.mutedAt && <> · <RelativeClock ts={finding.mutedAt} /></>}
                </div>
              )}

              {finding.status === 'resolved' && (
                <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/[0.05] px-3 py-2 text-[12px] text-emerald-300">
                  Resolved <RelativeClock ts={finding.resolvedAt} /> —{' '}
                  {finding.resolutionBasis === 'verified_absent'
                    ? 'verified absent in a complete re-check.'
                    : finding.resolutionBasis}
                </div>
              )}

              {/* Evidence — measured facts, verbatim server values */}
              <section>
                <h3 className="text-[11px] uppercase tracking-widest text-[#9aa0a6] mb-2">
                  Evidence <span className="normal-case tracking-normal">(measured, verbatim)</span>
                </h3>
                <div className="rounded-lg border border-white/8 bg-[#1a1d27] divide-y divide-white/5">
                  {Object.entries(finding.evidence ?? {}).map(([key, value]) => (
                    <EvidenceRow key={key} k={key} v={value} />
                  ))}
                </div>
              </section>

              {/* Affected URLs (capped) */}
              {finding.affectedUrls.length > 0 && (
                <section>
                  <h3 className="text-[11px] uppercase tracking-widest text-[#9aa0a6] mb-2">
                    Affected URLs ({finding.affectedUrls.length})
                  </h3>
                  <ul className="space-y-1">
                    {finding.affectedUrls.slice(0, URL_CAP).map((u) => (
                      <li key={u.url} className="text-[12px]">
                        <a
                          href={u.url} target="_blank" rel="noopener noreferrer"
                          className="text-[#9aa0a6] hover:text-[#e8eaed] inline-flex items-center gap-1"
                        >
                          <span className="truncate max-w-[420px]">{u.url.replace(/^https?:\/\/[^/]+/, '') || '/'}</span>
                          <ExternalLink className="size-2.5 opacity-40 flex-shrink-0" />
                        </a>
                      </li>
                    ))}
                  </ul>
                  {finding.affectedUrls.length > URL_CAP && (
                    <p className="text-[11px] text-[#9aa0a6]/70 mt-1">
                      +{finding.affectedUrls.length - URL_CAP} more
                    </p>
                  )}
                </section>
              )}

              {/* Observation history */}
              {finding.observations.length > 0 && (
                <section>
                  <h3 className="text-[11px] uppercase tracking-widest text-[#9aa0a6] mb-2 inline-flex items-center gap-1.5">
                    <History className="size-3" />Observation history
                  </h3>
                  <ul className="space-y-1">
                    {finding.observations.map((o) => (
                      <li key={o.id} className="flex items-center gap-2 text-[12px]">
                        <span
                          className={`size-2 rounded-full flex-shrink-0 ${o.observedStatus === 'present' ? 'bg-red-400' : 'bg-emerald-400'}`}
                        />
                        <span className={o.observedStatus === 'present' ? 'text-[#e8eaed]' : 'text-emerald-300'}>
                          {o.observedStatus === 'present' ? 'Condition present' : 'Verified absent'}
                        </span>
                        <RelativeClock ts={o.observedAt} />
                        <span className="text-[#9aa0a6]/50">· detector v{o.detectorVersion}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

function EvidenceRow({ k, v }: { k: string; v: unknown }) {
  if (v == null || (Array.isArray(v) && v.length === 0)) return null
  const label = k.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
  return (
    <div className="flex items-start gap-3 px-3 py-1.5">
      <span className="text-[11px] text-[#9aa0a6] w-36 flex-shrink-0 pt-px">{label}</span>
      <span className="text-[12px] text-[#e8eaed] break-all whitespace-pre-wrap min-w-0">
        {typeof v === 'object' ? JSON.stringify(v, null, 1) : String(v)}
      </span>
    </div>
  )
}
