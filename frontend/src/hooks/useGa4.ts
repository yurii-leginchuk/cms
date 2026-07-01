import { useQuery } from '@tanstack/react-query'
import { ga4Api } from '@/api/ga4'

export function useGa4Status(siteId: string | undefined) {
  return useQuery({
    queryKey: ['ga4-status', siteId],
    queryFn: () => ga4Api.status(siteId!),
    enabled: !!siteId,
    staleTime: 5 * 60 * 1000,
  })
}

export function useGa4Series(siteId: string | undefined, from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: ['ga4-series', siteId, from, to],
    queryFn: () => ga4Api.series(siteId!, from, to),
    enabled: !!siteId && enabled,
  })
}

export function useGa4Summary(siteId: string | undefined, from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: ['ga4-summary', siteId, from, to],
    queryFn: () => ga4Api.summary(siteId!, from, to),
    enabled: !!siteId && enabled,
  })
}
