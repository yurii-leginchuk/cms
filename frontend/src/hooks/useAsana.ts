import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { asanaApi, type ListTasksParams } from '@/api/asana'

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

export function useTrackAsanaTask(siteId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (url: string) => asanaApi.track(siteId, url),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['asana-tasks', siteId] }),
  })
}
