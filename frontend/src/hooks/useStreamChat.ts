import { useState, useCallback, useRef } from 'react'

export type ToolState =
  | 'input-streaming'
  | 'input-available'
  | 'output-available'
  | 'output-error'

export interface ToolPart {
  type: 'tool'
  toolCallId: string
  toolName: string
  state: ToolState
  input?: unknown
  output?: unknown
  errorText?: string
}

export interface TextPart {
  type: 'text'
  text: string
  state?: 'streaming' | 'done'
}

export type MessagePart = TextPart | ToolPart

export interface StreamMessage {
  id: string
  role: 'user' | 'assistant'
  parts: MessagePart[]
}

type ChatStatus = 'idle' | 'submitted' | 'streaming' | 'error'

interface UseStreamChatOptions {
  api?: string
  onFinish?: () => void
  /** Extra fields merged into every chat request body (e.g. pageContext). */
  body?: Record<string, unknown>
}

let messageCounter = 0
function nextId() {
  return `msg-${++messageCounter}-${Date.now()}`
}

export function useStreamChat({ api, onFinish, body }: UseStreamChatOptions) {
  const [messages, setMessages] = useState<StreamMessage[]>([])
  const [status, setStatus] = useState<ChatStatus>('idle')
  const [error, setError] = useState<Error | undefined>()
  const abortRef = useRef<AbortController | null>(null)

  const sendMessage = useCallback(
    async (text: string, currentApi?: string) => {
      const endpoint = currentApi || api
      if (!endpoint || !text.trim()) return

      // Add user message
      const userMsg: StreamMessage = {
        id: nextId(),
        role: 'user',
        parts: [{ type: 'text', text }],
      }

      setMessages((prev) => [...prev, userMsg])
      setStatus('submitted')
      setError(undefined)

      // Create a placeholder assistant message
      const assistantId = nextId()
      const assistantMsg: StreamMessage = {
        id: assistantId,
        role: 'assistant',
        parts: [],
      }
      setMessages((prev) => [...prev, assistantMsg])

      // Abort previous request
      abortRef.current?.abort()
      const ac = new AbortController()
      abortRef.current = ac

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, ...(body ?? {}) }),
          signal: ac.signal,
        })

        if (!response.ok) {
          const errText = await response.text()
          throw new Error(`Request failed: ${response.status} ${errText}`)
        }

        if (!response.body) {
          throw new Error('No response body')
        }

        setStatus('streaming')

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        // Track text parts by their id
        const textPartIds: string[] = []

        const updateAssistant = (updater: (msg: StreamMessage) => StreamMessage) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? updater(m) : m)),
          )
        }

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const raw = line.slice(6).trim()
            if (!raw || raw === '[DONE]') continue

            let chunk: any
            try {
              chunk = JSON.parse(raw)
            } catch {
              continue
            }

            // Process UI message stream chunks
            switch (chunk.type) {
              case 'text-start': {
                textPartIds.push(chunk.id)
                updateAssistant((msg) => ({
                  ...msg,
                  parts: [
                    ...msg.parts,
                    { type: 'text', text: '', state: 'streaming' } as TextPart,
                  ],
                }))
                break
              }
              case 'text-delta': {
                updateAssistant((msg) => {
                  // Find the last text part
                  const parts = [...msg.parts]
                  for (let i = parts.length - 1; i >= 0; i--) {
                    if (parts[i].type === 'text') {
                      parts[i] = {
                        ...parts[i],
                        text: (parts[i] as TextPart).text + chunk.delta,
                      } as TextPart
                      break
                    }
                  }
                  return { ...msg, parts }
                })
                break
              }
              case 'text-end': {
                updateAssistant((msg) => {
                  const parts = [...msg.parts]
                  for (let i = parts.length - 1; i >= 0; i--) {
                    if (parts[i].type === 'text') {
                      parts[i] = { ...parts[i], state: 'done' } as TextPart
                      break
                    }
                  }
                  return { ...msg, parts }
                })
                break
              }
              case 'tool-input-start': {
                updateAssistant((msg) => ({
                  ...msg,
                  parts: [
                    ...msg.parts,
                    {
                      type: 'tool',
                      toolCallId: chunk.toolCallId,
                      toolName: chunk.toolName,
                      state: 'input-streaming',
                      input: undefined,
                    } as ToolPart,
                  ],
                }))
                break
              }
              case 'tool-input-available': {
                updateAssistant((msg) => ({
                  ...msg,
                  parts: msg.parts.map((p) =>
                    p.type === 'tool' && (p as ToolPart).toolCallId === chunk.toolCallId
                      ? ({ ...p, state: 'input-available', input: chunk.input } as ToolPart)
                      : p,
                  ),
                }))
                break
              }
              case 'tool-output-available': {
                updateAssistant((msg) => ({
                  ...msg,
                  parts: msg.parts.map((p) =>
                    p.type === 'tool' && (p as ToolPart).toolCallId === chunk.toolCallId
                      ? ({ ...p, state: 'output-available', output: chunk.output } as ToolPart)
                      : p,
                  ),
                }))
                break
              }
              case 'tool-output-error': {
                updateAssistant((msg) => ({
                  ...msg,
                  parts: msg.parts.map((p) =>
                    p.type === 'tool' && (p as ToolPart).toolCallId === chunk.toolCallId
                      ? ({ ...p, state: 'output-error', errorText: chunk.errorText } as ToolPart)
                      : p,
                  ),
                }))
                break
              }
              case 'finish': {
                setStatus('idle')
                onFinish?.()
                break
              }
              case 'error': {
                throw new Error(chunk.errorText || 'Stream error')
              }
              default:
                break
            }
          }
        }

        setStatus('idle')
        onFinish?.()
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          setStatus('idle')
          return
        }
        const e = err instanceof Error ? err : new Error(String(err))
        setError(e)
        setStatus('error')
        // Remove placeholder assistant message if it has no content
        setMessages((prev) => {
          const assistantMsgInState = prev.find((m) => m.id === assistantId)
          if (
            assistantMsgInState &&
            assistantMsgInState.parts.length === 0
          ) {
            return prev.filter((m) => m.id !== assistantId)
          }
          return prev
        })
      } finally {
        abortRef.current = null
      }
    },
    [api, onFinish, body],
  )

  const stop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const setExternalMessages = useCallback((newMessages: StreamMessage[]) => {
    abortRef.current?.abort()
    setMessages(newMessages)
    setStatus('idle')
    setError(undefined)
  }, [])

  return {
    messages,
    status,
    error,
    isLoading: status === 'submitted' || status === 'streaming',
    sendMessage,
    stop,
    setMessages: setExternalMessages,
  }
}
