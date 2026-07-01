import apiClient from './client'

export type OptimizationState =
  | 'not_optimized'
  | 'queued'
  | 'optimizing'
  | 'optimized'
  | 'skipped'
  | 'failed'

export type OptimizationScope = 'all' | 'new_only' | 'force_all'

export type R2Status = 'untested' | 'verified' | 'failed'
export type DnsStatus = 'none' | 'pending' | 'active' | 'error'

/** Redacted config from the API — secrets appear only as *Set booleans. */
export interface OptimizationConfig {
  id: string
  siteId: string
  enabled: boolean
  webpEnabled: boolean
  quality: number
  maxWidth: number | null
  r2AccountIdSet: boolean
  r2AccessKeyIdSet: boolean
  r2SecretSet: boolean
  cfApiTokenSet: boolean
  r2Bucket: string | null
  r2Status: R2Status
  r2VerifiedAt: string | null
  r2LastError: string | null
  cdnDomain: string | null
  cfZoneId: string | null
  dnsStatus: DnsStatus
  dnsError: string | null
  rewriteEnabled: boolean
  autopilotEnabled: boolean
  webhookEnabled: boolean
  webhookConfigured: boolean
  webhookLastReceivedAt: string | null
}

export interface UpdateOptimizationConfig {
  enabled?: boolean
  webpEnabled?: boolean
  quality?: number
  maxWidth?: number | null
  autopilotEnabled?: boolean
}

/** Write-only R2 credentials (only send fields the user actually changed). */
export interface UpdateR2Config {
  r2AccountId?: string
  r2AccessKeyId?: string
  r2Secret?: string
  cfApiToken?: string
}

export interface OptimizationImageRow {
  imageId: string
  canonicalUrl: string
  canonicalKey: string
  wpAttachmentId: string | null
  state: OptimizationState
  originalBytes: number | null
  optimizedBytes: number | null
  bytesSaved: number | null
  outputFormat: string | null
  skipReason: string | null
  failureError: string | null
  isStale: boolean
  optimizedAt: string | null
  r2Uploaded: boolean
  r2Key: string | null
  rewriteLive: boolean
}

export interface OptimizationListResult {
  data: OptimizationImageRow[]
  meta: { total: number; page: number; limit: number; totalPages: number }
}

export interface OptimizationStats {
  inventoryTotal: number
  optimizedCount: number
  skippedCount: number
  failedCount: number
  notOptimizedCount: number
  staleCount: number
  rewriteLiveCount: number
  originalBytesOptimized: number
  optimizedBytes: number
  bytesSaved: number
  percentSaved: number
  asOf: string | null
}

export type OptimizationRunStatus = 'running' | 'done' | 'cancelled' | 'error'

export interface OptimizationRun {
  id: string
  siteId: string
  startedAt: string
  finishedAt: string | null
  triggeredBy: string
  scope: OptimizationScope
  settingsSnapshot: Record<string, unknown>
  settingsFingerprint: string | null
  imagesConsidered: number
  processed: number
  optimized: number
  skipped: number
  failed: number
  originalBytesSum: number
  optimizedBytesSum: number
  bytesSavedSum: number
  status: OptimizationRunStatus
  error: string | null
}

const base = (siteId: string) => `/api/sites/${siteId}/optimization`

export async function getOptimizationConfig(siteId: string): Promise<OptimizationConfig> {
  const { data } = await apiClient.get(`${base(siteId)}/config`)
  return data.data
}

export async function updateOptimizationConfig(
  siteId: string,
  patch: UpdateOptimizationConfig,
): Promise<OptimizationConfig> {
  const { data } = await apiClient.put(`${base(siteId)}/config`, patch)
  return data.data
}

export async function updateR2Config(
  siteId: string,
  patch: UpdateR2Config,
): Promise<OptimizationConfig> {
  const { data } = await apiClient.put(`${base(siteId)}/config/r2`, patch)
  return data.data
}

export async function createR2Bucket(
  siteId: string,
  name?: string,
): Promise<{ bucket: string; existed: boolean }> {
  const { data } = await apiClient.post(`${base(siteId)}/config/r2/create-bucket`, { name })
  return data.data
}

export async function testR2Connection(siteId: string): Promise<OptimizationConfig> {
  const { data } = await apiClient.post(`${base(siteId)}/config/r2/test`)
  return data.data
}

export interface PublishResult {
  eligible: number
  verified: number
  published: number
  failedHead: number
}

export async function provisionCdn(
  siteId: string,
  body: { cdnDomain: string; cfZoneId: string },
): Promise<OptimizationConfig> {
  const { data } = await apiClient.post(`${base(siteId)}/config/cdn/provision`, body)
  return data.data
}

export async function getCdnStatus(siteId: string): Promise<OptimizationConfig> {
  const { data } = await apiClient.get(`${base(siteId)}/config/cdn/status`)
  return data.data
}

export async function enableRewrite(
  siteId: string,
): Promise<{ config: OptimizationConfig; publish: PublishResult }> {
  const { data } = await apiClient.post(`${base(siteId)}/config/rewrite/enable`)
  return data.data
}

export async function disableRewrite(siteId: string): Promise<OptimizationConfig> {
  const { data } = await apiClient.post(`${base(siteId)}/config/rewrite/disable`)
  return data.data
}

export async function connectWebhook(siteId: string): Promise<OptimizationConfig> {
  const { data } = await apiClient.post(`${base(siteId)}/config/webhook/connect`)
  return data.data
}

export async function disconnectWebhook(siteId: string): Promise<OptimizationConfig> {
  const { data } = await apiClient.post(`${base(siteId)}/config/webhook/disconnect`)
  return data.data
}

export interface AutopilotResult {
  siteId: string
  skipped?: string
  optimized?: number
  skippedImages?: number
  failed?: number
  published?: number
}

export async function runAutopilot(siteId: string): Promise<AutopilotResult> {
  const { data } = await apiClient.post(`${base(siteId)}/autopilot`)
  return data.data
}

export async function getOptimizationStats(siteId: string): Promise<OptimizationStats> {
  const { data } = await apiClient.get(`${base(siteId)}/stats`)
  return data.data
}

export async function listOptimizationImages(
  siteId: string,
  params: { page: number; limit: number; state?: string; search?: string },
): Promise<OptimizationListResult> {
  const { data } = await apiClient.get(base(siteId), {
    params: {
      page: params.page,
      limit: params.limit,
      state: params.state ?? '',
      search: params.search ?? '',
    },
  })
  return data.data
}

export async function startOptimizationRun(
  siteId: string,
  scope: OptimizationScope,
): Promise<{ runId: string }> {
  const { data } = await apiClient.post(`${base(siteId)}/run`, { scope })
  return data.data
}

export async function getOptimizationRun(
  siteId: string,
  runId: string,
): Promise<OptimizationRun> {
  const { data } = await apiClient.get(`${base(siteId)}/run/${runId}`)
  return data.data
}

export async function cancelOptimizationRun(
  siteId: string,
  runId: string,
): Promise<{ cancelled: boolean }> {
  const { data } = await apiClient.post(`${base(siteId)}/run/${runId}/cancel`)
  return data.data
}

export async function listOptimizationRuns(siteId: string): Promise<OptimizationRun[]> {
  const { data } = await apiClient.get(`${base(siteId)}/runs`)
  return data.data
}

export async function reoptimizeImage(
  siteId: string,
  imageId: string,
): Promise<OptimizationImageRow> {
  const { data } = await apiClient.post(`${base(siteId)}/images/${imageId}/reoptimize`)
  return data.data
}
