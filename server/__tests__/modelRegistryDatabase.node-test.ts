// Compiled Node integration tests. Run only in the disposable Stage 4 fixture.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { Client } from 'minio';
import { initializeModelRegistry } from '../modelRegistry/schema.js';
import { createModelRegistryRepository } from '../modelRegistry/repository.js';
import { createModelStorage } from '../modelRegistry/storage.js';
import { createModelImportService } from '../modelRegistry/importService.js';
import type { ImportRecord, VersionRecord } from '../modelRegistry/types.js';
import { verifyPackage, type PackReport } from '../vendor/routings-model-package/index.mjs';

type Fixture = { filename: string; report: PackReport };
const helpers = await import(new URL('../../../../scripts/model-registry/integration.mjs', import.meta.url).href) as {
  assertFixtureEnvironment(): void;
  makeSyntheticPackage(root: string, options?: { propertyText?: string }): Promise<Fixture>;
};
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const requestFor = (bytes: Buffer): IncomingMessage => {
  const stream = Object.assign(new PassThrough(), { complete: true });
  stream.end(bytes);
  return stream as unknown as IncomingMessage;
};

async function setup(t: TestContext, options: { beforePublish?: (job: ImportRecord, version: VersionRecord) => Promise<void> } = {}) {
  helpers.assertFixtureEnvironment();
  const base = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(base, 'wfc-model-registry-database-'));
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
  await initializeModelRegistry(pool);
  await initializeModelRegistry(pool);
  const projectId = randomUUID(), requestedBy = randomUUID();
  const email = `stage4-database-${requestedBy}@fixture.invalid`, password = randomBytes(24).toString('base64url');
  await pool.query('INSERT INTO users(id,email,password_hash,is_admin,role) VALUES($1,$2,$3,false,$4)', [requestedBy,email,await bcrypt.hash(password,4),'engineer']);
  await pool.query('INSERT INTO projects(id,project_number,name,customer) VALUES($1,$2,$3,$4)', [projectId,'STAGE4-'+projectId,'Database invariant fixture','Isolated Stage4']);
  await pool.query('INSERT INTO user_project_access(user_id,project_id) VALUES($1,$2)', [requestedBy,projectId]);
  const client = new Client({ endPoint: 'minio', port: 9000, useSSL: false, accessKey: process.env.MINIO_ACCESS_KEY, secretKey: process.env.MINIO_SECRET_KEY });
  const repository = createModelRegistryRepository(pool), storage = createModelStorage({ client, bucket: 'stage4-models' });
  const service = createModelImportService({ repository, storage, fault: async (stage, context) => {
    if (stage === 'beforePublish' && context.version) await options.beforePublish?.(context.job,context.version);
  } });
  t.after(async () => {
    await service.close();
    await pool.end();
    const relative = path.relative(base,root);
    assert.ok(relative.startsWith('wfc-model-registry-database-') && !relative.includes(path.sep));
    await fs.rm(root,{ recursive: true, force: true });
  });
  await service.initialize();
  async function receive(input: Fixture) {
    const bytes = await fs.readFile(input.filename);
    return service.receive(requestFor(bytes),{ projectId,requestedBy,idempotencyKey:randomUUID(),archiveSha256:sha256(bytes),expectedBytes:bytes.length });
  }
  async function wait(importId: string) {
    const deadline = Date.now()+30000;
    while (Date.now()<deadline) {
      const state = await repository.reconcile(importId);
      const row = (await pool.query('SELECT staging_cleaned_at FROM model_import_jobs WHERE id=$1',[importId])).rows[0];
      const terminal = state.job?.state === 'complete' || state.job?.state === 'failed';
      const cleanupDone = state.job ? row?.staging_cleaned_at && (!state.ownership || state.published || state.ownership.cleanedAt) : state.ownership?.cleanedAt;
      if ((terminal || !state.job) && cleanupDone) {
        const lock = await repository.tryLockImport(importId);
        if (lock) { await lock.release(); return state; }
      }
      await delay(25);
    }
    throw new Error('Isolated database fixture did not settle');
  }
  async function baseline() {
    const input = await helpers.makeSyntheticPackage(root), accepted = await receive(input), done = await wait(accepted.job.id);
    assert.equal(done.job?.state,'complete'); assert.ok(done.job.modelVersionId);
    const version = await repository.getVersion(projectId,done.job.modelVersionId); assert.ok(version);
    await service.selectModel(projectId,version.id,0,requestedBy);
    return { version, job: done.job };
  }
  async function count(prefix: string) {
    let result = 0;
    for await (const _object of client.listObjectsV2('stage4-models',prefix,true)) result++;
    return result;
  }
  return { root,pool,projectId,requestedBy,email,password,client,repository,storage,service,receive,wait,baseline,count };
}

