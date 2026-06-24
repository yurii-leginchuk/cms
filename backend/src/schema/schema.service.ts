import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import axios from 'axios';
import { Page } from '../pages/page.entity';
import {
  detectSchemas,
  validateJsonLdValue,
  SchemaDetectionResult,
  JsonLdValidation,
} from './schema-validator';
import {
  PageSchema,
  PageSchemaStatus,
  PageSchemaSource,
} from './page-schema.entity';

export interface CreateManagedInput {
  type: string;
  jsonld: unknown;
  source?: PageSchemaSource;
  status?: PageSchemaStatus;
  aiRationale?: string | null;
  evidence?: string[];
  unverifiedClaims?: string[];
}

export interface UpdateManagedInput {
  type?: string;
  jsonld?: unknown;
  status?: PageSchemaStatus;
}

/** Deterministic JSON with sorted keys — for content-based dedup. */
function stableStringify(value: unknown): string {
  const seen = new WeakSet();
  const norm = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v as object)) return null;
    seen.add(v as object);
    if (Array.isArray(v)) return v.map(norm);
    return Object.keys(v as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = norm((v as Record<string, unknown>)[k]);
        return acc;
      }, {});
  };
  return JSON.stringify(norm(value));
}

/** Content key that ignores a top-level @context — so adding/normalising the
 * context doesn't look like a different schema during dedup/self-heal. */
function contentKey(jsonld: unknown): string {
  if (jsonld && typeof jsonld === 'object' && !Array.isArray(jsonld)) {
    const { ['@context']: _ctx, ...rest } = jsonld as Record<string, unknown>;
    return stableStringify(rest);
  }
  return stableStringify(jsonld);
}

@Injectable()
export class SchemaService {
  private readonly logger = new Logger(SchemaService.name);

  constructor(
    @InjectRepository(Page)
    private readonly pageRepo: Repository<Page>,
    @InjectRepository(PageSchema)
    private readonly managedRepo: Repository<PageSchema>,
  ) {}

  /**
   * Re-run JSON-LD detection + validation against the page's stored HTML and
   * persist the result. `rawHtml` is the full scraped response (the scraper
   * only strips <script> when building the *text* projection, not from rawHtml).
   */
  async detectForPage(pageId: string): Promise<SchemaDetectionResult> {
    const page = await this.pageRepo.findOne({ where: { id: pageId } });
    if (!page) throw new NotFoundException('Page not found');
    if (!page.rawHtml) {
      throw new BadRequestException(
        'No HTML captured for this page yet — re-parse the site first.',
      );
    }

    const result = detectSchemas(page.rawHtml);
    await this.pageRepo.update(pageId, {
      detectedSchemas: result,
      schemaCheckedAt: new Date(),
    });
    await this.adoptDetected(page.siteId, pageId, result);

    this.logger.log(
      `Detected ${result.summary.total} schema(s) on page ${page.url} ` +
        `(${result.summary.errors} error, ${result.summary.warnings} warning)`,
    );
    return result;
  }

  /**
   * Auto-persist detected schemas into the managed set as the current live
   * baseline. Idempotent: deduped by content hash, so re-detect adds nothing new.
   * New rows are status `synced` (they reflect what's already live → NOT a pending
   * change). Rows the user has authored/edited (`modified`/`removed`) are left
   * untouched so detection never clobbers in-progress changes.
   */
  private async adoptDetected(
    siteId: string,
    pageId: string,
    result: SchemaDetectionResult,
  ): Promise<number> {
    const existing = await this.managedRepo.find({
      where: { pageId },
      select: ['id', 'jsonld', 'status'],
    });
    // Dedup/self-heal by content ignoring @context, so a re-detect upgrades old
    // rows (e.g. adds a now-propagated @context) instead of creating duplicates.
    const byKey = new Map<string, (typeof existing)[number]>();
    for (const e of existing) byKey.set(contentKey(e.jsonld), e);

    let added = 0;
    for (const s of result.schemas) {
      const key = contentKey(s.json);
      const match = byKey.get(key);
      const v = validateJsonLdValue(s.json);

      if (match) {
        // Self-heal only the untouched baseline; never overwrite user changes.
        if (
          match.status === PageSchemaStatus.SYNCED &&
          stableStringify(match.jsonld) !== stableStringify(s.json)
        ) {
          await this.managedRepo.update(match.id, {
            jsonld: s.json,
            type: s.type,
            validationStatus: v.ok ? v.validity : 'errors',
            validationResult: v.nodes.flatMap((n) => n.issues),
          });
        }
        continue;
      }

      const saved = await this.managedRepo.save(
        this.managedRepo.create({
          siteId,
          pageId,
          type: s.type,
          jsonld: s.json,
          source: PageSchemaSource.IMPORTED,
          status: PageSchemaStatus.SYNCED,
          validationStatus: v.ok ? v.validity : 'errors',
          validationResult: v.nodes.flatMap((n) => n.issues),
          evidence: [],
          unverifiedClaims: [],
        }),
      );
      byKey.set(key, saved);
      added++;
    }
    return added;
  }

