import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { sitesApi, CreateSitePayload, UpdateSitePayload, SiteBrief } from '@/api/sites'

export function useSites() {
  return useQuery({
    queryKey: ['sites'],
    queryFn: sitesApi.list,
    refetchInterval: (query) => {
      const sites = query.state.data
      const hasActive = sites?.some(
        (s) => s.status === 'parsing' || s.embeddingStatus === 'embedding',
      )
      return hasActive ? 3000 : false
    },
  })
}

export function useSite(id: string) {
  return useQuery({
    queryKey: ['sites', id],
    queryFn: () => sitesApi.get(id),
    refetchInterval: (query) => {
      const s = query.state.data
      return s?.status === 'parsing' || s?.embeddingStatus === 'embedding' ? 3000 : false
    },
  })
}

export function useCreateSite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateSitePayload) => sitesApi.create(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sites'] }),
  })
}

export function useUpdateSite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateSitePayload }) =>
      sitesApi.update(id, payload),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['sites'] })
      qc.invalidateQueries({ queryKey: ['sites', id] })
    },
  })
}

export function useDeleteSite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => sitesApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sites'] }),
  })
}

export function useParseSite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => sitesApi.parse(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['sites'] })
      qc.invalidateQueries({ queryKey: ['sites', id] })
    },
  })
}

export function useSiteBrief(siteId: string) {
  return useQuery({
    queryKey: ['sites', siteId, 'brief'],
    queryFn: () => sitesApi.getBrief(siteId),
  })
}

export function useUpsertBrief(siteId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: SiteBrief) => sitesApi.upsertBrief(siteId, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sites', siteId, 'brief'] }),
  })
}

export function usePurgeCache(siteId: string) {
  return useMutation({
    mutationFn: () => sitesApi.purgeCache(siteId),
  })
}

export function useWpStatus(siteId: string) {
  return useQuery({
    queryKey: ['sites', siteId, 'wp-status'],
    queryFn: () => sitesApi.wpStatus(siteId),
    refetchInterval: 5 * 60 * 1000,
    staleTime: 60 * 1000,
    retry: false,
  })
}
