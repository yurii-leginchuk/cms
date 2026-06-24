import { useState, useEffect } from 'react'
import { useParams, Navigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Save, RefreshCw, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSiteBrief, useUpsertBrief } from '@/hooks/useSites'
import { sitesApi, type SiteBrief, type BrandCard } from '@/api/sites'

const SPELLING_OPTIONS = ['American English', 'British English', 'South African English', 'Australian English']

interface FieldProps {
  label: string
  hint: string
  value: string
  onChange: (v: string) => void
  rows?: number
  mono?: boolean
}

function BriefField({ label, hint, value, onChange, rows = 4, mono = false }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <div>
        <label className="text-[13px] font-medium text-[#e8eaed]">{label}</label>
        <p className="text-[12px] text-[#9aa0a6] mt-0.5">{hint}</p>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        className={`w-full bg-[#0f1117] border border-white/8 rounded-lg px-3 py-2.5 text-[13px] text-[#e8eaed] placeholder:text-[#9aa0a6]/40 focus:outline-none focus:ring-1 focus:ring-[#4e8af4]/50 focus:border-[#4e8af4]/40 transition-colors resize-y ${mono ? 'font-mono text-[12px]' : ''}`}
      />
    </div>
  )
}

const EMPTY: SiteBrief = {
  keywordCsv: '',
  clientNotes: '',
  pastPageExample: '',
  locations: '',
  spellingVariant: '',
  approvedCtas: '',
  complianceNotes: '',
}

function toForm(brief: SiteBrief | null | undefined): SiteBrief {
  return {
    keywordCsv: brief?.keywordCsv ?? '',
    clientNotes: brief?.clientNotes ?? '',
    pastPageExample: brief?.pastPageExample ?? '',
    locations: brief?.locations ?? '',
    spellingVariant: brief?.spellingVariant ?? '',
    approvedCtas: brief?.approvedCtas ?? '',
    complianceNotes: brief?.complianceNotes ?? '',
  }
}

