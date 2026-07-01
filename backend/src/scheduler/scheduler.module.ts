import { Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { ScraperModule } from '../scraper/scraper.module';
import { ImageModule } from '../images/image.module';
import { OptimizationModule } from '../optimization/optimization.module';

@Module({
  imports: [ScraperModule, ImageModule, OptimizationModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
