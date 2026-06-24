import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ImageService } from './image.service';
import { ImageAiService } from './image-ai.service';
import { ImageSyncService } from './image-sync.service';

/** Site-level image library endpoints. */
@Controller('sites/:siteId/images')
export class ImageSiteController {
  constructor(
    private readonly imageService: ImageService,
    private readonly imageAiService: ImageAiService,
    private readonly imageSyncService: ImageSyncService,
  ) {}

  /** Paginated, filterable image library (the dedicated Images page). */
  @Get()
  list(
    @Param('siteId') siteId: string,
    @Query('page') page = '1',
    @Query('limit') limit = '25',
    @Query('missingOnly') missingOnly = 'false',
    @Query('search') search = '',
  ) {
    return this.imageService.list(siteId, {
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      missingOnly: missingOnly === 'true',
      search: search || undefined,
    });
  }

  /** Honest coverage (per-image worst-case + per-placement) with freshness. */
  @Get('coverage')
  coverage(@Param('siteId') siteId: string) {
    return this.imageService.coverage(siteId);
  }

  /** Re-derive the library from every scraped page (after a parse). */
  @Post('reconcile')
  @HttpCode(HttpStatus.OK)
  reconcile(@Param('siteId') siteId: string) {
    return this.imageService.reconcileSite(siteId);
  }

  /** Generate grounded AI alt for every image still missing alt. */
  @Post('generate-missing')
  @HttpCode(HttpStatus.OK)
  generateMissing(@Param('siteId') siteId: string) {
    return this.imageAiService.generateForMissing(siteId);
  }

  /** Preview of pending changes for the Apply-All dialog. */
  @Get('pending-summary')
  pendingSummary(@Param('siteId') siteId: string) {
    return this.imageSyncService.pendingSummary(siteId);
  }

  /**
   * Apply pending alt changes to WordPress. Excludes `ai_suggested` (unreviewed)
   * rows unless `includeUnreviewed` is explicitly true (the deliberate gate).
   */
  @Post('apply-all')
  @HttpCode(HttpStatus.OK)
  applyAll(
    @Param('siteId') siteId: string,
    @Body() body: { includeUnreviewed?: boolean } = {},
  ) {
    return this.imageSyncService.applyAll(siteId, !!body.includeUnreviewed);
  }
}

/** Per-image endpoints. */
@Controller('sites/:siteId/images/:imageId')
export class ImageController {
  constructor(
    private readonly imageService: ImageService,
    private readonly imageAiService: ImageAiService,
    private readonly imageSyncService: ImageSyncService,
  ) {}

  /** Generate one grounded AI alt suggestion (→ ai_suggested, needs review). */
  @Post('generate')
  @HttpCode(HttpStatus.OK)
  generate(@Param('siteId') siteId: string, @Param('imageId') imageId: string) {
    return this.imageAiService.generateForImage(siteId, imageId);
  }

  /** Human edit / set the alt (→ modified, appliable). */
  @Put('alt')
  setAlt(
    @Param('imageId') imageId: string,
    @Body() body: { alt: string; decorative?: boolean },
  ) {
    return this.imageService.setAlt(imageId, body.alt ?? '', {
      decorative: body.decorative,
    });
  }

  @Post('decorative')
  @HttpCode(HttpStatus.OK)
  decorative(
    @Param('imageId') imageId: string,
    @Body() body: { decorative: boolean },
  ) {
    return this.imageService.markDecorative(imageId, body.decorative);
  }

  /** Approve an AI suggestion as-is. */
  @Post('approve')
  @HttpCode(HttpStatus.OK)
  approve(@Param('imageId') imageId: string) {
    return this.imageService.approve(imageId);
  }

  /** Discard the pending change. */
  @Post('revert')
  @HttpCode(HttpStatus.OK)
  revert(@Param('imageId') imageId: string) {
    return this.imageService.revert(imageId);
  }

  /** Apply just this image's alt to WordPress. */
  @Post('apply')
  @HttpCode(HttpStatus.OK)
  apply(@Param('siteId') siteId: string, @Param('imageId') imageId: string) {
    return this.imageSyncService.applyOne(siteId, imageId);
  }
}
