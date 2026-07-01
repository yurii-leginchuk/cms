import apiClient from './client'

export type RedirectDriftState = 'in_sync' | 'deleted_in_wp' | 'drifted_wp' | 'pending_cms'

export interface RedirectRow {
  id: string
  pluginId: number | null
  source: string
  target: string | null
  matchType: string | null
  actionType: string | null
  actionCode: number | null
  regex: boolean
  groupId: number | null
  groupName: string | null
  position: number
  enabled: boolean
  title: string | null
  wpLastAccess: string | null
  wpLastCount: number
  driftState: RedirectDriftState
  deletedInWpAt: string | null
  lastSyncedAt: string | null
  liveFinalStatus?: number | null
  liveHops?: number | null
  liveCheckedAt?: string | null
}

export interface RedirectList {
  data: RedirectRow[]
  meta: { page: number; limit: number; total: number; totalPages: number }
}

export interface RedirectSummary {
  /** true = plugin active · false = plugin absent · null = never confirmed. */
  redirectionActive: boolean | null
  pluginVersion: string | null
  counts: {
    live: number
    enabled: number
    disabled: number
    tombstoned: number
    regex: number
    drifted: number
    pendingCms: number
    byActionCode: Record<string, number>
  }
  freshness: { lastSyncedAt: string | null }
  lastRun: {
    id: string
    trigger: string
    startedAt: string
    finishedAt: string | null
    redirectionActive: boolean | null
    unchanged: boolean
    redirectsFetched: number
    added: number
    updated: number
    deleted: number
    fatalError: string | null
  } | null
}

export interface RedirectDetail extends RedirectRow {
  rawPayload: unknown
}

export interface RedirectHistoryEntry {
  id: string
  observedAt: string
  changeKind: 'first_seen' | 'updated' | 'deleted'
  source: string
  target: string | null
  actionCode: number | null
  enabled: boolean
  fingerprint: string
  prevFingerprint: string | null
}

export interface RedirectSyncRunResult {
  id: string
  trigger: string
  startedAt: string
  finishedAt: string | null
  redirectionActive: boolean | null
  pluginVersion: string | null
  unchanged: boolean
  redirectsFetched: number
  added: number
  updated: number
  deleted: number
  fatalError: string | null
}

export interface RedirectListParams {
  page?: number
  limit?: number
  search?: string
  status?: string
  regex?: boolean
  actionCode?: number
  sort?: string
}

/** Editable fields the create/edit form submits (partial for updates; the server
 *  merges an update onto the existing redirect, so only `create` needs `source`). */
export interface RedirectWriteInput {
  source?: string
  target?: string | null
  actionCode?: number | null
  actionType?: string | null
  matchType?: string | null
  regex?: boolean
  groupId?: number | null
  enabled?: boolean
  title?: string | null
}

/** Validation feedback for a prospective create/edit. */
export interface ValidationIssue {
  code: 'duplicate' | 'conflict' | 'cycle'
  severity: 'error' | 'warning'
  message: string
  path?: string[]
}
export interface ValidationResult {
  blocked: boolean
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
}

export interface ResolveHop { hop: number; url: string; status: number }
export interface ResolveResult {
  startUrl: string
  trail: ResolveHop[]
  finalUrl: string
  finalStatus: number | null
  hops: number
  loop: boolean
  budgetExhausted: boolean
  error: string | null
  cached: boolean
  checkedAt: string
}

export interface RedirectChain {
  headId: string
  redirectIds: string[]
  hops: string[]
  length: number
  hasCycle: boolean
  headSource: string | null
}
export interface RedirectIssues {
  duplicates: { sourceNormalized: string; matchType: string | null; regex: boolean; redirectIds: string[] }[]
  conflicts: { sourceNormalized: string; matchType: string | null; variants: { redirectId: string; target: string | null; actionCode: number | null }[] }[]
  cycles: { nodes: string[]; certainty: 'exact' | 'possible'; redirectIds: string[] }[]
  chains: RedirectChain[]
  counts: { duplicates: number; conflicts: number; cycles: number; chains: number }
}

