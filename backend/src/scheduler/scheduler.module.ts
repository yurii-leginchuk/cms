import { Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { ScraperModule } from '../scraper/scraper.module';
import { ImageModule } from '../images/image.module';

@Module({
  imports: [ScraperModule, ImageModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
