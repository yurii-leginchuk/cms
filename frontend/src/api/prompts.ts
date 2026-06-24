import apiClient from './client'

export interface AiPrompt {
  id: string
  slug: string
  name: string
  description: string | null
  content: string
  model: string | null
  siteId: string | null
  isDefault: boolean
}

export const promptsApi = {
  list: async (): Promise<AiPrompt[]> => {
    const { data } = await apiClient.get<{ data: AiPrompt[] }>('/api/prompts')
    return data.data
  },

  listForSite: async (siteId: string): Promise<AiPrompt[]> => {
    const { data } = await apiClient.get<{ data: AiPrompt[] }>(`/api/prompts/sites/${siteId}`)
    return data.data
  },

  upsert: async (slug: string, content: string, name?: string, model?: string | null): Promise<AiPrompt> => {
    const { data } = await apiClient.put<{ data: AiPrompt }>(`/api/prompts/${slug}`, {
      content,
      ...(name !== undefined && { name }),
      model: model ?? null,
    })
    return data.data
  },

  upsertForSite: async (siteId: string, slug: string, content: string): Promise<AiPrompt> => {
    const { data } = await apiClient.put<{ data: AiPrompt }>(
      `/api/prompts/sites/${siteId}/${slug}`,
      { content },
    )
    return data.data
  },

  resetForSite: async (siteId: string, slug: string): Promise<void> => {
    await apiClient.delete(`/api/prompts/sites/${siteId}/${slug}`)
  },
}
