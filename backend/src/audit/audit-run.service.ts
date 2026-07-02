import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { Site, SiteStatus } from '../sites/site.entity';
import { AuditRun, AuditRunTrigger, DetectorCoverage } from './audit-run.entity';
import { AuditFinding, AuditSeverity } from './audit-finding.entity';
import { AuditObservation } from './audit-observation.entity';
import { AuditSiteSettings } from './audit-site-settings.entity';
import { AuditSourceService } from './audit-source.service';
import { AuditFetchService, FetchBudget } from './audit-fetch.service';
import {
  AUDIT_DETECTOR_VERSIONS,
  DetectorResult,
  PageSignal,
  RawFinding,
  SEVERITY_RANK,
  detectCanonicalHijack,
  detectHttpsRegression,
  detectMoneyPageRegression,
  detectNoindexRegression,
  detectRobotsTxtRegression,
  detectSitemapBroken,
  detectSoft404Suspect,
  isMoneyPage,
} from './audit-detectors';
import {
  FINGERPRINT_VERSION,
  findingFingerprint,
  scopeSignature,
  snapshotFingerprint,
} from './audit-fingerprint';
import { DetectorPass, diffFindings } from './audit-diff';

/** Manual [Run now] cooldown — locked decision D7 (1/hour per site). */
const MANUAL_COOLDOWN_MS = 60 * 60 * 1000;
/** A `running` run older than this is a crashed process, not a live run. */
const STALE_RUNNING_MS = 2 * 60 * 60 * 1000;

const SELECTION_RULE = 'full_inventory_v1'; // locked D2/D3: full `pages` scope

@Injectable()
export class AuditRunService {
  private readonly logger = new Logger(AuditRunService.name);
  /** In-process re-entry guard (the manual endpoint is fire-and-forget). */
  private readonly inFlight = new Set<string>();

  constructor(
    @InjectRepository(Site) private readonly siteRepo: Repository<Site>,
    @InjectRepository(AuditRun) private readonly runRepo: Repository<AuditRun>,
    @InjectRepository(AuditFinding) private readonly findingRepo: Repository<AuditFinding>,
    @InjectRepository(AuditObservation) private readonly obsRepo: Repository<AuditObservation>,
    @InjectRepository(AuditSiteSettings) private readonly settingsRepo: Repository<AuditSiteSettings>,
    private readonly source: AuditSourceService,
    private readonly fetch: AuditFetchService,
  ) {}

  /**
   * Monday 05:00 America/New_York (locked decision D1) — "the night from
   * Sunday to Monday", AFTER the whole nightly chain (1:00 crawl, 2:00 parse,
   * 3:00 ALT, 4:00 optimize/pagespeed/redirect-sync, server-local/UTC) has
   * finished, so the audit reads rawHtml parsed hours earlier. First cron in
   * the codebase to pin a timezone (@nestjs/schedule supports it).
   */
  @Cron('0 5 * * 1', { timeZone: 'America/New_York' })
  async handleWeeklyAudit(): Promise<void> {
    this.logger.log('Weekly technical audit triggered (Mon 05:00 ET)');
    const sites = await this.siteRepo.find();
    for (const site of sites) {
      try {
        const settings = await this.getOrCreateSettings(site.id);
        if (!settings.enabled) {
          this.logger.log(`Audit disabled for site ${site.id} — skipping`);
          continue;
        }
        await this.runForSite(site.id, 'weekly');
      } catch (err) {
        this.logger.error(`Weekly audit failed for site ${site.id}: ${(err as Error).message}`);
      }
    }
  }

