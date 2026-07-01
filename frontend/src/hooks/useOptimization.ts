import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import * as api from '@/api/optimization'

export function useOptimizationConfig(siteId: string) {
  return useQuery({
    queryKey: ['optimization-config', siteId],
    queryFn: () => api.getOptimizationConfig(siteId),
    enabled: !!siteId,
    staleTime: 30_000,
  })
}

export function useOptimizationStats(siteId: string) {
  return useQuery({
    queryKey: ['optimization-stats', siteId],
    queryFn: () => api.getOptimizationStats(siteId),
    enabled: !!siteId,
    staleTime: 15_000,
  })
}

export function useOptimizationImages(
  siteId: string,
  params: { page: number; limit: number; state?: string; search?: string },
) {
  return useQuery({
    queryKey: [
      'optimization-images',
      siteId,
      params.page,
      params.limit,
      params.state ?? '',
      params.search ?? '',
    ],
    queryFn: () => api.listOptimizationImages(siteId, params),
    enabled: !!siteId,
    staleTime: 10_000,
  })
}

export function useOptimizationRuns(siteId: string) {
  return useQuery({
    queryKey: ['optimization-runs', siteId],
    queryFn: () => api.listOptimizationRuns(siteId),
    enabled: !!siteId,
    staleTime: 15_000,
  })
}

/** Poll a run while it's active (mirrors the PageSpeed progress pattern). */
export function useOptimizationRun(
  siteId: string,
  runId: string | null,
  active: boolean,
) {
  return useQuery({
    queryKey: ['optimization-run', siteId, runId],
    queryFn: () => api.getOptimizationRun(siteId, runId!),
    enabled: !!siteId && !!runId,
    refetchInterval: active ? 2000 : false,
    staleTime: 0,
  })
}

function useInvalidateOptimization(siteId: string) {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: ['optimization-stats', siteId] })
    qc.invalidateQueries({ queryKey: ['optimization-images', siteId] })
    qc.invalidateQueries({ queryKey: ['optimization-runs', siteId] })
    qc.invalidateQueries({ queryKey: ['optimization-config', siteId] })
  }
}

export function useUpdateOptimizationConfig(siteId: string) {
  const invalidate = useInvalidateOptimization(siteId)
  return useMutation({
    mutationFn: (patch: api.UpdateOptimizationConfig) =>
      api.updateOptimizationConfig(siteId, patch),
    onSuccess: invalidate,
  })
}

export function useUpdateR2Config(siteId: string) {
  const invalidate = useInvalidateOptimization(siteId)
  return useMutation({
    mutationFn: (patch: api.UpdateR2Config) => api.updateR2Config(siteId, patch),
    onSuccess: invalidate,
  })
}

export function useCreateR2Bucket(siteId: string) {
  const invalidate = useInvalidateOptimization(siteId)
  return useMutation({
    mutationFn: (name: string | undefined) => api.createR2Bucket(siteId, name),
    onSuccess: invalidate,
  })
}

export function useTestR2Connection(siteId: string) {
  const invalidate = useInvalidateOptimization(siteId)
  return useMutation({
    mutationFn: () => api.testR2Connection(siteId),
    onSuccess: invalidate,
  })
}

export function useProvisionCdn(siteId: string) {
  const invalidate = useInvalidateOptimization(siteId)
  return useMutation({
    mutationFn: (body: { cdnDomain: string; cfZoneId: string }) => api.provisionCdn(siteId, body),
    onSuccess: invalidate,
  })
}

/** Poll the CDN provisioning status while it's pending; syncs into the config cache. */
export function useCdnStatus(siteId: string, active: boolean) {
  const qc = useQueryClient()
  return useQuery({
    queryKey: ['optimization-cdn-status', siteId],
    queryFn: async () => {
      const c = await api.getCdnStatus(siteId)
      qc.setQueryData(['optimization-config', siteId], c)
      return c
    },
    enabled: !!siteId && active,
    refetchInterval: active ? 5000 : false,
    staleTime: 0,
  })
}

export function useEnableRewrite(siteId: string) {
  const invalidate = useInvalidateOptimization(siteId)
  return useMutation({
    mutationFn: () => api.enableRewrite(siteId),
    onSuccess: invalidate,
  })
}

export function useDisableRewrite(siteId: string) {
  const invalidate = useInvalidateOptimization(siteId)
  return useMutation({
    mutationFn: () => api.disableRewrite(siteId),
    onSuccess: invalidate,
  })
}

export function useStartOptimizationRun(siteId: string) {
  const invalidate = useInvalidateOptimization(siteId)
  return useMutation({
    mutationFn: (scope: api.OptimizationScope) => api.startOptimizationRun(siteId, scope),
    onSuccess: invalidate,
  })
}

export function useCancelOptimizationRun(siteId: string) {
  return useMutation({
    mutationFn: (runId: string) => api.cancelOptimizationRun(siteId, runId),
  })
}

export function useReoptimizeImage(siteId: string) {
  const invalidate = useInvalidateOptimization(siteId)
  return useMutation({
    mutationFn: (imageId: string) => api.reoptimizeImage(siteId, imageId),
    onSuccess: invalidate,
  })
}
