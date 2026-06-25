import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bullmq';
import { createHash } from 'crypto';

import { SecurityScanRun } from './entities/security-scan-run.entity';
import { SecurityScanFinding } from './entities/security-scan-finding.entity';
import { SecurityScanSnapshot } from './entities/security-scan-snapshot.entity';
import { IncidentService } from './incident.service';
import { fetchAxis, AxisFetchResult } from './security-fetch';
import { normalize, NormalizedPage, NORMALIZATION_VERSION } from './normalize';
import { detectRedirectCloak } from './detectors/redirect-cloak';
import { detectSpamLexicon, LEXICON_VERSION } from './detectors/spam-lexicon';
import { detectInjectedScripts } from './detectors/injected-scripts';
import { detectContentDiff, buildExcerpt } from './detectors/content-diff';
import { scoreFindings, RUBRIC_VERSION } from './severity-rubric';
import {
  DetectorSignal,
  IncidentScope,
  SecurityAxis,
  SecurityDetector,
} from './security.types';

export const SECURITY_QUEUE = 'security';

export interface SecurityScanJobData {
  runId: string;
  siteId: string;
  pageId: string;
  url: string;
}

/** Site-scoped signal codes group across pages; everything else is page-scoped. */
const SITE_SCOPED_CODES = new Set([
  'bot_only_external_redirect',
  'cloaked_spam_domain',
  'cloaked_script',
  'new_external_script',
]);

// Concurrency 1 + per-job delay = gentle on the target site (no analytics hit:
// raw fetch executes no JS, so GA4/Zaraz/GMB beacons never fire).
@Processor(SECURITY_QUEUE, { concurrency: 1 })
export class SecurityProcessor extends WorkerHost {
  private readonly logger = new Logger(SecurityProcessor.name);

  constructor(
    @InjectRepository(SecurityScanRun) private readonly runRepo: Repository<SecurityScanRun>,
    @InjectRepository(SecurityScanFinding) private readonly findingRepo: Repository<SecurityScanFinding>,
    @InjectRepository(SecurityScanSnapshot) private readonly snapshotRepo: Repository<SecurityScanSnapshot>,
    private readonly incidents: IncidentService,
  ) {
    super();
  }

  async process(job: Job<SecurityScanJobData>): Promise<void> {
    const { runId, siteId, pageId, url } = job.data;

    const [axisA, axisB] = await Promise.all([
      fetchAxis(url, 'googlebot'),
      fetchAxis(url, 'chrome'),
    ]);

    const normA = axisA.html ? normalize(axisA.html, url) : null;
    const normB = axisB.html ? normalize(axisB.html, url) : null;

    const signals: DetectorSignal[] = [];

    // Redirect cloak works from chains alone (no body needed).
    signals.push(
      ...detectRedirectCloak(
        { requestedUrl: url, finalUrl: axisA.finalUrl, redirectChain: axisA.redirectChain },
        { requestedUrl: url, finalUrl: axisB.finalUrl, redirectChain: axisB.redirectChain },
      ),
    );

    // Content-comparison detectors need both views.
    if (normA && normB) {
      signals.push(
        ...detectSpamLexicon({
          botText: normA.mainText,
          userText: normB.mainText,
          botLinkDomains: normA.externalLinkDomains,
          userLinkDomains: normB.externalLinkDomains,
        }),
      );
      const baseline = await this.baselineScriptOrigins(pageId);
      signals.push(
        ...detectInjectedScripts({
          botScriptOrigins: normA.externalScriptOrigins,
          userScriptOrigins: normB.externalScriptOrigins,
          baselineScriptOrigins: baseline,
        }),
      );
      signals.push(
        ...detectContentDiff({
          botHash: normA.contentHash,
          userHash: normB.contentHash,
          botText: normA.mainText,
          userText: normB.mainText,
        }),
      );
    }

    const bothUnreachable = axisA.status !== 'reachable' && axisB.status !== 'reachable';
    if (bothUnreachable) {
      // A page the crawler cannot reach is itself a signal, not "clean".
      signals.push({
        detector: 'unreachable',
        code: 'page_unreachable',
        malicious: false,
        weight: 8,
        message: `Page unreachable from scanner (A: ${axisA.error ?? axisA.httpStatus ?? 'n/a'}, B: ${axisB.error ?? axisB.httpStatus ?? 'n/a'})`,
        evidence: { axisA: axisA.error ?? axisA.httpStatus, axisB: axisB.error ?? axisB.httpStatus },
      });
      await this.runRepo.increment({ id: runId }, 'pagesUnreachable', 1);
    }

    await this.runRepo.increment({ id: runId }, 'pagesScanned', 1);

    if (signals.length === 0) return; // clean page — no finding

    const snapshotAId = normA ? await this.persistSnapshot(siteId, pageId, 'googlebot', normA, axisA) : null;
    const snapshotBId = normB ? await this.persistSnapshot(siteId, pageId, 'chrome', normB, axisB) : null;

    const { score, severity } = scoreFindings(signals);
    const ref = this.deriveIncidentRef(siteId, pageId, signals);
    const excerpt = normA && normB ? buildExcerpt(normA.mainText, normB.mainText) || null : null;

    const finding = await this.findingRepo.save(
      this.findingRepo.create({
        runId,
        siteId,
        pageId,
        pageUrl: url,
        dominantDetector: ref.dominantDetector,
        signals,
        score,
        severity,
        axisAStatus: axisA.status,
        axisBStatus: axisB.status,
        axisAHttpStatus: axisA.httpStatus,
        axisBHttpStatus: axisB.httpStatus,
        redirectChainA: axisA.redirectChain,
        redirectChainB: axisB.redirectChain,
        snapshotAId,
        snapshotBId,
        excerpt,
        incidentKey: ref.incidentKey,
        scope: ref.scope,
        signature: ref.signature,
        rubricVersion: RUBRIC_VERSION,
        normalizationVersion: NORMALIZATION_VERSION,
        lexiconVersion: LEXICON_VERSION,
      }),
    );

    await this.runRepo.increment({ id: runId }, 'findingsCount', 1);
    await this.incidents.foldFinding(finding);

    this.logger.debug(`Finding ${severity} (${score}) for ${url} [${ref.dominantDetector}]`);
  }

