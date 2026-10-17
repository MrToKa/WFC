// @vitest-environment node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

const synthetic = vi.hoisted(() => ({ objectStorage: {
  endpoint: '127.0.0.1', port: 9000, useSSL: false, accessKey: 'test-only', secretKey: 'test-only',
} }));
vi.mock('../config.js', () => ({ config: synthetic }));
import { createModelStorage, type ModelResource, type ModelStorageClient } from './storage.js';

const projectId = '11111111-1111-4111-8111-111111111111';
const versionId = '22222222-2222-4222-8222-222222222222';
const prefix = `projects/${projectId}/versions/${versionId}/`;
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
  synthetic.objectStorage.port = 9000;
});
const sha = (data: Buffer): string => createHash('sha256').update(data).digest('hex');
const resource = (data: Buffer): ModelResource => ({ path: 'resources/output/test.bin', bytes: data.length, sha256: sha(data) });
async function file(data: Buffer): Promise<string> {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'wfc-model-storage-'));
  roots.push(root);
  const filename = path.join(root, 'raw.bin');
  await fs.writeFile(filename, data, { mode: 0o600 });
  return filename;
}
function fake() {
  const objects = new Map<string, Buffer>();
  const metadata: Record<string, string>[] = [];
  const removed: string[] = [];
  const uploads = new Map<string, { key: string; uploadId: string }>();
  const aborted: string[] = [];
  const hooks: { afterPut?: () => Promise<void>; listing?: { name: string }[]; incomplete?: { key: string; uploadId: string }[]; policy?: string } = {};
  const missing = (): never => { throw Object.assign(new Error('private internal key'), { code: 'NoSuchKey' }); };
  const client = {
    bucketExists: vi.fn(async () => true),
    makeBucket: vi.fn(async () => undefined),
    getBucketPolicy: vi.fn(async () => hooks.policy ?? ''),
    statObject: vi.fn(async (_bucket: string, key: string) => ({ size: objects.get(key)?.length ?? missing() })),
    putObject: vi.fn(async (_bucket: string, key: string, data: Readable, _size: number, meta: Record<string, string>) => {
      const chunks: Buffer[] = [];
      for await (const chunk of data) chunks.push(Buffer.from(chunk));
      objects.set(key, Buffer.concat(chunks)); metadata.push(meta);
      await hooks.afterPut?.();
    }),
    getObject: vi.fn(async (_bucket: string, key: string) => Readable.from([objects.get(key) ?? missing()])),
    listObjectsV2: vi.fn((_bucket: string, requested: string) => Readable.from(hooks.listing ?? [...objects.keys()].filter((key) => key.startsWith(requested)).map((name) => ({ name })))),
    listIncompleteUploads: vi.fn((_bucket: string, requested: string) => Readable.from(hooks.incomplete ?? [...uploads.values()].filter((upload) => upload.key.startsWith(requested)))),
    abortMultipartUpload: vi.fn(async (_bucket: string, key: string, uploadId: string) => { aborted.push(uploadId); uploads.delete(`${key}\n${uploadId}`); }),
    removeObject: vi.fn(async (_bucket: string, key: string) => { removed.push(key); objects.delete(key); }),
  } satisfies ModelStorageClient;
  return { objects, metadata, removed, uploads, aborted, hooks, client, storage: createModelStorage({ client, bucket: 'test-models' }) };
}

