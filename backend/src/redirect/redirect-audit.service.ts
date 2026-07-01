import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Site } from '../sites/site.entity';
import { Page } from '../pages/page.entity';
import { GscDaily } from '../impact/gsc-daily.entity';
import { CrawlPageStatus } from '../crawl/crawl-page-status.entity';
import { Ga4Service } from '../ga4/ga4.service';
import { RedirectItem } from './redirect-item.entity';
import {
  RedirectIssue,
  RedirectIssueType,
  RedirectIssueEvidence,
} from './redirect-issue.entity';
import { RedirectAuditRun, RedirectAuditTrigger } from './redirect-audit-run.entity';
import {
  ISSUE_DETECTION_VERSION,
  SEVERITY,
  FIX_MODE,
  computeRank,
  issueFingerprint,
  seedFromFingerprints,
} from './redirect-audit-rank';
import { RedirectWriteService } from './redirect-write.service';
import { RedirectValidateService } from './redirect-validate.service';
import {
  GraphRedirect,
  detectCycles,
  findChains,
  findConflicts,
  findDuplicates,
} from './redirect-graph';

/** Enrichment window for GSC/GA4 (days). */
const WINDOW_DAYS = 28;

interface Candidate {
  issueType: RedirectIssueType;
  redirectIds: string[];
  primaryRedirectId: string | null;
  title: string;
  detail: string | null;
  proposedFix: Record<string, unknown> | null;
  /** Item whose source drives the traffic weight + evidence. */
  weightItem: RedirectItem | null;
  /** Item whose target drives the target-side evidence. */
  targetItem: RedirectItem | null;
  fingerprintSeed: string;
}

@Injectable()
export class RedirectAuditService {
  private readonly logger = new Logger(RedirectAuditService.name);

  constructor(
    @InjectRepository(RedirectItem) private readonly itemRepo: Repository<RedirectItem>,
    @InjectRepository(RedirectIssue) private readonly issueRepo: Repository<RedirectIssue>,
    @InjectRepository(RedirectAuditRun) private readonly runRepo: Repository<RedirectAuditRun>,
    @InjectRepository(Site) private readonly siteRepo: Repository<Site>,
    @InjectRepository(Page) private readonly pageRepo: Repository<Page>,
    @InjectRepository(GscDaily) private readonly gscRepo: Repository<GscDaily>,
    @InjectRepository(CrawlPageStatus) private readonly crawlRepo: Repository<CrawlPageStatus>,
    private readonly write: RedirectWriteService,
    private readonly validate: RedirectValidateService,
    private readonly ga4: Ga4Service,
  ) {}

  // ── Audit run ────────────────────────────────────────────────────────────

