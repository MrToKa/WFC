import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import type { ReadStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PassThrough, type Writable } from 'node:stream';
import http, { type IncomingMessage } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { Client } from 'minio';
import { createModelRegistryRepository, type ModelRegistryRepository } from '../modelRegistry/repository.js';
import { initializeModelRegistry } from '../modelRegistry/schema.js';
import { createModelStorage, ModelStorageError, type ModelStorage, type ModelStorageClient } from '../modelRegistry/storage.js';
import { createModelImportService, type ImportFaultPoint } from '../modelRegistry/importService.js';
import { ModelRegistryError } from '../modelRegistry/errors.js';
import { computeFingerprint, type PackReport } from '../vendor/routings-model-package/index.mjs';

type Fixture = { filename: string; report: PackReport };
const helpers = await import(new URL('../../../../scripts/model-registry/integration.mjs', import.meta.url).href) as {
  assertFixtureEnvironment(): void;
  makeSyntheticPackage(root: string, options?: { name?: string; propertyText?: string }): Promise<Fixture>;
};
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const requestFor = (bytes: Buffer, complete = true): IncomingMessage => {
  const request = Object.assign(new PassThrough(), { complete }); request.end(bytes);
  return request as unknown as IncomingMessage;
};

async function setup(t: TestContext, wrappers: {
  clientPartSize?: number;
  clientTransport?: NonNullable<ConstructorParameters<typeof Client>[0]['transport']>;
  client?: (base: Client) => ModelStorageClient;
  storage?: (base: ModelStorage) => ModelStorage;
  repository?: (base: ModelRegistryRepository) => ModelRegistryRepository;
  fault?: (stage: ImportFaultPoint) => Promise<void>;
} = {}) {
  helpers.assertFixtureEnvironment();
  const base = await fs.realpath(os.tmpdir()), root = await fs.mkdtemp(path.join(base, 'wfc-model-registry-service-'));
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
  await initializeModelRegistry(pool);
  const projectId = randomUUID(), requestedBy = randomUUID();
  await pool.query('INSERT INTO users(id,email,password_hash,is_admin,role) VALUES($1,$2,$3,false,$4)', [requestedBy, `stage4-${requestedBy}@fixture.invalid`, 'Synthetic direct-service fixture; never used for login.', 'engineer']);
  await pool.query('INSERT INTO projects(id,project_number,name,customer) VALUES($1,$2,$3,$4)', [projectId, 'STAGE4-' + projectId, 'Synthetic service fixture', 'Isolated Stage4']);
  await pool.query('INSERT INTO user_project_access(user_id,project_id) VALUES($1,$2)', [requestedBy, projectId]);
  const client = new Client({ endPoint: 'minio', port: 9000, useSSL: false, accessKey: process.env.MINIO_ACCESS_KEY, secretKey: process.env.MINIO_SECRET_KEY,
    ...(wrappers.clientPartSize ? { partSize: wrappers.clientPartSize } : {}),
    ...(wrappers.clientTransport ? { transport: wrappers.clientTransport } : {}) });
  const repository = createModelRegistryRepository(pool), storage = createModelStorage({ client: wrappers.client?.(client) ?? client, bucket: 'stage4-models' });
  const service = createModelImportService({ repository: wrappers.repository?.(repository) || repository, storage: wrappers.storage?.(storage) || storage, ...(wrappers.fault ? { fault: async stage => wrappers.fault!(stage) } : {}) });
  t.after(async () => {
    await service.close(); await pool.end();
    const relative = path.relative(base, root); assert.ok(relative.startsWith('wfc-model-registry-service-') && !relative.includes(path.sep));
    await fs.rm(root, { recursive: true, force: true });
  });
  await service.initialize();
  async function receive(fixture: Fixture) {
    const bytes = await fs.readFile(fixture.filename);
    return service.receive(requestFor(bytes), { projectId, requestedBy, idempotencyKey: randomUUID(), archiveSha256: sha256(bytes), expectedBytes: bytes.length });
  }
  async function wait(importId: string) {
    const deadline = Date.now() + 30000;
    for (;;) {
      const job = await service.getImport(projectId, importId);
      if (job.state === 'complete' || job.state === 'failed') {
        const cleanup = (await pool.query('SELECT j.staging_cleaned_at,o.storage_prefix,o.published,o.cleaned_at FROM model_import_jobs j LEFT JOIN model_storage_ownership o ON o.import_id=j.id WHERE j.id=$1', [importId])).rows[0];
        if (cleanup?.staging_cleaned_at && (!cleanup.storage_prefix || cleanup.published || cleanup.cleaned_at)) return job;
      }
      if (Date.now() >= deadline) throw new Error('Synthetic service fixture timed out');
      await delay(25);
    }
  }
  async function count(prefix: string) { let n = 0; for await (const _entry of client.listObjectsV2('stage4-models', prefix, true)) n++; return n; }
  async function baseline() {
    const fixture = await helpers.makeSyntheticPackage(root), accepted = await receive(fixture), job = await wait(accepted.job.id);
    assert.equal(job.state, 'complete'); assert.ok(job.modelVersionId);
    await service.selectModel(projectId, job.modelVersionId, 0, requestedBy);
    const version = await repository.getVersion(projectId, job.modelVersionId); assert.ok(version);
    return version;
  }
  return { root, pool, projectId, requestedBy, client, repository, storage, service, receive, wait, count, baseline };
}

