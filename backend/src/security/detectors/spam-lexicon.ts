/**
 * Spam-lexicon detector. Flags casino / pharma / gambling spam that the
 * Googlebot view contains but the visitor view does not — the classic cloaking
 * payload. Domain matches are weighted far higher than fuzzy term matches
 * because they have near-zero false-positive rate.
 *
 * Pure + versioned. Bump LEXICON_VERSION when the lists change.
 */

import { DetectorSignal } from '../security.types';
import { registrableDomain } from '../normalize';

export const LEXICON_VERSION = 1;

/** Lowercased spam terms. Matched as whole words to limit false positives. */
const SPAM_TERMS = [
  'casino', 'casinos', 'gambling', 'roulette', 'blackjack', 'baccarat',
  'slots', 'slot machine', 'poker', 'betting', 'sportsbook', 'jackpot',
  'viagra', 'cialis', 'levitra', 'tadalafil', 'sildenafil',
  'payday loan', 'payday loans', 'replica watches', 'escort', 'escorts',
  'porn', 'xxx', 'sex video',
];

/** Registrable domains strongly associated with gambling / spam link networks. */
const SPAM_DOMAINS = [
  '1xbet.com', 'bet365.com', '888casino.com', 'stake.com', 'betway.com',
  'pin-up.com', 'mostbet.com', 'parimatch.com', 'melbet.com', '22bet.com',
];

const SPAM_DOMAIN_SET = new Set(SPAM_DOMAINS);

function wordMatches(text: string): string[] {
  const lower = text.toLowerCase();
  const hits = new Set<string>();
  for (const term of SPAM_TERMS) {
    // word-boundary-ish match: surrounded by non-letters
    const re = new RegExp(`(^|[^a-z])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`, 'i');
    if (re.test(lower)) hits.add(term);
  }
  return [...hits];
}

export interface SpamInputs {
  botText: string;
  userText: string;
  botLinkDomains: string[];
  userLinkDomains: string[];
}

export function detectSpamLexicon(input: SpamInputs): DetectorSignal[] {
  const signals: DetectorSignal[] = [];

  const botTerms = wordMatches(input.botText);
  const userTerms = new Set(wordMatches(input.userText));
  const cloakedTerms = botTerms.filter((t) => !userTerms.has(t));

  if (cloakedTerms.length > 0) {
    signals.push({
      detector: 'spam_lexicon',
      code: 'cloaked_spam_terms',
      malicious: true,
      weight: Math.min(20, 4 + cloakedTerms.length * 2),
      message: `Googlebot-only spam terms: ${cloakedTerms.slice(0, 8).join(', ')}`,
      evidence: { terms: cloakedTerms },
    });
  }

  const userDomains = new Set(input.userLinkDomains.map(registrableDomain));
  const spamLinks = input.botLinkDomains
    .map(registrableDomain)
    .filter((d) => SPAM_DOMAIN_SET.has(d) && !userDomains.has(d));

  if (spamLinks.length > 0) {
    signals.push({
      detector: 'spam_lexicon',
      code: 'cloaked_spam_domain',
      malicious: true,
      weight: 30,
      message: `Googlebot-only links to known spam domains: ${[...new Set(spamLinks)].join(', ')}`,
      evidence: { domains: [...new Set(spamLinks)] },
    });
  }

  return signals;
}
