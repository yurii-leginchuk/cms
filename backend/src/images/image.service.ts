import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Page } from '../pages/page.entity';
import { Site } from '../sites/site.entity';
import { SiteImage, ImageAltStatus, ImageAltSource } from './site-image.entity';
import { BadRequestException } from '@nestjs/common';
import { ImagePlacement } from './image-placement.entity';
import { extractImagePlacements } from './image-extract';
import { needsAlt } from './alt-quality';
import { WpMediaService } from './wp-media.service';

export interface SiteImageRow {
  id: string;
  canonicalKey: string;
  canonicalUrl: string;
  draftAlt: string | null;
  observedAlt: string | null;
  observedQuality: string;
  status: ImageAltStatus;
  source: string;
  decorative: boolean;
  needsReview: boolean;
  aiRationale: string | null;
  evidence: string[];
  unverifiedClaims: string[];
  usageCount: number;
  pages: { pageId: string; url: string }[];
  lastSeenAt: Date | null;
}

export interface ImageCoverage {
  /** Distinct images (deduped) on the site. */
  imagesTotal: number;
  /** Per-image worst-case: an image is "missing" if it needs alt anywhere. */
  imagesMissing: number;
  /** Per-placement honest site coverage: covered placements / all placements. */
  placementsTotal: number;
  placementsWithAlt: number;
  pendingChanges: number;
  /** Freshness: oldest contributing page scrape (null if none). */
  asOf: string | null;
}

@Injectable()
export class ImageService {
  private readonly logger = new Logger(ImageService.name);

  constructor(
    @InjectRepository(Page) private readonly pageRepo: Repository<Page>,
    @InjectRepository(Site) private readonly siteRepo: Repository<Site>,
    @InjectRepository(SiteImage)
    private readonly imageRepo: Repository<SiteImage>,
    @InjectRepository(ImagePlacement)
    private readonly placementRepo: Repository<ImagePlacement>,
    private readonly wpMediaService: WpMediaService,
  ) {}

  /**
   * Re-derive image PLACEMENTS for ONE page from its rawHtml and attach them to
   * the library. The image inventory and alt state come from the WordPress media
   * library (see WpMediaService), NOT from the scrape — so this only discovers
   * WHERE a known image is used and the surrounding context for AI grounding.
   * Scraped occurrences whose image is not in the media library are skipped, and
   * a placement NEVER overwrites an image's observed alt (WP is authoritative).
   */
  async reconcilePage(pageId: string): Promise<{ images: number; placements: number }> {
    const page = await this.pageRepo.findOne({ where: { id: pageId } });
    if (!page) throw new NotFoundException('Page not found');
    if (!page.rawHtml) return { images: 0, placements: 0 };

    const now = new Date();
    const records = extractImagePlacements(page.rawHtml, page.url);

    // Group records by canonicalKey for this page (dedupe library rows).
    const byKey = new Map<string, typeof records>();
    for (const r of records) {
      const list = byKey.get(r.canonicalKey) ?? [];
      list.push(r);
      byKey.set(r.canonicalKey, list);
    }

    // Look up EXISTING library images (sourced from the WP media library). We do
    // not create rows from the scrape — only the media library defines what
    // images exist.
    const existingImages = await this.imageRepo.find({
      where: { siteId: page.siteId, canonicalKey: In([...byKey.keys()]) },
    });
    const imgByKey = new Map(existingImages.map((i) => [i.canonicalKey, i]));

    let matched = 0;
    for (const [key, recs] of byKey) {
      const img = imgByKey.get(key);
      if (!img) {
        // Not in the WP media library (e.g. an external/CDN or theme image
        // referenced inline). Skip — it has no authoritative attachment to manage.
        continue;
      }
      matched++;

      // Touch freshness only; observed alt/quality belong to the media library.
      if (img.lastSeenAt == null || img.lastSeenAt < now) {
        await this.imageRepo.update({ id: img.id }, { lastSeenAt: now });
      }

      // Reconcile placements for this (page,key): upsert by domIndex.
      const existingPlacements = await this.placementRepo.find({
        where: { pageId, canonicalKey: key },
      });
      const byDom = new Map(existingPlacements.map((p) => [p.domIndex, p]));
      for (const r of recs) {
        const ex = byDom.get(r.domIndex);
        if (ex) {
          ex.observedAlt = r.observedAlt;
          ex.quality = r.quality;
          ex.nearestHeading = r.nearestHeading;
          ex.caption = r.caption;
          ex.surroundingText = r.surroundingText;
          ex.rawSrc = r.rawSrc;
          ex.lastSeenAt = now;
          ex.imageId = img.id;
          await this.placementRepo.save(ex);
          byDom.delete(r.domIndex);
        } else {
          await this.placementRepo.save(
            this.placementRepo.create({
              siteId: page.siteId,
              imageId: img.id,
              pageId,
              canonicalKey: key,
              rawSrc: r.rawSrc,
              domIndex: r.domIndex,
              observedAlt: r.observedAlt,
              quality: r.quality,
              nearestHeading: r.nearestHeading,
              caption: r.caption,
              surroundingText: r.surroundingText,
              firstSeenAt: now,
              lastSeenAt: now,
            }),
          );
        }
      }
      // Placements that vanished from this page → delete (the image still lives
      // in the library via its other pages; the SiteImage row is untouched).
      const goneIds = [...byDom.values()].map((p) => p.id);
      if (goneIds.length) await this.placementRepo.delete({ id: In(goneIds) });
    }

    return { images: matched, placements: records.length };
  }