test('real PG/MinIO rejects partial, mismatched and invalid uploads without ready metadata', async t => {
  const s = await setup(t), old = await s.baseline(), candidate = await helpers.makeSyntheticPackage(s.root, { propertyText: 'new invalid-upload candidate' }), bytes = await fs.readFile(candidate.filename);
  for (const mode of ['partial', 'hash', 'invalid'] as const) {
    const content = mode === 'invalid' ? Buffer.from('Explicit malformed ZIP fixture.') : bytes, key = randomUUID();
    const call = s.service.receive(requestFor(content, mode !== 'partial'), { projectId: s.projectId, requestedBy: s.requestedBy, idempotencyKey: key, archiveSha256: mode === 'hash' ? '0'.repeat(64) : sha256(content), expectedBytes: content.length });
    if (mode === 'invalid') { const accepted = await call; assert.equal((await s.wait(accepted.job.id)).state, 'failed'); }
    else await assert.rejects(call);
    const row = (await s.pool.query('SELECT state,model_version_id,received_bytes FROM model_import_jobs WHERE project_id=$1 AND idempotency_key=$2', [s.projectId, key])).rows[0];
    assert.equal(row.state, 'failed'); assert.equal(row.model_version_id, null);
    assert.equal(Number(row.received_bytes), content.length);
  }
  let consumed = false;
  const stream = requestFor(bytes), iterate = stream[Symbol.asyncIterator].bind(stream);
  stream[Symbol.asyncIterator] = () => { consumed = true; return iterate(); };
  await assert.rejects(s.service.receive(stream, { projectId: s.projectId, requestedBy: s.requestedBy, idempotencyKey: randomUUID(), archiveSha256: sha256(bytes), expectedBytes: 2147483649 }), { code: 'UPLOAD_LIMIT' });
  stream.destroy(); assert.equal(consumed, false);
  const listed = await s.service.listVersions(s.projectId); assert.equal(listed.versions.length, 1); assert.equal(listed.selection.activeModelVersionId, old.id);
  assert.equal((await s.storage.verifyResources(old.storagePrefix, old.manifest.resources)).resourceCount, 3);
});

