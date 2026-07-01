import { useQuery } from '@tanstack/react-query'
import { ga4Api } from '@/api/ga4'

export function useGa4Status(siteId: string | undefined) {
  return useQuery({
    queryKey: ['ga4-status', siteId],
    queryFn: async () => {
      const s = await ga4Api.status(siteId!)
      // reason 'error' = transient backend failure (quota/timeout), NOT "not set up".
      // Throw so react-query retries with backoff instead of caching a false "disconnected" for staleTime.
      if (!s.connected && s.reason === 'error') throw new Error('GA4 status temporarily unavailable')
      return s
    },
    enabled: !!siteId,
    staleTime: 5 * 60 * 1000,
    retry: 2,
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
