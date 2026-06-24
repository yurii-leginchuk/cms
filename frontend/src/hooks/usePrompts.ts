import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { promptsApi } from '@/api/prompts'

export function usePrompts() {
  return useQuery({
    queryKey: ['prompts'],
    queryFn: promptsApi.list,
    staleTime: 60 * 1000,
  })
}

export function useSitePrompts(siteId: string) {
  return useQuery({
    queryKey: ['prompts', 'sites', siteId],
    queryFn: () => promptsApi.listForSite(siteId),
    enabled: !!siteId,
    staleTime: 60 * 1000,
  })
}

export function useUpsertPrompt() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ slug, content, name, model }: { slug: string; content: string; name?: string; model?: string | null }) =>
      promptsApi.upsert(slug, content, name, model),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prompts'] })
    },
  })
}

export function useUpsertSitePrompt(siteId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ slug, content }: { slug: string; content: string }) =>
      promptsApi.upsertForSite(siteId, slug, content),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prompts', 'sites', siteId] })
      qc.invalidateQueries({ queryKey: ['prompts'] })
    },
  })
}

export function useResetSitePrompt(siteId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (slug: string) => promptsApi.resetForSite(siteId, slug),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prompts', 'sites', siteId] })
    },
  })
}