  /** Manual [Run now]: cooldown-guarded, fire-and-forget (UI polls summary). */
  async startManualRun(siteId: string): Promise<{ started: boolean }> {
    const settings = await this.getOrCreateSettings(siteId);
    if (!settings.enabled) {
      throw new BadRequestException('The audit is disabled for this site (Settings → Site Audit).');
    }
    if (this.inFlight.has(siteId) || (await this.hasLiveRun(siteId))) {
      throw new ConflictException('An audit is already running for this site.');
    }
    const lastManual = await this.runRepo.findOne({
      where: { siteId, trigger: 'manual' },
      order: { startedAt: 'DESC' },
    });
    if (lastManual) {
      const elapsed = Date.now() - new Date(lastManual.startedAt).getTime();
      if (elapsed < MANUAL_COOLDOWN_MS) {
        const minutes = Math.ceil((MANUAL_COOLDOWN_MS - elapsed) / 60000);
        throw new BadRequestException(
          `Run-now is limited to once per hour — try again in ${minutes} min.`,
        );
      }
    }
    this.runForSite(siteId, 'manual').catch((err) =>
      this.logger.error(`Manual audit failed for site ${siteId}: ${(err as Error).message}`),
    );
    return { started: true };
  }

  /** The full pipeline: sources → bounded fetches → detectors → upsert → diff. */
  async runForSite(siteId: string, trigger: AuditRunTrigger): Promise<AuditRun> {
    const site = await this.siteRepo.findOne({ where: { id: siteId } });
    if (!site) throw new BadRequestException('Site not found');
    if (this.inFlight.has(siteId)) throw new ConflictException('Audit already running');
    this.inFlight.add(siteId);

    const settings = await this.getOrCreateSettings(siteId);
    const run = await this.runRepo.save(this.runRepo.create({
      siteId,
      trigger,
      status: 'running',
      detectorVersions: { ...AUDIT_DETECTOR_VERSIONS },
      liveFetchBudget: settings.liveFetchBudget,
    }));

    try {
      const now = new Date();
      const budget = new FetchBudget(settings.liveFetchBudget);
      const errorBreakdown: Record<string, number> = {};

      // ── 1. Sources (readers) ──────────────────────────────────────────────
      const pages = await this.source.loadPageSignals(siteId);
      const gscWindow = this.source.gscWindow();
      const parseInFlight = site.status === SiteStatus.PARSING;
      if (parseInFlight) errorBreakdown.parse_in_flight = 1;

      // Previously-active findings (open/muted/accepted) — diff baseline +
      // re-verification suspects.
      const active = await this.findingRepo.find({
        where: { siteId, status: In(['open', 'muted', 'accepted']) },
      });

      // ── 2. Bounded live fetches ───────────────────────────────────────────
      const robots = await this.fetch.fetchRobots(site.url, budget);
      const previousRobotsContent = await this.latestSnapshotContent(siteId, 'robots_txt_regression');
      const sitemap = await this.fetch.fetchSitemap(site.sitemapUrl, budget);
      const httpsSig = await this.fetch.fetchHttpsSignal(site.url, budget);
      const probe404 = await this.fetch.probe404(site.url, budget);

      // Suspect probes, priority order: re-verify open page findings first
      // (the trust loop), then stored-parse noindex suspects, then money pages
      // (tombstoned / crawl-dead / by clicks). Budget-bounded.
      const bySubject = new Map(pages.map((p) => [p.subjectKey, p]));
      const probeOrder = this.buildProbeList(pages, active);
      for (const subjectKey of probeOrder) {
        const page = bySubject.get(subjectKey);
        if (!page) continue;
        const live = await this.fetch.probeUrl(page.url, budget);
        if (!live) break; // budget exhausted
        page.live = live;
        if (!live.ok) {
          errorBreakdown[live.timedOut ? 'probe_timeout' : 'probe_error'] =
            (errorBreakdown[live.timedOut ? 'probe_timeout' : 'probe_error'] ?? 0) + 1;
        }
      }

      // ── 3. Detectors (pure) ───────────────────────────────────────────────
      const openRobotsRules = active
        .filter((f) => f.checkType === 'robots_txt_regression')
        .map((f) => (f.evidence as { rule?: string } | null)?.rule)
        .filter((r): r is string => typeof r === 'string');

      const results: DetectorResult[] = [
        detectNoindexRegression(pages, gscWindow),
        detectRobotsTxtRegression({
          current: robots,
          previousContent: previousRobotsContent,
          openRules: openRobotsRules,
          pages,
          siteUrl: site.url,
        }),
        detectSitemapBroken({ sitemap, siteUrl: site.url }),
        detectMoneyPageRegression(pages, gscWindow),
        detectSoft404Suspect(pages, probe404, gscWindow),
        detectHttpsRegression({ https: httpsSig, pages, siteUrl: site.url }),
        detectCanonicalHijack(pages, site.url, gscWindow),
      ];

      // Parse still in flight ⇒ stored heads may be mid-rewrite: page-scoped
      // detectors are demoted to scopeComplete=false (findings still shown,
      // resolves withheld) — the run reports `partial`, never a silent lie.
      if (parseInFlight) {
        for (const r of results) {
          if (['noindex_regression', 'canonical_hijack', 'soft_404_suspect', 'money_page_regression'].includes(r.checkType)) {
            r.coverage.scopeComplete = false;
          }
        }
      }

      // ── 4. Fingerprint + upsert + observations ────────────────────────────
      const detected = new Map<string, RawFinding & { fingerprint: string }>();
      for (const r of results) {
        for (const f of r.findings) {
          const fingerprint = findingFingerprint(f.checkType, f.subjectKey, f.discriminator);
          if (!detected.has(fingerprint)) detected.set(fingerprint, { ...f, fingerprint });
        }
      }

      const activeByFp = new Map(active.map((f) => [f.fingerprint, f]));
      const versionOf = (checkType: string) =>
        AUDIT_DETECTOR_VERSIONS[checkType as keyof typeof AUDIT_DETECTOR_VERSIONS] ?? 0;

      let newCount = 0;
      for (const f of detected.values()) {
        const fixRoute = f.fixRoute ? f.fixRoute.replace('{siteId}', siteId) : null;
        const existing = activeByFp.get(f.fingerprint)
          ?? (await this.findingRepo.findOne({ where: { siteId, fingerprint: f.fingerprint } }));
        if (existing) {
          if (existing.status === 'resolved') {
            existing.status = 'open';
            existing.regressionCount += 1;
            newCount += 1; // it regressed back — that IS news
          } else if (existing.status === 'muted' || existing.status === 'accepted') {
            // Auto-resurface on material worsening (locked D5): severity rose,
            // or the affected set grew >50% versus the snapshot at mute time.
            const snap = existing.muteSnapshot;
            const worsened =
              (snap && SEVERITY_RANK[f.severity] > SEVERITY_RANK[snap.severity]) ||
              (snap && snap.affectedCount > 0 && f.affectedUrls.length > snap.affectedCount * 1.5);
            if (worsened) {
              existing.status = 'open';
              existing.muteReason = null;
              existing.mutedAt = null;
              existing.mutedBy = null;
              existing.muteSnapshot = null;
            }
          }
          existing.severity = f.severity;
          existing.title = f.title;
          existing.evidence = f.evidence;
          existing.affectedUrls = f.affectedUrls;
          existing.fixRoute = fixRoute;
          existing.lastObservedAt = now;
          existing.lastEvaluatedAt = now;
          existing.lastEvaluatedRunId = run.id;
          existing.resolvedAt = null;
          existing.resolutionBasis = null;
          existing.detectorVersion = versionOf(f.checkType);
          await this.findingRepo.save(existing);
        } else {
          newCount += 1;
          await this.findingRepo.save(this.findingRepo.create({
            siteId,
            fingerprint: f.fingerprint,
            checkType: f.checkType,
            severity: f.severity,
            status: 'open',
            subjectKey: f.subjectKey,
            title: f.title,
            evidence: f.evidence,
            affectedUrls: f.affectedUrls,
            firstSeenAt: now,
            lastObservedAt: now,
            lastEvaluatedAt: now,
            lastEvaluatedRunId: run.id,
            detectorVersion: versionOf(f.checkType),
            fixRoute,
          }));
        }
        await this.obsRepo.save(this.obsRepo.create({
          siteId,
          runId: run.id,
          fingerprint: f.fingerprint,
          checkType: f.checkType,
          observedStatus: 'present',
          rawSignal: f.rawSignal,
          detectorVersion: versionOf(f.checkType),
          observedAt: now,
        }));
      }

      // Site-scope snapshots — next run's diff baseline, appended EVERY run.
      await this.appendSnapshot(siteId, run.id, 'robots_txt_regression', {
        status: robots.status, content: robots.content, error: robots.error,
      });
      await this.appendSnapshot(siteId, run.id, 'sitemap_broken', {
        status: sitemap.status, urlCount: sitemap.urlCount,
        parseError: sitemap.parseError, hosts: sitemap.hosts, error: sitemap.error,
      });
      await this.appendSnapshot(siteId, run.id, 'https_regression', {
        https: httpsSig.https, cert: httpsSig.cert, http: httpsSig.http,
      });

      // ── 5. Diff (pure) + gated resolution ─────────────────────────────────
      const passes: Record<string, DetectorPass> = {};
      for (const r of results) {
        passes[r.checkType] = {
          scopeComplete: r.coverage.scopeComplete,
          evaluatedSubjects: new Set(r.evaluatedSubjects),
        };
      }
      const diff = diffFindings(
        active.map((f) => ({
          fingerprint: f.fingerprint,
          checkType: f.checkType,
          subjectKey: f.subjectKey,
          status: f.status as 'open' | 'muted' | 'accepted',
        })),
        [...detected.values()].map((f) => ({
          fingerprint: f.fingerprint, checkType: f.checkType, subjectKey: f.subjectKey,
        })),
        passes,
      );

      let resolvedCount = 0;
      for (const fp of diff.resolved) {
        const row = activeByFp.get(fp);
        if (!row) continue;
        const wasVisible = row.status === 'open' || row.status === 'accepted';
        row.status = 'resolved';
        row.resolvedAt = now;
        row.resolutionBasis = 'verified_absent';
        row.lastEvaluatedAt = now;
        row.lastEvaluatedRunId = run.id;
        await this.findingRepo.save(row);
        await this.obsRepo.save(this.obsRepo.create({
          siteId,
          runId: run.id,
          fingerprint: fp,
          checkType: row.checkType,
          observedStatus: 'absent',
          rawSignal: { verifiedAbsentIn: run.id },
          detectorVersion: versionOf(row.checkType),
          observedAt: now,
        }));
        if (wasVisible) resolvedCount += 1;
      }

      // ── 6. Run summary + coverage ledger ──────────────────────────────────
      const coverage: Record<string, DetectorCoverage> = {};
      for (const r of results) coverage[r.checkType] = r.coverage;

      const visible = (fp: string) => {
        const row = activeByFp.get(fp);
        return !row || row.status === 'open'; // hide muted/accepted from counts
      };
      const bySeverity: Record<AuditSeverity, number> = { critical: 0, warning: 0, notice: 0 };
      for (const f of detected.values()) {
        if (visible(f.fingerprint)) bySeverity[f.severity] += 1;
      }

      const inventoryPages = pages.filter((p) => p.missingFromSitemapAt == null);
      run.coverage = coverage;
      run.scopeSignature = scopeSignature({
        selectionRule: SELECTION_RULE,
        pagesTotal: inventoryPages.length,
        moneyPages: pages.filter((p) => isMoneyPage(p)).length,
        fingerprintVersion: FINGERPRINT_VERSION,
      });
      run.liveFetchesUsed = budget.used;
      run.summary = {
        newCount,
        resolvedCount,
        persistingCount: diff.persisting.filter(visible).length,
        unconfirmedCount: diff.unconfirmed.filter(visible).length,
        bySeverity,
        pagesTotal: inventoryPages.length,
        pagesEvaluated: inventoryPages.filter((p) => p.head != null).length,
      };
      run.errorBreakdown = Object.keys(errorBreakdown).length ? errorBreakdown : null;
      run.status = results.every((r) => r.coverage.scopeComplete) ? 'complete' : 'partial';
      run.finishedAt = new Date();
      return await this.runRepo.save(run);
    } catch (err) {
      run.status = 'failed';
      run.fatalError = (err as Error).message;
      run.finishedAt = new Date();
      return await this.runRepo.save(run);
    } finally {
      this.inFlight.delete(siteId);
    }
  }