test('real DB rejects false receipts and binds ready metadata to report counts and manifest',async t => {
  const s = await setup(t);
  const input = await helpers.makeSyntheticPackage(s.root), report = await verifyPackage(input.filename);
  const begun = await s.repository.beginImport({ projectId:s.projectId,requestedBy:s.requestedBy,idempotencyKey:randomUUID(),archiveSha256:report.package.sha256,expectedBytes:report.package.bytes });
  assert.ok(begun.lock);
  let job = begun.job;
  try {
    job = await s.repository.updateProgress(job,'staging',report.package.bytes);
    job = await s.repository.updateProgress(job,'validating');
    const reserved = await s.repository.reserve(job,report); assert.equal(reserved.kind,'reserved');
    if (reserved.kind !== 'reserved') throw new Error('Expected a new isolated reservation');
    const receipt = { status:'PASS',algorithm:'SHA-256',resourceCount:report.resourceCount,totalBytes:report.totalRawBytes,verifiedAt:new Date().toISOString() };
    await assert.rejects(s.pool.query('INSERT INTO model_validation_reports(id,report,storage_readback) VALUES($1,$2,$3)',
      [randomUUID(),report,{ ...receipt,status:'FAIL' }]),{ code:'23514',constraint:'model_storage_readback_verified' });
    for (const mode of ['receipt-count','receipt-bytes','report-count','manifest'] as const) {
      const candidate = structuredClone(report), readback = { ...receipt };
      if (mode === 'receipt-count') readback.resourceCount++;
      if (mode === 'receipt-bytes') readback.totalBytes++;
      if (mode === 'report-count') candidate.resourceCount++;
      if (mode === 'manifest') candidate.manifest.label = 'Different synthetic metadata';
      const reportId = randomUUID();
      await s.pool.query('INSERT INTO model_validation_reports(id,report,storage_readback) VALUES($1,$2,$3)',[reportId,candidate,readback]);
      await assert.rejects(s.pool.query("UPDATE model_versions SET state='ready',health='healthy',imported_at=NOW(),validation_report_id=$2 WHERE id=$1",
        [reserved.version.id,reportId]),{ code:'23514',constraint:'model_ready_validation_matches' });
      assert.equal((await s.repository.getVersion(s.projectId,reserved.version.id))?.state,'validating');
    }
    assert.equal((await s.repository.listVersions(s.projectId)).versions.length,0);
    assert.equal((await s.repository.listVersions(s.projectId)).selection.activeModelVersionId,null);
    const ownership = await s.repository.reconcile(job.id); assert.equal(ownership.published,false);
  } finally {
    await s.repository.failImport(job,{ code:'IMPORT_INTERRUPTED',message:'Controlled isolated fixture cleanup' });
    await s.repository.markStagingCleaned(job.id,job.ownerToken);
    await s.repository.markCleaned(job.id,job.ownerToken);
    await begun.lock.release();
  }
});

test('project deletion fences late publication and cleans only retained unpublished ownership',async t => {
  let enabled = false;
  const s = await setup(t,{ beforePublish:async job => {
    if (enabled) await s.pool.query('DELETE FROM projects WHERE id=$1',[job.projectId]);
  } });
  const old = await s.baseline(); enabled = true;
  const candidate = await helpers.makeSyntheticPackage(s.root,{ propertyText:'Project deletion before publish candidate' });
  const accepted = await s.receive(candidate), state = await s.wait(accepted.job.id);
  assert.equal(state.job,null); assert.equal(state.published,false); assert.ok(state.ownership);
  assert.equal(state.ownership.projectId,s.projectId); assert.ok(state.ownership.cleanedAt);
  assert.equal(await s.count(state.ownership.storagePrefix),0);
  for (const table of ['projects','model_versions','model_import_jobs','project_model_selections']) {
    const column = table === 'projects' ? 'id' : 'project_id';
    assert.equal(Number((await s.pool.query(`SELECT count(*) AS n FROM ${table} WHERE ${column}=$1`,[s.projectId])).rows[0].n),0);
  }
  const published = await s.repository.reconcile(old.job.id);
  assert.equal(published.job,null); assert.equal(published.published,true); assert.ok(published.ownership);
  assert.equal(published.ownership.cleanedAt,null);
  await s.repository.markCleaned(old.job.id,old.job.ownerToken);
  await s.service.recover();
  assert.equal((await s.repository.reconcile(old.job.id)).ownership?.cleanedAt,null);
  assert.equal(await s.count(old.version.storagePrefix),old.version.resourceCount);
  const readback = await s.storage.verifyResources(old.version.storagePrefix,old.version.manifest.resources);
  assert.deepEqual(readback,{ resourceCount:old.version.resourceCount,totalBytes:old.version.totalBytes });
});

