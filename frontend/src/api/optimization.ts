import apiClient from './client'

export type OptimizationState =
  | 'not_optimized'
  | 'queued'
  | 'optimizing'
  | 'optimized'
  | 'skipped'
  | 'failed'

export type OptimizationScope = 'all' | 'new_only' | 'force_all'

export interface OptimizationConfig {
  id: string
  siteId: string
  enabled: boolean
  webpEnabled: boolean
  quality: number
  maxWidth: number | null
}

export interface UpdateOptimizationConfig {
  enabled?: boolean
  webpEnabled?: boolean
  quality?: number
  maxWidth?: number | null
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
