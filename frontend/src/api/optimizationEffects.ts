import apiClient from './client'

export type OptimizationEffectStatus = 'pending' | 'measured' | 'no_data'

export interface OptimizationEffect {
  id: string
  siteId: string
  pageId: string
  pageUrl: string
  changeSummary: string | null
  appliedAt: string
  baselineStart: string
  baselineEnd: string
  baselineClicks: number
  baselineImpressions: number
  baselineCtr: number
  baselinePosition: number
  baselineHasData: boolean
  resultStart: string | null
  resultEnd: string | null
  resultClicks: number | null
  resultImpressions: number | null
  resultCtr: number | null
  resultPosition: number | null
  measuredAt: string | null
  status: OptimizationEffectStatus
  createdAt: string
  updatedAt: string
}

export interface EffectQueryCell {
  clicks: number
  impressions: number
  ctr: number
  position: number
}

export interface EffectQueryRow {
  query: string
  isRemainder: boolean
  baseline: EffectQueryCell | null
  result: EffectQueryCell | null
  isNew: boolean
  isLost: boolean
}

export interface EffectQueries {
  effectId: string
  measured: boolean
  /** Disclosed query clicks ÷ page-total clicks per window (0..1), or null. */
  baselineCoverage: number | null
  resultCoverage: number | null
  rows: EffectQueryRow[]
}

export const optimizationEffectsApi = {
  list: async (siteId: string, pageId?: string): Promise<OptimizationEffect[]> => {
    const { data } = await apiClient.get<{ data: OptimizationEffect[] }>(
      `/api/sites/${siteId}/optimization-effects`,
      { params: pageId ? { pageId } : {} },
    )
    return data.data
  },

  measureNow: async (siteId: string, id: string): Promise<OptimizationEffect> => {
    const { data } = await apiClient.post<{ data: OptimizationEffect }>(
      `/api/sites/${siteId}/optimization-effects/${id}/measure`,
    )
    return data.data
  },

  queries: async (siteId: string, id: string): Promise<EffectQueries> => {
    const { data } = await apiClient.get<{ data: EffectQueries }>(
      `/api/sites/${siteId}/optimization-effects/${id}/queries`,
    )
    return data.data
  },
}
