import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  McpChangeAction,
  McpChangeModule,
  McpChangeRequest,
} from './mcp-change-request.entity';
import { Page } from '../pages/page.entity';
import { PageSchema } from '../schema/page-schema.entity';
import { SiteImage } from '../images/site-image.entity';
import { PagesService } from '../pages/pages.service';
import { SyncService } from '../sync/sync.service';
import { SchemaService } from '../schema/schema.service';
import { SchemaSyncService } from '../schema/schema-sync.service';
import { ImageService } from '../images/image.service';
import { ImageSyncService } from '../images/image-sync.service';

export interface CreateChangeInput {
  siteId: string;
  module: McpChangeModule;
  action: McpChangeAction;
  targetType: 'page' | 'image';
  targetId: string;
  targetLabel?: string | null;
  payload: Record<string, unknown>;
}

const META_FIELDS = [
  'customMetaTitle',
  'customMetaDescription',
  'indexDirective',
  'noindex',
  'nofollow',
  'canonical',
  'ogTitle',
  'ogDescription',
  'ogImage',
  'ogImageId',
  'isTransactional',
] as const;

@Injectable()
export class McpChangeService {
  private readonly logger = new Logger(McpChangeService.name);

  constructor(
    @InjectRepository(McpChangeRequest)
    private readonly repo: Repository<McpChangeRequest>,
    @InjectRepository(Page) private readonly pageRepo: Repository<Page>,
    @InjectRepository(PageSchema)
    private readonly schemaRepo: Repository<PageSchema>,
    @InjectRepository(SiteImage)
    private readonly imageRepo: Repository<SiteImage>,
    private readonly pagesService: PagesService,
    private readonly syncService: SyncService,
    private readonly schemaService: SchemaService,
    private readonly schemaSyncService: SchemaSyncService,
    private readonly imageService: ImageService,
    private readonly imageSyncService: ImageSyncService,
  ) {}

  // ── Create a PENDING proposal (what the MCP server calls) ───────────────────
  async create(input: CreateChangeInput): Promise<McpChangeRequest> {
    const { before, targetLabel, summary } = await this.buildSnapshot(input);
    const row = this.repo.create({
      siteId: input.siteId,
      module: input.module,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      targetLabel: input.targetLabel ?? targetLabel ?? null,
      payload: input.payload,
      before,
      summary,
      status: 'pending',
      origin: 'mcp',
    });
    return this.repo.save(row);
  }

  /** Build the before-snapshot + a human-readable summary per action. */
  private async buildSnapshot(input: CreateChangeInput): Promise<{
    before: Record<string, unknown> | null;
    targetLabel: string | null;
    summary: string;
  }> {
    const p = input.payload as any;
    switch (input.action) {
      case 'meta.update': {
        const page = await this.pageRepo.findOne({ where: { id: input.targetId } });
        if (!page) throw new NotFoundException('Page not found');
        const before: Record<string, unknown> = {};
        for (const k of META_FIELDS) {
          if (k in p) before[k] = (page as any)[k] ?? null;
        }
        const changed = META_FIELDS.filter((k) => k in p);
        return {
          before,
          targetLabel: page.url,
          summary: `Update meta on ${page.url}: ${changed.join(', ') || '(no fields)'}`,
        };
      }
      case 'schema.add': {
        const page = await this.pageRepo.findOne({ where: { id: input.targetId } });
        return {
          before: null,
          targetLabel: page?.url ?? null,
          summary: `Add ${p.type ?? 'schema'} schema to ${page?.url ?? input.targetId}`,
        };
      }
      case 'schema.update':
      case 'schema.delete': {
        const page = await this.pageRepo.findOne({ where: { id: input.targetId } });
        const row = p.schemaId
          ? await this.schemaRepo.findOne({ where: { id: p.schemaId } })
          : null;
        const before = row ? { type: row.type, jsonld: row.jsonld } : null;
        const verb = input.action === 'schema.delete' ? 'Delete' : 'Edit';
        return {
          before,
          targetLabel: page?.url ?? null,
          summary: `${verb} ${row?.type ?? p.type ?? 'schema'} schema on ${page?.url ?? input.targetId}`,
        };
      }
      case 'alt.set': {
        const img = await this.imageRepo.findOne({ where: { id: input.targetId } });
        if (!img) throw new NotFoundException('Image not found');
        const current = img.draftAlt ?? img.observedAlt ?? null;
        return {
          before: { alt: current },
          targetLabel: img.canonicalUrl,
          summary: `Set ALT on ${img.canonicalUrl}: "${truncate(String(p.alt ?? ''), 80)}"`,
        };
      }
      default:
        throw new BadRequestException(`Unsupported action: ${input.action}`);
    }
  }

