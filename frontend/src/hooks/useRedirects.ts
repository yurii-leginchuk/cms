import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { redirectsApi, type RedirectListParams, type RedirectWriteInput } from '@/api/redirects'

export function useRedirectSummary(siteId: string | undefined) {
  return useQuery({
    queryKey: ['redirect-summary', siteId],
    queryFn: () => redirectsApi.summary(siteId!),
    enabled: !!siteId,
  })
}

export function useRedirectList(siteId: string | undefined, params: RedirectListParams) {
  return useQuery({
    queryKey: ['redirect-list', siteId, params],
    queryFn: () => redirectsApi.list(siteId!, params),
    enabled: !!siteId,
    placeholderData: (prev) => prev,
  })
}

export function useRedirect(siteId: string | undefined, id: string | undefined) {
  return useQuery({
    queryKey: ['redirect', siteId, id],
    queryFn: () => redirectsApi.get(siteId!, id!),
    enabled: !!siteId && !!id,
  })
}

export function useRedirectHistory(siteId: string | undefined, id: string | undefined) {
  return useQuery({
    queryKey: ['redirect-history', siteId, id],
    queryFn: () => redirectsApi.history(siteId!, id!),
    enabled: !!siteId && !!id,
  })
}

export function useSyncRedirects(siteId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => redirectsApi.sync(siteId),
    onSuccess: () => invalidateAll(qc, siteId),
  })
}

/** WP-vs-CMS conflicts to adjudicate. */
export function useRedirectDrift(siteId: string | undefined) {
  return useQuery({
    queryKey: ['redirect-drift', siteId],
    queryFn: () => redirectsApi.drift(siteId!),
    enabled: !!siteId,
  })
}

/** Stage a create/edit/delete/toggle as a pending gate change (no direct WP write). */
export function useProposeRedirect(siteId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v:
      | { kind: 'create'; body: RedirectWriteInput }
      | { kind: 'update'; id: string; body: RedirectWriteInput }
      | { kind: 'toggle'; id: string; enabled: boolean }
      | { kind: 'delete'; id: string }) => {
      switch (v.kind) {
        case 'create': return redirectsApi.proposeCreate(siteId, v.body)
        case 'update': return redirectsApi.proposeUpdate(siteId, v.id, v.body)
        case 'toggle': return redirectsApi.proposeToggle(siteId, v.id, v.enabled)
        case 'delete': return redirectsApi.proposeDelete(siteId, v.id)
      }
    },
    onSuccess: () => {
      invalidateAll(qc, siteId)
      qc.invalidateQueries({ queryKey: ['mcp-change-counts', siteId] })
      qc.invalidateQueries({ queryKey: ['mcp-changes', siteId] })
    },
  })
}

export function useResolveRedirectDrift(siteId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { id: string; resolution: 'keep_wp' | 'keep_cms' }) =>
      redirectsApi.resolveDrift(siteId, v.id, v.resolution),
    onSuccess: () => {
      invalidateAll(qc, siteId)
      qc.invalidateQueries({ queryKey: ['mcp-change-counts', siteId] })
      qc.invalidateQueries({ queryKey: ['mcp-changes', siteId] })
    },
  })
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>, siteId: string) {
  qc.invalidateQueries({ queryKey: ['redirect-summary', siteId] })
  qc.invalidateQueries({ queryKey: ['redirect-list', siteId] })
  qc.invalidateQueries({ queryKey: ['redirect-drift', siteId] })
  qc.invalidateQueries({ queryKey: ['redirect-issues', siteId] })
}

// ── Phase 3: validation engine + live resolve ────────────────────────────────

/** Static issue survey: duplicates / conflicts / cycles / chain candidates. */
export function useRedirectIssues(siteId: string | undefined) {
  return useQuery({
    queryKey: ['redirect-issues', siteId],
    queryFn: () => redirectsApi.issues(siteId!),
    enabled: !!siteId,
  })
}

/** Validate a prospective create/edit (called on Save-intent, not per keystroke). */
export function useValidateRedirect(siteId: string) {
  return useMutation({
    mutationFn: (v: { intended: RedirectWriteInput; excludeId?: string }) =>
      redirectsApi.validate(siteId, v.intended, v.excludeId),
  })
}

