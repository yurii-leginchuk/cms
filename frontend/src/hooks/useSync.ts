import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { syncApi } from '@/api/sync'

export function useSyncStatus(siteId: string) {
  return useQuery({
    queryKey: ['sync-status', siteId],
    queryFn: () => syncApi.getStatus(siteId),
    enabled: !!siteId,
    refetchInterval: (query) => {
      const data = query.state.data
      if (!data) return 10_000
      // Poll fast while jobs are actively running; slow down when idle
      return data.syncing > 0 ? 2_000 : data.pending > 0 ? 5_000 : 30_000
    },
  })
}

export function useTriggerSync(siteId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => syncApi.trigger(siteId),
    onSuccess: () => {
      // Immediately refresh status and page list to reflect syncing state
      qc.invalidateQueries({ queryKey: ['sync-status', siteId] })
      qc.invalidateQueries({ queryKey: ['pages', siteId] })
    },
  })
}

/** Push a single page now (per-page Apply on the meta editor). */
export function useTriggerPageSync(siteId: string, pageId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => syncApi.triggerPage(siteId, pageId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sync-status', siteId] })
      qc.invalidateQueries({ queryKey: ['pages', siteId] })
      qc.invalidateQueries({ queryKey: ['page', siteId, pageId] })
    },
  })
}
