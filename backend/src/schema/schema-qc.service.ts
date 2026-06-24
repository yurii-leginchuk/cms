import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { Page } from '../pages/page.entity';
import { Site } from '../sites/site.entity';
import { PageSchema, PageSchemaStatus } from './page-schema.entity';
import { detectSchemas } from './schema-validator';

export type QcStatus =
  | 'in_sync'
  | 'not_stored'
  | 'not_rendered'
  | 'unmanaged';

export interface QcItem {
  type: string;
  inManaged: boolean;
  inStored: boolean;
  inLive: boolean;
  status: QcStatus;
}

export interface QcReport {
  checkedAt: string;
  liveUrl: string;
  pluginReachable: boolean;
  pluginError: string | null;
  liveError: string | null;
  items: QcItem[];
  summary: { inSync: number; issues: number };
  /** Full live picture incl. non-managed (Yoast/other) sources. */
  liveTotals: { total: number; errors: number; warnings: number } | null;
}

/** Lowercased @type set for one JSON-LD value (handles @graph + arrays). */
function typeKeysOf(jsonld: unknown, into: Set<string>): void {
  const addNode = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const t = (node as Record<string, unknown>)['@type'];
    const arr = Array.isArray(t) ? t : [t];
    for (const x of arr) if (typeof x === 'string') into.add(x.toLowerCase());
  };
  if (jsonld && typeof jsonld === 'object' && Array.isArray((jsonld as any)['@graph'])) {
    for (const n of (jsonld as any)['@graph']) addNode(n);
  } else if (Array.isArray(jsonld)) {
    jsonld.forEach(addNode);
  } else {
    addNode(jsonld);
  }
}

function statusOf(inManaged: boolean, inStored: boolean, inLive: boolean): QcStatus {
  if (inManaged && inStored && inLive) return 'in_sync';
  if (inManaged && !inStored) return 'not_stored';
  if (inManaged && inStored && !inLive) return 'not_rendered';
  return 'unmanaged';
}

@Injectable()
export class SchemaQcService {
  private readonly logger = new Logger(SchemaQcService.name);

  constructor(
    @InjectRepository(Page) private readonly pageRepo: Repository<Page>,
    @InjectRepository(Site) private readonly siteRepo: Repository<Site>,
    @InjectRepository(PageSchema)
    private readonly managedRepo: Repository<PageSchema>,
  ) {}

  /**
   * Three-way reconciliation: what we MANAGE (published) ↔ what the plugin has
   * STORED (admin) ↔ what's actually RENDERED on the live page. Catches the
   * classic "pushed but cached / not rendered" failure and stale/foreign schema.
   */
  async qc(siteId: string, pageId: string): Promise<QcReport> {
    const site = await this.siteRepo.findOne({ where: { id: siteId } });
    if (!site) throw new NotFoundException('Site not found');
    const page = await this.pageRepo.findOne({ where: { id: pageId } });
    if (!page) throw new NotFoundException('Page not found');

    // 1. Managed (what we believe is live on WordPress — the synced set)
    const managed = await this.managedRepo.find({
      where: { pageId, status: PageSchemaStatus.SYNCED },
    });
    const managedTypes = new Set<string>();
    managed.forEach((m) => typeKeysOf(m.jsonld, managedTypes));

    // 2. Plugin-stored (admin side)
    const storedTypes = new Set<string>();
    let pluginReachable = false;
    let pluginError: string | null = null;
    if (site.wpApiKey) {
      try {
        const res = await axios.get(`${site.url}/wp-json/poirier-cms/v1/schema`, {
          params: { pageUrl: page.url },
          headers: { 'X-Poirier-API-Key': site.wpApiKey },
          timeout: 15_000,
        });
        const schemas = (res.data?.schemas ?? []) as { jsonld: unknown }[];
        schemas.forEach((s) => typeKeysOf(s.jsonld, storedTypes));
        pluginReachable = true;
      } catch (err) {
        pluginError = axios.isAxiosError(err)
          ? `HTTP ${err.response?.status ?? 'no response'}: ${err.message}`
          : (err as Error).message;
      }
    } else {
      pluginError = 'No WP API key configured for this site.';
    }

    // 3. Live-rendered (cache-busted fetch)
    const liveManagedTypes = new Set<string>();
    let liveError: string | null = null;
    let liveTotals: QcReport['liveTotals'] = null;
    try {
      const html = await this.fetchLive(page.url);
      const detection = detectSchemas(html);
      liveTotals = {
        total: detection.summary.total,
        errors: detection.summary.errors,
        warnings: detection.summary.warnings,
      };
      detection.schemas
        .filter((s) => s.source === 'poirier')
        .forEach((s) => typeKeysOf(s.json, liveManagedTypes));
    } catch (err) {
      liveError = (err as Error).message;
    }

    // Reconcile across the union of types
    const allTypes = new Set<string>([
      ...managedTypes,
      ...storedTypes,
      ...liveManagedTypes,
    ]);
    const items: QcItem[] = [...allTypes].sort().map((type) => {
      const inManaged = managedTypes.has(type);
      const inStored = storedTypes.has(type);
      const inLive = liveManagedTypes.has(type);
      return { type, inManaged, inStored, inLive, status: statusOf(inManaged, inStored, inLive) };
    });

    const inSync = items.filter((i) => i.status === 'in_sync').length;
    return {
      checkedAt: new Date().toISOString(),
      liveUrl: page.url,
      pluginReachable,
      pluginError,
      liveError,
      items,
      summary: { inSync, issues: items.length - inSync },
      liveTotals,
    };
  }

  private async fetchLive(url: string): Promise<string> {
    const bust = `${url}${url.includes('?') ? '&' : '?'}_poirierqc=${Date.now()}`;
    const res = await axios.get(bust, {
      timeout: 15_000,
      maxContentLength: 50 * 1024 * 1024,
      headers: {
        'User-Agent': 'CMS-Bot/1.0',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
    });
    return res.data as string;
  }
}
