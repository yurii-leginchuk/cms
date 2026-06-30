import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import axios from 'axios';
import { Site } from '../sites/site.entity';
import { SiteImage, ImageAltStatus } from './site-image.entity';
import { ImagePlacement } from './image-placement.entity';

/**
 * Pushes image ALT text to WordPress, mirroring SchemaSyncService. The WP target
 * is the MEDIA ATTACHMENT alt meta (`_wp_attachment_image_alt`) — one canonical
 * alt per file that propagates to every place WordPress renders it. The plugin
 * resolves the image URL → attachment id (and, as a fallback the plugin owns,
 * rewrites inline post `<img>` alt for non-library images). The CMS sends the
 * canonical alt + the raw src variants seen, so the plugin can match the asset.
 */

export interface ApplyResult {
  applied: number;
  at: string;
}

export type PendingAction = 'set' | 'clear';

export interface PendingImageItem {
  imageId: string;
  canonicalUrl: string;
  action: PendingAction;
  alt: string;
  source: string;
  needsReview: boolean;
  usageCount: number;
}

export interface PendingSummary {
  totalImages: number;
  totalSets: number;
  totalClears: number;
  /** Reviewed (appliable) vs. still AI-suggested (excluded by default). */
  reviewed: number;
  unreviewed: number;
  items: PendingImageItem[];
}

export interface ApplyAllResult {
  applied: number;
  failed: number;
  skippedUnreviewed: number;
  perImage: { imageId: string; canonicalUrl: string; ok: boolean; error?: string }[];
}

@Injectable()
export class ImageSyncService {
  private readonly logger = new Logger(ImageSyncService.name);

  constructor(
    @InjectRepository(Site) private readonly siteRepo: Repository<Site>,
    @InjectRepository(SiteImage) private readonly imageRepo: Repository<SiteImage>,
    @InjectRepository(ImagePlacement)
    private readonly placementRepo: Repository<ImagePlacement>,
  ) {}

  private async requireKey(siteId: string): Promise<Site> {
    const site = await this.siteRepo.findOne({ where: { id: siteId } });
    if (!site) throw new NotFoundException('Site not found');
    if (!site.wpApiKey) {
      throw new BadRequestException(
        'No WP API key configured for this site. Add it in site settings.',
      );
    }
    return site;
  }

  /** Push one image's alt to WordPress. Only `modified`/`removed` rows apply. */
  async applyOne(siteId: string, imageId: string): Promise<ApplyResult> {
    const site = await this.requireKey(siteId);
    const image = await this.imageRepo.findOne({ where: { id: imageId, siteId } });
    if (!image) throw new NotFoundException('Image not found');
    if (
      image.status !== ImageAltStatus.MODIFIED &&
      image.status !== ImageAltStatus.REMOVED
    ) {
      throw new BadRequestException('No pending change to apply for this image.');
    }
    await this.pushOne(site, image);
    return { applied: 1, at: new Date().toISOString() };
  }

  private async pushOne(site: Site, image: SiteImage): Promise<void> {
    // Gather the raw src variants seen across pages so the plugin can locate the
    // attachment even when the canonical URL had resize suffixes stripped.
    const placements = await this.placementRepo.find({
      where: { imageId: image.id },
      select: ['rawSrc', 'pageId'],
    });
    const rawSrcs = [...new Set(placements.map((p) => p.rawSrc))];
    const alt = image.status === ImageAltStatus.REMOVED ? '' : image.draftAlt ?? '';

    try {
      await axios.post(
        `${site.url}/wp-json/poirier-cms/v1/image-alt`,
        {
          canonicalUrl: image.canonicalUrl,
          srcVariants: rawSrcs,
          wpAttachmentId: image.wpAttachmentId ?? null,
          alt,
        },
        {
          timeout: 15_000,
          headers: {
            'Content-Type': 'application/json',
            'X-Poirier-API-Key': site.wpApiKey as string,
          },
        },
      );
    } catch (err) {
      const msg = axios.isAxiosError(err)
        ? `HTTP ${err.response?.status ?? 'no response'}: ${err.response?.data?.message ?? err.message}`
        : (err as Error).message;
      await this.imageRepo.update({ id: image.id }, { publishError: msg });
      throw new ServiceUnavailableException(`Alt apply failed: ${msg}`);
    }

    const now = new Date();
    if (image.status === ImageAltStatus.REMOVED) {
      // Cleared on WP → row returns to a clean synced baseline with no alt.
      await this.imageRepo.update(
        { id: image.id },
        {
          status: ImageAltStatus.SYNCED,
          observedAlt: '',
          draftAlt: null,
          lastPublishedAt: now,
          publishError: null,
        },
      );
    } else {
      await this.imageRepo.update(
        { id: image.id },
        {
          status: ImageAltStatus.SYNCED,
          observedAlt: alt,
          observedQuality: alt.trim() === '' ? 'empty' : 'meaningful',
          lastPublishedAt: now,
          publishError: null,
        },
      );
    }
    this.logger.log(`Applied alt to ${image.canonicalUrl}`);
  }

