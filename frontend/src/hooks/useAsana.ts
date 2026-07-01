import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { asanaApi, type ListTasksParams, type CreateTaskInput, type UpdateTaskInput } from '@/api/asana'

// ── Global connection ─────────────────────────────────────────────────────────

export function useAsanaConnection() {
  return useQuery({ queryKey: ['asana-connection'], queryFn: () => asanaApi.connection() })
}

export function useSetAsanaPat() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (pat: string) => asanaApi.setConnection(pat),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['asana-connection'] }),
  })
}

export function useDisconnectAsana() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => asanaApi.disconnect(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['asana-connection'] }),
  })
}

export function useVerifyAsana() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => asanaApi.verify(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['asana-connection'] }),
  })
}

export function useSetAsanaWorkspace() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (workspaceGid: string) => asanaApi.setWorkspace(workspaceGid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['asana-connection'] })
      qc.invalidateQueries({ queryKey: ['asana-projects'] })
    },
  })
}

export function useAsanaProjects(enabled: boolean) {
  return useQuery({
    queryKey: ['asana-projects'],
    queryFn: () => asanaApi.projects(),
    enabled,
  })
}

export function useAsanaUsers(enabled: boolean) {
  return useQuery({
    queryKey: ['asana-users'],
    queryFn: () => asanaApi.users(),
    enabled,
  })
}

// ── Per-site ────────────────────────────────────────────────────────────────

export function useAsanaMapping(siteId: string | undefined) {
  return useQuery({
    queryKey: ['asana-mapping', siteId],
    queryFn: () => asanaApi.mapping(siteId!),
    enabled: !!siteId,
  })
}

export function useSetAsanaMapping(siteId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (projectGid: string) => asanaApi.setMapping(siteId, projectGid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['asana-mapping', siteId] })
      qc.invalidateQueries({ queryKey: ['asana-tasks', siteId] })
    },
  })
}

export function useAsanaSections(siteId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['asana-sections', siteId],
    queryFn: () => asanaApi.sections(siteId!),
    enabled: !!siteId && enabled,
  })
}

export function useAsanaTasks(siteId: string | undefined, params: ListTasksParams) {
  return useQuery({
    queryKey: ['asana-tasks', siteId, params],
    queryFn: () => asanaApi.tasks(siteId!, params),
    enabled: !!siteId,
    placeholderData: (prev) => prev,
  })
}

export function useAsanaTask(siteId: string | undefined, taskGid: string | undefined) {
  return useQuery({
    queryKey: ['asana-task', siteId, taskGid],
    queryFn: () => asanaApi.task(siteId!, taskGid!),
    enabled: !!siteId && !!taskGid,
  })
}

export function useSyncAsana(siteId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => asanaApi.sync(siteId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['asana-tasks', siteId] })
      qc.invalidateQueries({ queryKey: ['asana-mapping', siteId] })
    },
  })
}

export function useEstablishWebhook(siteId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => asanaApi.establishWebhook(siteId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['asana-mapping', siteId] }),
  })
}

export function useRemoveWebhook(siteId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => asanaApi.removeWebhook(siteId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['asana-mapping', siteId] }),
  })
}

export function useTrackAsanaTask(siteId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (url: string) => asanaApi.track(siteId, url),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['asana-tasks', siteId] }),
  })
}

// ── Phase 2 write mutations ───────────────────────────────────────────────────

function useTaskInvalidator(siteId: string) {
  const qc = useQueryClient()
  return (taskGid?: string) => {
    qc.invalidateQueries({ queryKey: ['asana-tasks', siteId] })
    if (taskGid) qc.invalidateQueries({ queryKey: ['asana-task', siteId, taskGid] })
  }
}

export function useCreateAsanaTask(siteId: string) {
  const invalidate = useTaskInvalidator(siteId)
  return useMutation({
    mutationFn: (input: CreateTaskInput) => asanaApi.createTask(siteId, input),
    onSuccess: () => invalidate(),
  })
}

export function useUpdateAsanaTask(siteId: string) {
  const invalidate = useTaskInvalidator(siteId)
  return useMutation({
    mutationFn: (vars: { taskGid: string; input: UpdateTaskInput }) =>
      asanaApi.updateTask(siteId, vars.taskGid, vars.input),
    onSuccess: (_d, vars) => invalidate(vars.taskGid),
  })
}

export function useUntrackAsanaTask(siteId: string) {
  const invalidate = useTaskInvalidator(siteId)
  return useMutation({
    mutationFn: (taskGid: string) => asanaApi.untrack(siteId, taskGid),
    onSuccess: (_d, taskGid) => invalidate(taskGid),
  })
}

export function useSetAsanaStatus(siteId: string) {
  const invalidate = useTaskInvalidator(siteId)
  return useMutation({
    mutationFn: (vars: { taskGid: string; sectionGid: string; completed?: boolean }) =>
      asanaApi.setStatus(siteId, vars.taskGid, vars.sectionGid, vars.completed),
    onSuccess: (_d, vars) => invalidate(vars.taskGid),
  })
}

export function useSetAsanaAssignee(siteId: string) {
  const invalidate = useTaskInvalidator(siteId)
  return useMutation({
    mutationFn: (vars: { taskGid: string; assigneeGid: string | null }) =>
      asanaApi.setAssignee(siteId, vars.taskGid, vars.assigneeGid),
    onSuccess: (_d, vars) => invalidate(vars.taskGid),
  })
}

export function useCreateAsanaSubtask(siteId: string) {
  const invalidate = useTaskInvalidator(siteId)
  return useMutation({
    mutationFn: (vars: { taskGid: string; input: CreateTaskInput }) =>
      asanaApi.createSubtask(siteId, vars.taskGid, vars.input),
    onSuccess: (_d, vars) => invalidate(vars.taskGid),
  })
}

export function useAsanaTaskScope(siteId: string | undefined, taskGid: string | undefined) {
  return useQuery({
    queryKey: ['asana-task-scope', siteId, taskGid],
    queryFn: () => asanaApi.getScope(siteId!, taskGid!),
    enabled: !!siteId && !!taskGid,
  })
}

export function useSetAsanaTaskScope(siteId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { taskGid: string; scope: 'sitewide' | 'pages' | null; pageIds: string[] }) =>
      asanaApi.setScope(siteId, vars.taskGid, vars.scope, vars.pageIds),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['asana-task-scope', siteId, vars.taskGid] })
      qc.invalidateQueries({ queryKey: ['asana-task', siteId, vars.taskGid] })
    },
  })
}

export function useLinkAsanaTask(siteId: string) {
  const invalidate = useTaskInvalidator(siteId)
  return useMutation({
    mutationFn: (vars: { taskGid: string; entityType: string | null; entityId: string | null }) =>
      asanaApi.linkTask(siteId, vars.taskGid, vars.entityType, vars.entityId),
    onSuccess: (_d, vars) => invalidate(vars.taskGid),
  })
}
