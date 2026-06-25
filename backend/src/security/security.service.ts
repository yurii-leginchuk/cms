import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { SecurityIncident } from './entities/security-incident.entity';
import { SecurityScanFinding } from './entities/security-scan-finding.entity';
import { SecurityScanSnapshot } from './entities/security-scan-snapshot.entity';
import { IncidentStatus } from './security.types';

/** Read facade for the controller — assembles incident lists, the side-by-side
 *  diff detail, and the evidence pack. */
@Injectable()
export class SecurityService {
  constructor(
    @InjectRepository(SecurityIncident) private readonly incidentRepo: Repository<SecurityIncident>,
    @InjectRepository(SecurityScanFinding) private readonly findingRepo: Repository<SecurityScanFinding>,
    @InjectRepository(SecurityScanSnapshot) private readonly snapshotRepo: Repository<SecurityScanSnapshot>,
  ) {}

  async listIncidents(siteId: string, status?: IncidentStatus) {
    const incidents = await this.incidentRepo.find({
      where: status ? { siteId, status } : { siteId },
      order: { updatedAt: 'DESC' },
    });
    return incidents;
  }

  async getIncidentDetail(id: string) {
    const incident = await this.incidentRepo.findOne({ where: { id } });
    if (!incident) throw new NotFoundException('Incident not found');

    const finding = await this.findingRepo.findOne({ where: { id: incident.latestFindingId } });
    const [snapshotA, snapshotB] = await Promise.all([
      finding?.snapshotAId ? this.snapshotRepo.findOne({ where: { id: finding.snapshotAId } }) : null,
      finding?.snapshotBId ? this.snapshotRepo.findOne({ where: { id: finding.snapshotBId } }) : null,
    ]);

    const affectedPages = await this.findingRepo
      .createQueryBuilder('f')
      .select('DISTINCT f.pageUrl', 'pageUrl')
      .where('f.incidentKey = :key', { key: incident.incidentKey })
      .getRawMany<{ pageUrl: string }>();

    return {
      incident,
      finding,
      snapshotA: snapshotA
        ? { axis: snapshotA.axis, content: snapshotA.normalizedContent, scriptOrigins: snapshotA.externalScriptOrigins, linkDomains: snapshotA.externalLinkDomains }
        : null,
      snapshotB: snapshotB
        ? { axis: snapshotB.axis, content: snapshotB.normalizedContent, scriptOrigins: snapshotB.externalScriptOrigins, linkDomains: snapshotB.externalLinkDomains }
        : null,
      affectedPages: affectedPages.map((p) => p.pageUrl),
    };
  }

  /** Flat evidence rows for the incident (for CSV export on the frontend). */
  async getEvidence(id: string) {
    const incident = await this.incidentRepo.findOne({ where: { id } });
    if (!incident) throw new NotFoundException('Incident not found');

    const findings = await this.findingRepo.find({
      where: { incidentKey: incident.incidentKey },
      order: { createdAt: 'DESC' },
    });

    const rows = findings.flatMap((f) =>
      f.signals.map((s) => ({
        pageUrl: f.pageUrl,
        severity: f.severity,
        score: f.score,
        detector: s.detector,
        code: s.code,
        malicious: s.malicious,
        message: s.message,
        evidence: JSON.stringify(s.evidence),
        axisAStatus: f.axisAStatus,
        axisBStatus: f.axisBStatus,
        detectedAt: f.createdAt.toISOString(),
      })),
    );

    return { incident, rows };
  }
}