  /**
   * Autopilot apply: push every AI suggestion the generator was CONFIDENT about
   * (`needsReview === false`) straight to WordPress with NO human review. Risky
   * suggestions (`needsReview` — a forbidden Brand-Card term, over-length, or
   * thin context with no vision description) are deliberately left as
   * `ai_suggested` for a human. This is the unattended path the nightly autopilot
   * uses so NEW images get alt the same night without confirmation.
   */
  async autoApplyConfident(
    siteId: string,
  ): Promise<{ applied: number; failed: number; heldForReview: number }> {
    const site = await this.requireKey(siteId);

    const confident = await this.imageRepo.find({
      where: { siteId, status: ImageAltStatus.AI_SUGGESTED, needsReview: false },
    });
    const heldForReview = await this.imageRepo.count({
      where: { siteId, status: ImageAltStatus.AI_SUGGESTED, needsReview: true },
    });

    let applied = 0;
    let failed = 0;
    for (const img of confident) {
      // Promote to `modified` so pushOne's success path flips it to `synced`
      // exactly as a reviewed apply would.
      img.status = ImageAltStatus.MODIFIED;
      await this.imageRepo.update({ id: img.id }, { status: ImageAltStatus.MODIFIED });
      try {
        await this.pushOne(site, img);
        applied++;
      } catch (err) {
        failed++;
        this.logger.warn(
          `Autopilot apply failed for ${img.canonicalUrl}: ${(err as Error).message}`,
        );
      }
    }
    return { applied, failed, heldForReview };
  }

  /** Preview of every pending image change (for the Apply-All dialog). */
  async pendingSummary(siteId: string): Promise<PendingSummary> {
    const rows = await this.imageRepo.find({
      where: [
        { siteId, status: ImageAltStatus.MODIFIED },
        { siteId, status: ImageAltStatus.REMOVED },
        { siteId, status: ImageAltStatus.AI_SUGGESTED },
      ],
      order: { updatedAt: 'DESC' },
    });

    const ids = rows.map((r) => r.id);
    const counts = ids.length
      ? await this.placementRepo
          .createQueryBuilder('p')
          .select('p.imageId', 'imageId')
          .addSelect('COUNT(DISTINCT p.pageId)', 'cnt')
          .where('p.imageId IN (:...ids)', { ids })
          .groupBy('p.imageId')
          .getRawMany<{ imageId: string; cnt: string }>()
      : [];
    const usageById = new Map(counts.map((c) => [c.imageId, parseInt(c.cnt, 10)]));

    let totalSets = 0;
    let totalClears = 0;
    let reviewed = 0;
    let unreviewed = 0;
    const items: PendingImageItem[] = rows.map((r) => {
      const action: PendingAction = r.status === ImageAltStatus.REMOVED ? 'clear' : 'set';
      if (action === 'clear') totalClears++;
      else totalSets++;
      if (r.status === ImageAltStatus.AI_SUGGESTED) unreviewed++;
      else reviewed++;
      return {
        imageId: r.id,
        canonicalUrl: r.canonicalUrl,
        action,
        alt: r.draftAlt ?? '',
        source: r.source,
        needsReview: r.status === ImageAltStatus.AI_SUGGESTED || r.needsReview,
        usageCount: usageById.get(r.id) ?? 0,
      };
    });

    return {
      totalImages: rows.length,
      totalSets,
      totalClears,
      reviewed,
      unreviewed,
      items,
    };
  }

  /**
   * Apply every pending alt change. By default EXCLUDES `ai_suggested`
   * (unreviewed) rows — the review-before-apply gate. `includeUnreviewed=true`
   * is the deliberate "I've reviewed these" override.
   */
  async applyAll(siteId: string, includeUnreviewed: boolean): Promise<ApplyAllResult> {
    const site = await this.requireKey(siteId);

    const statuses = includeUnreviewed
      ? [ImageAltStatus.MODIFIED, ImageAltStatus.REMOVED, ImageAltStatus.AI_SUGGESTED]
      : [ImageAltStatus.MODIFIED, ImageAltStatus.REMOVED];

    const rows = await this.imageRepo.find({
      where: statuses.map((s) => ({ siteId, status: s })),
    });

    const skippedUnreviewed = includeUnreviewed
      ? 0
      : await this.imageRepo.count({ where: { siteId, status: ImageAltStatus.AI_SUGGESTED } });

    if (rows.length === 0) {
      throw new BadRequestException(
        skippedUnreviewed > 0
          ? 'All pending alt changes are unreviewed AI suggestions. Review them first, or confirm to apply.'
          : 'No changes to apply.',
      );
    }

    // ai_suggested rows being force-applied are promoted to modified first.
    const aiRows = rows.filter((r) => r.status === ImageAltStatus.AI_SUGGESTED);
    if (aiRows.length) {
      await this.imageRepo.update(
        { id: In(aiRows.map((r) => r.id)) },
        { status: ImageAltStatus.MODIFIED },
      );
      for (const r of aiRows) r.status = ImageAltStatus.MODIFIED;
    }

    let applied = 0;
    let failed = 0;
    const perImage: ApplyAllResult['perImage'] = [];
    for (const img of rows) {
      try {
        await this.pushOne(site, img);
        applied++;
        perImage.push({ imageId: img.id, canonicalUrl: img.canonicalUrl, ok: true });
      } catch (err) {
        failed++;
        perImage.push({
          imageId: img.id,
          canonicalUrl: img.canonicalUrl,
          ok: false,
          error: (err as Error).message,
        });
      }
    }

    this.logger.log(
      `Apply-all images for site ${siteId}: ${applied} applied, ${failed} failed, ${skippedUnreviewed} skipped`,
    );
    return { applied, failed, skippedUnreviewed, perImage };
  }
}
