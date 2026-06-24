import apiClient from './client'

export type SchemaSource = 'yoast' | 'poirier' | 'plugin' | 'unknown'
export type SchemaValidity = 'valid' | 'warnings' | 'errors'

export interface SchemaIssue {
  severity: 'error' | 'warning'
  path: string
  message: string
}

export interface DetectedSchema {
  scriptIndex: number
  nodeIndex: number
  type: string
  source: SchemaSource
  validity: SchemaValidity
  issues: SchemaIssue[]
  json: unknown
}

export interface SchemaParseError {
  scriptIndex: number
  message: string
  snippet: string
}

export interface SchemaDetectionResult {
  schemas: DetectedSchema[]
  parseErrors: SchemaParseError[]
  summary: {
    total: number
    valid: number
    warnings: number
    errors: number
    bySource: Record<SchemaSource, number>
  }
}

export interface SchemaState {
  result: SchemaDetectionResult | null
  checkedAt: string | null
}

export type SchemaProposalKind = 'add' | 'fix' | 'drift'

export interface SchemaProposal {
  id: string
  kind: SchemaProposalKind
  type: string
  jsonld: unknown
  rationale: string
  evidence: string[]
  unverifiedClaims: string[]
  forbidden: boolean
  validation: { validity: SchemaValidity; issues: SchemaIssue[] }
  targetScriptIndex: number | null
  targetNodeIndex: number | null
  /** Set when the proposal improves an existing CMS-managed schema. */
  targetManagedId: string | null
  before: unknown | null
  /** Server-computed, trustworthy diff vs `before` (fix/drift only). */
  changeSummary: string[]
}

export interface JsonLdValidation {
  ok: boolean
  parseError: string | null
  nodes: { type: string; validity: SchemaValidity; issues: SchemaIssue[] }[]
  validity: SchemaValidity
}

export type PageSchemaStatus = 'synced' | 'modified' | 'removed'
export type PageSchemaSource = 'ai_generated' | 'ai_fixed' | 'human' | 'imported'

export interface ManagedSchema {
  id: string
  siteId: string
  pageId: string
  type: string
  jsonld: unknown
  status: PageSchemaStatus
  source: PageSchemaSource
  validationStatus: SchemaValidity | 'unvalidated'
  validationResult: SchemaIssue[]
  aiRationale: string | null
  evidence: string[]
  unverifiedClaims: string[]
  lastPublishedAt: string | null
  publishError: string | null
  createdAt: string
  updatedAt: string
}

export interface SchemaHistoryEntry {
  id: string
  siteId: string
  pageId: string
  snapshot: { type: string; jsonld: unknown }[]
  count: number
  createdAt: string
}

export type QcStatus = 'in_sync' | 'not_stored' | 'not_rendered' | 'unmanaged'

export interface QcItem {
  type: string
  inManaged: boolean
  inStored: boolean
  inLive: boolean
  status: QcStatus
}

export interface QcReport {
  checkedAt: string
  liveUrl: string
  pluginReachable: boolean
  pluginError: string | null
  liveError: string | null
  items: QcItem[]
  summary: { inSync: number; issues: number }
  liveTotals: { total: number; errors: number; warnings: number } | null
}

export interface SchemaCoverage {
  pagesTotal: number
  checked: number
  withSchema: number
  withErrors: number
  publishedPages: number
  pendingChanges: number
}

export interface SchemaPageOverview {
  pageId: string
  url: string
  checkedAt: string | null
  detected: SchemaDetectionResult['summary'] | null
  schemas: { type: string; source: SchemaSource; validity: SchemaValidity }[]
  managedCount: number
  pendingCount: number
}

export interface SchemaPagesResponse {
  data: SchemaPageOverview[]
  meta: { total: number; page: number; limit: number; totalPages: number }
}

export type PendingAction = 'add' | 'edit' | 'remove'

export interface PendingSummaryItem {
  schemaId: string
  type: string
  action: PendingAction
  source: PageSchemaSource
  validationStatus: SchemaValidity | 'unvalidated'
}

export interface PendingSummaryPage {
  pageId: string
  url: string
  items: PendingSummaryItem[]
}

export interface PendingSummary {
  totalPages: number
  totalChanges: number
  totalAdds: number
  totalEdits: number
  totalRemoves: number
  schemasWithErrors: number
  pages: PendingSummaryPage[]
}

export interface ApplyAllPageResult {
  pageId: string
  url: string
  published: number
  error?: string
}

export interface ApplyAllResult {
  applied: number
  failed: number
  perPage: ApplyAllPageResult[]
}

export interface CreateManagedPayload {
  type: string
  jsonld: unknown
  source?: PageSchemaSource
  status?: PageSchemaStatus
  aiRationale?: string | null
  evidence?: string[]
  unverifiedClaims?: string[]
}

export interface UpdateManagedPayload {
  type?: string
  jsonld?: unknown
  status?: PageSchemaStatus
}

