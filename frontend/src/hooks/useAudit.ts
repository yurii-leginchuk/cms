import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { auditApi, type AuditListParams, type AuditSettings } from '@/api/audit'

export function useAuditSummary(siteId: string | undefined, live = false) {
  return useQuery({
    queryKey: ['audit-summary', siteId],
    queryFn: () => auditApi.summary(siteId!),
    enabled: !!siteId,
    refetchInterval: live ? 4000 : false,
  })
}

export function useAuditFindings(siteId: string | undefined, params: AuditListParams, live = false) {
  return useQuery({
    queryKey: ['audit-findings', siteId, params],
    queryFn: () => auditApi.findings(siteId!, params),
    enabled: !!siteId,
    placeholderData: (prev) => prev,
    refetchInterval: live ? 4000 : false,
  })
}

export function useAuditFinding(siteId: string | undefined, findingId: string | undefined) {
  return useQuery({
    queryKey: ['audit-finding', siteId, findingId],
    queryFn: () => auditApi.finding(siteId!, findingId!),
    enabled: !!siteId && !!findingId,
  })
}

function useInvalidateAudit(siteId: string) {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: ['audit-summary', siteId] })
    qc.invalidateQueries({ queryKey: ['audit-findings', siteId] })
    qc.invalidateQueries({ queryKey: ['audit-finding', siteId] })
  }
}

export function useMuteFinding(siteId: string) {
  const invalidate = useInvalidateAudit(siteId)
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => auditApi.mute(siteId, id, reason),
    onSuccess: invalidate,
  })
}

export function useUnmuteFinding(siteId: string) {
  const invalidate = useInvalidateAudit(siteId)
  return useMutation({
    mutationFn: (id: string) => auditApi.unmute(siteId, id),
    onSuccess: invalidate,
  })
}

export function useAcceptFinding(siteId: string) {
  const invalidate = useInvalidateAudit(siteId)
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => auditApi.accept(siteId, id, reason),
    onSuccess: invalidate,
  })
}

export function useRunAudit(siteId: string) {
  const invalidate = useInvalidateAudit(siteId)
  return useMutation({
    mutationFn: () => auditApi.runNow(siteId),
    onSuccess: invalidate,
  })
}

export function useAuditSettings(siteId: string | undefined) {
  return useQuery({
    queryKey: ['audit-settings', siteId],
    queryFn: () => auditApi.settings(siteId!),
    enabled: !!siteId,
  })
}

export function usePatchAuditSettings(siteId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<AuditSettings>) => auditApi.patchSettings(siteId, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['audit-settings', siteId] })
      qc.invalidateQueries({ queryKey: ['audit-summary', siteId] })
    },
  })
}
