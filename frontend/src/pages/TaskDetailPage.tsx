import { Link, useParams, Navigate } from 'react-router-dom'
import {
  ChevronLeft, ChevronRight, ExternalLink, CheckSquare, Sparkles, User,
  Calendar, CheckCircle2, Circle, ListTree,
} from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { RelativeClock } from '@/components/index-status/RelativeClock'
import { useSite } from '@/hooks/useSites'
import { useAsanaTask } from '@/hooks/useAsana'
import type { AsanaTask } from '@/api/asana'

function StatusPill({ name, completed }: { name: string | null; completed: boolean }) {
  return completed ? (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium border bg-emerald-400/10 text-emerald-300 border-emerald-400/25">
      <CheckCircle2 className="size-3.5" />{name || 'Done'}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium border bg-sky-400/10 text-sky-300 border-sky-400/25">
      <Circle className="size-3" />{name || 'No section'}
    </span>
  )
}

export default function TaskDetailPage() {
  const { id, taskGid } = useParams<{ id: string; taskGid: string }>()
  const { data: site } = useSite(id!)
  const { data: detail, isLoading, isError, error } = useAsanaTask(id, taskGid)

  if (!id || !taskGid) return <Navigate to="/sites" replace />

  const task = detail?.task
  const subtasks = detail?.subtasks ?? []

  return (
    <div className="min-h-full">
      {/* Header */}
      <div className="border-b border-white/8 px-8 py-5">
        <div className="flex items-center gap-1.5 text-[13px] mb-3">
          <Link to="/sites" className="text-[#9aa0a6] hover:text-[#e8eaed] flex items-center gap-1">
            <ChevronLeft className="size-3.5" />Sites
          </Link>
          <ChevronRight className="size-3.5 text-[#9aa0a6]/40" />
          <Link to={`/sites/${id}`} className="text-[#9aa0a6] hover:text-[#e8eaed]">{site?.name}</Link>
          <ChevronRight className="size-3.5 text-[#9aa0a6]/40" />
          <Link to={`/sites/${id}/tasks`} className="text-[#9aa0a6] hover:text-[#e8eaed]">Tasks</Link>
          <ChevronRight className="size-3.5 text-[#9aa0a6]/40" />
          <span className="text-[#e8eaed]">Detail</span>
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <CheckSquare className="size-5 text-rose-400 mt-0.5 flex-shrink-0" />
            {isLoading ? (
              <Skeleton className="h-6 w-72 bg-white/5" />
            ) : (
              <h1 className={`text-xl font-semibold tracking-tight ${task?.completed ? 'text-[#9aa0a6] line-through' : 'text-[#e8eaed]'}`}>
                {task?.name ?? 'Task'}
              </h1>
            )}
            {task?.origin === 'mcp' && (
              <span className="inline-flex items-center gap-1 text-[11px] text-violet-300 border border-violet-400/30 bg-violet-400/10 rounded-md px-1.5 py-0.5">
                <Sparkles className="size-3" />AI-created
              </span>
            )}
          </div>
          {task?.permalinkUrl && (
            <a href={task.permalinkUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[12px] text-[#9aa0a6] hover:text-[#e8eaed] flex-shrink-0">
              Open in Asana <ExternalLink className="size-3" />
            </a>
          )}
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
            {/* Meta row */}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <StatusPill name={task.sectionName} completed={task.completed} />
              <span className="inline-flex items-center gap-1.5 text-[13px] text-[#9aa0a6]">
                <User className="size-3.5" />{task.assigneeName ?? <span className="text-[#9aa0a6]/50">Unassigned</span>}
              </span>
              {task.dueOn && (
                <span className="inline-flex items-center gap-1.5 text-[13px] text-[#9aa0a6]">
                  <Calendar className="size-3.5" />Due {task.dueOn}
                </span>
              )}
              {task.linkedEntityType && (
                <span className="inline-flex items-center gap-1.5 text-[12px] text-[#4e8af4] border border-[#4e8af4]/25 bg-[#4e8af4]/10 rounded-md px-2 py-0.5">
                  Linked: {task.linkedEntityType}
                </span>
              )}
            </div>

            {/* Dual-clock freshness (honest: Asana's clock vs ours) */}
            <div className="flex flex-wrap items-center gap-x-8 gap-y-1 text-[12px] text-[#9aa0a6]">
              <span>Modified in Asana <RelativeClock ts={task.asanaModifiedAt} /></span>
              <span>Synced here <RelativeClock ts={task.lastSyncedAt} staleDays={1} /></span>
            </div>

            {/* Notes */}
            <div>
              <h2 className="text-[11px] font-medium uppercase tracking-widest text-[#9aa0a6] mb-2">Description</h2>
              {task.notes ? (
                <p className="text-[13px] text-[#e8eaed] whitespace-pre-wrap leading-relaxed rounded-xl border border-white/8 bg-[#1a1d27]/60 px-4 py-3">{task.notes}</p>
              ) : (
                <p className="text-[13px] text-[#9aa0a6]/60">No description.</p>
              )}
            </div>

            {/* Subtasks */}
            <div>
              <h2 className="text-[11px] font-medium uppercase tracking-widest text-[#9aa0a6] mb-2 inline-flex items-center gap-1.5">
                <ListTree className="size-3.5" />Subtasks {subtasks.length > 0 && <span className="text-[#e8eaed]">{subtasks.length}</span>}
              </h2>
              {subtasks.length === 0 ? (
                <p className="text-[13px] text-[#9aa0a6]/60">No subtasks.</p>
              ) : (
                <div className="rounded-xl border border-white/8 overflow-hidden divide-y divide-white/8">
                  {subtasks.map((st: AsanaTask) => (
                    <div key={st.taskGid} className="flex items-center gap-3 px-4 py-2.5">
                      {st.completed ? <CheckCircle2 className="size-4 text-emerald-400 flex-shrink-0" /> : <Circle className="size-4 text-[#9aa0a6]/50 flex-shrink-0" />}
                      <span className={`text-[13px] flex-1 truncate ${st.completed ? 'text-[#9aa0a6] line-through' : 'text-[#e8eaed]'}`} title={st.name}>{st.name}</span>
                      {st.assigneeName && <span className="text-[11px] text-[#9aa0a6]">{st.assigneeName}</span>}
                      {st.permalinkUrl && (
                        <a href={st.permalinkUrl} target="_blank" rel="noopener noreferrer" className="text-[#9aa0a6] hover:text-[#e8eaed]"><ExternalLink className="size-3" /></a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
