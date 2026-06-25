import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { SecurityIncident } from './entities/security-incident.entity';
import { SecurityScanFinding } from './entities/security-scan-finding.entity';
import { ACTIVE_INCIDENT_STATUSES, IncidentStatus } from './security.types';
import { maxSeverity } from './severity-rubric';

/**
 * Folds immutable findings into mutable incidents and owns the triage workflow.
 *
 * Locked rules:
 *  - A finding whose key has a suppressed (dismissed-as-false-positive) incident
 *    is silenced — no new incident.
 *  - Otherwise it updates the one ACTIVE incident for that key, or — if the only
 *    matches are resolved/dismissed — opens a brand-NEW incident (resolved
 *    incidents are never reopened automatically).
 */
@Injectable()
export class IncidentService {
  private readonly logger = new Logger(IncidentService.name);

  constructor(
    @InjectRepository(SecurityIncident)
    private readonly incidentRepo: Repository<SecurityIncident>,
    @InjectRepository(SecurityScanFinding)
    private readonly findingRepo: Repository<SecurityScanFinding>,
  ) {}

  private async distinctPageCount(incidentKey: string): Promise<number> {
    const { count } = await this.findingRepo
      .createQueryBuilder('f')
      .select('COUNT(DISTINCT f.pageId)', 'count')
      .where('f.incidentKey = :incidentKey', { incidentKey })
      .getRawOne<{ count: string }>();
    return parseInt(count ?? '1', 10) || 1;
  }

  async foldFinding(finding: SecurityScanFinding): Promise<void> {
    const existing = await this.incidentRepo.find({
      where: { incidentKey: finding.incidentKey },
      order: { createdAt: 'DESC' },
    });

    if (existing.some((i) => i.suppressedPattern)) {
      this.logger.debug(`Suppressed pattern for key ${finding.incidentKey} — skipping`);
      return;
    }

    const active = existing.find((i) => ACTIVE_INCIDENT_STATUSES.includes(i.status));
    const now = new Date();

    if (active) {
      active.severity = maxSeverity(active.severity, finding.severity);
      active.latestFindingId = finding.id;
      active.lastSeenAt = now;
      active.affectedPageCount = await this.distinctPageCount(finding.incidentKey);
      if (active.status === 'snoozed' && active.snoozedUntil && active.snoozedUntil <= now) {
        active.status = 'open';
        active.snoozedUntil = null;
      }
      await this.incidentRepo.save(active);
      return;
    }

    // No active incident (fresh key, or prior ones resolved) → new incident.
    await this.incidentRepo.save(
      this.incidentRepo.create({
        siteId: finding.siteId,
        pageId: finding.scope === 'site' ? null : finding.pageId,
        incidentKey: finding.incidentKey,
        scope: finding.scope,
        detector: finding.dominantDetector,
        severity: finding.severity,
        status: 'open',
        title: this.titleFor(finding),
        firstFindingId: finding.id,
        latestFindingId: finding.id,
        affectedPageCount: await this.distinctPageCount(finding.incidentKey),
        lastSeenAt: now,
      }),
    );
  }

  private titleFor(f: SecurityScanFinding): string {
    const dominant = f.signals.find((s) => s.malicious) ?? f.signals[0];
    return dominant?.message ?? `Security finding on ${f.pageUrl}`;
  }

  // ── Triage actions (all reversible via reopen → supports UI Undo) ───────────

  private async setStatus(
    id: string,
    status: IncidentStatus,
    patch: Partial<SecurityIncident> = {},
  ): Promise<SecurityIncident> {
    const incident = await this.incidentRepo.findOne({ where: { id } });
    if (!incident) throw new NotFoundException('Incident not found');
    Object.assign(incident, { status, ...patch });
    return this.incidentRepo.save(incident);
  }

  confirm(id: string) {
    return this.setStatus(id, 'confirmed');
  }

  snooze(id: string, until: Date) {
    return this.setStatus(id, 'snoozed', { snoozedUntil: until });
  }

  resolve(id: string) {
    return this.setStatus(id, 'resolved', { resolvedAt: new Date() });
  }

  /** Dismiss as false positive — silences future recurrences of this key. */
  dismiss(id: string) {
    return this.setStatus(id, 'false_positive', { suppressedPattern: true });
  }

  /** Manual override (also the UI Undo target): back to open, un-suppressed. */
  reopen(id: string) {
    return this.setStatus(id, 'open', {
      suppressedPattern: false,
      resolvedAt: null,
      snoozedUntil: null,
    });
  }

  async findForSite(siteId: string, statuses?: IncidentStatus[]): Promise<SecurityIncident[]> {
    return this.incidentRepo.find({
      where: statuses ? { siteId, status: In(statuses) } : { siteId },
      order: { updatedAt: 'DESC' },
    });
  }
}
