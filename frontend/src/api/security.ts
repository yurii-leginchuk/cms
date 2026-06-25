import apiClient from './client'

export type SiteHealth = 'never_scanned' | 'scanning' | 'clean' | 'warning' | 'critical'
export type SecuritySeverity = 'info' | 'low' | 'medium' | 'high' | 'critical'
export type IncidentStatus =
  | 'open' | 'confirmed' | 'snoozed' | 'dismissed' | 'false_positive' | 'resolved'
export type SecurityAxis = 'googlebot' | 'chrome'

export interface SecurityOverview {
  health: SiteHealth
  isRunning: boolean
  lastScanAt: string | null
  pagesTotal: number
  pagesScanned: number
  pagesUnreachable: number
  openIncidents: number
  bySeverity: Record<SecuritySeverity, number>
}

export interface SecurityProgress {
  isRunning: boolean
  total: number
  completed: number
}

export interface DetectorSignal {
  detector: string
  code: string
  malicious: boolean
  weight: number
  message: string
  evidence: Record<string, unknown>
}

export interface SecurityIncident {
  id: string
  siteId: string
  pageId: string | null
  incidentKey: string
  scope: 'site' | 'page'
  detector: string
  severity: SecuritySeverity
  status: IncidentStatus
  title: string
  affectedPageCount: number
  snoozedUntil: string | null
  suppressedPattern: boolean
  resolvedAt: string | null
  lastSeenAt: string | null
  createdAt: string
  updatedAt: string
}

export interface SecurityFinding {
  id: string
  pageUrl: string
  dominantDetector: string
  signals: DetectorSignal[]
  score: number
  severity: SecuritySeverity
  axisAStatus: string
  axisBStatus: string
  axisAHttpStatus: number | null
  axisBHttpStatus: number | null
  redirectChainA: { url: string; status: number }[]
  redirectChainB: { url: string; status: number }[]
  excerpt: string | null
  createdAt: string
}

export interface SnapshotView {
  axis: SecurityAxis
  content: string
  scriptOrigins: string[]
  linkDomains: string[]
}

export interface IncidentDetail {
  incident: SecurityIncident
  finding: SecurityFinding | null
  snapshotA: SnapshotView | null
  snapshotB: SnapshotView | null
  affectedPages: string[]
}

export interface EvidenceRow {
  pageUrl: string
  severity: string
  score: number
  detector: string
  code: string
  malicious: boolean
  message: string
  evidence: string
  axisAStatus: string
  axisBStatus: string
  detectedAt: string
}

const unwrap = (res: any) => res.data?.data ?? res.data
const base = (siteId: string) => `/api/sites/${siteId}/security`

export const securityApi = {
  getOverview: (siteId: string): Promise<SecurityOverview> =>
    apiClient.get(`${base(siteId)}/overview`).then(unwrap),

  getProgress: (siteId: string): Promise<SecurityProgress> =>
    apiClient.get(`${base(siteId)}/progress`).then(unwrap),

  scanNow: (siteId: string): Promise<{ runId: string; queued: number }> =>
    apiClient.post(`${base(siteId)}/scan-now`, {}).then(unwrap),

  listIncidents: (siteId: string, status?: IncidentStatus): Promise<SecurityIncident[]> =>
    apiClient.get(`${base(siteId)}/incidents`, { params: status ? { status } : {} }).then(unwrap),

  getIncident: (siteId: string, id: string): Promise<IncidentDetail> =>
    apiClient.get(`${base(siteId)}/incidents/${id}`).then(unwrap),

  getEvidence: (siteId: string, id: string): Promise<{ incident: SecurityIncident; rows: EvidenceRow[] }> =>
    apiClient.get(`${base(siteId)}/incidents/${id}/export`).then(unwrap),

  triage: (siteId: string, id: string, action: 'confirm' | 'dismiss' | 'snooze' | 'resolve' | 'reopen'): Promise<SecurityIncident> =>
    apiClient.post(`${base(siteId)}/incidents/${id}/${action}`, {}).then(unwrap),
}
