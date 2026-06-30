import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Site } from '../sites/site.entity';
import { ImageService } from './image.service';
import { ImageAiService } from './image-ai.service';
import { ImageSyncService } from './image-sync.service';

export interface AltAutopilotResult {
  siteId: string;
  /** New attachments discovered in the WP media library this run. */
  newImages: number;
  mediaFetched: number;
  /** AI alt suggestions produced for still-missing images. */
  generated: number;
  /** Confident suggestions pushed to WordPress with no review. */
  autoApplied: number;
  /** Risky suggestions left as `ai_suggested` for a human. */
  heldForReview: number;
  failed: number;
}

/**
 * Nightly ALT-text autopilot. For each site with a WP API key it:
 *   1. pulls the WordPress media library (the source of truth) → discovers NEW
 *      attachments and refreshes each image's observed alt;
 *   2. attaches fresh placement context from the (re-scraped) pages so the AI is
 *      grounded in the text around each image;
 *   3. generates grounded alt for every image still missing it;
 *   4. AUTO-APPLIES the confident suggestions to WordPress with no confirmation,
 *      and holds only the risky ones (forbidden term / over-length / thin
 *      context) for a human.
 *
 * It converges: an auto-applied image becomes `synced` with meaningful alt and a
 * held one stays `ai_suggested` — neither re-enters generation — so each run only
 * spends tokens on genuinely NEW images.
 */
@Injectable()
export class ImageAutopilotService {
  private readonly logger = new Logger(ImageAutopilotService.name);

  constructor(
    @InjectRepository(Site) private readonly siteRepo: Repository<Site>,
    private readonly imageService: ImageService,
    private readonly imageAiService: ImageAiService,
    private readonly imageSyncService: ImageSyncService,
  ) {}

  async runForSite(siteId: string): Promise<AltAutopilotResult> {
    const site = await this.siteRepo.findOne({ where: { id: siteId } });
    if (!site) throw new NotFoundException('Site not found');
    if (!site.wpApiKey) {
      throw new BadRequestException('No WP API key configured for this site.');
    }

    // 1+2. WP media inventory (detect new) + placement context from scraped pages.
    const recon = await this.imageService.reconcileSite(siteId);
    // 3. Grounded alt for everything still missing it (includes the new ones).
    const gen = await this.imageAiService.generateForMissing(siteId);
    // 4. Push the confident suggestions unattended; hold the risky ones.
    const apply = await this.imageSyncService.autoApplyConfident(siteId);

    const result: AltAutopilotResult = {
      siteId,
      newImages: recon.media.created,
      mediaFetched: recon.media.fetched,
      generated: gen.generated,
      autoApplied: apply.applied,
      heldForReview: apply.heldForReview,
      failed: gen.failed + apply.failed,
    };
    this.logger.log(
      `Alt autopilot ${site.url}: +${result.newImages} new image(s), ` +
        `generated ${result.generated}, auto-applied ${result.autoApplied}, ` +
        `held ${result.heldForReview}, failed ${result.failed}`,
    );
    return result;
  }

  /** Run the autopilot for every site that has a WP API key. Resilient per-site. */
  async runForAllSites(): Promise<void> {
    const sites = await this.siteRepo.find({ select: ['id', 'url', 'wpApiKey'] });
    for (const s of sites) {
      if (!s.wpApiKey) continue;
      try {
        await this.runForSite(s.id);
      } catch (err) {
        this.logger.warn(
          `Alt autopilot failed for ${s.url}: ${(err as Error).message}`,
        );
      }
    }
  }
}
