import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { agentApi } from '@/api/agent'

export function useAgentSessions(siteId: string) {
  return useQuery({
    queryKey: ['agent-sessions', siteId],
    queryFn: () => agentApi.getSessions(siteId),
    enabled: !!siteId,
  })
}

export function useCreateSession(siteId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => agentApi.createSession(siteId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent-sessions', siteId] }),
  })
}

export function useDeleteSession(siteId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (sessionId: string) => agentApi.deleteSession(sessionId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent-sessions', siteId] }),
  })
}

export function useSessionMessages(sessionId: string | null) {
  return useQuery({
    queryKey: ['agent-messages', sessionId],
    queryFn: () => agentApi.getMessages(sessionId!),
    enabled: !!sessionId,
  })
}