test('actual service and public verifier reject six invalid manifest, schema, profile and listed-resource inputs', async t => {
  const s = await setup(t), old = await s.baseline();
  const candidate = await helpers.makeSyntheticPackage(s.root, { propertyText: 'Malformed consumer boundary candidate' });
  // Test construction only: the pinned generic ZIP writer produces valid ZIP envelopes around
  // deliberately invalid portable inputs. Production acceptance still uses public verifyPackage.
  const zip = await import(new URL('../vendor/routings-model-package/lib/zip.mjs', import.meta.url).href) as {
    writeZip(target: string, entries: { name: string; data: Buffer }[]): Promise<unknown>;
  };
  const resources = new Map<string, Buffer>();
  const modelRoot = path.join(path.dirname(path.dirname(candidate.filename)), 'model');
  for (const resource of candidate.report.manifest.resources) {
    const bytes = await fs.readFile(path.join(modelRoot, ...resource.path.slice('resources/'.length).split('/')));
    assert.ok(bytes.length < 1024 * 1024); // This mutation helper is bounded to tiny synthetic fixtures.
    resources.set(resource.path, bytes);
  }
  async function waitReleased(importId: string) {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const lock = await s.repository.tryLockImport(importId);
      if (lock) { await lock.release(); return; }
      await delay(25);
    }
    throw new Error('Synthetic invalid-input worker did not release its session');
  }
  await waitReleased(old.ownerImportId);
  const modes = [
    ['manifest', 'INVALID_MANIFEST'],
    ['schema', 'UNSUPPORTED_SCHEMA'],
    ['profile', 'UNSUPPORTED_PROFILE'],
    ['profile-structure', 'UNSUPPORTED_PROFILE'],
    ['missing-resource', 'RESOURCE_MISSING'],
    ['corrupt-resource', 'RESOURCE_HASH_MISMATCH'],
  ] as const;
  for (const [mode, code] of modes) {
    const manifest = structuredClone(candidate.report.manifest);
    const record = manifest as unknown as Record<string, unknown>;
    const raw = new Map(resources);
    const propertyPath = 'resources/output/0/properties.db';
    if (mode === 'manifest') record.fixturePrivateDiagnostic = 'Do not expose this synthetic diagnostic.';
    if (mode === 'schema') record.schemaVersion = 2;
    if (mode === 'profile') record.supportProfile = 'unsupported-synthetic-profile';
    if (mode === 'missing-resource') raw.delete(propertyPath);
    if (mode === 'corrupt-resource' || mode === 'profile-structure') {
      const original = raw.get(propertyPath); assert.ok(original);
      const changed = Buffer.from(original); changed[0] ^= 0x01;
      raw.set(propertyPath, changed);
      if (mode === 'profile-structure') {
        const property = manifest.resources.find(resource => resource.path === propertyPath); assert.ok(property);
        property.sha256 = sha256(changed);
        manifest.contentFingerprint = computeFingerprint(manifest);
      }
    }
    const filename = path.join(s.root, 'invalid-' + mode + '.zip');
    await zip.writeZip(filename, [
      { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest)) },
      ...[...raw].map(([name, data]) => ({ name, data })),
    ]);
    const bytes = await fs.readFile(filename);
    const accepted = await s.service.receive(requestFor(bytes), {
      projectId: s.projectId, requestedBy: s.requestedBy, idempotencyKey: randomUUID(),
      archiveSha256: sha256(bytes), expectedBytes: bytes.length,
    });
    assert.equal(accepted.status, 202, mode);
    const job = await s.wait(accepted.job.id);
    await waitReleased(job.id);
    assert.equal(job.state, 'failed', mode); assert.equal(job.modelVersionId, null, mode);
    assert.deepEqual(job.failure, { code, message: new ModelRegistryError(code).message }, mode);
    assert.doesNotMatch(JSON.stringify(job), /fixturePrivateDiagnostic|Do not expose|\/var\/lib\/|storagePrefix|ownerToken|verificationReport/);
    const stored = (await s.pool.query('SELECT model_version_id,received_bytes,staging_cleaned_at,cleaned_at FROM model_import_jobs WHERE id=$1', [job.id])).rows[0];
    assert.equal(stored.model_version_id, null, mode); assert.equal(Number(stored.received_bytes), bytes.length, mode);
    assert.ok(stored.staging_cleaned_at, mode); assert.ok(stored.cleaned_at, mode);
    const state = await s.repository.reconcile(job.id); assert.equal(state.published, false, mode); assert.equal(state.ownership, null, mode);
    await assert.rejects(fs.stat(path.join(process.env.WFC_MODEL_IMPORT_ROOT!, job.id)), { code: 'ENOENT' });
    const listed = await s.service.listVersions(s.projectId);
    assert.equal(listed.versions.length, 1, mode); assert.equal(listed.versions[0].id, old.id, mode);
    assert.equal(Number((await s.pool.query('SELECT count(*) AS n FROM model_versions WHERE project_id=$1', [s.projectId])).rows[0].n), 1, mode);
    assert.equal(listed.selection.activeModelVersionId, old.id, mode); assert.equal(listed.selection.selectionRevision, 1, mode);
    assert.equal(await s.count(old.storagePrefix), old.resourceCount, mode);
    assert.equal(await s.count(`projects/${s.projectId}/`), old.resourceCount, mode);
  }
  assert.deepEqual(await s.storage.verifyResources(old.storagePrefix, old.manifest.resources), { resourceCount: old.resourceCount, totalBytes: old.totalBytes });
});

