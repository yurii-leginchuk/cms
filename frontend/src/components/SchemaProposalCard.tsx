import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  Sparkles, Wrench, AlertOctagon, ShieldAlert, AlertTriangle,
  CheckCircle2, XCircle, Lightbulb, Replace, Plus, GitCompare,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import JsonLdEditor from '@/components/JsonLdEditor'
import { useCreateManaged, useUpdateManaged } from '@/hooks/useSchema'
import type { SchemaProposal, SchemaProposalKind, ManagedSchema } from '@/api/schema'

const KIND_META: Record<
  SchemaProposalKind,
  { label: string; icon: React.ElementType; color: string }
> = {
  add: { label: 'Add', icon: Sparkles, color: 'text-[#4e8af4]' },
  fix: { label: 'Fix', icon: Wrench, color: 'text-amber-400' },
  drift: { label: 'Drift', icon: AlertOctagon, color: 'text-orange-400' },
}

function ValidityBadge({ validity }: { validity: SchemaProposal['validation']['validity'] }) {
  if (validity === 'valid')
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400">
        <CheckCircle2 className="size-3" /> Valid
      </span>
    )
  if (validity === 'warnings')
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-amber-400">
        <AlertTriangle className="size-3" /> Warnings
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-red-400">
      <XCircle className="size-3" /> Errors
    </span>
  )
}

type DiffLine = { type: 'add' | 'del' | 'eq'; text: string }

// Line-level LCS diff (git-style): pairs unchanged lines and marks the rest as
// added/removed. Schema JSON is small, so the O(n·m) table is fine.
function lineDiff(a: string[], b: string[]): DiffLine[] {
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) out.push({ type: 'eq', text: a[i++] }), j++
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ type: 'del', text: a[i++] })
    else out.push({ type: 'add', text: b[j++] })
  }
  while (i < n) out.push({ type: 'del', text: a[i++] })
  while (j < m) out.push({ type: 'add', text: b[j++] })
  return out
}

// Recursively sort object keys so the diff reflects real content changes, not
// key reordering (key order is semantically irrelevant in JSON-LD).
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v && typeof v === 'object') {
    return Object.keys(v as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = sortKeys((v as Record<string, unknown>)[k])
        return acc
      }, {})
  }
  return v
}

/** Git-style red/green diff of the current schema vs. the proposed one. */
function JsonDiff({ before, after }: { before: unknown; after: unknown }) {
  const lines = useMemo(
    () =>
      lineDiff(
        JSON.stringify(sortKeys(before), null, 2).split('\n'),
        JSON.stringify(sortKeys(after), null, 2).split('\n'),
      ),
    [before, after],
  )
  const added = lines.filter((l) => l.type === 'add').length
  const removed = lines.filter((l) => l.type === 'del').length

  return (
    <div className="rounded-md border border-white/8 bg-[#0b0d12] overflow-hidden">
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-white/8 text-[11px]">
        <GitCompare className="size-3 text-[#9aa0a6]" />
        <span className="text-[#9aa0a6]">Proposed schema</span>
        <span className="ml-auto flex items-center gap-2 font-mono">
          <span className="text-emerald-400">+{added}</span>
          <span className="text-red-400">−{removed}</span>
        </span>
      </div>
      <pre className="text-[11.5px] font-mono whitespace-pre-wrap break-words max-h-72 overflow-y-auto">
        {lines.map((l, i) => (
          <div
            key={i}
            className={
              l.type === 'add'
                ? 'bg-emerald-500/10 text-emerald-300'
                : l.type === 'del'
                  ? 'bg-red-500/10 text-red-300'
                  : 'text-[#9aa0a6]'
            }
          >
            <span className="select-none inline-block w-3.5 text-center opacity-50">
              {l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' '}
            </span>
            {l.text}
          </div>
        ))}
      </pre>
    </div>
  )
}

