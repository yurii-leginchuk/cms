import { useHealthCheck } from '@/hooks/useHealthCheck'

export default function HomePage() {
  const { data, isLoading, isError } = useHealthCheck()

  return (
    <div className="max-w-md">
      <h2 className="text-2xl font-bold text-gray-900 mb-4">Dashboard</h2>
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <p className="text-sm text-gray-500 mb-2">API Status</p>
        {isLoading && <span className="text-yellow-600">Checking...</span>}
        {isError && <span className="text-red-600">Unavailable</span>}
        {data && <span className="text-green-600">Online</span>}
      </div>
    </div>
  )
}
