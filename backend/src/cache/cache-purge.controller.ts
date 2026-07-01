import { Controller, Post, Param } from '@nestjs/common';
import { CachePurgeService } from './cache-purge.service';

@Controller('sites')
export class CachePurgeController {
  constructor(private readonly cachePurge: CachePurgeService) {}

  /** Purge every applicable cache layer for a site (plugin → WP Engine → Cloudflare). */
  @Post(':id/purge-cache')
  purge(@Param('id') id: string) {
    return this.cachePurge.purgeAll(id);
  }
}
