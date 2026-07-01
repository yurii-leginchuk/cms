import { R2SetupService } from './r2-setup.service';
import { R2Status } from './site-optimization-config.entity';
import { R2Credentials } from './r2-helpers';

/**
 * Verifies the test-connection error→reason mapping and status writes with the
 * S3 client (r2Service) mocked — no live R2 needed.
 */
function build(
  creds: R2Credentials | null,
  roundTrip: () => Promise<void>,
) {
  const config: Record<string, unknown> = {
    r2Status: R2Status.UNTESTED,
    r2VerifiedAt: null,
    r2LastError: null,
  };
  const configService = {
    getOrCreate: jest.fn().mockResolvedValue(config),
    getDecryptedCreds: jest.fn().mockReturnValue(creds),
    toPublic: jest.fn((c: unknown) => c),
    save: jest.fn(async (c: unknown) => c),
  };
  const r2Service = { roundTrip: jest.fn(roundTrip) };
  const svc = new R2SetupService(
    configService as never,
    r2Service as never,
    {} as never,
    {} as never,
  );
  return { svc, config, configService, r2Service };
}

const CREDS: R2Credentials = {
  accountId: 'acct',
  accessKeyId: 'key',
  secretAccessKey: 'secret',
  bucket: 'bucket',
};

describe('R2SetupService.testConnection', () => {
  it('sets verified on a successful round-trip', async () => {
    const { svc, r2Service } = build(CREDS, async () => undefined);
    const res = (await svc.testConnection('site1')) as unknown as Record<string, unknown>;
    expect(r2Service.roundTrip).toHaveBeenCalledTimes(1);
    expect(res.r2Status).toBe(R2Status.VERIFIED);
    expect(res.r2VerifiedAt).toBeInstanceOf(Date);
    expect(res.r2LastError).toBeNull();
  });

  it('maps an S3 error to a specific, secret-free failed reason', async () => {
    const { svc } = build(CREDS, async () => {
      const e = new Error('raw internal detail') as Error & { name: string };
      e.name = 'InvalidAccessKeyId';
      throw e;
    });
    const res = (await svc.testConnection('site1')) as unknown as Record<string, unknown>;
    expect(res.r2Status).toBe(R2Status.FAILED);
    expect(res.r2LastError).toMatch(/access key ID not recognized/i);
    expect(res.r2LastError).not.toMatch(/raw internal detail/);
  });

  it('fails WITHOUT calling R2 when credentials are incomplete', async () => {
    const { svc, r2Service } = build(null, async () => undefined);
    const res = (await svc.testConnection('site1')) as unknown as Record<string, unknown>;
    expect(r2Service.roundTrip).not.toHaveBeenCalled();
    expect(res.r2Status).toBe(R2Status.FAILED);
    expect(res.r2LastError).toMatch(/not fully configured/i);
  });
});