  /**
   * Sync a site's image library: pull the authoritative inventory + alt from the
   * WordPress media library, THEN scan scraped pages to attach placements
   * (where-used + context). Returns counts.
   */
  async reconcileSite(
    siteId: string,
  ): Promise<{ pages: number; images: number; media: { fetched: number; created: number; updated: number } }> {
    // 1. Authoritative inventory from WP media library (source of truth).
    const media = await this.wpMediaService.ingest(siteId);

    // 2. Attach placements from scraped pages (context only — never alt state).
    const pages = await this.pageRepo.find({ where: { siteId }, select: ['id'] });
    let images = 0;
    for (const p of pages) {
      try {
        const r = await this.reconcilePage(p.id);
        images += r.images;
      } catch (err) {
        this.logger.warn(`Image reconcile failed for page ${p.id}: ${(err as Error).message}`);
      }
    }
    await this.pruneOrphans(siteId);
    return { pages: pages.length, images, media };
  }

  private async pruneOrphans(siteId: string): Promise<void> {
    // Prune ONLY legacy scrape-sourced SYNCED rows (no wpAttachmentId) that have
    // no placements. WP-library images are kept even with zero placements — being
    // unused on any scraped page is valid, not orphaned. User-touched rows stay.
    const orphans = await this.imageRepo
      .createQueryBuilder('img')
      .leftJoin(ImagePlacement, 'p', 'p.imageId = img.id')
      .where('img.siteId = :siteId', { siteId })
      .andWhere('img.status = :status', { status: ImageAltStatus.SYNCED })
      .andWhere('img.wpAttachmentId IS NULL')
      .andWhere('p.id IS NULL')
      .select('img.id', 'id')
      .getRawMany<{ id: string }>();
    if (orphans.length) {
      await this.imageRepo.delete({ id: In(orphans.map((o) => o.id)) });
    }
  }

  /** Paginated library list with usage (where-used) + filter. */
  async list(
    siteId: string,
    opts: { page: number; limit: number; missingOnly: boolean; search?: string },
  ): Promise<{ data: SiteImageRow[]; meta: { total: number; page: number; limit: number; totalPages: number } }> {
    const qb = this.imageRepo
      .createQueryBuilder('img')
      .where('img.siteId = :siteId', { siteId });

    if (opts.missingOnly) {
      // Work queue: needs alt (incl. empty alt="" — a decision is required) and
      // not deliberately decorative or already cleared.
      qb.andWhere('img.observedQuality IN (:...q)', {
        q: ['absent', 'empty', 'junkFilename', 'placeholder'],
      })
        .andWhere('img.decorative = false')
        .andWhere('img.status != :removed', { removed: ImageAltStatus.REMOVED });
    }
    if (opts.search) {
      qb.andWhere('img.canonicalUrl ILIKE :s', { s: `%${opts.search}%` });
    }

    const total = await qb.getCount();
    const rows = await qb
      .orderBy('img.createdAt', 'DESC')
      .skip((opts.page - 1) * opts.limit)
      .take(opts.limit)
      .getMany();

    const ids = rows.map((r) => r.id);
    const placements = ids.length
      ? await this.placementRepo.find({
          where: { imageId: In(ids) },
          relations: { page: true },
        })
      : [];
    const usageByImage = new Map<string, { pageId: string; url: string }[]>();
    for (const p of placements) {
      const list = usageByImage.get(p.imageId) ?? [];
      if (p.page && !list.some((x) => x.pageId === p.pageId)) {
        list.push({ pageId: p.pageId, url: p.page.url });
      }
      usageByImage.set(p.imageId, list);
    }

    const data: SiteImageRow[] = rows.map((r) => ({
      id: r.id,
      canonicalKey: r.canonicalKey,
      canonicalUrl: r.canonicalUrl,
      draftAlt: r.draftAlt,
      observedAlt: r.observedAlt,
      observedQuality: r.observedQuality,
      status: r.status,
      source: r.source,
      decorative: r.decorative,
      needsReview: r.needsReview,
      aiRationale: r.aiRationale,
      evidence: r.evidence,
      unverifiedClaims: r.unverifiedClaims,
      usageCount: usageByImage.get(r.id)?.length ?? 0,
      pages: usageByImage.get(r.id) ?? [],
      lastSeenAt: r.lastSeenAt,
    }));

    return {
      data,
      meta: { total, page: opts.page, limit: opts.limit, totalPages: Math.ceil(total / opts.limit) },
    };
  }

