import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import axios from 'axios';
import { Site } from '../sites/site.entity';
import { SiteImage } from '../images/site-image.entity';
import { WpMediaService } from '../images/wp-media.service';
import {
  ImageOptimization,
  ImageOptimizationState,
} from './image-optimization.entity';
import {
  ImageOptimizationRun,
  OptimizationRunScope,
  OptimizationRunStatus,
  OptimizationRunTrigger,
} from './image-optimization-run.entity';
import { SiteOptimizationConfig, R2Status } from './site-optimization-config.entity';
import { OptimizationConfigService } from './optimization-config.service';
import { ImageProcessingService, sha256 } from './image-processing.service';
import { R2Service } from './r2.service';
import { CdnPublishService } from './cdn-publish.service';
import { R2Credentials, mapS3Error } from './r2-helpers';
import {
  computeSettingsFingerprint,
  isStale,
  shouldProcess,
} from './optimization-fingerprint';

const FETCH_TIMEOUT_MS = 20_000;
const MAX_FETCH_BYTES = 26 * 1024 * 1024; // 26 MB safety bound

interface RunAccumulator {
  processed: number;
  optimized: number;
  skipped: number;
  failed: number;
  originalBytesSum: number;
  optimizedBytesSum: number;
  bytesSavedSum: number;
}

@Injectable()
export class OptimizationService {
  private readonly logger = new Logger(OptimizationService.name);
  /** In-memory cancel flags (Phase 1). Keyed by runId. */
  private readonly cancelled = new Set<string>();

  constructor(
    @InjectRepository(Site) private readonly siteRepo: Repository<Site>,
    @InjectRepository(SiteImage)
    private readonly imageRepo: Repository<SiteImage>,
    @InjectRepository(ImageOptimization)
    private readonly optRepo: Repository<ImageOptimization>,
    @InjectRepository(ImageOptimizationRun)
    private readonly runRepo: Repository<ImageOptimizationRun>,
    private readonly configService: OptimizationConfigService,
    private readonly processing: ImageProcessingService,
    private readonly wpMediaService: WpMediaService,
    private readonly r2Service: R2Service,
    private readonly cdnPublishService: CdnPublishService,
  ) {}

  private emptyAcc(): RunAccumulator {
    return {
      processed: 0,
      optimized: 0,
      skipped: 0,
      failed: 0,
      originalBytesSum: 0,
      optimizedBytesSum: 0,
      bytesSavedSum: 0,
    };
  }

  /**
   * Decrypted R2 creds IFF uploads should happen (enabled + verified + complete).
   * Never throws — a decrypt/config problem just disables upload for this run.
   */
  private resolveUploadCreds(config: SiteOptimizationConfig): R2Credentials | null {
    if (!config.enabled || config.r2Status !== R2Status.VERIFIED) return null;
    try {
      return this.configService.getDecryptedCreds(config);
    } catch (err) {
      this.logger.warn(
        `R2 creds unavailable (upload disabled this run): ${(err as Error).message}`,
      );
      return null;
    }
  }

  private fingerprintFor(config: SiteOptimizationConfig): string {
    return computeSettingsFingerprint({
      quality: config.quality,
      webpEnabled: config.webpEnabled,
      maxWidth: config.maxWidth,
      encoderVersion: this.processing.encoderVersion(),
    });
  }

  // ── Bulk run ────────────────────────────────────────────────────────────────

  /** Kick off a background run and return its id immediately (poll for progress). */
  async startRun(
    siteId: string,
    scope: OptimizationRunScope,
  ): Promise<{ runId: string }> {
    const config = await this.configService.getOrCreate(siteId);
    const fingerprint = this.fingerprintFor(config);

    const run = await this.runRepo.save(
      this.runRepo.create({
        siteId,
        scope,
        triggeredBy: OptimizationRunTrigger.MANUAL,
        settingsSnapshot: {
          quality: config.quality,
          webpEnabled: config.webpEnabled,
          maxWidth: config.maxWidth,
        },
        settingsFingerprint: fingerprint,
        status: OptimizationRunStatus.RUNNING,
      }),
    );

    // Fire-and-forget, mirroring SitesService.parseSite. Errors are captured on
    // the run row so the poll surfaces them.
    void this.executeRun(run.id, siteId, scope, config, fingerprint).catch(
      async (err) => {
        this.logger.error(
          `Optimization run ${run.id} crashed: ${(err as Error).message}`,
        );
        await this.runRepo.update(
          { id: run.id },
          {
            status: OptimizationRunStatus.ERROR,
            error: (err as Error).message,
            finishedAt: new Date(),
          },
        );
      },
    );

    return { runId: run.id };
  }