  /**
   * Re-fetch the live page (cache-busted), refresh stored HTML, and re-detect.
   * Used after publishing so detection reflects the page's current state.
   */
  async reparse(pageId: string): Promise<SchemaDetectionResult> {
    const page = await this.pageRepo.findOne({ where: { id: pageId } });
    if (!page) throw new NotFoundException('Page not found');

    const bust = `${page.url}${page.url.includes('?') ? '&' : '?'}_poirier=${Date.now()}`;
    let html: string;
    try {
      const res = await axios.get(bust, {
        timeout: 15_000,
        maxContentLength: 50 * 1024 * 1024,
        headers: {
          'User-Agent': 'CMS-Bot/1.0',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
        },
      });
      html = res.data as string;
    } catch (err) {
      throw new BadRequestException(
        `Could not fetch ${page.url}: ${(err as Error).message}`,
      );
    }

    const result = detectSchemas(html);
    await this.pageRepo.update(pageId, {
      rawHtml: html,
      lastScrapedAt: new Date(),
      detectedSchemas: result,
      schemaCheckedAt: new Date(),
    });
    await this.adoptDetected(page.siteId, pageId, result);
    return result;
  }

  /** Site-wide structured-data coverage for the triage dashboard. */
  async coverage(siteId: string): Promise<{
    pagesTotal: number;
    checked: number;
    withSchema: number;
    withErrors: number;
    publishedPages: number;
    pendingChanges: number;
  }> {
    const pages = await this.pageRepo.find({
      where: { siteId },
      select: ['id', 'detectedSchemas'],
    });
    // "publishedPages" = pages with a clean (synced) managed set on WordPress.
    const synced = await this.managedRepo.find({
      where: { siteId, status: PageSchemaStatus.SYNCED },
      select: ['pageId'],
    });
    const publishedPages = new Set(synced.map((p) => p.pageId)).size;
    // Site-wide count of rows awaiting Apply.
    const pendingChanges = await this.managedRepo.count({
      where: {
        siteId,
        status: In([PageSchemaStatus.MODIFIED, PageSchemaStatus.REMOVED]),
      },
    });

    let checked = 0;
    let withSchema = 0;
    let withErrors = 0;
    for (const p of pages) {
      const r = p.detectedSchemas;
      if (!r) continue;
      checked++;
      if (r.summary.total > 0) withSchema++;
      if (r.summary.errors > 0) withErrors++;
    }
    return {
      pagesTotal: pages.length,
      checked,
      withSchema,
      withErrors,
      publishedPages,
      pendingChanges,
    };
  }

  /** Per-URL schema overview for the dedicated Schemas page (paginated). */
  async pagesOverview(
    siteId: string,
    page = 1,
    limit = 25,
    search = '',
  ): Promise<{
    data: {
      pageId: string;
      url: string;
      checkedAt: Date | null;
      detected: SchemaDetectionResult['summary'] | null;
      schemas: { type: string; source: string; validity: string }[];
      managedCount: number;
      pendingCount: number;
    }[];
    meta: { total: number; page: number; limit: number; totalPages: number };
  }> {
    const qb = this.pageRepo
      .createQueryBuilder('p')
      .select(['p.id', 'p.url', 'p.detectedSchemas', 'p.schemaCheckedAt'])
      .where('p.siteId = :siteId', { siteId })
      .orderBy('p.url', 'ASC');
    if (search) qb.andWhere('p.url ILIKE :s', { s: `%${search}%` });

    const total = await qb.getCount();
    const pages = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    // Managed counts only for the page IDs on this page. `managed` excludes
    // soft-removed rows; `pending` = modified + removed (awaiting Apply).
    const pageIds = pages.map((p) => p.id);
    const counts = new Map<string, { managed: number; pending: number }>();
    if (pageIds.length > 0) {
      const managed = await this.managedRepo.find({
        where: { pageId: In(pageIds) },
        select: ['pageId', 'status'],
      });
      for (const m of managed) {
        const e = counts.get(m.pageId) ?? { managed: 0, pending: 0 };
        if (m.status !== PageSchemaStatus.REMOVED) e.managed++;
        if (
          m.status === PageSchemaStatus.MODIFIED ||
          m.status === PageSchemaStatus.REMOVED
        )
          e.pending++;
        counts.set(m.pageId, e);
      }
    }

    const data = pages.map((p) => {
      const d = p.detectedSchemas;
      const c = counts.get(p.id) ?? { managed: 0, pending: 0 };
      return {
        pageId: p.id,
        url: p.url,
        checkedAt: p.schemaCheckedAt ?? null,
        detected: d ? d.summary : null,
        schemas: d
          ? d.schemas.map((s) => ({
              type: s.type,
              source: s.source,
              validity: s.validity,
            }))
          : [],
        managedCount: c.managed,
        pendingCount: c.pending,
      };
    });

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Detect + validate every page of a site that has captured HTML. Pages not yet
   * scraped (no rawHtml) are SKIPPED and reported — so the user can safely click
   * this before/while the site is being parsed. Chunked to avoid loading every
   * page's full HTML into memory at once.
   */
  async detectAll(
    siteId: string,
  ): Promise<{ detected: number; skippedNoHtml: number; pagesTotal: number }> {
    const ids = await this.pageRepo.find({ where: { siteId }, select: ['id'] });
    const pagesTotal = ids.length;
    if (pagesTotal === 0) return { detected: 0, skippedNoHtml: 0, pagesTotal: 0 };

    let detected = 0;
    let skippedNoHtml = 0;
    const CHUNK = 25;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunkIds = ids.slice(i, i + CHUNK).map((p) => p.id);
      const pages = await this.pageRepo.find({
        where: { id: In(chunkIds) },
        select: ['id', 'siteId', 'rawHtml'],
      });
      for (const p of pages) {
        if (!p.rawHtml) {
          skippedNoHtml++;
          continue;
        }
        const result = detectSchemas(p.rawHtml);
        await this.pageRepo.update(p.id, {
          detectedSchemas: result,
          schemaCheckedAt: new Date(),
        });
        await this.adoptDetected(p.siteId, p.id, result);
        detected++;
      }
    }

    this.logger.log(
      `Bulk detect for site ${siteId}: ${detected} detected, ${skippedNoHtml} skipped (no HTML)`,
    );
    return { detected, skippedNoHtml, pagesTotal };
  }

