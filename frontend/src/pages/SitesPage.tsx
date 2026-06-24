import { useState } from 'react'
import { Link } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'
import {
  Plus, RefreshCw, Trash2, ExternalLink,
  Globe, AlertTriangle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  Table, TableBody, TableCell,
  TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { StatusBadge } from '@/components/StatusBadge'
import { WpPluginStatus } from '@/components/WpPluginStatus'
import { useSites, useCreateSite, useDeleteSite, useParseSite } from '@/hooks/useSites'
import type { Site } from '@/api/sites'

function relativeTime(date: string | null) {
  if (!date) return 'Never'
  return formatDistanceToNow(new Date(date), { addSuffix: true })
}

function truncateUrl(url: string, max = 40) {
  try {
    const u = new URL(url)
    const full = u.hostname + u.pathname
    return full.length > max ? full.slice(0, max - 1) + '…' : full
  } catch {
    return url.length > max ? url.slice(0, max - 1) + '…' : url
  }
}

/* ──────────────────────────────── Progress Bar ─────────────────────────────── */

function ParseProgress({ processed, total }: { processed: number; total: number }) {
  const hasTotal = total > 0
  const pct = hasTotal ? Math.min(100, Math.round((processed / total) * 100)) : 0

  return (
    <div className="space-y-1 min-w-[140px]">
      {/* Bar */}
      <div className="h-1 w-full rounded-full bg-white/8 overflow-hidden">
        {hasTotal ? (
          <div
            className="h-full rounded-full bg-[#4e8af4] transition-all duration-500 ease-out"
            style={{ width: `${pct}%` }}
          />
        ) : (
          /* Indeterminate - waiting for URL count */
          <div className="h-full w-1/3 rounded-full bg-[#4e8af4] animate-[shimmer_1.2s_ease-in-out_infinite]" />
        )}
      </div>
      {/* Label */}
      <p className="text-[11px] text-[#9aa0a6] tabular-nums">
        {hasTotal
          ? `${processed.toLocaleString()} / ${total.toLocaleString()} pages · ${pct}%`
          : 'Fetching sitemap…'}
      </p>
    </div>
  )
}

/* ──────────────────────────────── Add Site Dialog ─────────────────────────── */

function AddSiteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [sitemapUrl, setSitemapUrl] = useState('')
  const [sitemapTouched, setSitemapTouched] = useState(false)
  const create = useCreateSite()

  function handleUrlChange(v: string) {
    setUrl(v)
    if (!sitemapTouched) {
      const trimmed = v.replace(/\/$/, '')
      setSitemapUrl(trimmed ? `${trimmed}/sitemap.xml` : '')
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      await create.mutateAsync({ name, url, sitemapUrl })
      toast.success("Site added. We're parsing the sitemap now.")
      setName(''); setUrl(''); setSitemapUrl(''); setSitemapTouched(false)
      onClose()
    } catch {
      toast.error("Couldn't add the site. Check the URL and try again.")
    }
  }

  function handleClose() {
    setName(''); setUrl(''); setSitemapUrl(''); setSitemapTouched(false)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-md border-white/8 bg-[#1a1d27] text-[#e8eaed]">
        <DialogHeader>
          <DialogTitle className="text-[#e8eaed] text-lg font-semibold">Add Site</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label className="text-[#9aa0a6] text-xs font-medium uppercase tracking-wide">Site Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My WordPress Site"
              required
              className="bg-[#232635] border-white/8 text-[#e8eaed] placeholder:text-[#9aa0a6]/60 focus-visible:ring-[#4e8af4]/50 focus-visible:border-[#4e8af4]/50"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[#9aa0a6] text-xs font-medium uppercase tracking-wide">Site URL</Label>
            <Input
              type="url"
              value={url}
              onChange={(e) => handleUrlChange(e.target.value)}
              placeholder="https://example.com"
              required
              className="bg-[#232635] border-white/8 text-[#e8eaed] placeholder:text-[#9aa0a6]/60 focus-visible:ring-[#4e8af4]/50 focus-visible:border-[#4e8af4]/50"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[#9aa0a6] text-xs font-medium uppercase tracking-wide">Sitemap URL</Label>
            <Input
              type="url"
              value={sitemapUrl}
              onChange={(e) => { setSitemapUrl(e.target.value); setSitemapTouched(true) }}
              placeholder="https://example.com/sitemap.xml"
              required
              className="bg-[#232635] border-white/8 text-[#e8eaed] placeholder:text-[#9aa0a6]/60 focus-visible:ring-[#4e8af4]/50 focus-visible:border-[#4e8af4]/50"
            />
            <p className="text-[11px] text-[#9aa0a6]">Auto-filled from Site URL. Update if Yoast uses a custom path.</p>
          </div>

          <DialogFooter className="gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={handleClose}
              className="h-10 text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-white/5"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={create.isPending}
              className="h-10 bg-[#4e8af4] hover:bg-[#4e8af4]/90 text-white"
            >
              {create.isPending ? (
                <><RefreshCw className="size-4 mr-2 animate-spin" />Adding…</>
              ) : (
                <><Plus className="size-4 mr-2" />Add Site</>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ──────────────────────────────── Delete Dialog ────────────────────────────── */

function DeleteDialog({ site, onClose }: { site: Site | null; onClose: () => void }) {
  const deleteSite = useDeleteSite()

  async function handleDelete() {
    if (!site) return
    try {
      await deleteSite.mutateAsync(site.id)
      toast.success(`${site.name} deleted`)
      onClose()
    } catch {
      toast.error('Failed to delete site')
    }
  }

  return (
    <Dialog open={!!site} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm border-white/8 bg-[#1a1d27] text-[#e8eaed]">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="size-10 rounded-full bg-red-500/15 flex items-center justify-center">
              <AlertTriangle className="size-5 text-red-400" />
            </div>
            <DialogTitle className="text-[#e8eaed]">Delete Site</DialogTitle>
          </div>
        </DialogHeader>
        <p className="text-[#9aa0a6] text-sm leading-relaxed">
          Are you sure you want to delete <span className="text-[#e8eaed] font-medium">{site?.name}</span>?
          This permanently removes the site and all {site?.pagesCount} of its pages.
        </p>
        <DialogFooter className="gap-3">
          <Button
            variant="ghost"
            onClick={onClose}
            className="h-10 text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-white/5"
          >
            Cancel
          </Button>
          <Button
            onClick={handleDelete}
            disabled={deleteSite.isPending}
            className="h-10 bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/20"
          >
            {deleteSite.isPending ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ──────────────────────────────── Stat Card ────────────────────────────────── */

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-[#1a1d27] px-6 py-4">
      <p className="text-[11px] font-medium uppercase tracking-widest text-[#9aa0a6] mb-1.5">{label}</p>
      <p className="text-3xl font-semibold text-[#e8eaed] tabular-nums">{value}</p>
    </div>
  )
}

/* ──────────────────────────────── Skeleton Rows ────────────────────────────── */

function SkeletonRows() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <TableRow key={i} className="border-white/8 hover:bg-transparent">
          {[160, 200, 60, 160, 100, 80].map((w, j) => (
            <TableCell key={j}>
              <Skeleton className="h-4 bg-white/5 rounded" style={{ width: w }} />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  )
}

/* ──────────────────────────────── Main Page ────────────────────────────────── */

export default function SitesPage() {
  const [addOpen, setAddOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Site | null>(null)
  const { data: sites = [], isLoading } = useSites()
  const parseSite = useParseSite()

  const totalPages = sites.reduce((sum, s) => sum + (s.pagesCount ?? 0), 0)

  async function handleParse(id: string) {
    try {
      await parseSite.mutateAsync(id)
      toast.success('Re-parsing the sitemap…')
    } catch {
      toast.error("Couldn't start parsing. Try again.")
    }
  }

  return (
    <div className="min-h-full">
      {/* Header */}
      <div className="border-b border-white/8 px-8 py-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#e8eaed] tracking-tight">Sites</h1>
          <p className="text-[13px] text-[#9aa0a6] mt-0.5">Your WordPress sites and their SEO meta</p>
        </div>
        <Button
          onClick={() => setAddOpen(true)}
          className="bg-[#4e8af4] hover:bg-[#4e8af4]/90 text-white h-9 px-4 text-sm gap-2"
        >
          <Plus className="size-4" />
          Add Site
        </Button>
      </div>

      <div className="px-8 py-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-4 max-w-sm">
          <StatCard label="Total Sites" value={isLoading ? '-' : sites.length} />
          <StatCard label="Pages Indexed" value={isLoading ? '-' : totalPages.toLocaleString()} />
        </div>

        {/* Table */}
        <div className="rounded-xl border border-white/8 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-white/8 hover:bg-transparent bg-[#1a1d27]">
                {['Name', 'URL', 'Pages', 'Status / Progress', 'Last Parsed', 'Actions'].map((h) => (
                  <TableHead key={h} className="text-[11px] font-medium uppercase tracking-widest text-[#9aa0a6] h-10">
                    {h}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <SkeletonRows />
              ) : sites.length === 0 ? (
                <TableRow className="border-white/8 hover:bg-transparent">
                  <TableCell colSpan={6}>
                    <div className="flex flex-col items-center justify-center py-16 gap-4">
                      <div className="size-14 rounded-2xl bg-[#1a1d27] border border-white/8 flex items-center justify-center">
                        <Globe className="size-7 text-[#9aa0a6]" />
                      </div>
                      <div className="text-center">
                        <p className="text-[#e8eaed] font-medium">No sites yet</p>
                        <p className="text-[13px] text-[#9aa0a6] mt-1">Add your first WordPress site and we'll pull in its pages</p>
                      </div>
                      <Button
                        onClick={() => setAddOpen(true)}
                        className="bg-[#4e8af4] hover:bg-[#4e8af4]/90 text-white gap-2 mt-1"
                      >
                        <Plus className="size-4" />
                        Add your first site
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                sites.map((site) => (
                  <TableRow
                    key={site.id}
                    className="border-white/8 hover:bg-white/[0.02] transition-colors"
                  >
                    {/* Name */}
                    <TableCell>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link
                          to={`/sites/${site.id}`}
                          className="flex items-center gap-2 font-medium text-[#e8eaed] hover:text-[#4e8af4] transition-colors"
                        >
                          {site.favicon ? (
                            <img
                              src={site.favicon}
                              className="size-4 rounded-sm object-contain flex-shrink-0"
                              alt=""
                              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                            />
                          ) : (
                            <Globe className="size-4 text-[#9aa0a6]/50 flex-shrink-0" />
                          )}
                          {site.name}
                        </Link>
                        <WpPluginStatus siteId={site.id} />
                      </div>
                    </TableCell>

                    {/* URL */}
                    <TableCell>
                      <a
                        href={site.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-[#9aa0a6] hover:text-[#e8eaed] text-[13px] transition-colors max-w-[220px]"
                      >
                        <span className="truncate">{truncateUrl(site.url)}</span>
                        <ExternalLink className="size-3 flex-shrink-0 opacity-60" />
                      </a>
                    </TableCell>

                    {/* Pages */}
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className="bg-[#232635] text-[#9aa0a6] border-white/8 text-[11px] tabular-nums"
                      >
                        {(site.pagesCount ?? 0).toLocaleString()}
                      </Badge>
                    </TableCell>

                    {/* Status / Progress */}
                    <TableCell>
                      {site.status === 'parsing' ? (
                        <ParseProgress
                          processed={site.pagesProcessed ?? 0}
                          total={site.pagesTotal ?? 0}
                        />
                      ) : (
                        <StatusBadge status={site.status} />
                      )}
                    </TableCell>

                    {/* Last Parsed */}
                    <TableCell className="text-[13px] text-[#9aa0a6]">
                      {relativeTime(site.lastParsedAt)}
                    </TableCell>

                    {/* Actions */}
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleParse(site.id)}
                          disabled={site.status === 'parsing' || parseSite.isPending}
                          className="h-7 w-7 p-0 text-[#9aa0a6] hover:text-[#4e8af4] hover:bg-[#4e8af4]/10 disabled:opacity-40"
                          title="Re-parse sitemap"
                        >
                          <RefreshCw className={`size-3.5 ${site.status === 'parsing' ? 'animate-spin' : ''}`} />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDeleteTarget(site)}
                          className="h-7 w-7 p-0 text-[#9aa0a6] hover:text-red-400 hover:bg-red-500/10"
                          title="Delete site"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <AddSiteDialog open={addOpen} onClose={() => setAddOpen(false)} />
      <DeleteDialog site={deleteTarget} onClose={() => setDeleteTarget(null)} />
    </div>
  )
}
