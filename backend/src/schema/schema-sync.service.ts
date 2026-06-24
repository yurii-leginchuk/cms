import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import axios from 'axios';
import { Page } from '../pages/page.entity';
import { Site } from '../sites/site.entity';
import { PageSchema, PageSchemaStatus } from './page-schema.entity';
import { SchemaHistory } from './schema-history.entity';
import { SchemaService } from './schema.service';

export interface PublishResult {
  published: number;
  at: string;
  /** Whether the post-publish auto re-parse refreshed live detection. */
  reparsed: boolean;
}

/** What a single pending change will do once applied. */
export type PendingAction = 'add' | 'edit' | 'remove';

export interface PendingSummaryItem {
  schemaId: string;
  type: string;
  action: PendingAction;
  source: string;
  validationStatus: string;
}

export interface PendingSummaryPage {
  pageId: string;
  url: string;
  items: PendingSummaryItem[];
}

export interface PendingSummary {
  totalPages: number;
  totalChanges: number;
  totalAdds: number;
  totalEdits: number;
  totalRemoves: number;
  /** Pending rows whose JSON-LD currently fails validation. */
  schemasWithErrors: number;
  pages: PendingSummaryPage[];
}

export interface ApplyAllPageResult {
  pageId: string;
  url: string;
  published: number;
  error?: string;
}

export interface ApplyAllResult {
  applied: number;
  failed: number;
  perPage: ApplyAllPageResult[];
}

@Injectable()
export class SchemaSyncService {
  private readonly logger = new Logger(SchemaSyncService.name);

  constructor(
    @InjectRepository(Page) private readonly pageRepo: Repository<Page>,
    @InjectRepository(Site) private readonly siteRepo: Repository<Site>,
    @InjectRepository(PageSchema)
    private readonly managedRepo: Repository<PageSchema>,
    @InjectRepository(SchemaHistory)
    private readonly historyRepo: Repository<SchemaHistory>,
    private readonly schemaService: SchemaService,
  ) {}

  /**
   * "Apply": push the page's current managed set (everything NOT soft-removed) to
   * WordPress. The plugin strips all foreign JSON-LD and renders our set, so WP
   * mirrors the CMS exactly. On success every pushed row is marked `synced`,
   * soft-`removed` rows are hard-deleted, and a history snapshot is recorded.
   */
  async publish(siteId: string, pageId: string): Promise<PublishResult> {
    const site = await this.siteRepo.findOne({ where: { id: siteId } });
    if (!site) throw new NotFoundException('Site not found');
    if (!site.wpApiKey) {
      throw new BadRequestException(
        'No WP API key configured for this site. Add it in site settings.',
      );
    }
    const page = await this.pageRepo.findOne({ where: { id: pageId } });
    if (!page) throw new NotFoundException('Page not found');

    const allRows = await this.managedRepo.find({
      where: { pageId },
      order: { createdAt: 'ASC' },
    });
    const liveRows = allRows.filter(
      (r) => r.status !== PageSchemaStatus.REMOVED,
    );
    const removedIds = allRows
      .filter((r) => r.status === PageSchemaStatus.REMOVED)
      .map((r) => r.id);
    const pending = allRows.filter(
      (r) =>
        r.status === PageSchemaStatus.MODIFIED ||
        r.status === PageSchemaStatus.REMOVED,
    );
    if (pending.length === 0) {
      throw new BadRequestException('No changes to apply.');
    }

    const payload = liveRows.map((r) => ({ type: r.type, jsonld: r.jsonld }));

    try {
      await axios.post(
        `${site.url}/wp-json/poirier-cms/v1/schema`,
        { pageUrl: page.url, schemas: payload },
        {
          timeout: 15_000,
          headers: {
            'Content-Type': 'application/json',
            'X-Poirier-API-Key': site.wpApiKey,
          },
        },
      );
    } catch (err) {
      const msg = axios.isAxiosError(err)
        ? `HTTP ${err.response?.status ?? 'no response'}: ${err.response?.data?.message ?? err.message}`
        : (err as Error).message;
      if (liveRows.length > 0) {
        await this.managedRepo.update(
          { id: In(liveRows.map((r) => r.id)) },
          { publishError: msg },
        );
      }
      throw new ServiceUnavailableException(`Schema apply failed: ${msg}`);
    }

    const now = new Date();
    if (liveRows.length > 0) {
      await this.managedRepo.update(
        { id: In(liveRows.map((r) => r.id)) },
        {
          status: PageSchemaStatus.SYNCED,
          lastPublishedAt: now,
          publishError: null,
        },
      );
    }
    if (removedIds.length > 0) {
      await this.managedRepo.delete({ id: In(removedIds) });
    }
    await this.historyRepo.save(
      this.historyRepo.create({
        siteId,
        pageId,
        snapshot: payload,
        count: payload.length,
      }),
    );

    this.logger.log(`Applied ${payload.length} schema(s) to ${page.url}`);

    // Auto re-parse: re-fetch the (cache-busted) live page so detection reflects
    // what's now on it. Best-effort — a re-parse failure must not fail the publish.
    // NOTE: a full-page CDN/cache in front of WP may still serve the old HTML for
    // a short window, so detection can briefly lag the push (use QC to confirm).
    let reparsed = false;
    try {
      await this.schemaService.reparse(pageId);
      reparsed = true;
    } catch (err) {
      this.logger.warn(
        `Post-publish re-parse failed for ${page.url}: ${(err as Error).message}`,
      );
    }

    return { published: payload.length, at: now.toISOString(), reparsed };
  }

