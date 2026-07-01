import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CryptoService } from '../common/crypto/crypto.service';
import { AsanaProjectMap } from './asana-project-map.entity';
import { AsanaTask } from './asana-task.entity';
import { AsanaConnectionService } from './asana-connection.service';
import { AsanaProjectService, type AsanaMappingPublic } from './asana-project.service';
import { AsanaSyncService } from './asana-sync.service';
import { AsanaApiClient, AsanaError } from './asana-api-client';
import { verifyHookSignature, extractTaskEvents } from './asana-webhook-auth';

/**
 * Asana webhooks → live status sync for TRACKED tasks. We register a webhook on
 * the mapped project; events arrive thin (task gids), and for each gid we ALREADY
 * track we re-hydrate the mirror row (or prune it on delete). Non-tracked tasks
 * are ignored — the CMS-only model holds.
 *
 * Reachability: webhooks need a public HTTPS target (CMS_PUBLIC_URL). Locally,
 * Asana can't reach the CMS, so establishment only works with a tunnel / in prod;
 * "Sync now" remains the fallback.
 */
@Injectable()
export class AsanaWebhookService {
  private readonly logger = new Logger('AsanaWebhookService');

  constructor(
    private readonly config: ConfigService,
    private readonly crypto: CryptoService,
    @InjectRepository(AsanaProjectMap)
    private readonly mapRepo: Repository<AsanaProjectMap>,
    @InjectRepository(AsanaTask)
    private readonly taskRepo: Repository<AsanaTask>,
    private readonly connection: AsanaConnectionService,
    private readonly projects: AsanaProjectService,
    private readonly sync: AsanaSyncService,
    private readonly api: AsanaApiClient,
  ) {}

  /** Register the webhook on the site's mapped project. */
  async establish(siteId: string): Promise<AsanaMappingPublic> {
    const map = await this.projects.requireProject(siteId);
    const base = (this.config.get<string>('CMS_PUBLIC_URL') || '').replace(/\/+$/, '');
    if (!base || base.includes('localhost') || base.includes('127.0.0.1')) {
      throw new BadRequestException(
        'CMS_PUBLIC_URL must be a public HTTPS URL for Asana to reach the webhook (use a tunnel in local dev).',
      );
    }
    const target = `${base}/api/webhooks/asana/${siteId}`;
    const token = await this.connection.getToken();
    try {
      const { gid } = await this.api.createWebhook(token, map.projectGid!, target);
      map.webhookGid = gid;
      map.webhookStatus = 'active';
      map.syncError = null;
      await this.mapRepo.save(map);
    } catch (e) {
      map.webhookStatus = 'error';
      await this.mapRepo.save(map);
      throw e instanceof AsanaError ? new BadRequestException(e.message) : e;
    }
    return this.projects.toPublic(map);
  }

  /** Remove the webhook (best-effort delete in Asana, then clear local state). */
  async remove(siteId: string): Promise<AsanaMappingPublic> {
    const map = await this.projects.getOrCreateMap(siteId);
    if (map.webhookGid) {
      try {
        const token = await this.connection.getToken();
        await this.api.deleteWebhook(token, map.webhookGid);
      } catch (e) {
        this.logger.warn(`Asana webhook delete failed (continuing): ${(e as Error).message}`);
      }
    }
    map.webhookGid = null;
    map.webhookSecretEnc = null;
    map.webhookStatus = 'none';
    map.webhookLastReceivedAt = null;
    await this.mapRepo.save(map);
    return this.projects.toPublic(map);
  }

  /** Handshake: store the X-Hook-Secret (encrypted). The controller echoes it back. */
  async handleHandshake(siteId: string, secret: string): Promise<void> {
    const map = await this.mapRepo.findOne({ where: { siteId } });
    if (!map) return;
    map.webhookSecretEnc = this.crypto.encrypt(secret);
    if (map.webhookStatus !== 'active') map.webhookStatus = 'pending';
    await this.mapRepo.save(map);
  }

  /**
   * Verify the HMAC signature, then reconcile each TRACKED task the event touches.
   * Bad signatures are dropped silently (return 200 so Asana doesn't disable us,
   * but nothing is processed).
   */
  async handleEvents(
    siteId: string,
    signature: string | undefined,
    rawBody: Buffer | string,
    body: unknown,
  ): Promise<void> {
    const map = await this.mapRepo.findOne({ where: { siteId } });
    if (!map?.webhookSecretEnc) return;
    const secret = this.crypto.decrypt(map.webhookSecretEnc);
    if (!verifyHookSignature(rawBody, signature, secret)) {
      this.logger.warn(`Asana webhook signature mismatch for site ${siteId}`);
      return;
    }
    map.webhookLastReceivedAt = new Date();
    await this.mapRepo.save(map);

    for (const ev of extractTaskEvents(body)) {
      const row = await this.taskRepo.findOne({ where: { siteId, taskGid: ev.gid } });
      if (!row) continue; // only tracked tasks matter
      try {
        if (ev.deleted) {
          await this.taskRepo.delete({ id: row.id });
        } else {
          await this.sync.refreshTask(row);
        }
      } catch (e) {
        this.logger.warn(`Asana event hydrate failed for ${ev.gid}: ${(e as Error).message}`);
      }
    }
  }
}