test('actual multipart parts are aborted without hanging between requests and cleanup preserves foreign MPU and ready data', { timeout: 120000 }, async t => {
  const partSize = 5 * 1024 * 1024;
  let enabled = false, targetFilename = '', ownPrefix = '';
  let activePartRequests = 0, pendingSDKUploads = 0;
  let heldSource: ReadStream | undefined;
  const sdkDestinations = new Set<Writable>();
  const s = await setup(t, {
    clientPartSize: partSize, // SDK-supported test threshold; production remains the default 64 MiB.
    clientTransport: { request: ((options: http.RequestOptions, callback?: (response: IncomingMessage) => void) => {
      const request = http.request(options, callback);
      if (options.method === 'PUT' && /(?:\?|&)partNumber=/.test(String(options.path))) {
        activePartRequests++;
        request.once('close', () => { activePartRequests--; });
      }
      return request;
    }) as typeof http.request },
    client: base => new Proxy(base, { get(target, property, receiver) {
      if (property === 'putObject') return async (...args: Parameters<ModelStorageClient['putObject']>) => {
        const body = args[2], originalPipe = body.pipe;
        // Observe only. Do not add the production error-forwarding fix in this test wrapper.
        body.pipe = function<T extends NodeJS.WritableStream>(destination: T, options?: { end?: boolean }): T {
          const writable = destination as unknown as Writable;
          sdkDestinations.add(writable);
          writable.once('close', () => sdkDestinations.delete(writable));
          return originalPipe.call(body, destination, options) as T;
        };
        pendingSDKUploads++;
        try { return await target.putObject(...args); }
        finally { pendingSDKUploads--; body.pipe = originalPipe; }
      };
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    } }),
    storage: base => ({ ...base, async putResource(prefix, resource, filename, signal) {
      if (enabled && resource.path === 'resources/output/0/properties.db') { ownPrefix = prefix; targetFilename = filename; }
      return base.putResource(prefix, resource, filename, signal);
    } }),
  });
  type Incomplete = { key: string; uploadId: string; size: number };
  async function incomplete(prefix: string): Promise<Incomplete[]> {
    const rows: Incomplete[] = [];
    // This MinIO release treats a nonempty multipart prefix as an exact object key.
    // Observe the real bucket inventory and filter locally, so a directory query's
    // empty result cannot falsely prove that the owned multipart parts were removed.
    for await (const row of s.client.listIncompleteUploads('stage4-models', '', true)) {
      assert.equal(typeof row.key, 'string'); assert.equal(typeof row.uploadId, 'string');
      if (!row.key!.startsWith(prefix)) continue;
      rows.push({ key: row.key!, uploadId: row.uploadId!, size: row.size ?? 0 });
    }
    return rows;
  }
  async function committedPart(prefix: () => string, key: () => string): Promise<Incomplete> {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const current = prefix();
      const row = current && (await incomplete(current)).find(item => item.key === key() && item.size >= partSize);
      if (row) return row;
      await delay(25);
    }
    throw new Error('No actual committed multipart part was observed');
  }
  async function deadline<T>(promise: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Multipart abort did not settle within 15 seconds')), 15000);
      })]);
    } finally { if (timer) clearTimeout(timer); }
  }
  async function waitReleased(importId: string) {
    const limit = Date.now() + 30000;
    while (Date.now() < limit) {
      const lock = await s.repository.tryLockImport(importId);
      if (lock) { await lock.release(); return; }
      await delay(25);
    }
    throw new Error('Multipart import worker did not release its session');
  }
  const originalOpen = fs.open;
  const foreignPrefix = s.storage.prefix(randomUUID(), randomUUID());
  const foreignKey = foreignPrefix + 'resources/output/0/foreign.bin';
  const foreignBody = new PassThrough();
  let foreignUploading: Promise<unknown> | undefined;
  try {
    const old = await s.baseline();
    await waitReleased(old.ownerImportId);
    const candidate = await helpers.makeSyntheticPackage(s.root, { propertyText: 'm'.repeat(2 * partSize + 1) });
    assert.ok(candidate.report.manifest.resources.some(resource => resource.path.endsWith('/properties.db') && resource.bytes > 2 * partSize));
    // A separate high-level SDK upload is deliberately kept incomplete under an unrelated prefix.
    foreignUploading = s.client.putObject('stage4-models', foreignKey, foreignBody, 3 * partSize, { 'Content-Type': 'application/octet-stream' }).catch(() => undefined);
    foreignBody.write(Buffer.alloc(partSize, 0x33));
    const foreign = await committedPart(() => foreignPrefix, () => foreignKey);
    assert.ok(foreign.size >= partSize);

    // Exact-file test seam: real fs.ReadStream and real file bytes, paused before the second part.
    // No production validator, storage cap or SDK method is replaced by synthetic success.
    fs.open = async (filename, flags, mode) => {
      const handle = await originalOpen(filename, flags, mode);
      if (filename === targetFilename) {
        const createReadStream = handle.createReadStream.bind(handle);
        handle.createReadStream = options => {
          const source = createReadStream(options), read = source._read.bind(source);
          source._read = size => {
            if (source.bytesRead >= partSize) { heldSource = source; return; }
            read(size);
          };
          return source;
        };
      }
      return handle;
    };
    enabled = true;
    for (const mode of ['source-error', 'caller-abort'] as const) {
      heldSource = undefined; ownPrefix = ''; targetFilename = '';
      const accepted = await s.receive(candidate);
      const own = await committedPart(() => ownPrefix, () => ownPrefix + 'resources/output/0/properties.db');
      const source = heldSource as ReadStream | undefined;
      assert.ok(source); assert.equal(source.bytesRead, partSize);
      assert.ok(own.uploadId); assert.ok(own.size >= partSize);
      const idleDeadline = Date.now() + 15000;
      while (activePartRequests && Date.now() < idleDeadline) await delay(10);
      assert.equal(activePartRequests, 0); assert.equal(pendingSDKUploads, 1);
      assert.equal(await s.count(ownPrefix), 2); // Completed listing alone cannot see this third resource's parts.
      const started = Date.now();
      if (mode === 'source-error') source.destroy(new ModelStorageError('STORAGE_SYNTHETIC_FAILURE', 'Controlled source failure between multipart requests'));
      else await deadline(s.service.close());
      const job = await deadline(s.wait(accepted.job.id));
      await deadline(waitReleased(job.id));
      assert.ok(Date.now() - started < 15000);
      assert.equal(job.state, 'failed');
      assert.equal(job.failure?.code, mode === 'source-error' ? 'STORAGE_READBACK_FAILED' : 'IMPORT_INTERRUPTED');
      const state = await s.repository.reconcile(job.id);
      assert.equal(state.published, false); assert.ok(state.ownership?.cleanedAt);
      assert.equal((await incomplete(ownPrefix)).length, 0); assert.equal(await s.count(ownPrefix), 0);
      const preserved = await incomplete(foreignPrefix);
      assert.ok(preserved.some(item => item.uploadId === foreign.uploadId && item.size >= partSize));
      const listed = await s.service.listVersions(s.projectId);
      assert.equal(listed.versions.length, 1); assert.equal(listed.selection.activeModelVersionId, old.id); assert.equal(listed.selection.selectionRevision, 1);
      assert.deepEqual(await s.storage.verifyResources(old.storagePrefix, old.manifest.resources), { resourceCount: old.resourceCount, totalBytes: old.totalBytes });
      t.diagnostic(JSON.stringify({ mode, committedOwnPartBytes: own.size, httpPartRequestsAtAbort: 0, ownIncompleteAfter: 0, foreignIncompletePreserved: true, oldReadyResources: old.resourceCount, boundedAbortMs: Date.now() - started }));
    }
  } finally {
    fs.open = originalOpen;
    heldSource?.destroy(new Error('Isolated multipart fixture teardown'));
    // Failure-only teardown prevents a pre-fix SDK chunker hang from blocking the test process.
    for (const destination of sdkDestinations) destination.destroy(new Error('Isolated multipart fixture teardown'));
    for (const row of await incomplete(foreignPrefix)) await s.client.abortMultipartUpload('stage4-models', row.key, row.uploadId);
    foreignBody.end();
    if (foreignUploading) await deadline(foreignUploading);
    for (const row of await incomplete(foreignPrefix)) await s.client.abortMultipartUpload('stage4-models', row.key, row.uploadId);
    await s.client.removeObject('stage4-models', foreignKey);
    await deadline(s.service.close());
  }
});

