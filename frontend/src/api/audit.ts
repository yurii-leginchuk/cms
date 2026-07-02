import apiClient from './client'

export type AuditSeverity = 'critical' | 'warning' | 'notice'
export type AuditFindingStatus = 'open' | 'resolved' | 'muted' | 'accepted'
export type AuditDiffState = 'new' | 'persisting' | 'unconfirmed' | 'resolved' | null
export type AuditCheckType =
  | 'noindex_regression'
  | 'robots_txt_regression'
  | 'sitemap_broken'
  | 'money_page_regression'
  | 'soft_404_suspect'
  | 'https_regression'
  | 'canonical_hijack'

export interface DetectorCoverage {
  subjectsSelected: number
  subjectsEvaluated: number
  subjectsErrored: number
  subjectsTimedOut: number
  scopeComplete: boolean
}

export interface AuditFindingLite {
  id: string
  checkType: AuditCheckType
  severity: AuditSeverity
  status: AuditFindingStatus
  title: string
  fixRoute: string | null
  affectedCount: number
  diffState: AuditDiffState
}

export interface AuditSummary {
  hasRun: boolean
  running: boolean
  enabled: boolean
  liveFetchBudget: number
  detectorCatalog: { checkType: AuditCheckType; label: string; description: string; version: number }[]
  lastRun: {
    id: string
    trigger: string
    status: 'running' | 'complete' | 'partial' | 'failed'
    startedAt: string
    finishedAt: string | null
    coverage: Record<string, DetectorCoverage> | null
    detectorVersions: Record<string, number> | null
    liveFetchesUsed: number
    liveFetchBudget: number
    summary: {
      newCount: number
      resolvedCount: number
      persistingCount: number
      unconfirmedCount: number
      bySeverity: Record<AuditSeverity, number>
      pagesTotal: number
      pagesEvaluated: number
    } | null
    errorBreakdown: Record<string, number> | null
    fatalError: string | null
  } | null
  counts: {
    open: number
    muted: number
    accepted: number
    bySeverity: Record<AuditSeverity, number>
  }
  digest: {
    runId: string
    newCount: number
    resolvedCount: number
    persistingCount: number
    unconfirmedCount: number
    newFindings: AuditFindingLite[]
    resolvedFindings: AuditFindingLite[]
  } | null
  nextRunLabel: string
}

export interface AuditFindingRow {
  id: string
  checkType: AuditCheckType
  checkLabel: string
  severity: AuditSeverity
  status: AuditFindingStatus
  title: string
  subjectKey: string
  affectedCount: number
  firstSeenAt: string | null
  lastObservedAt: string | null
  lastEvaluatedAt: string | null
  resolvedAt: string | null
  fixRoute: string | null
  muteReason: string | null
  diffState: AuditDiffState
}

export interface AuditFindingDetail extends AuditFindingRow {
  evidence: Record<string, unknown> | null
  affectedUrls: { url: string; pageId?: string | null }[]
  mutedAt: string | null
  regressionCount: number
  detectorVersion: number
  resolutionBasis: string | null
  observations: {
    id: string
    runId: string
    observedStatus: 'present' | 'absent'
    observedAt: string
    detectorVersion: number
    rawSignal: Record<string, unknown> | null
  }[]
}

export interface AuditFindingList {
  data: AuditFindingRow[]
  meta: { page: number; limit: number; total: number; totalPages: number }
}

export interface AuditListParams {
  severity?: string
  checkType?: string
  status?: string
  diff?: string
  showMuted?: boolean
  search?: string
  page?: number
  limit?: number
}

export interface AuditSettings {
  enabled: boolean
  liveFetchBudget: number
  aiAnalysisEnabled: boolean
}

const BASE = (siteId: string) => `/api/sites/${siteId}/audit`

export const auditApi = {
  summary: async (siteId: string): Promise<AuditSummary> => {
    const { data } = await apiClient.get<{ data: AuditSummary }>(`${BASE(siteId)}/summary`)
    return data.data
  },

  findings: async (siteId: string, params: AuditListParams): Promise<AuditFindingList> => {
    const { data } = await apiClient.get<{ data: AuditFindingList }>(`${BASE(siteId)}/findings`, {
      params: { ...params, showMuted: params.showMuted ? 'true' : undefined },
    })
    return data.data
  },

  finding: async (siteId: string, id: string): Promise<AuditFindingDetail> => {
    const { data } = await apiClient.get<{ data: AuditFindingDetail }>(`${BASE(siteId)}/findings/${id}`)
    return data.data
  },

  mute: async (siteId: string, id: string, reason: string): Promise<AuditFindingRow> => {
    const { data } = await apiClient.post<{ data: AuditFindingRow }>(
      `${BASE(siteId)}/findings/${id}/mute`, { reason },
    )
    return data.data
  },

  unmute: async (siteId: string, id: string): Promise<AuditFindingRow> => {
    const { data } = await apiClient.post<{ data: AuditFindingRow }>(
      `${BASE(siteId)}/findings/${id}/unmute`,
    )
    return data.data
  },

  accept: async (siteId: string, id: string, reason?: string): Promise<AuditFindingRow> => {
    const { data } = await apiClient.post<{ data: AuditFindingRow }>(
      `${BASE(siteId)}/findings/${id}/accept`, { reason },
    )
    return data.data
  },

  runNow: async (siteId: string): Promise<{ started: boolean }> => {
    const { data } = await apiClient.post<{ data: { started: boolean } }>(`${BASE(siteId)}/run`)
    return data.data
  },

  settings: async (siteId: string): Promise<AuditSettings> => {
    const { data } = await apiClient.get<{ data: AuditSettings }>(`${BASE(siteId)}/settings`)
    return data.data
  },

  patchSettings: async (siteId: string, patch: Partial<AuditSettings>): Promise<AuditSettings> => {
    const { data } = await apiClient.patch<{ data: AuditSettings }>(`${BASE(siteId)}/settings`, patch)
    return data.data
  },
}
