import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCreateAnnotation, useUpdateAnnotation } from '@/hooks/useImpact'

/** Recurring external-event kinds, each a marker subtype + optional reference. */
export const EVENT_TYPES: { value: string; label: string }[] = [
  { value: '', label: 'Plain pin' },
  { value: 'core-update', label: 'Google core update' },
  { value: 'migration', label: 'Site migration' },
  { value: 'redesign', label: 'Redesign / template change' },
  { value: 'tracking', label: 'Tracking / analytics change' },
  { value: 'pr', label: 'PR / press spike' },
  { value: 'seasonality', label: 'Seasonality' },
  { value: 'external', label: 'Other external event' },
]

const selectCls =
  'h-9 px-3 pr-8 rounded-lg bg-[#1a1d27] border border-white/8 text-[13px] text-[#e8eaed] focus:outline-none focus:ring-1 focus:ring-[#4e8af4]/50 appearance-none cursor-pointer w-full'

export interface EditingAnnotation {
  id: string
  date: string
  label: string
  type: string | null
  link: string | null
  pageId: string | null
}

/**
 * Add or edit a manual timeline event (external context: core update, migration,
 * PR…). Richer than the old inline pin: date + label + type preset + optional
 * link + this-page-vs-sitewide scope. Manual events fold into the same feed, so
 * they toggle, cluster and open in the grouped Sheet like real changes.
 */
export function AddEventDialog({
  open, onOpenChange, siteId, editing, page, defaultDate,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  siteId: string
  editing: EditingAnnotation | null
  /** The current per-page scope (when viewing one page), else null (site-wide). */
  page: { id: string; url: string } | null
  defaultDate: string
}) {
  const create = useCreateAnnotation(siteId)
  const update = useUpdateAnnotation(siteId)

  const [date, setDate] = useState(defaultDate)
  const [label, setLabel] = useState('')
  const [type, setType] = useState('')
  const [link, setLink] = useState('')
  // 'page' pins to the current page; 'site' is site-wide. Only relevant on a page.
  const [scope, setScope] = useState<'page' | 'site'>('site')

  useEffect(() => {
    if (!open) return
    if (editing) {
      setDate(editing.date)
      setLabel(editing.label)
      setType(editing.type ?? '')
      setLink(editing.link ?? '')
      setScope(editing.pageId ? 'page' : 'site')
    } else {
      setDate(defaultDate)
      setLabel('')
      setType('')
      setLink('')
      setScope(page ? 'page' : 'site')
    }
  }, [open, editing, defaultDate, page])

  const busy = create.isPending || update.isPending

  async function save() {
    const l = label.trim()
    if (!l || !date) return
    const pageId = scope === 'page' && page ? page.id : null
    const input = { date, label: l, type: type || null, link: link.trim() || null, pageId }
    try {
      if (editing) await update.mutateAsync({ id: editing.id, patch: input })
      else await create.mutateAsync(input)
      toast.success(editing ? 'Event updated.' : 'Event added to the timeline.')
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save the event.")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit event' : 'Add timeline event'}</DialogTitle>
          <DialogDescription>
            Mark an external event so you can read your changes against it — it never claims to cause a move.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 px-1">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[#e8eaed]">Date</Label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                className="mt-1 h-9 px-3 rounded-lg bg-[#1a1d27] border border-white/8 text-[13px] text-[#e8eaed] focus:outline-none focus:ring-1 focus:ring-[#4e8af4]/50 w-full" />
            </div>
            <div>
              <Label className="text-[#e8eaed]">Type</Label>
              <select value={type} onChange={(e) => setType(e.target.value)} className={`mt-1 ${selectCls}`}>
                {EVENT_TYPES.map((t) => <option key={t.value} value={t.value} className="bg-[#1a1d27]">{t.label}</option>)}
              </select>
            </div>
          </div>

          <div>
            <Label className="text-[#e8eaed]">Label</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') save() }}
              placeholder="e.g. March 2026 core update" className="mt-1" autoFocus />
          </div>

          <div>
            <Label className="text-[#e8eaed]">Reference link <span className="text-[#9aa0a6]">(optional)</span></Label>
            <Input value={link} onChange={(e) => setLink(e.target.value)}
              placeholder="https://…" className="mt-1" />
          </div>

          {page && (
            <div>
              <Label className="text-[#e8eaed]">Scope</Label>
              <div className="mt-1 flex items-center rounded-lg bg-white/5 p-0.5 text-[12px] w-fit">
                {([['site', 'Site-wide'], ['page', 'This page']] as const).map(([v, lbl]) => (
                  <button key={v} onClick={() => setScope(v)}
                    className={`px-3 py-1 rounded-md transition-colors ${scope === v ? 'bg-[#4e8af4]/20 text-[#4e8af4] font-medium' : 'text-[#9aa0a6] hover:text-[#e8eaed]'}`}>
                    {lbl}
                  </button>
                ))}
              </div>
              {scope === 'page' && (
                <p className="text-[11px] text-[#9aa0a6] mt-1 truncate">on {page.url}</p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-[#9aa0a6]">Cancel</Button>
          <Button onClick={save} disabled={!label.trim() || !date || busy} className="bg-[#4e8af4] hover:bg-[#4e8af4]/90 text-white">
            {editing ? 'Save' : 'Add event'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