test('a real object written before a storage error is removed while ready objects survive', async t => {
  let enabled = false;
  const s = await setup(t, { storage: base => ({ ...base, async putResource(...args) { await base.putResource(...args); if (enabled) throw new ModelStorageError('STORAGE_SYNTHETIC_FAILURE', 'Synthetic post-write failure'); } }) });
  const old = await s.baseline(); enabled = true;
  const candidate = await helpers.makeSyntheticPackage(s.root, { propertyText: 'post-write failure candidate' }), accepted = await s.receive(candidate), failed = await s.wait(accepted.job.id);
  assert.equal(failed.state, 'failed'); assert.ok(failed.modelVersionId);
  const state = await s.repository.reconcile(failed.id); assert.ok(state.ownership); assert.equal(state.ownership.published, false); assert.ok(state.ownership.cleanedAt); assert.equal(await s.count(state.ownership.storagePrefix), 0);
  assert.equal((await s.service.listVersions(s.projectId)).selection.activeModelVersionId, old.id);
  assert.equal((await s.storage.verifyResources(old.storagePrefix, old.manifest.resources)).resourceCount, 3);
});

test('actual MinIO byte corruption fails full readback and preserves the old active version', async t => {
  let enabled = false, corrupted = false, testClient: Client | undefined;
  const s = await setup(t, { storage: base => ({ ...base, async verifyResources(prefix, resources, signal) {
    if (enabled && !corrupted) {
      corrupted = true; const resource = resources[0];
      await testClient!.putObject('stage4-models', prefix + resource.path, Buffer.alloc(resource.bytes, 1), resource.bytes, { 'Content-Type': 'application/octet-stream' });
    }
    return base.verifyResources(prefix, resources, signal);
  } }) });
  testClient = s.client;
  const old = await s.baseline(); enabled = true;
  const accepted = await s.receive(await helpers.makeSyntheticPackage(s.root, { propertyText: 'readback mismatch candidate' })), failed = await s.wait(accepted.job.id);
  assert.equal(corrupted, true); assert.equal(failed.state, 'failed'); assert.equal(failed.failure?.code, 'STORAGE_READBACK_FAILED');
  const state = await s.repository.reconcile(failed.id); assert.ok(state.ownership); assert.equal(await s.count(state.ownership.storagePrefix), 0);
  assert.equal((await s.service.listVersions(s.projectId)).selection.activeModelVersionId, old.id);
  assert.equal((await s.storage.verifyResources(old.storagePrefix, old.manifest.resources)).resourceCount, 3);
});

