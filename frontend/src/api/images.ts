import apiClient from './client'

export type ImageAltStatus = 'synced' | 'ai_suggested' | 'modified' | 'removed'
export type ImageAltSource = 'original' | 'ai_generated' | 'human'
export type AltQuality =
  | 'absent'
  | 'empty'
  | 'junkFilename'
  | 'placeholder'
  | 'meaningful'

export interface SiteImageRow {
  id: string
  canonicalKey: string
  canonicalUrl: string
  draftAlt: string | null
  observedAlt: string | null
  observedQuality: AltQuality
  status: ImageAltStatus
  source: ImageAltSource
  needsReview: boolean
  aiRationale: string | null
  evidence: string[]
  unverifiedClaims: string[]
  usageCount: number
  pages: { pageId: string; url: string }[]
  lastSeenAt: string | null
}

export interface ImageListResult {
  data: SiteImageRow[]
  meta: { total: number; page: number; limit: number; totalPages: number }
}

export interface ImageCoverage {
  imagesTotal: number
  imagesMissing: number
  placementsTotal: number
  placementsWithAlt: number
  pendingChanges: number
  asOf: string | null
}

export interface PendingImageItem {
  imageId: string
  canonicalUrl: string
  action: 'set' | 'clear'
  alt: string
  source: string
  needsReview: boolean
  usageCount: number
}

export interface ImagePendingSummary {
  totalImages: number
  totalSets: number
  totalClears: number
  reviewed: number
  unreviewed: number
  items: PendingImageItem[]
}

export interface ApplyAllResult {
  applied: number
  failed: number
  skippedUnreviewed: number
  perImage: { imageId: string; canonicalUrl: string; ok: boolean; error?: string }[]
}

const base = (siteId: string) => `/api/sites/${siteId}/images`

export async function listImages(
  siteId: string,
  params: { page: number; limit: number; missingOnly: boolean; search?: string },
): Promise<ImageListResult> {
  const { data } = await apiClient.get(base(siteId), {
    params: {
      page: params.page,
      limit: params.limit,
      missingOnly: params.missingOnly,
      search: params.search ?? '',
    },
  })
  return data.data
}

export async function getImageCoverage(siteId: string): Promise<ImageCoverage> {
  const { data } = await apiClient.get(`${base(siteId)}/coverage`)
  return data.data
}

export async function reconcileImages(siteId: string) {
  const { data } = await apiClient.post(`${base(siteId)}/reconcile`)
  return data.data
}

export async function generateMissing(siteId: string) {
  const { data } = await apiClient.post(`${base(siteId)}/generate-missing`)
  return data.data
}

export async function getImagePendingSummary(siteId: string): Promise<ImagePendingSummary> {
  const { data } = await apiClient.get(`${base(siteId)}/pending-summary`)
  return data.data
}

export async function applyAllImages(
  siteId: string,
  includeUnreviewed: boolean,
): Promise<ApplyAllResult> {
  const { data } = await apiClient.post(`${base(siteId)}/apply-all`, { includeUnreviewed })
  return data.data
}

export async function generateForImage(siteId: string, imageId: string): Promise<SiteImageRow> {
  const { data } = await apiClient.post(`${base(siteId)}/${imageId}/generate`)
  return data.data
}

export async function setImageAlt(
  siteId: string,
  imageId: string,
  alt: string,
): Promise<SiteImageRow> {
  const { data } = await apiClient.put(`${base(siteId)}/${imageId}/alt`, { alt })
  return data.data
}

export async function approveImage(siteId: string, imageId: string) {
  const { data } = await apiClient.post(`${base(siteId)}/${imageId}/approve`)
  return data.data
}

export async function revertImage(siteId: string, imageId: string) {
  const { data } = await apiClient.post(`${base(siteId)}/${imageId}/revert`)
  return data.data
}

export async function applyImage(siteId: string, imageId: string) {
  const { data } = await apiClient.post(`${base(siteId)}/${imageId}/apply`)
  return data.data
}
