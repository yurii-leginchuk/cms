import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { SchemaService } from './schema.service';
import { SchemaSyncService } from './schema-sync.service';

/** Site-level schema endpoints (not scoped to a single page). */
@Controller('sites/:siteId/schema')
export class SchemaSiteController {
  constructor(
    private readonly schemaService: SchemaService,
    private readonly schemaSyncService: SchemaSyncService,
  ) {}

  /** Aggregate structured-data coverage across the site's pages. */
  @Get('coverage')
  coverage(@Param('siteId') siteId: string) {
    return this.schemaService.coverage(siteId);
  }

  /** Detect schemas across every captured page of the site. */
  @Post('detect-all')
  @HttpCode(HttpStatus.OK)
  detectAll(@Param('siteId') siteId: string) {
    return this.schemaService.detectAll(siteId);
  }

  /** Per-URL schema overview for the dedicated Schemas page. */
  @Get('pages')
  pages(
    @Param('siteId') siteId: string,
    @Query('page') page = '1',
    @Query('limit') limit = '25',
    @Query('search') search = '',
  ) {
    return this.schemaService.pagesOverview(
      siteId,
      parseInt(page, 10),
      parseInt(limit, 10),
      search,
    );
  }

  /** Preview of all pending changes site-wide (for the Apply All modal). */
  @Get('pending-summary')
  pendingSummary(@Param('siteId') siteId: string) {
    return this.schemaSyncService.pendingSummary(siteId);
  }

  /** Apply every page that has pending changes (resilient to partial failure). */
  @Post('apply-all')
  @HttpCode(HttpStatus.OK)
  applyAll(@Param('siteId') siteId: string) {
    return this.schemaSyncService.publishAll(siteId);
  }
}
