import apiClient from './client'

export interface SettingPublic {
  key: string
  value: string | null
  isSet: boolean
  isSecret: boolean
}

export const settingsApi = {
  list: async (): Promise<SettingPublic[]> => {
    const { data } = await apiClient.get<{ data: SettingPublic[] }>('/api/settings')
    return data.data
  },

  upsert: async (key: string, value: string | null): Promise<void> => {
    await apiClient.put(`/api/settings/${key}`, { value })
  },
}
