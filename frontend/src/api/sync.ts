import apiClient from './client'

export interface SyncStatusCounts {
  pending: number
  syncing: number
  synced: number
  failed: number
}

export const syncApi = {
  trigger: async (siteId: string): Promise<void> => {
    await apiClient.post(`/api/sites/${siteId}/sync`)
  },

  getStatus: async (siteId: string): Promise<SyncStatusCounts> => {
    const { data } = await apiClient.get<{ data: SyncStatusCounts }>(
      `/api/sites/${siteId}/sync/status`,
    )
    return data.data
  },
}
