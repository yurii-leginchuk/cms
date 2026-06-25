import { detectContentDiff, buildExcerpt, MAX_EXCERPT_BYTES } from './content-diff';

describe('detectContentDiff', () => {
  it('is silent when hashes match', () => {
    expect(
      detectContentDiff({ botHash: 'a', userHash: 'a', botText: 'x', userText: 'x' }),
    ).toHaveLength(0);
  });

  it('emits one benign signal when hashes differ', () => {
    const signals = detectContentDiff({ botHash: 'a', userHash: 'b', botText: 'x', userText: 'y' });
    expect(signals).toHaveLength(1);
    expect(signals[0].malicious).toBe(false);
    expect(signals[0].code).toBe('content_mismatch');
  });
});

describe('buildExcerpt', () => {
  it('captures lines present only in the bot view', () => {
    const excerpt = buildExcerpt('shared line\ncasino bonus\nmore spam', 'shared line');
    expect(excerpt).toContain('casino bonus');
    expect(excerpt).not.toContain('shared line');
  });

  it('caps the excerpt at MAX_EXCERPT_BYTES', () => {
    const huge = Array.from({ length: 5000 }, (_, i) => `spam line ${i}`).join('\n');
    const excerpt = buildExcerpt(huge, '');
    expect(Buffer.byteLength(excerpt)).toBeLessThanOrEqual(MAX_EXCERPT_BYTES);
  });
});
