import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { schemaApi } from '@/api/schema'
import type { CreateManagedPayload, UpdateManagedPayload } from '@/api/schema'

export function useSchemas(siteId: string, pageId: string | null) {
  return useQuery({
    queryKey: ['schemas', siteId, pageId],
    queryFn: () => schemaApi.get(siteId, pageId!),
    enabled: !!pageId && !!siteId,
    staleTime: 30_000,
  })
}

export function useDetectSchemas(siteId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (pageId: string) => schemaApi.detect(siteId, pageId),
    onSuccess: (result, pageId) => {
      qc.setQueryData(['schemas', siteId, pageId], {
        result,
        checkedAt: new Date().toISOString(),
      })
      // Detection auto-persists into the managed set → refresh it + counts.
      qc.invalidateQueries({ queryKey: ['managed-schemas', siteId, pageId] })
      qc.invalidateQueries({ queryKey: ['schema-pending', siteId, pageId] })
      qc.invalidateQueries({ queryKey: ['schema-pages', siteId] })
      qc.invalidateQueries({ queryKey: ['schema-coverage', siteId] })
    },
  })
}

export function useAnalyzeSchemas(siteId: string) {
  return useMutation({
    mutationFn: (pageId: string) => schemaApi.analyze(siteId, pageId),
  })
}

export function useValidateJsonLd(siteId: string, pageId: string) {
  return useMutation({
    mutationFn: (jsonld: unknown) => schemaApi.validate(siteId, pageId, jsonld),
  })
}

export function useManagedSchemas(siteId: string, pageId: string | null) {
  return useQuery({
    queryKey: ['managed-schemas', siteId, pageId],
    queryFn: () => schemaApi.listManaged(siteId, pageId!),
    enabled: !!pageId && !!siteId,
    staleTime: 30_000,
  })
}

export function useCreateManaged(siteId: string, pageId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateManagedPayload) =>
      schemaApi.createManaged(siteId, pageId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['managed-schemas', siteId, pageId] })
      qc.invalidateQueries({ queryKey: ['schema-pending', siteId, pageId] })
      qc.invalidateQueries({ queryKey: ['schema-pages', siteId] })
      qc.invalidateQueries({ queryKey: ['schema-coverage', siteId] })
    },
  })
}

export function useUpdateManaged(siteId: string, pageId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      schemaId,
      payload,
    }: {
      schemaId: string
      payload: UpdateManagedPayload
    }) => schemaApi.updateManaged(siteId, pageId, schemaId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['managed-schemas', siteId, pageId] })
      qc.invalidateQueries({ queryKey: ['schema-pending', siteId, pageId] })
      qc.invalidateQueries({ queryKey: ['schema-pages', siteId] })
      qc.invalidateQueries({ queryKey: ['schema-coverage', siteId] })
    },
  })
}

export function useDeleteManaged(siteId: string, pageId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (schemaId: string) =>
      schemaApi.deleteManaged(siteId, pageId, schemaId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['managed-schemas', siteId, pageId] })
      qc.invalidateQueries({ queryKey: ['schema-pending', siteId, pageId] })
      qc.invalidateQueries({ queryKey: ['schema-pages', siteId] })
      qc.invalidateQueries({ queryKey: ['schema-coverage', siteId] })
    },
  })
}

export function usePendingChanges(siteId: string, pageId: string | null) {
  return useQuery({
    queryKey: ['schema-pending', siteId, pageId],
    queryFn: () => schemaApi.pending(siteId, pageId!),
    enabled: !!pageId && !!siteId,
    staleTime: 15_000,
  })
}

export function useApplySchemas(siteId: string, pageId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => schemaApi.apply(siteId, pageId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['managed-schemas', siteId, pageId] })
      qc.invalidateQueries({ queryKey: ['schema-pending', siteId, pageId] })
      qc.invalidateQueries({ queryKey: ['schema-history', siteId, pageId] })
      // Apply auto re-parses the live page → refresh the detection view too.
      qc.invalidateQueries({ queryKey: ['schemas', siteId, pageId] })
      qc.invalidateQueries({ queryKey: ['schema-pages', siteId] })
      qc.invalidateQueries({ queryKey: ['schema-coverage', siteId] })
    },
  })
}

export function useUnpublishSchemas(siteId: string, pageId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => schemaApi.unpublish(siteId, pageId),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['managed-schemas', siteId, pageId] }),
  })
}

export function useSchemaHistory(siteId: string, pageId: string | null) {
  return useQuery({
    queryKey: ['schema-history', siteId, pageId],
    queryFn: () => schemaApi.history(siteId, pageId!),
    enabled: !!pageId && !!siteId,
    staleTime: 30_000,
  })
}

export function useQcSchemas(siteId: string, pageId: string) {
  return useMutation({
    mutationFn: () => schemaApi.qc(siteId, pageId),
  })
}

export function useReparseSchemas(siteId: string, pageId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => schemaApi.reparse(siteId, pageId),
    onSuccess: (result) => {
      qc.setQueryData(['schemas', siteId, pageId], {
        result,
        checkedAt: new Date().toISOString(),
      })
      qc.invalidateQueries({ queryKey: ['managed-schemas', siteId, pageId] })
      qc.invalidateQueries({ queryKey: ['schema-pending', siteId, pageId] })
      qc.invalidateQueries({ queryKey: ['schema-pages', siteId] })
    },
  })
}

export function useDetectAllSchemas(siteId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => schemaApi.detectAll(siteId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schema-pages', siteId] })
      qc.invalidateQueries({ queryKey: ['schema-coverage', siteId] })
    },
  })
}

export function usePendingSummary(siteId: string, enabled = true) {
  return useQuery({
    queryKey: ['schema-pending-summary', siteId],
    queryFn: () => schemaApi.pendingSummary(siteId),
    enabled: !!siteId && enabled,
    staleTime: 0,
  })
}

export function useApplyAll(siteId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => schemaApi.applyAll(siteId),
    onSuccess: () => {
      // Apply-all touches many pages → refresh the site-wide views and, via a
      // predicate, every per-page key for this site (managed / pending /
      // detection / history) so any open page view reflects the new state.
      qc.invalidateQueries({ queryKey: ['schema-coverage', siteId] })
      qc.invalidateQueries({ queryKey: ['schema-pages', siteId] })
      qc.invalidateQueries({ queryKey: ['schema-pending-summary', siteId] })
      qc.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey
          return (
            Array.isArray(k) &&
            k[1] === siteId &&
            (k[0] === 'managed-schemas' ||
              k[0] === 'schema-pending' ||
              k[0] === 'schemas' ||
              k[0] === 'schema-history')
          )
        },
      })
    },
  })
}

export function useSchemaCoverage(siteId: string) {
  return useQuery({
    queryKey: ['schema-coverage', siteId],
    queryFn: () => schemaApi.coverage(siteId),
    enabled: !!siteId,
    staleTime: 60_000,
  })
}

export function useSchemaPages(siteId: string, page = 1, limit = 25, search = '') {
  return useQuery({
    queryKey: ['schema-pages', siteId, page, limit, search],
    queryFn: () => schemaApi.pagesOverview(siteId, page, limit, search),
    enabled: !!siteId,
    placeholderData: (prev) => prev,
    staleTime: 15_000,
  })
}
