import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GscModule } from '../gsc/gsc.module';
import { GscDaily } from './gsc-daily.entity';
import { ImpactAnnotation } from './impact-annotation.entity';
import { WatchedKeyword } from './watched-keyword.entity';
import { KeywordDaily } from './keyword-daily.entity';
import { MetaHistory } from '../pages/meta-history.entity';
import { Page } from '../pages/page.entity';
import { SchemaHistory } from '../schema/schema-history.entity';
import { OptimizationEffect } from '../optimization-effects/optimization-effect.entity';
import { BrandCard } from '../sites/brand-card.entity';
import { ChangeEventsService } from './change-events.service';
import { ImpactSeriesService } from './impact-series.service';
import { ImpactQueryService } from './impact-query.service';
import { WatchedKeywordsService } from './watched-keywords.service';
import { CannibalizationService } from './cannibalization.service';
import { ImpactAnnotationsService } from './impact-annotations.service';
import { ImpactController } from './impact.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      GscDaily, ImpactAnnotation, WatchedKeyword, KeywordDaily, MetaHistory, Page, SchemaHistory, OptimizationEffect, BrandCard,
    ]),
    GscModule,
  ],
  controllers: [ImpactController],
  providers: [
    ChangeEventsService, ImpactSeriesService, ImpactQueryService,
    WatchedKeywordsService, CannibalizationService, ImpactAnnotationsService,
  ],
  exports: [ChangeEventsService, ImpactSeriesService],
})
export class ImpactModule {}
