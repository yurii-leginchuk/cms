import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { embeddingApi } from '@/api/embedding'

export function useEmbeddingStats(siteId: string) {
  return useQuery({
    queryKey: ['embedding-stats', siteId],
    queryFn: () => embeddingApi.stats(siteId),
    refetchInterval: 5000,
  })
}

export function useGenerateEmbeddings(siteId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => embeddingApi.generate(siteId),
    onSuccess: () => {
      // Refetch site so embeddingStatus: 'embedding' triggers polling
      qc.invalidateQueries({ queryKey: ['sites', siteId] })
      qc.invalidateQueries({ queryKey: ['sites'] })
    },
  })
}
