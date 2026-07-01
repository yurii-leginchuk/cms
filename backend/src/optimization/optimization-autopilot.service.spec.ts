import { OptimizationAutopilotService } from './optimization-autopilot.service';
import { R2Status } from './site-optimization-config.entity';
import { OptimizationRunScope } from './image-optimization-run.entity';

function build(config: Record<string, unknown>) {
  const optimizationService = {
    runBlocking: jest.fn().mockResolvedValue({ optimized: 2, skipped: 1, failed: 0 }),
  };
  const configService = { getOrCreate: jest.fn().mockResolvedValue(config) };
  const cdnPublishService = { publish: jest.fn().mockResolvedValue({ verified: 0 }) };
  const siteRepo = { findOne: jest.fn().mockResolvedValue({ id: 's', url: 'http://wp', wpApiKey: 'k' }) };
  const configRepo = { find: jest.fn() };
  const svc = new OptimizationAutopilotService(
    siteRepo as never,
    configRepo as never,
    optimizationService as never,
    configService as never,
    cdnPublishService as never,
  );
  return { svc, optimizationService, cdnPublishService };
}

describe('OptimizationAutopilotService.runForSite', () => {
  it('runs in new_only mode (never re-touches optimized images)', async () => {
    const { svc, optimizationService } = build({
      siteId: 's', enabled: true, r2Status: R2Status.VERIFIED, rewriteEnabled: false,
    });
    const res = await svc.runForSite('s');
    expect(optimizationService.runBlocking).toHaveBeenCalledTimes(1);
    const [, scope] = optimizationService.runBlocking.mock.calls[0];
    expect(scope).toBe(OptimizationRunScope.NEW_ONLY);
    expect(res.optimized).toBe(2);
  });

  it('skips when optimization is disabled', async () => {
    const { svc, optimizationService } = build({ siteId: 's', enabled: false, r2Status: R2Status.VERIFIED });
    const res = await svc.runForSite('s');
    expect(res.skipped).toBe('disabled');
    expect(optimizationService.runBlocking).not.toHaveBeenCalled();
  });

  it('skips when R2 is not verified', async () => {
    const { svc, optimizationService } = build({ siteId: 's', enabled: true, r2Status: R2Status.UNTESTED });
    const res = await svc.runForSite('s');
    expect(res.skipped).toBe('r2_not_verified');
    expect(optimizationService.runBlocking).not.toHaveBeenCalled();
  });

  it('publishes newly-verified mappings when rewrite is live', async () => {
    const { svc, cdnPublishService } = build({
      siteId: 's', enabled: true, r2Status: R2Status.VERIFIED, rewriteEnabled: true,
    });
    await svc.runForSite('s');
    expect(cdnPublishService.publish).toHaveBeenCalledTimes(1);
  });
});
