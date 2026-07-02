import { AuditCheckType, AuditSeverity, AffectedUrl } from '../audit-finding.entity';
import { DetectorCoverage } from '../audit-run.entity';
import { HeadSignal } from '../audit-head';

/**
 * Shared types for the pure P0 detectors. Each detector is a pure function
 * `(signals) → DetectorResult` — no I/O, versioned, spec-tested. The services
 * gather the signals (readers over existing data + the bounded live-fetch
 * set); the detectors only decide.
 */

export interface RawFinding {
  checkType: AuditCheckType;
  /** Normalized subject (page URL / 'site') — identity, see audit-fingerprint. */
  subjectKey: string;
  /** Optional identity discriminator (https axis, robots rule). */
  discriminator?: string | null;
  /** Deterministic severity from the detector's versioned tier logic. */
  severity: AuditSeverity;
  /** Deterministic human title ("noindex appeared on /pricing"). */
  title: string;
  /** Verbatim evidence envelope — server values only. */
  evidence: Record<string, unknown>;
  affectedUrls: AffectedUrl[];
  /** CMS deep-link route (no query) or null ⇒ task-only. */
  fixRoute: string | null;
  /** Verbatim detector input → the append-only observation ledger. */
  rawSignal: Record<string, unknown>;
}

export interface DetectorResult {
  checkType: AuditCheckType;
  version: number;
  findings: RawFinding[];
  coverage: DetectorCoverage;
  /** Normalized subjectKeys actually evaluated this pass — the resolve gate. */
  evaluatedSubjects: string[];
}

// ── Signals gathered by the services ─────────────────────────────────────────

/** One page from the `pages` inventory with everything the detectors read. */
export interface PageSignal {
  pageId: string;
  url: string;
  /** normalizeAuditUrl(url) — the page's subject key. */
  subjectKey: string;
  /** Head parse of stored rawHtml; null = no rawHtml (page NOT evaluated). */
  head: HeadSignal | null;
  /** CMS robots intent (Yoast tri-state) — intentional noindex never alerts. */
  intentDirective: 'default' | 'index' | 'noindex';
  /** CMS canonical intent (meta editor) — an intent match never alerts. */
  cmsCanonical: string | null;
  isTransactional: boolean;
  missingFromSitemapAt: string | null;
  lastScrapedAt: string | null;
  /** contentStructure.stats.wordCount; null when unparsed. */
  wordCount: number | null;
  /** Google's own verdicts, consumed from the crawl module (never recomputed). */
  crawl: {
    derivedStatus: string | null;
    pageFetchState: string | null;
    googleCanonical: string | null;
  } | null;
  /** GSC clicks/impressions over the evidence window (null = no GSC data). */
  gscClicks: number | null;
  gscImpressions: number | null;
  /** Live probe result — only present for budget-selected suspects. */
  live: LiveProbeSignal | null;
}

export interface LiveProbeSignal {
  url: string;
  fetchedAt: string;
  ok: boolean;
  error: string | null;
  timedOut: boolean;
  /** First-hop HTTP status (verbatim). */
  status: number | null;
  /** Status after following redirects (≤5 hops); equals status when no 3xx. */
  finalStatus: number | null;
  finalUrl: string | null;
  redirectChain: { status: number; location: string }[];
  /** Verbatim X-Robots-Tag header of the first hop, if any. */
  xRobotsTag: string | null;
  /** Head signal parsed from the live body (final hop), when HTML. */
  head: HeadSignal | null;
  contentLength: number | null;
}

export interface RobotsSignal {
  url: string;
  fetchedAt: string;
  ok: boolean;
  error: string | null;
  timedOut: boolean;
  status: number | null;
  /** Verbatim robots.txt body (capped); null when not a 2xx. */
  content: string | null;
}

export interface SitemapSignal {
  url: string;
  fetchedAt: string;
  ok: boolean;
  error: string | null;
  /** true = network-level failure (retryable) → detector NOT evaluated. */
  transportError: boolean;
  status: number | null;
  urlCount: number | null;
  parseError: string | null;
  /** Distinct hosts of listed URLs (top 5) — wrong-host check. */
  hosts: string[];
  /** HTTP requests spent (nested sitemap indexes). */
  fetchesUsed: number;
}

export interface HttpsSignal {
  fetchedAt: string;
  https: { ok: boolean; status: number | null; error: string | null };
  cert: {
    /** null = could not inspect. */
    authorized: boolean | null;
    validTo: string | null;
    daysRemaining: number | null;
    issuer: string | null;
    error: string | null;
  };
  http: {
    ok: boolean;
    status: number | null;
    redirectsToHttps: boolean | null;
    location: string | null;
    error: string | null;
  };
}

export interface NotFoundProbeSignal {
  probeUrl: string;
  fetchedAt: string;
  ok: boolean;
  error: string | null;
  status: number | null;
  title: string | null;
  contentLength: number | null;
}

/** GSC window the click/impression evidence was aggregated over. */
export interface GscWindow {
  from: string;
  to: string;
  timezone: string;
}

export const SEVERITY_RANK: Record<AuditSeverity, number> = {
  notice: 0,
  warning: 1,
  critical: 2,
};

/** Path of a URL for titles ("/pricing"). */
export function pathOf(url: string): string {
  return url.replace(/^https?:\/\/[^/]+/i, '') || '/';
}

/** Is the page "trafficked" (money page) for P0 purposes? */
export function isMoneyPage(p: Pick<PageSignal, 'isTransactional' | 'gscClicks'>): boolean {
  return p.isTransactional || (p.gscClicks ?? 0) > 0;
}
