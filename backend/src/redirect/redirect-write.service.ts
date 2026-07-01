import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { Site } from '../sites/site.entity';
import { McpChangeRequest } from '../mcp-changes/mcp-change-request.entity';
import { RedirectItem } from './redirect-item.entity';
import { RedirectSnapshot } from './redirect-snapshot.entity';
import { RedirectPush, RedirectPushStatus } from './redirect-push.entity';
import { RedirectWpService, RedirectWritePayload } from './redirect-wp.service';
import { RedirectValidateService } from './redirect-validate.service';
import {
  API_VERSION,
  RawRedirect,
  normalizeRedirect,
  normalizeRedirectUrl,
} from './redirect-normalize';

/** Shape a redirect-create proposal carries. */
export interface RedirectCreateInput {
  source: string;
  target?: string | null;
  actionCode?: number | null;
  actionType?: string | null;
  matchType?: string | null;
  regex?: boolean;
  groupId?: number | null;
  enabled?: boolean;
  title?: string | null;
}

export type RedirectUpdateInput = Partial<RedirectCreateInput>;

/** Minutes of back-off per attempt (capped) for the push retry. */
const RETRY_BACKOFF_MIN = [1, 5, 15, 60];

/**
 * Phase 2 write path for redirects. NOTHING here writes to WordPress directly on
 * a user edit: every create/update/delete/toggle is staged as a PENDING row in the
 * shared `mcp_change_requests` gate (module `redirect`). Approval flows through the
 * existing gate (`McpChangeService.accept` → `dispatchApply` → {@link applyChange}),
 * which pushes to WP immediately, verifies by re-reading, updates the projection +
 * snapshot ledger, and records the push in `redirect_pushes` (idempotent retry,
 * mirroring `sync_jobs`). The nightly sync stays read-only.
 */
@Injectable()
export class RedirectWriteService {
  private readonly logger = new Logger(RedirectWriteService.name);

  constructor(
    @InjectRepository(Site) private readonly siteRepo: Repository<Site>,
    @InjectRepository(McpChangeRequest) private readonly changeRepo: Repository<McpChangeRequest>,
    @InjectRepository(RedirectItem) private readonly itemRepo: Repository<RedirectItem>,
    @InjectRepository(RedirectSnapshot) private readonly snapshotRepo: Repository<RedirectSnapshot>,
    @InjectRepository(RedirectPush) private readonly pushRepo: Repository<RedirectPush>,
    private readonly wp: RedirectWpService,
    private readonly validate: RedirectValidateService,
  ) {}

  // ── Propose (stage a PENDING gate row; no WP write yet) ─────────────────────

  async proposeCreate(siteId: string, input: RedirectCreateInput): Promise<McpChangeRequest> {
    if (!input.source?.trim()) throw new BadRequestException('A redirect source is required.');
    // Block a create that would close an exact loop (warnings are non-blocking).
    const check = await this.validate.validateNew(siteId, input);
    if (check.blocked) throw new BadRequestException(check.errors.map((e) => e.message).join(' '));
    const targetTxt = input.target ? ` → ${input.target}` : '';
    return this.changeRepo.save(
      this.changeRepo.create({
        siteId,
        module: 'redirect',
        action: 'redirect.create',
        targetType: 'redirect',
        targetId: '', // no item yet — created on approval
        targetLabel: input.source,
        payload: input as unknown as Record<string, unknown>,
        before: null,
        summary: `Create redirect ${input.source}${targetTxt} (${input.actionCode ?? 301})`,
        status: 'pending',
        origin: 'cms',
      }),
    );
  }

