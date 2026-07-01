import {
  TIER,
  SEVERITY,
  FIX_MODE,
  computeRank,
  issueFingerprint,
  seedFromFingerprints,
} from './redirect-audit-rank';
import { RedirectIssueEvidence } from './redirect-issue.entity';

function ev(over: Partial<RedirectIssueEvidence> = {}): RedirectIssueEvidence {
  return {
    sourceClicks: null, sourceImpressions: null, sourceInInventory: null, sourceTransactional: null,
    targetIndexed: null, targetStatus: null, targetInInventory: null, liveFinalStatus: null,
    chainLength: null, cycleCertainty: null, ...over,
  };
}

describe('tier / severity / fix-mode routing', () => {
  it('ranks loop above 404/410 above live-page above chain above dead (by tier)', () => {
    expect(TIER.loop).toBeGreaterThan(TIER.redirect_to_404_410);
    expect(TIER.redirect_to_404_410).toBeGreaterThan(TIER.redirect_of_live_page);
    expect(TIER.redirect_of_live_page).toBeGreaterThan(TIER.redirect_to_redirect_chain);
    expect(TIER.redirect_to_redirect_chain).toBeGreaterThan(TIER.temporary_should_be_permanent);
    expect(TIER.temporary_should_be_permanent).toBeGreaterThan(TIER.dead_redirect);
  });

  it('marks loops + dead targets critical, dead redirect low', () => {
    expect(SEVERITY.loop).toBe('critical');
    expect(SEVERITY.redirect_to_404_410).toBe('critical');
    expect(SEVERITY.dead_redirect).toBe('low');
  });

  it('routes mechanical fixes to batch and decisions to judgment', () => {
    expect(FIX_MODE.duplicate).toBe('batch');
    expect(FIX_MODE.redirect_to_redirect_chain).toBe('batch');
    expect(FIX_MODE.dead_redirect).toBe('batch');
    expect(FIX_MODE.loop).toBe('judgment');
    expect(FIX_MODE.conflict).toBe('judgment');
    expect(FIX_MODE.temporary_should_be_permanent).toBe('judgment');
  });
});

describe('computeRank', () => {
  it('tier dominates traffic — a loop with no data outranks a chain with huge traffic', () => {
    const loop = computeRank('loop', ev());
    const chain = computeRank('redirect_to_redirect_chain', ev({ sourceClicks: 100000, sourceImpressions: 999999 }));
    expect(loop).toBeGreaterThan(chain);
  });

  it('within a tier, more traffic ranks higher', () => {
    const busy = computeRank('duplicate', ev({ sourceClicks: 500, sourceImpressions: 9000 }));
    const quiet = computeRank('duplicate', ev({ sourceClicks: 1, sourceImpressions: 10 }));
    expect(busy).toBeGreaterThan(quiet);
  });

  it('missing GSC data degrades to the tier base (weight 0), never disappears', () => {
    const base = computeRank('conflict', ev());
    expect(base).toBe(BigInt(TIER.conflict) * 1_000_000_000n);
  });

  it('a transactional (money) source gets a within-tier bonus', () => {
    const money = computeRank('redirect_of_live_page', ev({ sourceTransactional: true }));
    const plain = computeRank('redirect_of_live_page', ev({ sourceTransactional: false }));
    expect(money).toBeGreaterThan(plain);
  });
});

describe('issueFingerprint / dedup', () => {
  it('is stable for the same type + involved redirects (no churn on re-run)', () => {
    const seed = seedFromFingerprints(['fpB', 'fpA']);
    expect(issueFingerprint('duplicate', seed)).toBe(issueFingerprint('duplicate', seedFromFingerprints(['fpA', 'fpB'])));
  });

  it('changes when an involved redirect changes (old issue auto-resolves)', () => {
    expect(issueFingerprint('duplicate', seedFromFingerprints(['fpA', 'fpB'])))
      .not.toBe(issueFingerprint('duplicate', seedFromFingerprints(['fpA', 'fpC'])));
  });

  it('distinguishes different issue types over the same redirects', () => {
    const seed = seedFromFingerprints(['fpA']);
    expect(issueFingerprint('dead_redirect', seed)).not.toBe(issueFingerprint('redirect_of_live_page', seed));
  });
});
