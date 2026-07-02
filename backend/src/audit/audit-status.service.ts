import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, IsNull, Repository } from 'typeorm';
import { AuditRun } from './audit-run.entity';
import { AuditFinding, AuditSeverity } from './audit-finding.entity';
import { AuditObservation } from './audit-observation.entity';
import { AuditSiteSettings } from './audit-site-settings.entity';
import { AUDIT_DETECTOR_CATALOG, AUDIT_DETECTOR_VERSIONS } from './audit-detectors';

export type DiffState = 'new' | 'persisting' | 'unconfirmed' | 'resolved' | null;

export interface FindingListFilters {
  severity?: string;
  checkType?: string;
  status?: string;
  diff?: string;
  showMuted?: boolean;
  search?: string;
  page?: number;
  limit?: number;
}

/**
 * Read surface + human actions (mute/unmute/accept) for the audit. Every
 * response carries its own denominators/clocks — the honest-states contract:
 * a half-checked scope must never present as "0 issues".
 */
@Injectable()
export class AuditStatusService {
  constructor(
    @InjectRepository(AuditRun) private readonly runRepo: Repository<AuditRun>,
    @InjectRepository(AuditFinding) private readonly findingRepo: Repository<AuditFinding>,
    @InjectRepository(AuditObservation) private readonly obsRepo: Repository<AuditObservation>,
    @InjectRepository(AuditSiteSettings) private readonly settingsRepo: Repository<AuditSiteSettings>,
  ) {}

  async getSummary(siteId: string) {
    const [latestRun, lastFinished, settings] = await Promise.all([
      this.runRepo.findOne({ where: { siteId }, order: { startedAt: 'DESC' } }),
      this.runRepo.findOne({
        where: { siteId, finishedAt: Not(IsNull()) },
        order: { startedAt: 'DESC' },
      }),
      this.settingsRepo.findOne({ where: { siteId } }),
    ]);

    const running = latestRun?.status === 'running';
    const findings = await this.findingRepo.find({
      where: { siteId },
      select: [
        'id', 'checkType', 'severity', 'status', 'title', 'subjectKey', 'fixRoute',
        'firstSeenAt', 'lastObservedAt', 'lastEvaluatedAt', 'resolvedAt', 'affectedUrls',
      ],
    });

    const bySeverity: Record<AuditSeverity, number> = { critical: 0, warning: 0, notice: 0 };
    let open = 0;
    let muted = 0;
    let accepted = 0;
    for (const f of findings) {
      if (f.status === 'open') {
        open += 1;
        bySeverity[f.severity] += 1;
      } else if (f.status === 'muted') muted += 1;
      else if (f.status === 'accepted') accepted += 1;
    }

    const refRun = lastFinished ?? null;
    const lite = (f: AuditFinding) => ({
      id: f.id,
      checkType: f.checkType,
      severity: f.severity,
      status: f.status,
      title: f.title,
      fixRoute: f.fixRoute,
      affectedCount: f.affectedUrls?.length ?? 0,
      diffState: this.diffState(f, refRun),
    });
    const sevRank = { critical: 2, warning: 1, notice: 0 } as Record<string, number>;

    const newFindings = refRun
      ? findings
          .filter((f) => f.status === 'open' && this.diffState(f, refRun) === 'new')
          .sort((a, b) => sevRank[b.severity] - sevRank[a.severity])
          .slice(0, 8)
          .map(lite)
      : [];
    const resolvedFindings = refRun
      ? findings
          .filter((f) => f.status === 'resolved' && this.diffState(f, refRun) === 'resolved')
          .sort((a, b) => sevRank[b.severity] - sevRank[a.severity])
          .slice(0, 8)
          .map(lite)
      : [];
    const unconfirmedCount = refRun
      ? findings.filter((f) => f.status === 'open' && this.diffState(f, refRun) === 'unconfirmed').length
      : 0;

    return {
      hasRun: latestRun != null,
      running,
      enabled: settings?.enabled ?? true,
      liveFetchBudget: settings?.liveFetchBudget ?? 50,
      detectorCatalog: Object.entries(AUDIT_DETECTOR_CATALOG).map(([checkType, meta]) => ({
        checkType,
        ...meta,
        version: AUDIT_DETECTOR_VERSIONS[checkType as keyof typeof AUDIT_DETECTOR_VERSIONS],
      })),
      lastRun: refRun
        ? {
            id: refRun.id,
            trigger: refRun.trigger,
            status: refRun.status,
            startedAt: refRun.startedAt,
            finishedAt: refRun.finishedAt,
            coverage: refRun.coverage,
            detectorVersions: refRun.detectorVersions,
            liveFetchesUsed: refRun.liveFetchesUsed,
            liveFetchBudget: refRun.liveFetchBudget,
            summary: refRun.summary,
            errorBreakdown: refRun.errorBreakdown,
            fatalError: refRun.fatalError,
          }
        : null,
      counts: { open, muted, accepted, bySeverity },
      digest: refRun
        ? {
            runId: refRun.id,
            newCount: refRun.summary?.newCount ?? newFindings.length,
            resolvedCount: refRun.summary?.resolvedCount ?? resolvedFindings.length,
            persistingCount: refRun.summary?.persistingCount ?? 0,
            unconfirmedCount,
            newFindings,
            resolvedFindings,
          }
        : null,
      /** The cron is pinned: Monday 05:00 America/New_York (locked D1). */
      nextRunLabel: 'Mon 5:00 AM ET',
    };
  }