export type FlattenVerdict = 'ready' | 'needs_review' | 'blocked'
export interface FlattenPreview {
  redirectId: string
  verdict: FlattenVerdict
  reason: string | null
  before: { source: string; target: string | null; actionCode: number | null }
  after: { source: string; target: string; actionCode: number } | null
  trail: ResolveHop[]
  finalStatus: number | null
  finalExternal: boolean
}

// ── Audit (Phase 4) ───────────────────────────────────────────────────────
export type RedirectIssueType =
  | 'loop' | 'possible_loop' | 'redirect_to_404_410' | 'redirect_to_noindex'
  | 'redirect_to_redirect_chain' | 'duplicate' | 'conflict'
  | 'temporary_should_be_permanent' | 'redirect_of_live_page' | 'dead_redirect'
export type RedirectIssueSeverity = 'critical' | 'high' | 'medium' | 'low'
export type RedirectFixMode = 'batch' | 'judgment' | 'manual'

export interface RedirectIssueEvidence {
  sourceClicks: number | null
  sourceImpressions: number | null
  sourceInInventory: boolean | null
  sourceTransactional: boolean | null
  targetIndexed: boolean | null
  targetStatus: string | null
  targetInInventory: boolean | null
  liveFinalStatus: number | null
  chainLength: number | null
  cycleCertainty: 'exact' | 'possible' | null
}

export interface RedirectIssue {
  id: string
  issueType: RedirectIssueType
  severity: RedirectIssueSeverity
  fixMode: RedirectFixMode
  rank: string
  primaryRedirectId: string | null
  redirectIds: string[]
  title: string
  detail: string | null
  evidence: RedirectIssueEvidence | null
  proposedFix: Record<string, unknown> | null
  status: 'open' | 'resolved' | 'deferred'
}

export interface RedirectAuditSummary {
  hasAudited: boolean
  open: number
  deferred: number
  byType: Record<string, number>
  bySeverity: Record<string, number>
  batchFixable: number
  judgmentNeeded: number
  lastRun: {
    id: string; trigger: string; startedAt: string; finishedAt: string | null
    redirectsAnalyzed: number; gscConnected: boolean; ga4Connected: boolean
    ga4OrganicRevenue: number | null; detectionVersion: number
  } | null
}

export interface RedirectIssueList {
  data: RedirectIssue[]
  meta: { page: number; limit: number; total: number; totalPages: number }
}

export interface JudgmentSuggestion {
  issueId: string
  aiAvailable: boolean
  source: string
  rationale: string
  suggestedFix: string | null
  proposedFix: Record<string, unknown> | null
}

// ── Bulk import / export (Phase 5) ────────────────────────────────────────
export type ImportMode = 'merge' | 'replace'
export type ImportFormat = 'csv' | 'json' | 'apache' | 'nginx'
export type DiffOp = 'add' | 'update' | 'delete' | 'noop'
export type DiffStatus = 'ok' | 'warning' | 'blocked'

export interface ImportDiffRow {
  op: DiffOp
  status: DiffStatus
  rowNumber: number | null
  fingerprint: string
  source: string
  target: string | null
  actionCode: number
  matchType: string
  regex: boolean
  enabled: boolean
  redirectId: string | null
  issues: string[]
}
export interface ParseError { rowNumber: number; raw: string; reason: string }

export interface DryRunResult {
  format: ImportFormat
  mode: ImportMode
  totalRows: number
  currentCount: number
  parseErrors: ParseError[]
  counts: { add: number; update: number; delete: number; noop: number; blocked: number; warnings: number }
  diff: ImportDiffRow[]
  /** null — dry-run is read-only; the backup is taken at apply time */
  backupId: string | null
}
export interface ApplyResult {
  backupId: string
  queued: { add: number; update: number; delete: number }
  skipped: number
  errors: { fingerprint: string; source: string; error: string }[]
}
export interface RedirectBackup {
  id: string
  reason: string
  redirectCount: number
  note: string | null
  createdAt: string
}
export interface ExportResult { filename: string; mime: string; content: string }

