import apiClient from './client'

export interface Ga4Status {
  connected: boolean
  propertyId?: string
  displayName?: string
  streamUri?: string
  reason?: 'no_credentials' | 'property_not_found' | 'access_denied' | 'error'
}

export interface Ga4SeriesPoint {
  date: string
  sessions: number
  conversions: number
  revenue: number
  users: number
}

export interface Ga4Summary {
  sessions: number
  conversions: number
  revenue: number
  users: number
}

const BASE = (siteId: string) => `/api/sites/${siteId}/ga4`

export const ga4Api = {
  status: async (siteId: string): Promise<Ga4Status> => {
    const { data } = await apiClient.get<{ data: Ga4Status }>(`${BASE(siteId)}/status`)
    return data.data
  },
  series: async (siteId: string, from: string, to: string): Promise<Ga4SeriesPoint[]> => {
    const { data } = await apiClient.get<{ data: Ga4SeriesPoint[] }>(`${BASE(siteId)}/series`, { params: { from, to } })
    return data.data
  },
  summary: async (siteId: string, from: string, to: string): Promise<Ga4Summary> => {
    const { data } = await apiClient.get<{ data: Ga4Summary }>(`${BASE(siteId)}/summary`, { params: { from, to } })
    return data.data
  },
}
