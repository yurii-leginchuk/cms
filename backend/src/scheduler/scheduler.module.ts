import { Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { ScraperModule } from '../scraper/scraper.module';

@Module({
  imports: [ScraperModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
