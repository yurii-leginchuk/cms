import apiClient from './client'

export type ChangeEventType = 'meta' | 'technical' | 'schema' | 'alt' | 'task' | 'manual'
export type ChangeEventCategory =
  | 'meta-title'
  | 'meta-description'
  | 'technical'
  | 'schema'
  | 'alt'
  | 'task'
  | 'manual'
export type ChangeEffectStatus = 'pending' | 'measured' | 'no_data'

export interface ChangeEvent {
  id: string
  type: ChangeEventType
  /** Finer bucket driving the per-category legend toggles (Phase 3). */
  category: ChangeEventCategory
  /** Time-based grouping id — events in one clusterId render as one marker. */
  clusterId: string
  subtype: string
  pageId: string | null
  pageUrl: string
  ts: string
  day: string
  precision: 'day' | 'timestamp'
  summary: string
  before: string | null
  after: string | null
  measurable: boolean
  effectStatus: ChangeEffectStatus | null
  effectId: string | null
  confoundedWith: number
  /** Task events only (Phase 2). */
  scope?: 'sitewide' | 'pages'
  taskUrl?: string | null
}

export type ImpactScope = 'global' | 'page'
export type BrandFilter = 'all' | 'nonbranded'

export interface SeriesPoint {
  date: string
  clicks: number
  impressions: number
  position: number
  provisional: boolean
  /** Merged-in GA4 organic metrics (present only when GA4 is connected). */
  sessions?: number
  conversions?: number
  revenue?: number
  users?: number
}

export interface ImpactSeries {
  scope: ImpactScope
  pageUrl: string | null
  brand: BrandFilter
  from: string
  to: string
  points: SeriesPoint[]
  total: { clicks: number; impressions: number; ctr: number; position: number }
  freshness: {
    through: string
    maxAvailable: string
    lagDays: number
    hasBrandSplit: boolean
    brandTermsCount: number
    fetchedAt: string | null
    stale?: string
  }
}

export interface SeriesParams {
  scope: ImpactScope
  pageUrl?: string
  from?: string
  to?: string
  brand?: BrandFilter
}

export interface ImpactAnnotation {
  id: string
  siteId: string
  /** null → site-wide external event; non-null → pinned to a single page. */
  pageId: string | null
  date: string
  label: string
  type?: string | null
  link?: string | null
  createdAt: string
}

export interface AnnotationInput {
  date: string
  label: string
  pageId?: string | null
  type?: string | null
  link?: string | null
}

export interface PageQueryCell {
  clicks: number
  impressions: number
  ctr: number
  position: number
}

export interface PageQueryRow {
  query: string
  isRemainder: boolean
  current: PageQueryCell | null
  previous: PageQueryCell | null
  isNew: boolean
  isLost: boolean
}

export interface PageQueries {
  pageUrl: string
  from: string
  to: string
  prevFrom: string
  prevTo: string
  brand: BrandFilter
  /** Disclosed query clicks ÷ page-total clicks per period (0..1), or null. */
  currentCoverage: number | null
  previousCoverage: number | null
  rows: PageQueryRow[]
}

export type WatchedKeywordSource = 'manual' | 'semrush'

export interface KeywordAggregate {
  clicks: number
  impressions: number
  /** Ratio 0..1 (multiply by 100 for percent). */
  ctr: number
  position: number
}

export interface KeywordPoint {
  date: string
  position: number
  clicks: number
  provisional: boolean
}

export interface WatchedKeywordMonitor {
  id: string
  query: string
  pageId: string | null
  pageUrl: string | null
  source: WatchedKeywordSource
  hasData: boolean
  current: KeywordAggregate
  previous: KeywordAggregate
  points: KeywordPoint[]
}

export interface KeywordMonitoring {
  from: string
  to: string
  prevFrom: string
  prevTo: string
  keywords: WatchedKeywordMonitor[]
}

export interface CreateWatchedKeyword {
  query: string
  pageId?: string | null
  pageUrl?: string | null
  source?: WatchedKeywordSource
}

export interface CompetingPage {
  page: string
  clicks: number
  impressions: number
  position: number
}

export interface CannibalConflict {
  query: string
  totalImpressions: number
  totalClicks: number
  competingPages: CompetingPage[]
}

export interface Cannibalization {
  from: string
  to: string
  pageUrl: string | null
  conflicts: CannibalConflict[]
}

export const impactApi = {
  events: async (siteId: string, pageId?: string): Promise<ChangeEvent[]> => {
    const { data } = await apiClient.get<{ data: ChangeEvent[] }>(
      `/api/sites/${siteId}/impact/events`,
      { params: pageId ? { pageId } : {} },
    )
    return data.data
  },

  series: async (siteId: string, params: SeriesParams): Promise<ImpactSeries> => {
    const { data } = await apiClient.get<{ data: ImpactSeries }>(
      `/api/sites/${siteId}/impact/series`,
      { params },
    )
    return data.data
  },

  pageQueries: async (
    siteId: string,
    params: { pageUrl: string; from: string; to: string; brand: BrandFilter },
  ): Promise<PageQueries> => {
    const { data } = await apiClient.get<{ data: PageQueries }>(
      `/api/sites/${siteId}/impact/queries`,
      { params },
    )
    return data.data
  },

  cannibalization: async (
    siteId: string,
    params: { from: string; to: string; pageUrl?: string },
  ): Promise<Cannibalization> => {
    const { data } = await apiClient.get<{ data: Cannibalization }>(
      `/api/sites/${siteId}/impact/cannibalization`,
      { params },
    )
    return data.data
  },

  monitorKeywords: async (
    siteId: string,
    params: { from: string; to: string; pageId?: string },
  ): Promise<KeywordMonitoring> => {
    const { data } = await apiClient.get<{ data: KeywordMonitoring }>(
      `/api/sites/${siteId}/impact/keywords/monitor`,
      { params },
    )
    return data.data
  },

  addKeyword: async (siteId: string, body: CreateWatchedKeyword): Promise<WatchedKeywordMonitor> => {
    const { data } = await apiClient.post<{ data: WatchedKeywordMonitor }>(
      `/api/sites/${siteId}/impact/keywords`, body,
    )
    return data.data
  },

  removeKeyword: async (siteId: string, id: string): Promise<void> => {
    await apiClient.delete(`/api/sites/${siteId}/impact/keywords/${id}`)
  },

  listAnnotations: async (siteId: string): Promise<ImpactAnnotation[]> => {
    const { data } = await apiClient.get<{ data: ImpactAnnotation[] }>(
      `/api/sites/${siteId}/impact/annotations`,
    )
    return data.data
  },

  createAnnotation: async (siteId: string, input: AnnotationInput): Promise<ImpactAnnotation> => {
    const { data } = await apiClient.post<{ data: ImpactAnnotation }>(
      `/api/sites/${siteId}/impact/annotations`, input,
    )
    return data.data
  },

  updateAnnotation: async (
    siteId: string, id: string, patch: Partial<AnnotationInput>,
  ): Promise<ImpactAnnotation> => {
    const { data } = await apiClient.patch<{ data: ImpactAnnotation }>(
      `/api/sites/${siteId}/impact/annotations/${id}`, patch,
    )
    return data.data
  },

  deleteAnnotation: async (siteId: string, id: string): Promise<void> => {
    await apiClient.delete(`/api/sites/${siteId}/impact/annotations/${id}`)
  },
}