  async proposeUpdate(
    siteId: string,
    itemId: string,
    input: RedirectUpdateInput,
  ): Promise<McpChangeRequest> {
    const item = await this.requireItem(siteId, itemId);
    this.assertNoPending(item);
    // Validate the POST-EDIT state; block an exact loop.
    const merged = this.mergeForUpdate(item, input);
    const check = await this.validate.validateNew(
      siteId,
      { source: merged.source, target: merged.target, actionType: merged.actionType, actionCode: merged.actionCode, matchType: merged.matchType, regex: merged.regex },
      itemId,
    );
    if (check.blocked) throw new BadRequestException(check.errors.map((e) => e.message).join(' '));
    const changed = Object.keys(input);
    const req = await this.changeRepo.save(
      this.changeRepo.create({
        siteId,
        module: 'redirect',
        action: 'redirect.update',
        targetType: 'redirect',
        targetId: itemId,
        targetLabel: item.source,
        payload: input as unknown as Record<string, unknown>,
        before: this.itemBefore(item),
        summary: `Edit redirect ${item.source}: ${changed.join(', ') || '(no fields)'}`,
        status: 'pending',
        origin: 'cms',
      }),
    );
    await this.markPending(item, req.id);
    return req;
  }

  async proposeToggle(
    siteId: string,
    itemId: string,
    enabled: boolean,
  ): Promise<McpChangeRequest> {
    const item = await this.requireItem(siteId, itemId);
    this.assertNoPending(item);
    const req = await this.changeRepo.save(
      this.changeRepo.create({
        siteId,
        module: 'redirect',
        action: enabled ? 'redirect.enable' : 'redirect.disable',
        targetType: 'redirect',
        targetId: itemId,
        targetLabel: item.source,
        payload: { enabled },
        before: this.itemBefore(item),
        summary: `${enabled ? 'Enable' : 'Disable'} redirect ${item.source}`,
        status: 'pending',
        origin: 'cms',
      }),
    );
    await this.markPending(item, req.id);
    return req;
  }

  async proposeDelete(siteId: string, itemId: string): Promise<McpChangeRequest> {
    const item = await this.requireItem(siteId, itemId);
    this.assertNoPending(item);
    const req = await this.changeRepo.save(
      this.changeRepo.create({
        siteId,
        module: 'redirect',
        action: 'redirect.delete',
        targetType: 'redirect',
        targetId: itemId,
        targetLabel: item.source,
        payload: {},
        before: this.itemBefore(item),
        summary: `Delete redirect ${item.source}`,
        status: 'pending',
        origin: 'cms',
      }),
    );
    await this.markPending(item, req.id);
    return req;
  }

  // ── Apply (called by the gate on accept; idempotent + retryable) ────────────

  /**
   * Push an approved change to WordPress, verify by re-read, update the projection
   * + snapshot, and record the push. Idempotent: a ledger row already `success`
   * short-circuits. Throws (scrubbed) on failure so the gate keeps the change
   * PENDING with the error; the ledger schedules a retry.
   */
  async applyChange(req: McpChangeRequest): Promise<void> {
    const site = await this.siteRepo.findOne({ where: { id: req.siteId } });
    if (!site) throw new NotFoundException('Site not found');

    let ledger = await this.pushRepo.findOne({ where: { changeRequestId: req.id } });
    if (!ledger) {
      ledger = this.pushRepo.create({
        siteId: req.siteId,
        changeRequestId: req.id,
        action: req.action,
        redirectItemId: req.targetId || null,
        maxAttempts: 4,
      });
    }
    if (ledger.status === RedirectPushStatus.SUCCESS) return; // already applied

    ledger.status = RedirectPushStatus.PROCESSING;
    ledger.attempts += 1;
    ledger.nextRetryAt = null;
    await this.pushRepo.save(ledger);

    try {
      const outcome = await this.dispatchPush(site, req);
      ledger.status = RedirectPushStatus.SUCCESS;
      ledger.verifyOk = outcome.verifyOk;
      ledger.pluginId = outcome.pluginId ?? ledger.pluginId;
      ledger.redirectItemId = outcome.itemId ?? ledger.redirectItemId;
      ledger.appliedAt = new Date();
      ledger.lastError = null;
      await this.pushRepo.save(ledger);
    } catch (err) {
      const msg = (err as Error)?.message ?? 'Push failed';
      ledger.lastError = msg;
      ledger.status = RedirectPushStatus.FAILED;
      ledger.nextRetryAt =
        ledger.attempts < ledger.maxAttempts ? this.backoff(ledger.attempts) : null;
      await this.pushRepo.save(ledger);
      throw err;
    }
  }