export default function SchemaProposalCard({
  proposal,
  siteId,
  pageId,
  onResolved,
  existing = null,
}: {
  proposal: SchemaProposal
  siteId: string
  pageId: string
  onResolved: (id: string) => void
  /** An existing managed schema this proposal would replace (same @type /
   * targetManagedId). When set, approving asks replace-vs-add-separate. */
  existing?: ManagedSchema | null
}) {
  const [editing, setEditing] = useState(false)
  // The JSON-LD awaiting a replace-vs-add decision (only when `existing`).
  const [choosing, setChoosing] = useState<unknown | null>(null)
  const create = useCreateManaged(siteId, pageId)
  const update = useUpdateManaged(siteId, pageId)
  const meta = KIND_META[proposal.kind]
  const Icon = meta.icon
  const saving = create.isPending || update.isPending

  const handleErr = (e: unknown) =>
    toast.error((e as Error)?.message ?? `Failed to save ${proposal.type}`)
  const done = () => onResolved(proposal.id)

  const addSeparate = (jsonld: unknown) =>
    create.mutate(
      {
        type: proposal.type,
        jsonld,
        source: proposal.kind === 'add' ? 'ai_generated' : 'ai_fixed',
        aiRationale: proposal.rationale,
        evidence: proposal.evidence,
        unverifiedClaims: proposal.unverifiedClaims,
      },
      {
        onSuccess: () => {
          toast.success(`Added ${proposal.type} schema`)
          done()
        },
        onError: handleErr,
      },
    )

  const replaceExisting = (jsonld: unknown) => {
    if (!existing) return addSeparate(jsonld)
    update.mutate(
      { schemaId: existing.id, payload: { type: proposal.type, jsonld } },
      {
        onSuccess: () => {
          toast.success(`Updated ${proposal.type} schema`)
          done()
        },
        onError: handleErr,
      },
    )
  }

  // Approve: when a same-type schema already exists, ask replace vs add;
  // otherwise add it directly.
  const approve = (jsonld: unknown) => {
    if (existing) {
      setEditing(false)
      setChoosing(jsonld)
    } else {
      addSeparate(jsonld)
    }
  }

  return (
    <div className="rounded-lg border border-white/10 bg-[#0f1117] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/8">
        <Icon className={`size-3.5 flex-shrink-0 ${meta.color}`} />
        <span className={`text-[11px] font-medium uppercase tracking-wide ${meta.color}`}>
          {meta.label}
        </span>
        <span className="text-[13px] font-medium text-[#e8eaed] truncate">
          {proposal.type}
        </span>
        <span className="ml-auto flex-shrink-0">
          <ValidityBadge validity={proposal.validation.validity} />
        </span>
      </div>

      <div className="px-3 py-3 space-y-3">
        {/* Hard faithfulness fail */}
        {proposal.forbidden && (
          <div className="flex items-start gap-1.5 rounded-md border border-red-500/30 bg-red-500/5 px-2.5 py-2 text-[12px] text-red-400">
            <ShieldAlert className="size-3.5 mt-0.5 flex-shrink-0" />
            <span>
              Blocked - this uses a term from your Brand Card's <strong>Never Mention</strong> list.
              Edit it out before approving.
            </span>
          </div>
        )}

        {/* Computed change summary (fix/drift) - the trustworthy, server-side
            diff vs the current schema, independent of the AI's prose. */}
        {proposal.kind !== 'add' && (
          proposal.changeSummary.length > 0 ? (
            <div className="rounded-md border border-[#4e8af4]/20 bg-[#4e8af4]/[0.04] px-2.5 py-2 space-y-1">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#4e8af4]">
                <GitCompare className="size-3" /> Changes vs current
              </div>
              <ul className="space-y-0.5">
                {proposal.changeSummary.map((c, i) => (
                  <li key={i} className="text-[12px] text-[#c4c7cc] font-mono">
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-2 text-[12px] text-amber-400">
              <AlertTriangle className="size-3.5 mt-0.5 flex-shrink-0" />
              <span>This doesn't actually change the current schema - you can probably skip it.</span>
            </div>
          )
        )}

        {/* AI reasoning (why - secondary to the computed diff above, which is
            the authoritative "what changed"). For add proposals there is no
            changeSummary, so this carries the main explanation. */}
        {proposal.rationale && (
          <div className="flex items-start gap-1.5 text-[12px] text-[#9aa0a6]">
            <Lightbulb className="size-3.5 mt-0.5 flex-shrink-0 text-amber-400/70" />
            <span>
              <span className="text-[#9aa0a6]/70">AI reasoning: </span>
              {proposal.rationale}
            </span>
          </div>
        )}

        {/* Evidence */}
        {proposal.evidence.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[11px] text-[#9aa0a6]/70">
              Evidence
              <span className="ml-1 text-[#9aa0a6]/40">({proposal.evidence.length})</span>
            </div>
            <ul className="space-y-1.5">
              {proposal.evidence.map((e, i) => {
                // FAQ-style evidence reads "Question? Answer." - split it so the
                // question stands out and the answer reads as the body. Plain
                // facts (no leading question) fall back to a single quote line.
                const m = e.match(/^\s*(.+?\?)\s+([\s\S]+?)\s*$/)
                return (
                  <li
                    key={i}
                    className="rounded-md border border-white/8 bg-white/[0.02] px-2.5 py-1.5"
                  >
                    {m ? (
                      <>
                        <p className="text-[12px] font-medium text-[#e8eaed] leading-snug">
                          {m[1]}
                        </p>
                        <p className="mt-0.5 text-[12px] text-[#9aa0a6] leading-snug">
                          {m[2]}
                        </p>
                      </>
                    ) : (
                      <p className="text-[12px] text-[#c4c7cc] leading-snug">{e}</p>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {/* Unverified claims (non-forbidden) */}
        {!proposal.forbidden && proposal.unverifiedClaims.length > 0 && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-2 space-y-0.5">
            <div className="flex items-center gap-1.5 text-[11px] text-amber-400">
              <AlertTriangle className="size-3" /> Unverified - confirm before approving
            </div>
            {proposal.unverifiedClaims.map((c, i) => (
              <p key={i} className="text-[12px] text-amber-300/80">{c}</p>
            ))}
          </div>
        )}

        {/* Replace-vs-add choice (only when a same-type schema already exists) */}
        {choosing !== null ? (
          <div className="rounded-md border border-[#4e8af4]/30 bg-[#4e8af4]/5 px-3 py-3 space-y-2.5">
            <div className="flex items-start gap-1.5 text-[12px] text-[#e8eaed]">
              <AlertTriangle className="size-3.5 mt-0.5 flex-shrink-0 text-amber-400" />
              <span>
                There's already a <strong>{proposal.type}</strong> schema on this page.
                Replace it with this version, or keep both?
              </span>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-[12px] text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-white/5"
                disabled={saving}
                onClick={() => setChoosing(null)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[12px] border-white/10 bg-transparent hover:bg-white/5"
                disabled={saving}
                onClick={() => addSeparate(choosing)}
              >
                <Plus className="size-3" /> Add separate
              </Button>
              <Button
                size="sm"
                className="h-7 text-[12px] bg-[#4e8af4] text-white hover:bg-[#4e8af4]/80 disabled:opacity-50"
                disabled={saving}
                onClick={() => replaceExisting(choosing)}
              >
                <Replace className="size-3" />
                {saving ? 'Saving…' : 'Replace current'}
              </Button>
            </div>
          </div>
        ) : editing ? (
          <JsonLdEditor
            siteId={siteId}
            pageId={pageId}
            initial={proposal.jsonld}
            saving={saving}
            saveLabel={existing ? 'Approve edited…' : 'Approve edited'}
            onCancel={() => setEditing(false)}
            onSave={approve}
          />
        ) : (
          <>
            {(proposal.kind === 'fix' || proposal.kind === 'drift') && proposal.before != null ? (
              <JsonDiff before={proposal.before} after={proposal.jsonld} />
            ) : (
              <pre className="text-[11.5px] text-[#c4c7cc] whitespace-pre-wrap break-words font-mono bg-[#0b0d12] border border-white/8 rounded-md p-3 max-h-64 overflow-y-auto">
                {JSON.stringify(proposal.jsonld, null, 2)}
              </pre>
            )}

            {existing && (
              <p className="text-[11px] text-[#9aa0a6]/70">
                A <span className="text-[#c4c7cc]">{proposal.type}</span> already
                exists - approving will ask to replace it or add a separate one.
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-[12px] text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-white/5"
                onClick={() => onResolved(proposal.id)}
              >
                Reject
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[12px] border-white/10 bg-transparent hover:bg-white/5"
                onClick={() => setEditing(true)}
              >
                Edit
              </Button>
              <Button
                size="sm"
                className="h-7 text-[12px] bg-[#4e8af4] text-white hover:bg-[#4e8af4]/80 disabled:opacity-50"
                disabled={proposal.forbidden || saving}
                title={proposal.forbidden ? 'Edit out the neverSay term first' : undefined}
                onClick={() => approve(proposal.jsonld)}
              >
                {saving ? 'Approving…' : 'Approve'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
