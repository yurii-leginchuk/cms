import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ScraperService } from '../scraper/scraper.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(private readonly scraperService: ScraperService) {}

  // Every day at 2:00 AM
  @Cron('0 2 * * *')
  async handleNightlyParse() {
    this.logger.log('Nightly parse triggered');
    await this.scraperService.parseAllSites();
  }
}