  /**
   * Run to completion and return the finished run (used by the autopilot, which
   * needs to await the result before publishing). Same engine as startRun.
   */
  async runBlocking(
    siteId: string,
    scope: OptimizationRunScope,
    triggeredBy: OptimizationRunTrigger,
  ): Promise<ImageOptimizationRun> {
    const config = await this.configService.getOrCreate(siteId);
    const fingerprint = this.fingerprintFor(config);
    const run = await this.runRepo.save(
      this.runRepo.create({
        siteId,
        scope,
        triggeredBy,
        settingsSnapshot: {
          quality: config.quality,
          webpEnabled: config.webpEnabled,
          maxWidth: config.maxWidth,
        },
        settingsFingerprint: fingerprint,
        status: OptimizationRunStatus.RUNNING,
      }),
    );
    await this.executeRun(run.id, siteId, scope, config, fingerprint);
    return this.getRun(run.id);
  }

  /**
   * Optimize a SINGLE WordPress attachment (the new-upload webhook path).
   * Strictly `new_only`: an already-optimized attachment is a no-op (duplicate
   * webhooks are safe). Optimizes → uploads to R2 → publishes just that mapping
   * if rewriting is live. Never force-reoptimizes here.
   */
  async optimizeSingleAttachment(
    siteId: string,
    wpAttachmentId: number,
  ): Promise<{ status: string }> {
    const config = await this.configService.getOrCreate(siteId);
    if (!config.enabled || config.r2Status !== R2Status.VERIFIED) {
      return { status: 'skipped_disabled' };
    }

    // Materialise the new attachment into the inventory (idempotent upsert).
    try {
      await this.wpMediaService.ingest(siteId);
    } catch (err) {
      this.logger.warn(
        `Webhook ingest failed for site ${siteId}: ${(err as Error).message}`,
      );
    }

    const image = await this.imageRepo.findOne({ where: { siteId, wpAttachmentId } });
    if (!image) return { status: 'not_found' };

    const fingerprint = this.fingerprintFor(config);
    const existing = await this.optRepo.findOne({ where: { imageId: image.id } });

    // Idempotency: never re-touch an already-optimized image (new_only).
    if (!shouldProcess(OptimizationRunScope.NEW_ONLY, existing, fingerprint)) {
      return { status: 'already_optimized' };
    }

    const acc = this.emptyAcc();
    await this.processOne(
      siteId,
      image.id,
      image.canonicalUrl,
      config,
      fingerprint,
      null,
      existing,
      OptimizationRunScope.NEW_ONLY,
      acc,
      this.resolveUploadCreds(config),
    );

    // Publish just this mapping if rewriting is live.
    if (config.rewriteEnabled && image.wpAttachmentId) {
      const row = await this.optRepo.findOne({ where: { imageId: image.id } });
      const site = await this.siteRepo.findOne({ where: { id: siteId } });
      if (row?.r2Uploaded && site) {
        try {
          await this.cdnPublishService.publishOne(config, site, row, Number(image.wpAttachmentId));
        } catch (err) {
          this.logger.warn(`Webhook publish failed: ${(err as Error).message}`);
        }
      }
    }

    return {
      status: acc.optimized ? 'optimized' : acc.skipped ? 'skipped' : 'failed',
    };
  }

