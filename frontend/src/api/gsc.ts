import apiClient from './client'

export interface GscStatus {
  connected: boolean
  email?: string
  path: string
}

export interface GscSiteStatus {
  connected: boolean
  property?: string
  reason?: 'no_credentials' | 'domain_not_found'
}

export const gscApi = {
  status: async (): Promise<GscStatus> => {
    const { data } = await apiClient.get<{ data: GscStatus }>('/api/gsc/status')
    return data.data
  },

  siteStatus: async (siteUrl: string): Promise<GscSiteStatus> => {
    const { data } = await apiClient.get<{ data: GscSiteStatus }>('/api/gsc/site-status', {
      params: { siteUrl },
    })
    return data.data
  },

  listProperties: async (): Promise<string[]> => {
    const { data } = await apiClient.get<{ data: string[] }>('/api/gsc/properties')
    return data.data
  },

  clearCache: async (siteId?: string): Promise<void> => {
    await apiClient.delete('/api/gsc/cache', { params: siteId ? { siteId } : {} })
  },
}
