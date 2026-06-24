import { useParams, Navigate, useLocation } from 'react-router-dom'
import SiteChat from '@/components/SiteChat'

export default function SiteChatPage() {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const state = location.state as { sessionId?: string } | null

  if (!id) return <Navigate to="/sites" replace />

  return (
    <SiteChat
      key={id}
      siteId={id}
      initialSessionId={state?.sessionId}
      hideSessionSidebar={false}
    />
  )
}
