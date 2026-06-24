import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { Site } from '../sites/site.entity';
import { SiteImage, ImageAltStatus } from './site-image.entity';
import { normalizeImageUrl } from './image-identity';
import { classifyAlt } from './alt-quality';

/**
 * Ingests the AUTHORITATIVE image inventory from the WordPress media library
 * (`GET /wp-json/poirier-cms/v1/media`) — NOT from scraping rendered pages.
 *
 * The media library is the source of truth for "what images exist" and "what
 * alt text each one currently has" (`_wp_attachment_image_alt`). Page scraping
 * is used only to discover WHERE an image is used (placements) and the
 * surrounding context for AI grounding — never to decide an image's alt state.
 *
 * Each attachment maps to one SiteImage keyed by `wpAttachmentId` (the WP
 * post id is the authoritative identity; the normalized URL is the join key
 * used later to attach scraped placements). Pending user/AI work (draftAlt and
 * a non-synced status) is never clobbered — only the observed signals refresh.
 */

interface WpMediaItem {
  id: number;
  url: string;
  alt: string;
  altSet: boolean;
  mime: string;
  title: string;
}

interface WpMediaPage {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
  items: WpMediaItem[];
}

export interface IngestResult {
  fetched: number;
  created: number;
  updated: number;
}

const PER_PAGE = 100;
const MAX_PAGES = 200; // safety bound (20k images)

@Injectable()
export class WpMediaService {
  private readonly logger = new Logger(WpMediaService.name);

  constructor(
    @InjectRepository(Site) private readonly siteRepo: Repository<Site>,
    @InjectRepository(SiteImage)
    private readonly imageRepo: Repository<SiteImage>,
  ) {}

  /** Pull every image attachment from WP and reconcile it into the library. */
  async ingest(siteId: string): Promise<IngestResult> {
    const site = await this.siteRepo.findOne({ where: { id: siteId } });
    if (!site) throw new NotFoundException('Site not found');
    if (!site.wpApiKey) {
      throw new BadRequestException(
        'No WP API key configured for this site. Add it in site settings to sync the media library.',
      );
    }

    let created = 0;
    let updated = 0;
    let fetched = 0;
    const now = new Date();

    for (let page = 1; page <= MAX_PAGES; page++) {
      const batch = await this.fetchPage(site, page);
      if (!batch.items.length) break;
      fetched += batch.items.length;

      for (const item of batch.items) {
        const res = await this.upsertItem(siteId, item, now);
        if (res === 'created') created++;
        else if (res === 'updated') updated++;
      }

      if (page >= batch.totalPages) break;
    }

    this.logger.log(
      `WP media ingest for site ${siteId}: ${fetched} fetched, ${created} created, ${updated} updated`,
    );
    return { fetched, created, updated };
  }

  private async fetchPage(site: Site, page: number): Promise<WpMediaPage> {
    try {
      const { data } = await axios.get<WpMediaPage>(
        `${site.url}/wp-json/poirier-cms/v1/media`,
        {
          params: { page, per_page: PER_PAGE },
          timeout: 20_000,
          headers: { 'X-Poirier-API-Key': site.wpApiKey as string },
        },
      );
      return data;
    } catch (err) {
      const msg = axios.isAxiosError(err)
        ? `HTTP ${err.response?.status ?? 'no response'}: ${err.response?.data?.message ?? err.message}`
        : (err as Error).message;
      throw new ServiceUnavailableException(`WP media fetch failed: ${msg}`);
    }
  }

  private async upsertItem(
    siteId: string,
    item: WpMediaItem,
    now: Date,
  ): Promise<'created' | 'updated' | 'skipped'> {
    const norm = normalizeImageUrl(item.url);
    const canonicalKey = norm?.canonicalKey ?? `wp:${item.id}`;
    const canonicalUrl = norm?.canonicalUrl ?? item.url;

    // WP returns '' both for "alt never set" and alt="". `altSet` (metadata
    // existence) lets us classify truly-absent alt distinctly from empty.
    const altAttr = item.altSet ? item.alt : null;
    const observedQuality = classifyAlt(altAttr, canonicalUrl);

    // Identity: prefer the WP attachment id (authoritative), fall back to the
    // normalized URL key so a pre-existing scrape-sourced row gets adopted.
    let img =
      (await this.imageRepo.findOne({
        where: { siteId, wpAttachmentId: item.id },
      })) ??
      (await this.imageRepo.findOne({ where: { siteId, canonicalKey } }));

    if (!img) {
      img = this.imageRepo.create({
        siteId,
        canonicalKey,
        canonicalUrl,
        wpAttachmentId: item.id,
        observedAlt: altAttr ?? '',
        observedQuality,
        status: ImageAltStatus.SYNCED,
        lastSeenAt: now,
      });
      await this.imageRepo.save(img);
      return 'created';
    }

    // Refresh observed signals + identity ONLY. Never touch a user/AI draft or a
    // non-synced (pending) status — that's the operator's in-flight work.
    img.wpAttachmentId = item.id;
    img.observedAlt = altAttr ?? '';
    img.observedQuality = observedQuality;
    img.lastSeenAt = now;
    if (img.status === ImageAltStatus.SYNCED) {
      img.canonicalUrl = canonicalUrl;
      img.canonicalKey = canonicalKey;
    }
    await this.imageRepo.save(img);
    return 'updated';
  }
}