  /**
   * Run the first-sync audit (or a manual re-run): detect issues via the Phase-3
   * graph, enrich each with a best-effort JOIN to GSC/index/inventory, rank by
   * tier + traffic, and upsert deduped by fingerprint (auto-resolving issues whose
   * condition no longer holds). Survey-only — no writes to WordPress.
   */
  async runAudit(siteId: string, trigger: RedirectAuditTrigger): Promise<RedirectAuditRun> {
    const site = await this.siteRepo.findOne({ where: { id: siteId } });
    if (!site) throw new NotFoundException('Site not found');
    const siteHost = this.hostOf(site.url);

    const run = await this.runRepo.save(
      this.runRepo.create({ siteId, trigger, detectionVersion: ISSUE_DETECTION_VERSION }),
    );

    try {
      const items = (await this.itemRepo.find({ where: { siteId } })).filter((i) => i.deletedInWpAt == null);
      run.redirectsAnalyzed = items.length;
      const byId = new Map(items.map((i) => [i.id, i]));

      // Best-effort enrichment lookups (one query each; missing data → nulls).
      const [gsc, inventory, crawl] = await Promise.all([
        this.loadGsc(siteId),
        this.loadInventory(siteId),
        this.loadCrawl(siteId),
      ]);

      const candidates = [
        ...this.detect(items, byId, site.url, siteHost),
        ...this.detectEnriched(items, byId, site.url, gsc, inventory, crawl),
      ];

      // Upsert vs the existing set (dedup + auto-resolve).
      const existing = await this.issueRepo.find({ where: { siteId } });
      const existingByFp = new Map(existing.map((e) => [e.fingerprint, e]));
      const seen = new Set<string>();

      const bySeverity: Record<string, number> = {};
      const byType: Record<string, number> = {};

      for (const c of candidates) {
        const fingerprint = this.fingerprint(c);
        if (seen.has(fingerprint)) continue;
        seen.add(fingerprint);

        const evidence = this.enrich(c, site.url, gsc, inventory, crawl);
        const severity = SEVERITY[c.issueType];
        const rank = computeRank(c.issueType, evidence);
        byType[c.issueType] = (byType[c.issueType] ?? 0) + 1;
        bySeverity[severity] = (bySeverity[severity] ?? 0) + 1;

        const row = existingByFp.get(fingerprint);
        if (row) {
          // Respect a manual defer; otherwise (re)open.
          row.status = row.status === 'deferred' ? 'deferred' : 'open';
          row.resolvedAt = null;
          Object.assign(row, {
            issueType: c.issueType, severity, fixMode: FIX_MODE[c.issueType],
            rank: rank.toString(), primaryRedirectId: c.primaryRedirectId, redirectIds: c.redirectIds,
            title: c.title, detail: c.detail, evidence, proposedFix: c.proposedFix,
            detectionVersion: ISSUE_DETECTION_VERSION, lastRunId: run.id,
          });
          await this.issueRepo.save(row);
        } else {
          await this.issueRepo.save(this.issueRepo.create({
            siteId, issueType: c.issueType, severity, fixMode: FIX_MODE[c.issueType],
            rank: rank.toString(), fingerprint, primaryRedirectId: c.primaryRedirectId,
            redirectIds: c.redirectIds, title: c.title, detail: c.detail, evidence,
            proposedFix: c.proposedFix, status: 'open', detectionVersion: ISSUE_DETECTION_VERSION,
            lastRunId: run.id, firstSeenAt: new Date(),
          }));
        }
      }

      // Auto-resolve open/deferred issues whose condition no longer holds.
      let resolved = 0;
      for (const e of existing) {
        if ((e.status === 'open' || e.status === 'deferred') && !seen.has(e.fingerprint)) {
          e.status = 'resolved';
          e.resolvedAt = new Date();
          e.lastRunId = run.id;
          await this.issueRepo.save(e);
          resolved += 1;
        }
      }

      // Ambient GA4/GSC context (site-level; NOT attributed per issue).
      run.gscConnected = gsc.size > 0 || !!site.gscProperty;
      await this.attachGa4Context(run, siteId);

      run.issuesOpen = seen.size;
      run.issuesResolved = resolved;
      run.byType = byType;
      run.bySeverity = bySeverity;
      run.finishedAt = new Date();
      return await this.runRepo.save(run);
    } catch (err) {
      run.fatalError = (err as Error).message;
      run.finishedAt = new Date();
      return await this.runRepo.save(run);
    }
  }

  /**
   * First-sync hook: run the audit ONCE, the first time a site has redirects and
   * no audit has ever run. Best-effort — a failure here never fails the sync.
   */
  async runIfFirst(siteId: string): Promise<void> {
    const already = await this.runRepo.count({ where: { siteId } });
    if (already > 0) return;
    const hasRedirects = await this.itemRepo.count({ where: { siteId } });
    if (hasRedirects === 0) return;
    try {
      await this.runAudit(siteId, 'first_sync');
    } catch (err) {
      this.logger.warn(`First-sync audit failed for ${siteId}: ${(err as Error).message}`);
    }
  }

  // ── Detection (Phase-3 graph + per-item signals) ───────────────────────────

