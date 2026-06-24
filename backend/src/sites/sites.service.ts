import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { Site } from './site.entity';
import { SiteBrief } from './site-brief.entity';
import { CreateSiteDto } from './dto/create-site.dto';
import { UpdateSiteDto } from './dto/update-site.dto';
import { UpsertSiteBriefDto } from './dto/upsert-site-brief.dto';
import { ScraperService } from '../scraper/scraper.service';

@Injectable()
export class SitesService {
  constructor(
    @InjectRepository(Site)
    private readonly siteRepo: Repository<Site>,
    @InjectRepository(SiteBrief)
    private readonly briefRepo: Repository<SiteBrief>,
    private readonly scraperService: ScraperService,
  ) {}

  async findAll(): Promise<(Site & { pagesCount: number })[]> {
    const sites = await this.siteRepo
      .createQueryBuilder('site')
      .loadRelationCountAndMap('site.pagesCount', 'site.pages')
      .orderBy('site.createdAt', 'DESC')
      .getMany();

    return sites as (Site & { pagesCount: number })[];
  }

  async findOne(id: string): Promise<Site & { pagesCount: number }> {
    const site = await this.siteRepo
      .createQueryBuilder('site')
      .loadRelationCountAndMap('site.pagesCount', 'site.pages')
      .where('site.id = :id', { id })
      .getOne();

    if (!site) throw new NotFoundException(`Site ${id} not found`);
    return site as Site & { pagesCount: number };
  }

  async create(dto: CreateSiteDto): Promise<Site> {
    const site = this.siteRepo.create(dto);
    const saved = await this.siteRepo.save(site);
    // Fire-and-forget: start parsing immediately after creation
    this.scraperService.parseSite(saved.id);
    return saved;
  }

  async update(id: string, dto: UpdateSiteDto): Promise<Site> {
    const site = await this.siteRepo.findOne({ where: { id } });
    if (!site) throw new NotFoundException(`Site ${id} not found`);
    Object.assign(site, dto);
    return this.siteRepo.save(site);
  }

  async remove(id: string): Promise<void> {
    const site = await this.siteRepo.findOne({ where: { id } });
    if (!site) throw new NotFoundException(`Site ${id} not found`);
    await this.siteRepo.remove(site);
  }

  async triggerParse(id: string): Promise<void> {
    const site = await this.siteRepo.findOne({ where: { id } });
    if (!site) throw new NotFoundException(`Site ${id} not found`);
    this.scraperService.parseSite(id);
  }

  async getBrief(siteId: string): Promise<SiteBrief | null> {
    return this.briefRepo.findOne({ where: { siteId } });
  }

  async upsertBrief(siteId: string, dto: UpsertSiteBriefDto): Promise<SiteBrief> {
    const existing = await this.briefRepo.findOne({ where: { siteId } });
    if (existing) {
      Object.assign(existing, dto);
      return this.briefRepo.save(existing);
    }
    return this.briefRepo.save(this.briefRepo.create({ siteId, ...dto }));
  }

  async checkWpStatus(id: string): Promise<{ connected: boolean; reason?: string }> {
    const site = await this.siteRepo.findOne({ where: { id } });
    if (!site) throw new NotFoundException(`Site ${id} not found`);

    if (!site.wpApiKey) {
      return { connected: false, reason: 'no_key' };
    }

    try {
      await axios.get(`${site.url}/wp-json/poirier-cms/v1/ping`, {
        headers: { 'X-Poirier-API-Key': site.wpApiKey },
        timeout: 6_000,
      });
      return { connected: true };
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : null;
      if (status === 401) return { connected: false, reason: 'invalid_key' };
      if (status === 404) return { connected: false, reason: 'plugin_not_found' };
      return { connected: false, reason: 'unreachable' };
    }
  }
}
