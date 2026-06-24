import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { settingsApi } from '@/api/settings'

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.list,
    staleTime: 30 * 1000,
  })
}

export function useUpsertSetting() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: string | null }) =>
      settingsApi.upsert(key, value),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] })
    },
  })
}