  async listFindings(siteId: string, f: FindingListFilters) {
    const page = Math.max(1, f.page ?? 1);
    const limit = Math.min(200, Math.max(1, f.limit ?? 50));

    const statuses = f.status
      ? [f.status]
      : f.showMuted
        ? ['open', 'accepted', 'muted']
        : ['open', 'accepted'];

    const qb = this.findingRepo
      .createQueryBuilder('af')
      .where('af."siteId" = :siteId', { siteId })
      .andWhere('af.status IN (:...statuses)', { statuses });
    if (f.severity) qb.andWhere('af.severity = :severity', { severity: f.severity });
    if (f.checkType) qb.andWhere('af."checkType" = :checkType', { checkType: f.checkType });
    if (f.search) {
      qb.andWhere('(af.title ILIKE :q OR af."subjectKey" ILIKE :q)', { q: `%${f.search}%` });
    }
    qb.orderBy(
      `CASE af.severity WHEN 'critical' THEN 2 WHEN 'warning' THEN 1 ELSE 0 END`,
      'DESC',
    )
      .addOrderBy('af."firstSeenAt"', 'DESC');

    const rows = await qb.getMany();
    const refRun = await this.runRepo.findOne({
      where: { siteId, finishedAt: Not(IsNull()) },
      order: { startedAt: 'DESC' },
    });

    let mapped = rows.map((r) => this.toRow(r, refRun));
    if (f.diff) mapped = mapped.filter((r) => r.diffState === f.diff);

    const total = mapped.length;
    const start = (page - 1) * limit;
    return {
      data: mapped.slice(start, start + limit),
      meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  async getFinding(siteId: string, id: string) {
    const finding = await this.requireFinding(siteId, id);
    const refRun = await this.runRepo.findOne({
      where: { siteId, finishedAt: Not(IsNull()) },
      order: { startedAt: 'DESC' },
    });
    const observations = await this.obsRepo.find({
      where: { siteId, fingerprint: finding.fingerprint },
      order: { observedAt: 'DESC' },
      take: 20,
    });
    return {
      ...this.toRow(finding, refRun),
      evidence: finding.evidence,
      affectedUrls: finding.affectedUrls,
      muteReason: finding.muteReason,
      mutedAt: finding.mutedAt,
      regressionCount: finding.regressionCount,
      detectorVersion: finding.detectorVersion,
      resolutionBasis: finding.resolutionBasis,
      observations: observations.map((o) => ({
        id: o.id,
        runId: o.runId,
        observedStatus: o.observedStatus,
        observedAt: o.observedAt,
        detectorVersion: o.detectorVersion,
        rawSignal: o.rawSignal,
      })),
    };
  }

  async mute(siteId: string, id: string, reason: string, by: string | null) {
    if (!reason || !reason.trim()) {
      throw new BadRequestException('A mute reason is required — future-you will ask why.');
    }
    const finding = await this.requireFinding(siteId, id);
    if (finding.status === 'resolved') {
      throw new BadRequestException('A resolved finding cannot be muted.');
    }
    finding.status = 'muted';
    finding.muteReason = reason.trim();
    finding.mutedAt = new Date();
    finding.mutedBy = by;
    finding.muteSnapshot = {
      severity: finding.severity,
      affectedCount: finding.affectedUrls?.length ?? 0,
    };
    return this.findingRepo.save(finding);
  }

  async unmute(siteId: string, id: string) {
    const finding = await this.requireFinding(siteId, id);
    if (finding.status !== 'muted') throw new BadRequestException('Finding is not muted.');
    finding.status = 'open';
    finding.muteReason = null;
    finding.mutedAt = null;
    finding.mutedBy = null;
    finding.muteSnapshot = null;
    return this.findingRepo.save(finding);
  }

  /** Accept-as-intended: kept visible but no longer alarms (locked D5). */
  async accept(siteId: string, id: string, reason: string | null) {
    const finding = await this.requireFinding(siteId, id);
    if (finding.status === 'resolved') {
      throw new BadRequestException('A resolved finding cannot be accepted.');
    }
    finding.status = 'accepted';
    finding.muteReason = reason?.trim() || finding.muteReason;
    finding.mutedAt = new Date();
    finding.muteSnapshot = {
      severity: finding.severity,
      affectedCount: finding.affectedUrls?.length ?? 0,
    };
    return this.findingRepo.save(finding);
  }

  async getSettings(siteId: string) {
    const s = await this.settingsRepo.findOne({ where: { siteId } });
    return {
      enabled: s?.enabled ?? true,
      liveFetchBudget: s?.liveFetchBudget ?? 50,
      aiAnalysisEnabled: s?.aiAnalysisEnabled ?? true,
    };
  }

  async patchSettings(siteId: string, patch: { enabled?: boolean; liveFetchBudget?: number }) {
    let s = await this.settingsRepo.findOne({ where: { siteId } });
    if (!s) s = this.settingsRepo.create({ siteId });
    if (patch.enabled != null) s.enabled = patch.enabled;
    if (patch.liveFetchBudget != null) {
      s.liveFetchBudget = Math.min(500, Math.max(5, Math.floor(patch.liveFetchBudget)));
    }
    await this.settingsRepo.save(s);
    return this.getSettings(siteId);
  }

  // ── helpers ─────────────────────────────────────────────────────────────

  private toRow(f: AuditFinding, refRun: AuditRun | null) {
    return {
      id: f.id,
      checkType: f.checkType,
      checkLabel: AUDIT_DETECTOR_CATALOG[f.checkType]?.label ?? f.checkType,
      severity: f.severity,
      status: f.status,
      title: f.title,
      subjectKey: f.subjectKey,
      affectedCount: f.affectedUrls?.length ?? 0,
      firstSeenAt: f.firstSeenAt,
      lastObservedAt: f.lastObservedAt,
      lastEvaluatedAt: f.lastEvaluatedAt,
      resolvedAt: f.resolvedAt,
      fixRoute: f.fixRoute,
      muteReason: f.muteReason,
      diffState: this.diffState(f, refRun),
    };
  }

  /**
   * Diff bucket relative to the reference (latest finished) run — derived, not
   * stored: new = first seen in that run; persisting = re-confirmed in it;
   * unconfirmed = open but NOT re-evaluated by it (honesty bucket).
   */
  private diffState(f: AuditFinding, refRun: AuditRun | null): DiffState {
    if (!refRun) return null;
    const runStart = new Date(refRun.startedAt).getTime();
    if (f.status === 'resolved') {
      return f.resolvedAt && new Date(f.resolvedAt).getTime() >= runStart ? 'resolved' : null;
    }
    if (f.firstSeenAt && new Date(f.firstSeenAt).getTime() >= runStart) return 'new';
    if (f.lastEvaluatedAt && new Date(f.lastEvaluatedAt).getTime() >= runStart) return 'persisting';
    return 'unconfirmed';
  }

  private async requireFinding(siteId: string, id: string): Promise<AuditFinding> {
    const finding = await this.findingRepo.findOne({ where: { id, siteId } });
    if (!finding) throw new NotFoundException('Finding not found');
    return finding;
  }
}
