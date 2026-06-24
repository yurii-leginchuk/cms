import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Site } from './site.entity';
import { SiteBrief } from './site-brief.entity';
import { BrandCard } from './brand-card.entity';
import { Page } from '../pages/page.entity';
import { SitesService } from './sites.service';
import { BrandCardService } from './brand-card.service';
import { SitesController } from './sites.controller';
import { ScraperModule } from '../scraper/scraper.module';

@Module({
  imports: [TypeOrmModule.forFeature([Site, SiteBrief, BrandCard, Page]), ScraperModule],
  controllers: [SitesController],
  providers: [SitesService, BrandCardService],
  exports: [SitesService, BrandCardService, TypeOrmModule],
})
export class SiteModule {}