  /** Cron: re-attempt transiently-failed pushes whose change is still pending. */
  @Cron('*/15 * * * *')
  async retryFailedPushes(): Promise<void> {
    const due = await this.pushRepo.find({
      where: { status: RedirectPushStatus.FAILED, nextRetryAt: LessThanOrEqual(new Date()) },
      take: 50,
    });
    for (const ledger of due) {
      if (ledger.attempts >= ledger.maxAttempts) continue;
      const req = await this.changeRepo.findOne({ where: { id: ledger.changeRequestId } });
      if (!req || req.status !== 'pending') continue; // decided elsewhere — leave it
      try {
        await this.applyChange(req);
        req.status = 'accepted';
        req.decidedAt = new Date();
        req.error = null;
        await this.changeRepo.save(req);
        this.logger.log(`Retry succeeded for redirect change ${req.id}`);
      } catch (err) {
        req.error = (err as Error).message;
        await this.changeRepo.save(req);
      }
    }
  }

  // ── Drift adjudication (three-way conflict resolution) ──────────────────────

  /**
   * Resolve a WP-vs-CMS conflict a nightly sync flagged (`drifted_wp`).
   *  - keep_wp  → WP wins: reject the pending CMS change, reconcile to WP.
   *  - keep_cms → CMS wins: re-baseline so it's no longer flagged; the user then
   *               approves the still-pending change to push the CMS state to WP.
   */
  async resolveDrift(
    siteId: string,
    itemId: string,
    resolution: 'keep_wp' | 'keep_cms',
  ): Promise<RedirectItem> {
    const item = await this.requireItem(siteId, itemId);
    if (item.driftState !== 'drifted_wp') {
      throw new BadRequestException('This redirect is not in a WP/CMS conflict.');
    }

    if (resolution === 'keep_wp') {
      if (item.pendingChangeId) {
        const req = await this.changeRepo.findOne({ where: { id: item.pendingChangeId } });
        if (req && req.status === 'pending') {
          req.status = 'rejected';
          req.decidedAt = new Date();
          await this.changeRepo.save(req);
        }
      }
      item.pendingChangeId = null;
      item.pendingBaselineFingerprint = null;
      item.driftState = 'in_sync';
    } else {
      // keep_cms: acknowledge the conflict, keep the pending change, re-baseline.
      item.pendingBaselineFingerprint = item.fingerprint;
      item.driftState = 'pending_cms';
    }
    return this.itemRepo.save(item);
  }

  // ── Push dispatch (per action) ──────────────────────────────────────────────