  private detect(
    items: RedirectItem[],
    byId: Map<string, RedirectItem>,
    siteBase: string,
    siteHost: string | null,
  ): Candidate[] {
    const graph: GraphRedirect[] = items.map((i) => ({
      id: i.id, pluginId: i.pluginId, source: i.source, sourceNormalized: i.sourceNormalized,
      target: i.target, targetNormalized: i.targetNormalized, matchType: i.matchType,
      regex: i.regex, actionType: i.actionType, actionCode: i.actionCode, enabled: i.enabled,
    }));
    const out: Candidate[] = [];

    // Group issues from the graph.
    for (const c of detectCycles(graph, siteHost)) {
      const type: RedirectIssueType = c.certainty === 'exact' ? 'loop' : 'possible_loop';
      const primary = c.redirectIds[0] ?? null;
      out.push({
        issueType: type, redirectIds: c.redirectIds, primaryRedirectId: primary,
        title: `${c.certainty === 'exact' ? 'Redirect loop' : 'Possible loop'}: ${c.nodes.join(' → ')}`,
        detail: c.certainty === 'exact'
          ? 'These redirects point at each other — visitors and crawlers get stuck.'
          : 'A loop is possible through a regex/external hop — unverifiable, needs a human check.',
        proposedFix: { kind: 'break_loop', nodes: c.nodes },
        weightItem: primary ? byId.get(primary) ?? null : null, targetItem: null,
        fingerprintSeed: this.seedFromIds(c.redirectIds, byId),
      });
    }
    for (const cf of findConflicts(graph)) {
      const ids = cf.variants.map((v) => v.redirectId);
      out.push({
        issueType: 'conflict', redirectIds: ids, primaryRedirectId: ids[0] ?? null,
        title: `Conflicting redirects for ${cf.sourceNormalized}`,
        detail: 'The same source sends to different destinations — only one can win.',
        proposedFix: { kind: 'pick_winner', variants: cf.variants },
        weightItem: byId.get(ids[0]) ?? null, targetItem: null,
        fingerprintSeed: this.seedFromIds(ids, byId),
      });
    }
    for (const d of findDuplicates(graph)) {
      out.push({
        issueType: 'duplicate', redirectIds: d.redirectIds, primaryRedirectId: d.redirectIds[0] ?? null,
        title: `Duplicate redirects for ${d.sourceNormalized}`,
        detail: `${d.redirectIds.length} identical rules — keep one, disable the rest.`,
        proposedFix: { kind: 'disable_extras', keepId: d.redirectIds[0], disableIds: d.redirectIds.slice(1) },
        weightItem: byId.get(d.redirectIds[0]) ?? null, targetItem: null,
        fingerprintSeed: this.seedFromIds(d.redirectIds, byId),
      });
    }
    for (const ch of findChains(graph, siteHost)) {
      const primary = ch.headId;
      out.push({
        issueType: 'redirect_to_redirect_chain', redirectIds: ch.redirectIds, primaryRedirectId: primary,
        title: `Redirect chain (${ch.length} hops): ${ch.hops.join(' → ')}`,
        detail: 'A multi-hop chain loses link equity and slows visitors — flatten to one hop.',
        proposedFix: { kind: 'flatten', headId: primary, chainLength: ch.length },
        weightItem: byId.get(primary) ?? null, targetItem: byId.get(ch.redirectIds[ch.redirectIds.length - 1]) ?? null,
        fingerprintSeed: this.seedFromIds(ch.redirectIds, byId),
      });
    }

    // Per-item signal available WITHOUT enrichment: redirect → dead page, using the
    // cached live-resolve status (Phase 3). Target-status / index / traffic signals
    // that need the JOIN maps are emitted in detectEnriched().
    for (const i of items) {
      if (!i.enabled) continue;
      const isUrlRedirect = (i.actionType ?? 'url') === 'url' && !!i.target;
      const deadByLive = i.liveFinalStatus != null && i.liveFinalStatus >= 400;
      if (isUrlRedirect && deadByLive) {
        out.push(this.itemIssue('redirect_to_404_410', i, byId,
          `Redirect points at a dead page (HTTP ${i.liveFinalStatus})`,
          'The target returns an error — the redirect throws away all its link equity.',
          { kind: 'fix_target' }, i, i));
      }
    }

    return out;
  }

