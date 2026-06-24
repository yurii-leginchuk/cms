import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { pagesApi, UpdatePageMetaPayload } from '@/api/pages'


export function usePages(
  siteId: string,
  page = 1,
  limit = 50,
  search = '',
  isParsing = false,
  sort = 'url_asc',
) {
  return useQuery({
    queryKey: ['pages', siteId, page, limit, search, sort],
    queryFn: () => pagesApi.list(siteId, page, limit, search, sort),
    enabled: !!siteId,
    placeholderData: (prev) => prev,
    refetchInterval: isParsing ? 3000 : false,
  })
}

export function usePage(siteId: string, pageId: string | null) {
  return useQuery({
    queryKey: ['page', siteId, pageId],
    queryFn: () => pagesApi.get(siteId, pageId!),
    enabled: !!pageId && !!siteId,
    staleTime: 30_000,
  })
}

export function usePageHistory(siteId: string, pageId: string | null) {
  return useQuery({
    queryKey: ['page-history', pageId],
    queryFn: () => pagesApi.history(siteId, pageId!),
    enabled: !!pageId && !!siteId,
    staleTime: 0,
  })
}

export function useUpdatePageMeta(siteId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ pageId, payload }: { pageId: string; payload: UpdatePageMetaPayload }) =>
      pagesApi.update(siteId, pageId, payload),
    onSuccess: (_data, { pageId }) => {
      qc.invalidateQueries({ queryKey: ['pages', siteId] })
      qc.invalidateQueries({ queryKey: ['page-history', pageId] })
    },
  })
}

export function useGenerateMeta(siteId: string) {
  return useMutation({
    mutationFn: ({ pageId, promptSlug }: { pageId: string; promptSlug?: string }) =>
      pagesApi.generateMeta(siteId, pageId, promptSlug),
  })
}
