import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as cheerio from 'cheerio';
import { Page, IndexDirective } from './page.entity';
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
        'customMetaDescription', 'cleanContent', 'h1Text', 'noindex',
        'indexDirective', 'nofollow', 'canonical',
        'ogTitle', 'ogDescription', 'ogImage', 'ogImageId',
        'isTransactional', 'syncStatus', 'syncError', 'syncAppliedAt',
        'lastScrapedAt',
      ],
    });
    if (!page) throw new NotFoundException(`Page ${id} not found`);
    return page;
  }

  async updateMeta(id: string, dto: UpdatePageMetaDto): Promise<Page> {
    const page = await this.findOne(id);

    const entries: Partial<MetaHistory>[] = [];

    // ── Resolve the robots index tri-state. indexDirective wins; the legacy
    //    boolean `noindex` is accepted (agent/chat) and mirrored both ways. ──
    let nextDirective = page.indexDirective;
    if (dto.indexDirective !== undefined) {
      nextDirective = dto.indexDirective;
    } else if (dto.noindex !== undefined) {
      nextDirective = dto.noindex
        ? IndexDirective.NOINDEX
        : IndexDirective.DEFAULT;
    }
    const nextNoindex = nextDirective === IndexDirective.NOINDEX;

    const pushString = (v: string | null | undefined) => (v ? v : null);

    if (
      dto.customMetaTitle !== undefined &&
      (dto.customMetaTitle || null) !== page.customMetaTitle
    ) {
      entries.push({
        pageId: page.id,
        field: 'title',
        oldValue: page.customMetaTitle,
        newValue: pushString(dto.customMetaTitle),
      });
    }

    if (
      dto.customMetaDescription !== undefined &&
      (dto.customMetaDescription || null) !== page.customMetaDescription
    ) {
      entries.push({
        pageId: page.id,
        field: 'description',
        oldValue: page.customMetaDescription,
        newValue: pushString(dto.customMetaDescription),
      });
    }

    if (nextDirective !== page.indexDirective) {
      entries.push({
        pageId: page.id,
        field: 'noindex',
        oldValue: page.indexDirective,
        newValue: nextDirective,
      });
    }

    if (dto.nofollow !== undefined && dto.nofollow !== page.nofollow) {
      entries.push({
        pageId: page.id,
        field: 'nofollow',
        oldValue: String(page.nofollow),
        newValue: String(dto.nofollow),
      });
    }

    if (dto.canonical !== undefined && (dto.canonical || null) !== page.canonical) {
      entries.push({
        pageId: page.id,
        field: 'canonical',
        oldValue: page.canonical,
        newValue: pushString(dto.canonical),
      });
    }

    if (dto.ogTitle !== undefined && (dto.ogTitle || null) !== page.ogTitle) {
      entries.push({
        pageId: page.id,
        field: 'ogTitle',
        oldValue: page.ogTitle,
        newValue: pushString(dto.ogTitle),
      });
    }

    if (
      dto.ogDescription !== undefined &&
      (dto.ogDescription || null) !== page.ogDescription
    ) {
      entries.push({
        pageId: page.id,
        field: 'ogDescription',
        oldValue: page.ogDescription,
        newValue: pushString(dto.ogDescription),
      });
    }

    if (dto.ogImage !== undefined && (dto.ogImage || null) !== page.ogImage) {
      entries.push({
        pageId: page.id,
        field: 'ogImage',
        oldValue: page.ogImage,
        newValue: pushString(dto.ogImage),
      });
    }

    if (entries.length > 0) {
      await this.historyRepo.save(entries.map((e) => this.historyRepo.create(e)));
    }

    const metaChanged =
      (dto.customMetaTitle !== undefined &&
        (dto.customMetaTitle || null) !== page.customMetaTitle) ||
      (dto.customMetaDescription !== undefined &&
        (dto.customMetaDescription || null) !== page.customMetaDescription);

    // Any field that gets pushed to WordPress should trigger a sync, not just
    // the title/description content.
    const pushableChanged =
      metaChanged ||
      nextDirective !== page.indexDirective ||
      (dto.nofollow !== undefined && dto.nofollow !== page.nofollow) ||
      (dto.canonical !== undefined && (dto.canonical || null) !== page.canonical) ||
      (dto.ogTitle !== undefined && (dto.ogTitle || null) !== page.ogTitle) ||
      (dto.ogDescription !== undefined &&
        (dto.ogDescription || null) !== page.ogDescription) ||
      (dto.ogImage !== undefined && (dto.ogImage || null) !== page.ogImage) ||
      (dto.ogImageId !== undefined && (dto.ogImageId ?? null) !== page.ogImageId);

    Object.assign(page, {
      // Explicit tri-state like canonical/OG below: undefined = untouched,
      // null/'' = clear the override, string = set it. `??` here would make
      // clearing impossible (the editor sends null to reset to the scraped meta).
      customMetaTitle:
        dto.customMetaTitle !== undefined
          ? (dto.customMetaTitle || null)
          : page.customMetaTitle,
      customMetaDescription:
        dto.customMetaDescription !== undefined
          ? (dto.customMetaDescription || null)
          : page.customMetaDescription,
      ...(dto.isTransactional !== undefined && { isTransactional: dto.isTransactional }),
      indexDirective: nextDirective,
      noindex: nextNoindex,
      ...(dto.nofollow !== undefined && { nofollow: dto.nofollow }),
      canonical: dto.canonical !== undefined ? (dto.canonical || null) : page.canonical,
      ogTitle: dto.ogTitle !== undefined ? (dto.ogTitle || null) : page.ogTitle,
      ogDescription:
        dto.ogDescription !== undefined ? (dto.ogDescription || null) : page.ogDescription,
      ogImage: dto.ogImage !== undefined ? (dto.ogImage || null) : page.ogImage,
      ogImageId: dto.ogImageId !== undefined ? (dto.ogImageId ?? null) : page.ogImageId,
    });
    const saved = await this.pageRepo.save(page);

    // Enqueue a sync job whenever a WP-pushable field changed (skip when caller opts out)
    if (pushableChanged && !dto.skipSync) {
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
