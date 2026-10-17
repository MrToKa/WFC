// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { DEFAULT_LIMITS } from '../vendor/routings-model-package/index.mjs';
import { createModelImportService } from './importService.js';
import type { ModelRegistryRepository } from './repository.js';
import type { ModelStorage } from './storage.js';
import type { ImportRecord, PortableManifest, StorageOwnership, VerificationReport, VersionRecord } from './types.js';

const payload = Buffer.from('lifecycle-only test upload');
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const timestamp = '2026-10-16T00:00:00.000Z';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
  vi.restoreAllMocks();
});

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
function request(): IncomingMessage {
  return Object.assign(Readable.from([payload]), { complete: true }) as unknown as IncomingMessage;
}
async function fixture(options: { fault?: Parameters<typeof createModelImportService>[0]['fault']; maxConcurrent?: number } = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'wfc-import-lifecycle-')));
  const projectId = randomUUID(), requestedBy = randomUUID(), id = randomUUID(), ownerToken = randomUUID();
  const versionId = randomUUID();
  let job: ImportRecord = {
    id, projectId, requestedBy, idempotencyKey: randomUUID(), archiveSha256: digest(payload), expectedBytes: payload.length,
    ownerToken, receivedBytes: 0, state: 'receiving', modelVersionId: null, failure: null, verificationReport: null,
    duplicate: false, cleanedAt: null, stagingCleanedAt: null, createdAt: timestamp, updatedAt: timestamp,
  };
  const manifest: PortableManifest = {
    schemaVersion: 1, packageId: randomUUID(), label: 'Controlled test',
    source: { name: 'controlled.nwd', bytes: 1, sha256: digest(Buffer.from('s')), identityBasis: 'observed-local-file' },
    preparedAt: timestamp, supportProfile: 'svf-local-7.130.0-v1', format: 'svf', sdkVersion: '7.130.0',
    entrypoint: 'resources/output/0/0.svf', contentFingerprint: digest(Buffer.from('test-only inventory')),
    resources: [{ path: 'resources/output/0/0.svf', bytes: 1, sha256: digest(Buffer.from('r')) }],
  };
  let version: VersionRecord | null = null;
  let ownership: StorageOwnership | null = null;
  let recoverJobs = false;
  let locked = false;
  const release = vi.fn(async () => { locked = false; });
  const repository: ModelRegistryRepository = {
    findImportByRequest: vi.fn(async () => null),
    beginImport: vi.fn(async () => { locked = true; return { job: structuredClone(job), duplicate: false, lock: { release } }; }),
    tryLockImport: vi.fn(async () => {
      if (locked) return null;
      locked = true;
      return { release };
    }),
    getImport: vi.fn(async () => structuredClone(job)),
    updateProgress: vi.fn(async (_previous, state, receivedBytes) => {
      job = { ...job, state, receivedBytes: receivedBytes ?? job.receivedBytes };
      return structuredClone(job);
    }),
    reserve: vi.fn(async (_previous, report) => {
      version = {
        id: versionId, projectId, packageId: manifest.packageId, contentFingerprint: manifest.contentFingerprint,
        label: manifest.label, source: manifest.source, schemaVersion: 1, supportProfile: manifest.supportProfile,
        format: 'svf', sdkVersion: '7.130.0', entrypoint: manifest.entrypoint, preparedAt: timestamp,
        importedAt: null, importedBy: requestedBy, state: 'validating', health: 'unchecked', resourceCount: 1, totalBytes: 1,
        validationReportId: null, failure: null, manifest, storagePrefix: `projects/${projectId}/versions/${versionId}/`, ownerImportId: id,
      };
      ownership = { importId: id, projectId, modelVersionId: versionId, storagePrefix: version.storagePrefix, ownerToken, published: false, cleanedAt: null, createdAt: timestamp };
      job = { ...job, modelVersionId: versionId, verificationReport: report };
      return { kind: 'reserved' as const, version: structuredClone(version), ownership: structuredClone(ownership) };
    }),
    markPublishing: vi.fn(async () => { job = { ...job, state: 'publishing' }; return structuredClone(job); }),
    publish: vi.fn(async () => {
      if (!version || !ownership) throw new Error('fixture missing reservation');
      version = { ...version, state: 'ready', health: 'healthy', importedAt: timestamp, validationReportId: randomUUID() };
      ownership = { ...ownership, published: true };
      job = { ...job, state: 'complete' };
      return structuredClone(version);
    }),
    reconcile: vi.fn(async () => ({ published: ownership?.published ?? false, ownership: structuredClone(ownership), job: structuredClone(job) })),
    failImport: vi.fn(async (_previous, failure) => {
      if (job.state !== 'complete') {
        job = { ...job, state: 'failed', failure };
        if (version) version = { ...version, state: 'failed', failure };
      }
      return structuredClone(job);
    }),
    markCleaned: vi.fn(async () => { if (ownership) ownership.cleanedAt = timestamp; job.cleanedAt = timestamp; }),
    markStagingCleaned: vi.fn(async () => { job.stagingCleanedAt = timestamp; }),
    listRecoverableImports: vi.fn(async () => recoverJobs && !job.stagingCleanedAt ? [structuredClone(job)] : []),
    listUnpublishedOwnership: vi.fn(async () => []),
    listVersions: vi.fn(async () => ({ versions: version?.state === 'ready' ? [structuredClone(version)] : [], selection: { projectId, activeModelVersionId: null, selectionRevision: 0, updatedAt: timestamp } })),
    getVersion: vi.fn(async () => structuredClone(version)),
    selectModel: vi.fn(async (_projectId, activeModelVersionId, selectionRevision) => ({ projectId, activeModelVersionId, selectionRevision: selectionRevision + 1, updatedAt: timestamp })),
    setHealth: vi.fn(async (_projectId, _versionId, health) => { if (version) version.health = health; return structuredClone(version); }),
  };
  const storage: ModelStorage = {
    initialize: vi.fn(async () => undefined),
    prefix: (project, modelVersion) => `projects/${project}/versions/${modelVersion}/`,
    putResource: vi.fn(async (_prefix, resource, filename) => {
      expect(await fs.readFile(filename)).toEqual(Buffer.from('r'));
      expect(resource.sha256).toBe(digest(Buffer.from('r')));
    }),
    verifyResources: vi.fn(async () => ({ resourceCount: 1, totalBytes: 1 })),
    removeUnpublished: vi.fn(async () => undefined),
  };
  const verify = vi.fn(async (archive: string, options?: { extractTo?: string }): Promise<VerificationReport> => {
    expect(await fs.readFile(archive)).toEqual(payload);
    const directory = options?.extractTo;
    if (!directory) throw new Error('fixture requires extraction');
    await fs.mkdir(path.join(directory, 'resources/output/0'), { recursive: true });
    await fs.writeFile(path.join(directory, manifest.entrypoint), 'r');
    return {
      reportSchemaVersion: 1, toolVersion: 'test-only', nodeVersion: process.version, operation: 'verify', status: 'PASS',
      startedAt: timestamp, finishedAt: timestamp, package: { path: archive, bytes: payload.length, sha256: digest(payload), packageId: manifest.packageId },
      contentFingerprint: manifest.contentFingerprint, canonicalBytes: 1, resourceCount: 1, totalRawBytes: 1, limits: { ...DEFAULT_LIMITS },
      checks: { portableManifest: 'PASS', safeArchive: 'PASS', rawInventory: 'PASS', fingerprint: 'PASS', supportedProfile: 'PASS', nestedReferences: 'PASS' },
      profile: {}, extraction: { directory, resourceCount: 1, hashesCompared: 1, status: 'PASS' }, manifest,
      resources: manifest.resources.map(resource => ({ ...resource, verifiedSha256: resource.sha256 })), limitations: ['Lifecycle test double; no package validity assertion.'],
    };
  });
  const service = createModelImportService({ repository, storage, workRoot: root, verify, fault: options.fault, maxConcurrent: options.maxConcurrent });
  cleanups.push(async () => { await service.close(); await fs.rm(root, { recursive: true, force: true }); });
  const directory = path.join(root, id);
  return {
    root, directory, repository, storage, service, verify, release,
    input: { projectId, requestedBy, idempotencyKey: job.idempotencyKey, archiveSha256: job.archiveSha256, expectedBytes: job.expectedBytes },
    job: () => structuredClone(job), version: () => structuredClone(version), ownership: () => structuredClone(ownership),
    async completeForRecovery() {
      recoverJobs = true;
      job = { ...job, state: 'complete', modelVersionId: versionId };
      ownership = { importId: id, projectId, modelVersionId: versionId, storagePrefix: storage.prefix(projectId, versionId), ownerToken, published: true, cleanedAt: null, createdAt: timestamp };
      await fs.mkdir(directory);
      await fs.writeFile(path.join(directory, '.owner.json'), JSON.stringify({ id, token: ownerToken }));
      await fs.writeFile(path.join(directory, 'archive.zip'), payload);
    },
    async makeFailedReplay() {
      job = { ...job, state: 'failed', failure: { code: 'UPLOAD_INTERRUPTED', message: 'Controlled failure' }, stagingCleanedAt: timestamp, cleanedAt: timestamp };
      vi.mocked(repository.beginImport).mockResolvedValue({ job: structuredClone(job), duplicate: true });
    },
  };
}

