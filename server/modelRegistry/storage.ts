import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import os from 'node:os';
import { Transform, type Readable, type Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Client } from 'minio';
import { config } from '../config.js';

const MAX_RESOURCES = 100_000;
const MAX_FILE_BYTES = 2 * 1024 ** 3;
const MAX_TOTAL_BYTES = 8 * 1024 ** 3;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const PREFIX = new RegExp(`^projects/(${UUID})/versions/(${UUID})/$`);
const OPERATION_IDLE_MS = 120_000;
const OPERATION_MAX_MS = 600_000;
const MULTIPART_BATCH_SIZE = 512;

export type ModelResource = { path: string; bytes: number; sha256: string };

export type ModelStorageClient = {
  bucketExists(bucket: string): Promise<boolean>;
  makeBucket(bucket: string): Promise<unknown>;
  getBucketPolicy(bucket: string): Promise<string>;
  statObject(bucket: string, key: string): Promise<{ size: number }>;
  putObject(
    bucket: string,
    key: string,
    data: Readable,
    size: number,
    metadata: Record<string, string>,
  ): Promise<unknown>;
  getObject(bucket: string, key: string): Promise<Readable>;
  listObjectsV2(bucket: string, prefix: string, recursive: boolean): Readable;
  listIncompleteUploads(bucket: string, prefix: string, recursive: boolean): Readable;
  abortMultipartUpload(bucket: string, key: string, uploadId: string): Promise<void>;
  removeObject(bucket: string, key: string): Promise<unknown>;
};

export type ModelStorage = {
  initialize(): Promise<void>;
  prefix(projectId: string, versionId: string): string;
  putResource(prefix: string, resource: ModelResource, filename: string, signal?: AbortSignal): Promise<void>;
  verifyResources(prefix: string, resources: readonly ModelResource[], signal?: AbortSignal): Promise<{ resourceCount: number; totalBytes: number }>;
  /** Caller must hold the import DB lock and prove this prefix is owned and unpublished. */
  removeUnpublished(prefix: string): Promise<void>;
};

export interface VerifiedModelResource {
  handle: import('node:fs/promises').FileHandle;
  bytes: number;
  close(): Promise<void>;
}
export interface ModelResourceReader {
  /** Full raw SHA/length verification completes before returning this pinned private handle. */
  readVerifiedResource(prefix: string, resource: ModelResource, signal?: AbortSignal): Promise<VerifiedModelResource>;
}

export class ModelStorageError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'ModelStorageError';
  }
}

