import apiClient from './client'

export type CruxFormFactor = 'PHONE' | 'DESKTOP'
export type CwvCategory = 'good' | 'needs_improvement' | 'poor' | null

export interface CruxMetrics {
  hasData: boolean
  isOriginFallback: boolean
  lcpP75: number | null
  clsP75: number | null
  fcpP75: number | null
  inpP75: number | null
  ttfbP75: number | null
  lcpCategory: CwvCategory
  clsCategory: CwvCategory
  fcpCategory: CwvCategory
  inpCategory: CwvCategory
  fetchedAt: string
}

export interface CruxPageResult {
  pageId: string
  url: string
  phone: CruxMetrics | null
  desktop: CruxMetrics | null
}

export interface CruxTally {
  good: number
  ni: number
  poor: number
  noData: number
}

export interface CruxStats {
  phone: CruxTally
  desktop: CruxTally
  lastFetchedAt: string | null
}

export interface CruxProgress {
  isRunning: boolean
  total: number
  completed: number
}

const unwrap = (res: any) => res.data?.data ?? res.data
const base = (siteId: string) => `/api/sites/${siteId}/crux`

export const cruxApi = {
  triggerFetch: (siteId: string) =>
    apiClient.post(`${base(siteId)}/fetch`, {}).then(unwrap),

  getProgress: (siteId: string): Promise<CruxProgress> =>
    apiClient.get(`${base(siteId)}/progress`).then(unwrap),

  getResults: (siteId: string): Promise<CruxPageResult[]> =>
    apiClient.get(`${base(siteId)}/results`).then(unwrap),

  getStats: (siteId: string): Promise<CruxStats> =>
    apiClient.get(`${base(siteId)}/stats`).then(unwrap),
}