describe('model import lifecycle and reconciliation', () => {
  it('waits for a delayed durable begin on close, rejects acceptance and releases the retained lock', async () => {
    const test = await fixture();
    await test.service.initialize();
    const entered = barrier(), resume = barrier();
    vi.mocked(test.repository.beginImport).mockImplementation(async () => {
      entered.release(); await resume.promise;
      return { job: test.job(), duplicate: false, lock: { release: test.release } };
    });
    const receiving = test.service.receive(request(), test.input);
    const rejection = expect(receiving).rejects.toMatchObject({ code: 'IMPORT_INTERRUPTED', status: 503 });
    await entered.promise;
    let closed = false;
    const closing = test.service.close().then(() => { closed = true; });
    await new Promise(resolve => setImmediate(resolve));
    expect(closed).toBe(false);
    resume.release();
    await rejection;
    await closing;
    expect(test.release).toHaveBeenCalledOnce();
    expect(test.verify).not.toHaveBeenCalled();
    expect(test.job().state).toBe('failed');
    expect(test.job().stagingCleanedAt).not.toBeNull();
    await expect(fs.stat(test.directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('returns the same failed idempotency result without receiving, verifying or starting another worker', async () => {
    const test = await fixture();
    await test.service.initialize();
    await test.makeFailedReplay();
    const result = await test.service.receive(request(), test.input);
    expect(result.status).toBe(200);
    expect(result.job.id).toBe(test.job().id);
    expect(result.job.state).toBe('failed');
    expect(test.repository.tryLockImport).not.toHaveBeenCalled();
    expect(test.verify).not.toHaveBeenCalled();
    expect(test.storage.putResource).not.toHaveBeenCalled();
  });

  it('bounds pending durable begins before they can retain additional database sessions', async () => {
    const test = await fixture();
    await test.service.initialize();
    const entered = barrier(), resume = barrier();
    vi.mocked(test.repository.beginImport).mockImplementation(async () => {
      entered.release(); await resume.promise;
      return { job: test.job(), duplicate: false, lock: { release: test.release } };
    });
    const receiving = test.service.receive(request(), test.input);
    const rejection = expect(receiving).rejects.toMatchObject({ code: 'IMPORT_INTERRUPTED' });
    await entered.promise;
    for (let index = 0; index < 12; index++) {
      await expect(test.service.receive(request(), { ...test.input, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: 'IMPORT_BUSY', status: 503 });
    }
    expect(test.repository.beginImport).toHaveBeenCalledOnce();
    const closing = test.service.close();
    resume.release();
    await rejection;
    await closing;
    expect(test.release).toHaveBeenCalledOnce();
    expect(test.verify).not.toHaveBeenCalled();
  });

  it('admits at most two pending begins with maxConcurrent two and observes replay without a third lock', async () => {
    const test = await fixture({ maxConcurrent: 2 });
    await test.service.initialize();
    const entered = barrier(), resume = barrier();
    const secondRelease = vi.fn(async () => undefined);
    let count = 0;
    vi.mocked(test.repository.beginImport).mockImplementation(async input => {
      const index = count++;
      if (count === 2) entered.release();
      await resume.promise;
      return {
        job: { ...test.job(), id: index === 0 ? test.job().id : randomUUID(), ownerToken: index === 0 ? test.job().ownerToken : randomUUID(), idempotencyKey: input.idempotencyKey },
        duplicate: false, lock: { release: index === 0 ? test.release : secondRelease },
      };
    });
    const first = test.service.receive(request(), test.input);
    const firstRejected = expect(first).rejects.toMatchObject({ code: 'IMPORT_INTERRUPTED' });
    const second = test.service.receive(request(), { ...test.input, idempotencyKey: randomUUID() });
    const secondRejected = expect(second).rejects.toMatchObject({ code: 'IMPORT_INTERRUPTED' });
    await entered.promise;
    await expect(test.service.receive(request(), { ...test.input, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: 'IMPORT_BUSY', status: 503 });
    expect(test.repository.beginImport).toHaveBeenCalledTimes(2);
    vi.mocked(test.repository.findImportByRequest).mockResolvedValueOnce({ ...test.job(), state: 'validating' });
    const replay = await test.service.receive(request(), test.input);
    expect(replay.status).toBe(202);
    expect(replay.job.id).toBe(test.job().id);
    expect(test.repository.beginImport).toHaveBeenCalledTimes(2);
    const closing = test.service.close();
    resume.release();
    await Promise.all([firstRejected, secondRejected, closing]);
    expect(test.release).toHaveBeenCalledOnce();
    expect(secondRelease).toHaveBeenCalledOnce();
    expect(test.verify).not.toHaveBeenCalled();
  });

  it('drains a receiver paused before worker handoff and prevents new verification after close', async () => {
    const entered = barrier(), resume = barrier();
    const test = await fixture({ fault: async point => {
      if (point === 'afterReceive') { entered.release(); await resume.promise; }
    } });
    await test.service.initialize();
    const receiving = test.service.receive(request(), test.input);
    const rejection = expect(receiving).rejects.toMatchObject({ code: 'IMPORT_INTERRUPTED' });
    await entered.promise;
    let closed = false;
    const closing = test.service.close().then(() => { closed = true; });
    await new Promise(resolve => setImmediate(resolve));
    expect(closed).toBe(false);
    resume.release();
    await rejection;
    await closing;
    expect(test.verify).not.toHaveBeenCalled();
    expect(test.repository.publish).not.toHaveBeenCalled();
    expect(test.job().state).toBe('failed');
    expect(test.release).toHaveBeenCalledOnce();
    await expect(fs.stat(test.directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reconciles a lost successful publish reply and never deletes the published resources', async () => {
    const test = await fixture();
    await test.service.initialize();
    const publish = vi.mocked(test.repository.publish).getMockImplementation();
    vi.mocked(test.repository.publish).mockImplementation(async (...args) => {
      if (!publish) throw new Error('missing fixture publisher');
      await publish(...args);
      throw new Error('lost commit reply');
    });
    expect((await test.service.receive(request(), test.input)).status).toBe(202);
    await vi.waitFor(() => expect(test.release).toHaveBeenCalledOnce());
    expect(test.job().state).toBe('complete');
    expect(test.version()?.state).toBe('ready');
    expect(test.ownership()?.published).toBe(true);
    expect(test.storage.removeUnpublished).not.toHaveBeenCalled();
    expect(test.repository.failImport).not.toHaveBeenCalled();
    await expect(fs.stat(test.directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('retains staging and objects when the outcome cannot be reconciled', async () => {
    const test = await fixture();
    await test.service.initialize();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(test.storage.verifyResources).mockRejectedValue(new Error('test readback failure'));
    vi.mocked(test.repository.reconcile).mockRejectedValue(new Error('database unavailable'));
    await test.service.receive(request(), test.input);
    await vi.waitFor(() => expect(test.release).toHaveBeenCalledOnce());
    expect(test.storage.putResource).toHaveBeenCalledOnce();
    expect(test.storage.removeUnpublished).not.toHaveBeenCalled();
    expect(test.repository.failImport).not.toHaveBeenCalled();
    expect(test.repository.markCleaned).not.toHaveBeenCalled();
    expect((await fs.stat(path.join(test.directory, 'archive.zip'))).isFile()).toBe(true);
    expect((await fs.stat(path.join(test.directory, '.owner.json'))).isFile()).toBe(true);
  });

  it('cleans only the matching local staging of an already complete job at startup', async () => {
    const test = await fixture();
    await test.completeForRecovery();
    await test.service.initialize();
    expect(test.repository.markStagingCleaned).toHaveBeenCalledWith(test.job().id, test.job().ownerToken);
    expect(test.storage.removeUnpublished).not.toHaveBeenCalled();
    expect(test.repository.failImport).not.toHaveBeenCalled();
    expect(test.verify).not.toHaveBeenCalled();
    expect(test.ownership()?.published).toBe(true);
    await expect(fs.stat(test.directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['mismatched-token', 'hardlinked-marker'] as const)('retains a staging directory with an unsafe %s', async kind => {
    const test = await fixture();
    await test.completeForRecovery();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const marker = path.join(test.directory, '.owner.json');
    if (kind === 'mismatched-token') await fs.writeFile(marker, JSON.stringify({ id: test.job().id, token: randomUUID() }));
    else await fs.link(marker, path.join(test.root, 'retained-marker.json'));
    await test.service.initialize();
    expect(test.repository.markStagingCleaned).not.toHaveBeenCalled();
    expect(test.storage.removeUnpublished).not.toHaveBeenCalled();
    expect((await fs.stat(path.join(test.directory, 'archive.zip'))).isFile()).toBe(true);
    expect(test.ownership()?.published).toBe(true);
  });

  it('cannot publish ready when actual storage readback fails', async () => {
    const test = await fixture();
    await test.service.initialize();
    vi.mocked(test.storage.verifyResources).mockRejectedValue(Object.assign(new Error('private storage detail'), { code: 'STORAGE_HASH_MISMATCH' }));
    await test.service.receive(request(), test.input);
    await vi.waitFor(() => expect(test.release).toHaveBeenCalledOnce());
    expect(test.repository.publish).not.toHaveBeenCalled();
    expect(test.repository.markPublishing).not.toHaveBeenCalled();
    expect(test.job().state).toBe('failed');
    expect(test.job().failure?.code).toBe('STORAGE_READBACK_FAILED');
    expect(test.job().failure?.message).not.toContain('private storage detail');
    expect(test.version()?.state).toBe('failed');
    expect(test.storage.removeUnpublished).toHaveBeenCalledWith(test.ownership()?.storagePrefix);
    await expect(fs.stat(test.directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
