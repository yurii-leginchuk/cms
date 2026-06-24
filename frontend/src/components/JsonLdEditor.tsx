import { useState, useEffect } from 'react'
import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useValidateJsonLd } from '@/hooks/useSchema'
import type { JsonLdValidation } from '@/api/schema'

/**
 * Textarea JSON-LD editor with live (debounced) schema.org validation against
 * the backend. Save is blocked while the JSON is unparseable.
 */
export default function JsonLdEditor({
  siteId,
  pageId,
  initial,
  onSave,
  onCancel,
  saving,
  saveLabel = 'Save',
}: {
  siteId: string
  pageId: string
  initial: unknown
  onSave: (parsed: unknown) => void
  onCancel: () => void
  saving?: boolean
  saveLabel?: string
}) {
  const [text, setText] = useState(() => JSON.stringify(initial, null, 2))
  const [parseError, setParseError] = useState<string | null>(null)
  const validate = useValidateJsonLd(siteId, pageId)
  const [validation, setValidation] = useState<JsonLdValidation | null>(null)

  // Debounced parse + server validation on each edit.
  useEffect(() => {
    const t = setTimeout(() => {
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
        setParseError(null)
      } catch (err) {
        setParseError((err as Error).message)
        setValidation(null)
        return
      }
      validate.mutate(parsed, { onSuccess: setValidation })
    }, 500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  const issues = validation?.nodes.flatMap((n) => n.issues) ?? []

  return (
    <div className="space-y-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        className="w-full h-56 text-[11.5px] font-mono text-[#c4c7cc] bg-[#0b0d12] border border-white/8 rounded-md p-3 leading-relaxed resize-y focus:outline-none focus:border-[#4e8af4]/50"
      />

      {/* Validation status */}
      {parseError ? (
        <p className="flex items-start gap-1.5 text-[12px] text-red-400">
          <XCircle className="size-3.5 mt-0.5 flex-shrink-0" />
          Invalid JSON: {parseError}
        </p>
      ) : validation ? (
        <div className="space-y-1">
          {validation.validity === 'valid' && (
            <p className="flex items-center gap-1.5 text-[12px] text-emerald-400">
              <CheckCircle2 className="size-3.5" /> Valid schema.org
            </p>
          )}
          {issues.map((issue, i) => (
            <p
              key={i}
              className={`flex items-start gap-1.5 text-[12px] ${
                issue.severity === 'error' ? 'text-red-400' : 'text-amber-400'
              }`}
            >
              {issue.severity === 'error' ? (
                <XCircle className="size-3.5 mt-0.5 flex-shrink-0" />
              ) : (
                <AlertTriangle className="size-3.5 mt-0.5 flex-shrink-0" />
              )}
              <span>
                {issue.path && (
                  <code className="font-mono text-[#c4c7cc]">{issue.path}</code>
                )}
                {issue.path && ' - '}
                {issue.message}
              </span>
            </p>
          ))}
        </div>
      ) : null}

      <div className="flex justify-end gap-2 pt-1">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-[12px] text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-white/5"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          className="h-7 text-[12px] bg-[#4e8af4] text-white hover:bg-[#4e8af4]/80"
          disabled={!!parseError || saving}
          onClick={() => {
            try {
              onSave(JSON.parse(text))
            } catch {
              /* button is disabled on parse error */
            }
          }}
        >
          {saving ? 'Saving…' : saveLabel}
        </Button>
      </div>
    </div>
  )
}
