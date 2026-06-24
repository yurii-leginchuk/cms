import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Braces, CheckCircle2, Trash2, UploadCloud, CloudOff, Loader2, AlertTriangle,
} from 'lucide-react'
import SiteChat, { RenderToolOutput } from '@/components/SiteChat'
import SchemaProposalCard from '@/components/SchemaProposalCard'
import {
  useDeleteManaged,
  useApplySchemas,
  useUnpublishSchemas,
  useManagedSchemas,
} from '@/hooks/useSchema'
import type { SchemaProposal, ManagedSchema } from '@/api/schema'

/**
 * Thin wrapper over SiteChat for the schema detail page. Injects the active
 * pageContext (so the server-side schema tools default to this page) and renders
 * schema-specific tool-output cards on top of SiteChat's generic rendering.
 * No chat logic is duplicated - SiteChat owns the stream, sessions, and layout.
 */
export default function SchemaAssistantPanel({
  siteId,
  pageId,
  pageUrl,
}: {
  siteId: string
  pageId: string
  pageUrl?: string
}) {
  const renderToolOutput: RenderToolOutput = (out, ctx) => {
    if (!out || typeof out !== 'object') return null

    // Grounded AI proposals (add/fix/drift) - reuse the existing review card.
    if (out.type === 'schema_proposal' && out.action === 'schema_proposals') {
      const proposals: SchemaProposal[] = out.proposals ?? []
      if (proposals.length === 0)
        return (
          <div className="my-2 rounded-lg border border-white/10 bg-[#0f1117] px-3 py-2.5 text-[12px] text-[#9aa0a6]">
            Nothing to propose - this page's structured data already checks out.
          </div>
        )
      return (
        <div className="my-2 space-y-2">
          {proposals.map((p) => (
            <SchemaProposalReview
              key={p.id}
              proposal={p}
              siteId={siteId}
              pageId={out.pageId ?? pageId}
            />
          ))}
        </div>
      )
    }

    // Result of an executed additive mutation.
    if (out.type === 'schema_result') {
      return <SchemaResultCard out={out} siteId={siteId} pageId={pageId} />
    }

    // Destructive actions - confirmation card (Apply/Confirm), like briefs.
    if (out.type === 'schema_confirm') {
      return <SchemaConfirmCard key={ctx.key} out={out} fallbackPageId={pageId} />
    }

    return null
  }

  return (
    <SiteChat
      siteId={siteId}
      hideSessionSidebar
      pageContext={{ pageId, pageUrl }}
      renderToolOutput={renderToolOutput}
      emptyTitleOverride="Schema assistant"
      emptyBlurbOverride="Ask me to detect, generate, fix, validate, or apply this page's structured data. Every change goes through a review step first, so nothing publishes without your say-so."
    />
  )
}

/** Wraps SchemaProposalCard with a local resolved state for the chat context.
 * Loads the managed set so an approve of a duplicate-@type proposal offers
 * replace-vs-add, identical to the SchemaPanel review flow. */
function SchemaProposalReview({
  proposal,
  siteId,
  pageId,
}: {
  proposal: SchemaProposal
  siteId: string
  pageId: string
}) {
  const [resolved, setResolved] = useState(false)
  const { data: managed } = useManagedSchemas(siteId, pageId)
  const existing: ManagedSchema | null =
    managed?.find((m) =>
      m.status !== 'removed' &&
      (proposal.targetManagedId
        ? m.id === proposal.targetManagedId
        : m.type.toLowerCase() === proposal.type.toLowerCase()),
    ) ?? null

  if (resolved)
    return (
      <div className="flex items-center gap-1.5 text-[12px] text-emerald-400 py-1">
        <CheckCircle2 className="size-3.5" /> {proposal.type} saved to the CMS
      </div>
    )
  return (
    <SchemaProposalCard
      proposal={proposal}
      siteId={siteId}
      pageId={pageId}
      onResolved={() => setResolved(true)}
      existing={existing}
    />
  )
}

