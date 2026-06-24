import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  briefsApi,
  CreateBriefPayload,
  UpdateBriefPayload,
} from '@/api/briefs'

export function useBriefs(siteId: string, pageId?: string) {
  return useQuery({
    queryKey: ['briefs', siteId, pageId ?? 'all'],
    queryFn: () => briefsApi.list(siteId, pageId),
    enabled: !!siteId,
  })
}

export function useBrief(siteId: string, id: string | null) {
  return useQuery({
    queryKey: ['briefs', siteId, 'one', id],
    queryFn: () => briefsApi.get(siteId, id!),
    enabled: !!siteId && !!id,
  })
}

export function useSaveBrief(siteId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateBriefPayload) => briefsApi.create(siteId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['briefs', siteId] })
    },
  })
}

export function useUpdateBrief(siteId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateBriefPayload }) =>
      briefsApi.update(siteId, id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['briefs', siteId] })
    },
  })
}

export function useDeleteBrief(siteId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => briefsApi.remove(siteId, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['briefs', siteId] })
    },
  })
}

export function useExportBrief(siteId: string) {
  return useMutation({
    mutationFn: (id: string) => briefsApi.export(siteId, id),
  })
}
