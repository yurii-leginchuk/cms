import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { gscApi } from '@/api/gsc'

export function useGscStatus() {
  return useQuery({
    queryKey: ['gsc-status'],
    queryFn: gscApi.status,
    retry: false,
  })
}

export function useGscSiteStatus(siteUrl: string | undefined) {
  return useQuery({
    queryKey: ['gsc-site-status', siteUrl],
    queryFn: () => gscApi.siteStatus(siteUrl!),
    enabled: !!siteUrl,
    retry: false,
    staleTime: 5 * 60 * 1000,
  })
}

export function useGscProperties() {
  return useQuery({
    queryKey: ['gsc-properties'],
    queryFn: gscApi.listProperties,
    enabled: false,
    retry: false,
  })
}

export function useClearGscCache(siteId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => gscApi.clearCache(siteId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['gsc-status'] }),
  })
}