  /**
   * Preview of every pending change across the site, for the "Apply All" modal.
   * Groups pending rows (modified|removed) by page and classifies each as an
   * add / edit / remove. Intentionally omits the (potentially large) jsonld
   * payload — only the metadata needed to render the review is returned.
   */
  async pendingSummary(siteId: string): Promise<PendingSummary> {
    const rows = await this.managedRepo.find({
      where: {
        siteId,
        status: In([PageSchemaStatus.MODIFIED, PageSchemaStatus.REMOVED]),
      },
      select: [
        'id',
        'pageId',
        'type',
        'status',
        'source',
        'validationStatus',
        'lastPublishedAt',
        'createdAt',
      ],
      order: { pageId: 'ASC', createdAt: 'ASC' },
    });

    let totalAdds = 0;
    let totalEdits = 0;
    let totalRemoves = 0;
    let schemasWithErrors = 0;

    const byPage = new Map<string, PendingSummaryItem[]>();
    for (const r of rows) {
      let action: PendingAction;
      if (r.status === PageSchemaStatus.REMOVED) {
        action = 'remove';
        totalRemoves++;
      } else if (r.lastPublishedAt == null) {
        action = 'add';
        totalAdds++;
      } else {
        action = 'edit';
        totalEdits++;
      }
      if (r.validationStatus === 'errors') schemasWithErrors++;

      const list = byPage.get(r.pageId) ?? [];
      list.push({
        schemaId: r.id,
        type: r.type,
        action,
        source: r.source,
        validationStatus: r.validationStatus,
      });
      byPage.set(r.pageId, list);
    }

    // Resolve page URLs in one query, then keep DB row ordering for stability.
    const pageIds = [...byPage.keys()];
    const urlById = new Map<string, string>();
    if (pageIds.length > 0) {
      const pages = await this.pageRepo.find({
        where: { id: In(pageIds) },
        select: ['id', 'url'],
      });
      for (const p of pages) urlById.set(p.id, p.url);
    }

    const pages: PendingSummaryPage[] = pageIds
      .map((pageId) => ({
        pageId,
        url: urlById.get(pageId) ?? '',
        items: byPage.get(pageId) ?? [],
      }))
      .sort((a, b) => a.url.localeCompare(b.url));

    return {
      totalPages: pages.length,
      totalChanges: rows.length,
      totalAdds,
      totalEdits,
      totalRemoves,
      schemasWithErrors,
      pages,
    };
  }

  /**
   * Site-level "Apply All": publish every page that has pending changes. Reuses
   * the per-page publish() so the WP push / status-flip / history / re-parse
   * logic stays in one place. Resilient to partial failure — one page's error
   * is captured and the rest still apply. The wpApiKey is validated up-front so
   * a misconfigured site fails fast instead of erroring once per page.
   */
  async publishAll(siteId: string): Promise<ApplyAllResult> {
    const site = await this.siteRepo.findOne({ where: { id: siteId } });
    if (!site) throw new NotFoundException('Site not found');
    if (!site.wpApiKey) {
      throw new BadRequestException(
        'No WP API key configured for this site. Add it in site settings.',
      );
    }

    const pendingRows = await this.managedRepo.find({
      where: {
        siteId,
        status: In([PageSchemaStatus.MODIFIED, PageSchemaStatus.REMOVED]),
      },
      select: ['pageId'],
    });
    const pageIds = [...new Set(pendingRows.map((r) => r.pageId))];
    if (pageIds.length === 0) {
      throw new BadRequestException('No changes to apply.');
    }

    const pages = await this.pageRepo.find({
      where: { id: In(pageIds) },
      select: ['id', 'url'],
    });
    const urlById = new Map(pages.map((p) => [p.id, p.url]));

    const perPage: ApplyAllPageResult[] = [];
    let applied = 0;
    let failed = 0;
    for (const pageId of pageIds) {
      const url = urlById.get(pageId) ?? '';
      try {
        const r = await this.publish(siteId, pageId);
        applied++;
        perPage.push({ pageId, url, published: r.published });
      } catch (err) {
        failed++;
        perPage.push({
          pageId,
          url,
          published: 0,
          error: (err as Error).message,
        });
        this.logger.warn(
          `Apply-all: page ${url} failed: ${(err as Error).message}`,
        );
      }
    }

    this.logger.log(
      `Apply-all for site ${siteId}: ${applied} applied, ${failed} failed`,
    );
    return { applied, failed, perPage };
  }

  /** Remove all CMS-managed schema from the live page (push an empty set). */
  async unpublish(siteId: string, pageId: string): Promise<{ ok: true }> {
    const site = await this.siteRepo.findOne({ where: { id: siteId } });
    if (!site?.wpApiKey) {
      throw new BadRequestException('No WP API key configured for this site.');
    }
    const page = await this.pageRepo.findOne({ where: { id: pageId } });
    if (!page) throw new NotFoundException('Page not found');

    try {
      await axios.delete(`${site.url}/wp-json/poirier-cms/v1/schema`, {
        timeout: 15_000,
        headers: { 'X-Poirier-API-Key': site.wpApiKey },
        params: { pageUrl: page.url },
      });
    } catch (err) {
      const msg = axios.isAxiosError(err)
        ? `HTTP ${err.response?.status ?? 'no response'}: ${err.message}`
        : (err as Error).message;
      throw new ServiceUnavailableException(`Schema unpublish failed: ${msg}`);
    }

    // Nothing is on the live page anymore → any synced row is now a pending change.
    await this.managedRepo.update(
      { pageId, status: PageSchemaStatus.SYNCED },
      { status: PageSchemaStatus.MODIFIED, lastPublishedAt: null },
    );
    return { ok: true };
  }

  getHistory(pageId: string): Promise<SchemaHistory[]> {
    return this.historyRepo.find({
      where: { pageId },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }
}
