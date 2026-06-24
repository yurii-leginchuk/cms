import apiClient from './client'

export interface ChatSession {
  id: string
  siteId: string
  title: string | null
  createdAt: string
  updatedAt: string
}

export interface ChatMessageRecord {
  id: string
  sessionId: string
  role: 'user' | 'assistant'
  content: string | null
  toolInvocations: any[] | null
  createdAt: string
}

export function agentChatUrl(sessionId: string): string {
  const base = (import.meta.env.VITE_API_URL as string) || ''
  return `${base}/api/agent/sessions/${sessionId}/chat`
}

export const agentApi = {
  createSession: async (siteId: string): Promise<ChatSession> => {
    const { data } = await apiClient.post<{ data: ChatSession }>('/api/agent/sessions', {
      siteId,
    })
    return data.data
  },

  getSessions: async (siteId: string): Promise<ChatSession[]> => {
    const { data } = await apiClient.get<{ data: ChatSession[] }>(
      `/api/agent/sessions/site/${siteId}`,
    )
    return data.data
  },

  getMessages: async (sessionId: string): Promise<ChatMessageRecord[]> => {
    const { data } = await apiClient.get<{ data: ChatMessageRecord[] }>(
      `/api/agent/sessions/${sessionId}/messages`,
    )
    return data.data
  },

  deleteSession: async (sessionId: string): Promise<void> => {
    await apiClient.delete(`/api/agent/sessions/${sessionId}`)
  },
}
