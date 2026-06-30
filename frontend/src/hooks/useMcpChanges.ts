import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { mcpChangesApi, type McpChangeModule } from '@/api/mcpChanges'

/** Single source of truth for the pending-count badges across all surfaces. */
export function useMcpChangeCounts(siteId: string) {
  return useQuery({
    queryKey: ['mcp-change-counts', siteId],
    queryFn: () => mcpChangesApi.counts(siteId),
    enabled: !!siteId,
    refetchInterval: 20_000,
  })
}

export function usePendingChanges(siteId: string, module?: McpChangeModule) {
  return useQuery({
    queryKey: ['mcp-changes', siteId, module ?? 'all'],
    queryFn: () => mcpChangesApi.list(siteId, { module, status: 'pending' }),
    enabled: !!siteId,
  })
}

/** Invalidate every surface a decision can affect (counts, queue, module data). */
function invalidateAfterDecision(qc: ReturnType<typeof useQueryClient>, siteId: string) {
  qc.invalidateQueries({ queryKey: ['mcp-change-counts', siteId] })
  qc.invalidateQueries({ queryKey: ['mcp-changes', siteId] })
  // Module data that an accept may have changed + published:
  qc.invalidateQueries({ queryKey: ['pages', siteId] })
  qc.invalidateQueries({ queryKey: ['page', siteId] })
  qc.invalidateQueries({ queryKey: ['sync-status', siteId] })
  qc.invalidateQueries({ queryKey: ['schema', siteId] })
  qc.invalidateQueries({ queryKey: ['schemas', siteId] })
  qc.invalidateQueries({ queryKey: ['images', siteId] })
}

export function useAcceptChange(siteId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => mcpChangesApi.accept(siteId, id),
    onSettled: () => invalidateAfterDecision(qc, siteId),
  })
}

export function useRejectChange(siteId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => mcpChangesApi.reject(siteId, id),
    onSettled: () => invalidateAfterDecision(qc, siteId),
  })
}

export function useAcceptAllChanges(siteId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (module?: McpChangeModule) => mcpChangesApi.acceptAll(siteId, module),
    onSettled: () => invalidateAfterDecision(qc, siteId),
  })
}

export function useRejectAllChanges(siteId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (module?: McpChangeModule) => mcpChangesApi.rejectAll(siteId, module),
    onSettled: () => invalidateAfterDecision(qc, siteId),
  })
}
