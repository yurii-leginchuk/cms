import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { AsanaTask, type AsanaTaskOrigin } from './asana-task.entity';
import { AsanaProjectMap } from './asana-project-map.entity';
import { AsanaConnectionService } from './asana-connection.service';
import { AsanaProjectService } from './asana-project.service';
import { AsanaApiClient, AsanaError } from './asana-api-client';
import { mapTaskToMirror, type AsanaTaskRaw } from './asana-helpers';

export interface SyncResult {
  siteId: string;
  synced: number;
  pruned: number;
  syncedAt: string;
}

/**
 * The CMS mirrors ONLY the tasks it created (origin `cms`/`mcp`) — not the whole
 * Asana project. So sync is a per-task REFRESH of the tasks we already track,
 * not a bulk project pull. "Sync now" re-hydrates each tracked task from Asana;
 * a task deleted in Asana (404) is pruned. `upsertTracked` is the write path used
 * when the CMS creates a task (Phase 2).
 */
@Injectable()
export class AsanaSyncService {
  private readonly logger = new Logger('AsanaSyncService');

  constructor(
    @InjectRepository(AsanaTask)
    private readonly taskRepo: Repository<AsanaTask>,
    @InjectRepository(AsanaProjectMap)
    private readonly mapRepo: Repository<AsanaProjectMap>,
    private readonly connection: AsanaConnectionService,
    private readonly projects: AsanaProjectService,
    private readonly api: AsanaApiClient,
  ) {}

  /** Re-hydrate one already-tracked mirror row from Asana. 404 ⇒ prune the row. */
  async refreshTask(task: AsanaTask): Promise<'synced' | 'pruned'> {
    const token = await this.connection.getToken();
    try {
      const raw = await this.api.getTask(token, task.taskGid);
      Object.assign(task, mapTaskToMirror(raw, task.siteId, task.projectGid), {
        lastSyncedAt: new Date(),
      });
      await this.taskRepo.save(task);
      return 'synced';
    } catch (e) {
      if (e instanceof AsanaError && e.status === 404) {
        await this.taskRepo.delete({ id: task.id });
        return 'pruned';
      }
      throw e;
    }
  }

  /**
   * Refresh every CMS-tracked top-level task for a site. We only ever mirror the
   * tasks the CMS created, so this touches those rows only — never the rest of
   * the Asana project.
   */
  async refreshTrackedTasks(siteId: string): Promise<SyncResult> {
    const map = await this.projects.requireProject(siteId);
    const tracked = await this.taskRepo.find({
      where: { siteId, parentTaskGid: IsNull() },
    });
    let synced = 0;
    let pruned = 0;
    try {
      for (const t of tracked) {
        const r = await this.refreshTask(t);
        if (r === 'synced') synced++;
        else pruned++;
      }
      map.lastFullSyncAt = new Date();
      map.syncError = null;
      await this.mapRepo.save(map);
      return { siteId, synced, pruned, syncedAt: map.lastFullSyncAt.toISOString() };
    } catch (e) {
      map.syncError = e instanceof AsanaError ? e.message : 'Asana sync failed.';
      await this.mapRepo.save(map);
      throw e;
    }
  }

  /**
   * Insert-or-update a mirror row for a task the CMS owns (create/write path,
   * Phase 2). New rows carry the given origin (`cms`/`mcp`); existing rows keep
   * their origin and are refreshed.
   */
  async upsertTracked(
    raw: AsanaTaskRaw,
    siteId: string,
    projectGid: string,
    origin: AsanaTaskOrigin,
  ): Promise<AsanaTask> {
    const fields = mapTaskToMirror(raw, siteId, projectGid);
    const now = new Date();
    const existing = await this.taskRepo.findOne({ where: { taskGid: raw.gid } });
    if (existing) {
      Object.assign(existing, fields, { lastSyncedAt: now });
      return this.taskRepo.save(existing);
    }
    return this.taskRepo.save(
      this.taskRepo.create({ ...fields, origin, lastSyncedAt: now }),
    );
  }
}
