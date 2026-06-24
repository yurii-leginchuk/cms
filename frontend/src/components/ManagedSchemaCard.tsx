import { useState } from 'react'
import {
  ChevronRight, ChevronDown, CheckCircle2, AlertTriangle, XCircle,
  Pencil, Trash2,
} from 'lucide-react'
import JsonLdEditor from '@/components/JsonLdEditor'
import { useUpdateManaged, useDeleteManaged } from '@/hooks/useSchema'
import type { ManagedSchema, PageSchemaStatus } from '@/api/schema'

const STATE_CHIP: Record<PageSchemaStatus, { label: string; cls: string }> = {
  synced: { label: 'Synced', cls: 'text-[#9aa0a6] bg-white/5' },
  modified: { label: 'Modified', cls: 'text-amber-400 bg-amber-500/10' },
  removed: { label: 'Removed', cls: 'text-red-400 bg-red-500/10' },
}

function ValidityBadge({ status }: { status: ManagedSchema['validationStatus'] }) {
  if (status === 'valid')
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400">
        <CheckCircle2 className="size-3" /> Valid
      </span>
    )
  if (status === 'warnings')
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-amber-400">
        <AlertTriangle className="size-3" /> Warnings
      </span>
    )
  if (status === 'errors')
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-red-400">
        <XCircle className="size-3" /> Errors
      </span>
    )
  return <span className="text-[11px] text-[#9aa0a6]/60">Unvalidated</span>
}

export default function ManagedSchemaCard({
  schema,
  siteId,
  pageId,
}: {
  schema: ManagedSchema
  siteId: string
  pageId: string
}) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const update = useUpdateManaged(siteId, pageId)
  const del = useDeleteManaged(siteId, pageId)
  const removed = schema.status === 'removed'
  const chip = STATE_CHIP[schema.status]

  return (
    <div
      className={`rounded-lg border bg-[#0f1117] overflow-hidden ${
        removed ? 'border-red-500/20 opacity-60' : 'border-[#4e8af4]/20'
      }`}
    >
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 flex-1 text-left min-w-0"
        >
          {open ? (
            <ChevronDown className="size-3.5 text-[#9aa0a6] flex-shrink-0" />
          ) : (
            <ChevronRight className="size-3.5 text-[#9aa0a6] flex-shrink-0" />
          )}
          <span
            className={`text-[13px] font-medium truncate ${
              removed ? 'text-[#9aa0a6] line-through' : 'text-[#e8eaed]'
            }`}
          >
            {schema.type}
          </span>
          <span
            className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded flex-shrink-0 ${chip.cls}`}
          >
            {chip.label}
          </span>
        </button>
        <ValidityBadge status={schema.validationStatus} />
        <button
          className="text-[#9aa0a6] hover:text-[#e8eaed] p-1 disabled:opacity-40"
          title="Edit"
          disabled={removed}
          onClick={() => { setEditing(true); setOpen(true) }}
        >
          <Pencil className="size-3.5" />
        </button>
        <button
          className="text-[#9aa0a6] hover:text-red-400 p-1 disabled:opacity-40"
          title="Delete"
          disabled={del.isPending || removed}
          onClick={() => del.mutate(schema.id)}
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      {open && (
        <div className="border-t border-white/8 px-3 py-3 space-y-2">
          {schema.unverifiedClaims.length > 0 && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-2 space-y-0.5">
              {schema.unverifiedClaims.map((c, i) => (
                <p key={i} className="text-[12px] text-amber-300/80">{c}</p>
              ))}
            </div>
          )}

          {editing ? (
            <JsonLdEditor
              siteId={siteId}
              pageId={pageId}
              initial={schema.jsonld}
              saving={update.isPending}
              onCancel={() => setEditing(false)}
              onSave={(jsonld) =>
                update.mutate(
                  { schemaId: schema.id, payload: { jsonld } },
                  { onSuccess: () => setEditing(false) },
                )
              }
            />
          ) : (
            <pre className="text-[11.5px] text-[#c4c7cc] whitespace-pre-wrap break-words font-mono bg-[#0b0d12] border border-white/8 rounded-md p-3 max-h-64 overflow-y-auto">
              {JSON.stringify(schema.jsonld, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
