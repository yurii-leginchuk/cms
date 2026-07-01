import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatSession } from './chat-session.entity';
import { ChatMessage } from './chat-message.entity';
import { Site } from '../sites/site.entity';
import { SiteBrief } from '../sites/site-brief.entity';
import { BrandCard } from '../sites/brand-card.entity';
import { Page } from '../pages/page.entity';
import { PageSpeedResult } from '../pagespeed/page-speed-result.entity';
import { AgentService } from './agent.service';
import { AgentController } from './agent.controller';
import { SettingsModule } from '../settings/settings.module';
import { TokenUsageModule } from '../token-usage/token-usage.module';
import { EmbeddingModule } from '../embedding/embedding.module';
import { GscModule } from '../gsc/gsc.module';
import { SchemaModule } from '../schema/schema.module';
import { Ga4Module } from '../ga4/ga4.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ChatSession, ChatMessage, Site, SiteBrief, BrandCard, Page, PageSpeedResult]),
    SettingsModule,
    TokenUsageModule,
    EmbeddingModule,
    GscModule,
    Ga4Module, // provides Ga4Service for ga4-tools
    // Provides SchemaService/SchemaAiService/SchemaSyncService/SchemaQcService for schema-tools.
    SchemaModule,
  ],
  controllers: [AgentController],
  providers: [AgentService],
  exports: [AgentService],
})
export class AgentModule {}