  private async baselineScriptOrigins(pageId: string): Promise<string[] | null> {
    const prev = await this.snapshotRepo.findOne({
      where: { pageId, axis: 'chrome' },
      order: { createdAt: 'DESC' },
    });
    return prev ? prev.externalScriptOrigins : null;
  }

  private async persistSnapshot(
    siteId: string,
    pageId: string,
    axis: SecurityAxis,
    norm: NormalizedPage,
    fetched: AxisFetchResult,
  ): Promise<string> {
    const existing = await this.snapshotRepo.findOne({
      where: { pageId, axis, contentHash: norm.contentHash },
    });
    if (existing) return existing.id;

    const saved = await this.snapshotRepo.save(
      this.snapshotRepo.create({
        siteId,
        pageId,
        axis,
        contentHash: norm.contentHash,
        normalizedContent: norm.mainText,
        externalScriptOrigins: norm.externalScriptOrigins,
        externalLinkDomains: norm.externalLinkDomains,
        rawByteLength: fetched.html ? Buffer.byteLength(fetched.html) : 0,
        normalizationVersion: NORMALIZATION_VERSION,
      }),
    );
    return saved.id;
  }

  /** Deterministic incident grouping from the dominant signal. */
  private deriveIncidentRef(
    siteId: string,
    pageId: string,
    signals: DetectorSignal[],
  ): { dominantDetector: SecurityDetector; scope: IncidentScope; signature: string; incidentKey: string } {
    const ranked = [...signals].sort(
      (a, b) => Number(b.malicious) - Number(a.malicious) || b.weight - a.weight,
    );
    const dominant = ranked[0];
    const siteScoped = SITE_SCOPED_CODES.has(dominant.code);

    let signature: string;
    if (!siteScoped) {
      signature = pageId;
    } else {
      const ev = dominant.evidence;
      signature =
        (ev.target as string) ||
        (Array.isArray(ev.domains) ? (ev.domains[0] as string) : undefined) ||
        (Array.isArray(ev.origins) ? (ev.origins[0] as string) : undefined) ||
        pageId;
    }

    const scope: IncidentScope = siteScoped ? 'site' : 'page';
    const keySource = siteScoped
      ? `${siteId}:site:${dominant.detector}:${signature}`
      : `${siteId}:page:${pageId}:${dominant.detector}`;
    const incidentKey = createHash('sha256').update(keySource).digest('hex').slice(0, 64);

    return { dominantDetector: dominant.detector, scope, signature, incidentKey };
  }
}
