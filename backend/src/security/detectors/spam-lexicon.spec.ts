import { detectSpamLexicon } from './spam-lexicon';

describe('detectSpamLexicon', () => {
  it('flags spam terms shown only to the bot', () => {
    const signals = detectSpamLexicon({
      botText: 'Best online casino and poker bonuses here',
      userText: 'We sell quality plumbing services',
      botLinkDomains: [],
      userLinkDomains: [],
    });
    const codes = signals.map((s) => s.code);
    expect(codes).toContain('cloaked_spam_terms');
    expect(signals.find((s) => s.code === 'cloaked_spam_terms')!.malicious).toBe(true);
  });

  it('does not flag spam terms present in both views (legit context)', () => {
    const signals = detectSpamLexicon({
      botText: 'Our casino floor cleaning service',
      userText: 'Our casino floor cleaning service',
      botLinkDomains: [],
      userLinkDomains: [],
    });
    expect(signals.find((s) => s.code === 'cloaked_spam_terms')).toBeUndefined();
  });

  it('flags bot-only links to known spam domains', () => {
    const signals = detectSpamLexicon({
      botText: 'x',
      userText: 'x',
      botLinkDomains: ['1xbet.com', 'example.org'],
      userLinkDomains: ['example.org'],
    });
    const domainSig = signals.find((s) => s.code === 'cloaked_spam_domain');
    expect(domainSig).toBeDefined();
    expect(domainSig!.evidence.domains).toContain('1xbet.com');
  });

  it('does not match substrings inside ordinary words', () => {
    const signals = detectSpamLexicon({
      botText: 'occasionally we assess things', // contains "casin"? no — "occasion"
      userText: 'something else',
      botLinkDomains: [],
      userLinkDomains: [],
    });
    expect(signals.find((s) => s.code === 'cloaked_spam_terms')).toBeUndefined();
  });
});
