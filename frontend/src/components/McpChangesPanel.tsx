import { useState } from 'react'
import { toast } from 'sonner'
import {
  Sparkles, ChevronDown, ChevronRight, UploadCloud, X, CheckCircle2,
  AlertTriangle, Loader2, FileText, Braces, ImageIcon, CheckSquare, Signpost,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import {
  useMcpChangeCounts, usePendingChanges, useAcceptChange, useRejectChange,
  useAcceptAllChanges, useRejectAllChanges,
} from '@/hooks/useMcpChanges'
import type { McpChangeModule, McpChangeRequest } from '@/api/mcpChanges'

const MODULES: { key: McpChangeModule; label: string; icon: typeof FileText }[] = [
  { key: 'meta', label: 'Meta', icon: FileText },
  { key: 'schema', label: 'Schema', icon: Braces },
  { key: 'alt', label: 'Alt text', icon: ImageIcon },
  { key: 'asana', label: 'Asana', icon: CheckSquare },
  { key: 'redirect', label: 'Redirects', icon: Signpost },
]

const ACTION_LABEL: Record<string, string> = {
  'meta.update': 'Edit',
  'schema.add': 'Add',
  'schema.update': 'Edit',
  'schema.delete': 'Delete',
  'alt.set': 'Set',
  'asana.create': 'Create',
  'asana.update': 'Edit',
  'asana.status': 'Status',
  'asana.assignee': 'Assign',
  'asana.subtask': 'Subtask',
  'asana.link': 'Link',
  'redirect.create': 'Create',
  'redirect.update': 'Edit',
  'redirect.delete': 'Delete',
  'redirect.enable': 'Enable',
  'redirect.disable': 'Disable',
}

export function McpChangesPanel({
  siteId,
  focusModule,
}: {
  siteId: string
  focusModule?: McpChangeModule | null
}) {
  const { data: counts } = useMcpChangeCounts(siteId)
  const { data: items, isLoading, isError, refetch } = usePendingChanges(siteId)
  const accept = useAcceptChange(siteId)
  const reject = useRejectChange(siteId)
  const acceptAll = useAcceptAllChanges(siteId)
  const rejectAll = useRejectAllChanges(siteId)

  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ module?: McpChangeModule; count: number } | null>(null)

  const total = counts?.total ?? 0

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function onAccept(item: McpChangeRequest) {
    setBusyId(item.id)
    try {
      await accept.mutateAsync(item.id)
      toast.success('Accepted — publishing to WordPress')
    } catch (err) {
      toast.error((err as Error)?.message ?? 'Failed to publish — left in the queue')
    } finally {
      setBusyId(null)
    }
  }

  async function onReject(item: McpChangeRequest) {
    setBusyId(item.id)
    try {
      await reject.mutateAsync(item.id)
      toast.success('Proposal rejected')
    } catch (err) {
      toast.error((err as Error)?.message ?? 'Failed to reject')
    } finally {
      setBusyId(null)
    }
  }

  async function onConfirmAcceptAll() {
    if (!confirm) return
    const module = confirm.module
    setConfirm(null)
    try {
      const res = await acceptAll.mutateAsync(module)
      if (res.failed)
        toast.warning(`Published ${res.accepted}, ${res.failed} failed — failures remain in the queue`)
      else toast.success(`Published ${res.accepted} change${res.accepted === 1 ? '' : 's'} to WordPress`)
    } catch (err) {
      toast.error((err as Error)?.message ?? 'Bulk accept failed')
    }
  }

  async function onRejectAll(module?: McpChangeModule) {
    try {
      const res = await rejectAll.mutateAsync(module)
      toast.success(`Rejected ${res.rejected} proposal${res.rejected === 1 ? '' : 's'}`)
    } catch (err) {
      toast.error((err as Error)?.message ?? 'Bulk reject failed')
    }
  }

  // ── Loading / error / empty ────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Section total={0}>
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full bg-white/5" />
          ))}
        </div>
      </Section>
    )
  }
  if (isError) {
    return (
      <Section total={0}>
        <div className="flex items-center justify-between rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3">
          <span className="text-[13px] text-red-300">Couldn't load pending AI changes.</span>
          <Button size="sm" variant="ghost" onClick={() => refetch()} className="h-7 text-[12px] text-[#9aa0a6]">
            Retry
          </Button>
        </div>
      </Section>
    )
  }
  if (total === 0) {
    return (
      <Section total={0}>
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-white/8 bg-[#1a1d27] py-10 text-center">
          <CheckCircle2 className="size-6 text-emerald-400" />
          <p className="text-[14px] font-medium text-[#e8eaed]">All caught up</p>
          <p className="text-[12px] text-[#9aa0a6] max-w-sm">
            Changes proposed by the AI agent appear here for approval before they publish to WordPress.
          </p>
        </div>
      </Section>
    )
  }

  const grouped = MODULES.map((m) => ({
    ...m,
    items: (items ?? []).filter((it) => it.module === m.key),
  })).filter((g) => g.items.length > 0)

  return (
    <Section
      total={total}
      actions={
        <div className="flex items-center gap-2">
          <Button
            size="sm" variant="ghost"
            onClick={() => onRejectAll(undefined)}
            disabled={rejectAll.isPending}
            className="h-8 px-3 text-[12px] text-[#9aa0a6] hover:text-[#e8eaed] border border-white/8"
          >
            Reject all
          </Button>
          <Button
            size="sm"
            onClick={() => setConfirm({ count: total })}
            disabled={acceptAll.isPending}
            className="h-8 px-3 text-[12px] bg-emerald-600 hover:bg-emerald-600/90 text-white gap-1.5"
          >
            <UploadCloud className="size-3.5" />
            Accept all &amp; publish
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {grouped.map((g) => (
          <div key={g.key} className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <g.icon className="size-4 text-[#4e8af4]" />
                <h4 className="text-[13px] font-semibold text-[#e8eaed]">{g.label}</h4>
                <span className="text-[11px] text-[#9aa0a6] bg-white/5 rounded-full px-2 py-0.5 tabular-nums">
                  {g.items.length}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onRejectAll(g.key)}
                  className="text-[11px] text-[#9aa0a6] hover:text-[#e8eaed]"
                >
                  Reject all
                </button>
                <button
                  onClick={() => setConfirm({ module: g.key, count: g.items.length })}
                  className="text-[11px] text-emerald-400 hover:text-emerald-300"
                >
                  Accept all
                </button>
              </div>
            </div>

            <div className="space-y-2">
              {g.items.map((item) => (
                <ProposalRow
                  key={item.id}
                  item={item}
                  open={expanded.has(item.id) || focusModule === item.module}
                  busy={busyId === item.id}
                  onToggle={() => toggle(item.id)}
                  onAccept={() => onAccept(item)}
                  onReject={() => onReject(item)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className="bg-[#1a1d27] border border-white/10 text-[#e8eaed]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[15px]">
              <UploadCloud className="size-4 text-emerald-400" />
              Publish {confirm?.count} change{confirm?.count === 1 ? '' : 's'} to WordPress?
            </DialogTitle>
            <DialogDescription className="text-[13px] text-[#9aa0a6]">
              Accepting applies {confirm?.module ? `${confirm.module} ` : ''}change
              {confirm?.count === 1 ? '' : 's'} to the CMS <strong>and publishes them to the live
              WordPress site</strong>. This affects what visitors and search engines see.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(null)} className="text-[#9aa0a6]">
              Cancel
            </Button>
            <Button
              onClick={onConfirmAcceptAll}
              className="bg-emerald-600 hover:bg-emerald-600/90 text-white gap-1.5"
            >
              <UploadCloud className="size-4" />
              Accept {confirm?.count} &amp; publish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  )
}

/* ── Section wrapper with the prominent header badge ───────────────────────── */
function Section({
  total, actions, children,
}: {
  total: number
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-white/8 bg-[#15171f] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-[#4e8af4]" />
          <h3 className="text-[14px] font-semibold text-[#e8eaed]">Pending AI changes</h3>
          {total > 0 && (
            <span className="text-[11px] font-semibold text-white bg-[#4e8af4] rounded-full px-2 py-0.5 tabular-nums">
              {total}
            </span>
          )}
        </div>
        {actions}
      </div>
      {children}
    </div>
  )
}

/* ── A single proposal row with collapsible diff + pessimistic actions ─────── */
function ProposalRow({
  item, open, busy, onToggle, onAccept, onReject,
}: {
  item: McpChangeRequest
  open: boolean
  busy: boolean
  onToggle: () => void
  onAccept: () => void
  onReject: () => void
}) {
  return (
    <div className="rounded-lg border border-white/8 bg-[#1a1d27] overflow-hidden">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <button onClick={onToggle} className="text-[#9aa0a6] hover:text-[#e8eaed] flex-shrink-0">
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[#4e8af4] bg-[#4e8af4]/10 rounded px-1.5 py-0.5 flex-shrink-0">
          {ACTION_LABEL[item.action] ?? item.action}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] text-[#e8eaed] truncate" title={item.summary}>
            {item.summary}
          </p>
          {item.targetLabel && (
            <p className="text-[11px] text-[#9aa0a6] truncate" title={item.targetLabel}>
              {item.targetLabel}
            </p>
          )}
        </div>
        {item.error && (
          <span className="flex items-center gap-1 text-[11px] text-red-300 flex-shrink-0" title={item.error}>
            <AlertTriangle className="size-3.5" /> failed
          </span>
        )}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <Button
            size="sm" variant="ghost" onClick={onReject} disabled={busy}
            className="h-7 px-2 text-[12px] text-[#9aa0a6] hover:text-red-300"
          >
            <X className="size-3.5" />
          </Button>
          <Button
            size="sm" onClick={onAccept} disabled={busy}
            className="h-7 px-2.5 text-[12px] bg-emerald-600 hover:bg-emerald-600/90 text-white gap-1"
            title="Accept applies the change and publishes it to WordPress"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <UploadCloud className="size-3.5" />}
            {busy ? 'Publishing…' : 'Accept & publish'}
          </Button>
        </div>
      </div>
      {open && (
        <div className="border-t border-white/8 px-3 py-3 bg-[#0f1117]">
          <ProposalDiff item={item} />
        </div>
      )}
    </div>
  )
}

/* ── Diff rendering, per module ────────────────────────────────────────────── */
function ProposalDiff({ item }: { item: McpChangeRequest }) {
  if (item.module === 'meta') return <MetaDiff item={item} />
  if (item.module === 'alt') return <AltDiff item={item} />
  if (item.module === 'asana') return <AsanaDiff item={item} />
  if (item.module === 'redirect') return <RedirectDiff item={item} />
  return <SchemaDiff item={item} />
}

function RedirectDiff({ item }: { item: McpChangeRequest }) {
  const before = (item.before ?? {}) as Record<string, unknown>
  const after = item.payload as Record<string, unknown>

  if (item.action === 'redirect.create') {
    return (
      <div className="space-y-1.5">
        <p className="text-[11px] text-emerald-300">New redirect</p>
        {['source', 'target', 'actionCode', 'matchType', 'regex', 'enabled'].map((k) =>
          after[k] === undefined ? null : (
            <div key={k} className="grid grid-cols-[110px_1fr] gap-2 text-[12px]">
              <span className="text-[#9aa0a6]">{humanize(k)}</span>
              <span className="text-emerald-300 break-all">{fmt(after[k])}</span>
            </div>
          ),
        )}
      </div>
    )
  }
  if (item.action === 'redirect.delete') {
    return (
      <div className="space-y-1">
        <p className="text-[11px] text-red-300">Removing redirect</p>
        <p className="text-[12px] text-[#9aa0a6] break-all">
          {fmt(before.source)} {before.target ? `→ ${fmt(before.target)}` : ''}
        </p>
      </div>
    )
  }
  if (item.action === 'redirect.enable' || item.action === 'redirect.disable') {
    return (
      <p className="text-[12px] text-[#4e8af4]">
        {item.action === 'redirect.enable' ? 'Enable' : 'Disable'} {fmt(before.source)}
      </p>
    )
  }
  // redirect.update — before → after for the changed fields only
  const keys = Object.keys(after)
  return (
    <div className="space-y-2">
      {keys.map((k) => (
        <div key={k} className="grid grid-cols-[110px_1fr] gap-2 text-[12px]">
          <span className="text-[#9aa0a6]">{humanize(k)}</span>
          <span className="flex items-center gap-2 min-w-0 flex-wrap">
            <span className="text-[#9aa0a6]/70 line-through break-all">{fmt(before[k])}</span>
            <ChevronRight className="size-3 text-[#4e8af4] flex-shrink-0" />
            <span className="text-[#4e8af4] break-all">{fmt(after[k])}</span>
          </span>
        </div>
      ))}
    </div>
  )
}

function AsanaDiff({ item }: { item: McpChangeRequest }) {
  const payload = item.payload as Record<string, unknown>
  const keys = Object.keys(payload)
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] text-emerald-300">{item.summary}</p>
      {keys.map((k) => (
        <div key={k} className="grid grid-cols-[110px_1fr] gap-2 text-[12px]">
          <span className="text-[#9aa0a6]">{humanize(k)}</span>
          <span className="text-[#4e8af4] break-all">{fmt(payload[k])}</span>
        </div>
      ))}
    </div>
  )
}

function humanize(key: string) {
  return key
    .replace(/^custom/, '')
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim()
}

function fmt(v: unknown) {
  if (v === null || v === undefined || v === '') return '(empty)'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return String(v)
}

function MetaDiff({ item }: { item: McpChangeRequest }) {
  const before = (item.before ?? {}) as Record<string, unknown>
  const after = item.payload as Record<string, unknown>
  const keys = Object.keys(after)
  return (
    <div className="space-y-2">
      {keys.map((k) => (
        <div key={k} className="grid grid-cols-[120px_1fr] gap-2 text-[12px]">
          <span className="text-[#9aa0a6]">{humanize(k)}</span>
          <span className="flex items-center gap-2 min-w-0 flex-wrap">
            <span className="text-[#9aa0a6]/70 line-through break-all">{fmt(before[k])}</span>
            <ChevronRight className="size-3 text-[#4e8af4] flex-shrink-0" />
            <span className="text-[#4e8af4] break-all">{fmt(after[k])}</span>
          </span>
        </div>
      ))}
    </div>
  )
}

function AltDiff({ item }: { item: McpChangeRequest }) {
  const before = (item.before ?? {}) as { alt?: unknown }
  const after = item.payload as { alt?: unknown }
  return (
    <div className="flex items-start gap-3">
      {item.targetLabel && (
        <img
          src={item.targetLabel}
          alt=""
          className="size-14 rounded object-cover border border-white/8 flex-shrink-0 bg-white/5"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden' }}
        />
      )}
      <div className="space-y-1 text-[12px] min-w-0">
        <div>
          <span className="text-[#9aa0a6]">Current: </span>
          <span className="text-[#9aa0a6]/70 line-through break-words">{fmt(before.alt)}</span>
        </div>
        <div>
          <span className="text-[#9aa0a6]">Proposed: </span>
          <span className="text-[#4e8af4] break-words">{fmt(after.alt)}</span>
        </div>
      </div>
    </div>
  )
}

function JsonBlock({ value, tone }: { value: unknown; tone: 'add' | 'remove' | 'plain' }) {
  const color =
    tone === 'add' ? 'text-emerald-300' : tone === 'remove' ? 'text-red-300' : 'text-[#e8eaed]'
  return (
    <pre className={`max-h-64 overflow-auto rounded bg-black/30 p-2 text-[11px] leading-relaxed ${color}`}>
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}

function SchemaDiff({ item }: { item: McpChangeRequest }) {
  const before = item.before as { type?: string; jsonld?: unknown } | null
  const payload = item.payload as { type?: string; jsonld?: unknown }
  if (item.action === 'schema.add') {
    return (
      <div className="space-y-1">
        <p className="text-[11px] text-emerald-300">Adding {payload.type ?? 'schema'}</p>
        <JsonBlock value={payload.jsonld} tone="add" />
      </div>
    )
  }
  if (item.action === 'schema.delete') {
    return (
      <div className="space-y-1">
        <p className="text-[11px] text-red-300">Removing {before?.type ?? 'schema'}</p>
        <JsonBlock value={before?.jsonld ?? before} tone="remove" />
      </div>
    )
  }
  // schema.update
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1">
        <p className="text-[11px] text-[#9aa0a6]">Before</p>
        <JsonBlock value={before?.jsonld ?? before} tone="remove" />
      </div>
      <div className="space-y-1">
        <p className="text-[11px] text-[#9aa0a6]">After</p>
        <JsonBlock value={payload.jsonld ?? payload} tone="add" />
      </div>
    </div>
  )
}
