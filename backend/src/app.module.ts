import { Module } from '@nestjs/common';
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
import { ImpactModule } from './impact/impact.module';

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
    ImpactModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
