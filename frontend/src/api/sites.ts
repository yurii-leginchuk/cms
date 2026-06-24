import apiClient from './client'

export interface Site {
  id: string
  name: string
  url: string
  sitemapUrl: string
  favicon: string | null
  wpApiKey: string | null
  status: 'idle' | 'parsing' | 'done' | 'error'
  embeddingStatus: 'idle' | 'embedding' | 'done' | 'error'
  pagesTotal: number
  pagesProcessed: number
  lastParsedAt: string | null
  pagesCount: number
  createdAt: string
  updatedAt: string
}

export interface CreateSitePayload {
  name: string
  url: string
  sitemapUrl: string
}

export interface UpdateSitePayload {
  name?: string
  wpApiKey?: string | null
}

export interface SiteBrief {
  siteId?: string
  keywordCsv?: string | null
  clientNotes?: string | null
  pastPageExample?: string | null
  locations?: string | null
  spellingVariant?: string | null
  approvedCtas?: string | null
  complianceNotes?: string | null
  updatedAt?: string
}

export interface BrandCardServiceEntry {
  name: string
  slug?: string | null
  sourceUrl: string
  subServices: string[]
}
export interface BrandCardPersonEntry {
  name: string
  role?: string | null
  sourceUrl?: string | null
}
export interface BrandCardCtaEntry {
  label: string
  url?: string | null
  phone?: string | null
}
export interface BrandCard {
  siteId: string
  brandName: string | null
  spelling: string | null
  services: BrandCardServiceEntry[]
  locations: string[]
  people: BrandCardPersonEntry[]
  certifications: string[]
  approvedClaims: string[]
  neverSay: string[]
  ctas: BrandCardCtaEntry[]
  reviewed: boolean
  updatedAt?: string
}

export const sitesApi = {
  list: async (): Promise<Site[]> => {
    const { data } = await apiClient.get<{ data: Site[] }>('/api/sites')
    return data.data
  },

  get: async (id: string): Promise<Site> => {
    const { data } = await apiClient.get<{ data: Site }>(`/api/sites/${id}`)
    return data.data
  },

  create: async (payload: CreateSitePayload): Promise<Site> => {
    const { data } = await apiClient.post<{ data: Site }>('/api/sites', payload)
    return data.data
  },

  update: async (id: string, payload: UpdateSitePayload): Promise<Site> => {
    const { data } = await apiClient.patch<{ data: Site }>(`/api/sites/${id}`, payload)
    return data.data
  },

  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/api/sites/${id}`)
  },

  parse: async (id: string): Promise<void> => {
    await apiClient.post(`/api/sites/${id}/parse`)
  },

  wpStatus: async (id: string): Promise<{ connected: boolean; reason?: string }> => {
    const { data } = await apiClient.get<{ data: { connected: boolean; reason?: string } }>(
      `/api/sites/${id}/wp-status`,
    )
    return data.data
  },

  getBrief: async (id: string): Promise<SiteBrief | null> => {
    const { data } = await apiClient.get<{ data: SiteBrief | null }>(`/api/sites/${id}/brief`)
    return data.data
  },

  upsertBrief: async (id: string, payload: SiteBrief): Promise<SiteBrief> => {
    const { data } = await apiClient.put<{ data: SiteBrief }>(`/api/sites/${id}/brief`, payload)
    return data.data
  },

  getBrandCard: async (id: string): Promise<BrandCard | null> => {
    const { data } = await apiClient.get<{ data: BrandCard | null }>(`/api/sites/${id}/brand-card`)
    return data.data
  },

  deriveBrandCard: async (id: string, force = false): Promise<BrandCard> => {
    const { data } = await apiClient.post<{ data: BrandCard }>(`/api/sites/${id}/brand-card/derive`, { force })
    return data.data
  },

  upsertBrandCard: async (id: string, payload: Partial<BrandCard>): Promise<BrandCard> => {
    const { data } = await apiClient.put<{ data: BrandCard }>(`/api/sites/${id}/brand-card`, payload)
    return data.data
  },
}
