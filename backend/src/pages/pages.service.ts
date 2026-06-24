import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as cheerio from 'cheerio';
import { Page } from './page.entity';
import { MetaHistory } from './meta-history.entity';
import { UpdatePageMetaDto } from './dto/update-page-meta.dto';
import { SyncService } from '../sync/sync.service';
import { AiService, GenerateMetaResult } from '../ai/ai.service';
import { PromptsService } from '../prompts/prompts.service';
import { Site } from '../sites/site.entity';
import { SiteBrief } from '../sites/site-brief.entity';
import { OptimizationEffectsService } from '../optimization-effects/optimization-effects.service';

@Injectable()
export class PagesService {
  constructor(
    @InjectRepository(Page)
    private readonly pageRepo: Repository<Page>,
    @InjectRepository(MetaHistory)
    private readonly historyRepo: Repository<MetaHistory>,
    @InjectRepository(Site)
    private readonly siteRepo: Repository<Site>,
    @InjectRepository(SiteBrief)
    private readonly briefRepo: Repository<SiteBrief>,
    private readonly syncService: SyncService,
    private readonly aiService: AiService,
    private readonly promptsService: PromptsService,
    private readonly optimizationEffectsService: OptimizationEffectsService,
  ) {}

  async findBySite(
    siteId: string,
    page = 1,
    limit = 50,
    search = '',
    sort = 'url_asc',
  ): Promise<{ data: Page[]; meta: { total: number; page: number; limit: number; totalPages: number } }> {
    const qb = this.pageRepo
      .createQueryBuilder('page')
      .where('page.siteId = :siteId', { siteId });

    if (search) {
      qb.andWhere('page.url ILIKE :search', { search: `%${search}%` });
    }

    switch (sort) {
      case 'transactional_first':
        qb.orderBy('page.isTransactional', 'DESC').addOrderBy('page.url', 'ASC');
        break;
      case 'custom_first':
        qb.orderBy('CASE WHEN page.customMetaTitle IS NOT NULL OR page."customMetaDescription" IS NOT NULL THEN 0 ELSE 1 END', 'ASC')
          .addOrderBy('page.url', 'ASC');
        break;
      case 'modified_desc':
        qb.orderBy('page.updatedAt', 'DESC');
        break;
      default:
        qb.orderBy('page.url', 'ASC');
    }

    const total = await qb.getCount();
    const data = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string): Promise<Page> {
    const page = await this.pageRepo.findOne({ where: { id } });
    if (!page) throw new NotFoundException(`Page ${id} not found`);
    return page;
  }

  /** Single page without the heavy rawHtml column — used for the proposal БЫЛО/СТАЛО diff. */
  async findOneLite(id: string): Promise<Partial<Page>> {
    const page = await this.pageRepo.findOne({
      where: { id },
      select: [
        'id', 'url', 'metaTitle', 'customMetaTitle', 'metaDescription',
        'customMetaDescription', 'cleanContent', 'h1Text', 'noindex', 'canonical',
        'isTransactional', 'syncStatus', 'lastScrapedAt',
      ],
    });
    if (!page) throw new NotFoundException(`Page ${id} not found`);
    return page;
  }

  async updateMeta(id: string, dto: UpdatePageMetaDto): Promise<Page> {
    const page = await this.findOne(id);

    const entries: Partial<MetaHistory>[] = [];

    if (
      dto.customMetaTitle !== undefined &&
      dto.customMetaTitle !== page.customMetaTitle
    ) {
      entries.push({
        pageId: page.id,
        field: 'title',
        oldValue: page.customMetaTitle,
        newValue: dto.customMetaTitle || null,
      });
    }

    if (
      dto.customMetaDescription !== undefined &&
      dto.customMetaDescription !== page.customMetaDescription
    ) {
      entries.push({
        pageId: page.id,
        field: 'description',
        oldValue: page.customMetaDescription,
        newValue: dto.customMetaDescription || null,
      });
    }

    if (dto.noindex !== undefined && dto.noindex !== page.noindex) {
      entries.push({
        pageId: page.id,
        field: 'noindex',
        oldValue: String(page.noindex),
        newValue: String(dto.noindex),
      });
    }

    if (dto.canonical !== undefined && dto.canonical !== page.canonical) {
      entries.push({
        pageId: page.id,
        field: 'canonical',
        oldValue: page.canonical,
        newValue: dto.canonical || null,
      });
    }

    if (entries.length > 0) {
      await this.historyRepo.save(entries.map((e) => this.historyRepo.create(e)));
    }

    const metaChanged =
      (dto.customMetaTitle !== undefined && dto.customMetaTitle !== page.customMetaTitle) ||
      (dto.customMetaDescription !== undefined &&
        dto.customMetaDescription !== page.customMetaDescription);

    Object.assign(page, {
      customMetaTitle: dto.customMetaTitle ?? page.customMetaTitle,
      customMetaDescription: dto.customMetaDescription ?? page.customMetaDescription,
      ...(dto.isTransactional !== undefined && { isTransactional: dto.isTransactional }),
      ...(dto.noindex !== undefined && { noindex: dto.noindex }),
      canonical: dto.canonical !== undefined ? (dto.canonical || null) : page.canonical,
    });
    const saved = await this.pageRepo.save(page);

    // Enqueue a sync job whenever meta content actually changed (skip when caller opts out)
    if (metaChanged && !dto.skipSync) {
      await this.syncService.enqueue(page.siteId, page.id);
    }

    // Snapshot pre-change GSC performance so we can measure the effect later.
    // Fire-and-forget — never block or fail the meta update on this.
    if (metaChanged) {
      const changedFields =
        entries
          .filter((e) => e.field === 'title' || e.field === 'description')
          .map((e) => e.field)
          .join(' + ') || 'meta';
      this.optimizationEffectsService
        .captureBaseline(page.siteId, page.id, page.url, changedFields)
        .catch(() => {/* non-critical */});
    }

    return saved;
  }

  async findHistory(pageId: string): Promise<MetaHistory[]> {
    return this.historyRepo.find({
      where: { pageId },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }

  async generateMeta(
    siteId: string,
    pageId: string,
    promptSlug = 'meta_generator',
  ): Promise<GenerateMetaResult> {
    const page = await this.pageRepo.findOne({ where: { id: pageId, siteId } });
    if (!page) throw new NotFoundException(`Page ${pageId} not found`);

    const site = await this.siteRepo.findOne({ where: { id: siteId } });
    if (!site) throw new NotFoundException(`Site ${siteId} not found`);

    const prompt = await this.promptsService.findEffective(promptSlug, siteId);
    const brief = await this.briefRepo.findOne({ where: { siteId } });

    let cleanContent = page.cleanContent;
    if (!cleanContent && page.rawHtml) {
      const $ = cheerio.load(page.rawHtml);
      $('script, style, noscript, iframe, svg, head, nav, footer, header, aside').remove();
      cleanContent = $('body').text().replace(/\s+/g, ' ').trim();
    }

    return this.aiService.generateMeta(
      {
        url: page.url,
        cleanContent: cleanContent ?? '',
        metaTitle: page.metaTitle,
        metaDescription: page.metaDescription,
      },
      {
        name: site.name,
        url: site.url,
      },
      prompt.content,
      prompt.model,
      siteId,
      brief ?? undefined,
    );
  }
}
