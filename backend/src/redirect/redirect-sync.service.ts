import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Site } from '../sites/site.entity';
import { RedirectItem } from './redirect-item.entity';
import { RedirectSnapshot } from './redirect-snapshot.entity';
import { RedirectSyncRun, RedirectSyncTrigger } from './redirect-sync-run.entity';
import { RedirectWpService, RedirectNoApiKeyError } from './redirect-wp.service';
import { RedirectAuditService } from './redirect-audit.service';
import {
  API_VERSION,
  DETECTION_VERSION,
  MAPPING_VERSION,
  NormalizedRedirect,
  computeWholeSetHash,
  normalizeRedirect,
  projectionKey,
} from './redirect-normalize';

/**
 * Nightly (once) + on-demand mirror of the Redirection plugin into Postgres.
 * READ-ONLY toward WordPress in Phase 1 — we fetch, fingerprint, upsert the
 * current-state projection, append a change snapshot per change, tombstone
 * redirects that disappeared from WP, and record a lineage row. A whole-set-hash
 * match with the last successful run short-circuits the per-item diff (cheap
 * "nothing changed" path) while still bumping freshness.
 *
 * The `@Cron` lives here (ScheduleModule is global). Rollback = remove the module
 * from AppModule + revert the migration. Nightly runs at 04:00 — after the 01:00
 * index scan and the 02:00 parse, so it never collides with them.
 */
@Injectable()
export class RedirectSyncService {
  private readonly logger = new Logger(RedirectSyncService.name);

  constructor(
    @InjectRepository(Site) private readonly siteRepo: Repository<Site>,
    @InjectRepository(RedirectItem) private readonly itemRepo: Repository<RedirectItem>,
    @InjectRepository(RedirectSnapshot) private readonly snapshotRepo: Repository<RedirectSnapshot>,
    @InjectRepository(RedirectSyncRun) private readonly runRepo: Repository<RedirectSyncRun>,
    private readonly wp: RedirectWpService,
    private readonly audit: RedirectAuditService,
  ) {}

  // Nightly at 04:00 — after the 01:00 index scan and 02:00 parse.
  @Cron('0 4 * * *')
  async handleNightlySync(): Promise<void> {
    this.logger.log('Nightly redirect sync triggered');
    await this.runForAllSites();
  }

  async runForAllSites(): Promise<void> {
    const sites = await this.siteRepo.find();
    for (const site of sites) {
      try {
        await this.runForSite(site.id, 'nightly');
      } catch (err) {
        this.logger.error(`Redirect sync failed for site ${site.id}: ${(err as Error).message}`);
      }
    }
  }

  /** On-demand "Sync now" — same path as nightly, tagged for the lineage. */
  syncNow(siteId: string): Promise<RedirectSyncRun> {
    return this.runForSite(siteId, 'on_demand');
  }

  /**
   * Mirror one site's redirects. Always records a run row (even on skip/failure)
   * so freshness + reasons are auditable.
   */
  async runForSite(siteId: string, trigger: RedirectSyncTrigger): Promise<RedirectSyncRun> {
    const site = await this.siteRepo.findOne({ where: { id: siteId } });
    if (!site) throw new Error('Site not found');

    const run = await this.runRepo.save(
      this.runRepo.create({
        siteId,
        trigger,
        apiVersion: API_VERSION,
        mappingVersion: MAPPING_VERSION,
        detectionVersion: DETECTION_VERSION,
      }),
    );

    try {
      const fetch = await this.wp.fetchRedirects(site);
      run.redirectionActive = fetch.redirectionActive;
      run.pluginVersion = fetch.pluginVersion;

      // Redirection isn't installed — honest skip, not a failure.
      if (!fetch.redirectionActive) {
        run.finishedAt = new Date();
        return await this.runRepo.save(run);
      }

      const groupName = new Map<number, string>();
      for (const g of fetch.groups) if (g.id != null) groupName.set(g.id, g.name);

      const normalized = fetch.redirects.map((r) => normalizeRedirect(r));
      run.redirectsFetched = normalized.length;
      run.groupsFetched = fetch.groups.length;

      const wholeSetHash = computeWholeSetHash(normalized.map((n) => projectionKey(n)));
      run.wholeSetHash = wholeSetHash;

      // Short-circuit: identical to the last SUCCESSFUL run ⇒ nothing changed.
      // Still bump freshness on the live rows so "as of" stays honest.
      const lastGood = await this.runRepo.findOne({
        where: { siteId, redirectionActive: true, fatalError: IsNull() },
        order: { startedAt: 'DESC' },
      });
      if (lastGood && lastGood.id !== run.id && lastGood.wholeSetHash === wholeSetHash) {
        await this.itemRepo.update(
          { siteId, deletedInWpAt: IsNull() },
          { lastSyncedAt: new Date(), lastRunId: run.id },
        );
        run.unchanged = true;
        run.unchangedCount = normalized.length;
        run.finishedAt = new Date();
        const saved = await this.runRepo.save(run);
        await this.audit.runIfFirst(siteId).catch(() => undefined);
        return saved;
      }

      await this.diffAndPersist(siteId, run.id, normalized, groupName, run);

      run.finishedAt = new Date();
      const saved = await this.runRepo.save(run);
      // First-sync audit (once, best-effort — never fails the sync).
      await this.audit.runIfFirst(siteId).catch(() => undefined);
      return saved;
    } catch (err) {
      // No key / unreachable / HTTP error — record honestly. `redirectionActive`
      // stays null (we never confirmed the plugin), distinct from false (absent).
      if (err instanceof RedirectNoApiKeyError) {
        run.fatalError = 'No WP API key configured for this site.';
      } else {
        run.fatalError = (err as Error).message;
      }
      run.finishedAt = new Date();
      return await this.runRepo.save(run);
    }
  }