test('a failure before DB publish cleans only its unpublished prefix', async t => {
  let enabled = false;
  const s = await setup(t, { fault: async point => { if (enabled && point === 'beforePublish') throw new Error('Synthetic pre-commit failure'); } });
  const old = await s.baseline(); enabled = true;
  const accepted = await s.receive(await helpers.makeSyntheticPackage(s.root, { propertyText: 'pre-commit failure candidate' })), failed = await s.wait(accepted.job.id);
  assert.equal(failed.state, 'failed'); const state = await s.repository.reconcile(failed.id); assert.ok(state.ownership); assert.equal(await s.count(state.ownership.storagePrefix), 0);
  assert.equal((await s.service.listVersions(s.projectId)).selection.activeModelVersionId, old.id);
  assert.equal((await s.storage.verifyResources(old.storagePrefix, old.manifest.resources)).resourceCount, 3);
});

test('a lost DB commit reply reconciles the actual committed ready version without object deletion', async t => {
  let enabled = false, lostReply = false;
  const s = await setup(t, { repository: base => ({ ...base, async publish(...args) {
    const result = await base.publish(...args);
    if (enabled) { lostReply = true; throw Object.assign(new Error('Synthetic lost commit reply'), { code: '08006' }); }
    return result;
  } }) });
  const old = await s.baseline(); enabled = true;
  const accepted = await s.receive(await helpers.makeSyntheticPackage(s.root, { propertyText: 'committed unknown-reply candidate' })), job = await s.wait(accepted.job.id);
  assert.equal(lostReply, true); assert.equal(job.state, 'complete'); assert.ok(job.modelVersionId);
  const state = await s.repository.reconcile(job.id); assert.equal(state.published, true); assert.equal(state.job?.failure, null); assert.ok(state.ownership);
  assert.equal(await s.count(state.ownership.storagePrefix), 3); assert.equal((await s.service.listVersions(s.projectId)).selection.activeModelVersionId, old.id);
  const version = await s.repository.getVersion(s.projectId, job.modelVersionId); assert.ok(version);
  assert.equal((await s.storage.verifyResources(version.storagePrefix, version.manifest.resources)).resourceCount, 3);
});

