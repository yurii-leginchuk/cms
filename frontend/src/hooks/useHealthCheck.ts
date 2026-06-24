import { useQuery } from '@tanstack/react-query'
import apiClient from '@/api/client'

interface HealthResponse {
  data: {
    status: string
    timestamp: string
  }
}

export function useHealthCheck() {
  return useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const { data } = await apiClient.get<HealthResponse>('/api/health')
      return data
    },
  })
}
