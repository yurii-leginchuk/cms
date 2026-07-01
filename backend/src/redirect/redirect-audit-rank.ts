import * as crypto from 'crypto';
import {
  RedirectIssueType,
  RedirectIssueSeverity,
  RedirectFixMode,
  RedirectIssueEvidence,
} from './redirect-issue.entity';

/**
 * Pure ranking / classification substrate for the redirect audit — NO I/O, so the
 * severity tiers, fix-mode routing, traffic-weighted rank, and dedup fingerprint
 * are deterministic and unit-tested. Bump ISSUE_DETECTION_VERSION when any of this
 * changes so re-runs stay comparable (mirrors the crawl MAPPING_VERSION idea).
 */

export const ISSUE_DETECTION_VERSION = 1;

/** Primary rank axis: tier base per issue type (traffic weight is the tiebreaker). */
export const TIER: Record<RedirectIssueType, number> = {
  loop: 100,
  redirect_to_404_410: 90,
  redirect_of_live_page: 80,
  conflict: 70,
  duplicate: 65,
  possible_loop: 62,
  redirect_to_noindex: 60,
  redirect_to_redirect_chain: 40,
  temporary_should_be_permanent: 30,
  dead_redirect: 10,
};

export const SEVERITY: Record<RedirectIssueType, RedirectIssueSeverity> = {
  loop: 'critical',
  redirect_to_404_410: 'critical',
  redirect_of_live_page: 'high',
  conflict: 'high',
  duplicate: 'medium',
  possible_loop: 'high',
  redirect_to_noindex: 'high',
  redirect_to_redirect_chain: 'medium',
  temporary_should_be_permanent: 'medium',
  dead_redirect: 'low',
};

export const FIX_MODE: Record<RedirectIssueType, RedirectFixMode> = {
  loop: 'judgment',
  possible_loop: 'judgment',
  redirect_to_404_410: 'judgment',
  redirect_to_noindex: 'judgment',
  conflict: 'judgment',
  temporary_should_be_permanent: 'judgment',
  redirect_of_live_page: 'judgment',
  redirect_to_redirect_chain: 'batch',
  duplicate: 'batch',
  dead_redirect: 'batch',
};

const WEIGHT_CAP = 999_999_999;

/**
 * Urgency score: `tier * 1e9 + traffic weight`. The tier dominates (issue type
 * order is authoritative); traffic (source clicks × 1000 + impressions, plus a
 * money-page bonus) only orders WITHIN a tier. Missing GSC/inventory data → weight
 * 0, so the issue still ranks by tier — it degrades honestly, never disappears.
 */
export function computeRank(type: RedirectIssueType, e: RedirectIssueEvidence): bigint {
  const clicks = e.sourceClicks ?? 0;
  const impressions = e.sourceImpressions ?? 0;
  const transactional = e.sourceTransactional ? 50_000 : 0;
  const weight = Math.min(WEIGHT_CAP, clicks * 1000 + impressions + transactional);
  return BigInt(TIER[type]) * 1_000_000_000n + BigInt(weight);
}

/**
 * Stable dedup fingerprint for an issue. Combines the issue type with a seed built
 * from the involved redirects' own content fingerprints, so re-running the audit
 * over unchanged redirects yields the SAME fingerprint (upsert, no churn); a change
 * to an involved redirect yields a new fingerprint (old auto-resolves).
 */
export function issueFingerprint(issueType: RedirectIssueType, seed: string): string {
  return crypto.createHash('sha256').update(`${issueType}:${seed}`).digest('hex');
}

/** Build the seed from a set of involved redirect fingerprints (order-independent). */
export function seedFromFingerprints(fingerprints: string[]): string {
  return [...fingerprints].sort().join(',');
}