test('the actual clear-data HTTP route leaves model metadata, explicit selection and raw resources intact',async t => {
  const s = await setup(t), old = await s.baseline();
  const origin = new URL(process.env.WFC_MODEL_REGISTRY_BASE_URL || 'http://proxy');
  assert.equal(origin.hostname,'proxy');
  const login = await fetch(new URL('/api/auth/login',origin),{ method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify({ email:s.email,password:s.password }),signal:AbortSignal.timeout(30000) });
  assert.equal(login.status,200);
  const authentication = await login.json() as { token?: string }; assert.equal(typeof authentication.token,'string');
  const before = await s.repository.listVersions(s.projectId);
  const response = await fetch(new URL(`/api/projects/${s.projectId}/clear-data`,origin),{
    method:'POST',headers:{ Authorization:'Bearer '+authentication.token,'Content-Type':'application/json' },
    body:JSON.stringify({ cableTypes:true,cables:true,trays:true }),signal:AbortSignal.timeout(30000),
  });
  assert.equal(response.status,200);
  const result = await response.json() as { deleted?: { cableTypes:number;cables:number;trays:number } };
  assert.deepEqual(result.deleted,{ cableTypes:0,cables:0,trays:0 });
  const after = await s.repository.listVersions(s.projectId);
  assert.deepEqual(after,before);
  assert.equal(after.selection.activeModelVersionId,old.version.id);
  assert.equal(after.selection.selectionRevision,before.selection.selectionRevision);
  const state = await s.repository.reconcile(old.job.id); assert.equal(state.published,true);
  assert.equal(await s.count(old.version.storagePrefix),old.version.resourceCount);
  assert.deepEqual(await s.storage.verifyResources(old.version.storagePrefix,old.version.manifest.resources),{ resourceCount:old.version.resourceCount,totalBytes:old.version.totalBytes });
});

for (const revocation of ['assignment', 'role'] as const) {
  test(`active-model HTTP rechecks current ${revocation} after waiting for the project lock`, async t => {
    const s = await setup(t), old = await s.baseline();
    const origin = new URL(process.env.WFC_MODEL_REGISTRY_BASE_URL || 'http://proxy');
    assert.equal(origin.hostname, 'proxy');
    const login = await fetch(new URL('/api/auth/login', origin), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: s.email, password: s.password }), signal: AbortSignal.timeout(30000),
    });
    assert.equal(login.status, 200);
    const authentication = await login.json() as { token: string };
    assert.equal(typeof authentication.token, 'string');
    const before = (await s.repository.listVersions(s.projectId)).selection;
    const blocker = await s.pool.connect();
    let pending: Promise<Response> | undefined;
    try {
      await blocker.query('BEGIN');
      const blockerPid = Number((await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
      await blocker.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE', [s.projectId]);
      pending = fetch(new URL(`/api/projects/${s.projectId}/active-model`, origin), {
        method: 'PATCH', headers: { Authorization: 'Bearer ' + authentication.token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelVersionId: null, expectedSelectionRevision: before.selectionRevision }),
        signal: AbortSignal.timeout(30000),
      });
      const deadline = Date.now() + 10000;
      let observedWaitingRequest = false;
      while (Date.now() < deadline) {
        const waiting = await s.pool.query(`SELECT pid FROM pg_stat_activity
          WHERE datname=current_database() AND wait_event_type='Lock'
          AND query='SELECT id FROM projects WHERE id=$1 FOR UPDATE'
          AND $1::integer=ANY(pg_blocking_pids(pid))`, [blockerPid]);
        if (waiting.rows.length === 1) { observedWaitingRequest = true; break; }
        await delay(20);
      }
      assert.equal(observedWaitingRequest, true, 'The actual HTTP selection must reach the locked transaction.');
      if (revocation === 'assignment') {
        await s.pool.query('DELETE FROM user_project_access WHERE user_id=$1 AND project_id=$2', [s.requestedBy, s.projectId]);
      } else {
        await s.pool.query("UPDATE users SET role='basic' WHERE id=$1", [s.requestedBy]);
      }
      await blocker.query('COMMIT');
      const response = await pending;
      assert.equal(response.status, 403);
      const denied = await response.json() as { code: string };
      assert.equal(denied.code, 'IMPORT_ACCESS_REVOKED');
      assert.deepEqual((await s.repository.listVersions(s.projectId)).selection, before);
      assert.equal((await s.repository.getVersion(s.projectId, old.version.id))?.state, 'ready');
    } finally {
      await blocker.query('ROLLBACK').catch(() => undefined);
      blocker.release();
      await pending?.catch(() => undefined);
    }
  });
}
