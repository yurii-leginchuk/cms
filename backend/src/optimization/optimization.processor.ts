import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { OptimizationService } from './optimization.service';

export const OPTIMIZE_QUEUE = 'optimization';

export interface OptimizeImageJob {
  siteId: string;
  wpAttachmentId: number;
}

/**
 * Processes single-image optimize jobs enqueued by the new-upload webhook.
 * Concurrency 2 keeps R2/CPU load bounded under a burst of uploads. The work
 * itself is idempotent (new_only), so retried/duplicate jobs are safe.
 */
@Processor(OPTIMIZE_QUEUE, { concurrency: 2 })
export class OptimizationProcessor extends WorkerHost {
  private readonly logger = new Logger(OptimizationProcessor.name);

  constructor(private readonly optimizationService: OptimizationService) {
    super();
  }

  async process(job: Job<OptimizeImageJob>): Promise<{ status: string }> {
    const { siteId, wpAttachmentId } = job.data;
    const result = await this.optimizationService.optimizeSingleAttachment(
      siteId,
      wpAttachmentId,
    );
    this.logger.log(
      `Webhook optimize site ${siteId} attachment ${wpAttachmentId}: ${result.status}`,
    );
    return result;
  }
}
