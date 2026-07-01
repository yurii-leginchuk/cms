import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScraperService } from './scraper.service';
import { Site } from '../sites/site.entity';
import { Page } from '../pages/page.entity';
import { EmbeddingModule } from '../embedding/embedding.module';
import { SettingsModule } from '../settings/settings.module';
import { TokenUsageModule } from '../token-usage/token-usage.module';
import { CrawlModule } from '../crawl/crawl.module';

@Module({
  imports: [TypeOrmModule.forFeature([Site, Page]), EmbeddingModule, SettingsModule, TokenUsageModule, CrawlModule],
  providers: [ScraperService],
  exports: [ScraperService],
})
export class ScraperModule {}
