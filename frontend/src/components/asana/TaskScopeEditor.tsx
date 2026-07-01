import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Globe, FileText, Search, RefreshCw } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { usePages } from '@/hooks/usePages'
import { useAsanaTaskScope, useSetAsanaTaskScope } from '@/hooks/useAsana'

type Mode = 'unset' | 'sitewide' | 'pages'

/**
 * Assign a task's Optimization-Impact scope: site-wide (global timeline only) or
 * a chosen set of pages (those page timelines + global). Settable any time; the
 * completion marker's date stays frozen — scope only governs where it's credited.
 */
export function TaskScopeEditor({ siteId, taskGid }: { siteId: string; taskGid: string }) {
  const { data: scope } = useAsanaTaskScope(siteId, taskGid)
  const setScope = useSetAsanaTaskScope(siteId)
  const [mode, setMode] = useState<Mode>('unset')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const { data: pageList } = usePages(siteId, 1, 500, search)

  useEffect(() => {
    if (!scope) return
    setMode(scope.scope ?? 'unset')
    setSelected(new Set(scope.pageIds))
  }, [scope])

  const pages = pageList?.data ?? []
  const dirty =
    mode === 'pages' &&
    (scope?.scope !== 'pages' ||
      selected.size !== (scope?.pageIds.length ?? 0) ||
      (scope?.pageIds ?? []).some((id) => !selected.has(id)))

  async function commit(nextMode: Mode, pageIds: string[]) {
    try {
      await setScope.mutateAsync({
        taskGid,
        scope: nextMode === 'unset' ? null : nextMode,
        pageIds: nextMode === 'pages' ? pageIds : [],
      })
      toast.success('Impact scope updated — timeline markers will reflect this.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't set the scope.")
    }
  }

  function pick(next: Mode) {
    setMode(next)
    if (next !== 'pages') commit(next, []) // sitewide / off save immediately
  }

  const chip = (m: Mode, icon: React.ReactNode, label: string) => (
    <button
      onClick={() => pick(m)}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] border transition-colors ${
        mode === m ? 'bg-[#4e8af4]/15 text-[#4e8af4] border-[#4e8af4]/30' : 'bg-white/[0.03] text-[#9aa0a6] border-white/10 hover:text-[#e8eaed]'
      }`}
    >
      {icon}{label}
    </button>
  )

  return (
    <div>
      <h2 className="text-[11px] font-medium uppercase tracking-widest text-[#9aa0a6] mb-2">Impact scope</h2>
      <div className="flex items-center gap-2">
        {chip('unset', <span className="size-1.5 rounded-full bg-[#9aa0a6]/40" />, 'Off')}
        {chip('sitewide', <Globe className="size-3.5" />, 'Site-wide')}
        {chip('pages', <FileText className="size-3.5" />, 'Specific pages')}
        {mode === 'pages' && <span className="text-[11px] text-[#9aa0a6]">{selected.size} selected</span>}
      </div>

      {mode === 'pages' && (
        <div className="mt-2 rounded-xl border border-white/8 bg-[#1a1d27]/60 p-2">
          <div className="relative mb-2">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-[#9aa0a6]" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter pages by URL…"
              className="pl-8 h-8 bg-[#1a1d27] border-white/8 text-[#e8eaed] text-[12px]" />
          </div>
          <div className="max-h-52 overflow-y-auto space-y-0.5">
            {pages.map((p) => {
              const on = selected.has(p.id)
              return (
                <label key={p.id} className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-white/[0.03] cursor-pointer text-[12px]">
                  <input type="checkbox" checked={on} className="accent-[#4e8af4]"
                    onChange={() => setSelected((cur) => { const n = new Set(cur); on ? n.delete(p.id) : n.add(p.id); return n })} />
                  <span className="text-[#e8eaed] truncate">{p.url.replace(/^https?:\/\/[^/]+/, '') || '/'}</span>
                </label>
              )
            })}
            {pages.length === 0 && <p className="text-[12px] text-[#9aa0a6] px-1.5 py-2">No pages match.</p>}
          </div>
          <div className="flex items-center justify-end mt-2">
            <Button size="sm" onClick={() => commit('pages', [...selected])} disabled={!dirty || setScope.isPending}
              className="h-7 bg-[#4e8af4] hover:bg-[#4e8af4]/90 text-white gap-1.5">
              {setScope.isPending ? <RefreshCw className="size-3 animate-spin" /> : null}Save pages
            </Button>
          </div>
        </div>
      )}
      <p className="text-[11px] text-[#9aa0a6]/70 mt-1.5">
        When this task is completed, it appears on the Impact timeline per this scope. Correlation, not causation — the marker shows timing only.
      </p>
    </div>
  )
}