/** Live-resolve one redirect over HTTP (persists the cached trail). */
export function useResolveRedirect(siteId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => redirectsApi.resolveLive(siteId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['redirect-list', siteId] }),
  })
}

/** Live flatten preview for a chain head. */
export function useFlattenPreview(siteId: string) {
  return useMutation({
    mutationFn: (id: string) => redirectsApi.flattenPreview(siteId, id),
  })
}

// ── Phase 4: first-sync audit ────────────────────────────────────────────────

export function useAuditSummary(siteId: string | undefined) {
  return useQuery({
    queryKey: ['redirect-audit-summary', siteId],
    queryFn: () => redirectsApi.auditSummary(siteId!),
    enabled: !!siteId,
  })
}

export function useAuditIssues(
  siteId: string | undefined,
  params: { status?: string; type?: string; fixMode?: string; page?: number; limit?: number },
) {
  return useQuery({
    queryKey: ['redirect-audit-issues', siteId, params],
    queryFn: () => redirectsApi.auditIssues(siteId!, params),
    enabled: !!siteId,
    placeholderData: (prev) => prev,
  })
}

export function useRunAudit(siteId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => redirectsApi.runAudit(siteId),
    onSuccess: () => invalidateAudit(qc, siteId),
  })
}

export function useDeferIssue(siteId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { id: string; reopen?: boolean }) =>
      v.reopen ? redirectsApi.reopenIssue(siteId, v.id) : redirectsApi.deferIssue(siteId, v.id),
    onSuccess: () => invalidateAudit(qc, siteId),
  })
}

/** Batch mechanical fix — flatten / disable-duplicates / disable-dead. */
export function useBatchFix(siteId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (kind: 'flatten' | 'duplicates' | 'dead') => {
      if (kind === 'flatten') return redirectsApi.batchFlatten(siteId)
      if (kind === 'duplicates') return redirectsApi.batchDisableDuplicates(siteId)
      return redirectsApi.batchDisableDead(siteId)
    },
    onSuccess: () => {
      invalidateAudit(qc, siteId)
      qc.invalidateQueries({ queryKey: ['mcp-change-counts', siteId] })
      qc.invalidateQueries({ queryKey: ['mcp-changes', siteId] })
    },
  })
}

function invalidateAudit(qc: ReturnType<typeof useQueryClient>, siteId: string) {
  qc.invalidateQueries({ queryKey: ['redirect-audit-summary', siteId] })
  qc.invalidateQueries({ queryKey: ['redirect-audit-issues', siteId] })
}

// ── Phase 5: bulk import / export ────────────────────────────────────────────

export function useImportDryRun(siteId: string) {
  return useMutation({
    mutationFn: (body: { content: string; format?: 'csv' | 'json' | 'apache' | 'nginx'; mode?: 'merge' | 'replace'; filename?: string }) =>
      redirectsApi.importDryRun(siteId, body),
  })
}

export function useImportApply(siteId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { content: string; format?: 'csv' | 'json' | 'apache' | 'nginx'; mode?: 'merge' | 'replace'; filename?: string; skipFingerprints?: string[] }) =>
      redirectsApi.importApply(siteId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['redirect-list', siteId] })
      qc.invalidateQueries({ queryKey: ['redirect-summary', siteId] })
      qc.invalidateQueries({ queryKey: ['redirect-backups', siteId] })
      qc.invalidateQueries({ queryKey: ['mcp-change-counts', siteId] })
      qc.invalidateQueries({ queryKey: ['mcp-changes', siteId] })
    },
  })
}

export function useRedirectBackups(siteId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['redirect-backups', siteId],
    queryFn: () => redirectsApi.importBackups(siteId!),
    enabled: !!siteId && enabled,
  })
}

export function useRestoreBackup(siteId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (backupId: string) => redirectsApi.restoreBackup(siteId, backupId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mcp-change-counts', siteId] })
      qc.invalidateQueries({ queryKey: ['mcp-changes', siteId] })
    },
  })
}