  private async dispatchPush(
    site: Site,
    req: McpChangeRequest,
  ): Promise<{ itemId: string | null; pluginId: number | null; verifyOk: boolean }> {
    const now = new Date();

    switch (req.action) {
      case 'redirect.create': {
        const input = req.payload as unknown as RedirectCreateInput;
        const res = await this.wp.createRedirect(site, this.toWritePayload(input));
        const raw = res.redirect;
        const verifyOk = this.verifyWrite(raw, {
          target: input.target ?? null,
          actionCode: input.actionCode ?? null,
          enabled: input.enabled ?? true,
        });
        const item = raw ? await this.upsertFromRaw(site.id, raw, req.id, now) : null;
        return { itemId: item?.id ?? null, pluginId: raw?.id ?? null, verifyOk };
      }

      case 'redirect.update': {
        const item = await this.requireItem(site.id, req.targetId);
        if (item.pluginId == null) throw new BadRequestException('Redirect has no plugin id.');
        const input = req.payload as unknown as RedirectUpdateInput;
        const merged = this.mergeForUpdate(item, input);
        const res = await this.wp.updateRedirect(site, item.pluginId, merged);
        const raw = res.redirect;
        const verifyOk = this.verifyWrite(raw, {
          target: merged.target ?? null,
          actionCode: merged.actionCode ?? null,
          enabled: merged.enabled ?? item.enabled,
        });
        const updated = raw ? await this.upsertFromRaw(site.id, raw, req.id, now) : item;
        return { itemId: updated.id, pluginId: item.pluginId, verifyOk };
      }

      case 'redirect.enable':
      case 'redirect.disable': {
        const item = await this.requireItem(site.id, req.targetId);
        if (item.pluginId == null) throw new BadRequestException('Redirect has no plugin id.');
        const enabled = req.action === 'redirect.enable';
        const res = await this.wp.setEnabled(site, item.pluginId, enabled);
        const raw = res.redirect;
        const enabledNow = raw ? (raw.status ?? 'enabled') !== 'disabled' : res.ok;
        const verifyOk = raw ? enabledNow === enabled : res.ok;
        const updated = raw ? await this.upsertFromRaw(site.id, raw, req.id, now) : item;
        return { itemId: updated.id, pluginId: item.pluginId, verifyOk };
      }

      case 'redirect.delete': {
        const item = await this.requireItem(site.id, req.targetId);
        if (item.pluginId == null) throw new BadRequestException('Redirect has no plugin id.');
        const res = await this.wp.deleteRedirect(site, item.pluginId);
        if (!res.ok) {
          // WP reported the delete failed — do NOT tombstone a redirect that is
          // still live. Throw so the gate keeps the change pending and retries.
          throw new BadRequestException('WordPress rejected the redirect delete.');
        }
        // Tombstone locally (it's gone from WP now).
        item.deletedInWpAt = now;
        item.driftState = 'deleted_in_wp';
        item.pendingChangeId = null;
        item.pendingBaselineFingerprint = null;
        item.lastSyncedAt = now;
        await this.itemRepo.save(item);
        await this.snapshotDeleted(site.id, req.id, item);
        return { itemId: item.id, pluginId: item.pluginId, verifyOk: res.ok };
      }

      default:
        throw new BadRequestException(`Unsupported redirect action: ${req.action}`);
    }
  }

