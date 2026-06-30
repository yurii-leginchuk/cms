import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { McpChangeRequest } from './mcp-change-request.entity';
import { McpChangeService } from './mcp-change.service';
import { McpChangeController } from './mcp-change.controller';
import { Page } from '../pages/page.entity';
import { PageSchema } from '../schema/page-schema.entity';
import { SiteImage } from '../images/site-image.entity';
import { PagesModule } from '../pages/pages.module';
import { SyncModule } from '../sync/sync.module';
import { SchemaModule } from '../schema/schema.module';
import { ImageModule } from '../images/image.module';

/**
 * The human-approval gate. Reuses the existing module services (Pages, Sync,
 * Schema, Image) to apply + publish a proposal on accept.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([McpChangeRequest, Page, PageSchema, SiteImage]),
    PagesModule, // exports PagesService
    SyncModule, // exports SyncService
    SchemaModule, // exports SchemaService + SchemaSyncService
    ImageModule, // exports ImageService + ImageSyncService
  ],
  controllers: [McpChangeController],
  providers: [McpChangeService],
})
export class McpChangeModule {}