  /** Return the last persisted detection without re-running it. */
  async getForPage(
    pageId: string,
  ): Promise<{ result: SchemaDetectionResult | null; checkedAt: Date | null }> {
    const page = await this.pageRepo.findOne({
      where: { id: pageId },
      select: ['id', 'detectedSchemas', 'schemaCheckedAt'],
    });
    if (!page) throw new NotFoundException('Page not found');
    return {
      result: page.detectedSchemas ?? null,
      checkedAt: page.schemaCheckedAt ?? null,
    };
  }

  // ── Live validation (editor) ───────────────────────────────────────────────

  /** Validate an arbitrary JSON-LD value — used by the editor's live check. */
  validate(jsonld: unknown): JsonLdValidation {
    return validateJsonLdValue(jsonld);
  }

  // ── Managed schemas (authored / approved) ──────────────────────────────────

  /** The page's managed set (current + soft-removed rows pending Apply). */
  listManaged(pageId: string): Promise<PageSchema[]> {
    return this.managedRepo.find({
      where: { pageId },
      order: { createdAt: 'ASC' },
    });
  }

  /** Number of rows awaiting Apply (added/edited/deleted) for a page. */
  async pendingChanges(pageId: string): Promise<{ pending: number }> {
    const pending = await this.managedRepo.count({
      where: {
        pageId,
        status: In([PageSchemaStatus.MODIFIED, PageSchemaStatus.REMOVED]),
      },
    });
    return { pending };
  }

  /** Add a managed schema (manual or AI-approved) → counts as a pending change. */
  async createManaged(
    siteId: string,
    pageId: string,
    input: CreateManagedInput,
  ): Promise<PageSchema> {
    const page = await this.pageRepo.findOne({ where: { id: pageId } });
    if (!page) throw new NotFoundException('Page not found');

    const v = validateJsonLdValue(input.jsonld);
    const row = this.managedRepo.create({
      siteId,
      pageId,
      type: input.type,
      jsonld: input.jsonld,
      source: input.source ?? PageSchemaSource.HUMAN,
      status: input.status ?? PageSchemaStatus.MODIFIED,
      validationStatus: v.ok ? v.validity : 'errors',
      validationResult: v.nodes.flatMap((n) => n.issues),
      aiRationale: input.aiRationale ?? null,
      evidence: input.evidence ?? [],
      unverifiedClaims: input.unverifiedClaims ?? [],
    });
    return this.managedRepo.save(row);
  }

  /** Edit a managed schema. Any JSON-LD change marks the row `modified`. */
  async updateManaged(
    schemaId: string,
    input: UpdateManagedInput,
  ): Promise<PageSchema> {
    const row = await this.managedRepo.findOne({ where: { id: schemaId } });
    if (!row) throw new NotFoundException('Managed schema not found');

    if (input.type !== undefined) row.type = input.type;
    if (input.status !== undefined) row.status = input.status;
    if (input.jsonld !== undefined) {
      row.jsonld = input.jsonld;
      const v = validateJsonLdValue(input.jsonld);
      row.validationStatus = v.ok ? v.validity : 'errors';
      row.validationResult = v.nodes.flatMap((n) => n.issues);
      row.status = PageSchemaStatus.MODIFIED;
    }
    return this.managedRepo.save(row);
  }

  /**
   * Delete a managed schema. Soft-delete (status `removed`) so Apply knows to
   * remove it from the live page; a never-applied (`modified`) row is hard-deleted
   * outright since it was never pushed to WordPress.
   */
  async removeManaged(schemaId: string): Promise<void> {
    const row = await this.managedRepo.findOne({ where: { id: schemaId } });
    if (!row) throw new NotFoundException('Managed schema not found');

    if (row.status === PageSchemaStatus.MODIFIED) {
      await this.managedRepo.delete(schemaId);
      return;
    }
    row.status = PageSchemaStatus.REMOVED;
    await this.managedRepo.save(row);
  }
}