  // ── helpers ─────────────────────────────────────────────────────────────

  /**
   * Probe priority (subjectKeys): open page-scope findings (re-verification —
   * what makes "resolved" believable) → stored-parse noindex suspects → money
   * pages: tombstoned first, then crawl-dead, then by clicks desc.
   */
  private buildProbeList(pages: PageSignal[], active: AuditFinding[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    const push = (key: string) => {
      if (!seen.has(key)) {
        seen.add(key);
        out.push(key);
      }
    };

    const pageScoped = new Set(['noindex_regression', 'money_page_regression', 'soft_404_suspect', 'canonical_hijack']);
    for (const f of active) {
      if (pageScoped.has(f.checkType)) push(f.subjectKey);
    }
    for (const p of pages) {
      if (p.missingFromSitemapAt == null && p.head?.robotsNoindex && p.intentDirective !== 'noindex') {
        push(p.subjectKey);
      }
    }
    const money = pages.filter((p) => isMoneyPage(p));
    for (const p of money) if (p.missingFromSitemapAt != null) push(p.subjectKey);
    for (const p of money) {
      if (['not_found', 'server_error', 'soft_404'].includes(p.crawl?.derivedStatus ?? '')) {
        push(p.subjectKey);
      }
    }
    for (const p of [...money].sort((a, b) => (b.gscClicks ?? 0) - (a.gscClicks ?? 0))) {
      push(p.subjectKey);
    }
    return out;
  }

  /**
   * Most recent robots snapshot that actually HAS a body — an error/outage run
   * (content null) must not wipe the diff baseline, or every Disallow added
   * during the outage would slip past the next successful run unnoticed.
   */
  private async latestSnapshotContent(siteId: string, checkType: 'robots_txt_regression'): Promise<string | null> {
    const fp = snapshotFingerprint(checkType);
    const rows = await this.obsRepo.find({
      where: { siteId, fingerprint: fp },
      order: { observedAt: 'DESC' },
      take: 10,
    });
    for (const row of rows) {
      const content = (row.rawSignal as { content?: unknown } | null)?.content;
      if (typeof content === 'string') return content;
    }
    return null;
  }

  private async appendSnapshot(
    siteId: string,
    runId: string,
    checkType: 'robots_txt_regression' | 'sitemap_broken' | 'https_regression',
    rawSignal: Record<string, unknown>,
  ): Promise<void> {
    await this.obsRepo.save(this.obsRepo.create({
      siteId,
      runId,
      fingerprint: snapshotFingerprint(checkType),
      checkType,
      observedStatus: 'absent', // a snapshot is a baseline, not a finding
      rawSignal,
      detectorVersion: AUDIT_DETECTOR_VERSIONS[checkType],
      observedAt: new Date(),
    }));
  }

  private async hasLiveRun(siteId: string): Promise<boolean> {
    const running = await this.runRepo.find({
      where: { siteId, status: 'running', finishedAt: IsNull() },
      order: { startedAt: 'DESC' },
    });
    let live = false;
    for (const r of running) {
      const age = Date.now() - new Date(r.startedAt).getTime();
      if (age > STALE_RUNNING_MS) {
        // Crashed process left a zombie — mark failed so the UI unfreezes.
        r.status = 'failed';
        r.fatalError = 'abandoned (process restart)';
        r.finishedAt = new Date();
        await this.runRepo.save(r);
      } else {
        live = true;
      }
    }
    return live;
  }

  async getOrCreateSettings(siteId: string): Promise<AuditSiteSettings> {
    const existing = await this.settingsRepo.findOne({ where: { siteId } });
    if (existing) return existing;
    return this.settingsRepo.save(this.settingsRepo.create({ siteId }));
  }
}
