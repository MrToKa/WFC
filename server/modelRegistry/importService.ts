import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { IncomingMessage } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { DEFAULT_LIMITS, verifyPackage } from '../vendor/routings-model-package/index.mjs';
import { ModelRegistryError } from './errors.js';
import type { ModelRegistryRepository } from './repository.js';
import type { ModelStorage } from './storage.js';
import { toImportDto, toVersionDto } from './types.js';
import type { ImportRecord, ModelFailure, VersionRecord } from './types.js';

export type ImportFaultPoint = 'afterReceive' | 'afterVerify' | 'afterReservation' |
  'afterResourceWrite' | 'beforeReadback' | 'beforePublish' | 'afterPublish';
export interface ReceiveInput {
  projectId: string;
  requestedBy: string;
  idempotencyKey: string;
  archiveSha256: string;
  expectedBytes: number | null;
  continueUpload?: () => void;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PACKAGE_FAILURES = new Set(['UNSUPPORTED_SCHEMA', 'UNSUPPORTED_PROFILE', 'INVALID_MANIFEST', 'UNSAFE_PATH',
  'EXECUTABLE_CONTENT', 'EXTERNAL_REFERENCE', 'RESOURCE_MISSING', 'RESOURCE_UNEXPECTED', 'RESOURCE_HASH_MISMATCH',
  'RESOURCE_SIZE_MISMATCH', 'FINGERPRINT_MISMATCH', 'RESOURCE_CHANGED', 'PACKAGE_LIMIT_EXCEEDED', 'STORAGE_EXHAUSTED']);
const failure = (error: unknown): ModelFailure => {
  if (error instanceof ModelRegistryError) return { code: error.code, message: error.message };
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  const mapped = PACKAGE_FAILURES.has(code) ? code : code === 'ENOSPC' || code === 'EDQUOT' ? 'STORAGE_EXHAUSTED' :
    code.startsWith('STORAGE_') ? 'STORAGE_READBACK_FAILED' :
    ['IMPORT_ABORTED', 'ABORT_ERR', 'PACKAGE_ABORTED'].includes(code) ? 'IMPORT_INTERRUPTED' : 'VERIFICATION_FAILED';
  const safe = new ModelRegistryError(mapped);
  return { code: safe.code, message: safe.message };
};

/** Dependencies/fault hooks are constructor-only test seams; never supplied by HTTP or environment. */
export function createModelImportService(options: {
  repository: ModelRegistryRepository;
  storage: ModelStorage;
  workRoot?: string;
  maxConcurrent?: number;
  verify?: typeof verifyPackage;
  fault?: (point: ImportFaultPoint, context: { job: ImportRecord; version?: VersionRecord }) => Promise<void>;
}) {
  const { repository, storage } = options;
  const verify = options.verify ?? verifyPackage;
  const root = path.resolve(options.workRoot ?? process.env.WFC_MODEL_IMPORT_ROOT ??
    (process.platform === 'win32' ? '.data/model-imports' : '/var/lib/wfc/model-imports'));
  const maximum = options.maxConcurrent ?? 1;
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 2) throw new Error('Invalid import concurrency');
  const active = new Map<string, AbortController>();
  const pending = new Set<Promise<void>>();
  const receivers = new Set<Promise<void>>();
  let stopped = false;
  let ready = false;
  let occupied = 0;
  let recovering: Promise<void> | undefined;
  let recoveryTimer: ReturnType<typeof setInterval> | undefined;
  const jobDirectory = (job: Pick<ImportRecord, 'id' | 'ownerToken'>): string => {
    if (!UUID.test(job.id) || !UUID.test(job.ownerToken)) throw new ModelRegistryError('IMPORT_FENCED', 409);
    return path.join(root, job.id);
  };
  async function cleanupLocal(job: Pick<ImportRecord, 'id' | 'ownerToken'>): Promise<void> {
    const directory = jobDirectory(job);
    let exists = true;
    try { await fs.lstat(directory); }
    catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') exists = false;
      else throw error;
    }
    if (!exists) { await repository.markStagingCleaned(job.id, job.ownerToken); return; }
    if (await fs.realpath(directory) !== directory) throw new Error('Unowned staging path');
    const marker = path.join(directory, '.owner.json');
    const stat = await fs.lstat(marker);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 1024) throw new Error('Unowned staging marker');
    const owner = JSON.parse(await fs.readFile(marker, 'utf8')) as { id?: string; token?: string };
    if (owner.id !== job.id || owner.token !== job.ownerToken) throw new Error('Unowned staging directory');
    await fs.rm(directory, { recursive: true });
    await repository.markStagingCleaned(job.id, job.ownerToken);
  }
  async function settleFailure(job: ImportRecord, error: unknown): Promise<void> {
    // This read must succeed before any object removal: COMMIT may have succeeded despite a lost reply.
    const state = await repository.reconcile(job.id);
    if (state.published || state.job?.state === 'complete') {
      await cleanupLocal(job);
      return;
    }
    await repository.failImport(job, failure(error));
    if (state.ownership && !state.ownership.published && state.ownership.ownerToken === job.ownerToken) {
      await storage.removeUnpublished(state.ownership.storagePrefix);
    }
    await cleanupLocal(job);
    await repository.markCleaned(job.id, job.ownerToken);
  }
  async function processArchive(initial: ImportRecord, controller: AbortController): Promise<void> {
    let job = initial;
    try {
      const directory = jobDirectory(job);
      const archive = path.join(directory, 'archive.zip');
      job = await repository.updateProgress(job, 'validating');
      const report = await verify(archive, { extractTo: path.join(directory, 'extracted'), signal: controller.signal });
      if (report.package.sha256 !== job.archiveSha256 || report.package.bytes !== job.receivedBytes) {
        throw new ModelRegistryError('UPLOAD_HASH_MISMATCH');
      }
      await options.fault?.('afterVerify', { job });
      const deadline = Date.now() + DEFAULT_LIMITS.maxMs;
      let reservation = await repository.reserve(job, report);
      while (reservation.kind === 'busy') {
        if (Date.now() >= deadline) throw new ModelRegistryError('IMPORT_BUSY', 503);
        await delay(250, undefined, { signal: controller.signal });
        reservation = await repository.reserve(job, report);
      }
      if (reservation.kind === 'duplicate') {
        await cleanupLocal(job);
        return;
      }
      const { version, ownership } = reservation;
      if (ownership.storagePrefix !== storage.prefix(job.projectId, version.id)) throw new ModelRegistryError('IMPORT_FENCED', 409);
      await options.fault?.('afterReservation', { job, version });
      for (const resource of report.manifest.resources) {
        controller.signal.throwIfAborted();
        const filename = path.resolve(directory, 'extracted', resource.path);
        if (!filename.startsWith(path.join(directory, 'extracted') + path.sep)) throw new ModelRegistryError('VERIFICATION_FAILED');
        await storage.putResource(ownership.storagePrefix, resource, filename, controller.signal);
        await options.fault?.('afterResourceWrite', { job, version });
      }
      await options.fault?.('beforeReadback', { job, version });
      const readback = await storage.verifyResources(ownership.storagePrefix, report.manifest.resources, controller.signal);
      job = await repository.markPublishing(job);
      await options.fault?.('beforePublish', { job, version });
      await repository.publish(job, version, report, readback);
      await options.fault?.('afterPublish', { job, version });
      await cleanupLocal(job);
    } catch (error) {
      // Failure to reconcile deliberately retains ownership/staging for a later recovery.
      try { await settleFailure(job, error); }
      catch { console.error('Model import requires reconciliation', { importId: job.id }); }
    }
  }
  async function recover(): Promise<void> {
    if (recovering) return recovering;
    recovering = (async () => {
      for (const job of await repository.listRecoverableImports()) {
        const lock = await repository.tryLockImport(job.id);
        if (!lock) continue; // Another process is still receiving/verifying this job.
        try { await settleFailure(job, new ModelRegistryError('IMPORT_INTERRUPTED')); }
        catch { console.error('Model import recovery deferred', { importId: job.id }); }
        finally { await lock.release(); }
      }
      for (const ownership of await repository.listUnpublishedOwnership()) {
        const lock = await repository.tryLockImport(ownership.importId);
        if (!lock) continue;
        try {
          const state = await repository.reconcile(ownership.importId);
          // Existing jobs are handled above. Deleted-project ownership remains independently provable.
          if (!state.job && !state.published && state.ownership?.ownerToken === ownership.ownerToken) {
            await storage.removeUnpublished(ownership.storagePrefix);
            await cleanupLocal({ id: ownership.importId, ownerToken: ownership.ownerToken });
            await repository.markCleaned(ownership.importId, ownership.ownerToken);
          }
        } catch { console.error('Orphan model import recovery deferred', { importId: ownership.importId }); }
        finally { await lock.release(); }
      }
    })();
    try { await recovering; } finally { recovering = undefined; }
  }
  return {
    async initialize(): Promise<void> {
      if (ready) return;
      await fs.mkdir(root, { recursive: true, mode: 0o700 });
      const stat = await fs.lstat(root);
      if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(root) !== root) throw new Error('Unsafe model import root');
      await fs.chmod(root, 0o700);
      await storage.initialize();
      await recover();
      ready = true;
      recoveryTimer = setInterval(() => { void recover().catch(() => console.error('Model import recovery unavailable')); }, 60_000);
      recoveryTimer.unref();
    },
    recover,
    async receive(request: IncomingMessage, input: ReceiveInput): Promise<{ status: 200 | 202; job: ImportRecord }> {
      if (!ready || stopped) throw new ModelRegistryError('IMPORT_BUSY', 503);
      let admitted = false;
      let handedOff = false;
      let receivedDone!: () => void;
      const receiver = new Promise<void>(resolve => { receivedDone = resolve; });
      receivers.add(receiver);
      try {
      if (input.expectedBytes !== null && (!Number.isSafeInteger(input.expectedBytes) || input.expectedBytes < 1 || input.expectedBytes > DEFAULT_LIMITS.maxArchiveBytes)) {
        throw new ModelRegistryError('UPLOAD_LIMIT', 413);
      }
      const replay = await repository.findImportByRequest(input);
      if (stopped) throw new ModelRegistryError('IMPORT_INTERRUPTED', 503);
      if (replay) return { status: replay.state === 'complete' || replay.state === 'failed' ? 200 : 202, job: replay };
      // Reserve local capacity before beginImport can retain a pool connection for its session lock.
      // This keeps spare DB connections available for progress/failure/reconciliation under bursts.
      if (occupied >= maximum) throw new ModelRegistryError('IMPORT_BUSY', 503);
      occupied++;
      admitted = true;
      const begun = await repository.beginImport(input);
      let job = begun.job;
      if (begun.duplicate) {
        return { status: job.state === 'complete' || job.state === 'failed' ? 200 : 202, job };
      }
      const lock = begun.lock ?? await repository.tryLockImport(job.id);
      if (!lock) throw new ModelRegistryError('IMPORT_BUSY', 503);
      if (stopped) {
        try { await settleFailure(job, new ModelRegistryError('IMPORT_INTERRUPTED')); }
        finally { await lock.release(); }
        throw new ModelRegistryError('IMPORT_INTERRUPTED', 503);
      }
      const controller = new AbortController();
      active.set(job.id, controller);
      const interrupted = () => controller.abort(new ModelRegistryError('UPLOAD_INTERRUPTED'));
      request.once('aborted', interrupted);
      const timeout = setTimeout(() => controller.abort(new ModelRegistryError('UPLOAD_TIMEOUT', 408)), DEFAULT_LIMITS.maxMs);
      timeout.unref();
      let stagedBytes = 0;
      try {
        const directory = jobDirectory(job);
        await fs.mkdir(directory, { mode: 0o700 });
        await fs.writeFile(path.join(directory, '.owner.json'), JSON.stringify({ id: job.id, token: job.ownerToken }), { flag: 'wx', mode: 0o600 });
        input.continueUpload?.();
        const partial = path.join(directory, 'archive.part');
        const file = await fs.open(partial, 'wx', 0o600);
        let bytes = 0;
        let persisted = 0;
        const digest = createHash('sha256');
        const abortStream = () => request.destroy();
        controller.signal.addEventListener('abort', abortStream, { once: true });
        try {
          for await (const chunk of request) {
            controller.signal.throwIfAborted();
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            bytes += buffer.length;
            if (bytes > DEFAULT_LIMITS.maxArchiveBytes) throw new ModelRegistryError('UPLOAD_LIMIT', 413);
            digest.update(buffer);
            // FileHandle.write may write fewer bytes than requested.
            let offset = 0;
            while (offset < buffer.length) {
              const written = (await file.write(buffer, offset, buffer.length - offset)).bytesWritten;
              offset += written;
              stagedBytes += written;
            }
            if (bytes - persisted >= 8 * 1024 ** 2) {
              job = await repository.updateProgress(job, 'receiving', bytes);
              persisted = bytes;
            }
          }
          if (!request.complete || bytes === 0 || input.expectedBytes !== null && bytes !== input.expectedBytes) throw new ModelRegistryError('UPLOAD_INTERRUPTED');
          job = await repository.updateProgress(job, 'receiving', bytes);
          if (digest.digest('hex') !== input.archiveSha256) throw new ModelRegistryError('UPLOAD_HASH_MISMATCH');
          await file.sync();
          await file.chmod(0o400);
        } finally {
          controller.signal.removeEventListener('abort', abortStream);
          await file.close();
        }
        await fs.rename(partial, path.join(directory, 'archive.zip'));
        if (process.platform !== 'win32') {
          const dirHandle = await fs.open(directory, 'r');
          try { await dirHandle.sync(); } finally { await dirHandle.close(); }
        }
        job = await repository.updateProgress(job, 'staging', bytes);
        await options.fault?.('afterReceive', { job });
        controller.signal.throwIfAborted();
        if (stopped) throw new ModelRegistryError('IMPORT_INTERRUPTED', 503);
        const accepted = job;
        const work = processArchive(job, controller).finally(async () => {
          occupied--;
          active.delete(job.id);
          await lock.release();
        });
        pending.add(work);
        void work.finally(() => pending.delete(work)).catch(() => undefined);
        handedOff = true;
        return { status: 202, job: accepted };
      } catch (error) {
        if (job.state === 'receiving' && stagedBytes > job.receivedBytes) {
          try { job = await repository.updateProgress(job, 'receiving', stagedBytes); }
          catch { /* Reconciliation still fences failure/cleanup if progress persistence is unavailable. */ }
        }
        try { await settleFailure(job, error); }
        catch { console.error('Model upload requires reconciliation', { importId: job.id }); }
        if (error instanceof ModelRegistryError) throw error;
        throw new ModelRegistryError(controller.signal.aborted ? 'UPLOAD_INTERRUPTED' : 'REGISTRY_FAILURE', 500);
      } finally {
        clearTimeout(timeout);
        request.removeListener('aborted', interrupted);
        if (!handedOff) { active.delete(job.id); await lock.release(); }
      }
      } finally { if (admitted && !handedOff) occupied--; receivers.delete(receiver); receivedDone(); }
    },
    async listVersions(projectId: string) {
      const result = await repository.listVersions(projectId);
      return { versions: result.versions.map(toVersionDto), selection: result.selection };
    },
    async getImport(projectId: string, importId: string) {
      const job = await repository.getImport(projectId, importId);
      if (!job) throw new ModelRegistryError('IMPORT_NOT_FOUND', 404);
      return toImportDto(job);
    },
    async selectModel(projectId: string, id: string | null, revision: number, requestedBy: string) {
      if (id !== null) {
        const version = await repository.getVersion(projectId, id);
        if (!version) throw new ModelRegistryError('MODEL_NOT_FOUND', 404);
        if (version.state !== 'ready') throw new ModelRegistryError('VERSION_NOT_READY', 409);
        try { await storage.verifyResources(version.storagePrefix, version.manifest.resources); }
        catch {
          await repository.setHealth(projectId, id, 'unavailable');
          throw new ModelRegistryError('MODEL_UNAVAILABLE', 503);
        }
        await repository.setHealth(projectId, id, 'healthy');
      }
      return repository.selectModel(projectId, id, revision, requestedBy);
    },
    async close(): Promise<void> {
      stopped = true;
      if (recoveryTimer) clearInterval(recoveryTimer);
      for (const controller of active.values()) controller.abort(new ModelRegistryError('IMPORT_INTERRUPTED'));
      // A receiver can hand off a worker while close is waiting; take the worker snapshot afterwards.
      await Promise.allSettled([...receivers]);
      while (pending.size) await Promise.allSettled([...pending]);
      if (recovering) await recovering.catch(() => undefined);
    },
  };
}
export type ModelImportService = ReturnType<typeof createModelImportService>;
