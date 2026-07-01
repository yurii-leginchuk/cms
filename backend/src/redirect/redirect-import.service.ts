import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Site } from '../sites/site.entity';
import { RedirectItem } from './redirect-item.entity';
import { RedirectBackup } from './redirect-backup.entity';
import { RedirectWriteService } from './redirect-write.service';
import {
  ParseError,
  RedirectFormat,
  detectFormat,
  parseRedirects,
  serializeJson,
} from './redirect-io';
import {
  DiffRow, ExistingRedirect, ImportMode, computeImportDiff,
} from './redirect-diff';

export type { ImportMode, DiffRow } from './redirect-diff';

export interface DryRunResult {
  format: RedirectFormat;
  mode: ImportMode;
  totalRows: number;
  currentCount: number;
  parseErrors: ParseError[];
  counts: { add: number; update: number; delete: number; noop: number; blocked: number; warnings: number };
  diff: DiffRow[];
  /** Dry-run writes nothing — the mandatory backup is taken at apply time. */
  backupId: string | null;
}

export interface ApplyResult {
  backupId: string;
  queued: { add: number; update: number; delete: number };
  skipped: number;
  errors: { fingerprint: string; source: string; error: string }[];
}

@Injectable()
export class RedirectImportService {
  constructor(
    @InjectRepository(Site) private readonly siteRepo: Repository<Site>,
    @InjectRepository(RedirectItem) private readonly itemRepo: Repository<RedirectItem>,
    @InjectRepository(RedirectBackup) private readonly backupRepo: Repository<RedirectBackup>,
    private readonly write: RedirectWriteService,
  ) {}

  // ── Dry-run (the feature): parse → validate → deterministic diff ───────────

  async dryRun(
    siteId: string,
    content: string,
    opts: { format?: RedirectFormat; mode?: ImportMode; filename?: string } = {},
  ): Promise<DryRunResult> {
    const { site, items } = await this.load(siteId);
    const format = opts.format ?? detectFormat(content, opts.filename);
    const mode = opts.mode ?? 'merge';
    const parsed = parseRedirects(content, format);

    const diff = computeImportDiff(this.hostOf(site.url), items.map(toExisting), parsed.rows, mode);

    const counts = { add: 0, update: 0, delete: 0, noop: 0, blocked: 0, warnings: 0 };
    for (const d of diff) {
      counts[d.op] += 1;
      if (d.status === 'blocked') counts.blocked += 1;
      else if (d.status === 'warning') counts.warnings += 1;
    }

    // Dry-run is strictly read-only: the mandatory pre-write backup is taken by
    // apply(). Creating one here piled up a junk backup per preview click.
    return {
      format, mode,
      totalRows: parsed.rows.length,
      currentCount: items.length,
      parseErrors: parsed.errors,
      counts,
      diff,
      backupId: null,
    };
  }

  // ── Apply — recompute identically, auto-backup, enqueue through the gate ───

  async apply(
    siteId: string,
    content: string,
    opts: { format?: RedirectFormat; mode?: ImportMode; filename?: string; skipFingerprints?: string[] } = {},
  ): Promise<ApplyResult> {
    const { site, items } = await this.load(siteId);
    const format = opts.format ?? detectFormat(content, opts.filename);
    const mode = opts.mode ?? 'merge';
    const parsed = parseRedirects(content, format);
    const diff = computeImportDiff(this.hostOf(site.url), items.map(toExisting), parsed.rows, mode);

    // MANDATORY auto-backup before any write.
    const backup = await this.createBackup(siteId, items, 'pre_apply', opts.filename ?? null);

    const skip = new Set(opts.skipFingerprints ?? []);
    const queued = { add: 0, update: 0, delete: 0 };
    const errors: ApplyResult['errors'] = [];
    let skipped = 0;

    for (const d of diff) {
      if (d.op === 'noop' || d.status === 'blocked' || skip.has(d.fingerprint)) { skipped += 1; continue; }
      try {
        if (d.op === 'add') {
          await this.write.proposeCreate(siteId, {
            source: d.source, target: d.target, actionCode: d.actionCode,
            matchType: d.matchType, regex: d.regex, enabled: d.enabled,
          });
          queued.add += 1;
        } else if (d.op === 'update' && d.redirectId) {
          await this.write.proposeUpdate(siteId, d.redirectId, {
            target: d.target, actionCode: d.actionCode, matchType: d.matchType,
            regex: d.regex, enabled: d.enabled,
          });
          queued.update += 1;
        } else if (d.op === 'delete' && d.redirectId) {
          await this.write.proposeDelete(siteId, d.redirectId);
          queued.delete += 1;
        }
      } catch (err) {
        errors.push({ fingerprint: d.fingerprint, source: d.source, error: (err as Error).message });
        skipped += 1;
      }
    }

    return { backupId: backup.id, queued, skipped, errors };
  }