  private async executeRun(
    runId: string,
    siteId: string,
    scope: OptimizationRunScope,
    config: SiteOptimizationConfig,
    fingerprint: string,
  ): Promise<void> {
    // Refresh inventory from WP (reuse the ALT module's ingest). Resilient: a
    // missing key / unreachable WP must not abort optimizing existing inventory.
    try {
      await this.wpMediaService.ingest(siteId);
    } catch (err) {
      this.logger.warn(
        `Run ${runId}: WP media ingest skipped (${(err as Error).message})`,
      );
    }

    const images = await this.imageRepo.find({
      where: { siteId },
      select: ['id', 'canonicalUrl'],
    });
    const existingRows = await this.optRepo.find({ where: { siteId } });
    const existingById = new Map(existingRows.map((r) => [r.imageId, r]));
    const uploadCreds = this.resolveUploadCreds(config);

    const candidates = images.filter((img) =>
      shouldProcess(scope, existingById.get(img.id) ?? null, fingerprint),
    );

    const acc: RunAccumulator = {
      processed: 0,
      optimized: 0,
      skipped: 0,
      failed: 0,
      originalBytesSum: 0,
      optimizedBytesSum: 0,
      bytesSavedSum: 0,
    };

    await this.runRepo.update(
      { id: runId },
      { imagesConsidered: candidates.length },
    );

    for (const img of candidates) {
      if (this.cancelled.has(runId)) break;
      await this.processOne(
        siteId,
        img.id,
        img.canonicalUrl,
        config,
        fingerprint,
        runId,
        existingById.get(img.id) ?? null,
        scope,
        acc,
        uploadCreds,
      );
      await this.persistProgress(runId, acc);
    }

    const wasCancelled = this.cancelled.delete(runId);
    await this.runRepo.update(
      { id: runId },
      {
        ...this.accToRunFields(acc),
        status: wasCancelled
          ? OptimizationRunStatus.CANCELLED
          : OptimizationRunStatus.DONE,
        finishedAt: new Date(),
      },
    );
    this.logger.log(
      `Optimization run ${runId} ${wasCancelled ? 'cancelled' : 'done'}: ` +
        `${acc.optimized} optimized, ${acc.skipped} skipped, ${acc.failed} failed, ` +
        `${acc.bytesSavedSum} bytes saved`,
    );
  }

  /** Process a single image into its current-state row and tally into `acc`. */
  private async processOne(
    siteId: string,
    imageId: string,
    url: string,
    config: SiteOptimizationConfig,
    fingerprint: string,
    runId: string | null,
    existing: ImageOptimization | null,
    scope: OptimizationRunScope,
    acc: RunAccumulator,
    uploadCreds: R2Credentials | null,
  ): Promise<void> {
    const row = existing ?? this.optRepo.create({ imageId, siteId });
    row.lastRunId = runId;

    // 1. Fetch source bytes.
    let bytes: Buffer;
    try {
      bytes = await this.fetchBytes(url);
    } catch (err) {
      row.state = ImageOptimizationState.FAILED;
      row.failurePhase = 'fetch';
      row.failureError = (err as Error).message;
      await this.optRepo.save(row);
      acc.processed++;
      acc.failed++;
      return;
    }

    const hash = sha256(bytes);
    const fetchedAt = new Date();

    // Content+settings dedup: identical source AND settings already optimized →
    // genuine no-op, don't re-encode or re-count (analyst P1-1). force_all skips this.
    if (
      scope !== OptimizationRunScope.FORCE_ALL &&
      existing &&
      existing.sourceHash === hash &&
      existing.settingsFingerprint === fingerprint &&
      (existing.state === ImageOptimizationState.OPTIMIZED ||
        existing.state === ImageOptimizationState.SKIPPED)
    ) {
      return;
    }

    // 2. Optimize (pure sharp pipeline — no upload this phase).
    row.sourceHash = hash;
    row.settingsFingerprint = fingerprint;
    row.sourceFetchedAt = fetchedAt;
    try {
      const result = await this.processing.process(bytes, {
        webpEnabled: config.webpEnabled,
        quality: config.quality,
        maxWidth: config.maxWidth,
      });
      row.originalBytes = result.originalBytes;
      row.optimizedBytes = result.optimizedBytes;
      row.failurePhase = null;
      row.failureError = null;

      if (result.outcome === 'optimized') {
        row.state = ImageOptimizationState.OPTIMIZED;
        row.outputFormat = result.format ?? null;
        row.outputWidth = result.width ?? null;
        row.outputHeight = result.height ?? null;
        row.skipReason = null;
        row.optimizedAt = new Date();
        acc.optimized++;
        // Phase 2: upload the optimized artifact to R2 (never touches WP).
        if (uploadCreds && result.buffer) {
          await this.uploadToR2(row, uploadCreds, hash, result.format ?? 'webp', result.buffer);
        }
      } else {
        row.state = ImageOptimizationState.SKIPPED;
        row.outputFormat = null;
        row.outputWidth = null;
        row.outputHeight = null;
        row.skipReason = result.skipReason ?? null;
        row.optimizedAt = new Date();
        acc.skipped++;
      }
      // Byte rollups for optimized + skipped (both have real measurements).
      acc.originalBytesSum += result.originalBytes;
      acc.optimizedBytesSum += result.optimizedBytes;
      acc.bytesSavedSum += Math.max(
        0,
        result.originalBytes - result.optimizedBytes,
      );
    } catch (err) {
      row.state = ImageOptimizationState.FAILED;
      row.failurePhase = 'decode';
      row.failureError = (err as Error).message;
      acc.failed++;
    }

    await this.optRepo.save(row);
    acc.processed++;
  }

