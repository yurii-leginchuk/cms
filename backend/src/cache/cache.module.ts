import { Module } from '@nestjs/common';
import { SiteModule } from '../sites/site.module';
import { OptimizationModule } from '../optimization/optimization.module';
import { CachePurgeService } from './cache-purge.service';
import { CachePurgeController } from './cache-purge.controller';

/**
 * "Purge cache everywhere" — one endpoint that clears every caching layer a site
 * uses (WordPress plugin → WP Engine → Cloudflare), reusing the Site repository
 * (SiteModule) and the encrypted Cloudflare credentials + CF API client
 * (OptimizationModule). No new credential storage.
 */
@Module({
  imports: [SiteModule, OptimizationModule],
  controllers: [CachePurgeController],
  providers: [CachePurgeService],
})
export class CacheModule {}
