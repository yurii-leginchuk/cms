import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { securityApi, type IncidentStatus } from '../api/security'

export function useSecurityOverview(siteId: string) {
  return useQuery({
    queryKey: ['security-overview', siteId],
    queryFn: () => securityApi.getOverview(siteId),
    refetchInterval: (q) => (q.state.data?.isRunning ? 3000 : false),
    staleTime: 10_000,
  })
}

export function useSecurityProgress(siteId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['security-progress', siteId],
    queryFn: () => securityApi.getProgress(siteId),
    refetchInterval: enabled ? 3000 : false,
    staleTime: 0,
  })
}

export function useSecurityIncidents(siteId: string, status?: IncidentStatus) {
  return useQuery({
    queryKey: ['security-incidents', siteId, status ?? 'all'],
    queryFn: () => securityApi.listIncidents(siteId, status),
    staleTime: 10_000,
  })
}

export function useSecurityIncident(siteId: string, id: string) {
  return useQuery({
    queryKey: ['security-incident', siteId, id],
    queryFn: () => securityApi.getIncident(siteId, id),
    staleTime: 10_000,
  })
}

export function useScanNow(siteId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => securityApi.scanNow(siteId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['security-overview', siteId] })
      qc.invalidateQueries({ queryKey: ['security-progress', siteId] })
    },
  })
}

export function useTriageIncident(siteId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'confirm' | 'dismiss' | 'snooze' | 'resolve' | 'reopen' }) =>
      securityApi.triage(siteId, id, action),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['security-incidents', siteId] })
      qc.invalidateQueries({ queryKey: ['security-overview', siteId] })
      qc.invalidateQueries({ queryKey: ['security-incident', siteId] })
    },
  })
}
