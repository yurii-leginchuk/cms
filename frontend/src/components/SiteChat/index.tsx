import { useState, useRef, useEffect, useMemo, FormEvent, KeyboardEvent, ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Plus, Trash2, Sparkles, Loader2, Send, ChevronDown, MessageSquare, FileText,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { cn } from '@/lib/utils'
import { useAgentSessions, useCreateSession, useDeleteSession } from '@/hooks/useAgent'
import { agentApi, agentChatUrl, ChatMessageRecord } from '@/api/agent'
import { useStreamChat, StreamMessage, ToolPart, TextPart } from '@/hooks/useStreamChat'
import { useUpdatePageMeta } from '@/hooks/usePages'
import { AiReviewDialog } from '@/components/AiReviewDialog'
import type { AgentMetaProposal } from '@/components/SiteChat/types'

export function dbMessagesToStreamMessages(dbMessages: ChatMessageRecord[]): StreamMessage[] {
  return dbMessages.map((msg) => {
    if (msg.role === 'user') {
      return {
        id: msg.id,
        role: 'user' as const,
        parts: [{ type: 'text' as const, text: msg.content || '', state: 'done' as const }],
      }
    }
    const parts: StreamMessage['parts'] = []
    if (msg.content) parts.push({ type: 'text', text: msg.content, state: 'done' as const })
    if (msg.toolInvocations) {
      for (const inv of msg.toolInvocations) {
        parts.push({
          type: 'tool',
          toolCallId: inv.toolCallId || inv.id || String(Math.random()),
          toolName: inv.toolName,
          state: 'output-available',
          input: inv.args,
          output: inv.result,
        } as ToolPart)
      }
    }
    return { id: msg.id, role: 'assistant' as const, parts }
  })
}

function MarkdownContent({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        table: ({ children }) => (
          <div className="overflow-x-auto my-3 rounded-lg border border-white/10">
            <table className="w-full text-[13px] border-collapse">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="bg-[#232635]">{children}</thead>,
        th: ({ children }) => (
          <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-[#9aa0a6] border-b border-white/10">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="px-4 py-2.5 text-[13px] text-[#e8eaed] border-b border-white/5">
            {children}
          </td>
        ),
        tr: ({ children }) => (
          <tr className="hover:bg-white/[0.02] transition-colors">{children}</tr>
        ),
        pre: ({ children }) => <>{children}</>,
        code: ({ children, className }) => {
          const match = /language-(\w+)/.exec(className || '')
          const isBlock = !!match || String(children).includes('\n')
          if (isBlock) {
            return (
              <div className="my-3 rounded-lg border border-white/10 overflow-hidden">
                {match && (
                  <div className="px-3 py-1.5 bg-white/5 border-b border-white/10 text-[10px] text-[#9aa0a6] uppercase tracking-widest font-mono">
                    {match[1]}
                  </div>
                )}
                <pre className="bg-[#0f1117] p-4 overflow-x-auto">
                  <code className="text-[12px] font-mono text-[#e8eaed] leading-relaxed whitespace-pre">
                    {children}
                  </code>
                </pre>
              </div>
            )
          }
          return (
            <code className="bg-white/10 px-1.5 py-0.5 rounded text-[12px] font-mono text-[#4e8af4]">
              {children}
            </code>
          )
        },
        p: ({ children }) => (
          <p className="text-[14px] text-[#e8eaed] leading-relaxed mb-2 last:mb-0">{children}</p>
        ),
        ul: ({ children }) => (
          <ul className="list-disc pl-5 text-[14px] text-[#e8eaed] space-y-1 my-2">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="list-decimal pl-5 text-[14px] text-[#e8eaed] space-y-1 my-2">{children}</ol>
        ),
        li: ({ children }) => <li className="text-[#e8eaed] leading-relaxed">{children}</li>,
        h1: ({ children }) => (
          <h1 className="text-[18px] font-bold text-[#e8eaed] mt-5 mb-2 first:mt-0">{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="text-[16px] font-semibold text-[#e8eaed] mt-4 mb-2 first:mt-0">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="text-[14px] font-semibold text-[#e8eaed] mt-3 mb-1.5 first:mt-0">{children}</h3>
        ),
        strong: ({ children }) => (
          <strong className="font-semibold text-[#e8eaed]">{children}</strong>
        ),
        em: ({ children }) => <em className="italic text-[#c0c4cc]">{children}</em>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-[#4e8af4]/50 pl-4 my-2 text-[#9aa0a6] italic">
            {children}
          </blockquote>
        ),
        hr: () => <hr className="border-white/10 my-4" />,
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-[#4e8af4] hover:underline">
            {children}
          </a>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  )
}

function GscResultTable({
  result,
}: {
  result: { dateRange?: { startDate: string; endDate: string }; rowCount?: number; rows?: any[]; _cached?: boolean }
}) {
  const rows = result.rows ?? []
  if (rows.length === 0) return <p className="text-[12px] text-[#9aa0a6]">No data returned</p>
  const keys = Object.keys(rows[0])

  return (
    <div>
      {result.dateRange && (
        <div className="flex items-center gap-2 mb-2 text-[11px] text-[#9aa0a6]">
          <span>
            {result.dateRange.startDate} → {result.dateRange.endDate}
          </span>
          {result._cached && <span className="bg-white/5 rounded px-1.5 py-0.5">cached</span>}
          <span>{result.rowCount} rows</span>
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border border-white/10">
        <table className="w-full text-[12px] border-collapse">
          <thead className="bg-[#232635]">
            <tr>
              {keys.map((k) => (
                <th
                  key={k}
                  className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-[#9aa0a6] border-b border-white/10"
                >
                  {k}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                {keys.map((k) => (
                  <td key={k} className="px-3 py-2 text-[#e8eaed]">
                    {row[k] != null ? String(row[k]) : '-'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ToolResultCard({ tool }: { tool: ToolPart }) {
  const [expanded, setExpanded] = useState(false)
  const isError = tool.state === 'output-error'
  const hasGscRows =
    !isError &&
    tool.output &&
    typeof tool.output === 'object' &&
    Array.isArray((tool.output as any).rows)

  return (
    <div className="my-2 rounded-lg border border-white/10 overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/5 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="text-[12px] text-[#9aa0a6]">
          {isError ? '⚠️' : '🔧'} {tool.toolName}
        </span>
        <ChevronDown
          className={cn('size-3 text-[#9aa0a6] ml-auto transition-transform', expanded && 'rotate-180')}
        />
      </button>
      {expanded && (
        <div className="px-3 py-3 bg-black/20 border-t border-white/5">
          {isError ? (
            <p className="text-[12px] text-red-400">{tool.errorText}</p>
          ) : hasGscRows ? (
            <GscResultTable result={tool.output as any} />
          ) : (
            <pre className="text-[11px] text-[#9aa0a6] whitespace-pre-wrap overflow-auto max-h-60 font-mono">
              {JSON.stringify(tool.output, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

function NoindexCard({ proposal, siteId }: { proposal: any; siteId: string }) {
  const [applied, setApplied] = useState(false)
  const updateMeta = useUpdatePageMeta(siteId)

  return (
    <div className="bg-[#0f1117] border border-amber-500/20 rounded-xl p-4 text-[13px] my-2 max-w-sm">
      <div className="flex items-center gap-1.5 mb-2 font-semibold text-[#e8eaed]">
        🔍 Noindex Change
      </div>
      <div className="text-[#9aa0a6] mb-3 text-[12px] truncate">{proposal.pageUrl}</div>
      <div className="flex items-center gap-2 mb-3 text-[12px]">
        <span className="bg-white/5 rounded px-2 py-0.5">
          {proposal.currentNoindex ? 'noindex' : 'indexed'}
        </span>
        <span className="text-[#9aa0a6]">→</span>
        <span className="bg-[#4e8af4]/10 text-[#4e8af4] rounded px-2 py-0.5">
          {proposal.proposedNoindex ? 'noindex' : 'indexed'}
        </span>
      </div>
      {applied ? (
        <span className="text-emerald-400 text-[12px]">✓ Applied</span>
      ) : (
        <div className="flex gap-2">
          <button
            className="px-3 py-1.5 rounded-lg text-[#9aa0a6] hover:bg-white/5 text-[12px] transition-colors"
            onClick={() => setApplied(true)}
          >
            Skip
          </button>
          <button
            disabled={updateMeta.isPending}
            className="px-3 py-1.5 rounded-lg bg-[#4e8af4] text-white text-[12px] disabled:opacity-50 transition-colors"
            onClick={async () => {
              try {
                await updateMeta.mutateAsync({
                  pageId: proposal.pageId,
                  payload: { noindex: proposal.proposedNoindex, skipSync: true },
                })
                setApplied(true)
              } catch {}
            }}
          >
            Apply
          </button>
        </div>
      )}
    </div>
  )
}

function ContentBriefCard({
  proposal,
  siteId,
  sessionId,
}: {
  proposal: any
  siteId: string
  sessionId: string | null
}) {
  const navigate = useNavigate()
  return (
    <div className="bg-[#0f1117] border border-[#4e8af4]/20 rounded-xl p-4 text-[13px] my-2 max-w-md">
      <div className="flex items-center gap-1.5 mb-2 font-semibold text-[#e8eaed]">
        <FileText className="size-4 text-[#4e8af4]" /> Brief saved
      </div>
      <div className="text-[#e8eaed] text-[12px] mb-1 line-clamp-2">
        {proposal.proposedMetaTitle || proposal.pageUrl}
      </div>
      <div className="text-[#9aa0a6] text-[11px] mb-3 truncate">{proposal.pageUrl}</div>
      {proposal.briefId ? (
        <button
          onClick={() =>
            navigate(`/sites/${siteId}/briefs/${proposal.briefId}`, {
              state: { sessionId },
            })
          }
          className="px-3 py-1.5 rounded-lg bg-[#4e8af4] text-white text-[12px] hover:bg-[#4e8af4]/90 transition-colors"
        >
          Open brief
        </button>
      ) : (
        <span className="text-[11px] text-[#9aa0a6]">Saved to Briefs</span>
      )}
    </div>
  )
}

function OpenBriefCard({
  output,
  siteId,
  sessionId,
}: {
  output: any
  siteId: string
  sessionId: string | null
}) {
  const navigate = useNavigate()
  return (
    <div className="my-2">
      <button
        onClick={() =>
          navigate(`/sites/${siteId}/briefs/${output.briefId}`, {
            state: { sessionId },
          })
        }
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#4e8af4] text-white text-[12px] hover:bg-[#4e8af4]/90 transition-colors"
      >
        <FileText className="size-3.5" /> Open brief for editing
      </button>
    </div>
  )
}

/**
 * Optional extension point: lets a wrapper (e.g. SchemaAssistantPanel) render
 * custom cards for its own tool outputs. Return a node to take over rendering of
 * that tool result, or null to fall through to SiteChat's default handling.
 */
export type RenderToolOutput = (
  out: any,
  ctx: { siteId: string; sessionId: string | null; key: string | number },
) => ReactNode | null

function MessageBubble({
  msg,
  siteId,
  sessionId,
  onProposal,
  renderToolOutput,
}: {
  msg: StreamMessage
  siteId: string
  sessionId: string | null
  onProposal: (p: AgentMetaProposal) => void
  renderToolOutput?: RenderToolOutput
}) {
  const proposalFiredRef = useRef(false)

  if (msg.role === 'user') {
    const text = (msg.parts.find((p) => p.type === 'text') as TextPart | undefined)?.text ?? ''
    return (
      <div className="flex justify-end mb-6">
        <div className="max-w-[70%] bg-[#4e8af4]/15 border border-[#4e8af4]/20 rounded-2xl rounded-tr-sm px-5 py-3">
          <p className="text-[14px] text-[#e8eaed] leading-relaxed whitespace-pre-wrap">{text}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-3 mb-6">
      <div className="size-8 rounded-full bg-[#4e8af4]/15 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Sparkles className="size-4 text-[#4e8af4]" />
      </div>
      <div className="flex-1 min-w-0">
        {msg.parts.map((part, i) => {
          if (part.type === 'text') {
            const tp = part as TextPart
            return (
              <div key={i}>
                <MarkdownContent text={tp.text} />
                {tp.state === 'streaming' && (
                  <span className="inline-block w-2 h-4 bg-[#4e8af4] ml-0.5 animate-pulse rounded-sm" />
                )}
              </div>
            )
          }

          if (part.type === 'tool') {
            const tp = part as ToolPart
            const isLoading = tp.state === 'input-streaming' || tp.state === 'input-available'

            if (tp.state === 'output-available' && tp.output && typeof tp.output === 'object') {
              const out = tp.output as any
              // Wrapper-provided cards (e.g. schema proposals/confirmations) win first.
              if (renderToolOutput) {
                const custom = renderToolOutput(out, { siteId, sessionId, key: i })
                if (custom) return <div key={i}>{custom}</div>
              }
              if (out.type === 'proposal' && out.action === 'update_meta') {
                if (!proposalFiredRef.current) {
                  proposalFiredRef.current = true
                  setTimeout(() => onProposal(out as AgentMetaProposal), 0)
                }
                return (
                  <div key={i} className="flex items-center gap-1.5 text-[13px] text-[#4e8af4] py-1">
                    <span>↗</span> Meta proposal opened
                  </div>
                )
              }
              if (out.type === 'proposal' && out.action === 'noindex_change') {
                return <NoindexCard key={i} proposal={out} siteId={siteId} />
              }
              if (out.type === 'proposal' && out.action === 'content_proposal') {
                return (
                  <ContentBriefCard key={i} proposal={out} siteId={siteId} sessionId={sessionId} />
                )
              }
              if (out.type === 'navigation' && out.action === 'open_brief') {
                return (
                  <OpenBriefCard key={i} output={out} siteId={siteId} sessionId={sessionId} />
                )
              }
            }

            if (isLoading) {
              return (
                <div key={i} className="flex items-center gap-2 text-[12px] text-[#9aa0a6] py-1.5">
                  <Loader2 className="size-3.5 animate-spin" />
                  {tp.toolName}…
                </div>
              )
            }

            return <ToolResultCard key={i} tool={tp} />
          }

          return null
        })}
        {msg.parts.length === 0 && (
          <div className="flex items-center gap-2 text-[12px] text-[#9aa0a6] py-1.5">
            <Loader2 className="size-3.5 animate-spin" />
            Thinking…
          </div>
        )}
      </div>
    </div>
  )
}

export interface SiteChatProps {
  siteId: string
  initialSessionId?: string
  scope?: 'general' | 'brief'
  hideSessionSidebar?: boolean
  /** When embedded on a specific page, sent with every request so server-side
   * tools (schema tools) default to it. */
  pageContext?: { pageId: string; pageUrl?: string }
  /** Wrapper-supplied renderer for custom tool-output cards. */
  renderToolOutput?: RenderToolOutput
  /** Override the empty-state copy (e.g. the schema assistant). */
  emptyTitleOverride?: string
  emptyBlurbOverride?: string
}

export default function SiteChat({
  siteId,
  initialSessionId,
  scope = 'general',
  hideSessionSidebar = false,
  pageContext,
  renderToolOutput,
  emptyTitleOverride,
  emptyBlurbOverride,
}: SiteChatProps) {
  const qc = useQueryClient()
  const [activeSessionId, setActiveSessionId] = useState<string | null>(initialSessionId ?? null)
  const [input, setInput] = useState('')
  const [proposal, setProposal] = useState<AgentMetaProposal | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const updateMeta = useUpdatePageMeta(siteId)

  // Auto-grow the composer with its content (up to a cap, then it scrolls).
  // Runs on every input change, incl. programmatic set + clear-on-submit.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [input])

  const { data: sessions = [] } = useAgentSessions(siteId)
  const createSession = useCreateSession(siteId)
  const deleteSession = useDeleteSession(siteId)

  const chatApi = activeSessionId ? agentChatUrl(activeSessionId) : undefined

  // Stable body so useStreamChat's sendMessage callback identity doesn't churn.
  const streamBody = useMemo(
    () => (pageContext ? { pageContext } : undefined),
    [pageContext?.pageId, pageContext?.pageUrl],
  )

  const { messages, isLoading, error, sendMessage, setMessages } = useStreamChat({
    api: chatApi,
    onFinish: () => qc.invalidateQueries({ queryKey: ['agent-sessions', siteId] }),
    body: streamBody,
  })

  // Load history when an initial session id is supplied (e.g. brief page).
  useEffect(() => {
    if (!initialSessionId) return
    let cancelled = false
    ;(async () => {
      try {
        const dbMessages = await agentApi.getMessages(initialSessionId)
        if (!cancelled) setMessages(dbMessagesToStreamMessages(dbMessages))
      } catch {
        if (!cancelled) setMessages([])
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSessionId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const loadSession = async (sessionId: string) => {
    setActiveSessionId(sessionId)
    try {
      const dbMessages = await agentApi.getMessages(sessionId)
      setMessages(dbMessagesToStreamMessages(dbMessages))
    } catch {
      setMessages([])
    }
  }

  const handleNewSession = async () => {
    try {
      const session = await createSession.mutateAsync()
      setActiveSessionId(session.id)
      setMessages([])
    } catch {}
  }

  const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation()
    try {
      await deleteSession.mutateAsync(sessionId)
      if (activeSessionId === sessionId) {
        setActiveSessionId(null)
        setMessages([])
      }
    } catch {}
  }

  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault()
    const text = input.trim()
    if (!text || isLoading) return

    let sessionId = activeSessionId
    if (!sessionId) {
      try {
        const session = await createSession.mutateAsync()
        sessionId = session.id
        setActiveSessionId(sessionId)
      } catch {
        return
      }
    }

    setInput('')
    await sendMessage(text, agentChatUrl(sessionId))
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleApplyProposal = async (title: string | null, desc: string | null) => {
    if (!proposal) throw new Error('No proposal')
    await updateMeta.mutateAsync({
      pageId: proposal.pageId,
      payload: {
        customMetaTitle: title ?? undefined,
        customMetaDescription: desc ?? undefined,
        skipSync: true,
      },
    })
    qc.invalidateQueries({ queryKey: ['pages', siteId] })
  }

  const emptyTitle =
    emptyTitleOverride ?? (scope === 'brief' ? 'Brief assistant' : 'AI SEO Assistant')
  const emptyBlurb =
    emptyBlurbOverride ??
    (scope === 'brief'
      ? 'Ask the assistant to refine this brief, propose alternatives, or generate related pages.'
      : "Ask anything about your site's SEO. I can analyze pages, query Search Console, suggest optimizations, and create structured reports.")

  return (
    <div className="h-full overflow-hidden flex">
      {/* Session sidebar */}
      {!hideSessionSidebar && (
        <aside className="w-64 flex-shrink-0 flex flex-col border-r border-white/8 overflow-hidden" style={{ background: '#141720' }}>
          <div className="flex-shrink-0 px-4 py-4 border-b border-white/8 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-[#4e8af4]" />
              <span className="text-[13px] font-semibold text-[#e8eaed]">AI Chat</span>
            </div>
            <button
              onClick={handleNewSession}
              className="size-7 flex items-center justify-center rounded-lg bg-[#4e8af4]/15 text-[#4e8af4] hover:bg-[#4e8af4]/25 transition-colors"
              title="New chat"
            >
              <Plus className="size-3.5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto py-1.5">
            {sessions.length === 0 ? (
              <p className="text-[12px] text-[#9aa0a6]/50 px-4 py-3">No sessions yet</p>
            ) : (
              sessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => loadSession(s.id)}
                  className={cn(
                    'w-full text-left px-3 py-2.5 flex items-start gap-2.5 group transition-colors border-l-2',
                    activeSessionId === s.id
                      ? 'bg-[#4e8af4]/10 border-[#4e8af4]'
                      : 'hover:bg-white/5 border-transparent',
                  )}
                >
                  <MessageSquare className="size-3.5 text-[#9aa0a6] flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] text-[#e8eaed] truncate leading-snug">
                      {s.title || 'New Chat'}
                    </p>
                    <p className="text-[10px] text-[#9aa0a6]/50 mt-0.5">
                      {formatDistanceToNow(new Date(s.updatedAt), { addSuffix: true })}
                    </p>
                  </div>
                  <button
                    onClick={(e) => handleDeleteSession(e, s.id)}
                    className="size-5 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-white/10 flex-shrink-0 transition-all"
                    title="Delete"
                  >
                    <Trash2 className="size-3 text-[#9aa0a6]" />
                  </button>
                </button>
              ))
            )}
          </div>
        </aside>
      )}

      {/* Chat panel */}
      <div className="flex-1 flex flex-col overflow-hidden" style={{ background: '#0f1117' }}>
        <div className="flex-1 overflow-y-auto px-6 py-8">
          {messages.length === 0 && !isLoading ? (
            <div className="h-full flex flex-col items-center justify-center text-center">
              <div className="size-16 rounded-2xl bg-[#4e8af4]/10 flex items-center justify-center mb-5">
                <Sparkles className="size-8 text-[#4e8af4]" />
              </div>
              <h2 className="text-[20px] font-semibold text-[#e8eaed] mb-2">{emptyTitle}</h2>
              <p className="text-[14px] text-[#9aa0a6] max-w-md leading-relaxed">{emptyBlurb}</p>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto">
              {messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  msg={msg}
                  siteId={siteId}
                  sessionId={activeSessionId}
                  onProposal={setProposal}
                  renderToolOutput={renderToolOutput}
                />
              ))}
              {error && (
                <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-[13px] text-red-400 mb-4">
                  <span className="flex-shrink-0">⚠️</span>
                  <span>{error.message}</span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        <div className="flex-shrink-0 border-t border-white/8 px-6 py-4" style={{ background: '#141720' }}>
          <form onSubmit={handleSubmit} className="max-w-3xl mx-auto flex gap-3 items-end">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about SEO, Search Console data, page optimizations…"
              disabled={isLoading}
              rows={1}
              className="flex-1 bg-[#1a1d27] border border-white/8 rounded-xl px-4 py-3 text-[14px] text-[#e8eaed] placeholder:text-[#9aa0a6]/50 resize-none overflow-y-auto focus:outline-none focus:ring-1 focus:ring-[#4e8af4]/50 focus:border-[#4e8af4]/40 transition-colors disabled:opacity-50"
              style={{ minHeight: '50px', maxHeight: '200px' }}
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className="size-[50px] flex-shrink-0 rounded-xl bg-[#4e8af4] text-white flex items-center justify-center hover:bg-[#4e8af4]/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? <Loader2 className="size-5 animate-spin" /> : <Send className="size-5" />}
            </button>
          </form>
          <p className="text-center text-[11px] text-[#9aa0a6]/40 mt-2 max-w-3xl mx-auto">
            Enter to send · Shift+Enter for new line
          </p>
        </div>
      </div>

      {proposal && (
        <AiReviewDialog
          open
          onClose={() => setProposal(null)}
          onApply={handleApplyProposal}
          current={{
            title: proposal.currentTitle || '',
            desc: proposal.currentDescription || '',
          }}
          generated={{
            metaTitle: proposal.proposedTitle,
            metaDescription: proposal.proposedDescription,
            tokensUsed: 0,
          }}
          pageUrl={proposal.pageUrl}
        />
      )}
    </div>
  )
}