describe('private model storage', () => {
  it('creates only a missing dedicated bucket and refuses any existing bucket policy', async () => {
    const f = fake(); f.client.bucketExists.mockResolvedValue(false);
    await f.storage.initialize(); expect(f.client.makeBucket).toHaveBeenCalledWith('test-models');
    f.hooks.policy = '{"Statement":[{"Effect":"Allow","Principal":"*"}]}';
    await expect(f.storage.initialize()).rejects.toMatchObject({ code: 'STORAGE_BUCKET_NOT_PRIVATE' });
  });

  it('keeps raw gzip bytes and verifies a full SHA readback without Content-Encoding', async () => {
    const f = fake(); const data = Buffer.from([31, 139, 8, 0, 20, 33, 44, 55]); const r = resource(data);
    await f.storage.putResource(prefix, r, await file(data));
    expect(f.objects.get(prefix + r.path)).toEqual(data);
    expect(f.metadata).toEqual([{ 'Content-Type': 'application/octet-stream' }]);
    await expect(f.storage.verifyResources(prefix, [r])).resolves.toEqual({ resourceCount: 1, totalBytes: data.length });
  });

  it('reuses exact existing bytes without overwriting them', async () => {
    const f = fake(); const data = Buffer.from('known'); const r = resource(data);
    f.objects.set(prefix + r.path, data);
    await f.storage.putResource(prefix, r, await file(data));
    expect(f.client.putObject).not.toHaveBeenCalled(); expect(f.client.getObject).toHaveBeenCalledOnce();
  });

  it('refuses an existing object with different SHA even when its size matches', async () => {
    const f = fake(); const data = Buffer.from('known'); const r = resource(data);
    f.objects.set(prefix + r.path, Buffer.from('other'));
    await expect(f.storage.putResource(prefix, r, await file(data))).rejects.toMatchObject({ code: 'STORAGE_INTEGRITY_FAILED' });
    expect(f.client.putObject).not.toHaveBeenCalled(); expect(f.objects.get(prefix + r.path)?.toString()).toBe('other');
  });

  it('does not trust a local source that differs from its verified hash', async () => {
    const f = fake(); const data = Buffer.from('known');
    await expect(f.storage.putResource(prefix, resource(data), await file(Buffer.from('other')))).rejects.toMatchObject({ code: 'STORAGE_SOURCE_CHANGED' });
    expect(f.objects.size).toBe(0);
  });

  it('rejects a changed source stamp after streaming', async () => {
    const f = fake(); const data = Buffer.from('known'); const filename = await file(data);
    f.hooks.afterPut = async () => { await fs.appendFile(filename, 'changed'); };
    await expect(f.storage.putResource(prefix, resource(data), filename)).rejects.toMatchObject({ code: 'STORAGE_SOURCE_CHANGED' });
  });

  it('rejects hard-linked sources before any object write', async () => {
    const f = fake(); const data = Buffer.from('known'); const filename = await file(data);
    await fs.link(filename, path.join(path.dirname(filename), 'alias.bin'));
    await expect(f.storage.putResource(prefix, resource(data), filename)).rejects.toMatchObject({ code: 'STORAGE_SOURCE_UNSAFE' });
    expect(f.client.putObject).not.toHaveBeenCalled();
  });

  it.skipIf(process.platform === 'win32')('rejects a symlink ancestor before any object write', async () => {
    const f = fake(); const data = Buffer.from('known'); const filename = await file(data);
    const alias = path.join(path.dirname(filename), 'alias');
    await fs.symlink(path.dirname(filename), alias);
    await expect(f.storage.putResource(prefix, resource(data), path.join(alias, 'raw.bin'))).rejects.toMatchObject({ code: 'STORAGE_SOURCE_UNSAFE' });
    expect(f.client.putObject).not.toHaveBeenCalled();
  });

  it.skipIf(process.platform === 'win32')('rejects a FIFO before opening or touching object storage', async () => {
    const f = fake(); const data = Buffer.from('known'); const filename = await file(data);
    await fs.unlink(filename); execFileSync('mkfifo', [filename]);
    await expect(f.storage.putResource(prefix, resource(data), filename)).rejects.toMatchObject({ code: 'STORAGE_SOURCE_UNSAFE' });
    expect(f.client.statObject).not.toHaveBeenCalled();
  });

  it('requires exact resource bytes instead of ETag or size alone', async () => {
    const f = fake(); const data = Buffer.from('known'); const r = resource(data);
    f.objects.set(prefix + r.path, Buffer.from('other'));
    await expect(f.storage.verifyResources(prefix, [r])).rejects.toMatchObject({ code: 'STORAGE_INTEGRITY_FAILED' });
  });

  it('rejects absent resources with a safe error', async () => {
    const f = fake(); const error = await f.storage.verifyResources(prefix, [resource(Buffer.from('known'))]).catch((value: unknown) => value);
    expect(error).toMatchObject({ code: 'STORAGE_UNAVAILABLE', message: 'Private model storage operation failed.' });
  });

  it('rejects invalid prefixes, duplicate paths, and inventories over hard limits', async () => {
    const f = fake(); const r = resource(Buffer.from('known'));
    expect(() => f.storage.prefix('../escape', versionId)).toThrow();
    await expect(f.storage.removeUnpublished(prefix + '../')).rejects.toMatchObject({ code: 'STORAGE_PREFIX_INVALID' });
    await expect(f.storage.verifyResources(prefix, [r, r])).rejects.toMatchObject({ code: 'STORAGE_RESOURCE_INVALID' });
    await expect(f.storage.verifyResources(prefix, [{ ...r, bytes: 2 * 1024 ** 3 + 1 }])).rejects.toMatchObject({ code: 'STORAGE_RESOURCE_INVALID' });
    expect(f.client.listObjectsV2).not.toHaveBeenCalled();
  });

  it('checks the whole cleanup inventory before deleting anything', async () => {
    const f = fake(); f.hooks.listing = [{ name: prefix + 'resources/a.bin' }, { name: 'other-project/resources/b.bin' }];
    await expect(f.storage.removeUnpublished(prefix)).rejects.toMatchObject({ code: 'STORAGE_CLEANUP_UNSAFE' });
    expect(f.removed).toEqual([]);
  });

  it('deletes only the exact caller-owned unpublished prefix', async () => {
    const f = fake(); const key = prefix + 'resources/a.bin';
    f.objects.set(key, Buffer.from('owned')); f.objects.set('another-prefix/ready', Buffer.from('ready'));
    await f.storage.removeUnpublished(prefix);
    expect(f.removed).toEqual([key]); expect(f.objects.get('another-prefix/ready')?.toString()).toBe('ready');
  });

  it('aborts every owned multipart ID including multiple IDs for one key, preserving foreign uploads', async () => {
    const f = fake(); const key = prefix + 'resources/a.bin';
    for (const uploadId of ['first', 'second']) f.uploads.set(`${key}\n${uploadId}`, { key, uploadId });
    f.uploads.set('foreign\nsentinel', { key: 'foreign/resources/a.bin', uploadId: 'sentinel' });
    f.objects.set(key, Buffer.from('partial-completed'));
    await f.storage.removeUnpublished(prefix);
    expect(f.aborted).toEqual(['first', 'second']); expect(f.removed).toEqual([key]);
    expect([...f.uploads.values()]).toEqual([{ key: 'foreign/resources/a.bin', uploadId: 'sentinel' }]);
    expect(f.client.listIncompleteUploads).toHaveBeenCalledTimes(2);
  });

  it('freshly relists bounded first-page batches instead of trusting SDK same-key pagination', async () => {
    const f = fake(); const key = prefix + 'resources/a.bin';
    for (let i = 0; i < 1_025; i += 1) { const uploadId = `part-${i}`; f.uploads.set(`${key}\n${uploadId}`, { key, uploadId }); }
    await f.storage.removeUnpublished(prefix);
    expect(f.aborted).toHaveLength(1_025); expect(f.uploads.size).toBe(0);
    expect(f.client.listIncompleteUploads).toHaveBeenCalledTimes(4);
  });

  it('validates multipart keys and IDs before deleting complete objects or aborting any upload', async () => {
    for (const bad of [{ key: prefix + 'resources/../escape', uploadId: 'safe' }, { key: prefix + 'resources/a.bin', uploadId: 'bad&uploadId=other' }]) {
      const f = fake(); f.objects.set(prefix + 'resources/a.bin', Buffer.from('owned')); f.hooks.incomplete = [bad];
      await expect(f.storage.removeUnpublished(prefix)).rejects.toMatchObject({ code: 'STORAGE_CLEANUP_UNSAFE' });
      expect(f.removed).toEqual([]); expect(f.aborted).toEqual([]);
    }
  });

  it('fails closed when a removed multipart ID remains visible instead of looping or hiding cleanup failure', async () => {
    const f = fake(); f.hooks.incomplete = [{ key: prefix + 'resources/a.bin', uploadId: 'stuck' }];
    await expect(f.storage.removeUnpublished(prefix)).rejects.toMatchObject({ code: 'STORAGE_CLEANUP_UNSAFE' });
    expect(f.aborted).toEqual(['stuck']);
  });

  it('does not mistake an empty directory-prefix MPU listing for an empty owned upload inventory', async () => {
    const f = fake(); const key = prefix + 'resources/a.bin';
    f.uploads.set(`${key}\nowned`, { key, uploadId: 'owned' });
    f.client.listIncompleteUploads.mockImplementation((_bucket, requested) => Readable.from(requested ? [] : [...f.uploads.values()]));
    await f.storage.removeUnpublished(prefix);
    expect(f.aborted).toEqual(['owned']);
    expect(f.client.listIncompleteUploads).toHaveBeenCalledWith('test-models', '', true);
  });

  it('fails closed on repeating foreign MPU pagination without touching foreign or owned data', async () => {
    const f = fake(); f.objects.set(prefix + 'resources/a.bin', Buffer.from('owned'));
    f.hooks.incomplete = [{ key: 'foreign/key', uploadId: 'same' }, { key: 'foreign/key', uploadId: 'same' }];
    await expect(f.storage.removeUnpublished(prefix)).rejects.toMatchObject({ code: 'STORAGE_CLEANUP_UNSAFE' });
    expect(f.removed).toEqual([]); expect(f.aborted).toEqual([]);
  });

  it('forwards an upload input error into an SDK-style pipe even when setup attaches that pipe late', async () => {
    const f = fake(); const data = Buffer.from('known'); const controller = new AbortController();
    let entered!: (input: Readable) => void; const started = new Promise<Readable>((resolve) => { entered = resolve; });
    let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
    let destinationClosed = false;
    f.client.putObject.mockImplementation(async (_bucket, _key, input) => {
      entered(input); await gate;
      const destination = new PassThrough();
      destination.once('close', () => { destinationClosed = true; });
      input.pipe(destination);
      for await (const chunk of destination) { void chunk; }
    });
    const pending = expect(f.storage.putResource(prefix, resource(data), await file(data), controller.signal)).rejects.toMatchObject({ code: 'IMPORT_ABORTED' });
    const input = await started; controller.abort(); await new Promise((resolve) => setImmediate(resolve));
    expect(input.destroyed).toBe(true); release(); await pending;
    expect(destinationClosed).toBe(true); expect(f.objects.size).toBe(0);
  });

  it('aborts before touching the source or storage', async () => {
    const f = fake(); const controller = new AbortController(); controller.abort();
    await expect(f.storage.putResource(prefix, resource(Buffer.from('x')), '/not-read', controller.signal)).rejects.toMatchObject({ code: 'IMPORT_ABORTED' });
    expect(f.client.statObject).not.toHaveBeenCalled();
  });

  it('ends a stalled readback at the total storage deadline', async () => {
    const f = fake(); const data = Buffer.from('known'); const r = resource(data);
    f.objects.set(prefix + r.path, data);
    f.client.getObject.mockImplementation(async () => new Readable({ read() {} }));
    vi.useFakeTimers();
    try {
      const pending = expect(f.storage.verifyResources(prefix, [r])).rejects.toMatchObject({ code: 'STORAGE_TIMEOUT' });
      await vi.advanceTimersByTimeAsync(600_000);
      await pending;
    } finally { vi.useRealTimers(); }
  });

  it('ends a stalled multipart cleanup listing at the same total storage deadline', async () => {
    const f = fake(); f.client.listIncompleteUploads.mockReturnValue(new Readable({ read() {} }));
    vi.useFakeTimers();
    try {
      const pending = expect(f.storage.removeUnpublished(prefix)).rejects.toMatchObject({ code: 'STORAGE_TIMEOUT' });
      await vi.advanceTimersByTimeAsync(600_000); await pending;
      expect(f.aborted).toEqual([]); expect(f.removed).toEqual([]);
    } finally { vi.useRealTimers(); }
  });

  it('does not schedule an SDK retry after an actual retryable HTTP failure', async () => {
    let puts = 0;
    const server = http.createServer((request, response) => {
      if (request.url?.includes('location')) { response.setHeader('Content-Type', 'application/xml'); response.end('<LocationConstraint>us-east-1</LocationConstraint>'); return; }
      if (request.method === 'HEAD') { response.statusCode = 404; response.end(); return; }
      if (request.method === 'PUT') { puts += 1; request.resume(); request.on('end', () => { response.statusCode = 503; response.setHeader('Content-Type', 'application/xml'); response.end('<Error><Code>SlowDown</Code><Message>synthetic fixture</Message></Error>'); }); return; }
      response.statusCode = 500; response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('No fixture port');
    synthetic.objectStorage.port = address.port;
    try {
      const data = Buffer.alloc(32 * 1024, 7);
      await expect(createModelStorage({ bucket: 'test-models' }).putResource(prefix, resource(data), await file(data))).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
      expect(puts).toBe(1);
    } finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
  });

  it('destroys an actual pending MinIO HTTP response when its caller aborts', async () => {
    const controller = new AbortController(); let pendingResponseClosed = false;
    const server = http.createServer((request, response) => {
      if (request.url?.includes('location')) {
        response.setHeader('Content-Type', 'application/xml'); response.end('<LocationConstraint>us-east-1</LocationConstraint>'); return;
      }
      if (request.method === 'HEAD') { response.statusCode = 404; response.end(); return; }
      if (request.method === 'PUT') {
        response.on('close', () => { pendingResponseClosed = true; });
        request.resume(); request.on('end', () => controller.abort()); return;
      }
      response.statusCode = 500; response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('No fixture port');
    synthetic.objectStorage.port = address.port;
    try {
      const storage = createModelStorage({ bucket: 'test-models' }); const data = Buffer.alloc(256 * 1024, 7);
      await expect(storage.putResource(prefix, resource(data), await file(data), controller.signal)).rejects.toMatchObject({ code: 'IMPORT_ABORTED' });
      for (let i = 0; i < 20 && !pendingResponseClosed; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
      expect(pendingResponseClosed).toBe(true);
    } finally {
      server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
