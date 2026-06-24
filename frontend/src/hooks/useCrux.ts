import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { cruxApi } from '../api/crux'

export function useCruxProgress(siteId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['crux-progress', siteId],
    queryFn: () => cruxApi.getProgress(siteId),
    refetchInterval: enabled ? 3000 : false,
    staleTime: 0,
  })
}

export function useCruxStats(siteId: string) {
  return useQuery({
    queryKey: ['crux-stats', siteId],
    queryFn: () => cruxApi.getStats(siteId),
    staleTime: 60_000,
  })
}

export function useCruxResults(siteId: string) {
  return useQuery({
    queryKey: ['crux-results', siteId],
    queryFn: () => cruxApi.getResults(siteId),
    staleTime: 60_000,
  })
}

export function useTriggerCruxFetch(siteId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => cruxApi.triggerFetch(siteId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crux-progress', siteId] })
    },
  })
}