function fail(code: string, message: string): never { throw new ModelStorageError(code, message); }
const abortCheck = (signal?: AbortSignal): void => {
  if (signal?.aborted) fail('IMPORT_ABORTED', 'Model storage operation was interrupted.');
};
const checkPrefix = (prefix: string): string => {
  if (typeof prefix !== 'string' || !PREFIX.test(prefix)) {
    fail('STORAGE_PREFIX_INVALID', 'Model storage prefix is invalid.');
  }
  return prefix;
};
const checkResource = (resource: ModelResource): void => {
  // The public verifier validates the package. These checks only constrain private storage keys.
  if (!resource || typeof resource.path !== 'string' || !resource.path.startsWith('resources/') ||
      resource.path.includes('\\') || /[\u0000-\u001f\u007f?#%:]/u.test(resource.path) ||
      resource.path.split('/').some((part) => !part || part === '.' || part === '..') ||
      !Number.isSafeInteger(resource.bytes) || resource.bytes < 0 || resource.bytes > MAX_FILE_BYTES ||
      !/^[a-f0-9]{64}$/.test(resource.sha256)) {
    fail('STORAGE_RESOURCE_INVALID', 'Model resource identity is invalid.');
  }
};
const errorCode = (error: unknown): string | undefined =>
  error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined;
const absent = (error: unknown): boolean => ['NoSuchKey', 'NotFound', 'NoSuchObject'].includes(errorCode(error) ?? '');

async function noLinks(filename: string): Promise<void> {
  const absolute = path.resolve(filename);
  const real = await fs.realpath(absolute);
  if (real !== absolute) fail('STORAGE_SOURCE_UNSAFE', 'Model resource source must use its canonical local path.');
  let current = absolute;
  for (;;) {
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink() || (current === absolute ? !stat.isFile() : !stat.isDirectory())) {
      fail('STORAGE_SOURCE_UNSAFE', 'Model resource source contains a link or a special file.');
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

const stamp = (stat: BigIntStats): string =>
  [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs, stat.nlink].join(':');

// MinIO 8 pipes this input into its multipart buffer without forwarding input
// errors. Retain terminal state for a pipe attached after asynchronous setup.
class UploadInput extends Transform {
  private terminalError: Error | undefined;
  private readonly destinations = new Set<Writable>();

  override pipe<T extends NodeJS.WritableStream>(destination: T, options?: { end?: boolean }): T {
    const target = destination as unknown as Writable;
    this.destinations.add(target);
    const ignoreError = (): void => {};
    target.on('error', ignoreError);
    target.once('close', () => { this.destinations.delete(target); target.off('error', ignoreError); });
    const result = super.pipe(destination, options);
    if (this.terminalError) target.destroy(this.terminalError);
    return result;
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    if (error || !this.readableEnded) {
      this.terminalError ??= error ?? new ModelStorageError('IMPORT_ABORTED', 'Model upload input closed before completion.');
      for (const destination of this.destinations) destination.destroy(this.terminalError);
    }
    super._destroy(error, callback);
  }
}

export function createModelStorage(options: { client?: ModelStorageClient; bucket?: string } = {}): ModelStorage & ModelResourceReader {
  const bucket = options.bucket ?? process.env.WFC_MODEL_BUCKET ?? 'wfc-models';
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) fail('STORAGE_BUCKET_INVALID', 'Private model bucket name is invalid.');
  const requestContext = new AsyncLocalStorage<{ signal: AbortSignal; pending: Set<Promise<void>> }>();
  const transport = config.objectStorage.useSSL ? https : http;
  const client: ModelStorageClient = options.client ?? new Client({
    endPoint: config.objectStorage.endpoint,
    port: config.objectStorage.port,
    useSSL: config.objectStorage.useSSL,
    accessKey: config.objectStorage.accessKey,
    secretKey: config.objectStorage.secretKey,
    // SDK retry backoff has no abort signal. Keep this dedicated client's
    // terminal boundary free of deferred requests; the shared WFC client is unchanged.
    retryOptions: { disableRetry: true },
    transport: {
      request: ((requestOptions: http.RequestOptions, callback?: (response: http.IncomingMessage) => void) => {
        const context = requestContext.getStore();
        const request = transport.request({ ...requestOptions, signal: context?.signal }, callback);
        if (context) {
          const closed = new Promise<void>((resolve) => request.once('close', resolve));
          context.pending.add(closed);
          void closed.then(() => { context.pending.delete(closed); });
        }
        request.setTimeout(OPERATION_IDLE_MS, () => request.destroy(new ModelStorageError('STORAGE_TIMEOUT', 'Model storage request timed out.')));
        return request;
      }) as typeof http.request,
    },
  });

  const operation = async <T>(signal: AbortSignal | undefined, callback: (active: AbortSignal, cancel: () => void) => Promise<T>): Promise<T> => {
    abortCheck(signal);
    const controller = new AbortController();
    const active = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const context = { signal: active, pending: new Set<Promise<void>>() };
    const timer = setTimeout(() => controller.abort(new ModelStorageError('STORAGE_TIMEOUT', 'Model storage operation timed out.')), OPERATION_MAX_MS);
    timer.unref();
    try {
      return await requestContext.run(context, () => callback(active, () => controller.abort()));
    } catch (error) {
      controller.abort();
      abortCheck(signal);
      if (error instanceof ModelStorageError) throw error;
      if (controller.signal.reason instanceof ModelStorageError) throw controller.signal.reason;
      if (errorCode(error) === 'ENOSPC' || errorCode(error) === 'EDQUOT') fail('STORAGE_EXHAUSTED','Private model storage space is exhausted.');
      fail('STORAGE_UNAVAILABLE', 'Private model storage operation failed.');
    } finally {
      controller.abort();
      // An SDK Promise.all can reject while its other branch still owns HTTP.
      // Every later request inherits the aborted signal; drain existing closes.
      while (context.pending.size) await Promise.allSettled([...context.pending]);
      clearTimeout(timer);
    }
  };

  const readback = async (prefix: string, resource: ModelResource, signal: AbortSignal): Promise<void> => {
    abortCheck(signal);
    const key = checkPrefix(prefix) + resource.path;
    const stat = await client.statObject(bucket, key);
    if (stat.size !== resource.bytes) fail('STORAGE_INTEGRITY_FAILED', 'Stored model resource has an unexpected size.');
    const stream = await client.getObject(bucket, key);
    const abort = (): void => { stream.destroy(signal.reason instanceof ModelStorageError ? signal.reason : new ModelStorageError('IMPORT_ABORTED', 'Model storage operation was interrupted.')); };
    signal.addEventListener('abort', abort, { once: true });
    let bytes = 0;
    const hash = createHash('sha256');
    try {
      abortCheck(signal);
      for await (const chunk of stream) {
        abortCheck(signal);
        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += data.length;
        if (bytes > resource.bytes) fail('STORAGE_INTEGRITY_FAILED', 'Stored model resource exceeds its verified size.');
        hash.update(data);
      }
      if (bytes !== resource.bytes || hash.digest('hex') !== resource.sha256) {
        fail('STORAGE_INTEGRITY_FAILED', 'Stored model resource failed its byte identity check.');
      }
    } finally {
      signal.removeEventListener('abort', abort);
      stream.destroy();
    }
  };

  return {
    async readVerifiedResource(prefix, resource, signal) {
      checkPrefix(prefix); checkResource(resource);
      let directory: string | undefined;
      let handle: import('node:fs/promises').FileHandle | undefined;
      try {
        return await operation(signal, async active => {
          const key = prefix + resource.path;
          let stat: { size: number };
          try { stat = await client.statObject(bucket,key); }
          catch (error) { if (absent(error)) fail('STORAGE_INTEGRITY_FAILED','Stored model resource is missing.'); throw error; }
          if (stat.size !== resource.bytes) fail('STORAGE_INTEGRITY_FAILED','Stored model resource has an unexpected size.');
          directory = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'wfc-viewer-resource-'));
          await fs.chmod(directory,0o700);
          const filename = path.join(directory,'raw');
          handle = await fs.open(filename,'wx+',0o600);
          const output = handle;
          let source: Readable;
          try { source = await client.getObject(bucket,key); }
          catch (error) { if (absent(error)) fail('STORAGE_INTEGRITY_FAILED','Stored model resource is missing.'); throw error; }
          const abort = (): void => { source.destroy(active.reason instanceof Error ? active.reason : new Error('Interrupted model read')); };
          active.addEventListener('abort',abort,{once:true});
          let count = 0; const hash = createHash('sha256');
          try {
            abortCheck(active);
            for await (const chunk of source) {
              abortCheck(active);
              const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
              count += data.length;
              if (count > resource.bytes) fail('STORAGE_INTEGRITY_FAILED','Stored model resource exceeds its verified size.');
              hash.update(data);
              let offset = 0;
              while (offset < data.length) {
                abortCheck(active);
                const written = await output.write(data,offset,data.length-offset);
                if (!written.bytesWritten) fail('STORAGE_UNAVAILABLE','Private resource spool could not be written.');
                offset += written.bytesWritten;
              }
            }
            if (count !== resource.bytes || hash.digest('hex') !== resource.sha256) fail('STORAGE_INTEGRITY_FAILED','Stored model resource failed its byte identity check.');
            await output.chmod(0o400);
            const ready = await output.stat();
            if (!ready.isFile() || ready.size !== resource.bytes || ready.nlink !== 1) fail('STORAGE_INTEGRITY_FAILED','Private resource spool changed.');
            // POSIX unlink-on-open reclaims bytes even if this process is forcibly killed.
            // Windows may retain the private name until the same pinned handle is closed.
            try { await fs.unlink(filename); } catch (error) { if (process.platform !== 'win32' || !['EPERM','EACCES'].includes(errorCode(error) ?? '')) throw error; }
            abortCheck(active);
            const ownedDirectory = directory;
            let closed = false;
            return { handle: output,bytes: resource.bytes,async close() {
              if (closed) return; closed = true;
              try { await output.close(); } finally { await fs.rm(ownedDirectory,{recursive:true,force:true}); }
            } };
          } finally { active.removeEventListener('abort',abort); source.destroy(); }
        });
      } catch (error) {
        try { await handle?.close(); } finally { if (directory) await fs.rm(directory,{recursive:true,force:true}); }
        throw error;
      }
    },
    async initialize() {
      return operation(undefined, async () => {
        if (!await client.bucketExists(bucket)) {
          try { await client.makeBucket(bucket); }
          catch (error) {
            if (!['BucketAlreadyOwnedByYou', 'BucketAlreadyExists'].includes(errorCode(error) ?? '') || !await client.bucketExists(bucket)) throw error;
          }
        }
        try {
          const policy = await client.getBucketPolicy(bucket);
          // This dedicated bucket uses authenticated access only. Never change an existing policy.
          if (policy.trim()) fail('STORAGE_BUCKET_NOT_PRIVATE', 'The dedicated model bucket must have no bucket policy.');
        } catch (error) {
          if (errorCode(error) !== 'NoSuchBucketPolicy') throw error;
        }
      });
    },
    prefix(projectId, versionId) {
      return checkPrefix(`projects/${projectId}/versions/${versionId}/`);
    },
    async putResource(prefix, resource, filename, signal) {
      checkPrefix(prefix);
      checkResource(resource);
      return operation(signal, async (active, cancel) => {
        await noLinks(filename);
        const handle = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
        try {
          const before = await handle.stat({ bigint: true });
          if (!before.isFile() || before.nlink !== 1n || before.size !== BigInt(resource.bytes)) {
            fail('STORAGE_SOURCE_UNSAFE', 'Model resource source is not an unchanged private regular file.');
          }
          const identity = stamp(before);
          const key = prefix + resource.path;
          let exists = false;
          try { await client.statObject(bucket, key); exists = true; }
          catch (error) { if (!absent(error)) throw error; }

          const hash = createHash('sha256');
          let count = 0;
          const meter = new UploadInput({
            transform(chunk: Buffer, _encoding, done) {
              count += chunk.length;
              if (count > resource.bytes) return done(new ModelStorageError('STORAGE_SOURCE_CHANGED', 'Model resource source changed during upload.'));
              hash.update(chunk);
              done(null, chunk);
            },
            flush(done) {
              if (count !== resource.bytes || hash.digest('hex') !== resource.sha256) return done(new ModelStorageError('STORAGE_SOURCE_CHANGED', 'Model resource source does not match its verified identity.'));
              done();
            },
          });
          const source = handle.createReadStream({ autoClose: false, start: 0 });
          const pumping = pipeline(source, meter, { signal: active });
          const abortInput = (): void => { meter.destroy(active.reason instanceof Error ? active.reason : new ModelStorageError('IMPORT_ABORTED', 'Model storage operation was interrupted.')); };
          active.addEventListener('abort', abortInput, { once: true });
          if (active.aborted) abortInput();
          let putting: Promise<unknown> | undefined;
          try {
            if (exists) {
              // Drain and validate the same local handle even when a known object is reused.
              for await (const chunk of meter) { void chunk; abortCheck(active); }
              await pumping;
              await readback(prefix, resource, active);
            } else {
              putting = client.putObject(bucket, key, meter, resource.bytes, { 'Content-Type': 'application/octet-stream' });
              await Promise.all([pumping, putting]);
            }
          } catch (error) {
            cancel();
            source.destroy(); meter.destroy();
            await Promise.allSettled([pumping, ...(putting ? [putting] : [])]);
            throw error;
          } finally { active.removeEventListener('abort', abortInput); meter.destroy(); }
          const after = await handle.stat({ bigint: true });
          if (identity !== stamp(after)) fail('STORAGE_SOURCE_CHANGED', 'Model resource source changed during upload.');
          await noLinks(filename);
          const named = await fs.stat(filename, { bigint: true });
          if (identity !== stamp(named)) fail('STORAGE_SOURCE_CHANGED', 'Model resource source was replaced during upload.');
          abortCheck(active);
        } finally { await handle.close(); }
      });
    },
    async verifyResources(prefix, resources, signal) {
      checkPrefix(prefix);
      if (!Array.isArray(resources) || resources.length < 1 || resources.length > MAX_RESOURCES) fail('STORAGE_RESOURCE_INVALID', 'Model resource inventory size is invalid.');
      let totalBytes = 0;
      const names = new Set<string>();
      for (const resource of resources) {
        checkResource(resource);
        const name = resource.path.toLowerCase();
        if (names.has(name)) fail('STORAGE_RESOURCE_INVALID', 'Model resource inventory contains a duplicate key.');
        names.add(name);
        totalBytes += resource.bytes;
        if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_TOTAL_BYTES) fail('STORAGE_RESOURCE_INVALID', 'Model resource inventory exceeds its storage limit.');
      }
      return operation(signal, async (active) => {
        for (const resource of resources) await readback(prefix, resource, active);
        return { resourceCount: resources.length, totalBytes };
      });
    },
    async removeUnpublished(prefix) {
      checkPrefix(prefix);
      return operation(undefined, async (active) => {
        const removed = new Set<string>();
        const aborted = new Set<string>();
        let scannedUploads = 0;
        const validateKey = (key: unknown): string => {
          if (typeof key !== 'string' || !key.startsWith(prefix)) fail('STORAGE_CLEANUP_UNSAFE', 'Model cleanup inventory is outside its owned bound.');
          try { checkResource({ path: key.slice(prefix.length), bytes: 0, sha256: '0'.repeat(64) }); }
          catch { fail('STORAGE_CLEANUP_UNSAFE', 'Model cleanup resource identity is invalid.'); }
          return key;
        };
        const consume = async (stream: Readable, visit: (entry: unknown) => boolean): Promise<void> => {
          const abort = (): void => { stream.destroy(active.reason instanceof Error ? active.reason : new ModelStorageError('STORAGE_TIMEOUT', 'Model cleanup timed out.')); };
          active.addEventListener('abort', abort, { once: true });
          try {
            abortCheck(active);
            for await (const entry of stream) { abortCheck(active); if (!visit(entry)) break; }
          } finally { active.removeEventListener('abort', abort); stream.destroy(); }
        };
        for (;;) {
          const keys = new Set<string>();
          const uploads = new Map<string, { key: string; uploadId: string }>();
          const seenUploads = new Set<string>();
          await consume(client.listObjectsV2(bucket, prefix, true), (entry) => {
            const key = validateKey((entry as { name?: unknown }).name);
            if (keys.has(key) || removed.has(key) || removed.size + keys.size >= MAX_RESOURCES) fail('STORAGE_CLEANUP_UNSAFE', 'Model cleanup inventory exceeds its owned bound.');
            keys.add(key); return true;
          });
          // MinIO's MPU prefix API matches an exact object key, not a directory.
          // Recovery can outlive deleted project manifests, so inspect bounded
          // bucket-root MPU metadata and select only this proven owned prefix.
          await consume(client.listIncompleteUploads(bucket, '', true), (entry) => {
            const upload = entry as { key?: unknown; uploadId?: unknown };
            scannedUploads += 1;
            if (scannedUploads > MAX_RESOURCES || typeof upload.key !== 'string' || !upload.key || Buffer.byteLength(upload.key) > 1024) fail('STORAGE_CLEANUP_UNSAFE', 'Model multipart inventory exceeds its inspection bound.');
            if (typeof upload.uploadId !== 'string' || !/^[A-Za-z0-9_.~+/=-]{1,2048}$/.test(upload.uploadId)) fail('STORAGE_CLEANUP_UNSAFE', 'Model multipart cleanup identity is invalid.');
            const identity = createHash('sha256').update(upload.key).update('\0').update(upload.uploadId).digest('hex');
            if (seenUploads.has(identity)) fail('STORAGE_CLEANUP_UNSAFE', 'Model multipart pagination did not advance.');
            seenUploads.add(identity);
            // Foreign metadata is never returned, persisted, aborted or removed.
            if (!upload.key.startsWith(prefix)) return true;
            const key = validateKey(upload.key);
            if (aborted.has(identity) || aborted.size + uploads.size >= MAX_RESOURCES) fail('STORAGE_CLEANUP_UNSAFE', 'Model multipart cleanup exceeds its owned bound.');
            uploads.set(identity, { key, uploadId: upload.uploadId });
            // The installed SDK loses same-key upload-ID continuation markers.
            // Stop within its first page, remove only validated IDs, then relist.
            return uploads.size < MULTIPART_BATCH_SIZE;
          });
          if (!keys.size && !uploads.size) return;
          // Validate both inventories before this batch mutates any owned data.
          for (const [identity, upload] of uploads) {
            abortCheck(active);
            try { await client.abortMultipartUpload(bucket, upload.key, upload.uploadId); }
            catch (error) { if (errorCode(error) !== 'NoSuchUpload') throw error; }
            aborted.add(identity);
          }
          for (const key of keys) { abortCheck(active); await client.removeObject(bucket, key); removed.add(key); }
          // A concurrent completion response may have been lost: recheck both
          // complete objects and all remaining multipart IDs from the beginning.
        }
      });
    },
  };
}
