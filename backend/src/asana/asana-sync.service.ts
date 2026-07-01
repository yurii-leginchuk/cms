import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, IsNull, Repository } from 'typeorm';
import { AsanaTask } from './asana-task.entity';
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
 * Read-through reconcile: pull a project's tasks from Asana and upsert them into
 * the mirror ("Sync now"). This is how Phase 1 stays fresh (webhooks arrive in
 * Phase 3); it also heals any events missed once webhooks exist. `hydrateTask`
 * upserts a single task (used by the webhook handler in Phase 3).
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

  /** Upsert one Asana task payload into the mirror, preserving CMS-only columns. */
  async upsertTask(raw: AsanaTaskRaw, siteId: string, projectGid: string): Promise<AsanaTask> {
    const fields = mapTaskToMirror(raw, siteId, projectGid);
    const existing = await this.taskRepo.findOne({ where: { taskGid: raw.gid } });
    const now = new Date();
    if (existing) {
      // Never clobber CMS-owned columns (linkedEntity*, origin) on a pull.
      Object.assign(existing, fields, { lastSyncedAt: now });
      return this.taskRepo.save(existing);
    }
    return this.taskRepo.save(
      this.taskRepo.create({ ...fields, origin: 'asana', lastSyncedAt: now }),
    );
  }

  /** Full reconcile for a site's mapped project. Prunes vanished top-level tasks. */
  async fullSync(siteId: string): Promise<SyncResult> {
    const map = await this.projects.requireProject(siteId);
    const token = await this.connection.getToken();
    try {
      const tasks = await this.api.listProjectTasks(token, map.projectGid!);
      for (const raw of tasks) {
        await this.upsertTask(raw, siteId, map.projectGid!);
      }
      const pruned = await this.pruneMissing(
        siteId,
        map.projectGid!,
        tasks.map((t) => t.gid),
      );
      map.lastFullSyncAt = new Date();
      map.syncError = null;
      await this.mapRepo.save(map);
      return {
        siteId,
        synced: tasks.length,
        pruned,
        syncedAt: map.lastFullSyncAt.toISOString(),
      };
    } catch (e) {
      map.syncError = e instanceof AsanaError ? e.message : 'Asana sync failed.';
      await this.mapRepo.save(map);
      throw e;
    }
  }

  /**
   * Drop mirror rows for TOP-LEVEL tasks that are no longer in the project
   * (deleted / moved out). Subtasks aren't in the project task list, so they're
   * left untouched here.
   */
  private async pruneMissing(
    siteId: string,
    projectGid: string,
    seenGids: string[],
  ): Promise<number> {
    const where = {
      siteId,
      projectGid,
      parentTaskGid: IsNull(),
      ...(seenGids.length ? { taskGid: Not(In(seenGids)) } : {}),
    };
    const res = await this.taskRepo.delete(where);
    return res.affected ?? 0;
  }
}
