import { buildPersistedAssistantMessage } from './message-persistence';

describe('buildPersistedAssistantMessage', () => {
  // Mirrors the real "оптимизируй главную страницу" turn: an intro text block,
  // then a step with tool calls (incl. a proposal), then a final summary block.
  // The AI SDK only exposes the LAST step on `event.text`/`event.toolCalls`, so the
  // regression we guard against is persisting only the final block.
  function multiStepEvent() {
    const proposalOutput = {
      type: 'proposal',
      proposalType: 'page',
      validation: { valid: true },
    };
    return {
      // last-step fields the SDK populates (intentionally only the final block):
      text: 'Финальное резюме изменений.',
      toolCalls: [],
      steps: [
        { text: 'Вступление: анализирую главную страницу.', toolCalls: [], toolResults: [] },
        {
          text: '',
          toolCalls: [
            { toolName: 'getFullPageAnalysis', toolCallId: 'c1', input: { url: '/' } },
            { toolName: 'proposeMetaUpdate', toolCallId: 'c2', input: { url: '/' } },
          ],
          toolResults: [
            { toolCallId: 'c1', output: { score: 92 } },
            { toolCallId: 'c2', output: proposalOutput },
          ],
        },
        { text: 'Финальное резюме изменений.', toolCalls: [], toolResults: [] },
      ],
    };
  }

  it('persists the FULL text across all steps, not just the last one', () => {
    const { content } = buildPersistedAssistantMessage(multiStepEvent());
    expect(content).toContain('Вступление: анализирую главную страницу.');
    expect(content).toContain('Финальное резюме изменений.');
    // earlier block must come before the final one
    expect(content.indexOf('Вступление')).toBeLessThan(content.indexOf('Финальное'));
  });

  it('does not duplicate the final block and joins blocks with a blank line', () => {
    const { content } = buildPersistedAssistantMessage(multiStepEvent());
    // two non-empty text blocks → exactly one occurrence each
    expect(content.match(/Финальное резюме изменений\./g)).toHaveLength(1);
    expect(content).toBe(
      'Вступление: анализирую главную страницу.\n\nФинальное резюме изменений.',
    );
  });

  it('persists tool calls from ALL steps with args mapped from `input`', () => {
    const { toolInvocations } = buildPersistedAssistantMessage(multiStepEvent());
    expect(toolInvocations).not.toBeNull();
    expect(toolInvocations).toHaveLength(2);
    const byName = Object.fromEntries(
      toolInvocations!.map((t) => [t.toolName, t]),
    );
    expect(byName['getFullPageAnalysis'].args).toEqual({ url: '/' });
    expect(byName['getFullPageAnalysis'].state).toBe('result');
  });

  it('pairs each tool call with its result so the proposal re-renders on reload', () => {
    const { toolInvocations } = buildPersistedAssistantMessage(multiStepEvent());
    const proposal = toolInvocations!.find((t) => t.toolName === 'proposeMetaUpdate');
    expect(proposal).toBeDefined();
    expect(proposal!.result).toMatchObject({ type: 'proposal', validation: { valid: true } });
    // non-proposal tool result is still preserved
    const analysis = toolInvocations!.find((t) => t.toolName === 'getFullPageAnalysis');
    expect(analysis!.result).toEqual({ score: 92 });
  });

  it('falls back to event.text/toolCalls when there are no steps (single-step turn)', () => {
    const { content, toolInvocations } = buildPersistedAssistantMessage({
      text: 'Простой ответ без инструментов.',
      toolCalls: [{ toolName: 'getPages', toolCallId: 'x', input: { siteId: 's' } }],
      steps: [],
    });
    expect(content).toBe('Простой ответ без инструментов.');
    expect(toolInvocations).toHaveLength(1);
    expect(toolInvocations![0].args).toEqual({ siteId: 's' });
    expect(toolInvocations![0].result).toBeNull();
  });

  it('returns null toolInvocations and empty content for an empty event', () => {
    const { content, toolInvocations } = buildPersistedAssistantMessage({});
    expect(content).toBe('');
    expect(toolInvocations).toBeNull();
  });
});
