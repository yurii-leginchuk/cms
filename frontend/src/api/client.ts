import axios from 'axios'

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
  headers: {
    'Content-Type': 'application/json',
  },
})

// Shared machine key for the API-key gate (ApiKeyGuard). Only sent when
// VITE_CMS_API_KEY is set; the gate is otherwise disabled, so this is a no-op
// in plain local dev. Keeps the UI working when the backend requires the key.
const CMS_API_KEY = import.meta.env.VITE_CMS_API_KEY as string | undefined

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  if (CMS_API_KEY) {
    config.headers['X-API-Key'] = CMS_API_KEY
  }
  return config
})

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token')
      window.location.href = '/login'
    }
    // Surface the backend's message (NestJS wraps it as { message }) so
    // mutation onError toasts show the real cause instead of a generic
    // "Request failed with status code 500".
    const serverMsg = error.response?.data?.message
    if (serverMsg) {
      error.message = Array.isArray(serverMsg) ? serverMsg.join(', ') : serverMsg
    }
    return Promise.reject(error)
  },
)

export default apiClient
