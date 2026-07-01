import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Key, Eye, EyeOff, Check, RefreshCw, BookOpen, ChevronRight, Search, CheckSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { useSettings, useUpsertSetting } from '@/hooks/useSettings'
import { useGscStatus } from '@/hooks/useGsc'

const MODEL_OPTIONS = [
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 - Anthropic (Recommended)', provider: 'anthropic' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 - Anthropic (Fast & cheap)', provider: 'anthropic' },
  { value: 'claude-opus-4-8', label: 'Claude Opus 4.8 - Anthropic (Most capable)', provider: 'anthropic' },
  { value: 'gpt-4o', label: 'GPT-4o - OpenAI', provider: 'openai' },
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini - OpenAI (Fast & cheap)', provider: 'openai' },
]

// ALT text generation runs against the OpenAI endpoint and only needs a cheap,
// fast "mini" model - short, grounded descriptions don't benefit from a large model.
const ALT_MODEL_OPTIONS = [
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini - OpenAI (Recommended)' },
  { value: 'gpt-4o', label: 'GPT-4o - OpenAI (Higher quality, pricier)' },
]

export default function SettingsPage() {
  const { data: settings = [], isLoading } = useSettings()
  const upsert = useUpsertSetting()

  // API Key state
  const [apiKeyEditing, setApiKeyEditing] = useState(false)
  const [apiKeyValue, setApiKeyValue] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)

  // PSI API Key state
  const [psiKeyEditing, setPsiKeyEditing] = useState(false)
  const [psiKeyValue, setPsiKeyValue] = useState('')
  const [psiKey2Editing, setPsiKey2Editing] = useState(false)
  const [psiKey2Value, setPsiKey2Value] = useState('')

  // Anthropic API Key state
  const [anthropicKeyEditing, setAnthropicKeyEditing] = useState(false)
  const [anthropicKeyValue, setAnthropicKeyValue] = useState('')

  // Jina API Key state
  const [jinaKeyEditing, setJinaKeyEditing] = useState(false)
  const [jinaKeyValue, setJinaKeyValue] = useState('')

  // Model state
  const [model, setModel] = useState('gpt-4o')
  const [modelDirty, setModelDirty] = useState(false)

  // ALT text model state (separate, dedicated mini model)
  const [altModel, setAltModel] = useState('gpt-4o-mini')
  const [altModelDirty, setAltModelDirty] = useState(false)

  // Content temperature state
  const [contentTemp, setContentTemp] = useState('0.6')
  const [contentTempDirty, setContentTempDirty] = useState(false)

  const apiKeySetting = settings.find((s) => s.key === 'openai_api_key')
  const modelSetting = settings.find((s) => s.key === 'openai_model')
  const altModelSetting = settings.find((s) => s.key === 'openai_alt_model')
  const contentTempSetting = settings.find((s) => s.key === 'agent_content_temperature')
  const psiKeySetting = settings.find((s) => s.key === 'psi_api_key')
  const psiKey2Setting = settings.find((s) => s.key === 'psi_api_key_2')
  const anthropicKeySetting = settings.find((s) => s.key === 'anthropic_api_key')
  const jinaKeySetting = settings.find((s) => s.key === 'jina_api_key')

  useEffect(() => {
    if (modelSetting?.value) {
      setModel(modelSetting.value)
    }
  }, [modelSetting?.value])

  useEffect(() => {
    if (altModelSetting?.value) {
      setAltModel(altModelSetting.value)
    }
  }, [altModelSetting?.value])

  useEffect(() => {
    if (contentTempSetting?.value) {
      setContentTemp(contentTempSetting.value)
    }
  }, [contentTempSetting?.value])

  async function handleSave() {
    let saved = false
    try {
      if ((apiKeyEditing || !apiKeySetting?.isSet) && apiKeyValue.trim()) {
        await upsert.mutateAsync({ key: 'openai_api_key', value: apiKeyValue.trim() })
        setApiKeyEditing(false)
        setApiKeyValue('')
        setShowApiKey(false)
        saved = true
      }

      if (modelDirty) {
        await upsert.mutateAsync({ key: 'openai_model', value: model })
        setModelDirty(false)
        saved = true
      }

      if (altModelDirty) {
        await upsert.mutateAsync({ key: 'openai_alt_model', value: altModel })
        setAltModelDirty(false)
        saved = true
      }

      if (contentTempDirty) {
        const clamped = Math.min(1, Math.max(0, parseFloat(contentTemp) || 0)).toString()
        await upsert.mutateAsync({ key: 'agent_content_temperature', value: clamped })
        setContentTemp(clamped)
        setContentTempDirty(false)
        saved = true
      }

      if ((psiKeyEditing || !psiKeySetting?.isSet) && psiKeyValue.trim()) {
        await upsert.mutateAsync({ key: 'psi_api_key', value: psiKeyValue.trim() })
        setPsiKeyEditing(false)
        setPsiKeyValue('')
        saved = true
      }

      if ((psiKey2Editing || !psiKey2Setting?.isSet) && psiKey2Value.trim()) {
        await upsert.mutateAsync({ key: 'psi_api_key_2', value: psiKey2Value.trim() })
        setPsiKey2Editing(false)
        setPsiKey2Value('')
        saved = true
      }

      if ((anthropicKeyEditing || !anthropicKeySetting?.isSet) && anthropicKeyValue.trim()) {
        await upsert.mutateAsync({ key: 'anthropic_api_key', value: anthropicKeyValue.trim() })
        setAnthropicKeyEditing(false)
        setAnthropicKeyValue('')
        saved = true
      }

      if ((jinaKeyEditing || !jinaKeySetting?.isSet) && jinaKeyValue.trim()) {
        await upsert.mutateAsync({ key: 'jina_api_key', value: jinaKeyValue.trim() })
        setJinaKeyEditing(false)
        setJinaKeyValue('')
        saved = true
      }

      if (saved) {
        toast.success('Settings saved')
      } else {
        toast.info('Nothing changed')
      }
    } catch {
      toast.error("Couldn't save settings. Try again.")
    }
  }

  const isSaving = upsert.isPending
  const { data: gscStatus } = useGscStatus()

  return (
    <div className="min-h-full">
      {/* Header */}
      <div className="border-b border-white/8 px-8 py-5">
        <h1 className="text-xl font-semibold text-[#e8eaed] tracking-tight">Settings</h1>
        <p className="text-[13px] text-[#9aa0a6] mt-1">API keys and integrations for this workspace.</p>
      </div>

      <div className="px-8 py-6 max-w-2xl space-y-4">
        {/* Quick links */}
        <Link
          to="/settings/prompts"
          className="flex items-center justify-between p-4 rounded-xl border border-white/8 bg-[#1a1d27] hover:border-white/15 hover:bg-[#1e2133] transition-all group"
        >
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-lg bg-violet-500/15 flex items-center justify-center">
              <BookOpen className="size-4 text-violet-400" />
            </div>
            <div>
              <p className="text-[14px] font-medium text-[#e8eaed]">Prompt Library</p>
              <p className="text-[12px] text-[#9aa0a6] mt-0.5">Customize AI prompts for meta generation</p>
            </div>
          </div>
          <ChevronRight className="size-4 text-[#9aa0a6] group-hover:text-[#e8eaed] transition-colors" />
        </Link>

        {/* Asana integration quick link */}
        <Link
          to="/settings/asana"
          className="flex items-center justify-between p-4 rounded-xl border border-white/8 bg-[#1a1d27] hover:border-white/15 hover:bg-[#1e2133] transition-all group"
        >
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-lg bg-rose-500/15 flex items-center justify-center">
              <CheckSquare className="size-4 text-rose-400" />
            </div>
            <div>
              <p className="text-[14px] font-medium text-[#e8eaed]">Asana</p>
              <p className="text-[12px] text-[#9aa0a6] mt-0.5">Connect a token, pick a workspace, map projects to sites</p>
            </div>
          </div>
          <ChevronRight className="size-4 text-[#9aa0a6] group-hover:text-[#e8eaed] transition-colors" />
        </Link>

        {/* AI Integration card */}
        <div className="rounded-xl border border-white/8 bg-[#1a1d27] overflow-hidden">
          <div className="px-6 py-4 border-b border-white/8 flex items-center gap-3">
            <div className="size-9 rounded-lg bg-[#4e8af4]/15 flex items-center justify-center">
              <Key className="size-4 text-[#4e8af4]" />
            </div>
            <div>
              <h2 className="text-[14px] font-semibold text-[#e8eaed]">AI Integration</h2>
              <p className="text-[12px] text-[#9aa0a6]">OpenAI configuration for meta generation</p>
            </div>
            {apiKeySetting?.isSet && (
              <div className="ml-auto flex items-center gap-1.5 text-[11px] text-emerald-400">
                <Check className="size-3" />
                Configured
              </div>
            )}
          </div>

          <div className="px-6 py-5 space-y-5">
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2].map((i) => (
                  <div key={i} className="h-10 rounded-lg bg-white/5 animate-pulse" />
                ))}
              </div>
            ) : (
              <>
                {/* OpenAI API Key */}
                <div className="space-y-2">
                  <Label className="text-[#9aa0a6] text-[11px] font-medium uppercase tracking-widest">
                    OpenAI API Key
                  </Label>

                  {apiKeySetting?.isSet && !apiKeyEditing ? (
                    <div className="flex items-center gap-2">
                      <div className="flex-1 flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-[#0f1117] border border-white/8 text-[13px]">
                        <Key className="size-3.5 text-[#9aa0a6] flex-shrink-0" />
                        <span className="text-[#9aa0a6] italic">Key saved - click Edit to replace it</span>
                        <div className="ml-auto flex items-center gap-1 text-[11px] text-emerald-400">
                          <Check className="size-3" />
                          Set
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setApiKeyEditing(true)}
                        className="h-10 px-3 text-[13px] text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-white/5 border border-white/8"
                      >
                        Edit
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 relative">
                          <input
                            type={showApiKey ? 'text' : 'password'}
                            value={apiKeyValue}
                            onChange={(e) => setApiKeyValue(e.target.value)}
                            placeholder="sk-proj-..."
                            className="w-full bg-[#0f1117] border border-white/8 rounded-lg px-3 py-2.5 pr-10 text-sm text-[#e8eaed] placeholder:text-[#9aa0a6]/40 focus:outline-none focus:ring-1 focus:ring-[#4e8af4]/50 focus:border-[#4e8af4]/40 transition-colors font-mono"
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={() => setShowApiKey((v) => !v)}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#9aa0a6] hover:text-[#e8eaed] transition-colors"
                          >
                            {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                          </button>
                        </div>
                        {apiKeySetting?.isSet && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setApiKeyEditing(false)
                              setApiKeyValue('')
                              setShowApiKey(false)
                            }}
                            className="h-10 px-3 text-[13px] text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-white/5 border border-white/8"
                          >
                            Cancel
                          </Button>
                        )}
                      </div>
                      <p className="text-[11px] text-[#9aa0a6]/60">
                        Stored encrypted. We never show it again or return it in API responses.
                      </p>
                    </div>
                  )}
                </div>

                {/* Model selector */}
                <div className="space-y-2">
                  <Label className="text-[#9aa0a6] text-[11px] font-medium uppercase tracking-widest">
                    AI Model
                  </Label>
                  <select
                    value={model}
                    onChange={(e) => {
                      setModel(e.target.value)
                      setModelDirty(true)
                    }}
                    className="w-full h-10 px-3 pr-8 rounded-lg bg-[#0f1117] border border-white/8 text-[13px] text-[#e8eaed] focus:outline-none focus:ring-1 focus:ring-[#4e8af4]/50 focus:border-[#4e8af4]/50 appearance-none cursor-pointer"
                    style={{
                      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239aa0a6' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
                      backgroundRepeat: 'no-repeat',
                      backgroundPosition: 'right 10px center',
                    }}
                  >
                    {MODEL_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value} className="bg-[#1a1d27]">
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  {(() => {
                    const selected = MODEL_OPTIONS.find((o) => o.value === model)
                    return (
                      <p className="text-[11px] text-[#9aa0a6]/60">
                        {selected?.provider === 'anthropic'
                          ? 'Anthropic models require an Anthropic API key below. Claude Sonnet 4.6 is recommended for content writing and complex workflows.'
                          : 'OpenAI models require the OpenAI API key above.'}
                      </p>
                    )
                  })()}
                </div>

                {/* ALT text model selector */}
                <div className="space-y-2">
                  <Label className="text-[#9aa0a6] text-[11px] font-medium uppercase tracking-widest">
                    ALT text model
                  </Label>
                  <select
                    value={altModel}
                    onChange={(e) => {
                      setAltModel(e.target.value)
                      setAltModelDirty(true)
                    }}
                    className="w-full h-10 px-3 pr-8 rounded-lg bg-[#0f1117] border border-white/8 text-[13px] text-[#e8eaed] focus:outline-none focus:ring-1 focus:ring-[#4e8af4]/50 focus:border-[#4e8af4]/50 appearance-none cursor-pointer"
                    style={{
                      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239aa0a6' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
                      backgroundRepeat: 'no-repeat',
                      backgroundPosition: 'right 10px center',
                    }}
                  >
                    {ALT_MODEL_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value} className="bg-[#1a1d27]">
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-[#9aa0a6]/60">
                    Used only for image ALT text. Stick with a mini model - alt text is short and grounded, so a bigger model just costs more for no real gain. Uses the OpenAI key above.
                  </p>
                </div>

                {/* Content temperature */}
                <div className="space-y-2">
                  <Label className="text-[#9aa0a6] text-[11px] font-medium uppercase tracking-widest">
                    Content creativity (temperature)
                  </Label>
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.1}
                    value={contentTemp}
                    onChange={(e) => {
                      setContentTemp(e.target.value)
                      setContentTempDirty(true)
                    }}
                    className="w-32 bg-[#0f1117] border border-white/8 rounded-lg px-3 py-2.5 text-[13px] text-[#e8eaed] focus:outline-none focus:ring-1 focus:ring-[#4e8af4]/50 focus:border-[#4e8af4]/40 transition-colors"
                  />
                  <p className="text-[11px] text-[#9aa0a6]/60">
                    Applies only when the assistant writes or rewrites page content. Higher means more natural, varied copy (0.6 is a good default). Data and analysis questions always run at 0 so results stay consistent.
                  </p>
                </div>
              </>
            )}
          </div>

          <div className="px-6 py-4 border-t border-white/8 flex justify-end">
            <Button
              onClick={handleSave}
              disabled={isSaving || isLoading}
              className="h-10 px-5 bg-[#4e8af4] hover:bg-[#4e8af4]/90 text-white text-[13px]"
            >
              {isSaving ? (
                <><RefreshCw className="size-3.5 mr-2 animate-spin" />Saving…</>
              ) : (
                'Save Settings'
              )}
            </Button>
          </div>
        </div>
        {/* Anthropic card */}
        <div className="rounded-xl border border-white/8 bg-[#1a1d27] overflow-hidden">
          <div className="px-6 py-4 border-b border-white/8 flex items-center gap-3">
            <div className="size-9 rounded-lg bg-orange-500/15 flex items-center justify-center">
              {/* Anthropic "A" mark */}
              <svg className="size-4 text-orange-400" viewBox="0 0 24 24" fill="currentColor"><path d="M13.827 3.52h-3.654L5.828 20h3.214l.926-2.754h5.064L16.172 20h3.214L13.827 3.52zm-2.928 11.34 1.701-5.065 1.701 5.064H10.9z"/></svg>
            </div>
            <div>
              <h2 className="text-[14px] font-semibold text-[#e8eaed]">Anthropic</h2>
              <p className="text-[12px] text-[#9aa0a6]">API key for Claude models (Sonnet, Haiku, Opus)</p>
            </div>
            {anthropicKeySetting?.isSet && (
              <div className="ml-auto flex items-center gap-1.5 text-[11px] text-emerald-400">
                <Check className="size-3" />
                Configured
              </div>
            )}
          </div>
          <div className="px-6 py-5 space-y-4">
            <div className="space-y-2">
              <Label className="text-[#9aa0a6] text-[11px] font-medium uppercase tracking-widest">
                Anthropic API Key
              </Label>
              {anthropicKeySetting?.isSet && !anthropicKeyEditing ? (
                <div className="flex items-center gap-2">
                  <div className="flex-1 flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-[#0f1117] border border-white/8 text-[13px]">
                    <Key className="size-3.5 text-[#9aa0a6] flex-shrink-0" />
                    <span className="text-[#9aa0a6] italic">Configured - click Edit to update</span>
                    <div className="ml-auto flex items-center gap-1 text-[11px] text-emerald-400">
                      <Check className="size-3" />
                      Set
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setAnthropicKeyEditing(true)}
                    className="h-10 px-3 text-[13px] text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-white/5 border border-white/8"
                  >
                    Edit
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="password"
                      value={anthropicKeyValue}
                      onChange={(e) => setAnthropicKeyValue(e.target.value)}
                      placeholder="sk-ant-..."
                      className="flex-1 bg-[#0f1117] border border-white/8 rounded-lg px-3 py-2.5 text-sm text-[#e8eaed] placeholder:text-[#9aa0a6]/40 focus:outline-none focus:ring-1 focus:ring-[#4e8af4]/50 focus:border-[#4e8af4]/40 transition-colors font-mono"
                      autoFocus={anthropicKeyEditing}
                    />
                    {anthropicKeySetting?.isSet && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => { setAnthropicKeyEditing(false); setAnthropicKeyValue('') }}
                        className="h-10 px-3 text-[13px] text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-white/5 border border-white/8"
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                  <p className="text-[11px] text-[#9aa0a6]/60">
                    Get your key at <span className="text-[#4e8af4]">console.anthropic.com</span>. Stored securely, never returned in API responses.
                  </p>
                </div>
              )}
            </div>
          </div>
          <div className="px-6 py-4 border-t border-white/8 flex justify-end">
            <Button
              onClick={handleSave}
              disabled={isSaving || isLoading}
              className="h-10 px-5 bg-[#4e8af4] hover:bg-[#4e8af4]/90 text-white text-[13px]"
            >
              {isSaving ? <><RefreshCw className="size-3.5 mr-2 animate-spin" />Saving…</> : 'Save Settings'}
            </Button>
          </div>
        </div>

        {/* PageSpeed card */}
        <div className="rounded-xl border border-white/8 bg-[#1a1d27] overflow-hidden">
          <div className="px-6 py-4 border-b border-white/8 flex items-center gap-3">
            <div className="size-9 rounded-lg bg-blue-500/15 flex items-center justify-center">
              <svg className="size-4 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
            </div>
            <div>
              <p className="text-[13px] font-medium text-[#e8eaed]">Google PageSpeed Insights</p>
              <p className="text-[12px] text-[#9aa0a6]">API key for PageSpeed Insights - free at Google Cloud Console</p>
            </div>
            {psiKeySetting?.isSet && (
              <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-400 bg-emerald-400/10 px-2.5 py-1 rounded-full">
                <span className="size-1.5 rounded-full bg-emerald-400" />
                {psiKey2Setting?.isSet ? '2 keys' : '1 key'} connected
              </span>
            )}
          </div>
          <div className="px-6 py-4 space-y-4">
            {/* Key 1 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[13px] font-medium text-[#e8eaed]">
                  API Key 1
                  {psiKeySetting?.isSet && <span className="ml-2 text-[11px] text-emerald-400">● active</span>}
                </label>
              </div>
              {psiKeySetting?.isSet && !psiKeyEditing ? (
                <div className="flex items-center gap-2">
                  <div className="flex-1 flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-[#0f1117] border border-white/8 text-[13px]">
                    <span className="text-[#9aa0a6] font-mono tracking-widest">••••••••••••••••</span>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setPsiKeyEditing(true)}
                    className="h-9 border-white/8 bg-[#232635] hover:bg-[#2a2f44] text-[#e8eaed] text-[12px]">
                    Change
                  </Button>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <input type="text" placeholder="AIza..." value={psiKeyValue}
                    onChange={(e) => setPsiKeyValue(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg bg-[#0f1117] border border-white/8 text-[13px] text-[#e8eaed] placeholder-[#9aa0a6] focus:outline-none focus:border-[#4e8af4]" />
                  {psiKeyEditing && (
                    <button onClick={() => { setPsiKeyEditing(false); setPsiKeyValue('') }}
                      className="text-xs text-[#9aa0a6] hover:text-white">Cancel</button>
                  )}
                </div>
              )}
            </div>

            {/* Key 2 - optional, for parallel scanning */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[13px] font-medium text-[#e8eaed]">
                  API Key 2
                  <span className="ml-2 text-[11px] text-[#9aa0a6]">optional - enables parallel scanning (2×)</span>
                  {psiKey2Setting?.isSet && <span className="ml-2 text-[11px] text-emerald-400">● active</span>}
                </label>
              </div>
              {psiKey2Setting?.isSet && !psiKey2Editing ? (
                <div className="flex items-center gap-2">
                  <div className="flex-1 flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-[#0f1117] border border-white/8 text-[13px]">
                    <span className="text-[#9aa0a6] font-mono tracking-widest">••••••••••••••••</span>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setPsiKey2Editing(true)}
                    className="h-9 border-white/8 bg-[#232635] hover:bg-[#2a2f44] text-[#e8eaed] text-[12px]">
                    Change
                  </Button>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <input type="text" placeholder="AIza... (second Google Cloud project)" value={psiKey2Value}
                    onChange={(e) => setPsiKey2Value(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg bg-[#0f1117] border border-white/8 text-[13px] text-[#e8eaed] placeholder-[#9aa0a6] focus:outline-none focus:border-[#4e8af4]" />
                  {psiKey2Editing && (
                    <button onClick={() => { setPsiKey2Editing(false); setPsiKey2Value('') }}
                      className="text-xs text-[#9aa0a6] hover:text-white">Cancel</button>
                  )}
                </div>
              )}
            </div>

            <p className="text-[11px] text-[#9aa0a6]">
              Get keys at <span className="text-[#4e8af4]">console.cloud.google.com</span> → Enable "PageSpeed Insights API". For 2 keys, use two separate Google Cloud projects.
            </p>
          </div>
          <div className="px-6 py-4 border-t border-white/8 flex justify-end">
            <Button onClick={handleSave} disabled={isSaving || isLoading}
              className="h-10 px-5 bg-[#4e8af4] hover:bg-[#4e8af4]/90 text-white text-[13px]">
              {isSaving ? <><RefreshCw className="size-3.5 mr-2 animate-spin" />Saving…</> : 'Save Settings'}
            </Button>
          </div>
        </div>

        {/* Jina Reader card */}
        <div className="rounded-xl border border-white/8 bg-[#1a1d27] overflow-hidden">
          <div className="px-6 py-4 border-b border-white/8 flex items-center gap-3">
            <div className="size-9 rounded-lg bg-amber-500/15 flex items-center justify-center">
              <svg className="size-4 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
            </div>
            <div>
              <p className="text-[13px] font-medium text-[#e8eaed]">Jina Reader API</p>
              <p className="text-[12px] text-[#9aa0a6]">Cleaner HTML-to-text extraction when crawling pages</p>
            </div>
            {jinaKeySetting?.isSet && (
              <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-400 bg-emerald-400/10 px-2.5 py-1 rounded-full">
                <span className="size-1.5 rounded-full bg-emerald-400" />
                Connected
              </span>
            )}
          </div>
          <div className="px-6 py-4 space-y-4">
            <div className="space-y-2">
              {jinaKeySetting?.isSet && !jinaKeyEditing ? (
                <div className="flex items-center gap-2">
                  <div className="flex-1 flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-[#0f1117] border border-white/8 text-[13px]">
                    <span className="text-[#9aa0a6] font-mono tracking-widest">••••••••••••••••</span>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setJinaKeyEditing(true)}
                    className="h-9 border-white/8 bg-[#232635] hover:bg-[#2a2f44] text-[#e8eaed] text-[12px]">
                    Change
                  </Button>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <input type="text" placeholder="jina_..." value={jinaKeyValue}
                    onChange={(e) => setJinaKeyValue(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg bg-[#0f1117] border border-white/8 text-[13px] text-[#e8eaed] placeholder-[#9aa0a6] focus:outline-none focus:border-[#4e8af4]" />
                  {jinaKeyEditing && (
                    <button onClick={() => { setJinaKeyEditing(false); setJinaKeyValue('') }}
                      className="text-xs text-[#9aa0a6] hover:text-white">Cancel</button>
                  )}
                </div>
              )}
            </div>
            <p className="text-[11px] text-[#9aa0a6]">
              Get a free key at <span className="text-[#4e8af4]">jina.ai</span> - free tier includes 10M tokens (≈ 10K pages). Quota usage is visible on the Usage page.
            </p>
          </div>
          <div className="px-6 py-4 border-t border-white/8 flex justify-end">
            <Button onClick={handleSave} disabled={isSaving || isLoading}
              className="h-10 px-5 bg-[#4e8af4] hover:bg-[#4e8af4]/90 text-white text-[13px]">
              {isSaving ? <><RefreshCw className="size-3.5 mr-2 animate-spin" />Saving…</> : 'Save Settings'}
            </Button>
          </div>
        </div>

        {/* GSC card */}
        <div className="rounded-xl border border-white/8 bg-[#1a1d27] overflow-hidden">
          <div className="px-6 py-4 flex items-center gap-3">
            <div className="size-9 rounded-lg bg-emerald-500/15 flex items-center justify-center">
              <Search className="size-4 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-[14px] font-semibold text-[#e8eaed]">Google Search Console</h2>
              <p className="text-[12px] text-[#9aa0a6]">Service account credentials for GSC data access</p>
            </div>
            <div className="ml-auto">
              {gscStatus?.connected
                ? <span className="flex items-center gap-1.5 text-[11px] text-emerald-400"><Check className="size-3" />Connected</span>
                : <span className="text-[11px] text-[#9aa0a6]">Not connected</span>}
            </div>
          </div>
          <div className="px-6 pb-5 space-y-3 border-t border-white/8 pt-4">
            {gscStatus?.connected ? (
              <div className="flex items-center gap-2 text-[13px] text-[#9aa0a6]">
                <Check className="size-4 text-emerald-400" />
                <span>Service account: <span className="text-[#e8eaed] font-mono text-[12px]">{gscStatus.email}</span></span>
              </div>
            ) : (
              <p className="text-[13px] text-[#9aa0a6]">
                Place a Google service account JSON file at:
              </p>
            )}
            <code className="block text-[11px] text-[#4e8af4] bg-[#0f1117] border border-white/8 rounded-lg px-3 py-2 font-mono break-all">
              {gscStatus?.path ?? './gsc-credentials.json'}
            </code>
            <ol className="text-[12px] text-[#9aa0a6] space-y-1 list-decimal list-inside leading-relaxed">
              <li>Go to <strong className="text-[#e8eaed]">Google Cloud Console → IAM → Service Accounts</strong></li>
              <li>Create a service account, download the JSON key</li>
              <li>Place the file at the path above and restart the backend</li>
              <li>In GSC, add the service account email as <strong className="text-[#e8eaed]">Full User</strong></li>
              <li>Set the GSC Property in each site's Settings</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  )
}