  /**
   * Per-item reconciliation. Match by plugin id (fast path); recognise a
   * delete-then-recreate in WP by reviving a tombstoned row with the same
   * fingerprint; insert genuinely new rows; then tombstone anything that was live
   * before but is absent from this fetch. Appends a snapshot on every real change.
   */
  private async diffAndPersist(
    siteId: string,
    runId: string,
    normalized: NormalizedRedirect[],
    groupName: Map<number, string>,
    run: RedirectSyncRun,
  ): Promise<void> {
    const now = new Date();
    const existing = await this.itemRepo.find({ where: { siteId } });
    const byPluginId = new Map<number, RedirectItem>();
    for (const e of existing) if (e.pluginId != null) byPluginId.set(e.pluginId, e);

    const seenPluginIds = new Set<number>();
    let added = 0;
    let updated = 0;
    let unchanged = 0;

    for (const n of normalized) {
      if (n.pluginId != null) seenPluginIds.add(n.pluginId);
      const gName = n.groupId != null ? groupName.get(n.groupId) ?? null : null;

      const cur = n.pluginId != null ? byPluginId.get(n.pluginId) : undefined;
      if (cur) {
        const contentChanged = cur.fingerprint !== n.fingerprint;
        const wasTombstoned = cur.deletedInWpAt != null;
        const prevFingerprint = cur.fingerprint;
        // A CMS change is awaiting approval for this redirect?
        const hadPendingCms = cur.pendingChangeId != null;
        const baseline = cur.pendingBaselineFingerprint;

        // Always refresh the projection to WP's current state (WP is the mirror
        // source of truth) — applyNormalized leaves the pending markers intact.
        this.applyNormalized(cur, n, gName, runId, now);

        if (hadPendingCms) {
          // Three-way: WP changed under us since the CMS change was proposed →
          // a conflict for the user to adjudicate. NEVER auto-overwrite the
          // pending change; just flag it. Otherwise it's still simply awaiting apply.
          const wpChangedUnderUs = baseline != null && baseline !== n.fingerprint;
          cur.driftState = wpChangedUnderUs ? 'drifted_wp' : 'pending_cms';
          // keep pendingChangeId + pendingBaselineFingerprint for adjudication
        } else {
          cur.deletedInWpAt = null;
          cur.driftState = 'in_sync';
        }
        await this.itemRepo.save(cur);

        if (contentChanged || wasTombstoned) {
          updated += 1;
          await this.writeSnapshot(siteId, runId, n, prevFingerprint, 'updated');
        } else {
          unchanged += 1;
        }
        continue;
      }

      // No live match by plugin id. Recognise a recreate: a tombstoned row with
      // the same fingerprint → revive + relink to the new plugin id.
      const revived = existing.find(
        (e) => e.deletedInWpAt != null && e.fingerprint === n.fingerprint && !seenLater(e, seenPluginIds),
      );
      if (revived) {
        const prevFingerprint = revived.fingerprint;
        this.applyNormalized(revived, n, gName, runId, now);
        revived.deletedInWpAt = null;
        revived.driftState = 'in_sync';
        await this.itemRepo.save(revived);
        updated += 1;
        await this.writeSnapshot(siteId, runId, n, prevFingerprint, 'updated');
        continue;
      }

      // Genuinely new.
      const row = this.itemRepo.create({ siteId, firstSeenAt: now });
      this.applyNormalized(row, n, gName, runId, now);
      row.deletedInWpAt = null;
      row.driftState = 'in_sync';
      await this.itemRepo.save(row);
      added += 1;
      await this.writeSnapshot(siteId, runId, n, null, 'first_seen');
    }

    // Tombstone: live before, absent from WP now.
    let deleted = 0;
    for (const e of existing) {
      if (e.deletedInWpAt != null) continue; // already tombstoned
      if (e.pluginId != null && seenPluginIds.has(e.pluginId)) continue; // still present
      e.deletedInWpAt = now;
      e.driftState = 'deleted_in_wp';
      e.lastRunId = runId;
      await this.itemRepo.save(e);
      deleted += 1;
      await this.writeSnapshotFromItem(siteId, runId, e, 'deleted');
    }

    run.added = added;
    run.updated = updated;
    run.unchangedCount = unchanged;
    run.deleted = deleted;
  }

