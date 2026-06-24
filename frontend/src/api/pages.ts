import apiClient from './client'

export type PageSyncStatus = 'idle' | 'pending' | 'syncing' | 'synced' | 'failed'

export interface Page {
  id: string
  siteId: string
  url: string
  rawHtml: string | null
  cleanContent: string | null
  metaTitle: string | null
  metaDescription: string | null
  h1Text: string | null
  customMetaTitle: string | null
  customMetaDescription: string | null
  isTransactional: boolean
  noindex: boolean
  canonical: string | null
  syncStatus: PageSyncStatus
  syncError: string | null
  syncAppliedAt: string | null
  lastScrapedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface PagesListResponse {
  data: Page[]
  meta: {
    total: number
    page: number
    limit: number
    totalPages: number
  }
}

export interface UpdatePageMetaPayload {
  customMetaTitle?: string | null
  customMetaDescription?: string | null
  isTransactional?: boolean
  noindex?: boolean
  canonical?: string | null
  skipSync?: boolean
}

export interface MetaHistoryEntry {
  id: string
  pageId: string
  field: 'title' | 'description' | 'noindex' | 'canonical'
  oldValue: string | null
  newValue: string | null
  createdAt: string
}

export interface GenerateMetaResult {
  metaTitle: string | null
  metaDescription: string | null
  tokensUsed: number
}

export const pagesApi = {
  get: async (siteId: string, pageId: string): Promise<Page> => {
    const { data } = await apiClient.get<{ data: Page }>(
      `/api/sites/${siteId}/pages/${pageId}`,
    )
    return data.data
  },

  generateMeta: async (
    siteId: string,
    pageId: string,
    promptSlug?: string,
  ): Promise<GenerateMetaResult> => {
    const { data } = await apiClient.post<{ data: GenerateMetaResult }>(
      `/api/sites/${siteId}/pages/${pageId}/generate-meta`,
      { promptSlug },
    )
    return data.data
  },

  history: async (siteId: string, pageId: string): Promise<MetaHistoryEntry[]> => {
    const { data } = await apiClient.get<{ data: MetaHistoryEntry[] }>(
      `/api/sites/${siteId}/pages/${pageId}/history`,
    )
    return data.data
  },

  list: async (
    siteId: string,
    page = 1,
    limit = 50,
    search = '',
    sort = 'url_asc',
  ): Promise<PagesListResponse> => {
    const { data } = await apiClient.get<{ data: PagesListResponse }>(
      `/api/sites/${siteId}/pages`,
      { params: { page, limit, search, sort } },
    )
    return data.data
  },

  update: async (siteId: string, pageId: string, payload: UpdatePageMetaPayload): Promise<Page> => {
    const { data } = await apiClient.patch<{ data: Page }>(
      `/api/sites/${siteId}/pages/${pageId}`,
      payload,
    )
    return data.data
  },
}
