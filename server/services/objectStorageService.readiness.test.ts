// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ bucketExists: vi.fn(), makeBucket: vi.fn() }));
vi.mock('../config.js', () => ({ config: { objectStorage: {
  endpoint: 'test.invalid', port: 9000, useSSL: false, accessKey: 'test', secretKey: 'test',
  projectBucket: 'test-projects', templateBucket: 'test-templates',
} } }));
vi.mock('minio', () => ({ Client: class {
  bucketExists = mocks.bucketExists;
  makeBucket = mocks.makeBucket;
} }));
import { assertObjectStorageReady, initializeObjectStorage } from './objectStorageService.js';

beforeEach(() => {
  mocks.bucketExists.mockReset();
  mocks.makeBucket.mockReset().mockResolvedValue(undefined);
});

describe('explicit storage provisioning and read-only backend readiness', () => {
  it('checks existing buckets without creating anything', async () => {
    mocks.bucketExists.mockResolvedValue(true);
    await assertObjectStorageReady();
    expect(mocks.bucketExists.mock.calls).toEqual([['test-projects'], ['test-templates']]);
    expect(mocks.makeBucket).not.toHaveBeenCalled();
  });
  it('reports missing provisioning instead of creating a bucket during startup', async () => {
    mocks.bucketExists.mockResolvedValue(false);
    await expect(assertObjectStorageReady()).rejects.toThrow('npm run storage:init');
    expect(mocks.makeBucket).not.toHaveBeenCalled();
  });
  it('only creates missing buckets through the explicit provisioning operation', async () => {
    mocks.bucketExists.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await initializeObjectStorage();
    expect(mocks.makeBucket.mock.calls).toEqual([['test-projects']]);
  });
});