  /** Copy a normalized redirect onto a projection row (create or update). */
  private applyNormalized(
    row: RedirectItem,
    n: NormalizedRedirect,
    groupName: string | null,
    runId: string,
    now: Date,
  ): void {
    row.pluginId = n.pluginId;
    row.fingerprint = n.fingerprint;
    row.source = n.source;
    row.sourceNormalized = n.sourceNormalized;
    row.target = n.target;
    row.targetNormalized = n.targetNormalized;
    row.matchType = n.matchType;
    row.actionType = n.actionType;
    row.actionCode = n.actionCode;
    row.regex = n.regex;
    row.groupId = n.groupId;
    row.groupName = groupName;
    row.position = n.position;
    row.enabled = n.enabled;
    row.title = n.title;
    row.wpLastAccess = n.wpLastAccess;
    row.wpLastCount = n.wpLastCount;
    row.rawPayload = n;
    row.mappingVersion = n.mappingVersion;
    row.detectionVersion = n.detectionVersion;
    row.lastSyncedAt = now;
    row.lastRunId = runId;
  }

  private writeSnapshot(
    siteId: string,
    runId: string,
    n: NormalizedRedirect,
    prevFingerprint: string | null,
    changeKind: 'first_seen' | 'updated',
  ): Promise<RedirectSnapshot> {
    return this.snapshotRepo.save(
      this.snapshotRepo.create({
        siteId,
        runId,
        pluginId: n.pluginId,
        fingerprint: n.fingerprint,
        prevFingerprint,
        changeKind,
        source: n.source,
        target: n.target,
        actionCode: n.actionCode,
        enabled: n.enabled,
        rawPayload: n,
        mappingVersion: n.mappingVersion,
        detectionVersion: n.detectionVersion,
        apiVersion: API_VERSION,
      }),
    );
  }

  private writeSnapshotFromItem(
    siteId: string,
    runId: string,
    item: RedirectItem,
    changeKind: 'deleted',
  ): Promise<RedirectSnapshot> {
    return this.snapshotRepo.save(
      this.snapshotRepo.create({
        siteId,
        runId,
        pluginId: item.pluginId,
        fingerprint: item.fingerprint,
        prevFingerprint: item.fingerprint,
        changeKind,
        source: item.source,
        target: item.target,
        actionCode: item.actionCode,
        enabled: item.enabled,
        rawPayload: item.rawPayload,
        mappingVersion: item.mappingVersion,
        detectionVersion: item.detectionVersion,
        apiVersion: API_VERSION,
      }),
    );
  }
}

/**
 * Guard so we don't revive a tombstoned row whose (old) plugin id was already
 * claimed by a live redirect this run — keeps the (siteId, pluginId) unique index
 * safe on the rare recreate-with-id-reuse case.
 */
function seenLater(e: RedirectItem, seenPluginIds: Set<number>): boolean {
  return e.pluginId != null && seenPluginIds.has(e.pluginId);
}
