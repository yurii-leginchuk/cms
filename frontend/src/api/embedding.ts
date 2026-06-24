import apiClient from './client'

export interface EmbeddingStats {
  total: number
  embedded: number
  missing: number
}

export const embeddingApi = {
  generate: async (siteId: string): Promise<{ message: string }> => {
    const { data } = await apiClient.post<{ data: { message: string } }>(`/api/sites/${siteId}/embeddings`)
    return data.data
  },

  stats: async (siteId: string): Promise<EmbeddingStats> => {
    const { data } = await apiClient.get<{ data: EmbeddingStats }>(`/api/sites/${siteId}/embeddings`)
    return data.data
  },
}
