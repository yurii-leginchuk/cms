import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, SelectQueryBuilder } from 'typeorm';
import { RedirectItem } from './redirect-item.entity';
import { RedirectSnapshot } from './redirect-snapshot.entity';
import { RedirectSyncRun } from './redirect-sync-run.entity';
import { McpChangeRequest } from '../mcp-changes/mcp-change-request.entity';

export interface RedirectListFilters {
  page: number;
  limit: number;
  search?: string;
  status?: string; // 'enabled' | 'disabled' | 'deleted' | 'all' (default: live only)
  regex?: boolean;
  actionCode?: number;
  sort?: string; // 'position' | 'hits' | 'source_asc' | 'recently_synced'
}

@Injectable()
export class RedirectStatusService {
  constructor(
    @InjectRepository(RedirectItem) private readonly itemRepo: Repository<RedirectItem>,
    @InjectRepository(RedirectSnapshot) private readonly snapshotRepo: Repository<RedirectSnapshot>,
    @InjectRepository(RedirectSyncRun) private readonly runRepo: Repository<RedirectSyncRun>,
    @InjectRepository(McpChangeRequest) private readonly changeRepo: Repository<McpChangeRequest>,
  ) {}

  /** Overview: counts (live/disabled/tombstoned/regex + by code) + freshness. */
  async getSummary(siteId: string) {
    const agg = await this.itemRepo
      .createQueryBuilder('r')
      .select('COUNT(*) FILTER (WHERE r."deletedInWpAt" IS NULL)', 'live')
      .addSelect('COUNT(*) FILTER (WHERE r."deletedInWpAt" IS NULL AND r.enabled = true)', 'enabled')
      .addSelect('COUNT(*) FILTER (WHERE r."deletedInWpAt" IS NULL AND r.enabled = false)', 'disabled')
      .addSelect('COUNT(*) FILTER (WHERE r."deletedInWpAt" IS NOT NULL)', 'tombstoned')
      .addSelect('COUNT(*) FILTER (WHERE r."deletedInWpAt" IS NULL AND r.regex = true)', 'regex')
      .addSelect(`COUNT(*) FILTER (WHERE r."driftState" = 'drifted_wp')`, 'drifted')
      .addSelect(`COUNT(*) FILTER (WHERE r."driftState" = 'pending_cms')`, 'pending_cms')
      .addSelect('MAX(r."lastSyncedAt")', 'last_synced')
      .where('r."siteId" = :siteId', { siteId })
      .getRawOne<{
        live: string; enabled: string; disabled: string; tombstoned: string;
        regex: string; drifted: string; pending_cms: string; last_synced: string | null;
      }>();

    const byCodeRows = await this.itemRepo
      .createQueryBuilder('r')
      .select('r."actionCode"', 'code')
      .addSelect('COUNT(*)', 'count')
      .where('r."siteId" = :siteId AND r."deletedInWpAt" IS NULL', { siteId })
      .groupBy('r."actionCode"')
      .getRawMany<{ code: number | null; count: string }>();

    const byActionCode: Record<string, number> = {};
    for (const row of byCodeRows) {
      byActionCode[row.code != null ? String(row.code) : 'none'] = Number(row.count);
    }

    const lastRun = await this.runRepo.findOne({
      where: { siteId },
      order: { startedAt: 'DESC' },
    });

    return {
      // null = never confirmed (no run yet / unreachable); false = plugin absent.
      redirectionActive: lastRun?.redirectionActive ?? null,
      pluginVersion: lastRun?.pluginVersion ?? null,
      counts: {
        live: Number(agg?.live ?? 0),
        enabled: Number(agg?.enabled ?? 0),
        disabled: Number(agg?.disabled ?? 0),
        tombstoned: Number(agg?.tombstoned ?? 0),
        regex: Number(agg?.regex ?? 0),
        drifted: Number(agg?.drifted ?? 0),
        pendingCms: Number(agg?.pending_cms ?? 0),
        byActionCode,
      },
      freshness: {
        lastSyncedAt: agg?.last_synced ?? lastRun?.finishedAt ?? null,
      },
      lastRun: lastRun
        ? {
            id: lastRun.id,
            trigger: lastRun.trigger,
            startedAt: lastRun.startedAt,
            finishedAt: lastRun.finishedAt,
            redirectionActive: lastRun.redirectionActive,
            unchanged: lastRun.unchanged,
            redirectsFetched: lastRun.redirectsFetched,
            added: lastRun.added,
            updated: lastRun.updated,
            deleted: lastRun.deleted,
            fatalError: lastRun.fatalError,
          }
        : null,
    };
  }