  /**
   * Issue candidates that require enrichment data to decide (noindex target,
   * temp-should-be-permanent, redirect-of-live-page, dead redirect). Kept separate
   * so `detect()` stays pure-ish; run inside runAudit with the maps.
   */
  private detectEnriched(
    items: RedirectItem[],
    byId: Map<string, RedirectItem>,
    siteBase: string,
    gsc: Map<string, { clicks: number; impressions: number }>,
    inventory: Map<string, { isTransactional: boolean }>,
    crawl: Map<string, { isIndexed: boolean | null; derivedStatus: string | null }>,
  ): Candidate[] {
    const out: Candidate[] = [];
    for (const i of items) {
      if (!i.enabled) continue;
      const isUrlRedirect = (i.actionType ?? 'url') === 'url' && !!i.target;
      const srcKey = this.urlKey(this.absolute(siteBase, i.source));
      const tgtKey = i.target ? this.urlKey(this.absolute(siteBase, i.target)) : null;
      const tgtCrawl = tgtKey ? crawl.get(tgtKey) : undefined;
      const deadByLive = i.liveFinalStatus != null && i.liveFinalStatus >= 400;
      const tgtDeadByCrawl = !!tgtCrawl &&
        ['not_found', 'soft_404', 'server_error'].includes(tgtCrawl.derivedStatus ?? '');

      // redirect → dead target per the crawl index (when live-resolve hasn't run/said so).
      if (isUrlRedirect && !deadByLive && tgtDeadByCrawl) {
        out.push(this.itemIssue('redirect_to_404_410', i, byId,
          `Redirect target is dead (${tgtCrawl!.derivedStatus})`,
          'Google reports the target as not-found/soft-404 — the redirect wastes its link equity.',
          { kind: 'fix_target' }, i, i));
      } else if (isUrlRedirect && !deadByLive && tgtCrawl &&
          (tgtCrawl.isIndexed === false || tgtCrawl.derivedStatus === 'excluded_noindex')) {
        // redirect → noindex target (only when the target isn't already dead).
        out.push(this.itemIssue('redirect_to_noindex', i, byId,
          'Redirect points at a non-indexed page',
          'The target is excluded from Google — the redirect passes users/crawlers to a dead-end for search.',
          { kind: 'review_target' }, i, i));
      }

      // 302/307 that has been firing → probably should be a permanent 301.
      if (isUrlRedirect && (i.actionCode === 302 || i.actionCode === 307) &&
          (i.wpLastCount > 0 || i.liveFinalStatus === 200)) {
        out.push(this.itemIssue('temporary_should_be_permanent', i, byId,
          `Temporary ${i.actionCode} that looks permanent`,
          'A long-lived temporary redirect passes less equity than a 301 — confirm and promote if it is permanent.',
          { kind: 'promote_301', from: i.actionCode }, i, i));
      }

      // Redirecting a page that is itself live / earning (money-page guardrail).
      const src = gsc.get(srcKey);
      const inInv = inventory.has(srcKey);
      if ((inInv || (src && src.clicks > 0))) {
        out.push(this.itemIssue('redirect_of_live_page', i, byId,
          'Redirecting a live / earning page',
          'This source is a real page (or still earns clicks) — redirecting it can lose traffic. Review before keeping.',
          { kind: 'review_source' }, i, null));
      }

      // Dead redirect: never fired (0 hits) — cautious low-priority cleanup.
      if (i.wpLastCount === 0 && !i.regex) {
        out.push(this.itemIssue('dead_redirect', i, byId,
          'Redirect with 0 recorded hits',
          'No recorded hits — a candidate to disable, but a 0-hit redirect may still catch an old backlink; review.',
          { kind: 'disable', id: i.id }, i, null));
      }
    }
    return out;
  }

  private itemIssue(
    type: RedirectIssueType, item: RedirectItem, _byId: Map<string, RedirectItem>,
    title: string, detail: string, proposedFix: Record<string, unknown>,
    weightItem: RedirectItem | null, targetItem: RedirectItem | null,
  ): Candidate {
    return {
      issueType: type, redirectIds: [item.id], primaryRedirectId: item.id,
      title: `${title}: ${item.source}`, detail, proposedFix,
      weightItem, targetItem, fingerprintSeed: item.fingerprint,
    };
  }

