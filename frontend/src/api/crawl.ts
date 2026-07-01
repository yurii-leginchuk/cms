import apiClient from './client'

export type DerivedStatus =
  | 'indexed'
  | 'crawled_not_indexed'
  | 'discovered_not_indexed'
  | 'excluded_noindex'
  | 'blocked_robots'
  | 'canonical_alternate'
  | 'redirect'
  | 'not_found'
  | 'soft_404'
  | 'server_error'
  | 'forbidden'
  | 'unknown_to_google'
  | 'unknown'

export interface CrawlQuotaState {
  property: string
  quotaDate: string
  used: number
  capDaily: number
  budgetNightly: number
  remainingDaily: number
  remainingNightly: number
}

export interface CrawlSummary {
  connected: boolean
  connectionReason: string | null
  property: string | null
  propertyType: 'sc_domain' | 'url_prefix' | null
  coverage: {
    total: number
    inspected: number
    neverChecked: number
    indexed: number
    notIndexed: number
    unknown: number
    canonicalConflicts: number
    byStatus: Record<string, number>
  }
  freshness: {
    oldestInspectedAt: string | null
    newestInspectedAt: string | null
    medianAgeDays: number | null
    inspectedCount: number
  }
  quota: CrawlQuotaState | null
  lastRun: {
    id: string
    trigger: string
    startedAt: string
    finishedAt: string | null
    pagesInspected: number
    pagesChanged: number
    pagesErrored: number
    pagesSkippedQuota: number
  } | null
}

export interface CrawlPageRow {
  pageId: string
  url: string
  isTransactional: boolean
  derivedStatus: DerivedStatus | null
  isIndexed: boolean | null
  coverageStateRaw: string | null
  verdict: string | null
  indexingState: string | null
  robotsTxtState: string | null
  pageFetchState: string | null
  crawledAs: string | null
  googleCanonical: string | null
  userCanonical: string | null
  canonicalConflict: boolean
  googleLastCrawlTime: string | null
  lastInspectedAt: string | null
  lastError: string | null
}

export interface CrawlPageList {
  data: CrawlPageRow[]
  meta: { page: number; limit: number; total: number; totalPages: number }
}

export interface CrawlPageDetail {
  pageId: string
  url: string
  isTransactional: boolean
  declaredCanonical: string | null
  status: (CrawlPageRow & {
    stateHash: string | null
    mappingVersion: number
    apiVersion: string | null
    firstSeenAt: string | null
  }) | null
  latest: {
    observedAt: string
    inspectionResultLink: string | null
    rawPayload: unknown
  } | null
}

export interface CrawlHistoryEntry {
  id: string
  observedAt: string
  derivedStatus: DerivedStatus | null
  isIndexed: boolean | null
  coverageStateRaw: string | null
  canonicalConflict: boolean
  googleLastCrawlTime: string | null
  isFirstSeen: boolean
  isDeindexation: boolean
}

export interface InspectResult {
  property: string
  requested: number
  granted: number
  results: Array<{ pageId: string; url: string; ok: boolean; changed?: boolean; error?: string }>
}

export type ChangeCategory =
  | 'first_seen'
  | 'deindexed'
  | 'reindexed'
  | 'became_unknown'
  | 'status_change'

export interface ChangeItem {
  id: string
  url: string
  observedAt: string
  from: DerivedStatus | null
  to: DerivedStatus | null
  category: ChangeCategory
  isIndexed: boolean | null
  runId: string | null
}

export interface ChangeDigest {
  runId: string | null
  trigger: string | null
  startedAt: string | null
  finishedAt: string | null
  pagesInspected: number
  pagesChanged: number
  hasChanges: boolean
  categories: Record<ChangeCategory, number>
  highlights: ChangeItem[]
}

export interface GscSitemapRow {
  path: string
  lastSubmitted?: string
  lastDownloaded?: string
  isPending?: boolean
  warnings?: string
  errors?: string
}

export interface SitemapInfo {
  connected: boolean
  reason?: string
  property?: string
  siteSitemapUrl: string | null
  sitemaps?: GscSitemapRow[]
}

export interface ListParams {
  page?: number
  limit?: number
  search?: string
  segment?: string
  freshness?: string
  canonicalConflict?: boolean
  sort?: string
}

const BASE = (siteId: string) => `/api/sites/${siteId}/index-status`

export const crawlApi = {
  summary: async (siteId: string): Promise<CrawlSummary> => {
    const { data } = await apiClient.get<{ data: CrawlSummary }>(`${BASE(siteId)}/summary`)
    return data.data
  },

  pages: async (siteId: string, params: ListParams): Promise<CrawlPageList> => {
    const { data } = await apiClient.get<{ data: CrawlPageList }>(`${BASE(siteId)}/pages`, {
      params: { ...params, canonicalConflict: params.canonicalConflict ? 'true' : undefined },
    })
    return data.data
  },

  page: async (siteId: string, pageId: string): Promise<CrawlPageDetail> => {
    const { data } = await apiClient.get<{ data: CrawlPageDetail }>(`${BASE(siteId)}/pages/${pageId}`)
    return data.data
  },

  history: async (siteId: string, pageId: string): Promise<CrawlHistoryEntry[]> => {
    const { data } = await apiClient.get<{ data: CrawlHistoryEntry[] }>(
      `${BASE(siteId)}/pages/${pageId}/history`,
    )
    return data.data
  },

  quota: async (siteId: string): Promise<CrawlQuotaState & { connected: boolean }> => {
    const { data } = await apiClient.get<{ data: CrawlQuotaState & { connected: boolean } }>(
      `${BASE(siteId)}/quota`,
    )
    return data.data
  },

  inspect: async (siteId: string, pageIds: string[]): Promise<InspectResult> => {
    const { data } = await apiClient.post<{ data: InspectResult }>(`${BASE(siteId)}/inspect`, { pageIds })
    return data.data
  },

  latestDigest: async (siteId: string): Promise<ChangeDigest | null> => {
    const { data } = await apiClient.get<{ data: ChangeDigest | null }>(`${BASE(siteId)}/changes/latest`)
    return data.data
  },

  recentChanges: async (
    siteId: string,
    params: { limit?: number; days?: number; deindexOnly?: boolean } = {},
  ): Promise<ChangeItem[]> => {
    const { data } = await apiClient.get<{ data: ChangeItem[] }>(`${BASE(siteId)}/changes`, {
      params: { ...params, deindexOnly: params.deindexOnly ? 'true' : undefined },
    })
    return data.data
  },

  sitemap: async (siteId: string): Promise<SitemapInfo> => {
    const { data } = await apiClient.get<{ data: SitemapInfo }>(`${BASE(siteId)}/sitemap`)
    return data.data
  },

  resubmitSitemap: async (
    siteId: string,
  ): Promise<{ ok: boolean; property: string; sitemapUrl: string; submittedAt: string }> => {
    const { data } = await apiClient.post<{ data: { ok: boolean; property: string; sitemapUrl: string; submittedAt: string } }>(
      `${BASE(siteId)}/sitemap/resubmit`,
    )
    return data.data
  },
}
