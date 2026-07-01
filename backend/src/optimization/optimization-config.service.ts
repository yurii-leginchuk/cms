import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Site } from '../sites/site.entity';
import { SiteOptimizationConfig } from './site-optimization-config.entity';
import { UpdateOptimizationConfigDto } from './dto/update-optimization-config.dto';

/**
 * Per-site optimization config. Auto-creates a default row on first access so
 * the tab always has something to render. PHASE 1 exposes only the local
 * processing knobs; PHASE 2 credential fields (encrypted, never returned) will
 * attach to the same entity.
 */
@Injectable()
export class OptimizationConfigService {
  constructor(
    @InjectRepository(SiteOptimizationConfig)
    private readonly configRepo: Repository<SiteOptimizationConfig>,
    @InjectRepository(Site)
    private readonly siteRepo: Repository<Site>,
  ) {}

  async getOrCreate(siteId: string): Promise<SiteOptimizationConfig> {
    const existing = await this.configRepo.findOne({ where: { siteId } });
    if (existing) return existing;

    const site = await this.siteRepo.findOne({ where: { id: siteId } });
    if (!site) throw new NotFoundException('Site not found');

    return this.configRepo.save(this.configRepo.create({ siteId }));
  }

  async update(
    siteId: string,
    dto: UpdateOptimizationConfigDto,
  ): Promise<SiteOptimizationConfig> {
    const config = await this.getOrCreate(siteId);
    if (dto.enabled !== undefined) config.enabled = dto.enabled;
    if (dto.webpEnabled !== undefined) config.webpEnabled = dto.webpEnabled;
    if (dto.quality !== undefined) config.quality = dto.quality;
    if (dto.maxWidth !== undefined) config.maxWidth = dto.maxWidth;
    return this.configRepo.save(config);
  }
}