  /** Honest coverage: both per-image worst-case and per-placement metrics. */
  async coverage(siteId: string): Promise<ImageCoverage> {
    const images = await this.imageRepo.find({
      where: { siteId },
      select: ['id', 'observedQuality', 'status', 'decorative'],
    });
    // "Missing" = needs alt work and not deliberately decorative. An observed
    // empty alt is a work item (a decision is required), NOT auto-covered.
    const imagesMissing = images.filter(
      (i) =>
        needsAlt(i.observedQuality) &&
        !i.decorative &&
        i.status !== ImageAltStatus.REMOVED,
    ).length;

    // Per-placement coverage inherits each placement's image alt state (the WP
    // media library is authoritative), so it can't contradict the per-image view.
    const placementsTotal = await this.placementRepo.count({ where: { siteId } });
    const placementsWithAlt = await this.placementRepo
      .createQueryBuilder('p')
      .innerJoin(SiteImage, 'img', 'img.id = p.imageId')
      .where('p.siteId = :siteId', { siteId })
      .andWhere('(img.observedQuality = :meaningful OR img.decorative = true)', {
        meaningful: 'meaningful',
      })
      .getCount();

    const pendingChanges = images.filter(
      (i) => i.status === ImageAltStatus.MODIFIED || i.status === ImageAltStatus.REMOVED,
    ).length;

    // Freshness = oldest contributing page scrape.
    const oldest = await this.pageRepo
      .createQueryBuilder('p')
      .where('p.siteId = :siteId', { siteId })
      .andWhere('p.lastScrapedAt IS NOT NULL')
      .select('MIN(p.lastScrapedAt)', 'min')
      .getRawOne<{ min: Date | null }>();

    return {
      imagesTotal: images.length,
      imagesMissing,
      placementsTotal,
      placementsWithAlt,
      pendingChanges,
      asOf: oldest?.min ? new Date(oldest.min).toISOString() : null,
    };
  }

  pendingCount(siteId: string): Promise<number> {
    return this.imageRepo.count({
      where: [
        { siteId, status: ImageAltStatus.MODIFIED },
        { siteId, status: ImageAltStatus.REMOVED },
      ],
    });
  }

  private async getOrThrow(imageId: string): Promise<SiteImage> {
    const img = await this.imageRepo.findOne({ where: { id: imageId } });
    if (!img) throw new NotFoundException('Image not found');
    return img;
  }

  /**
   * Human edit / approve of an alt. This is the review gesture that promotes an
   * `ai_suggested` row to `modified` (appliable). Setting a non-empty alt clears
   * `decorative`; an explicit empty string with decorative=true is allowed.
   */
  async setAlt(
    imageId: string,
    alt: string,
    opts: { decorative?: boolean; bySource?: ImageAltSource } = {},
  ): Promise<SiteImage> {
    const img = await this.getOrThrow(imageId);
    const trimmed = alt ?? '';
    img.draftAlt = trimmed;
    img.decorative = opts.decorative ?? (trimmed.trim() === '' ? img.decorative : false);
    img.source = opts.bySource ?? ImageAltSource.HUMAN;
    img.status = ImageAltStatus.MODIFIED;
    img.needsReview = false;
    return this.imageRepo.save(img);
  }

  /** Mark an image decorative → its applied alt becomes "" (valid a11y outcome). */
  async markDecorative(imageId: string, decorative: boolean): Promise<SiteImage> {
    const img = await this.getOrThrow(imageId);
    img.decorative = decorative;
    img.draftAlt = decorative ? '' : img.draftAlt;
    img.source = ImageAltSource.HUMAN;
    img.status = ImageAltStatus.MODIFIED;
    img.needsReview = false;
    return this.imageRepo.save(img);
  }

  /** Approve an AI suggestion as-is (ai_suggested → modified, appliable). */
  async approve(imageId: string): Promise<SiteImage> {
    const img = await this.getOrThrow(imageId);
    if (img.status !== ImageAltStatus.AI_SUGGESTED) {
      throw new BadRequestException('Only AI-suggested alt can be approved.');
    }
    img.status = ImageAltStatus.MODIFIED;
    img.needsReview = false;
    return this.imageRepo.save(img);
  }

  /** Discard a pending change → revert to the live baseline (synced). */
  async revert(imageId: string): Promise<SiteImage> {
    const img = await this.getOrThrow(imageId);
    img.draftAlt = null;
    img.decorative = false;
    img.needsReview = false;
    img.aiRationale = null;
    img.evidence = [];
    img.unverifiedClaims = [];
    img.source = ImageAltSource.ORIGINAL;
    img.status = ImageAltStatus.SYNCED;
    return this.imageRepo.save(img);
  }
}
