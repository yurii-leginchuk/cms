import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { pagespeedApi, PsiStrategy, PsiScanMode } from '../api/pagespeed'

export function usePsiProgress(siteId: string, strategy: PsiStrategy, enabled: boolean) {
  return useQuery({
    queryKey: ['psi-progress', siteId, strategy],
    queryFn: () => pagespeedApi.getProgress(siteId, strategy),
    refetchInterval: enabled ? 3000 : false,
    staleTime: 0,
  })
}

export function usePsiStats(siteId: string, strategy: PsiStrategy) {
  return useQuery({
    queryKey: ['psi-stats', siteId, strategy],
    queryFn: () => pagespeedApi.getStats(siteId, strategy),
    staleTime: 30_000,
  })
}

export function usePsiResults(siteId: string, strategy: PsiStrategy) {
  return useQuery({
    queryKey: ['psi-results', siteId, strategy],
    queryFn: () => pagespeedApi.getResults(siteId, strategy),
    staleTime: 30_000,
  })
}

export function usePsiPageHistory(siteId: string, pageId: string | null, strategy: PsiStrategy) {
  return useQuery({
    queryKey: ['psi-history', pageId, strategy],
    queryFn: () => pagespeedApi.getPageHistory(siteId, pageId!, strategy),
    enabled: !!pageId,
    staleTime: 30_000,
  })
}

export function useTriggerScan(siteId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ strategy, mode = 'all' }: { strategy: PsiStrategy; mode?: PsiScanMode }) =>
      pagespeedApi.triggerScan(siteId, strategy, mode),
    onSuccess: (_, { strategy }) => {
      qc.invalidateQueries({ queryKey: ['psi-progress', siteId, strategy] })
    },
  })
}