export const schemaApi = {
  get: async (siteId: string, pageId: string): Promise<SchemaState> => {
    const { data } = await apiClient.get<{ data: SchemaState }>(
      `/api/sites/${siteId}/pages/${pageId}/schemas`,
    )
    return data.data
  },

  detect: async (siteId: string, pageId: string): Promise<SchemaDetectionResult> => {
    const { data } = await apiClient.post<{ data: SchemaDetectionResult }>(
      `/api/sites/${siteId}/pages/${pageId}/schemas/detect`,
    )
    return data.data
  },

  analyze: async (
    siteId: string,
    pageId: string,
  ): Promise<{ proposals: SchemaProposal[] }> => {
    const { data } = await apiClient.post<{ data: { proposals: SchemaProposal[] } }>(
      `/api/sites/${siteId}/pages/${pageId}/schemas/analyze`,
    )
    return data.data
  },

  validate: async (
    siteId: string,
    pageId: string,
    jsonld: unknown,
  ): Promise<JsonLdValidation> => {
    const { data } = await apiClient.post<{ data: JsonLdValidation }>(
      `/api/sites/${siteId}/pages/${pageId}/schemas/validate`,
      { jsonld },
    )
    return data.data
  },

  listManaged: async (siteId: string, pageId: string): Promise<ManagedSchema[]> => {
    const { data } = await apiClient.get<{ data: ManagedSchema[] }>(
      `/api/sites/${siteId}/pages/${pageId}/schemas/managed`,
    )
    return data.data
  },

  createManaged: async (
    siteId: string,
    pageId: string,
    payload: CreateManagedPayload,
  ): Promise<ManagedSchema> => {
    const { data } = await apiClient.post<{ data: ManagedSchema }>(
      `/api/sites/${siteId}/pages/${pageId}/schemas/managed`,
      payload,
    )
    return data.data
  },

  updateManaged: async (
    siteId: string,
    pageId: string,
    schemaId: string,
    payload: UpdateManagedPayload,
  ): Promise<ManagedSchema> => {
    const { data } = await apiClient.put<{ data: ManagedSchema }>(
      `/api/sites/${siteId}/pages/${pageId}/schemas/managed/${schemaId}`,
      payload,
    )
    return data.data
  },

  deleteManaged: async (
    siteId: string,
    pageId: string,
    schemaId: string,
  ): Promise<void> => {
    await apiClient.delete(
      `/api/sites/${siteId}/pages/${pageId}/schemas/managed/${schemaId}`,
    )
  },

  pending: async (
    siteId: string,
    pageId: string,
  ): Promise<{ pending: number }> => {
    const { data } = await apiClient.get<{ data: { pending: number } }>(
      `/api/sites/${siteId}/pages/${pageId}/schemas/pending`,
    )
    return data.data
  },

  apply: async (
    siteId: string,
    pageId: string,
  ): Promise<{ published: number; at: string; reparsed: boolean }> => {
    const { data } = await apiClient.post<{
      data: { published: number; at: string; reparsed: boolean }
    }>(`/api/sites/${siteId}/pages/${pageId}/schemas/apply`)
    return data.data
  },

  unpublish: async (siteId: string, pageId: string): Promise<void> => {
    await apiClient.post(`/api/sites/${siteId}/pages/${pageId}/schemas/unpublish`)
  },

  history: async (
    siteId: string,
    pageId: string,
  ): Promise<SchemaHistoryEntry[]> => {
    const { data } = await apiClient.get<{ data: SchemaHistoryEntry[] }>(
      `/api/sites/${siteId}/pages/${pageId}/schemas/history`,
    )
    return data.data
  },

  qc: async (siteId: string, pageId: string): Promise<QcReport> => {
    const { data } = await apiClient.post<{ data: QcReport }>(
      `/api/sites/${siteId}/pages/${pageId}/schemas/qc`,
    )
    return data.data
  },

  reparse: async (
    siteId: string,
    pageId: string,
  ): Promise<SchemaDetectionResult> => {
    const { data } = await apiClient.post<{ data: SchemaDetectionResult }>(
      `/api/sites/${siteId}/pages/${pageId}/schemas/reparse`,
    )
    return data.data
  },

  detectAll: async (
    siteId: string,
  ): Promise<{ detected: number; skippedNoHtml: number; pagesTotal: number }> => {
    const { data } = await apiClient.post<{
      data: { detected: number; skippedNoHtml: number; pagesTotal: number }
    }>(`/api/sites/${siteId}/schema/detect-all`)
    return data.data
  },

  coverage: async (siteId: string): Promise<SchemaCoverage> => {
    const { data } = await apiClient.get<{ data: SchemaCoverage }>(
      `/api/sites/${siteId}/schema/coverage`,
    )
    return data.data
  },

  pagesOverview: async (
    siteId: string,
    page = 1,
    limit = 25,
    search = '',
  ): Promise<SchemaPagesResponse> => {
    const { data } = await apiClient.get<{ data: SchemaPagesResponse }>(
      `/api/sites/${siteId}/schema/pages`,
      { params: { page, limit, search } },
    )
    return data.data
  },

  pendingSummary: async (siteId: string): Promise<PendingSummary> => {
    const { data } = await apiClient.get<{ data: PendingSummary }>(
      `/api/sites/${siteId}/schema/pending-summary`,
    )
    return data.data
  },

  applyAll: async (siteId: string): Promise<ApplyAllResult> => {
    const { data } = await apiClient.post<{ data: ApplyAllResult }>(
      `/api/sites/${siteId}/schema/apply-all`,
    )
    return data.data
  },
}
