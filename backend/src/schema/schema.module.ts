import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Page } from '../pages/page.entity';
import { Site } from '../sites/site.entity';
import { BrandCard } from '../sites/brand-card.entity';
import { SiteBrief } from '../sites/site-brief.entity';
import { PageSchema } from './page-schema.entity';
import { SchemaHistory } from './schema-history.entity';
import { SchemaService } from './schema.service';
import { SchemaAiService } from './schema-ai.service';
import { SchemaSyncService } from './schema-sync.service';
import { SchemaQcService } from './schema-qc.service';
import { SchemaController } from './schema.controller';
import { SchemaSiteController } from './schema-site.controller';
import { SettingsModule } from '../settings/settings.module';
import { TokenUsageModule } from '../token-usage/token-usage.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Page,
      PageSchema,
      SchemaHistory,
      Site,
      BrandCard,
      SiteBrief,
    ]),
    SettingsModule,
    TokenUsageModule,
  ],
  controllers: [SchemaController, SchemaSiteController],
  providers: [SchemaService, SchemaAiService, SchemaSyncService, SchemaQcService],
  // Export the schema services so the agent module can wrap them in schema-tools.
  exports: [SchemaService, SchemaAiService, SchemaSyncService, SchemaQcService],
})
export class SchemaModule {}
