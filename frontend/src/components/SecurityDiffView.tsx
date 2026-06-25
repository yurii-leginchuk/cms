import { useState } from 'react'
import { Bot, User, AlertTriangle } from 'lucide-react'
import type { IncidentDetail } from '@/api/security'

function Column({
  title, icon: Icon, subtitle, content, scriptOrigins, linkDomains, status, raw,
}: {
  title: string
  icon: React.ElementType
  subtitle: string
  content: string | null
  scriptOrigins: string[]
  linkDomains: string[]
  status: string
  raw: boolean
}) {
  return (
    <div className="flex-1 min-w-0 rounded-xl border border-white/8 bg-[#1a1d27] overflow-hidden">
      <div className="px-4 py-2.5 border-b border-white/8 flex items-center gap-2">
        <Icon className="size-4 text-[#4e8af4]" />
        <span className="text-[13px] font-medium text-[#e8eaed]">{title}</span>
        <span className="text-[11px] text-[#9aa0a6] ml-auto">{subtitle}</span>
      </div>
      <div className="px-4 py-3 space-y-3">
        {status !== 'reachable' ? (
          <p className="text-[12px] text-amber-400/90">Not reachable on this axis ({status})</p>
        ) : raw ? (
          <pre className="text-[11px] text-[#c8ccd2] whitespace-pre-wrap break-words max-h-80 overflow-y-auto font-mono">
            {content || '(empty)'}
          </pre>
        ) : (
          <>
            <div>
              <p className="text-[11px] text-[#9aa0a6] mb-1">External scripts ({scriptOrigins.length})</p>
              {scriptOrigins.length === 0
                ? <p className="text-[12px] text-[#e8eaed]/70">none</p>
                : scriptOrigins.map((o) => <p key={o} className="text-[12px] text-[#e8eaed] font-mono">{o}</p>)}
            </div>
            <div>
              <p className="text-[11px] text-[#9aa0a6] mb-1">External link domains ({linkDomains.length})</p>
              {linkDomains.length === 0
                ? <p className="text-[12px] text-[#e8eaed]/70">none</p>
                : linkDomains.map((d) => <p key={d} className="text-[12px] text-[#e8eaed] font-mono">{d}</p>)}
            </div>
            <div>
              <p className="text-[11px] text-[#9aa0a6] mb-1">Main content (excerpt)</p>
              <p className="text-[12px] text-[#c8ccd2] line-clamp-6 whitespace-pre-wrap">{content || '(empty)'}</p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export function SecurityDiffView({ detail }: { detail: IncidentDetail }) {
  const [raw, setRaw] = useState(false)
  const { finding, snapshotA, snapshotB } = detail

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-medium text-[#e8eaed]">Googlebot view vs visitor view</h3>
        <div className="flex items-center rounded-lg border border-white/10 overflow-hidden text-[12px]">
          <button
            onClick={() => setRaw(false)}
            className={`px-3 py-1 ${!raw ? 'bg-[#4e8af4]/15 text-[#4e8af4]' : 'text-[#9aa0a6]'}`}
          >
            Summary
          </button>
          <button
            onClick={() => setRaw(true)}
            className={`px-3 py-1 ${raw ? 'bg-[#4e8af4]/15 text-[#4e8af4]' : 'text-[#9aa0a6]'}`}
          >
            Raw
          </button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-3">
        <Column
          title="What Googlebot saw"
          icon={Bot}
          subtitle="Googlebot UA · Referer google.com"
          content={snapshotA?.content ?? null}
          scriptOrigins={snapshotA?.scriptOrigins ?? []}
          linkDomains={snapshotA?.linkDomains ?? []}
          status={finding?.axisAStatus ?? 'unreachable'}
          raw={raw}
        />
        <Column
          title="What a visitor sees"
          icon={User}
          subtitle="Chrome UA"
          content={snapshotB?.content ?? null}
          scriptOrigins={snapshotB?.scriptOrigins ?? []}
          linkDomains={snapshotB?.linkDomains ?? []}
          status={finding?.axisBStatus ?? 'unreachable'}
          raw={raw}
        />
      </div>

      {/* Redirect chains, when present */}
      {finding && (finding.redirectChainA.length > 0 || finding.redirectChainB.length > 0) && (
        <div className="rounded-xl border border-white/8 bg-[#1a1d27] px-4 py-3">
          <p className="text-[11px] text-[#9aa0a6] mb-2">Redirect chains</p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 text-[11px] font-mono text-[#c8ccd2]">
            <div>
              <span className="text-[#9aa0a6]">Googlebot:</span>{' '}
              {finding.redirectChainA.length === 0 ? 'no redirect'
                : finding.redirectChainA.map((h, i) => <div key={i}>{h.status} → {h.url}</div>)}
            </div>
            <div>
              <span className="text-[#9aa0a6]">Visitor:</span>{' '}
              {finding.redirectChainB.length === 0 ? 'no redirect'
                : finding.redirectChainB.map((h, i) => <div key={i}>{h.status} → {h.url}</div>)}
            </div>
          </div>
        </div>
      )}

      {/* Signals that fired (explains the score) */}
      {finding && finding.signals.length > 0 && (
        <div className="rounded-xl border border-white/8 bg-[#1a1d27] px-4 py-3 space-y-2">
          <p className="text-[11px] text-[#9aa0a6]">
            Signals fired (score {finding.score})
          </p>
          {finding.signals.map((s, i) => (
            <div key={i} className="flex items-start gap-2 text-[12px]">
              {s.malicious && <AlertTriangle className="size-3.5 text-red-400 flex-shrink-0 mt-0.5" />}
              <span className={s.malicious ? 'text-[#e8eaed]' : 'text-[#9aa0a6]'}>
                {s.message} <span className="text-[#9aa0a6]/60">[+{s.weight}]</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