  /** Paginated redirect list with filters + sort. Excludes tombstones by default. */
  async listRedirects(siteId: string, f: RedirectListFilters) {
    const page = Math.max(1, f.page);
    const limit = Math.min(200, Math.max(1, f.limit));

    const base = () => this.applyFilters(
      this.itemRepo.createQueryBuilder('r').where('r."siteId" = :siteId', { siteId }),
      f,
    );

    const total = await base().getCount();
    const rows = await this.applySort(base(), f.sort)
      .limit(limit)
      .offset((page - 1) * limit)
      .getMany();

    return {
      data: rows.map((r) => this.toRow(r)),
      meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  /**
   * WP-vs-CMS conflicts a nightly sync flagged (`drifted_wp`): a redirect that
   * changed in WordPress while a CMS edit was pending. Returns the current WP-side
   * projection plus the pending change request (the CMS "desired" side) so the UI
   * can render keep-WP / keep-CMS.
   */
  async getDrift(siteId: string) {
    const items = await this.itemRepo.find({
      where: { siteId, driftState: 'drifted_wp' },
      order: { lastSyncedAt: 'DESC' },
    });
    const changeIds = items.map((i) => i.pendingChangeId).filter((x): x is string => !!x);
    const changes = changeIds.length
      ? await this.changeRepo.find({ where: { id: In(changeIds) } })
      : [];
    const changeById = new Map(changes.map((c) => [c.id, c]));

    return items.map((i) => {
      const change = i.pendingChangeId ? changeById.get(i.pendingChangeId) : undefined;
      return {
        ...this.toRow(i),
        pendingChangeId: i.pendingChangeId,
        // The CMS "desired" side (what the user proposed before WP drifted).
        cmsDesired: change
          ? { action: change.action, payload: change.payload, before: change.before, summary: change.summary }
          : null,
      };
    });
  }

  /** One redirect's current projection + its latest raw payload. */
  async getRedirect(siteId: string, id: string) {
    const r = await this.itemRepo.findOne({ where: { id, siteId } });
    if (!r) throw new NotFoundException('Redirect not found');
    return { ...this.toRow(r), rawPayload: r.rawPayload };
  }

  /** Per-redirect change history (newest first) from the append-only ledger. */
  async getRedirectHistory(siteId: string, id: string) {
    const r = await this.itemRepo.findOne({ where: { id, siteId } });
    if (!r) throw new NotFoundException('Redirect not found');
    if (r.pluginId == null) return [];

    const rows = await this.snapshotRepo.find({
      where: { siteId, pluginId: r.pluginId },
      order: { observedAt: 'DESC' },
      take: 100,
    });
    return rows.map((s) => ({
      id: s.id,
      observedAt: s.observedAt,
      changeKind: s.changeKind,
      source: s.source,
      target: s.target,
      actionCode: s.actionCode,
      enabled: s.enabled,
      fingerprint: s.fingerprint,
      prevFingerprint: s.prevFingerprint,
    }));
  }

  // ── shaping / filter / sort helpers ────────────────────────────────────────

  private toRow(r: RedirectItem) {
    return {
      id: r.id,
      pluginId: r.pluginId,
      source: r.source,
      target: r.target,
      matchType: r.matchType,
      actionType: r.actionType,
      actionCode: r.actionCode,
      regex: r.regex,
      groupId: r.groupId,
      groupName: r.groupName,
      position: r.position,
      enabled: r.enabled,
      title: r.title,
      wpLastAccess: r.wpLastAccess,
      wpLastCount: r.wpLastCount,
      driftState: r.driftState,
      deletedInWpAt: r.deletedInWpAt,
      lastSyncedAt: r.lastSyncedAt,
      liveFinalStatus: r.liveFinalStatus,
      liveHops: r.liveHops,
      liveCheckedAt: r.liveCheckedAt,
    };
  }

  private applyFilters(
    qb: SelectQueryBuilder<RedirectItem>,
    f: RedirectListFilters,
  ): SelectQueryBuilder<RedirectItem> {
    if (f.status === 'deleted') {
      qb.andWhere('r."deletedInWpAt" IS NOT NULL');
    } else if (f.status === 'enabled') {
      qb.andWhere('r."deletedInWpAt" IS NULL AND r.enabled = true');
    } else if (f.status === 'disabled') {
      qb.andWhere('r."deletedInWpAt" IS NULL AND r.enabled = false');
    } else if (f.status !== 'all') {
      // default: live only (hide tombstones)
      qb.andWhere('r."deletedInWpAt" IS NULL');
    }

    if (f.search) {
      qb.andWhere('(r.source ILIKE :search OR r.target ILIKE :search)', { search: `%${f.search}%` });
    }
    if (f.regex) qb.andWhere('r.regex = true');
    if (f.actionCode != null) qb.andWhere('r."actionCode" = :code', { code: f.actionCode });

    return qb;
  }

  private applySort(
    qb: SelectQueryBuilder<RedirectItem>,
    sort?: string,
  ): SelectQueryBuilder<RedirectItem> {
    switch (sort) {
      case 'hits':
        return qb.orderBy('r."wpLastCount"', 'DESC').addOrderBy('r.position', 'ASC');
      case 'source_asc':
        return qb.orderBy('r.source', 'ASC');
      case 'recently_synced':
        return qb.orderBy('r."lastSyncedAt"', 'DESC', 'NULLS LAST');
      case 'position':
      default:
        return qb.orderBy('r.position', 'ASC').addOrderBy('r."pluginId"', 'ASC');
    }
  }
}
