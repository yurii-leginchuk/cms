/**
 * Builds the persisted assistant message (content + toolInvocations) from a
 * streamText `onFinish` event.
 *
 * Why this is a standalone, tested function: the AI SDK exposes `event.text` and
 * `event.toolCalls` for the LAST step only. A multi-step answer (text → tool call →
 * more text) streams every part to the UI, but if we persist only the final step the
 * earlier text blocks and any tool results are lost on reload. We therefore aggregate
 * across all `event.steps`, and pair each tool call with its result by `toolCallId`.
 *
 * Note: AI SDK v6 names the fields `input`/`output` (not `args`/`result`). The frontend
 * reads `inv.args` and `inv.result`, so we map back to those names here.
 */

export interface PersistedToolInvocation {
  toolName: string;
  toolCallId: string;
  args: unknown;
  result: unknown;
  state: 'result';
}

export interface PersistedAssistantMessage {
  content: string;
  toolInvocations: PersistedToolInvocation[] | null;
}

export function buildPersistedAssistantMessage(event: any): PersistedAssistantMessage {
  const steps: any[] = event?.steps ?? [];

  const content = steps.length
    ? steps
        .map((s) => s?.text || '')
        .filter((t: string) => t)
        .join('\n\n')
    : event?.text || '';

  // Map every tool call's result by id, across all steps.
  const outputById = new Map<string, unknown>();
  for (const s of steps) {
    for (const tr of (s?.toolResults ?? []) as any[]) {
      outputById.set(tr.toolCallId, tr.output);
    }
  }

  const allCalls: any[] = steps.length
    ? steps.flatMap((s) => (s?.toolCalls ?? []) as any[])
    : ((event?.toolCalls as any[]) ?? []);

  const toolInvocations =
    allCalls.length > 0
      ? allCalls.map((tc: any) => ({
          toolName: tc.toolName,
          toolCallId: tc.toolCallId,
          args: tc.input ?? tc.args,
          result: outputById.get(tc.toolCallId) ?? null,
          state: 'result' as const,
        }))
      : null;

  return { content, toolInvocations };
}
