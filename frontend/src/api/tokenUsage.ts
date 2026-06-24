import apiClient from './client'

export interface UsageStats {
  totalTokens: number
  totalCostUsd: number
  byFeature: { feature: string; tokens: number; costUsd: number; calls: number }[]
  byModel: { model: string; tokens: number; costUsd: number; calls: number }[]
  daily: { date: string; tokens: number; costUsd: number }[]
  jinaQuota: { remaining: number; limit: number } | null
}

export const tokenUsageApi = {
  getStats: async (params: { days?: number; siteId?: string } = {}): Promise<UsageStats> => {
    const { data } = await apiClient.get<{ data: UsageStats }>('/api/token-usage/stats', { params })
    return data.data
  },
}
