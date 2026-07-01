import {
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { OptimizationConfigService } from './optimization-config.service';
import { R2Status } from './site-optimization-config.entity';
import { verifyWebhookSecret } from './webhook-auth';
import { OPTIMIZE_QUEUE, OptimizeImageJob } from './optimization.processor';

/**
 * Handles the PUBLIC new-upload webhook from the WordPress plugin. Authenticated
 * ONLY by the per-site webhook secret (constant-time). On a valid call it
 * enqueues an idempotent single-image optimize job (burst-tolerant); duplicate
 * webhooks for the same attachment collapse via the job id.
 */
@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly configService: OptimizationConfigService,
    @InjectQueue(OPTIMIZE_QUEUE) private readonly queue: Queue<OptimizeImageJob>,
  ) {}

  async handleNewImage(
    siteId: string,
    providedSecret: string | undefined,
    attachmentId: number,
  ): Promise<{ status: string }> {
    const config = await this.configService.getOrCreate(siteId);
    const stored = this.configService.getWebhookSecret(config);

    if (!verifyWebhookSecret(providedSecret, stored)) {
      throw new UnauthorizedException('Invalid webhook secret.');
    }

    await this.configService.markWebhookReceived(siteId);

    // Accept-and-noop when optimization isn't ready — the plugin shouldn't be
    // firing, but we never error a valid, authenticated call.
    if (!config.enabled || config.r2Status !== R2Status.VERIFIED) {
      return { status: 'noop_disabled' };
    }
    if (!Number.isInteger(attachmentId) || attachmentId <= 0) {
      return { status: 'ignored_bad_attachment' };
    }

    // jobId dedups a burst of duplicate webhooks for the same attachment while
    // it's still queued; the job itself is idempotent regardless.
    await this.queue.add(
      'optimize-image',
      { siteId, wpAttachmentId: attachmentId },
      {
        jobId: `${siteId}:${attachmentId}`,
        removeOnComplete: true,
        removeOnFail: 100,
        attempts: 2,
        backoff: { type: 'fixed', delay: 5000 },
      },
    );

    return { status: 'queued' };
  }
}
