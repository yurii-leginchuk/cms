import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { databaseConfig } from './config/database.config';
import { SiteModule } from './sites/site.module';
import { PagesModule } from './pages/pages.module';
import { ScraperModule } from './scraper/scraper.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { SyncModule } from './sync/sync.module';
import { SettingsModule } from './settings/settings.module';
import { PromptsModule } from './prompts/prompts.module';
import { AiModule } from './ai/ai.module';
import { AgentModule } from './agent/agent.module';
import { TokenUsageModule } from './token-usage/token-usage.module';
import { EmbeddingModule } from './embedding/embedding.module';
import { GscModule } from './gsc/gsc.module';
import { PageSpeedModule } from './pagespeed/page-speed.module';
import { CruxModule } from './crux/crux.module';
import { OptimizationEffectsModule } from './optimization-effects/optimization-effects.module';
import { SchemaModule } from './schema/schema.module';
import { ImageModule } from './images/image.module';
import { OptimizationModule } from './optimization/optimization.module';
import { ImpactModule } from './impact/impact.module';
import { McpChangeModule } from './mcp-changes/mcp-change.module';
import { CrawlModule } from './crawl/crawl.module';
import { AsanaModule } from './asana/asana.module';
import { Ga4Module } from './ga4/ga4.module';
import { CacheModule } from './cache/cache.module';
import { RedirectModule } from './redirect/redirect.module';
import { ApiKeyGuard } from './common/guards/api-key.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync(databaseConfig),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
        },
      }),
    }),
    ScheduleModule.forRoot(),
    SiteModule,
    PagesModule,
    ScraperModule,
    SchedulerModule,
    SyncModule,
    SettingsModule,
    PromptsModule,
    AiModule,
    AgentModule,
    TokenUsageModule,
    EmbeddingModule,
    GscModule,
    PageSpeedModule,
    CruxModule,
    OptimizationEffectsModule,
    SchemaModule,
    ImageModule,
    OptimizationModule,
    ImpactModule,
    McpChangeModule,
    CrawlModule,
    AsanaModule,
    Ga4Module,
    CacheModule,
    RedirectModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ApiKeyGuard }],
})
export class AppModule {}