  // ── Backups ────────────────────────────────────────────────────────────────

  async listBackups(siteId: string) {
    const rows = await this.backupRepo.find({
      where: { siteId },
      order: { createdAt: 'DESC' },
      take: 50,
      select: ['id', 'reason', 'redirectCount', 'note', 'createdAt'],
    });
    return rows;
  }

  /** Restore = re-enqueue a backup's redirects through the gate (merge, gated). */
  async restore(siteId: string, backupId: string): Promise<ApplyResult> {
    const backup = await this.backupRepo.findOne({ where: { id: backupId, siteId } });
    if (!backup) throw new NotFoundException('Backup not found');
    return this.apply(siteId, JSON.stringify(backup.content), { format: 'json', mode: 'merge', filename: `restore ${backupId}` });
  }

  /** Keep only this many backups per site (newest win). */
  private static readonly BACKUP_CAP = 20;

  private async createBackup(
    siteId: string,
    items: RedirectItem[],
    reason: RedirectBackup['reason'],
    note: string | null,
  ): Promise<RedirectBackup> {
    const json = serializeJson(items.map((i) => ({
      source: i.source, target: i.target, actionCode: i.actionCode, actionType: i.actionType,
      matchType: i.matchType, regex: i.regex, groupId: i.groupId, position: i.position,
      enabled: i.enabled, title: i.title,
    })));
    const saved = await this.backupRepo.save(this.backupRepo.create({
      siteId, reason, note, redirectCount: items.length, content: JSON.parse(json),
    }));
    await this.pruneBackups(siteId);
    return saved;
  }

  /** Best-effort cap: drop the oldest backups beyond BACKUP_CAP. */
  private async pruneBackups(siteId: string): Promise<void> {
    try {
      const stale = await this.backupRepo.find({
        where: { siteId },
        order: { createdAt: 'DESC' },
        skip: RedirectImportService.BACKUP_CAP,
        select: ['id'],
      });
      if (stale.length) {
        await this.backupRepo.delete(stale.map((s) => s.id));
      }
    } catch {
      // Pruning must never fail a backup/apply.
    }
  }

  // ── helpers ─────────────────────────────────────────────────────────────

  private async load(siteId: string): Promise<{ site: Site; items: RedirectItem[] }> {
    const site = await this.siteRepo.findOne({ where: { id: siteId } });
    if (!site) throw new NotFoundException('Site not found');
    const items = (await this.itemRepo.find({ where: { siteId } })).filter((i) => i.deletedInWpAt == null);
    return { site, items };
  }

  private hostOf(url: string): string | null {
    try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
  }
}

/** Map a projection row to the diff's existing-redirect shape (graph node + fp). */
function toExisting(i: RedirectItem): ExistingRedirect {
  return {
    id: i.id, pluginId: i.pluginId, source: i.source, sourceNormalized: i.sourceNormalized,
    target: i.target, targetNormalized: i.targetNormalized, matchType: i.matchType,
    regex: i.regex, actionType: i.actionType, actionCode: i.actionCode, enabled: i.enabled,
    fingerprint: i.fingerprint,
  };
}
