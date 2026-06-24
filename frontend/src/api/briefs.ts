import apiClient from './client'

export type BriefStatus = 'draft' | 'in_progress' | 'applied'
export type BriefType = 'new_page_draft' | 'existing_page_rewrite'

export interface Recommendation {
  evidence: {
    metric: string
    source: 'gsc' | 'psi' | 'semrush' | 'onpage' | 'internal_links'
    dateRange: string | null
  }
  reasoning: string
  action: {
    type: 'new_page' | 'meta' | 'internal_link' | 'content' | 'noindex'
    targetUrl: string
    anchorText: string | null
    sourcePage: string | null
  }
  expectedImpact: {
    estimate: string | null
    label: 'calculated' | 'directional_not_calculated'
  }
}

export interface Brief {
  id: string
  siteId: string
  // User-supplied custom title; falls back to meta title / page URL when null.
  name: string | null
  pageId: string | null
  pageUrl: string
  proposedMetaTitle: string | null
  proposedMetaDescription: string | null
  proposedSlug: string | null
  proposedContent: string | null
  proposedSchema: string | null
  keywordStrategy: string | null
  internalLinks: { anchor: string; targetUrl: string }[] | null
  // Structured arguments (Proposal 9). Legacy briefs may still hold a string.
  recommendations: Recommendation[] | string | null
  unverifiedClaims: string[] | null
  sectionSources: { sectionHeading: string; source: string }[] | null
  status: BriefStatus
  // Date (YYYY-MM-DD) the brief was applied; set only when status is 'applied'.
  appliedAt: string | null
  briefType?: BriefType
  createdAt: string
  updatedAt: string
}

export interface CreateBriefPayload {
  name?: string | null
  pageId?: string | null
  pageUrl: string
  proposedMetaTitle?: string | null
  proposedMetaDescription?: string | null
  proposedSlug?: string | null
  proposedContent?: string | null
  proposedSchema?: string | null
  keywordStrategy?: string | null
  internalLinks?: { anchor: string; targetUrl: string }[]
  recommendations?: string | null
}

export interface UpdateBriefPayload {
  name?: string | null
  pageId?: string | null
  pageUrl?: string
  proposedMetaTitle?: string | null
  proposedMetaDescription?: string | null
  proposedSlug?: string | null
  proposedContent?: string | null
  proposedSchema?: string | null
  keywordStrategy?: string | null
  internalLinks?: { anchor: string; targetUrl: string }[]
  recommendations?: Recommendation[] | null
  unverifiedClaims?: string[] | null
  status?: BriefStatus
  appliedAt?: string | null
}

export type BriefExportResult =
  | { kind: 'docx' }
  | { kind: 'gdoc'; url: string }

export const briefsApi = {
  create: async (siteId: string, payload: CreateBriefPayload): Promise<Brief> => {
    const { data } = await apiClient.post<{ data: Brief }>(
      `/api/sites/${siteId}/briefs`,
      payload,
    )
    return data.data
  },

  list: async (siteId: string, pageId?: string): Promise<Brief[]> => {
    const { data } = await apiClient.get<{ data: Brief[] }>(
      `/api/sites/${siteId}/briefs`,
      { params: pageId ? { pageId } : {} },
    )
    return data.data
  },

  get: async (siteId: string, id: string): Promise<Brief> => {
    const { data } = await apiClient.get<{ data: Brief }>(
      `/api/sites/${siteId}/briefs/${id}`,
    )
    return data.data
  },

  update: async (siteId: string, id: string, payload: UpdateBriefPayload): Promise<Brief> => {
    const { data } = await apiClient.patch<{ data: Brief }>(
      `/api/sites/${siteId}/briefs/${id}`,
      payload,
    )
    return data.data
  },

  remove: async (siteId: string, id: string): Promise<void> => {
    await apiClient.delete(`/api/sites/${siteId}/briefs/${id}`)
  },

  /**
   * Export a brief. Primary path returns a .docx binary (downloaded as a Blob).
   * When the server has Google Docs configured it returns JSON {data:{url}}.
   */
  export: async (siteId: string, id: string): Promise<BriefExportResult> => {
    const res = await apiClient.post(`/api/sites/${siteId}/briefs/${id}/export`, null, {
      responseType: 'blob',
    })
    const blob = res.data as Blob
    const contentType = (res.headers['content-type'] as string) || ''

    if (contentType.includes('application/json')) {
      const text = await blob.text()
      const parsed = JSON.parse(text)
      return { kind: 'gdoc', url: parsed?.data?.url }
    }

    // .docx download
    const disposition = (res.headers['content-disposition'] as string) || ''
    const match = /filename="([^"]+)"/.exec(disposition)
    const filename = match ? match[1] : `content-brief-${id}.docx`

    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.URL.revokeObjectURL(url)
    return { kind: 'docx' }
  },
}
