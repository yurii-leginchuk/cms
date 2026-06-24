import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  SchemaService,
  CreateManagedInput,
  UpdateManagedInput,
} from './schema.service';
import { SchemaAiService } from './schema-ai.service';
import { SchemaSyncService } from './schema-sync.service';
import { SchemaQcService } from './schema-qc.service';

@Controller('sites/:siteId/pages/:pageId/schemas')
export class SchemaController {
  constructor(
    private readonly schemaService: SchemaService,
    private readonly schemaAiService: SchemaAiService,
    private readonly schemaSyncService: SchemaSyncService,
    private readonly schemaQcService: SchemaQcService,
  ) {}

  /** Last persisted detection result for the page (no re-run). */
  @Get()
  get(@Param('pageId') pageId: string) {
    return this.schemaService.getForPage(pageId);
  }

  /** Re-detect + validate JSON-LD from the page's stored HTML. */
  @Post('detect')
  @HttpCode(HttpStatus.OK)
  detect(@Param('pageId') pageId: string) {
    return this.schemaService.detectForPage(pageId);
  }

  /** AI: propose new schema, fix invalid schema, flag data drift (grounded). */
  @Post('analyze')
  @HttpCode(HttpStatus.OK)
  analyze(
    @Param('siteId') siteId: string,
    @Param('pageId') pageId: string,
  ) {
    return this.schemaAiService.analyze(siteId, pageId);
  }

  /** Live validation for the editor. */
  @Post('validate')
  @HttpCode(HttpStatus.OK)
  validate(@Body() body: { jsonld: unknown }) {
    return this.schemaService.validate(body?.jsonld);
  }

  // ── Managed schemas ─────────────────────────────────────────────────────────

  @Get('managed')
  listManaged(@Param('pageId') pageId: string) {
    return this.schemaService.listManaged(pageId);
  }

  @Post('managed')
  createManaged(
    @Param('siteId') siteId: string,
    @Param('pageId') pageId: string,
    @Body() body: CreateManagedInput,
  ) {
    return this.schemaService.createManaged(siteId, pageId, body);
  }

  @Put('managed/:schemaId')
  updateManaged(
    @Param('schemaId') schemaId: string,
    @Body() body: UpdateManagedInput,
  ) {
    return this.schemaService.updateManaged(schemaId, body);
  }

  @Delete('managed/:schemaId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeManaged(@Param('schemaId') schemaId: string) {
    return this.schemaService.removeManaged(schemaId);
  }

  /** Number of managed rows awaiting Apply (added / edited / deleted). */
  @Get('pending')
  pending(@Param('pageId') pageId: string) {
    return this.schemaService.pendingChanges(pageId);
  }

  // ── Apply changes to WordPress ───────────────────────────────────────────────

  /** Push the current managed set to WP (apply all pending changes). */
  @Post('apply')
  @HttpCode(HttpStatus.OK)
  apply(@Param('siteId') siteId: string, @Param('pageId') pageId: string) {
    return this.schemaSyncService.publish(siteId, pageId);
  }

  @Post('unpublish')
  @HttpCode(HttpStatus.OK)
  unpublish(
    @Param('siteId') siteId: string,
    @Param('pageId') pageId: string,
  ) {
    return this.schemaSyncService.unpublish(siteId, pageId);
  }

  @Get('history')
  history(@Param('pageId') pageId: string) {
    return this.schemaSyncService.getHistory(pageId);
  }

  /** QC: reconcile managed ↔ plugin-stored ↔ live-rendered. */
  @Post('qc')
  @HttpCode(HttpStatus.OK)
  qc(@Param('siteId') siteId: string, @Param('pageId') pageId: string) {
    return this.schemaQcService.qc(siteId, pageId);
  }

  /** Re-fetch the live page and re-detect (after publishing / external edits). */
  @Post('reparse')
  @HttpCode(HttpStatus.OK)
  reparse(@Param('pageId') pageId: string) {
    return this.schemaService.reparse(pageId);
  }
}
