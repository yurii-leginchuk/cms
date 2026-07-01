import { deriveBucketName, mapS3Error, mapCfError } from './r2-helpers';

describe('deriveBucketName', () => {
  it('strips protocol/www/path and lowercases', () => {
    expect(deriveBucketName('https://www.Poirier.Agency/some/path')).toBe('poirier-agency');
  });
  it('replaces unsafe chars and collapses hyphens', () => {
    expect(deriveBucketName('My Site!! (staging)')).toBe('my-site-staging');
  });
  it('trims leading/trailing hyphens', () => {
    expect(deriveBucketName('--edge--')).toBe('edge');
  });
  it('falls back to a valid name for empty input', () => {
    expect(deriveBucketName('')).toBe('site');
  });
  it('pads names shorter than 3 chars', () => {
    expect(deriveBucketName('ab').length).toBeGreaterThanOrEqual(3);
  });
  it('clamps to 63 chars and keeps it hyphen-clean', () => {
    const long = 'a'.repeat(200)
    const name = deriveBucketName(long)
    expect(name.length).toBeLessThanOrEqual(63)
    expect(name.endsWith('-')).toBe(false)
  });
});

describe('mapS3Error (secret-free reasons)', () => {
  it('maps invalid access key', () => {
    expect(mapS3Error({ name: 'InvalidAccessKeyId' })).toMatch(/access key ID not recognized/i);
  });
  it('maps bad signature (wrong secret)', () => {
    expect(mapS3Error({ name: 'SignatureDoesNotMatch' })).toMatch(/secret access key is incorrect/i);
  });
  it('maps missing bucket (name and 404)', () => {
    expect(mapS3Error({ name: 'NoSuchBucket' })).toMatch(/bucket not found/i);
    expect(mapS3Error({ $metadata: { httpStatusCode: 404 } })).toMatch(/bucket not found/i);
  });
  it('maps access denied (name and 403)', () => {
    expect(mapS3Error({ name: 'AccessDenied' })).toMatch(/access denied/i);
    expect(mapS3Error({ $metadata: { httpStatusCode: 403 } })).toMatch(/access denied/i);
  });
  it('maps network errors', () => {
    expect(mapS3Error({ code: 'ENOTFOUND' })).toMatch(/network error/i);
    expect(mapS3Error({ name: 'TimeoutError' })).toMatch(/network error/i);
  });
  it('has a safe generic fallback', () => {
    expect(mapS3Error({ name: 'WeirdUnknownError', message: 's3cr3t' })).toBe('R2 connection failed.');
  });
});

describe('mapCfError', () => {
  it('maps auth failures to a token-permission hint', () => {
    expect(mapCfError(403)).toMatch(/Workers R2 Storage: Edit/);
    expect(mapCfError(401)).toMatch(/Workers R2 Storage: Edit/);
  });
  it('maps 400 with a truncated detail', () => {
    expect(mapCfError(400, 'bad name')).toMatch(/Cloudflare rejected/i);
  });
  it('has a generic fallback', () => {
    expect(mapCfError(500)).toBe('Cloudflare bucket creation failed.');
  });
});
