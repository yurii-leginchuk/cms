import { useState } from 'react'
import {
  WifiOff, Wifi, Key, RefreshCw, CheckCircle2,
  Download, ChevronRight, AlertCircle,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { useWpStatus } from '@/hooks/useSites'

/* ─── reason → display config ───────────────────────────────────────────────── */

const REASON_CONFIG: Record<string, { title: string; description: string; icon: React.ElementType }> = {
  no_key: {
    title: 'API Key not configured',
    description: 'The WordPress plugin is not connected. Install it and paste the API key in Site Settings.',
    icon: Key,
  },
  invalid_key: {
    title: 'Invalid API key',
    description: 'The API key doesn\'t match what\'s configured in the WordPress plugin. Re-copy it from WP admin.',
    icon: AlertCircle,
  },
  plugin_not_found: {
    title: 'Plugin not found',
    description: 'The Poirier CMS plugin does not appear to be installed or activated on this site.',
    icon: WifiOff,
  },
  unreachable: {
    title: 'Cannot reach WordPress',
    description: 'The site is unreachable or the plugin is not responding. Check that the site is online.',
    icon: WifiOff,
  },
}

/* ─── Installation guide ─────────────────────────────────────────────────────── */

const STEPS = [
  'Click <strong>Download Plugin</strong> below and save the zip.',
  'In WP admin go to <strong>Plugins → Add New → Upload Plugin</strong>.',
  'Select the zip, install and <strong>Activate</strong> the plugin.',
  'Go to <strong>Settings → Poirier CMS</strong> and copy the API key.',
  'In this CMS, open <strong>Site Settings (⚙)</strong> on the site page and paste the key.',
]

/* ─── Modal ──────────────────────────────────────────────────────────────────── */

interface ModalProps {
  open: boolean
  onClose: () => void
  reason: string | undefined
  onVerify: () => Promise<unknown>
}

function WpPluginModal({ open, onClose, reason, onVerify }: ModalProps) {
  const [verifying, setVerifying] = useState(false)
  const [verifyResult, setVerifyResult] = useState<null | 'ok' | 'fail'>(null)
  const cfg = REASON_CONFIG[reason ?? 'unreachable'] ?? REASON_CONFIG.unreachable
  const Icon = cfg.icon

  async function handleVerify() {
    setVerifying(true)
    setVerifyResult(null)
    try {
      const result = await onVerify() as { connected?: boolean } | undefined
      const connected = (result as { data?: { connected?: boolean } })?.data?.connected
        ?? (result as { connected?: boolean })?.connected
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

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px] border-white/8 bg-[#1a1d27] text-[#e8eaed] p-0 overflow-hidden">
        {/* Colored top bar */}
        <div className={`h-1 w-full ${reason === 'no_key' ? 'bg-[#9aa0a6]/30' : 'bg-amber-500/50'}`} />

        <div className="px-6 pt-5 pb-6 space-y-5">
          <DialogHeader className="space-y-2">
            <div className="flex items-center gap-3">
              <div className={`size-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                reason === 'no_key'
                  ? 'bg-[#232635] border border-white/8'
                  : 'bg-amber-500/15 border border-amber-500/20'
              }`}>
                <Icon className={`size-4 ${reason === 'no_key' ? 'text-[#9aa0a6]' : 'text-amber-400'}`} />
              </div>
              <DialogTitle className="text-[#e8eaed] text-[15px] font-semibold">
                {cfg.title}
              </DialogTitle>
            </div>
            <p className="text-[13px] text-[#9aa0a6] leading-relaxed pl-12">
              {cfg.description}
            </p>
          </DialogHeader>

          {/* Installation guide */}
          <div className="rounded-xl border border-white/8 bg-[#0f1117] overflow-hidden">
            <div className="px-4 py-3 border-b border-white/8 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Download className="size-3.5 text-[#9aa0a6]" />
                <p className="text-[11px] font-semibold text-[#9aa0a6] uppercase tracking-widest">
                  Plugin setup guide
                </p>
              </div>
              <a
                href="/poirier-cms.zip"
                download="poirier-cms.zip"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#4e8af4]/15 hover:bg-[#4e8af4]/25 text-[#4e8af4] text-[11px] font-medium transition-colors"
              >
                <Download className="size-3" />
                Download Plugin
              </a>
            </div>
            <ol className="px-4 py-3 space-y-2.5">
              {STEPS.map((step, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="size-5 rounded-full bg-white/5 border border-white/8 text-[10px] font-semibold text-[#9aa0a6] flex items-center justify-center flex-shrink-0 mt-px">
                    {i + 1}
                  </span>
                  <p
                    className="text-[12px] text-[#9aa0a6] leading-relaxed [&_strong]:text-[#e8eaed] [&_strong]:font-medium"
                    dangerouslySetInnerHTML={{ __html: step }}
                  />
                </li>
              ))}
            </ol>
          </div>

          {/* Verify result feedback */}
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
              <><ChevronRight className="size-3.5" />Verify Connection</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ─── Badge ──────────────────────────────────────────────────────────────────── */

interface Props {
  siteId: string
}

export function WpPluginStatus({ siteId }: Props) {
  const [modalOpen, setModalOpen] = useState(false)
  const { data, isLoading, refetch } = useWpStatus(siteId)

  if (isLoading) return null

  if (data?.connected) {
    return (
      <Badge
        variant="outline"
        className="gap-1.5 text-[11px] font-medium bg-emerald-500/15 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/15"
      >
        <Wifi className="size-3" />
        WP Plugin
      </Badge>
    )
  }

  const isNoKey = data?.reason === 'no_key'

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
          {isNoKey ? <Key className="size-3" /> : <WifiOff className="size-3" />}
          {isNoKey ? 'No API key' : 'WP Offline'}
        </Badge>
      </button>

      <WpPluginModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        reason={data?.reason}
        onVerify={() => refetch()}
      />
    </>
  )
}