  /**
   * Upsert the projection from a re-read raw row (the write's proof). Clears any
   * pending-CMS markers (this write IS the applied CMS state) and re-baselines the
   * fingerprint. Appends a snapshot of the new state.
   */
  private async upsertFromRaw(
    siteId: string,
    raw: RawRedirect,
    runId: string,
    now: Date,
  ): Promise<RedirectItem> {
    const n = normalizeRedirect(raw);
    let item =
      n.pluginId != null
        ? await this.itemRepo.findOne({ where: { siteId, pluginId: n.pluginId } })
        : null;
    const isNew = !item;
    if (!item) item = this.itemRepo.create({ siteId, firstSeenAt: now });

    item.pluginId = n.pluginId;
    item.fingerprint = n.fingerprint;
    item.source = n.source;
    item.sourceNormalized = n.sourceNormalized;
    item.target = n.target;
    item.targetNormalized = n.targetNormalized;
    item.matchType = n.matchType;
    item.actionType = n.actionType;
    item.actionCode = n.actionCode;
    item.regex = n.regex;
    item.groupId = n.groupId;
    item.position = n.position;
    item.enabled = n.enabled;
    item.title = n.title;
    item.wpLastAccess = n.wpLastAccess;
    item.wpLastCount = n.wpLastCount;
    item.rawPayload = n;
    item.mappingVersion = n.mappingVersion;
    item.detectionVersion = n.detectionVersion;
    item.deletedInWpAt = null;
    item.driftState = 'in_sync';
    item.pendingChangeId = null;
    item.pendingBaselineFingerprint = null;
    item.lastSyncedAt = now;
    item.lastRunId = runId;
    const saved = await this.itemRepo.save(item);

    await this.snapshotRepo.save(
      this.snapshotRepo.create({
        siteId,
        runId,
        pluginId: n.pluginId,
        fingerprint: n.fingerprint,
        prevFingerprint: isNew ? null : n.fingerprint,
        changeKind: isNew ? 'first_seen' : 'updated',
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
    return saved;
  }

  private snapshotDeleted(
    siteId: string,
    runId: string,
    item: RedirectItem,
  ): Promise<RedirectSnapshot> {
    return this.snapshotRepo.save(
      this.snapshotRepo.create({
        siteId,
        runId,
        pluginId: item.pluginId,
        fingerprint: item.fingerprint,
        prevFingerprint: item.fingerprint,
        changeKind: 'deleted',
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

  // ── helpers ─────────────────────────────────────────────────────────────────

  private async requireItem(siteId: string, itemId: string): Promise<RedirectItem> {
    if (!itemId) throw new BadRequestException('A redirect id is required.');
    const item = await this.itemRepo.findOne({ where: { id: itemId, siteId } });
    if (!item) throw new NotFoundException('Redirect not found');
    return item;
  }

  private assertNoPending(item: RedirectItem): void {
    if (item.pendingChangeId) {
      throw new BadRequestException(
        'This redirect already has a pending change awaiting approval.',
      );
    }
  }

  private async markPending(item: RedirectItem, changeId: string): Promise<void> {
    item.pendingChangeId = changeId;
    item.pendingBaselineFingerprint = item.fingerprint;
    item.driftState = 'pending_cms';
    await this.itemRepo.save(item);
  }

  private itemBefore(item: RedirectItem): Record<string, unknown> {
    return {
      source: item.source,
      target: item.target,
      actionCode: item.actionCode,
      matchType: item.matchType,
      regex: item.regex,
      groupId: item.groupId,
      enabled: item.enabled,
      title: item.title,
    };
  }

  /** Full payload the plugin expects, filling update gaps from the current row. */
  private mergeForUpdate(item: RedirectItem, input: RedirectUpdateInput): RedirectWritePayload {
    return {
      source: input.source ?? item.source,
      target: input.target !== undefined ? input.target : item.target,
      actionCode: input.actionCode !== undefined ? input.actionCode : item.actionCode,
      actionType: input.actionType ?? item.actionType ?? undefined,
      matchType: input.matchType ?? item.matchType ?? undefined,
      regex: input.regex !== undefined ? input.regex : item.regex,
      groupId: input.groupId !== undefined ? input.groupId : item.groupId,
      enabled: input.enabled !== undefined ? input.enabled : item.enabled,
      title: input.title !== undefined ? input.title : item.title,
    };
  }

  private toWritePayload(input: RedirectCreateInput): RedirectWritePayload {
    return {
      source: input.source,
      target: input.target ?? null,
      actionCode: input.actionCode ?? 301,
      actionType: input.actionType ?? (input.target ? 'url' : undefined),
      matchType: input.matchType ?? 'url',
      regex: input.regex ?? false,
      groupId: input.groupId ?? null,
      enabled: input.enabled ?? true,
      title: input.title ?? null,
    };
  }

  /** Verify-after: does the re-read row match what we intended to write? */
  private verifyWrite(
    raw: RawRedirect | null,
    intent: { target: string | null; actionCode: number | null; enabled: boolean },
  ): boolean {
    if (!raw) return false;
    if (intent.actionCode != null && Number(raw.action_code) !== intent.actionCode) return false;
    if (intent.target != null) {
      const got = normalizeRedirectUrl(this.rawTarget(raw));
      if (got !== normalizeRedirectUrl(intent.target)) return false;
    }
    const enabled = (raw.status ?? 'enabled') !== 'disabled';
    if (enabled !== intent.enabled) return false;
    return true;
  }

  private rawTarget(raw: RawRedirect): string | null {
    const d = raw.action_data;
    if (typeof d === 'string') return d;
    if (d && typeof d === 'object' && typeof (d as Record<string, unknown>).url === 'string') {
      return (d as Record<string, string>).url;
    }
    return null;
  }

  private backoff(attempt: number): Date {
    const min = RETRY_BACKOFF_MIN[Math.min(attempt, RETRY_BACKOFF_MIN.length - 1)];
    return new Date(Date.now() + min * 60_000);
  }
}
