import { Gauge } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { useSettings } from '@/hooks/useSettings'

interface Props {
  siteId: string
}

export function PsiStatus({ siteId }: Props) {
  const { data: settings = [], isLoading } = useSettings()

  if (isLoading) return null

  const key1 = settings.find((s) => s.key === 'psi_api_key')
  const key2 = settings.find((s) => s.key === 'psi_api_key_2')

  if (!key1?.isSet) {
    return (
      <Link to="/settings" title="PageSpeed API key not configured">
        <Badge
          variant="outline"
          className="gap-1.5 text-[11px] font-medium cursor-pointer animate-pulse bg-red-500/15 text-red-400 border-red-500/25 hover:bg-red-500/25 hover:animate-none"
        >
          <Gauge className="size-3" />
          No PSI key
        </Badge>
      </Link>
    )
  }

  const label = key2?.isSet ? 'PageSpeed ×2' : 'PageSpeed'

  return (
    <Link to={`/sites/${siteId}/pagespeed`}>
      <Badge
        variant="outline"
        className="gap-1.5 text-[11px] font-medium bg-blue-500/15 text-blue-400 border-blue-500/20 hover:bg-blue-500/25 cursor-pointer"
      >
        <Gauge className="size-3" />
        {label}
      </Badge>
    </Link>
  )
}
