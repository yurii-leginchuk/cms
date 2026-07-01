import { useState } from 'react'
import { BarChart3, WifiOff, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { useGa4Status } from '@/hooks/useGa4'
import type { Ga4Status as Ga4StatusData } from '@/api/ga4'

interface ModalProps {
  open: boolean
  onClose: () => void
  reason: Ga4StatusData['reason']
  onVerify: () => Promise<unknown>
}

function Ga4Modal({ open, onClose, reason, onVerify }: ModalProps) {
  const [verifying, setVerifying] = useState(false)
  const [verifyResult, setVerifyResult] = useState<null | 'ok' | 'fail'>(null)

  const isNoCreds = reason === 'no_credentials'

  async function handleVerify() {
    setVerifying(true)
    setVerifyResult(null)
    try {
      const result = await onVerify() as any
      const connected = result?.data?.connected ?? result?.connected
      if (connected) {
        setVerifyResult('ok')
        setTimeout(onClose, 1400)
      } else {
        setVerifyResult('fail')
      }
    } catch {
      setVerifyResult('fail')
    } finally {
      setVerifying(false)
    }
  }

  function handleOpenChange(o: boolean) {
    if (!o) { setVerifyResult(null); onClose() }
  }

  const title = isNoCreds
    ? 'No GA4 credentials file'
    : reason === 'access_denied'
      ? 'Service account lacks GA4 access'
      : 'GA4 property not found'

  const subtitle = isNoCreds
    ? 'A Google service account JSON file is required. Place it at the path shown below and restart the backend.'
    : reason === 'access_denied'
      ? 'The service account exists but does not have access to this GA4 property. Add it as a Viewer.'
      : 'No GA4 property has a data stream matching this site domain. Confirm the site is measured in Analytics and the service account can see it.'

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px] border-white/8 bg-[#1a1d27] text-[#e8eaed] p-0 overflow-hidden">
        <div className="h-1 w-full bg-amber-500/30" />

        <div className="px-6 pt-5 pb-6 space-y-5">
          <DialogHeader className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="size-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-amber-500/15 border border-amber-500/20">
                <BarChart3 className="size-4 text-amber-400" />
              </div>
              <DialogTitle className="text-[#e8eaed] text-[15px] font-semibold">
                {title}
              </DialogTitle>
            </div>
            <p className="text-[13px] text-[#9aa0a6] leading-relaxed pl-12">
              {subtitle}
            </p>
          </DialogHeader>

          <div className="rounded-xl border border-white/8 bg-[#0f1117] overflow-hidden">
            <div className="px-4 py-3 border-b border-white/8">
              <p className="text-[11px] font-semibold text-[#9aa0a6] uppercase tracking-widest">
                {isNoCreds ? 'Setup steps' : 'How to fix'}
              </p>
            </div>
            <ol className="px-4 py-3 space-y-2.5">
              {isNoCreds ? (
                <>
                  <Step n={1}>Go to <strong>Google Cloud Console → IAM → Service Accounts</strong></Step>
                  <Step n={2}>Create a service account and download the <strong>JSON key</strong></Step>
                  <Step n={3}>Place the file at <code className="text-[#4e8af4] text-[11px]">./gsc-credentials.json</code> in the CMS root</Step>
                  <Step n={4}>Restart the backend container</Step>
                  <Step n={5}>Enable the <strong>Google Analytics Data API</strong> for the project</Step>
                </>
              ) : (
                <>
                  <Step n={1}>Open <strong>Google Analytics</strong> → <strong>Admin</strong></Step>
                  <Step n={2}>Under <strong>Property → Property Access Management</strong>, click <strong>Add</strong></Step>
                  <Step n={3}>Paste the service account email from Settings and grant <strong>Viewer</strong></Step>
                  <Step n={4}>Confirm the property has a <strong>web data stream</strong> for this site's domain</Step>
                  <Step n={5}>Click <strong>Verify</strong> below (may take a minute to propagate)</Step>
                </>
              )}
            </ol>
          </div>

          {verifyResult === 'ok' && (
            <div className="flex items-center gap-2.5 px-4 py-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <CheckCircle2 className="size-4 text-emerald-400 flex-shrink-0" />
              <p className="text-[13px] text-emerald-400 font-medium">Connected successfully!</p>
            </div>
          )}
          {verifyResult === 'fail' && (
            <div className="flex items-center gap-2.5 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20">
              <AlertCircle className="size-4 text-red-400 flex-shrink-0" />
              <p className="text-[13px] text-red-400">Still not connected. Follow the steps above and try again.</p>
            </div>
          )}
        </div>

        <DialogFooter className="px-6 py-5 border-t border-white/8 flex gap-3">
          <Button
            variant="ghost"
            onClick={onClose}
            className="flex-1 h-10 text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-white/5"
          >
            Close
          </Button>
          <Button
            onClick={handleVerify}
            disabled={verifying || verifyResult === 'ok'}
            className="flex-1 h-10 bg-[#4e8af4] hover:bg-[#4e8af4]/90 text-white gap-2"
          >
            {verifying ? (
              <><RefreshCw className="size-3.5 animate-spin" />Checking…</>
            ) : verifyResult === 'ok' ? (
              <><CheckCircle2 className="size-3.5" />Connected</>
            ) : (
              'Verify Connection'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="size-5 rounded-full bg-white/5 border border-white/8 text-[10px] font-semibold text-[#9aa0a6] flex items-center justify-center flex-shrink-0 mt-px">
        {n}
      </span>
      <p className="text-[12px] text-[#9aa0a6] leading-relaxed [&_strong]:text-[#e8eaed] [&_strong]:font-medium [&_code]:text-[#4e8af4]">
        {children}
      </p>
    </li>
  )
}

export function Ga4Status({ siteId }: { siteId: string | undefined }) {
  const [modalOpen, setModalOpen] = useState(false)
  const { data, isLoading, refetch } = useGa4Status(siteId)

  if (isLoading || !siteId) return null

  if (data?.connected) {
    return (
      <Badge
        variant="outline"
        className="gap-1.5 text-[11px] font-medium bg-emerald-500/15 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/15"
        title={data.displayName ? `GA4 · ${data.displayName}` : 'Google Analytics 4 connected'}
      >
        <BarChart3 className="size-3" />
        GA4
      </Badge>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setModalOpen(true) }}
      >
        <Badge
          variant="outline"
          className="gap-1.5 text-[11px] font-medium cursor-pointer animate-pulse bg-red-500/15 text-red-400 border-red-500/25 hover:bg-red-500/25 hover:animate-none"
        >
          <WifiOff className="size-3" />
          {data?.reason === 'no_credentials' ? 'No GA4 key' : 'GA4 offline'}
        </Badge>
      </button>

      <Ga4Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        reason={data?.reason}
        onVerify={() => refetch()}
      />
    </>
  )
}
