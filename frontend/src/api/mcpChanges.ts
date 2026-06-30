import apiClient from './client'

export type McpChangeModule = 'meta' | 'schema' | 'alt'
export type McpChangeStatus = 'pending' | 'accepted' | 'rejected'
export type McpChangeAction =
  | 'meta.update'
  | 'schema.add'
  | 'schema.update'
  | 'schema.delete'
  | 'alt.set'

export interface McpChangeRequest {
  id: string
  siteId: string
  module: McpChangeModule
  action: McpChangeAction
  targetType: 'page' | 'image'
  targetId: string
  targetLabel: string | null
  payload: Record<string, unknown>
  before: Record<string, unknown> | null
  summary: string
  status: McpChangeStatus
  origin: string
  error: string | null
  createdAt: string
  decidedAt: string | null
}

export interface McpChangeCounts {
  total: number
  meta: number
  schema: number
  alt: number
}

export interface BulkResult {
  accepted?: number
  rejected?: number
  failed?: number
  errors?: { id: string; error: string }[]
}

export const mcpChangesApi = {
  counts: async (siteId: string): Promise<McpChangeCounts> => {
    const { data } = await apiClient.get<{ data: McpChangeCounts }>(
      `/api/sites/${siteId}/changes/counts`,
    )
    return data.data
  },

  list: async (
    siteId: string,
    opts: { module?: McpChangeModule; status?: McpChangeStatus } = {},
  ): Promise<McpChangeRequest[]> => {
    const params = new URLSearchParams()
    if (opts.module) params.set('module', opts.module)
    if (opts.status) params.set('status', opts.status)
    const qs = params.toString()
    const { data } = await apiClient.get<{ data: McpChangeRequest[] }>(
      `/api/sites/${siteId}/changes${qs ? `?${qs}` : ''}`,
    )
    return data.data
  },

  accept: async (siteId: string, id: string): Promise<McpChangeRequest> => {
    const { data } = await apiClient.post<{ data: McpChangeRequest }>(
      `/api/sites/${siteId}/changes/${id}/accept`,
    )
    return data.data
  },

  reject: async (siteId: string, id: string): Promise<McpChangeRequest> => {
    const { data } = await apiClient.post<{ data: McpChangeRequest }>(
      `/api/sites/${siteId}/changes/${id}/reject`,
    )
    return data.data
  },

  acceptAll: async (siteId: string, module?: McpChangeModule): Promise<BulkResult> => {
    const { data } = await apiClient.post<{ data: BulkResult }>(
      `/api/sites/${siteId}/changes/accept-all${module ? `?module=${module}` : ''}`,
    )
    return data.data
  },

  rejectAll: async (siteId: string, module?: McpChangeModule): Promise<BulkResult> => {
    const { data } = await apiClient.post<{ data: BulkResult }>(
      `/api/sites/${siteId}/changes/reject-all${module ? `?module=${module}` : ''}`,
    )
    return data.data
  },
}
