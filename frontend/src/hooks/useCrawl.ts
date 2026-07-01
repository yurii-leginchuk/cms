import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { crawlApi, type ListParams } from '@/api/crawl'

export function useCrawlSummary(siteId: string | undefined, live = false) {
  return useQuery({
    queryKey: ['crawl-summary', siteId],
    queryFn: () => crawlApi.summary(siteId!),
    enabled: !!siteId,
    refetchInterval: live ? 4000 : false,
  })
}

export function useCrawlPages(siteId: string | undefined, params: ListParams, live = false) {
  return useQuery({
    queryKey: ['crawl-pages', siteId, params],
    queryFn: () => crawlApi.pages(siteId!, params),
    enabled: !!siteId,
    placeholderData: (prev) => prev,
    refetchInterval: live ? 4000 : false,
  })
}

export function useCrawlPage(siteId: string | undefined, pageId: string | undefined) {
  return useQuery({
    queryKey: ['crawl-page', siteId, pageId],
    queryFn: () => crawlApi.page(siteId!, pageId!),
    enabled: !!siteId && !!pageId,
  })
}

export function useCrawlHistory(siteId: string | undefined, pageId: string | undefined) {
  return useQuery({
    queryKey: ['crawl-history', siteId, pageId],
    queryFn: () => crawlApi.history(siteId!, pageId!),
    enabled: !!siteId && !!pageId,
  })
}

export function useCrawlLatestDigest(siteId: string | undefined, live = false) {
  return useQuery({
    queryKey: ['crawl-digest', siteId],
    queryFn: () => crawlApi.latestDigest(siteId!),
    enabled: !!siteId,
    refetchInterval: live ? 4000 : false,
  })
}

export function useCrawlChanges(siteId: string | undefined, params: { limit?: number; days?: number; deindexOnly?: boolean } = {}) {
  return useQuery({
    queryKey: ['crawl-changes', siteId, params],
    queryFn: () => crawlApi.recentChanges(siteId!, params),
    enabled: !!siteId,
  })
}

export function useSitemapInfo(siteId: string | undefined) {
  return useQuery({
    queryKey: ['crawl-sitemap', siteId],
    queryFn: () => crawlApi.sitemap(siteId!),
    enabled: !!siteId,
  })
}

export function useResubmitSitemap(siteId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => crawlApi.resubmitSitemap(siteId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['crawl-sitemap', siteId] }),
  })
}

export function useInspectPages(siteId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (pageIds: string[]) => crawlApi.inspect(siteId, pageIds),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crawl-summary', siteId] })
      qc.invalidateQueries({ queryKey: ['crawl-pages', siteId] })
      qc.invalidateQueries({ queryKey: ['crawl-page', siteId] })
      qc.invalidateQueries({ queryKey: ['crawl-digest', siteId] })
      qc.invalidateQueries({ queryKey: ['crawl-changes', siteId] })
    },
  })
}