/** A WP-vs-CMS conflict a nightly sync flagged (redirect changed in WP under a pending edit). */
export interface RedirectDriftItem extends RedirectRow {
  pendingChangeId: string | null
  cmsDesired: {
    action: string
    payload: Record<string, unknown>
    before: Record<string, unknown> | null
    summary: string
  } | null
}

const BASE = (siteId: string) => `/api/sites/${siteId}/redirects`

export const redirectsApi = {
  summary: async (siteId: string): Promise<RedirectSummary> => {
    const { data } = await apiClient.get<{ data: RedirectSummary }>(`${BASE(siteId)}/summary`)
    return data.data
  },

  list: async (siteId: string, params: RedirectListParams): Promise<RedirectList> => {
    const { data } = await apiClient.get<{ data: RedirectList }>(BASE(siteId), {
      params: { ...params, regex: params.regex ? 'true' : undefined },
    })
    return data.data
  },

  get: async (siteId: string, id: string): Promise<RedirectDetail> => {
    const { data } = await apiClient.get<{ data: RedirectDetail }>(`${BASE(siteId)}/${id}`)
    return data.data
  },

  history: async (siteId: string, id: string): Promise<RedirectHistoryEntry[]> => {
    const { data } = await apiClient.get<{ data: RedirectHistoryEntry[] }>(`${BASE(siteId)}/${id}/history`)
    return data.data
  },

  sync: async (siteId: string): Promise<RedirectSyncRunResult> => {
    const { data } = await apiClient.post<{ data: RedirectSyncRunResult }>(`${BASE(siteId)}/sync`)
    return data.data
  },

  // ── Writes — each STAGES a pending change (approved in the shared gate) ──────
  proposeCreate: async (siteId: string, body: RedirectWriteInput) => {
    const { data } = await apiClient.post(`${BASE(siteId)}/propose/create`, body)
    return data.data
  },
  proposeUpdate: async (siteId: string, id: string, body: RedirectWriteInput) => {
    const { data } = await apiClient.post(`${BASE(siteId)}/${id}/propose/update`, body)
    return data.data
  },
  proposeToggle: async (siteId: string, id: string, enabled: boolean) => {
    const { data } = await apiClient.post(`${BASE(siteId)}/${id}/propose/toggle`, { enabled })
    return data.data
  },
  proposeDelete: async (siteId: string, id: string) => {
    const { data } = await apiClient.delete(`${BASE(siteId)}/${id}/propose`)
    return data.data
  },

  // ── Drift (WP-vs-CMS conflicts) ─────────────────────────────────────────────
  drift: async (siteId: string): Promise<RedirectDriftItem[]> => {
    const { data } = await apiClient.get<{ data: RedirectDriftItem[] }>(`${BASE(siteId)}/drift`)
    return data.data
  },
  resolveDrift: async (siteId: string, id: string, resolution: 'keep_wp' | 'keep_cms') => {
    const { data } = await apiClient.post(`${BASE(siteId)}/${id}/resolve-drift`, { resolution })
    return data.data
  },

  // ── Validation engine (Phase 3) ─────────────────────────────────────────────
  validate: async (siteId: string, intended: RedirectWriteInput, excludeId?: string): Promise<ValidationResult> => {
    const { data } = await apiClient.post<{ data: ValidationResult }>(`${BASE(siteId)}/validate`, { intended, excludeId })
    return data.data
  },
  issues: async (siteId: string): Promise<RedirectIssues> => {
    const { data } = await apiClient.get<{ data: RedirectIssues }>(`${BASE(siteId)}/issues`)
    return data.data
  },
  resolveLive: async (siteId: string, id: string): Promise<ResolveResult> => {
    const { data } = await apiClient.post<{ data: ResolveResult }>(`${BASE(siteId)}/${id}/resolve`)
    return data.data
  },
  flattenPreview: async (siteId: string, id: string): Promise<FlattenPreview> => {
    const { data } = await apiClient.get<{ data: FlattenPreview }>(`${BASE(siteId)}/${id}/flatten-preview`)
    return data.data
  },

  // ── Audit (Phase 4) ─────────────────────────────────────────────────────────
  auditSummary: async (siteId: string): Promise<RedirectAuditSummary> => {
    const { data } = await apiClient.get<{ data: RedirectAuditSummary }>(`${BASE(siteId)}/audit/summary`)
    return data.data
  },
  auditIssues: async (siteId: string, params: { status?: string; type?: string; fixMode?: string; page?: number; limit?: number }): Promise<RedirectIssueList> => {
    const { data } = await apiClient.get<{ data: RedirectIssueList }>(`${BASE(siteId)}/audit/issues`, { params })
    return data.data
  },
  runAudit: async (siteId: string) => {
    const { data } = await apiClient.post(`${BASE(siteId)}/audit/run`)
    return data.data
  },
  auditSuggest: async (siteId: string, issueId: string): Promise<JudgmentSuggestion> => {
    const { data } = await apiClient.get<{ data: JudgmentSuggestion }>(`${BASE(siteId)}/audit/issues/${issueId}/suggest`)
    return data.data
  },
  deferIssue: async (siteId: string, issueId: string) => {
    const { data } = await apiClient.post(`${BASE(siteId)}/audit/issues/${issueId}/defer`)
    return data.data
  },
  reopenIssue: async (siteId: string, issueId: string) => {
    const { data } = await apiClient.post(`${BASE(siteId)}/audit/issues/${issueId}/reopen`)
    return data.data
  },
  batchFlatten: async (siteId: string) => (await apiClient.post(`${BASE(siteId)}/audit/batch/flatten`)).data.data,
  batchDisableDuplicates: async (siteId: string) => (await apiClient.post(`${BASE(siteId)}/audit/batch/disable-duplicates`)).data.data,
  batchDisableDead: async (siteId: string) => (await apiClient.post(`${BASE(siteId)}/audit/batch/disable-dead`)).data.data,

  // ── Bulk import / export (Phase 5) ──────────────────────────────────────────
  importDryRun: async (siteId: string, body: { content: string; format?: ImportFormat; mode?: ImportMode; filename?: string }): Promise<DryRunResult> => {
    const { data } = await apiClient.post<{ data: DryRunResult }>(`${BASE(siteId)}/import/dry-run`, body)
    return data.data
  },
  importApply: async (siteId: string, body: { content: string; format?: ImportFormat; mode?: ImportMode; filename?: string; skipFingerprints?: string[] }): Promise<ApplyResult> => {
    const { data } = await apiClient.post<{ data: ApplyResult }>(`${BASE(siteId)}/import/apply`, body)
    return data.data
  },
  importBackups: async (siteId: string): Promise<RedirectBackup[]> => {
    const { data } = await apiClient.get<{ data: RedirectBackup[] }>(`${BASE(siteId)}/import/backups`)
    return data.data
  },
  restoreBackup: async (siteId: string, backupId: string): Promise<ApplyResult> => {
    const { data } = await apiClient.post<{ data: ApplyResult }>(`${BASE(siteId)}/import/backups/${backupId}/restore`)
    return data.data
  },
  exportRedirects: async (siteId: string, params: { mode?: 'lossless' | 'audit'; format?: ImportFormat }): Promise<ExportResult> => {
    const { data } = await apiClient.get<{ data: ExportResult }>(`${BASE(siteId)}/export`, { params })
    return data.data
  },
}
