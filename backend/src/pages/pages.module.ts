import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Page } from './page.entity';
import { MetaHistory } from './meta-history.entity';
import { PagesService } from './pages.service';
import { PagesController } from './pages.controller';
import { SyncModule } from '../sync/sync.module';
import { AiModule } from '../ai/ai.module';
import { PromptsModule } from '../prompts/prompts.module';
import { Site } from '../sites/site.entity';
import { SiteBrief } from '../sites/site-brief.entity';
import { OptimizationEffectsModule } from '../optimization-effects/optimization-effects.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Page, MetaHistory, Site, SiteBrief]),
    SyncModule,
    AiModule,
    PromptsModule,
    OptimizationEffectsModule,
  ],
  controllers: [PagesController],
  providers: [PagesService],
})
export class PagesModule {}