  // ── Enrichment ─────────────────────────────────────────────────────────────

  private enrich(
    c: Candidate,
    siteBase: string,
    gsc: Map<string, { clicks: number; impressions: number }>,
    inventory: Map<string, { isTransactional: boolean }>,
    crawl: Map<string, { isIndexed: boolean | null; derivedStatus: string | null }>,
  ): RedirectIssueEvidence {
    const w = c.weightItem;
    const t = c.targetItem;
    const srcKey = w ? this.urlKey(this.absolute(siteBase, w.source)) : null;
    const tgtKey = t?.target ? this.urlKey(this.absolute(siteBase, t.target)) : null;

    const src = srcKey ? gsc.get(srcKey) : undefined;
    const inv = srcKey ? inventory.get(srcKey) : undefined;
    const tgtCrawl = tgtKey ? crawl.get(tgtKey) : undefined;

    return {
      sourceClicks: src ? src.clicks : null,
      sourceImpressions: src ? src.impressions : null,
      sourceInInventory: srcKey ? inventory.has(srcKey) : null,
      sourceTransactional: inv ? inv.isTransactional : null,
      targetIndexed: tgtCrawl ? tgtCrawl.isIndexed : null,
      targetStatus: tgtCrawl ? tgtCrawl.derivedStatus : null,
      targetInInventory: tgtKey ? inventory.has(tgtKey) : null,
      liveFinalStatus: t ? t.liveFinalStatus : (w ? w.liveFinalStatus : null),
      chainLength: (c.proposedFix?.chainLength as number | undefined) ?? null,
      cycleCertainty: c.issueType === 'loop' ? 'exact' : c.issueType === 'possible_loop' ? 'possible' : null,
    };
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  async getSummary(siteId: string) {
    const lastRun = await this.runRepo.findOne({ where: { siteId }, order: { startedAt: 'DESC' } });
    const open = await this.issueRepo.find({ where: { siteId, status: 'open' }, select: ['issueType', 'severity', 'fixMode'] });
    const deferred = await this.issueRepo.count({ where: { siteId, status: 'deferred' } });

    const byType: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    let batch = 0, judgment = 0;
    for (const i of open) {
      byType[i.issueType] = (byType[i.issueType] ?? 0) + 1;
      bySeverity[i.severity] = (bySeverity[i.severity] ?? 0) + 1;
      if (i.fixMode === 'batch') batch += 1;
      else if (i.fixMode === 'judgment') judgment += 1;
    }
    return {
      hasAudited: !!lastRun,
      open: open.length,
      deferred,
      byType,
      bySeverity,
      batchFixable: batch,
      judgmentNeeded: judgment,
      lastRun: lastRun
        ? {
            id: lastRun.id, trigger: lastRun.trigger, startedAt: lastRun.startedAt,
            finishedAt: lastRun.finishedAt, redirectsAnalyzed: lastRun.redirectsAnalyzed,
            gscConnected: lastRun.gscConnected, ga4Connected: lastRun.ga4Connected,
            ga4OrganicRevenue: lastRun.ga4OrganicRevenue, detectionVersion: lastRun.detectionVersion,
          }
        : null,
    };
  }

  async listIssues(siteId: string, f: { status?: string; type?: string; fixMode?: string; page?: number; limit?: number }) {
    const page = Math.max(1, f.page ?? 1);
    const limit = Math.min(200, Math.max(1, f.limit ?? 50));
    const where: Record<string, unknown> = { siteId, status: f.status ?? 'open' };
    if (f.type) where.issueType = f.type;
    if (f.fixMode) where.fixMode = f.fixMode;
    const [rows, total] = await this.issueRepo.findAndCount({
      where,
      order: { rank: 'DESC', createdAt: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data: rows, meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
  }

  async deferIssue(siteId: string, id: string) {
    const issue = await this.requireIssue(siteId, id);
    issue.status = 'deferred';
    issue.deferredAt = new Date();
    return this.issueRepo.save(issue);
  }

  async reopenIssue(siteId: string, id: string) {
    const issue = await this.requireIssue(siteId, id);
    issue.status = 'open';
    issue.deferredAt = null;
    return this.issueRepo.save(issue);
  }

  /**
   * AI-judgment SEAM. Today this returns a deterministic, grounded rationale +
   * suggested fix built from the enrichment evidence — NO LLM call. It's the
   * plug-in point for the existing grounded AI (schema-ai style) in a later phase;
   * the 404→target-picking via embeddings is likewise a documented stub here.
   */
  async suggestJudgment(siteId: string, id: string) {
    const issue = await this.requireIssue(siteId, id);
    const e = issue.evidence;
    const clicksTxt = e?.sourceClicks != null ? `${e.sourceClicks} clicks / ${e.sourceImpressions ?? 0} impressions (28d)` : 'no GSC data';
    const idxTxt = e?.targetIndexed === false ? 'target NOT indexed' : e?.targetIndexed === true ? 'target indexed' : 'target index status unknown';

    let suggestion: string | null = null;
    if (issue.issueType === 'temporary_should_be_permanent') suggestion = 'If this redirect is permanent, change it to a 301.';
    else if (issue.issueType === 'conflict') suggestion = 'Keep the variant on the higher-traffic/most-recent target; disable the rest.';
    else if (issue.issueType === 'redirect_to_404_410') suggestion = 'Point the redirect at a live, relevant page (target-picking via embeddings is a Phase-6 stub).';
    else if (issue.issueType === 'redirect_of_live_page') suggestion = 'Confirm this page should be redirected — it still earns traffic.';

    return {
      issueId: issue.id,
      aiAvailable: false, // deterministic seam today; LLM suggestion deferred
      source: 'deterministic',
      rationale: `${issue.title}. Evidence: ${clicksTxt}; ${idxTxt}. ${issue.detail ?? ''}`.trim(),
      suggestedFix: suggestion,
      proposedFix: issue.proposedFix,
    };
  }

  // ── Batch fixes (all through the Phase-2 gate — nothing bypasses approval) ──

  /** Flatten every open chain issue whose LIVE resolve verdict is `ready`. */
  async batchFlatten(siteId: string): Promise<{ queued: number; skipped: number; errors: number }> {
    const issues = await this.issueRepo.find({ where: { siteId, status: 'open', issueType: 'redirect_to_redirect_chain' } });
    let queued = 0, skipped = 0, errors = 0;
    for (const issue of issues) {
      const headId = (issue.proposedFix?.headId as string) ?? issue.primaryRedirectId;
      if (!headId) { skipped += 1; continue; }
      try {
        const preview = await this.validate.flattenPreview(siteId, headId);
        if (preview.verdict === 'ready' && preview.after) {
          await this.write.proposeUpdate(siteId, headId, {
            source: preview.after.source, target: preview.after.target, actionCode: preview.after.actionCode,
          });
          queued += 1;
        } else {
          skipped += 1; // needs review / blocked — never auto-flatten
        }
      } catch {
        errors += 1;
      }
    }
    return { queued, skipped, errors };
  }

  /** Disable the extra rows of every open duplicate group (keeps one). */
  async batchDisableDuplicates(siteId: string): Promise<{ queued: number; skipped: number }> {
    const issues = await this.issueRepo.find({ where: { siteId, status: 'open', issueType: 'duplicate' } });
    return this.disableEach(siteId, issues.flatMap((i) => (i.proposedFix?.disableIds as string[]) ?? []));
  }

  /** Disable every open dead-redirect (0 hits). Reversible. */
  async batchDisableDead(siteId: string): Promise<{ queued: number; skipped: number }> {
    const issues = await this.issueRepo.find({ where: { siteId, status: 'open', issueType: 'dead_redirect' } });
    return this.disableEach(siteId, issues.map((i) => i.primaryRedirectId).filter((x): x is string => !!x));
  }

  private async disableEach(siteId: string, ids: string[]): Promise<{ queued: number; skipped: number }> {
    let queued = 0, skipped = 0;
    for (const id of [...new Set(ids)]) {
      try {
        await this.write.proposeToggle(siteId, id, false);
        queued += 1;
      } catch {
        skipped += 1; // already pending / not found — leave it
      }
    }
    return { queued, skipped };
  }

  // ── Enrichment loaders (best-effort JOINs, keyed by normalized URL) ─────────

  private async loadGsc(siteId: string): Promise<Map<string, { clicks: number; impressions: number }>> {
    const since = this.daysAgo(WINDOW_DAYS);
    const rows = await this.gscRepo
      .createQueryBuilder('g')
      .select('g."pageUrl"', 'url')
      .addSelect('SUM(g.clicks)', 'clicks')
      .addSelect('SUM(g.impressions)', 'impressions')
      .where('g."siteId" = :siteId AND g.scope = :scope AND g.date >= :since', { siteId, scope: 'page', since })
      .groupBy('g."pageUrl"')
      .getRawMany<{ url: string; clicks: string; impressions: string }>();
    const map = new Map<string, { clicks: number; impressions: number }>();
    for (const r of rows) if (r.url) map.set(this.urlKey(r.url), { clicks: Number(r.clicks), impressions: Number(r.impressions) });
    return map;
  }

  private async loadInventory(siteId: string): Promise<Map<string, { isTransactional: boolean }>> {
    const rows = await this.pageRepo.find({ where: { siteId }, select: ['url', 'isTransactional'] });
    const map = new Map<string, { isTransactional: boolean }>();
    for (const r of rows) if (r.url) map.set(this.urlKey(r.url), { isTransactional: !!r.isTransactional });
    return map;
  }

  private async loadCrawl(siteId: string): Promise<Map<string, { isIndexed: boolean | null; derivedStatus: string | null }>> {
    const rows = await this.crawlRepo.find({ where: { siteId }, select: ['url', 'isIndexed', 'derivedStatus'] });
    const map = new Map<string, { isIndexed: boolean | null; derivedStatus: string | null }>();
    for (const r of rows) if (r.url) map.set(this.urlKey(r.url), { isIndexed: r.isIndexed, derivedStatus: r.derivedStatus });
    return map;
  }

  private async attachGa4Context(run: RedirectAuditRun, siteId: string): Promise<void> {
    try {
      const status = await this.ga4.getSiteStatus(siteId);
      run.ga4Connected = !!status?.connected;
      if (status?.connected) {
        const to = this.daysAgo(0);
        const from = this.daysAgo(WINDOW_DAYS);
        const summary = await this.ga4.getSummary(siteId, from, to);
        run.ga4OrganicRevenue = summary?.revenue ?? null;
      }
    } catch (err) {
      // Best-effort — never blocks the audit.
      this.logger.debug(`GA4 context unavailable for ${siteId}: ${(err as Error).message}`);
    }
  }

  // ── helpers ─────────────────────────────────────────────────────────────

  private async requireIssue(siteId: string, id: string): Promise<RedirectIssue> {
    const issue = await this.issueRepo.findOne({ where: { id, siteId } });
    if (!issue) throw new NotFoundException('Issue not found');
    return issue;
  }

  private fingerprint(c: Candidate): string {
    return issueFingerprint(c.issueType, c.fingerprintSeed);
  }

  private seedFromIds(ids: string[], byId: Map<string, RedirectItem>): string {
    return seedFromFingerprints(ids.map((id) => byId.get(id)?.fingerprint ?? id));
  }

  private absolute(siteBase: string, path: string): string {
    const s = (path ?? '').trim();
    if (/^https?:\/\//i.test(s)) return s;
    return `${siteBase.replace(/\/+$/, '')}${s.startsWith('/') ? '' : '/'}${s}`;
  }

  private urlKey(u: string): string {
    return u.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '').toLowerCase();
  }

  private hostOf(url: string): string | null {
    try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
  }

  private daysAgo(n: number): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  }
}
