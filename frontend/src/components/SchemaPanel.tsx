import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'
import {
  Braces, RefreshCw, CheckCircle2, AlertTriangle, XCircle,
  Sparkles, Bookmark, ShieldCheck, RotateCw, UploadCloud, Plus,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import SchemaProposalCard from '@/components/SchemaProposalCard'
import ManagedSchemaCard from '@/components/ManagedSchemaCard'
import JsonLdEditor from '@/components/JsonLdEditor'
import {
  useSchemas, useDetectSchemas, useAnalyzeSchemas, useManagedSchemas,
  useApplySchemas, usePendingChanges, useQcSchemas, useReparseSchemas,
  useCreateManaged,
} from '@/hooks/useSchema'
import type { SchemaProposal, QcReport, QcStatus, ManagedSchema } from '@/api/schema'

/** Find the managed schema a proposal would replace: by targetManagedId, else
 * by matching @type (ignoring soft-removed rows). null when none → a clean add. */
function findExistingManaged(
  managed: ManagedSchema[] | undefined,
  p: SchemaProposal,
): ManagedSchema | null {
  if (!managed) return null
  return (
    managed.find((m) =>
      m.status !== 'removed' &&
      (p.targetManagedId
        ? m.id === p.targetManagedId
        : m.type.toLowerCase() === p.type.toLowerCase()),
    ) ?? null
  )
}

/** Starter JSON-LD for a hand-authored schema. */
const NEW_SCHEMA_TEMPLATE = {
  '@context': 'https://schema.org',
  '@type': '',
}

/** Read a display @type out of a JSON-LD value (handles @graph + array @type). */
function extractType(jsonld: unknown): string {
  if (jsonld && typeof jsonld === 'object') {
    const obj = jsonld as Record<string, unknown>
    const graph = Array.isArray(obj['@graph']) ? obj['@graph'] : null
    const node = (graph && graph.length ? graph[0] : obj) as Record<string, unknown>
    const t = node?.['@type']
    if (typeof t === 'string' && t.trim()) return t
    if (Array.isArray(t)) {
      const parts = t.filter((x): x is string => typeof x === 'string')
      if (parts.length) return parts.join(', ')
    }
  }
  return 'Schema'
}

const QC_STATUS: Record<QcStatus, { label: string; color: string }> = {
  in_sync: { label: 'In sync', color: 'text-emerald-400' },
  not_stored: { label: 'Pushed, not stored', color: 'text-red-400' },
  not_rendered: { label: 'Stored, not rendered (cache?)', color: 'text-amber-400' },
  unmanaged: { label: 'On page, not managed', color: 'text-orange-400' },
}

function Tick({ on }: { on: boolean }) {
  return on ? (
    <CheckCircle2 className="size-3.5 text-emerald-400" />
  ) : (
    <XCircle className="size-3.5 text-[#9aa0a6]/40" />
  )
}

export default function SchemaPanel({
  siteId,
  pageId,
}: {
  siteId: string
  pageId: string
}) {
  const { data, isLoading } = useSchemas(siteId, pageId)
  const detect = useDetectSchemas(siteId)
  const analyze = useAnalyzeSchemas(siteId)
  const { data: managed, isLoading: managedLoading } = useManagedSchemas(siteId, pageId)
  const { data: pendingData } = usePendingChanges(siteId, pageId)
  const apply = useApplySchemas(siteId, pageId)
  const reparse = useReparseSchemas(siteId, pageId)
  const qc = useQcSchemas(siteId, pageId)
  const create = useCreateManaged(siteId, pageId)
  const [proposals, setProposals] = useState<SchemaProposal[] | null>(null)
  const [qcReport, setQcReport] = useState<QcReport | null>(null)
  const [adding, setAdding] = useState(false)

  const saveNewSchema = (jsonld: unknown) =>
    create.mutate(
      { type: extractType(jsonld), jsonld, source: 'human' },
      {
        onSuccess: () => {
          toast.success('Schema added')
          setAdding(false)
        },
        onError: (e) =>
          toast.error((e as Error)?.message ?? 'Failed to add schema'),
      },
    )

  const runQc = () => qc.mutate(undefined, { onSuccess: setQcReport })

  const pending = pendingData?.pending ?? 0

  const runApply = () =>
    apply.mutate(undefined, {
      onSuccess: (r) =>
        toast.success(
          `Applied ${r.published} schema(s) to WordPress` +
            (r.reparsed ? ' · page re-parsed' : ' · re-parse skipped'),
        ),
      onError: (e) => toast.error((e as Error)?.message ?? 'Apply failed'),
    })

  const publishedDates = (managed ?? [])
    .map((m) => m.lastPublishedAt)
    .filter((d): d is string => !!d)
    .sort()
  const lastPublished = publishedDates[publishedDates.length - 1]

  const result = data?.result ?? null
  const checkedAt = data?.checkedAt ?? null
  const summary = result?.summary

  const runAnalyze = () =>
    analyze.mutate(pageId, { onSuccess: (r) => setProposals(r.proposals) })

  const resolveProposal = (id: string) =>
    setProposals((prev) => (prev ? prev.filter((p) => p.id !== id) : prev))

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-widest text-[#9aa0a6]">
        <Braces className="size-3" />
        Structured Data (JSON-LD)
        {checkedAt && (
          <span className="ml-auto normal-case tracking-normal text-[#9aa0a6]/50 font-normal">
            checked {formatDistanceToNow(new Date(checkedAt), { addSuffix: true })}
          </span>
        )}
      </div>

      {/* Summary + actions */}
      <div className="flex items-center gap-3">
        {summary && summary.total > 0 ? (
          <div className="flex items-center gap-3 text-[12px]">
            {summary.valid > 0 && (
              <span className="inline-flex items-center gap-1 text-emerald-400">
                <CheckCircle2 className="size-3.5" /> {summary.valid} valid
              </span>
            )}
            {summary.warnings > 0 && (
              <span className="inline-flex items-center gap-1 text-amber-400">
                <AlertTriangle className="size-3.5" /> {summary.warnings} warning
                {summary.warnings > 1 ? 's' : ''}
              </span>
            )}
            {summary.errors > 0 && (
              <span className="inline-flex items-center gap-1 text-red-400">
                <XCircle className="size-3.5" /> {summary.errors} error
                {summary.errors > 1 ? 's' : ''}
              </span>
            )}
          </div>
        ) : (
          <span className="text-[12px] text-[#9aa0a6]/60">
            {result ? 'No JSON-LD found on this page' : 'Not detected yet'}
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[12px] border-white/10 bg-transparent hover:bg-white/5"
            disabled={detect.isPending}
            onClick={() => detect.mutate(pageId)}
            title="Detect JSON-LD from stored HTML (auto-saves the live baseline)"
          >
            <RefreshCw className={`size-3 ${detect.isPending ? 'animate-spin' : ''}`} />
            {result ? 'Re-detect' : 'Detect'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[12px] border-white/10 bg-transparent hover:bg-white/5"
            disabled={reparse.isPending}
            onClick={() => reparse.mutate()}
            title="Re-fetch the live page and re-detect"
          >
            <RotateCw className={`size-3 ${reparse.isPending ? 'animate-spin' : ''}`} />
            Re-parse
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[12px] border-white/10 bg-transparent hover:bg-white/5"
            disabled={qc.isPending}
            onClick={runQc}
            title="Reconcile CMS ↔ plugin ↔ live page"
          >
            <ShieldCheck className={`size-3 ${qc.isPending ? 'animate-pulse' : ''}`} />
            QC
          </Button>
          <Button
            size="sm"
            className="h-7 text-[12px] bg-[#4e8af4] text-white hover:bg-[#4e8af4]/80"
            disabled={analyze.isPending}
            onClick={runAnalyze}
          >
            <Sparkles className={`size-3 ${analyze.isPending ? 'animate-pulse' : ''}`} />
            {analyze.isPending ? 'Analyzing…' : 'Analyze with AI'}
          </Button>
        </div>
      </div>

      {detect.isError && (
        <p className="text-[12px] text-red-400">
          {(detect.error as Error)?.message ?? 'Detection failed'}
        </p>
      )}
      {analyze.isError && (
        <p className="text-[12px] text-red-400">
          {(analyze.error as Error)?.message ?? 'Analysis failed'}
        </p>
      )}
      {(reparse.isError || qc.isError) && (
        <p className="text-[12px] text-red-400">
          {((reparse.error ?? qc.error) as Error)?.message ?? 'Request failed'}
        </p>
      )}

      {/* QC reconciliation report */}
      {qcReport && (
        <div className="space-y-2 rounded-lg border border-white/10 bg-[#0f1117] p-3">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="size-3.5 text-[#4e8af4]" />
            <span className="text-[12px] font-medium text-[#e8eaed]">
              QC - {qcReport.summary.inSync} in sync
              {qcReport.summary.issues > 0 && `, ${qcReport.summary.issues} issue${qcReport.summary.issues > 1 ? 's' : ''}`}
            </span>
            <button
              className="ml-auto text-[11px] text-[#9aa0a6] hover:text-[#e8eaed]"
              onClick={() => setQcReport(null)}
            >
              Dismiss
            </button>
          </div>

          {qcReport.pluginError && (
            <p className="text-[12px] text-amber-400">Plugin: {qcReport.pluginError}</p>
          )}
          {qcReport.liveError && (
            <p className="text-[12px] text-amber-400">Live page: {qcReport.liveError}</p>
          )}

          {qcReport.items.length === 0 ? (
            <p className="text-[12px] text-[#9aa0a6]/70">No managed schema to reconcile.</p>
          ) : (
            <div className="space-y-1">
              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 text-[10px] uppercase tracking-wide text-[#9aa0a6]/50 px-1">
                <span>Type</span><span>CMS</span><span>Plugin</span><span>Live</span>
              </div>
              {qcReport.items.map((it) => (
                <div
                  key={it.type}
                  className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-center px-1 py-1 border-t border-white/5"
                >
                  <div className="min-w-0">
                    <div className="text-[12px] text-[#e8eaed] truncate">{it.type}</div>
                    <div className={`text-[11px] ${QC_STATUS[it.status].color}`}>
                      {QC_STATUS[it.status].label}
                    </div>
                  </div>
                  <Tick on={it.inManaged} />
                  <Tick on={it.inStored} />
                  <Tick on={it.inLive} />
                </div>
              ))}
            </div>
          )}
          {qcReport.liveTotals && (
            <p className="text-[11px] text-[#9aa0a6]/60 pt-1">
              Live page total JSON-LD: {qcReport.liveTotals.total}
              {qcReport.liveTotals.errors > 0 && ` · ${qcReport.liveTotals.errors} error`}
            </p>
          )}
        </div>
      )}

      {/* AI proposals review */}
      {proposals && (
        <div className="space-y-2 rounded-lg border border-[#4e8af4]/20 bg-[#4e8af4]/[0.03] p-3">
          <div className="flex items-center gap-1.5">
            <Sparkles className="size-3.5 text-[#4e8af4]" />
            <span className="text-[12px] font-medium text-[#e8eaed]">
              AI proposals ({proposals.length})
            </span>
            {proposals.length > 0 && (
              <button
                className="ml-auto text-[11px] text-[#9aa0a6] hover:text-[#e8eaed]"
                onClick={() => setProposals(null)}
              >
                Dismiss all
              </button>
            )}
          </div>
          {proposals.length === 0 ? (
            <p className="text-[12px] text-[#9aa0a6]/70">
              Nothing to change - your existing schema already looks solid.
            </p>
          ) : (
            proposals.map((p) => (
              <SchemaProposalCard
                key={p.id}
                proposal={p}
                siteId={siteId}
                pageId={pageId}
                onResolved={resolveProposal}
                existing={findExistingManaged(managed, p)}
              />
            ))
          )}
        </div>
      )}

      {/* Managed set - single flat list (CMS = source of truth) */}
      <div className="space-y-2 pt-1">
        <div className="flex items-center gap-1.5 text-[11px] text-[#9aa0a6]/70 font-medium">
          <Bookmark className="size-3" />
          Schemas · {(managed ?? []).filter((m) => m.status !== 'removed').length}
          {lastPublished && (
            <span className="normal-case font-normal text-[#9aa0a6]/50">
              · applied {formatDistanceToNow(new Date(lastPublished), { addSuffix: true })}
            </span>
          )}
          <Button
            size="sm"
            variant="outline"
            className="ml-auto h-7 text-[12px] border-white/10 bg-transparent hover:bg-white/5 disabled:opacity-50"
            disabled={adding}
            onClick={() => setAdding(true)}
            title="Author a new schema by hand"
          >
            <Plus className="size-3" />
            Add
          </Button>
          <Button
            size="sm"
            className="h-7 text-[12px] bg-emerald-600 text-white hover:bg-emerald-600/80 disabled:opacity-50"
            disabled={apply.isPending || pending === 0}
            onClick={runApply}
            title={pending === 0 ? 'Nothing to apply' : 'Push the current schema set to WordPress'}
          >
            <UploadCloud className={`size-3 ${apply.isPending ? 'animate-pulse' : ''}`} />
            {apply.isPending ? 'Applying…' : pending > 0 ? `Apply (${pending})` : 'Applied'}
          </Button>
        </div>

        {/* Inline editor for a new hand-authored schema */}
        {adding && (
          <div className="rounded-lg border border-[#4e8af4]/20 bg-[#4e8af4]/[0.03] p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#e8eaed]">
              <Plus className="size-3 text-[#4e8af4]" />
              New schema
            </div>
            <JsonLdEditor
              siteId={siteId}
              pageId={pageId}
              initial={NEW_SCHEMA_TEMPLATE}
              saving={create.isPending}
              saveLabel="Add schema"
              onCancel={() => setAdding(false)}
              onSave={saveNewSchema}
            />
          </div>
        )}

        {managedLoading || isLoading ? (
          <div className="space-y-2">
            {[80, 70, 75].map((w, i) => (
              <Skeleton key={i} className="h-9 bg-white/5 rounded-lg" style={{ width: `${w}%` }} />
            ))}
          </div>
        ) : !managed || managed.length === 0 ? (
          <p className="text-[12px] text-[#9aa0a6]/60">
            No schemas yet - run Detect to pull in the page's live JSON-LD, or let AI suggest some.
          </p>
        ) : (
          <div className="space-y-2">
            {managed.map((m) => (
              <ManagedSchemaCard key={m.id} schema={m} siteId={siteId} pageId={pageId} />
            ))}
          </div>
        )}
      </div>

      {/* Parse errors from the latest detection */}
      {result && result.parseErrors.length > 0 && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2.5 space-y-1">
          {result.parseErrors.map((pe, i) => (
            <p key={i} className="text-[12px] text-red-400">
              <XCircle className="size-3.5 inline mr-1 -mt-0.5" />
              Block #{pe.scriptIndex + 1}: {pe.message}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
