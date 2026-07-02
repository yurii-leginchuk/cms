import { DetectorResult, PageSignal, RawFinding, RobotsSignal, isMoneyPage } from './detector-types';
import { SITE_SUBJECT } from '../audit-fingerprint';

/**
 * P0 #2 — robots.txt regression. DIFF-based, never a naive string alarm:
 *  - robots.txt now 5xx / network-unreachable (Google throttles crawling on a
 *    5xx robots.txt; a 404 is fine = allow-all, and is NOT a finding).
 *  - a Disallow rule that is NEW versus the previous stored copy AND covers
 *    pages in the CMS inventory (critical when it covers trafficked/money
 *    pages). Whitespace/comment churn is ignored by parsing rules first.
 *
 * Identity: one finding per offending rule (discriminator = the normalized
 * rule), so a rule stays one stable finding until it leaves robots.txt.
 * Previously-flagged open rules are re-emitted while still present — the
 * baseline never silently "accepts" a regression after one week.
 */
export const ROBOTS_TXT_VERSION = 1;

export interface RobotsRule {
  agent: string;
  rule: string;
}

/** Parse Disallow rules (comments/blank lines ignored; agent-grouped). */
export function parseRobotsDisallows(content: string): RobotsRule[] {
  const out: RobotsRule[] = [];
  let agents: string[] = [];
  let sawDirective = false;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      if (sawDirective) agents = [];
      agents.push(value.toLowerCase());
      sawDirective = false;
    } else {
      sawDirective = true;
      if (key === 'disallow' && value !== '') {
        for (const agent of agents.length ? agents : ['*']) {
          out.push({ agent, rule: value });
        }
      }
    }
  }
  return out;
}

/** Does a robots.txt rule (prefix + `*` wildcard + `$` end anchor) match a path? */
export function robotsRuleMatches(rule: string, path: string): boolean {
  const anchored = rule.endsWith('$');
  const body = anchored ? rule.slice(0, -1) : rule;
  const escaped = body.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  const re = new RegExp(`^${escaped}${anchored ? '$' : ''}`);
  return re.test(path);
}

/** Rules that apply to Google's crawl (agent `*` or googlebot). */
function googleRelevant(rules: RobotsRule[]): string[] {
  return [...new Set(
    rules
      .filter((r) => r.agent === '*' || r.agent.startsWith('googlebot'))
      .map((r) => r.rule),
  )].sort();
}

export function detectRobotsTxtRegression(input: {
  current: RobotsSignal;
  /** Verbatim previous robots.txt body (from the last run's snapshot); null = first run. */
  previousContent: string | null;
  /** Normalized rules of currently-open robots findings (persistence re-check). */
  openRules: string[];
  pages: PageSignal[];
  siteUrl: string;
}): DetectorResult {
  const { current, previousContent, openRules, pages } = input;
  const findings: RawFinding[] = [];

  // Transport failure or 5xx — Google would throttle crawling. Fires even on a
  // first run: a broken robots.txt is never intentional configuration.
  const unreachable = !current.ok || (current.status != null && current.status >= 500);

  if (unreachable) {
    findings.push({
      checkType: 'robots_txt_regression',
      subjectKey: SITE_SUBJECT,
      discriminator: 'unreachable',
      severity: 'critical',
      title: current.status != null
        ? `robots.txt returns HTTP ${current.status}`
        : 'robots.txt is unreachable',
      evidence: {
        url: current.url,
        status: current.status,
        error: current.error,
        fetchedAt: current.fetchedAt,
        note: 'Google throttles crawling of the whole site while robots.txt errors (a 404 would be fine — this is not one).',
      },
      affectedUrls: [{ url: current.url }],
      fixRoute: null,
      rawSignal: { status: current.status, error: current.error },
    });

    return result(findings, {
      // The fetch was attempted but the BODY could not be evaluated → the
      // rule-diff part of this pass did NOT complete: scopeComplete=false so
      // open rule-findings stay `unconfirmed` instead of falsely resolving.
      subjectsSelected: 1,
      subjectsEvaluated: 0,
      subjectsErrored: current.timedOut ? 0 : 1,
      subjectsTimedOut: current.timedOut ? 1 : 0,
      scopeComplete: false,
    }, []);
  }

  // 404/absent robots.txt = allow-all — fine, and there are no rules to diff.
  const content = current.content ?? '';
  const currentRules = googleRelevant(parseRobotsDisallows(content));
  const previousRules = previousContent != null
    ? googleRelevant(parseRobotsDisallows(previousContent))
    : null;

  const newRules = previousRules != null
    ? currentRules.filter((r) => !previousRules.includes(r))
    : []; // first run: no baseline → no diff findings (delta-triggered only)

  // Rules to report = newly-appeared rules + previously-flagged rules still present.
  const reportRules = [...new Set([
    ...newRules,
    ...openRules.filter((r) => currentRules.includes(r)),
  ])].sort();

  for (const rule of reportRules) {
    const covered = pages.filter(
      (p) => p.missingFromSitemapAt == null && robotsRuleMatches(rule, pathOfUrl(p.url)),
    );
    if (covered.length === 0) continue; // covers nothing the CMS manages — config, not an alert
    const money = covered.filter((p) => isMoneyPage(p));
    const clicksAtRisk = covered.reduce((s, p) => s + (p.gscClicks ?? 0), 0);

    findings.push({
      checkType: 'robots_txt_regression',
      subjectKey: SITE_SUBJECT,
      discriminator: rule,
      severity: money.length > 0 ? 'critical' : 'warning',
      title: `robots.txt now disallows ${rule} (${covered.length} page${covered.length === 1 ? '' : 's'} covered)`,
      evidence: {
        rule,
        coveredPages: covered.length,
        moneyPagesCovered: money.length,
        gscClicksAtRisk: clicksAtRisk,
        sample: covered.slice(0, 20).map((p) => p.url),
        fetchedAt: current.fetchedAt,
        isNewThisRun: newRules.includes(rule),
      },
      affectedUrls: covered.slice(0, 100).map((p) => ({ url: p.url, pageId: p.pageId })),
      fixRoute: null, // robots.txt is theme/server-side — task-only
      rawSignal: { rule, robotsStatus: current.status },
    });
  }

  return result(findings, {
    subjectsSelected: 1,
    subjectsEvaluated: 1,
    subjectsErrored: 0,
    subjectsTimedOut: 0,
    scopeComplete: true,
  }, [SITE_SUBJECT]);
}

function pathOfUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

function result(
  findings: RawFinding[],
  coverage: DetectorResult['coverage'],
  evaluatedSubjects: string[],
): DetectorResult {
  return {
    checkType: 'robots_txt_regression',
    version: ROBOTS_TXT_VERSION,
    findings,
    coverage,
    evaluatedSubjects,
  };
}
