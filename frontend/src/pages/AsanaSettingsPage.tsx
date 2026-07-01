import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import {
  ChevronLeft, ChevronRight, CheckSquare, Check, X, RefreshCw, Plug, Unplug,
  AlertTriangle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { RelativeClock } from '@/components/index-status/RelativeClock'
import { useSites } from '@/hooks/useSites'
import {
  useAsanaConnection, useSetAsanaPat, useDisconnectAsana, useVerifyAsana,
  useSetAsanaWorkspace, useAsanaProjects, useAsanaMapping, useSetAsanaMapping,
} from '@/hooks/useAsana'
import type { AsanaProject, AsanaWorkspace } from '@/api/asana'

const selectCls =
  'h-9 px-3 pr-8 rounded-lg bg-[#1a1d27] border border-white/8 text-[13px] text-[#e8eaed] focus:outline-none focus:ring-1 focus:ring-[#4e8af4]/50 appearance-none cursor-pointer'
const selectBg = {
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239aa0a6' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 10px center',
}

function Chip({ ok, done, label }: { ok?: boolean; done: boolean; label: string }) {
  const cls = done
    ? 'bg-emerald-400/10 text-emerald-300 border-emerald-400/25'
    : ok === false
      ? 'bg-red-400/10 text-red-300 border-red-400/25'
      : 'bg-white/[0.03] text-[#9aa0a6] border-white/10'
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium border ${cls}`}>
      {done ? <Check className="size-3" /> : ok === false ? <X className="size-3" /> : <span className="size-1.5 rounded-full bg-[#9aa0a6]/40" />}
      {label}
    </span>
  )
}

export default function AsanaSettingsPage() {
  const { data: conn, isLoading } = useAsanaConnection()
  const setPat = useSetAsanaPat()
  const disconnect = useDisconnectAsana()
  const verify = useVerifyAsana()
  const setWorkspace = useSetAsanaWorkspace()

  const [pat, setPatValue] = useState('')
  const [workspaces, setWorkspaces] = useState<AsanaWorkspace[]>([])

  const verified = conn?.status === 'verified'
  const hasWorkspace = !!conn?.workspaceGid

  async function handleSaveToken() {
    if (!pat.trim()) return
    try {
      await setPat.mutateAsync(pat.trim())
      setPatValue('')
      toast.success('Token saved. Click "Test connection" to verify it.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save the token.")
    }
  }

  async function handleVerify() {
    try {
      const res = await verify.mutateAsync()
      setWorkspaces(res.workspaces)
      if (res.connection.status === 'verified') {
        toast.success(`Connected as ${res.connection.userName ?? 'Asana user'}.`)
      } else {
        toast.error(res.connection.lastError ?? 'Verification failed.')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Verification failed.')
    }
  }

  async function handleDisconnect() {
    try {
      await disconnect.mutateAsync()
      setWorkspaces([])
      toast.success('Asana disconnected.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't disconnect.")
    }
  }

  async function handleWorkspace(gid: string) {
    try {
      await setWorkspace.mutateAsync(gid)
      toast.success('Workspace selected.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't set the workspace.")
    }
  }

  // Workspace options: the last verify result, or the currently-pinned one.
  const wsOptions =
    workspaces.length > 0
      ? workspaces
      : conn?.workspaceGid
        ? [{ gid: conn.workspaceGid, name: conn.workspaceName ?? conn.workspaceGid }]
        : []

  return (
    <div className="min-h-full">
      {/* Header */}
      <div className="border-b border-white/8 px-8 py-5">
        <div className="flex items-center gap-1.5 text-[13px] mb-3">
          <Link to="/settings" className="text-[#9aa0a6] hover:text-[#e8eaed] flex items-center gap-1">
            <ChevronLeft className="size-3.5" />Settings
          </Link>
          <ChevronRight className="size-3.5 text-[#9aa0a6]/40" />
          <span className="text-[#e8eaed]">Asana</span>
        </div>
        <div className="flex items-center gap-3">
          <CheckSquare className="size-5 text-rose-400" />
          <h1 className="text-xl font-semibold text-[#e8eaed] tracking-tight">Asana</h1>
        </div>
        <p className="text-[13px] text-[#9aa0a6] mt-1">
          Connect a Personal Access Token, pick a workspace, then map each site to an Asana project.
        </p>
      </div>

      <div className="px-8 py-6 max-w-2xl space-y-4">
        {/* Connection card */}
        <div className="rounded-xl border border-white/8 bg-[#1a1d27] overflow-hidden">
          <div className="px-6 py-4 border-b border-white/8 flex items-center gap-3">
            <div className="size-9 rounded-lg bg-rose-500/15 flex items-center justify-center">
              <Plug className="size-4 text-rose-400" />
            </div>
            <div>
              <h2 className="text-[14px] font-semibold text-[#e8eaed]">Connection</h2>
              <p className="text-[12px] text-[#9aa0a6]">
                {conn?.userName ? `Connected as ${conn.userName}` : 'Personal Access Token'}
              </p>
            </div>
            {conn?.patSet && (
              <div className="ml-auto">
                <Chip done={verified} ok={conn.status !== 'failed'} label={verified ? 'Verified' : conn.status === 'failed' ? 'Invalid' : 'Untested'} />
              </div>
            )}
          </div>

          <div className="px-6 py-5 space-y-5">
            {isLoading ? (
              <div className="space-y-3">{[1, 2].map((i) => <div key={i} className="h-10 rounded-lg bg-white/5 animate-pulse" />)}</div>
            ) : (
              <>
                {/* Health checklist */}
                <div className="flex flex-wrap items-center gap-2">
                  <Chip done={!!conn?.patSet} label="Token set" />
                  <Chip done={verified} ok={conn?.status !== 'failed'} label="Token valid" />
                  <Chip done={hasWorkspace} label="Workspace selected" />
                </div>

                {conn?.status === 'failed' && conn.lastError && (
                  <div className="rounded-lg border border-red-400/20 bg-red-400/[0.04] px-4 py-3 flex items-start gap-2">
                    <AlertTriangle className="size-4 text-red-400 mt-0.5 flex-shrink-0" />
                    <p className="text-[13px] text-[#e8eaed]">{conn.lastError}</p>
                  </div>
                )}

                {/* PAT input */}
                <div>
                  <Label className="text-[#e8eaed]">Personal Access Token</Label>
                  <div className="flex gap-2 mt-1">
                    <Input
                      type="password"
                      autoComplete="off"
                      value={pat}
                      placeholder={conn?.patSet ? '•••• set — paste a new token to replace' : 'Paste your Asana PAT'}
                      onChange={(e) => setPatValue(e.target.value)}
                    />
                    <Button onClick={handleSaveToken} disabled={!pat.trim() || setPat.isPending} className="bg-[#4e8af4] hover:bg-[#4e8af4]/90 text-white shrink-0">
                      {setPat.isPending ? <RefreshCw className="size-4 animate-spin" /> : 'Save'}
                    </Button>
                  </div>
                  <p className="text-[11px] text-[#9aa0a6] mt-1.5">
                    Create one in Asana → My Settings → Apps → Developer apps → Personal access tokens. Stored encrypted; never shown again.
                  </p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    onClick={handleVerify}
                    disabled={!conn?.patSet || verify.isPending}
                    className="h-9 border border-white/8 text-[#e8eaed] hover:bg-white/5 gap-1.5"
                  >
                    {verify.isPending ? <RefreshCw className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                    Test connection
                  </Button>
                  {conn?.patSet && (
                    <Button
                      variant="ghost"
                      onClick={handleDisconnect}
                      disabled={disconnect.isPending}
                      className="h-9 text-[#9aa0a6] hover:text-red-300 gap-1.5"
                    >
                      <Unplug className="size-3.5" />Disconnect
                    </Button>
                  )}
                </div>

                {/* Workspace select */}
                {verified && (
                  <div>
                    <Label className="text-[#e8eaed]">Workspace</Label>
                    <div className="mt-1">
                      <select
                        value={conn?.workspaceGid ?? ''}
                        onChange={(e) => handleWorkspace(e.target.value)}
                        className={selectCls}
                        style={selectBg}
                        disabled={setWorkspace.isPending || wsOptions.length === 0}
                      >
                        <option value="" className="bg-[#1a1d27]">Select a workspace…</option>
                        {wsOptions.map((w) => (
                          <option key={w.gid} value={w.gid} className="bg-[#1a1d27]">{w.name}</option>
                        ))}
                      </select>
                      {wsOptions.length === 0 && (
                        <p className="text-[11px] text-[#9aa0a6] mt-1.5">Click "Test connection" to load workspaces.</p>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Site → project mapping */}
        <MappingCard ready={verified && hasWorkspace} />
      </div>
    </div>
  )
}

/* ── Site → project mapping ─────────────────────────────────────────────────── */

function MappingCard({ ready }: { ready: boolean }) {
  const { data: sites, isLoading } = useSites()
  const { data: projects } = useAsanaProjects(ready)

  return (
    <div className="rounded-xl border border-white/8 bg-[#1a1d27] overflow-hidden">
      <div className="px-6 py-4 border-b border-white/8">
        <h2 className="text-[14px] font-semibold text-[#e8eaed]">Site → Project mapping</h2>
        <p className="text-[12px] text-[#9aa0a6]">One Asana project per site. Tasks for that project appear on the site's Tasks page.</p>
      </div>
      <div className="px-6 py-4">
        {!ready ? (
          <p className="text-[13px] text-[#9aa0a6]">Connect a verified token and select a workspace to map projects.</p>
        ) : isLoading ? (
          <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 bg-white/5 rounded" />)}</div>
        ) : (sites ?? []).length === 0 ? (
          <p className="text-[13px] text-[#9aa0a6]">No sites yet.</p>
        ) : (
          <div className="space-y-2">
            {(sites ?? []).map((s) => (
              <SiteMappingRow key={s.id} siteId={s.id} siteName={s.name} projects={projects ?? []} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function SiteMappingRow({ siteId, siteName, projects }: { siteId: string; siteName: string; projects: AsanaProject[] }) {
  const { data: mapping } = useAsanaMapping(siteId)
  const setMapping = useSetAsanaMapping(siteId)

  async function handle(gid: string) {
    if (!gid) return
    try {
      await setMapping.mutateAsync(gid)
      toast.success(`Mapped "${siteName}".`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't map the project.")
    }
  }

  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="text-[13px] text-[#e8eaed] w-48 truncate" title={siteName}>{siteName}</span>
      <select
        value={mapping?.projectGid ?? ''}
        onChange={(e) => handle(e.target.value)}
        className={`${selectCls} flex-1`}
        style={selectBg}
        disabled={setMapping.isPending}
      >
        <option value="" className="bg-[#1a1d27]">— not mapped —</option>
        {projects.map((p) => (
          <option key={p.gid} value={p.gid} className="bg-[#1a1d27]">{p.name}</option>
        ))}
      </select>
      {mapping?.lastFullSyncAt && (
        <span className="text-[11px] text-[#9aa0a6] w-28 text-right">
          synced <RelativeClock ts={mapping.lastFullSyncAt} />
        </span>
      )}
    </div>
  )
}
