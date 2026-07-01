import { useState, useRef } from 'react'
import { Link, useParams, Navigate, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  ChevronLeft, ChevronRight, ExternalLink, Search, CheckSquare, RefreshCw,
  AlertTriangle, Sparkles, Circle, CheckCircle2, User, Calendar, ListTree, Link2, Plus,
  Unlink, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { StatusBadge } from '@/components/StatusBadge'
import { RelativeClock } from '@/components/index-status/RelativeClock'
import { useSite } from '@/hooks/useSites'
import {
  useAsanaConnection, useAsanaMapping, useAsanaSections, useAsanaTasks, useSyncAsana,
  useTrackAsanaTask, useCreateAsanaTask, useUntrackAsanaTask, useAsanaUsers,
} from '@/hooks/useAsana'
import type { AsanaTask } from '@/api/asana'

const PAGE_LIMIT = 50
const OVERDUE_DAYS = 0

const selectCls =
  'h-9 px-3 pr-8 rounded-lg bg-[#1a1d27] border border-white/8 text-[13px] text-[#e8eaed] focus:outline-none focus:ring-1 focus:ring-[#4e8af4]/50 appearance-none cursor-pointer'
const selectBg = {
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239aa0a6' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 10px center',
}

/** A section (= status column) pill. Neutral by default; completed is emerald. */
function SectionChip({ name, completed }: { name: string | null; completed: boolean }) {
  if (completed) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium border bg-emerald-400/10 text-emerald-300 border-emerald-400/25">
        <CheckCircle2 className="size-3" />{name || 'Done'}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium border bg-sky-400/10 text-sky-300 border-sky-400/25">
      <Circle className="size-2.5" />{name || 'No section'}
    </span>
  )
}

function DueDate({ dueOn, completed }: { dueOn: string | null; completed: boolean }) {
  if (!dueOn) return <span className="text-[#9aa0a6]/30 text-[13px]">—</span>
  const overdue = !completed && (Date.now() - new Date(dueOn + 'T23:59:59').getTime()) / 86_400_000 > OVERDUE_DAYS
  return (
    <span className={`inline-flex items-center gap-1 text-[12px] tabular-nums ${overdue ? 'text-red-400' : 'text-[#9aa0a6]'}`}>
      <Calendar className="size-3" />{dueOn}
    </span>
  )
}