export default function SiteBriefPage() {
  const { id } = useParams<{ id: string }>()
  const { data: brief, isLoading } = useSiteBrief(id!)
  const upsert = useUpsertBrief(id!)
  const [form, setForm] = useState<SiteBrief>(EMPTY)

  useEffect(() => {
    if (!isLoading) setForm(toForm(brief))
  }, [isLoading, brief?.updatedAt]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!id) return <Navigate to="/sites" replace />

  function set(field: keyof SiteBrief) {
    return (v: string) => setForm((f) => ({ ...f, [field]: v }))
  }

  async function handleSave() {
    try {
      await upsert.mutateAsync(form)
      toast.success('Brief saved')
    } catch {
      toast.error("Couldn't save the brief. Try again.")
    }
  }

  return (
    <div className="min-h-full">
      <div className="border-b border-white/8 px-8 py-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#e8eaed] tracking-tight">Site Brief</h1>
          <p className="text-[13px] text-[#9aa0a6] mt-1">Background the AI draws on for every meta suggestion and chat.</p>
        </div>
        <Button
          onClick={handleSave}
          disabled={upsert.isPending}
          className="h-9 px-4 bg-[#4e8af4] hover:bg-[#4e8af4]/90 text-white text-[13px] gap-2"
        >
          {upsert.isPending
            ? <><RefreshCw className="size-4 animate-spin" />Saving…</>
            : <><Save className="size-4" />Save Brief</>}
        </Button>
      </div>

      {isLoading ? (
        <div className="px-8 py-6 text-[#9aa0a6] text-[13px]">Loading…</div>
      ) : (
        <div className="px-8 py-6 max-w-3xl space-y-6">

          {/* Spelling */}
          <div className="space-y-1.5">
            <div>
              <label className="text-[13px] font-medium text-[#e8eaed]">Spelling Variant</label>
              <p className="text-[12px] text-[#9aa0a6] mt-0.5">Which English spelling the AI writes in.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {SPELLING_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  onClick={() => set('spellingVariant')(form.spellingVariant === opt ? '' : opt)}
                  className={`px-3 py-1.5 rounded-lg text-[13px] border transition-colors ${
                    form.spellingVariant === opt
                      ? 'bg-[#4e8af4]/20 border-[#4e8af4]/40 text-[#4e8af4]'
                      : 'bg-[#1a1d27] border-white/8 text-[#9aa0a6] hover:text-[#e8eaed] hover:border-white/15'
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>

          <BriefField
            label="Target Locations"
            hint="Cities, regions, or countries to rank in. E.g. 'Cape Town, Johannesburg, South Africa'"
            value={form.locations ?? ''}
            onChange={set('locations')}
            rows={2}
          />

          <BriefField
            label="Approved CTAs & Phone Numbers"
            hint="Exact CTAs the client has approved and their phone number(s) for use in meta descriptions."
            value={form.approvedCtas ?? ''}
            onChange={set('approvedCtas')}
            rows={3}
          />

          <BriefField
            label="Client Notes"
            hint="Offerings, differentiators, insurance, service areas, brand voice and tone. The AI leans on this for every piece of copy."
            value={form.clientNotes ?? ''}
            onChange={set('clientNotes')}
            rows={6}
          />

          <BriefField
            label="Compliance Notes"
            hint="Claims to avoid, required disclaimers, regulatory limits. The AI honors these in every suggestion."
            value={form.complianceNotes ?? ''}
            onChange={set('complianceNotes')}
            rows={4}
          />

          <BriefField
            label="Past Page Example"
            hint="Paste an example page URL or text that shows ideal structure: where reviews live, CTA placement, tone. AI uses this as a style reference."
            value={form.pastPageExample ?? ''}
            onChange={set('pastPageExample')}
            rows={5}
          />

          <BriefField
            label="SEMrush Keyword CSV"
            hint="Paste a SEMrush export (volume, KD, intent, SERP features, CPC). The AI will prioritise these keywords in meta copy."
            value={form.keywordCsv ?? ''}
            onChange={set('keywordCsv')}
            rows={8}
            mono
          />

          <BrandCardSection siteId={id} />

        </div>
      )}
    </div>
  )
}

const linesToList = (s: string): string[] => s.split('\n').map((l) => l.trim()).filter(Boolean)
const listToLines = (a: string[] | undefined): string => (a ?? []).join('\n')

/**
 * Brand Card editor - the structured, authoritative offering allow-list the AI
 * writes copy from and is validated against. Auto-derive a draft from crawled
 * pages, edit, then mark "verified".
 */
function BrandCardSection({ siteId }: { siteId: string }) {
  const [card, setCard] = useState<BrandCard | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [servicesJson, setServicesJson] = useState('[]')
  const [neverSay, setNeverSay] = useState('')
  const [locations, setLocations] = useState('')
  const [approvedClaims, setApprovedClaims] = useState('')
  const [certifications, setCertifications] = useState('')
  const [brandName, setBrandName] = useState('')
  const [spelling, setSpelling] = useState('')
  const [reviewed, setReviewed] = useState(false)

  function hydrate(c: BrandCard | null) {
    setCard(c)
    setServicesJson(JSON.stringify(c?.services ?? [], null, 2))
    setNeverSay(listToLines(c?.neverSay))
    setLocations(listToLines(c?.locations))
    setApprovedClaims(listToLines(c?.approvedClaims))
    setCertifications(listToLines(c?.certifications))
    setBrandName(c?.brandName ?? '')
    setSpelling(c?.spelling ?? '')
    setReviewed(c?.reviewed ?? false)
  }

  useEffect(() => {
    let cancelled = false
    sitesApi
      .getBrandCard(siteId)
      .then((c) => { if (!cancelled) hydrate(c) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [siteId])

  async function handleDerive() {
    setBusy(true)
    try {
      const c = await sitesApi.deriveBrandCard(siteId, true)
      hydrate(c)
      toast.success('Drafted a Brand Card from your pages. Review it, then mark it verified.')
    } catch {
      toast.error("Couldn't build the Brand Card. Try again.")
    } finally {
      setBusy(false)
    }
  }

  async function handleSave() {
    let services: BrandCard['services']
    try {
      services = JSON.parse(servicesJson)
      if (!Array.isArray(services)) throw new Error('not array')
    } catch {
      toast.error('Services must be valid JSON (an array)')
      return
    }
    setBusy(true)
    try {
      const c = await sitesApi.upsertBrandCard(siteId, {
        brandName: brandName || null,
        spelling: spelling || null,
        services,
        neverSay: linesToList(neverSay),
        locations: linesToList(locations),
        approvedClaims: linesToList(approvedClaims),
        certifications: linesToList(certifications),
        reviewed,
      })
      hydrate(c)
      toast.success('Brand Card saved')
    } catch {
      toast.error('Failed to save Brand Card')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border-t border-white/8 pt-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-[#e8eaed]">Brand Card</h2>
          <p className="text-[12px] text-[#9aa0a6] mt-0.5">
            The source of truth for your real services, people and claims. The AI can only write about
            what's listed here - that's what stops it inventing services you don't offer.
          </p>
        </div>
        <Button
          onClick={handleDerive}
          disabled={busy || loading}
          className="h-9 px-3 bg-[#1a1d27] hover:bg-[#222632] border border-white/10 text-[#e8eaed] text-[13px] gap-2"
        >
          <Sparkles className="size-4" />
          Derive from site
        </Button>
      </div>

      {loading ? (
        <p className="text-[12px] text-[#9aa0a6]">Loading…</p>
      ) : (
        <>
          {card && !card.reviewed && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200">
              This Brand Card is a draft we built for you. Check the services, then tick "Verified" once it's right.
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <BriefField label="Brand Name" hint="Exact brand name." value={brandName} onChange={setBrandName} rows={1} />
            <BriefField label="Spelling / Casing" hint="Canonical spelling." value={spelling} onChange={setSpelling} rows={1} />
          </div>
          <BriefField
            label="Services (JSON)"
            hint='Array of {"name","sourceUrl","subServices":[]}. The exhaustive, real service catalog.'
            value={servicesJson}
            onChange={setServicesJson}
            rows={10}
            mono
          />
          <BriefField
            label="Never Mention (one per line)"
            hint="Offerings the site does NOT provide. The AI is forbidden from referencing these (hard block)."
            value={neverSay}
            onChange={setNeverSay}
            rows={4}
          />
          <div className="grid grid-cols-2 gap-3">
            <BriefField label="Locations (one per line)" hint="Real service locations." value={locations} onChange={setLocations} rows={3} />
            <BriefField label="Certifications (one per line)" hint="Real credentials." value={certifications} onChange={setCertifications} rows={3} />
          </div>
          <BriefField
            label="Approved Claims (one per line)"
            hint="Pre-approved factual claims the AI may use verbatim."
            value={approvedClaims}
            onChange={setApprovedClaims}
            rows={3}
          />
          <label className="flex items-center gap-2 text-[13px] text-[#e8eaed]">
            <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
            Verified - a person has checked this and it's accurate
          </label>
          <Button
            onClick={handleSave}
            disabled={busy}
            className="h-9 px-4 bg-[#4e8af4] hover:bg-[#4e8af4]/90 text-white text-[13px] gap-2"
          >
            {busy ? <><RefreshCw className="size-4 animate-spin" />Saving…</> : <><Save className="size-4" />Save Brand Card</>}
          </Button>
        </>
      )}
    </div>
  )
}
