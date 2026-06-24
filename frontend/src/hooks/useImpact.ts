import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { impactApi, type SeriesParams } from '@/api/impact'

export function useImpactEvents(siteId: string, pageId?: string) {
  return useQuery({
    queryKey: ['impact-events', siteId, pageId ?? 'all'],
    queryFn: () => impactApi.events(siteId, pageId),
    enabled: !!siteId,
  })
}

export function useImpactSeries(siteId: string, params: SeriesParams, enabled = true) {
  return useQuery({
    queryKey: ['impact-series', siteId, params],
    queryFn: () => impactApi.series(siteId, params),
    enabled: enabled && !!siteId && (params.scope !== 'page' || !!params.pageUrl),
  })
}

export function useImpactPageQueries(
  siteId: string,
  params: { pageUrl: string; from: string; to: string; brand: 'all' | 'nonbranded' },
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['impact-page-queries', siteId, params],
    queryFn: () => impactApi.pageQueries(siteId, params),
    enabled: enabled && !!siteId && !!params.pageUrl,
    staleTime: 5 * 60_000,
  })
}

export function useCannibalization(
  siteId: string,
  params: { from: string; to: string; pageUrl?: string },
  enabled = true,
) {
  return useQuery({
    queryKey: ['cannibalization', siteId, params],
    queryFn: () => impactApi.cannibalization(siteId, params),
    enabled: enabled && !!siteId,
    staleTime: 5 * 60_000,
  })
}

export function useKeywordMonitoring(
  siteId: string,
  params: { from: string; to: string; pageId?: string },
) {
  return useQuery({
    queryKey: ['keyword-monitoring', siteId, params],
    queryFn: () => impactApi.monitorKeywords(siteId, params),
    enabled: !!siteId,
    staleTime: 5 * 60_000,
  })
}

export function useAddWatchedKeyword(siteId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Parameters<typeof impactApi.addKeyword>[1]) => impactApi.addKeyword(siteId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['keyword-monitoring', siteId] })
    },
  })
}

export function useRemoveWatchedKeyword(siteId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => impactApi.removeKeyword(siteId, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['keyword-monitoring', siteId] })
    },
  })
}

export function useImpactAnnotations(siteId: string) {
  return useQuery({
    queryKey: ['impact-annotations', siteId],
    queryFn: () => impactApi.listAnnotations(siteId),
    enabled: !!siteId,
  })
}

export function useCreateAnnotation(siteId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ date, label, pageId }: { date: string; label: string; pageId?: string | null }) =>
      impactApi.createAnnotation(siteId, date, label, pageId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['impact-annotations', siteId] }),
  })
}

export function useDeleteAnnotation(siteId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => impactApi.deleteAnnotation(siteId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['impact-annotations', siteId] }),
  })
}
