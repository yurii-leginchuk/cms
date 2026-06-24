import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { optimizationEffectsApi } from '@/api/optimizationEffects'

export function useOptimizationEffects(siteId: string, pageId?: string) {
  return useQuery({
    queryKey: ['optimization-effects', siteId, pageId ?? 'all'],
    queryFn: () => optimizationEffectsApi.list(siteId, pageId),
    enabled: !!siteId,
  })
}

export function useEffectQueries(siteId: string, id: string, enabled: boolean) {
  return useQuery({
    queryKey: ['effect-queries', siteId, id],
    queryFn: () => optimizationEffectsApi.queries(siteId, id),
    enabled: enabled && !!siteId && !!id,
    staleTime: 5 * 60_000,
  })
}

export function useMeasureEffect(siteId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => optimizationEffectsApi.measureNow(siteId, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['optimization-effects', siteId] })
    },
  })
}
