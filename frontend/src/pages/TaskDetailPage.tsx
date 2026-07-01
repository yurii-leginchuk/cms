import { useEffect, useState } from 'react'
import { Link, useParams, Navigate, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  ChevronLeft, ChevronRight, ExternalLink, CheckSquare, Sparkles, Calendar,
  CheckCircle2, Circle, ListTree, Link2, Unlink, Plus, RefreshCw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { RelativeClock } from '@/components/index-status/RelativeClock'
import { useSite } from '@/hooks/useSites'
import {
  useAsanaTask, useAsanaSections, useAsanaUsers, useUpdateAsanaTask, useSetAsanaStatus,
  useSetAsanaAssignee, useCreateAsanaSubtask, useLinkAsanaTask, useUntrackAsanaTask,
} from '@/hooks/useAsana'
import type { AsanaTask } from '@/api/asana'

const selectCls =
  'h-9 px-3 pr-8 rounded-lg bg-[#1a1d27] border border-white/8 text-[13px] text-[#e8eaed] focus:outline-none focus:ring-1 focus:ring-[#4e8af4]/50 appearance-none cursor-pointer'
const selectBg = {
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239aa0a6' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 10px center',
}
const ENTITY_TYPES = ['page', 'meta', 'schema']

export default function TaskDetailPage() {
  const { id, taskGid } = useParams<{ id: string; taskGid: string }>()
  const navigate = useNavigate()
  const { data: site } = useSite(id!)
  const { data: detail, isLoading, isError, error } = useAsanaTask(id, taskGid)
  const { data: sections } = useAsanaSections(id, !!detail)
  const { data: users } = useAsanaUsers(!!detail)

  const update = useUpdateAsanaTask(id!)
  const setStatus = useSetAsanaStatus(id!)
  const setAssignee = useSetAsanaAssignee(id!)
  const createSubtask = useCreateAsanaSubtask(id!)
  const linkTask = useLinkAsanaTask(id!)
  const untrack = useUntrackAsanaTask(id!)

  const task = detail?.task
  const subtasks = detail?.subtasks ?? []
  const tracked = !!task && task.origin !== 'asana'

  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [subtaskName, setSubtaskName] = useState('')
  const [linkType, setLinkType] = useState('')
  const [linkId, setLinkId] = useState('')

  useEffect(() => {
    if (task) { setName(task.name); setNotes(task.notes ?? '') }
  }, [task?.taskGid, task?.name, task?.notes]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!id || !taskGid) return <Navigate to="/sites" replace />

  const g = taskGid

  async function run<T>(p: Promise<T>, ok: string) {
    try { await p; toast.success(ok) }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Something went wrong.') }
  }

  async function saveName() {
    if (!task || name.trim() === task.name || !name.trim()) return
    run(update.mutateAsync({ taskGid: g, input: { name: name.trim() } }), 'Name updated.')
  }
  async function saveNotes() {
    if (!task || notes === (task.notes ?? '')) return
    run(update.mutateAsync({ taskGid: g, input: { notes } }), 'Description saved.')
  }
  async function toggleCompleted() {
    if (!task) return
    run(update.mutateAsync({ taskGid: g, input: { completed: !task.completed } }), task.completed ? 'Marked incomplete.' : 'Marked complete.')
  }
  async function addSubtask() {
    if (!subtaskName.trim()) return
    await run(createSubtask.mutateAsync({ taskGid: g, input: { name: subtaskName.trim() } }), 'Subtask added.')
    setSubtaskName('')
  }
  async function doLink() {
    if (!linkType || !linkId.trim()) return
    await run(linkTask.mutateAsync({ taskGid: g, entityType: linkType, entityId: linkId.trim() }), 'Linked to CMS entity.')
    setLinkType(''); setLinkId('')
  }
  async function doUnlink() {
    run(linkTask.mutateAsync({ taskGid: g, entityType: null, entityId: null }), 'Unlinked.')
  }
  async function stopTracking() {
    try {
      await untrack.mutateAsync(g)
      toast.success('Stopped tracking. (Still in Asana.)')
      navigate(`/sites/${id}/tasks`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't stop tracking.")
    }
  }

  return (
    <div className="min-h-full">
      {/* Header */}
      <div className="border-b border-white/8 px-8 py-5">
        <div className="flex items-center gap-1.5 text-[13px] mb-3">
          <Link to="/sites" className="text-[#9aa0a6] hover:text-[#e8eaed] flex items-center gap-1"><ChevronLeft className="size-3.5" />Sites</Link>
          <ChevronRight className="size-3.5 text-[#9aa0a6]/40" />
          <Link to={`/sites/${id}`} className="text-[#9aa0a6] hover:text-[#e8eaed]">{site?.name}</Link>
          <ChevronRight className="size-3.5 text-[#9aa0a6]/40" />
          <Link to={`/sites/${id}/tasks`} className="text-[#9aa0a6] hover:text-[#e8eaed]">Tasks</Link>
          <ChevronRight className="size-3.5 text-[#9aa0a6]/40" />
          <span className="text-[#e8eaed]">Detail</span>
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <CheckSquare className="size-5 text-rose-400 mt-1.5 flex-shrink-0" />
            {isLoading ? (
              <Skeleton className="h-9 w-96 bg-white/5" />
            ) : tracked ? (
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={saveName}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                className={`text-lg font-semibold bg-transparent border-transparent hover:border-white/10 focus:border-[#4e8af4]/50 h-10 px-2 ${task?.completed ? 'text-[#9aa0a6] line-through' : 'text-[#e8eaed]'}`}
              />
            ) : (
              <h1 className="text-xl font-semibold text-[#e8eaed]">{task?.name ?? 'Task'}</h1>
            )}
            {task?.origin === 'mcp' && (
              <span className="inline-flex items-center gap-1 text-[11px] text-violet-300 border border-violet-400/30 bg-violet-400/10 rounded-md px-1.5 py-0.5 flex-shrink-0"><Sparkles className="size-3" />AI</span>
            )}
            {task?.origin === 'tracked' && (
              <span className="inline-flex items-center gap-1 text-[11px] text-[#9aa0a6] border border-white/10 bg-white/[0.03] rounded-md px-1.5 py-0.5 flex-shrink-0"><Link2 className="size-3" />tracked</span>
            )}
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            {task?.permalinkUrl && (
              <a href={task.permalinkUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[12px] text-[#9aa0a6] hover:text-[#e8eaed]">Open in Asana <ExternalLink className="size-3" /></a>
            )}
            {tracked && (
              <Button size="sm" variant="ghost" onClick={stopTracking} disabled={untrack.isPending} className="h-8 text-[12px] text-[#9aa0a6] hover:text-red-300 gap-1.5 border border-white/8">
                <Unlink className="size-3.5" />Stop tracking
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="px-8 py-6 max-w-3xl space-y-6">
        {isError ? (
          <div className="rounded-xl border border-red-400/20 bg-red-400/[0.04] px-5 py-4 text-[13px] text-[#e8eaed]">
            {error instanceof Error ? error.message : 'Could not load this task.'}
          </div>
        ) : isLoading ? (
          <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 bg-white/5 rounded-xl" />)}</div>
        ) : task ? (
          <>
            {/* Controls */}
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={toggleCompleted}
                disabled={!tracked || update.isPending}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] font-medium border transition-colors ${task.completed ? 'bg-emerald-400/10 text-emerald-300 border-emerald-400/25' : 'bg-white/[0.03] text-[#9aa0a6] border-white/10 hover:text-[#e8eaed]'}`}
              >
                {task.completed ? <CheckCircle2 className="size-3.5" /> : <Circle className="size-3.5" />}
                {task.completed ? 'Completed' : 'Mark complete'}
              </button>

              <label className="inline-flex items-center gap-1.5 text-[12px] text-[#9aa0a6]">Status
                <select
                  value={task.sectionGid ?? ''}
                  disabled={!tracked || setStatus.isPending}
                  onChange={(e) => e.target.value && run(setStatus.mutateAsync({ taskGid: g, sectionGid: e.target.value }), 'Status updated.')}
                  className={selectCls} style={selectBg}
                >
                  <option value="" className="bg-[#1a1d27]">—</option>
                  {(sections ?? []).map((s) => <option key={s.gid} value={s.gid} className="bg-[#1a1d27]">{s.name}</option>)}
                </select>
              </label>

              <label className="inline-flex items-center gap-1.5 text-[12px] text-[#9aa0a6]">Assignee
                <select
                  value={task.assigneeGid ?? ''}
                  disabled={!tracked || setAssignee.isPending}
                  onChange={(e) => run(setAssignee.mutateAsync({ taskGid: g, assigneeGid: e.target.value || null }), 'Assignee updated.')}
                  className={selectCls} style={selectBg}
                >
                  <option value="" className="bg-[#1a1d27]">Unassigned</option>
                  {(users ?? []).map((u) => <option key={u.gid} value={u.gid} className="bg-[#1a1d27]">{u.name}</option>)}
                </select>
              </label>

              <label className="inline-flex items-center gap-1.5 text-[12px] text-[#9aa0a6]"><Calendar className="size-3.5" />
                <input
                  type="date"
                  value={task.dueOn ?? ''}
                  disabled={!tracked || update.isPending}
                  onChange={(e) => run(update.mutateAsync({ taskGid: g, input: { dueOn: e.target.value || null } }), 'Due date updated.')}
                  className="h-9 px-3 rounded-lg bg-[#1a1d27] border border-white/8 text-[13px] text-[#e8eaed] focus:outline-none focus:ring-1 focus:ring-[#4e8af4]/50"
                />
              </label>
            </div>

            {/* Dual-clock freshness */}
            <div className="flex flex-wrap items-center gap-x-8 gap-y-1 text-[12px] text-[#9aa0a6]">
              <span>Modified in Asana <RelativeClock ts={task.asanaModifiedAt} /></span>
              <span>Synced here <RelativeClock ts={task.lastSyncedAt} staleDays={1} /></span>
            </div>

            {/* CMS-entity link */}
            <div>
              <h2 className="text-[11px] font-medium uppercase tracking-widest text-[#9aa0a6] mb-2">CMS link</h2>
              {task.linkedEntityType ? (
                <div className="inline-flex items-center gap-2 text-[13px] text-[#4e8af4] border border-[#4e8af4]/25 bg-[#4e8af4]/10 rounded-lg px-3 py-1.5">
                  <Link2 className="size-3.5" />{task.linkedEntityType}: <span className="text-[#e8eaed]">{task.linkedEntityId}</span>
                  <button onClick={doUnlink} disabled={linkTask.isPending} title="Unlink" className="ml-1 text-[#9aa0a6] hover:text-red-300"><Unlink className="size-3.5" /></button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <select value={linkType} onChange={(e) => setLinkType(e.target.value)} className={selectCls} style={selectBg} disabled={!tracked}>
                    <option value="" className="bg-[#1a1d27]">Entity type…</option>
                    {ENTITY_TYPES.map((t) => <option key={t} value={t} className="bg-[#1a1d27]">{t}</option>)}
                  </select>
                  <Input value={linkId} onChange={(e) => setLinkId(e.target.value)} placeholder="Entity id (page/schema/meta id)" className="max-w-xs bg-[#1a1d27] border-white/8 text-[#e8eaed] h-9" disabled={!tracked} />
                  <Button size="sm" variant="ghost" onClick={doLink} disabled={!tracked || !linkType || !linkId.trim() || linkTask.isPending} className="h-9 border border-white/8 text-[#e8eaed] hover:bg-white/5 gap-1.5"><Link2 className="size-3.5" />Link</Button>
                </div>
              )}
            </div>

            {/* Notes */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-[11px] font-medium uppercase tracking-widest text-[#9aa0a6]">Description</h2>
                {tracked && notes !== (task.notes ?? '') && (
                  <Button size="sm" variant="ghost" onClick={saveNotes} disabled={update.isPending} className="h-7 text-[12px] text-[#4e8af4] hover:text-[#4e8af4]/80">Save</Button>
                )}
              </div>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={!tracked}
                rows={4}
                placeholder="No description."
                className="w-full text-[13px] text-[#e8eaed] whitespace-pre-wrap leading-relaxed rounded-xl border border-white/8 bg-[#1a1d27]/60 px-4 py-3 focus:outline-none focus:ring-1 focus:ring-[#4e8af4]/40 resize-y"
              />
            </div>

            {/* Subtasks */}
            <div>
              <h2 className="text-[11px] font-medium uppercase tracking-widest text-[#9aa0a6] mb-2 inline-flex items-center gap-1.5">
                <ListTree className="size-3.5" />Subtasks {subtasks.length > 0 && <span className="text-[#e8eaed]">{subtasks.length}</span>}
              </h2>
              {subtasks.length > 0 && (
                <div className="rounded-xl border border-white/8 overflow-hidden divide-y divide-white/8 mb-2">
                  {subtasks.map((st: AsanaTask) => (
                    <div key={st.taskGid} className="flex items-center gap-3 px-4 py-2.5">
                      {st.completed ? <CheckCircle2 className="size-4 text-emerald-400 flex-shrink-0" /> : <Circle className="size-4 text-[#9aa0a6]/50 flex-shrink-0" />}
                      <span className={`text-[13px] flex-1 truncate ${st.completed ? 'text-[#9aa0a6] line-through' : 'text-[#e8eaed]'}`} title={st.name}>{st.name}</span>
                      {st.assigneeName && <span className="text-[11px] text-[#9aa0a6]">{st.assigneeName}</span>}
                      {st.permalinkUrl && <a href={st.permalinkUrl} target="_blank" rel="noopener noreferrer" className="text-[#9aa0a6] hover:text-[#e8eaed]"><ExternalLink className="size-3" /></a>}
                    </div>
                  ))}
                </div>
              )}
              {tracked && (
                <div className="flex items-center gap-2">
                  <Input value={subtaskName} onChange={(e) => setSubtaskName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addSubtask() }} placeholder="Add a subtask…" className="bg-[#1a1d27] border-white/8 text-[#e8eaed] h-9" />
                  <Button size="sm" onClick={addSubtask} disabled={!subtaskName.trim() || createSubtask.isPending} className="h-9 bg-[#4e8af4] hover:bg-[#4e8af4]/90 text-white gap-1.5 shrink-0">
                    {createSubtask.isPending ? <RefreshCw className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}Add
                  </Button>
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
