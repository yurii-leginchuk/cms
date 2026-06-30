import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { McpChangeService, CreateChangeInput } from './mcp-change.service';
import { McpChangeModule } from './mcp-change-request.entity';

/**
 * Human-approval gate for MCP-originated changes. The MCP server POSTs proposals
 * here (they stage as PENDING); a human accepts (apply + publish) or rejects.
 */
@Controller('sites/:siteId/changes')
export class McpChangeController {
  constructor(private readonly service: McpChangeService) {}

  /** Create a PENDING proposal — called by the MCP server. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param('siteId') siteId: string,
    @Body() body: Omit<CreateChangeInput, 'siteId'>,
  ) {
    return this.service.create({ ...body, siteId });
  }

  /** List proposals (default all statuses; filterable). */
  @Get()
  list(
    @Param('siteId') siteId: string,
    @Query('module') module?: McpChangeModule,
    @Query('status') status?: string,
  ) {
    return this.service.list(siteId, { module, status });
  }

  /** Per-module pending counts for badges (single source of truth). */
  @Get('counts')
  counts(@Param('siteId') siteId: string) {
    return this.service.counts(siteId);
  }

  @Post('accept-all')
  @HttpCode(HttpStatus.OK)
  acceptAll(
    @Param('siteId') siteId: string,
    @Query('module') module?: McpChangeModule,
  ) {
    return this.service.acceptAll(siteId, module);
  }

  @Post('reject-all')
  @HttpCode(HttpStatus.OK)
  rejectAll(
    @Param('siteId') siteId: string,
    @Query('module') module?: McpChangeModule,
  ) {
    return this.service.rejectAll(siteId, module);
  }

  /** Accept = apply the change to the module AND publish to WordPress. */
  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  accept(@Param('id') id: string) {
    return this.service.accept(id);
  }

  /** Reject = discard the proposal. */
  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  reject(@Param('id') id: string) {
    return this.service.reject(id);
  }
}
