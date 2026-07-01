import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ScraperService } from '../scraper/scraper.service';
import { ImageAutopilotService } from '../images/image-autopilot.service';
import { OptimizationAutopilotService } from '../optimization/optimization-autopilot.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly scraperService: ScraperService,
    private readonly imageAutopilotService: ImageAutopilotService,
    private readonly optimizationAutopilotService: OptimizationAutopilotService,
  ) {}

  // Every day at 2:00 AM
  @Cron('0 2 * * *')
  async handleNightlyParse() {
    this.logger.log('Nightly parse triggered');
    await this.scraperService.parseAllSites();
  }

  // Every day at 3:00 AM — after the nightly parse refreshes page context.
  // Detects new media-library images, generates grounded alt, and auto-applies
  // the confident ones to WordPress with no review.
  @Cron('0 3 * * *')
  async handleNightlyAltAutopilot() {
    this.logger.log('Nightly ALT autopilot triggered');
    await this.imageAutopilotService.runForAllSites();
  }

  // Every day at 4:00 AM — after ALT autopilot. Optimizes only NEW images
  // (new_only), uploads to R2, and publishes new CDN mappings if rewrite is on.
  @Cron('0 4 * * *')
  async handleNightlyOptimizeAutopilot() {
    this.logger.log('Nightly optimize autopilot triggered');
    await this.optimizationAutopilotService.runForAllSites();
  }
}