  private async fetchBytes(url: string): Promise<Buffer> {
    const res = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: FETCH_TIMEOUT_MS,
      maxContentLength: MAX_FETCH_BYTES,
      maxBodyLength: MAX_FETCH_BYTES,
    });
    return Buffer.from(res.data);
  }

  /**
   * Upload the optimized artifact to R2 with a content-hashed (immutable) key,
   * then HEAD-verify it exists. Failure NEVER fails the row: the local encode
   * already succeeded, so we keep state OPTIMIZED, mark r2Uploaded=false, and
   * record a scrubbed reason. Phase 3 will only rewrite URLs for r2Uploaded rows.
   */
  private async uploadToR2(
    row: ImageOptimization,
    creds: R2Credentials,
    hash: string,
    format: 'webp' | 'jpeg',
    buffer: Buffer,
  ): Promise<void> {
    const ext = format === 'webp' ? 'webp' : 'jpg';
    const contentType = format === 'webp' ? 'image/webp' : 'image/jpeg';
    const key = `img/${hash}.${ext}`;
    try {
      await this.r2Service.put(creds, key, buffer, contentType);
      await this.r2Service.headObject(creds, key); // verify the object landed
      row.r2Key = key;
      row.r2Uploaded = true;
    } catch (err) {
      row.r2Uploaded = false;
      row.failureError = `R2 upload: ${mapS3Error(err)}`;
      this.logger.warn(
        `R2 upload failed for image ${row.imageId}: ${row.failureError}`,
      );
    }
  }

  private accToRunFields(acc: RunAccumulator) {
    return {
      processed: acc.processed,
      optimized: acc.optimized,
      skipped: acc.skipped,
      failed: acc.failed,
      originalBytesSum: acc.originalBytesSum,
      optimizedBytesSum: acc.optimizedBytesSum,
      bytesSavedSum: acc.bytesSavedSum,
    };
  }

  private async persistProgress(runId: string, acc: RunAccumulator) {
    await this.runRepo.update({ id: runId }, this.accToRunFields(acc));
  }

  async cancelRun(runId: string): Promise<{ cancelled: boolean }> {
    const run = await this.runRepo.findOne({ where: { id: runId } });
    if (!run) throw new NotFoundException('Run not found');
    if (run.status === OptimizationRunStatus.RUNNING) {
      this.cancelled.add(runId);
      return { cancelled: true };
    }
    return { cancelled: false };
  }

  async getRun(runId: string): Promise<ImageOptimizationRun> {
    const run = await this.runRepo.findOne({ where: { id: runId } });
    if (!run) throw new NotFoundException('Run not found');
    return run;
  }

  async listRuns(siteId: string, limit = 20): Promise<ImageOptimizationRun[]> {
    return this.runRepo.find({
      where: { siteId },
      order: { startedAt: 'DESC' },
      take: limit,
    });
  }

  // ── Single-image force re-optimize ──────────────────────────────────────────

  async reoptimizeOne(
    siteId: string,
    imageId: string,
  ): Promise<ImageOptimization> {
    const image = await this.imageRepo.findOne({
      where: { id: imageId, siteId },
    });
    if (!image) throw new NotFoundException('Image not found');
    const config = await this.configService.getOrCreate(siteId);
    const fingerprint = this.fingerprintFor(config);
    const existing = await this.optRepo.findOne({ where: { imageId } });

    const acc: RunAccumulator = {
      processed: 0,
      optimized: 0,
      skipped: 0,
      failed: 0,
      originalBytesSum: 0,
      optimizedBytesSum: 0,
      bytesSavedSum: 0,
    };
    await this.processOne(
      siteId,
      imageId,
      image.canonicalUrl,
      config,
      fingerprint,
      // No run row for a single force; lastRunId stays null for a manual reoptimize.
      null,
      existing,
      OptimizationRunScope.FORCE_ALL,
      acc,
      this.resolveUploadCreds(config),
    );

    const row = await this.optRepo.findOne({ where: { imageId } });
    if (!row) throw new NotFoundException('Optimization row not found');
    return row;
  }

  // ── Image list (inventory + optimization state) ─────────────────────────────

  async listImages(
    siteId: string,
    params: { page: number; limit: number; state?: string; search?: string },
  ) {
    const config = await this.configService.getOrCreate(siteId);
    const fingerprint = this.fingerprintFor(config);
    const { page, limit } = params;

    const base = this.imageRepo
      .createQueryBuilder('si')
      .leftJoin('image_optimization', 'opt', 'opt.imageId = si.id')
      .where('si.siteId = :siteId', { siteId });

    if (params.search) {
      base.andWhere('si.canonicalUrl ILIKE :q', { q: `%${params.search}%` });
    }
    if (params.state) {
      if (params.state === ImageOptimizationState.NOT_OPTIMIZED) {
        base.andWhere('(opt.id IS NULL OR opt.state = :st)', {
          st: ImageOptimizationState.NOT_OPTIMIZED,
        });
      } else {
        base.andWhere('opt.state = :st', { st: params.state });
      }
    }

    const total = await base.getCount();
    const pageImages = await base
      .clone()
      .select('si.id', 'id')
      .addSelect('si.canonicalUrl', 'canonicalUrl')
      .addSelect('si.canonicalKey', 'canonicalKey')
      .addSelect('si.wpAttachmentId', 'wpAttachmentId')
      .orderBy('si.createdAt', 'DESC')
      .offset((page - 1) * limit)
      .limit(limit)
      .getRawMany<{
        id: string;
        canonicalUrl: string;
        canonicalKey: string;
        wpAttachmentId: string | null;
      }>();

    const ids = pageImages.map((r) => r.id);
    const opts = ids.length
      ? await this.optRepo.find({ where: { imageId: In(ids) } })
      : [];
    const optById = new Map(opts.map((o) => [o.imageId, o]));

    const data = pageImages.map((si) => {
      const o = optById.get(si.id) ?? null;
      const saved =
        o && o.state === ImageOptimizationState.OPTIMIZED
          ? Math.max(0, (o.originalBytes ?? 0) - (o.optimizedBytes ?? 0))
          : null;
      return {
        imageId: si.id,
        canonicalUrl: si.canonicalUrl,
        canonicalKey: si.canonicalKey,
        wpAttachmentId: si.wpAttachmentId,
        state: o?.state ?? ImageOptimizationState.NOT_OPTIMIZED,
        originalBytes: o?.originalBytes ?? null,
        optimizedBytes: o?.optimizedBytes ?? null,
        bytesSaved: saved,
        outputFormat: o?.outputFormat ?? null,
        skipReason: o?.skipReason ?? null,
        failureError: o?.failureError ?? null,
        isStale: o ? isStale(o, fingerprint) : false,
        optimizedAt: o?.optimizedAt ?? null,
        r2Uploaded: o?.r2Uploaded ?? false,
        r2Key: o?.r2Key ?? null,
        rewriteLive: o?.rewriteLive ?? false,
      };
    });

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }
}