function SchemaResultCard({
  out,
  siteId,
  pageId,
}: {
  out: any
  siteId: string
  pageId: string
}) {
  const qc = useQueryClient()
  const failed =
    out.action === 'schema_add_failed' || out.action === 'schema_edit_failed'
  // Nothing was written server-side - the add was refused as a duplicate.
  const blocked = out.action === 'schema_add_blocked_duplicate'

  // The mutation already ran server-side (the tool executed directly), so the
  // left SchemaPanel's React Query cache is stale. Invalidate it once when the
  // successful result first renders, so the new/edited schema shows immediately.
  useEffect(() => {
    if (failed || blocked) return
    qc.invalidateQueries({ queryKey: ['managed-schemas', siteId, pageId] })
    qc.invalidateQueries({ queryKey: ['schema-pending', siteId, pageId] })
    qc.invalidateQueries({ queryKey: ['schemas', siteId, pageId] })
    qc.invalidateQueries({ queryKey: ['schema-pages', siteId] })
    qc.invalidateQueries({ queryKey: ['schema-coverage', siteId] })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (failed)
    return (
      <div className="my-2 flex items-start gap-1.5 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2.5 text-[12px] text-red-400">
        <AlertTriangle className="size-3.5 mt-0.5 flex-shrink-0" />
        <span>{out.error ?? 'Schema action failed'}</span>
      </div>
    )
  if (blocked)
    return (
      <div className="my-2 flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-[12px] text-amber-400">
        <AlertTriangle className="size-3.5 mt-0.5 flex-shrink-0" />
        <span>
          This page already has a <strong>{out.schemaType}</strong> schema, so nothing was added.
          Ask me to edit the existing one instead.
        </span>
      </div>
    )
  return (
    <div className="my-2 flex items-center gap-2 rounded-lg border border-[#4e8af4]/20 bg-[#0f1117] px-3 py-2.5 text-[12px] text-[#e8eaed]">
      <Braces className="size-3.5 text-[#4e8af4] flex-shrink-0" />
      <span>
        {out.action === 'schema_edited' ? 'Edited' : 'Added'}{' '}
        <strong>{out.schemaType}</strong> - pending Apply
      </span>
    </div>
  )
}

/**
 * Confirmation card for destructive schema actions. Nothing happened server-side
 * yet - the user must click Confirm/Apply, which fires the existing useSchema
 * mutation (delete / apply / unpublish) with full cache invalidation.
 */
function SchemaConfirmCard({
  out,
  fallbackPageId,
}: {
  out: any
  fallbackPageId: string
}) {
  const siteId: string = out.siteId
  const pageId: string = out.pageId ?? fallbackPageId
  const [done, setDone] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  const del = useDeleteManaged(siteId, pageId)
  const apply = useApplySchemas(siteId, pageId)
  const unpublish = useUnpublishSchemas(siteId, pageId)

  const pending =
    del.isPending || apply.isPending || unpublish.isPending

  const config = (() => {
    switch (out.action) {
      case 'remove_schema':
        return {
          icon: Trash2,
          tone: 'text-red-400 border-red-500/30',
          title: 'Delete schema',
          body: (
            <>
              Remove <strong>{out.schemaType ?? 'this schema'}</strong> from the
              managed set? It stays recoverable until you Apply.
            </>
          ),
          confirmLabel: 'Delete',
          run: () => del.mutateAsync(out.schemaId).then(() => `Schema removed from the set`),
        }
      case 'apply_schemas':
        return {
          icon: UploadCloud,
          tone: 'text-emerald-400 border-emerald-500/30',
          title: 'Apply to WordPress',
          body: (
            <>
              Publish {out.pending ?? 0} pending change
              {out.pending === 1 ? '' : 's'} to the live site?
            </>
          ),
          confirmLabel: 'Apply',
          run: () => apply.mutateAsync().then(() => `Applied to WordPress`),
        }
      case 'unpublish_schemas':
        return {
          icon: CloudOff,
          tone: 'text-amber-400 border-amber-500/30',
          title: 'Unpublish schemas',
          body: <>Remove ALL CMS schemas for this page from WordPress?</>,
          confirmLabel: 'Unpublish',
          run: () => unpublish.mutateAsync().then(() => `Unpublished`),
        }
      default:
        return null
    }
  })()

  if (!config) return null
  const Icon = config.icon

  if (dismissed) return null
  if (done)
    return (
      <div className="my-2 flex items-center gap-1.5 text-[12px] text-emerald-400 py-1">
        <CheckCircle2 className="size-3.5" /> Done
      </div>
    )

  const handleConfirm = async () => {
    try {
      const msg = await config.run()
      toast.success(msg)
      setDone(true)
    } catch (e) {
      toast.error((e as Error)?.message ?? "That didn't go through. Try again.")
    }
  }

  return (
    <div
      className={`my-2 rounded-xl border bg-[#0f1117] px-3 py-3 text-[13px] max-w-sm ${config.tone}`}
    >
      <div className="flex items-center gap-1.5 mb-1.5 font-semibold text-[#e8eaed]">
        <Icon className="size-4" /> {config.title}
      </div>
      <p className="text-[#9aa0a6] text-[12px] mb-3">{config.body}</p>
      <div className="flex gap-2">
        <button
          onClick={() => setDismissed(true)}
          className="px-3 py-1.5 rounded-lg text-[#9aa0a6] hover:bg-white/5 text-[12px] transition-colors"
        >
          Dismiss
        </button>
        <button
          disabled={pending}
          onClick={handleConfirm}
          className="px-3 py-1.5 rounded-lg bg-[#4e8af4] text-white text-[12px] disabled:opacity-50 transition-colors flex items-center gap-1.5"
        >
          {pending && <Loader2 className="size-3 animate-spin" />}
          {config.confirmLabel}
        </button>
      </div>
    </div>
  )
}
