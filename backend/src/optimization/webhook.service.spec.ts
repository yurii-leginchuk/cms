import { UnauthorizedException } from '@nestjs/common';
import { WebhookService } from './webhook.service';
import { R2Status } from './site-optimization-config.entity';

function build(config: Record<string, unknown>, storedSecret: string | null) {
  const configService = {
    getOrCreate: jest.fn().mockResolvedValue(config),
    getWebhookSecret: jest.fn().mockReturnValue(storedSecret),
    markWebhookReceived: jest.fn().mockResolvedValue(undefined),
  };
  const queue = { add: jest.fn().mockResolvedValue({ id: '1' }) };
  const svc = new WebhookService(configService as never, queue as never);
  return { svc, configService, queue };
}

const READY = { siteId: 's', enabled: true, r2Status: R2Status.VERIFIED };

describe('WebhookService.handleNewImage', () => {
  it('enqueues a job for a valid secret', async () => {
    const { svc, queue } = build(READY, 'topsecret');
    const res = await svc.handleNewImage('s', 'topsecret', 42);
    expect(res.status).toBe('queued');
    expect(queue.add).toHaveBeenCalledTimes(1);
    // Deduped by a deterministic jobId (burst tolerance).
    expect(queue.add.mock.calls[0][2].jobId).toBe('s:42');
  });

  it('rejects a bad secret with 401 and does NOT enqueue', async () => {
    const { svc, queue } = build(READY, 'topsecret');
    await expect(svc.handleNewImage('s', 'wrong', 42)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('rejects a missing secret with 401', async () => {
    const { svc } = build(READY, 'topsecret');
    await expect(svc.handleNewImage('s', undefined, 42)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts-and-noops (no enqueue) when optimization is disabled', async () => {
    const { svc, queue } = build({ siteId: 's', enabled: false, r2Status: R2Status.VERIFIED }, 'topsecret');
    const res = await svc.handleNewImage('s', 'topsecret', 42);
    expect(res.status).toBe('noop_disabled');
    expect(queue.add).not.toHaveBeenCalled();
  });
});