export default function SiteTasksPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [currentPage, setCurrentPage] = useState(1)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [section, setSection] = useState('')
  const [completed, setCompleted] = useState('') // '', 'false', 'true'
  const [aiOnly, setAiOnly] = useState(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { data: site, isLoading: siteLoading } = useSite(id!)
  const { data: conn } = useAsanaConnection()
  const { data: mapping } = useAsanaMapping(id)
  const ready = conn?.status === 'verified' && !!mapping?.projectGid
  const { data: sections } = useAsanaSections(id, ready)
  const { data: users } = useAsanaUsers(ready)
  const sync = useSyncAsana(id!)
  const track = useTrackAsanaTask(id!)
  const createTask = useCreateAsanaTask(id!)
  const untrack = useUntrackAsanaTask(id!)
  const [trackUrl, setTrackUrl] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const emptyCreate = { name: '', sectionGid: '', assigneeGid: '', dueOn: '' }
  const [createForm, setCreateForm] = useState(emptyCreate)

  const { data: taskList, isLoading: tasksLoading, isFetching } = useAsanaTasks(
    ready ? id : undefined,
    {
      page: currentPage, limit: PAGE_LIMIT,
      search: debouncedSearch || undefined,
      section: section || undefined,
      completed: completed === '' ? undefined : completed === 'true',
      aiOnly: aiOnly || undefined,
    },
  )

  if (!id) return <Navigate to="/sites" replace />

  function onSearch(v: string) {
    setSearch(v); setCurrentPage(1)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => setDebouncedSearch(v), 350)
  }

  async function handleSync() {
    try {
      const res = await sync.mutateAsync()
      toast.success(`Refreshed ${res.synced} tracked task${res.synced === 1 ? '' : 's'}${res.pruned ? `, removed ${res.pruned} deleted` : ''}.`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't sync from Asana.")
    }
  }

  async function handleTrack() {
    const url = trackUrl.trim()
    if (!url) return
    try {
      const t = await track.mutateAsync(url)
      setTrackUrl('')
      toast.success(`Now tracking “${t.name}”.`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't track that task.")
    }
  }

  async function handleCreate() {
    const name = createForm.name.trim()
    if (!name) return
    try {
      const t = await createTask.mutateAsync({
        name,
        sectionGid: createForm.sectionGid || undefined,
        assigneeGid: createForm.assigneeGid || undefined,
        dueOn: createForm.dueOn || undefined,
      })
      setCreateForm(emptyCreate)
      setShowCreate(false)
      toast.success(`Created “${t.name}” in Asana.`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create the task.")
    }
  }

  async function handleUntrack(taskGid: string, name: string) {
    try {
      await untrack.mutateAsync(taskGid)
      toast.success(`Stopped tracking “${name}”. (Still in Asana — re-track by URL anytime.)`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't stop tracking.")
    }
  }

  const rows = taskList?.data ?? []
  const meta = taskList?.meta

  const notConnected = conn && conn.status !== 'verified'
  const notMapped = conn?.status === 'verified' && !mapping?.projectGid

  return (
    <div className="min-h-full">
      {/* Header */}
      <div className="border-b border-white/8 px-8 py-5">
        <div className="flex items-center gap-1.5 text-[13px] mb-3">
          <Link to="/sites" className="text-[#9aa0a6] hover:text-[#e8eaed] flex items-center gap-1">
            <ChevronLeft className="size-3.5" />Sites
          </Link>
          <ChevronRight className="size-3.5 text-[#9aa0a6]/40" />
          <Link to={`/sites/${id}`} className="text-[#9aa0a6] hover:text-[#e8eaed]">
            {siteLoading ? <Skeleton className="h-4 w-24 bg-white/5 inline-block" /> : site?.name}
          </Link>
          <ChevronRight className="size-3.5 text-[#9aa0a6]/40" />
          <span className="text-[#e8eaed]">Tasks</span>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <CheckSquare className="size-5 text-rose-400" />
            <h1 className="text-xl font-semibold text-[#e8eaed] tracking-tight">{site?.name}</h1>
            <span className="text-[#9aa0a6]/50 text-xl font-light">/</span>
            <span className="text-[#9aa0a6] text-[15px]">Tasks</span>
            {site && <StatusBadge status={site.status ?? 'idle'} />}
          </div>
          <div className="flex items-center gap-3">
            {ready && mapping?.projectName && (
              <span className="text-[12px] text-[#9aa0a6]">Project: <span className="text-[#e8eaed]">{mapping.projectName}</span></span>
            )}
            {ready && (
              <Button
                size="sm"
                onClick={() => setShowCreate((v) => !v)}
                className="h-8 px-3 text-[13px] bg-[#4e8af4] hover:bg-[#4e8af4]/90 text-white gap-1.5"
              >
                <Plus className="size-3.5" />New task
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="px-8 py-6 space-y-6">
        {/* Empty state #1 — not connected */}
        {notConnected ? (
          <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.04] px-5 py-4 flex items-start gap-3">
            <AlertTriangle className="size-4 text-amber-400 mt-0.5 flex-shrink-0" />
            <div className="text-[13px] text-[#e8eaed]">
              <p className="font-medium">Asana isn't connected yet.</p>
              <p className="text-[#9aa0a6] mt-1">
                Add a Personal Access Token and pick a workspace in{' '}
                <Link to="/settings/asana" className="text-[#4e8af4] hover:underline">Asana settings</Link> to start tracking tasks.
              </p>
            </div>
          </div>
        ) : notMapped ? (
          /* Empty state #2 — connected but this site isn't mapped */
          <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.04] px-5 py-4 flex items-start gap-3">
            <AlertTriangle className="size-4 text-amber-400 mt-0.5 flex-shrink-0" />
            <div className="text-[13px] text-[#e8eaed]">
              <p className="font-medium">This site has no Asana project mapped.</p>
              <p className="text-[#9aa0a6] mt-1">
                Map a project to <span className="text-[#e8eaed]">{site?.name}</span> in{' '}
                <Link to="/settings/asana" className="text-[#4e8af4] hover:underline">Asana settings</Link>.
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Sync-trust strip */}
            <div className="rounded-xl border border-white/8 bg-[#1a1d27]/60 px-5 py-3.5 flex flex-wrap items-center gap-x-6 gap-y-2">
              <div className="text-[13px] text-[#9aa0a6]">
                Last synced <RelativeClock ts={mapping?.lastFullSyncAt ?? null} emptyLabel="never" staleDays={1} />
              </div>
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium border bg-white/[0.03] text-[#9aa0a6] border-white/10" title="Webhook live-sync arrives in a later phase. For now, use Refresh to pull the latest from Asana.">
                <span className="size-1.5 rounded-full bg-[#9aa0a6]/40" />Live sync: off — use Refresh
              </span>
              <div className="flex-1" />
              {mapping?.syncError && (
                <span className="text-[12px] text-red-400 inline-flex items-center gap-1" title={mapping.syncError}>
                  <AlertTriangle className="size-3" />sync failed
                </span>
              )}
              <Button
                size="sm"
                onClick={handleSync}
                disabled={sync.isPending}
                className="h-8 px-3 text-[13px] bg-[#4e8af4] hover:bg-[#4e8af4]/90 text-white gap-1.5"
              >
                {sync.isPending ? <RefreshCw className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                {sync.isPending ? 'Syncing…' : 'Refresh'}
              </Button>
            </div>

            {/* New task */}
            {showCreate && (
              <div className="rounded-xl border border-[#4e8af4]/25 bg-[#4e8af4]/[0.04] px-4 py-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-medium text-[#e8eaed]">New task in {mapping?.projectName}</span>
                  <button onClick={() => setShowCreate(false)} className="text-[#9aa0a6] hover:text-[#e8eaed]"><X className="size-4" /></button>
                </div>
                <Input
                  value={createForm.name}
                  onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
                  placeholder="Task name…"
                  className="bg-[#1a1d27] border-white/8 text-[#e8eaed] placeholder:text-[#9aa0a6]/60 h-9"
                  autoFocus
                />
                <div className="flex flex-wrap items-center gap-2">
                  <select value={createForm.sectionGid} onChange={(e) => setCreateForm((f) => ({ ...f, sectionGid: e.target.value }))} className={selectCls} style={selectBg}>
                    <option value="" className="bg-[#1a1d27]">No section</option>
                    {(sections ?? []).map((s) => <option key={s.gid} value={s.gid} className="bg-[#1a1d27]">{s.name}</option>)}
                  </select>
                  <select value={createForm.assigneeGid} onChange={(e) => setCreateForm((f) => ({ ...f, assigneeGid: e.target.value }))} className={selectCls} style={selectBg}>
                    <option value="" className="bg-[#1a1d27]">Unassigned</option>
                    {(users ?? []).map((u) => <option key={u.gid} value={u.gid} className="bg-[#1a1d27]">{u.name}</option>)}
                  </select>
                  <input
                    type="date"
                    value={createForm.dueOn}
                    onChange={(e) => setCreateForm((f) => ({ ...f, dueOn: e.target.value }))}
                    className="h-9 px-3 rounded-lg bg-[#1a1d27] border border-white/8 text-[13px] text-[#e8eaed] focus:outline-none focus:ring-1 focus:ring-[#4e8af4]/50"
                  />
                  <div className="flex-1" />
                  <Button onClick={handleCreate} disabled={!createForm.name.trim() || createTask.isPending} className="h-9 bg-[#4e8af4] hover:bg-[#4e8af4]/90 text-white gap-1.5">
                    {createTask.isPending ? <RefreshCw className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}Create
                  </Button>
                </div>
              </div>
            )}

            {/* Track an existing (outside-CMS) task by URL */}
            <div className="rounded-xl border border-white/8 bg-[#1a1d27]/40 px-4 py-3 flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 text-[13px] text-[#9aa0a6]">
                <Link2 className="size-4" /><span className="text-[#e8eaed]">Track an existing task</span>
              </div>
              <div className="flex-1 min-w-[240px]">
                <Input
                  value={trackUrl}
                  onChange={(e) => setTrackUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleTrack() }}
                  placeholder="Paste an Asana task URL (or GID) from this project…"
                  className="bg-[#1a1d27] border-white/8 text-[#e8eaed] placeholder:text-[#9aa0a6]/60 h-9"
                />
              </div>
              <Button
                onClick={handleTrack}
                disabled={!trackUrl.trim() || track.isPending}
                className="h-9 bg-[#4e8af4] hover:bg-[#4e8af4]/90 text-white gap-1.5 shrink-0"
              >
                {track.isPending ? <RefreshCw className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                Track
              </Button>
            </div>

            {/* Filters */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative max-w-xs flex-1 min-w-[220px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[#9aa0a6]" />
                <Input
                  value={search}
                  onChange={(e) => onSearch(e.target.value)}
                  placeholder="Filter by task or assignee…"
                  className="pl-9 bg-[#1a1d27] border-white/8 text-[#e8eaed] placeholder:text-[#9aa0a6]/60 h-9"
                />
              </div>
              <select value={section} onChange={(e) => { setSection(e.target.value); setCurrentPage(1) }} className={selectCls} style={selectBg}>
                <option value="" className="bg-[#1a1d27]">All sections</option>
                {(sections ?? []).map((s) => <option key={s.gid} value={s.gid} className="bg-[#1a1d27]">{s.name}</option>)}
              </select>
              <select value={completed} onChange={(e) => { setCompleted(e.target.value); setCurrentPage(1) }} className={selectCls} style={selectBg}>
                <option value="" className="bg-[#1a1d27]">All tasks</option>
                <option value="false" className="bg-[#1a1d27]">Incomplete</option>
                <option value="true" className="bg-[#1a1d27]">Completed</option>
              </select>
              <label className="inline-flex items-center gap-2 text-[13px] text-[#9aa0a6] cursor-pointer select-none">
                <input type="checkbox" checked={aiOnly} onChange={(e) => { setAiOnly(e.target.checked); setCurrentPage(1) }} className="accent-[#4e8af4]" />
                <Sparkles className="size-3.5" />AI-created
              </label>
            </div>

            {/* Table */}
            <div className="rounded-xl border border-white/8 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="border-white/8 hover:bg-transparent bg-[#1a1d27]">
                    <TableHead className="text-[11px] font-medium uppercase tracking-widest text-[#9aa0a6] h-10">Task</TableHead>
                    <TableHead className="text-[11px] font-medium uppercase tracking-widest text-[#9aa0a6] h-10">Status</TableHead>
                    <TableHead className="text-[11px] font-medium uppercase tracking-widest text-[#9aa0a6] h-10">Assignee</TableHead>
                    <TableHead className="text-[11px] font-medium uppercase tracking-widest text-[#9aa0a6] h-10">Due</TableHead>
                    <TableHead className="text-[11px] font-medium uppercase tracking-widest text-[#9aa0a6] h-10 w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tasksLoading ? (
                    [0, 1, 2, 3, 4].map((i) => (
                      <TableRow key={i} className="border-white/8 hover:bg-transparent">
                        {[280, 120, 120, 80, 24].map((w, j) => (
                          <TableCell key={j}><Skeleton className="h-4 bg-white/5 rounded" style={{ width: w }} /></TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : rows.length === 0 ? (
                    /* Empty state #3 — mapped, zero tasks (or no filter match) */
                    <TableRow className="border-white/8 hover:bg-transparent">
                      <TableCell colSpan={5}>
                        <div className="flex flex-col items-center justify-center py-14 gap-3">
                          <div className="size-12 rounded-xl bg-[#1a1d27] border border-white/8 flex items-center justify-center">
                            <CheckSquare className="size-6 text-[#9aa0a6]" />
                          </div>
                          <p className="text-[#9aa0a6] text-sm text-center max-w-sm">
                            {debouncedSearch || section || completed || aiOnly
                              ? 'No tasks match these filters.'
                              : 'No tracked tasks yet. Tasks you create from the CMS appear here — or paste an Asana task URL above to start tracking an existing one. (This page tracks only these tasks, not the whole Asana project.)'}
                          </p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((r: AsanaTask) => (
                      <TableRow
                        key={r.taskGid}
                        onClick={() => navigate(`/sites/${id}/tasks/${r.taskGid}`)}
                        className="border-white/8 transition-colors cursor-pointer hover:bg-white/[0.02]"
                      >
                        <TableCell className="max-w-[340px]">
                          <div className="flex items-center gap-2">
                            {r.origin === 'mcp' && (
                              <Sparkles className="size-3.5 text-violet-400 flex-shrink-0" aria-label="AI-created" />
                            )}
                            {r.origin === 'tracked' && (
                              <Link2 className="size-3.5 text-[#9aa0a6] flex-shrink-0" aria-label="Tracked (created outside CMS)" />
                            )}
                            <span className={`truncate max-w-[300px] text-[13px] ${r.completed ? 'text-[#9aa0a6] line-through' : 'text-[#e8eaed]'}`} title={r.name}>
                              {r.name}
                            </span>
                            {r.numSubtasks > 0 && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] text-[#9aa0a6] flex-shrink-0" title={`${r.numSubtasks} subtasks`}>
                                <ListTree className="size-3" />{r.numSubtasks}
                              </span>
                            )}
                            {r.linkedEntityType && (
                              <span className="text-[10px] text-[#4e8af4] flex-shrink-0" title={`Linked to ${r.linkedEntityType}`}>· {r.linkedEntityType}</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell><SectionChip name={r.sectionName} completed={r.completed} /></TableCell>
                        <TableCell>
                          {r.assigneeName ? (
                            <span className="inline-flex items-center gap-1.5 text-[12px] text-[#9aa0a6]">
                              <User className="size-3" />{r.assigneeName}
                            </span>
                          ) : (
                            <span className="text-[#9aa0a6]/40 text-[12px]">Unassigned</span>
                          )}
                        </TableCell>
                        <TableCell><DueDate dueOn={r.dueOn} completed={r.completed} /></TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()} className="w-16">
                          <div className="flex items-center gap-2.5 justify-end pr-1">
                            {r.permalinkUrl && (
                              <a href={r.permalinkUrl} target="_blank" rel="noopener noreferrer" title="Open in Asana" className="text-[#9aa0a6] hover:text-[#e8eaed]">
                                <ExternalLink className="size-3.5" />
                              </a>
                            )}
                            <button
                              onClick={() => handleUntrack(r.taskGid, r.name)}
                              disabled={untrack.isPending}
                              title="Stop tracking (keeps the task in Asana)"
                              className="text-[#9aa0a6] hover:text-red-300"
                            >
                              <Unlink className="size-3.5" />
                            </button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            {meta && meta.totalPages > 1 && (
              <div className="flex items-center justify-between text-[13px] text-[#9aa0a6]">
                <span>
                  Page <span className="text-[#e8eaed]">{meta.page}</span> of{' '}
                  <span className="text-[#e8eaed]">{meta.totalPages}</span>
                  {' · '}{meta.total.toLocaleString()} tasks{isFetching ? ' · updating…' : ''}
                </span>
                <div className="flex items-center gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage <= 1} className="h-7 px-2 text-[#9aa0a6] hover:text-[#e8eaed] disabled:opacity-30">
                    <ChevronLeft className="size-4" />Prev
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setCurrentPage((p) => Math.min(meta.totalPages, p + 1))} disabled={currentPage >= meta.totalPages} className="h-7 px-2 text-[#9aa0a6] hover:text-[#e8eaed] disabled:opacity-30">
                    Next<ChevronRight className="size-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
