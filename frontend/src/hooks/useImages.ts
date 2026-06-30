import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import * as imagesApi from '@/api/images'

export function useImages(
  siteId: string,
  params: { page: number; limit: number; missingOnly: boolean; search?: string },
) {
  return useQuery({
    queryKey: ['images', siteId, params.page, params.limit, params.missingOnly, params.search ?? ''],
    queryFn: () => imagesApi.listImages(siteId, params),
    enabled: !!siteId,
    staleTime: 15_000,
  })
}

export function useImageCoverage(siteId: string) {
  return useQuery({
    queryKey: ['image-coverage', siteId],
    queryFn: () => imagesApi.getImageCoverage(siteId),
    enabled: !!siteId,
    staleTime: 15_000,
  })
}

export function useImagePendingSummary(siteId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['image-pending-summary', siteId],
    queryFn: () => imagesApi.getImagePendingSummary(siteId),
    enabled: !!siteId && enabled,
  })
}

/** Invalidate every image-related query after a mutation. */
function useInvalidateImages(siteId: string) {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: ['images', siteId] })
    qc.invalidateQueries({ queryKey: ['image-coverage', siteId] })
    qc.invalidateQueries({ queryKey: ['image-pending-summary', siteId] })
  }
}

export function useReconcileImages(siteId: string) {
  const invalidate = useInvalidateImages(siteId)
  return useMutation({
    mutationFn: () => imagesApi.reconcileImages(siteId),
    onSuccess: invalidate,
  })
}

export function useGenerateMissing(siteId: string) {
  const invalidate = useInvalidateImages(siteId)
  return useMutation({
    mutationFn: () => imagesApi.generateMissing(siteId),
    onSuccess: invalidate,
  })
}

export function useGenerateForImage(siteId: string) {
  const invalidate = useInvalidateImages(siteId)
  return useMutation({
    mutationFn: (imageId: string) => imagesApi.generateForImage(siteId, imageId),
    onSuccess: invalidate,
  })
}

export function useSetImageAlt(siteId: string) {
  const invalidate = useInvalidateImages(siteId)
  return useMutation({
    mutationFn: (v: { imageId: string; alt: string }) =>
      imagesApi.setImageAlt(siteId, v.imageId, v.alt),
    onSuccess: invalidate,
  })
}

export function useUploadOgImage(siteId: string) {
  return useMutation({
    mutationFn: (file: File) => imagesApi.uploadOgImage(siteId, file),
  })
}

export function useApproveImage(siteId: string) {
  const invalidate = useInvalidateImages(siteId)
  return useMutation({
    mutationFn: (imageId: string) => imagesApi.approveImage(siteId, imageId),
    onSuccess: invalidate,
  })
}

export function useRevertImage(siteId: string) {
  const invalidate = useInvalidateImages(siteId)
  return useMutation({
    mutationFn: (imageId: string) => imagesApi.revertImage(siteId, imageId),
    onSuccess: invalidate,
  })
}

export function useApplyImage(siteId: string) {
  const invalidate = useInvalidateImages(siteId)
  return useMutation({
    mutationFn: (imageId: string) => imagesApi.applyImage(siteId, imageId),
    onSuccess: invalidate,
  })
}

export function useApplyAllImages(siteId: string) {
  const invalidate = useInvalidateImages(siteId)
  return useMutation({
    mutationFn: (includeUnreviewed: boolean) => imagesApi.applyAllImages(siteId, includeUnreviewed),
    onSuccess: invalidate,
  })
}