test('real child exit after MinIO readback and before DB publish is recovered with ready resources intact', async t => {
  const s = await setup(t), old = await s.baseline(), fixture = await helpers.makeSyntheticPackage(s.root, { propertyText: 'child-crash candidate' });
  const modules = Object.fromEntries(['repository', 'storage', 'importService'].map(name => [name, new URL('../modelRegistry/' + name + '.js', import.meta.url).href]));
  const settings = { filename: fixture.filename, projectId: s.projectId, requestedBy: s.requestedBy };
  const code = `
    import fs from 'node:fs/promises'; import {PassThrough} from 'node:stream'; import {createHash,randomUUID} from 'node:crypto'; import pg from 'pg'; import {Client} from 'minio';
    const {createModelRegistryRepository}=await import(${JSON.stringify(modules.repository)}),{createModelStorage}=await import(${JSON.stringify(modules.storage)}),{createModelImportService}=await import(${JSON.stringify(modules.importService)});
    const settings=${JSON.stringify(settings)},pool=new pg.Pool({connectionString:process.env.DATABASE_URL}),client=new Client({endPoint:'minio',port:9000,useSSL:false,accessKey:process.env.MINIO_ACCESS_KEY,secretKey:process.env.MINIO_SECRET_KEY}),repo=createModelRegistryRepository(pool),storage=createModelStorage({client,bucket:'stage4-models'});
    const service=createModelImportService({repository:repo,storage,fault:async(point,context)=>{if(point==='beforePublish'){let count=0;for await(const item of client.listObjectsV2('stage4-models',context.version.storagePrefix,true))count++;process.stdout.write(JSON.stringify({importId:context.job.id,versionId:context.version.id,objectsBeforeExit:count}),()=>process.exit(77));await new Promise(()=>{});}}});
    await service.initialize();const bytes=await fs.readFile(settings.filename),request=Object.assign(new PassThrough(),{complete:true});request.end(bytes);await service.receive(request,{...settings,idempotencyKey:randomUUID(),archiveSha256:createHash('sha256').update(bytes).digest('hex'),expectedBytes:bytes.length});
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  const output: Buffer[] = []; child.stdout.on('data', bytes => output.push(bytes)); child.stderr.resume();
  const timeout = setTimeout(() => child.kill('SIGKILL'), 30000);
  const exit = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); }); clearTimeout(timeout);
  assert.equal(exit, 77); const observation = JSON.parse(Buffer.concat(output).toString().trim()) as { importId: string; versionId: string; objectsBeforeExit: number };
  assert.equal(observation.objectsBeforeExit, 3);
  await s.service.recover(); const job = await s.wait(observation.importId); assert.equal(job.state, 'failed');
  const state = await s.repository.reconcile(job.id); assert.ok(state.ownership); assert.equal(state.ownership.published, false); assert.ok(state.ownership.cleanedAt); assert.equal(await s.count(state.ownership.storagePrefix), 0);
  assert.equal((await s.service.listVersions(s.projectId)).selection.activeModelVersionId, old.id);
  assert.equal((await s.storage.verifyResources(old.storagePrefix, old.manifest.resources)).resourceCount, 3);
  await s.service.recover(); assert.equal((await s.storage.verifyResources(old.storagePrefix, old.manifest.resources)).resourceCount, 3);
});

test('actual DB constraints reject false verification reports and changes to ready metadata', async t => {
  const s = await setup(t), old = await s.baseline();
  await assert.rejects(s.pool.query('INSERT INTO model_validation_reports(id,report,storage_readback) VALUES($1,$2,$3)', [randomUUID(), { status: 'FAIL' }, { status: 'PASS', algorithm: 'SHA-256', resourceCount: 3, totalBytes: old.totalBytes, verifiedAt: new Date().toISOString() }]), { code: '23514' });
  await assert.rejects(s.pool.query('UPDATE model_versions SET label=$2 WHERE id=$1', [old.id, 'Synthetic forbidden ready rewrite']), { code: '23514' });
  await assert.rejects(s.pool.query('UPDATE project_model_selections SET active_model_version_id=$2 WHERE project_id=$1', [s.projectId, randomUUID()]), error => typeof error === 'object' && error !== null && 'code' in error && ['23503', '23514'].includes(String(error.code)));
  assert.equal((await s.service.listVersions(s.projectId)).selection.activeModelVersionId, old.id);
});

test('publication follows current WFC role resolution after administrator rights are revoked', async t => {
  let revoke = false;
  const s = await setup(t, { fault: async point => {
    if (revoke && point === 'beforePublish') await s.pool.query('UPDATE users SET is_admin=false WHERE id=$1', [s.requestedBy]);
  } });
  const old = await s.baseline();
  await s.pool.query("UPDATE users SET is_admin=true,role='admin' WHERE id=$1", [s.requestedBy]);
  revoke = true;
  const accepted = await s.receive(await helpers.makeSyntheticPackage(s.root, { propertyText: 'administrator revocation candidate' }));
  const job = await s.wait(accepted.job.id);
  assert.equal(job.state, 'failed');
  assert.equal(job.failure?.code, 'IMPORT_ACCESS_REVOKED');
  assert.equal((await s.service.listVersions(s.projectId)).selection.activeModelVersionId, old.id);
  const state = await s.repository.reconcile(job.id);
  assert.ok(state.ownership);
  assert.equal(await s.count(state.ownership.storagePrefix), 0);
  assert.equal((await s.storage.verifyResources(old.storagePrefix, old.manifest.resources)).resourceCount, 3);
});

test('selection detects actual stored-resource corruption without replacing or falling back from the old active version', async t => {
  const s = await setup(t), old = await s.baseline(), fixture = await helpers.makeSyntheticPackage(s.root, { propertyText: 'availability corruption candidate' });
  const accepted = await s.receive(fixture), job = await s.wait(accepted.job.id); assert.equal(job.state, 'complete'); assert.ok(job.modelVersionId);
  const candidate = await s.repository.getVersion(s.projectId, job.modelVersionId); assert.ok(candidate);
  const resource = candidate.manifest.resources[0];
  await s.client.putObject('stage4-models', candidate.storagePrefix + resource.path, Buffer.alloc(resource.bytes, 2), resource.bytes, { 'Content-Type': 'application/octet-stream' });
  await assert.rejects(s.service.selectModel(s.projectId, candidate.id, 1, s.requestedBy), { code: 'MODEL_UNAVAILABLE' });
  const failedSelection = await s.service.listVersions(s.projectId);
  assert.equal(failedSelection.selection.activeModelVersionId, old.id); assert.equal(failedSelection.selection.selectionRevision, 1);
  assert.equal(failedSelection.versions.find(value => value.id === candidate.id)?.health, 'unavailable');
  assert.equal(failedSelection.versions.find(value => value.id === old.id)?.health, 'healthy');
  const original = await fs.readFile(path.join(path.dirname(path.dirname(fixture.filename)), 'model', ...resource.path.slice('resources/'.length).split('/')));
  await s.client.putObject('stage4-models', candidate.storagePrefix + resource.path, original, original.length, { 'Content-Type': 'application/octet-stream' });
  const restored = await s.service.selectModel(s.projectId, candidate.id, 1, s.requestedBy); assert.equal(restored.activeModelVersionId, candidate.id); assert.equal(restored.selectionRevision, 2);
  assert.equal((await s.repository.getVersion(s.projectId, candidate.id))?.health, 'healthy');
});