  // ── Queries ─────────────────────────────────────────────────────────────────
  listPending(siteId: string, module?: McpChangeModule): Promise<McpChangeRequest[]> {
    return this.repo.find({
      where: { siteId, status: 'pending', ...(module ? { module } : {}) },
      order: { createdAt: 'DESC' },
    });
  }

  list(
    siteId: string,
    opts: { module?: McpChangeModule; status?: string } = {},
  ): Promise<McpChangeRequest[]> {
    return this.repo.find({
      where: {
        siteId,
        ...(opts.module ? { module: opts.module } : {}),
        ...(opts.status ? { status: opts.status as any } : {}),
      },
      order: { createdAt: 'DESC' },
      take: 200,
    });
  }

  async counts(
    siteId: string,
  ): Promise<{ total: number; meta: number; schema: number; alt: number }> {
    const rows = await this.repo.find({
      where: { siteId, status: 'pending' },
      select: ['module'],
    });
    const c = { total: rows.length, meta: 0, schema: 0, alt: 0 };
    for (const r of rows) c[r.module] += 1;
    return c;
  }

  // ── Decisions ────────────────────────────────────────────────────────────────
  async accept(id: string): Promise<McpChangeRequest> {
    const req = await this.requirePending(id);
    try {
      await this.dispatchApply(req);
    } catch (err) {
      req.error = (err as Error).message;
      await this.repo.save(req);
      throw err;
    }
    req.status = 'accepted';
    req.decidedAt = new Date();
    req.error = null;
    return this.repo.save(req);
  }

  async reject(id: string): Promise<McpChangeRequest> {
    const req = await this.requirePending(id);
    req.status = 'rejected';
    req.decidedAt = new Date();
    return this.repo.save(req);
  }

  async acceptAll(
    siteId: string,
    module?: McpChangeModule,
  ): Promise<{ accepted: number; failed: number; errors: { id: string; error: string }[] }> {
    const pending = await this.listPending(siteId, module);
    let accepted = 0;
    const errors: { id: string; error: string }[] = [];
    for (const req of pending) {
      try {
        await this.accept(req.id);
        accepted += 1;
      } catch (err) {
        errors.push({ id: req.id, error: (err as Error).message });
      }
    }
    return { accepted, failed: errors.length, errors };
  }

  async rejectAll(
    siteId: string,
    module?: McpChangeModule,
  ): Promise<{ rejected: number }> {
    const pending = await this.listPending(siteId, module);
    for (const req of pending) {
      req.status = 'rejected';
      req.decidedAt = new Date();
    }
    if (pending.length) await this.repo.save(pending);
    return { rejected: pending.length };
  }

  // ── Apply dispatch — REUSES the existing module services ─────────────────────
  private async dispatchApply(req: McpChangeRequest): Promise<void> {
    const p = req.payload as any;
    switch (req.action) {
      case 'meta.update': {
        // Apply to the module (enqueues a sync job) then publish immediately.
        await this.pagesService.updateMeta(req.targetId, p);
        await this.syncService.triggerPageSync(req.siteId, req.targetId);
        return;
      }
      case 'schema.add': {
        await this.schemaService.createManaged(req.siteId, req.targetId, {
          type: p.type,
          jsonld: p.jsonld,
          ...(p.source ? { source: p.source } : {}),
        });
        await this.schemaSyncService.publish(req.siteId, req.targetId);
        return;
      }
      case 'schema.update': {
        await this.schemaService.updateManaged(p.schemaId, {
          ...(p.type !== undefined ? { type: p.type } : {}),
          ...(p.jsonld !== undefined ? { jsonld: p.jsonld } : {}),
        });
        await this.schemaSyncService.publish(req.siteId, req.targetId);
        return;
      }
      case 'schema.delete': {
        await this.schemaService.removeManaged(p.schemaId);
        await this.schemaSyncService.publish(req.siteId, req.targetId);
        return;
      }
      case 'alt.set': {
        await this.imageService.setAlt(req.targetId, String(p.alt ?? ''));
        await this.imageSyncService.applyOne(req.siteId, req.targetId);
        return;
      }
      default:
        throw new BadRequestException(`Unsupported action: ${req.action}`);
    }
  }

  private async requirePending(id: string): Promise<McpChangeRequest> {
    const req = await this.repo.findOne({ where: { id } });
    if (!req) throw new NotFoundException('Change request not found');
    if (req.status !== 'pending') {
      throw new BadRequestException(`Change request already ${req.status}`);
    }
    return req;
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
