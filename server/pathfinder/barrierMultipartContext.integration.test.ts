// @vitest-environment node
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import express from 'express';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BARRIER_MULTIPART_PROFILE, barrierMultipartCanonicalBytes, barrierMultipartCanonicalJson,
  barrierMultipartPageHashInput, type BarrierMultipartPage, type BarrierMultipartScope } from '../../shared/pathfinderBarrierMultipart.js';
import { barrierMultipartAdmitReceiptSchema, barrierMultipartStageReceiptSchema, type BarrierMultipartSession } from '../../shared/pathfinderBarrierMultipartSessions.js';
import { barrierCanonicalJson } from '../../shared/pathfinderBarriers.js';
import { BARRIER_MULTIPART_PRODUCER_PROFILE, validateBarrierMultipartContext } from '../../viewer-runtime/barrier-multipart-protocol.mjs';
import { createBarrierMultipartRouter } from './barrierMultipartRoutes.js';
import { initializeBarrierMultipartSchema } from './barrierMultipartSchema.js';
import { createBarrierMultipartStorage } from './barrierMultipartStorage.js';
import { barrierFrameProjectionHash } from './barrierScope.js';
import { geometryTraceFixture } from './geometryTraceFixtures.js';
import { buildGeometryTrace } from './geometryTraceBuilder.js';

// Actual HTTP + PostgreSQL + filesystem, explicitly opt-in to the same fresh
// private Linux fixture as B13b. All preparation records below are synthetic;
// this does not run application initialization, model/SDK extraction or geometry
// qualification. There are NO mocked principal/scope/context/repository adapters.
const fixtureFile = process.env.PF_B13B_SQL_FIXTURE;
const id = () => randomUUID(), hash = (value: unknown) => createHash('sha256').update(barrierMultipartCanonicalBytes(value)).digest('hex');
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const same = (a: string, b: string) => path.resolve(a) === path.resolve(b);
const inside = (root: string, filename: string) => { const relative = path.relative(root, filename); return relative === '' || !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep); };
type Viewer = { sessionId: string; loginId: string; cookie: string; expiresAt: Date; absoluteExpiresAt: Date };

describe.skipIf(!fixtureFile).sequential('actual protected multipart cookie HTTP and PostgreSQL, synthetic prepared frame only', () => {
  let pool: Pool | undefined, server: Server | undefined, router: ReturnType<typeof createBarrierMultipartRouter> | undefined;
  let origin: string, projectId: string, modelVersionId: string, loadId: string, actorId: string, dataRoot: string;
  let main: Viewer, positiveSession: BarrierMultipartSession;
  let scope: BarrierMultipartScope;
  const controls = { afterStore: null as (() => Promise<void>) | null };
  const db = () => { if (!pool) throw Error('PF_B13C_HTTP_FIXTURE_NOT_READY'); return pool; };
  async function createViewer(): Promise<Viewer> {
    const viewer = { sessionId: id(), loginId: id(), cookie: randomBytes(32).toString('base64url'), expiresAt: new Date(Date.now() + 300000), absoluteExpiresAt: new Date(Date.now() + 1800000) };
    await db().query('INSERT INTO viewer_login_bindings(login_id,user_id,expires_at) VALUES($1,$2,$3)', [viewer.loginId, actorId, viewer.absoluteExpiresAt]);
    await db().query(`INSERT INTO viewer_resource_sessions(id,project_id,model_version_id,user_id,login_id,load_id,selection_revision,secret_hash,expires_at,absolute_expires_at)
      VALUES($1,$2,$3,$4,$5,$6,1,$7,$8,$9)`, [viewer.sessionId, projectId, modelVersionId, actorId, viewer.loginId, loadId, sha(viewer.cookie), viewer.expiresAt, viewer.absoluteExpiresAt]);
    return viewer;
  }
  function admission() {
    const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const frame = { schemaVersion: 'wfc.pf.barrier-frame-observation.v1', projectId, modelVersionId, contentFingerprint: scope.modelScope.contentFingerprint,
      loadId, sdkVersion: '7.130.0', matrixPrecision: 'binary64', coordinateFrame: 'canonical-world-metres', sourceUnits: 'm', metresPerDisplayUnit: 1,
      upVector: [0, 0, 1], globalOffsetDisplayUnits: [0, 0, 0], globalOffsetMetres: [0, 0, 0], displayToWorldMetres: matrix, modelTransform: null, placementTransform: null };
    return { command: { schemaVersion: 'wfc.pf.barrier-multipart-admit.v2', idempotencyKey: id(), scope: structuredClone(scope), profile: BARRIER_MULTIPART_PROFILE,
      expectedRegistryRevision: '0', selectedParentLabels: scope.selectedParents.map(p => ({ selectionId: p.selectionId, name: 'Synthetic selected complete wall' })), reservation: { bytes: 2 * 1024 ** 2, files: 40 } },
    frameObservation: { ...frame, contentSha256: sha(barrierCanonicalJson(frame)) }, producerProfile: BARRIER_MULTIPART_PRODUCER_PROFILE };
  }
  const prefix = (viewer: Viewer) => `/api/projects/${projectId}/model-versions/${modelVersionId}/viewer-sessions/${viewer.sessionId}/barrier-multipart`;
  async function http(viewer: Viewer, suffix: string, options: { method?: string; body?: unknown; cookie?: string | null; bearer?: string; requestOrigin?: string } = {}) {
    // Fixed own listener and route; no caller-selected URL/network destination.
    if (!suffix.startsWith('/') || suffix.includes('://') || suffix.includes('?') || suffix.includes('\\')) throw Error('PF_B13C_HTTP_TEST_ROUTE');
    const response = await fetch(origin + prefix(viewer) + suffix, { method: options.method ?? 'GET', signal: AbortSignal.timeout(15000), redirect: 'error',
      headers: { Origin: options.requestOrigin ?? origin, ...(options.cookie === null ? {} : { Cookie: 'wfc_viewer_session=' + (options.cookie ?? viewer.cookie) }),
        ...(options.bearer ? { Authorization: 'Bearer ' + options.bearer } : {}), ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body) });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }
  async function admit(viewer = main) {
    const request = admission(), response = await http(viewer, '/sessions', { method: 'POST', body: request });
    expect(response.status).toBe(200); return { request, receipt: barrierMultipartAdmitReceiptSchema.parse(response.body) };
  }
  function pageCommand(session: BarrierMultipartSession, index = 0) {
    const page: BarrierMultipartPage = { schemaVersion: 'wfc.pf.barrier-multipart-page.v2', kind: 'nodes', scopeSha256: session.scopeSha256, profileSha256: session.profileSha256,
      index, firstOrdinal: index, previousPageSha256: index ? 'f'.repeat(64) : null, records: [{ dbId: 9 + index, membershipMask: '0'.repeat(31) + '1' }], pageSha256: '0'.repeat(64) };
    page.pageSha256 = hash(barrierMultipartPageHashInput(page));
    return { schemaVersion: 'wfc.pf.barrier-multipart-stage-page.v2', intentId: session.id, expectedSessionRevision: session.sessionRevision,
      idempotencyKey: id(), scopeSha256: session.scopeSha256, profileSha256: session.profileSha256, page };
  }
  const rowCounts = async () => (await db().query(`SELECT
    (SELECT count(*)::int FROM pf_barrier_multipart_sessions) AS sessions,
    (SELECT count(*)::int FROM pf_barrier_multipart_allocations) AS allocations,
    (SELECT count(*)::int FROM pf_barrier_multipart_receipts) AS receipts,
    (SELECT count(*)::int FROM pf_barrier_multipart_viewer_contexts) AS contexts,
    (SELECT count(*)::int FROM pf_barrier_heads) AS heads`)).rows[0];

  beforeAll(async () => {
    if (process.platform !== 'linux') throw Error('PF_B13C_HTTP_LINUX_REQUIRED');
    const root = process.env.PF_B13B_FIXTURE_ROOT, configuredData = process.env.PF_B13B_DATA_ROOT;
    if (!root || !configuredData || !fixtureFile || !path.isAbsolute(root) || !path.isAbsolute(configuredData) || !path.isAbsolute(fixtureFile) || !inside(root, fixtureFile)) throw Error('PF_B13C_HTTP_EXPLICIT_FIXTURE_REQUIRED');
    for (const directory of [root, configuredData]) { const stat = await fs.lstat(directory); if (!stat.isDirectory() || stat.isSymbolicLink() || !same(await fs.realpath(directory), directory)) throw Error('PF_B13C_HTTP_FIXTURE_PATH'); }
    const before = await fs.lstat(fixtureFile); if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > 8192 || !same(await fs.realpath(fixtureFile), fixtureFile)) throw Error('PF_B13C_HTTP_FIXTURE_PATH');
    const bytes = await fs.readFile(fixtureFile), after = await fs.lstat(fixtureFile);
    if (before.ino !== after.ino || before.dev !== after.dev || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw Error('PF_B13C_HTTP_FIXTURE_CHANGED');
    const config = JSON.parse(bytes.toString('utf8')) as { ownerId: string; connectionString: string; database: string; dataRoot: string };
    if (Object.keys(config).sort().join(',') !== 'connectionString,dataRoot,database,ownerId' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(config.ownerId)
      || !/^wfc_pfb13b_[a-f0-9]{32}$/.test(config.database) || !same(config.dataRoot, configuredData)) throw Error('PF_B13C_HTTP_FIXTURE_SCOPE');
    let url: URL; try { url = new URL(config.connectionString); } catch { throw Error('PF_B13C_HTTP_FIXTURE_DATABASE'); }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== 'pg-b13b' || url.port && url.port !== '5432' || decodeURIComponent(url.pathname.slice(1)) !== config.database || url.search || url.hash) throw Error('PF_B13C_HTTP_FIXTURE_DATABASE');
    const ownerPool = new Pool({ connectionString: config.connectionString, max: 1 });
    try {
      const owner = (await ownerPool.query<{ name: string; owner: string }>('SELECT current_database() AS name,owner::text FROM public.pfb13b_fixture_owner')).rows;
      if (owner.length !== 1 || owner[0].name !== config.database || owner[0].owner !== config.ownerId) throw Error('PF_B13C_HTTP_FIXTURE_OWNER');
      if ((await ownerPool.query("SELECT 1 FROM pg_namespace WHERE nspname='pfb13c_context'")).rows.length) throw Error('PF_B13C_HTTP_FRESH_SCHEMA_REQUIRED');
      await ownerPool.query('CREATE SCHEMA pfb13c_context');
    } finally { await ownerPool.end(); }
    pool = new Pool({ connectionString: config.connectionString, max: 4, options: '-c search_path=pfb13c_context,public' });
    await db().query(`CREATE TABLE projects(id uuid PRIMARY KEY); CREATE TABLE users(id uuid PRIMARY KEY,is_admin boolean NOT NULL);
      CREATE TABLE viewer_login_bindings(login_id uuid PRIMARY KEY,user_id uuid NOT NULL,expires_at timestamptz NOT NULL,revoked_at timestamptz);
      CREATE TABLE viewer_resource_sessions(id uuid PRIMARY KEY,project_id uuid NOT NULL,model_version_id uuid NOT NULL,user_id uuid NOT NULL,login_id uuid NOT NULL,
        load_id uuid NOT NULL,selection_revision bigint NOT NULL,secret_hash text NOT NULL,expires_at timestamptz NOT NULL,absolute_expires_at timestamptz NOT NULL,revoked_at timestamptz);
      CREATE TABLE model_versions(id uuid PRIMARY KEY,project_id uuid NOT NULL,content_fingerprint text NOT NULL,state text NOT NULL,health text NOT NULL);
      CREATE TABLE project_model_selections(project_id uuid PRIMARY KEY,active_model_version_id uuid NOT NULL,selection_revision bigint NOT NULL);
      CREATE TABLE pf_project_preparations(project_id uuid PRIMARY KEY,current_aggregate_id uuid NOT NULL,current_artifact_id uuid NOT NULL);
      CREATE TABLE pf_preparation_aggregates(id uuid PRIMARY KEY,project_id uuid NOT NULL,manifest jsonb NOT NULL);
      CREATE TABLE pf_artifacts(id uuid PRIMARY KEY,project_id uuid NOT NULL,model_version_id uuid NOT NULL,snapshot_sha256 text NOT NULL);
      CREATE TABLE pf_geometry_trace_sets(id uuid PRIMARY KEY,project_id uuid NOT NULL,aggregate_id uuid NOT NULL,manifest jsonb NOT NULL);
      CREATE TABLE pf_geometry_object_revisions(id uuid PRIMARY KEY,project_id uuid NOT NULL,trace_id uuid NOT NULL,record jsonb NOT NULL,summary jsonb NOT NULL);
      CREATE TABLE pf_barrier_heads(project_id uuid PRIMARY KEY,revision bigint NOT NULL,snapshot_id uuid);`);
    await initializeBarrierMultipartSchema(db());
    const source = geometryTraceFixture(), built = buildGeometryTrace(source), aggregate = source.aggregate;
    projectId = aggregate.projectId; modelVersionId = aggregate.modelVersionId; loadId = id(); actorId = id();
    await db().query('INSERT INTO projects VALUES($1)', [projectId]); await db().query('INSERT INTO users VALUES($1,true)', [actorId]);
    await db().query("INSERT INTO model_versions VALUES($1,$2,$3,'ready','healthy')", [modelVersionId, projectId, aggregate.contentFingerprint]);
    await db().query('INSERT INTO project_model_selections VALUES($1,$2,$3)', [projectId, modelVersionId, aggregate.selectionRevision]);
    await db().query('INSERT INTO pf_project_preparations VALUES($1,$2,$3)', [projectId, aggregate.id, aggregate.artifactId]);
    await db().query('INSERT INTO pf_preparation_aggregates VALUES($1,$2,$3::jsonb)', [aggregate.id, projectId, JSON.stringify(aggregate)]);
    await db().query('INSERT INTO pf_artifacts VALUES($1,$2,$3,$4)', [aggregate.artifactId, projectId, modelVersionId, aggregate.projection.sha256]);
    await db().query('INSERT INTO pf_geometry_trace_sets VALUES($1,$2,$3,$4::jsonb)', [built.manifest.id, projectId, aggregate.id, JSON.stringify(built.manifest)]);
    for (let index = 0; index < built.records.length; index++) await db().query('INSERT INTO pf_geometry_object_revisions VALUES($1,$2,$3,$4::jsonb,$5::jsonb)',
      [built.records[index].id, projectId, built.manifest.id, JSON.stringify(built.records[index]), JSON.stringify(built.summaries[index])]);
    const record = built.records[0];
    scope = { schemaVersion: 'wfc.pf.barrier-multipart-scope.v2', modelScope: { projectId, modelVersionId, contentFingerprint: aggregate.contentFingerprint,
      selectionRevision: aggregate.selectionRevision, captureFrameId: aggregate.coordinateFrameId, coordinateFrame: 'canonical-world-metres',
      captureFrameSha256: barrierFrameProjectionHash({ coordinateFrame: 'canonical-world-metres', displayToWorldMetres: record.coordinates.displayToWorldMetres, globalOffsetMetres: record.coordinates.globalOffsetMetres }) },
    modelLoadId: loadId, selectedParents: [{ selectionId: id(), dbId: 9, kind: 'wall' }], geometryPolicy: 'original-triangles-structural-only.v2' };
    main = await createViewer(); dataRoot = path.join(configuredData, 'protected-http-' + config.ownerId); await fs.mkdir(dataRoot, { mode: 0o700 });
    const realStorage = createBarrierMultipartStorage(dataRoot), app = express(), origins: string[] = [];
    router = createBarrierMultipartRouter(db(), { policy: { origins, allowHttpLoopback: true, trustProxy: false }, storage: { ...realStorage,
      store: async (...args) => { const stored = await realStorage.store(...args), action = controls.afterStore; controls.afterStore = null; if (action) await action(); return stored; } } });
    app.use('/api/projects/:projectId/model-versions/:modelVersionId/viewer-sessions/:sessionId/barrier-multipart', router);
    server = createServer(app); await new Promise<void>((resolve, reject) => { server!.once('error', reject); server!.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => { server!.off('error', reject); resolve(); }); });
    const address = server.address(); if (!address || typeof address === 'string' || address.address !== '127.0.0.1' || address.port < 1) throw Error('PF_B13C_HTTP_LOOPBACK_ONLY');
    origin = 'http://127.0.0.1:' + address.port; origins.push(origin);
  });
  afterAll(async () => {
    let cleanupFailure: unknown;
    if (router) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([router.close(), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(Error('PF_B13C_HTTP_ROUTE_JOIN_UNCONFIRMED')), 5000); })]); }
      catch (error) { cleanupFailure = error; } finally { clearTimeout(timer); }
    }
    if (server) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([new Promise<void>((resolve, reject) => { server!.close(error => error ? reject(error) : resolve()); server!.closeIdleConnections(); }),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { server!.closeAllConnections(); reject(Error('PF_B13C_HTTP_LISTENER_JOIN_UNCONFIRMED')); }, 5000); })]); }
      catch (error) { cleanupFailure ??= error; } finally { clearTimeout(timer); }
    }
    if (pool) await pool.end(); if (cleanupFailure) throw cleanupFailure;
    // Preserve the exact own schema and staged files for root's fixture receipt.
  });

  it('refuses missing/incorrect cookie and Bearer substitution before admitting any session', async () => {
    const before = await rowCounts();
    for (const refusal of [{ cookie: null, status: 400, code: 'BARRIER_MULTIPART_HEADER_INVALID' },
      { cookie: 'q'.repeat(43), status: 401, code: 'BARRIER_MULTIPART_VIEWER_ACCESS_DENIED' }]) {
      const response = await http(main, '/sessions', { method: 'POST', body: admission(), cookie: refusal.cookie, bearer: 'cannot-substitute-for-viewer-cookie' });
      expect(response.status).toBe(refusal.status); expect(response.body.code).toBe(refusal.code);
    }
    expect(await rowCounts()).toEqual(before);
  });
  it('uses actual cookie/admin/load and prepared-frame SQL to admit, durably stage, replay and read one exact page', async () => {
    const { request, receipt } = await admit(); positiveSession = receipt.session;
    expect(positiveSession.principal).toEqual({ kind: 'current-login-admin', actorId, loginId: main.loginId }); expect(positiveSession.authority).toBe('none');
    const context = await http(main, '/' + positiveSession.id + '/context'); expect(context.status).toBe(200); expect(validateBarrierMultipartContext(context.body)).toBe(true);
    const duplicate = await http(main, '/sessions', { method: 'POST', body: request }); expect(duplicate.status).toBe(200); expect(duplicate.body.duplicate).toBe(true);
    const command = pageCommand(positiveSession), result = await http(main, '/' + positiveSession.id + '/pages', { method: 'POST', body: command }); expect(result.status).toBe(200);
    const stored = barrierMultipartStageReceiptSchema.parse(result.body); expect(stored).toMatchObject({ kind: 'page', authority: 'none', geometryValidation: 'NOT_VALIDATED' });
    const filename = path.join(dataRoot, 'barrier-multipart-v2', stored.stored.blobId + '.control'), raw = await fs.readFile(filename);
    expect(raw.toString('utf8')).toBe(barrierMultipartCanonicalJson(command.page)); expect(createHash('sha256').update(raw).digest('hex')).toBe(stored.stored.sha256);
    const saved = await http(main, '/' + positiveSession.id + '/context'), read = await http(main, '/' + positiveSession.id + '/pages/nodes/0');
    expect(read.status).toBe(200); expect(read.body).toEqual(command.page); expect((await http(main, '/' + positiveSession.id + '/context')).body).toEqual(saved.body);
    expect((await rowCounts())).toEqual({ sessions: 1, allocations: 1, receipts: 1, contexts: 1, heads: 0 });
  });
  it('fences fresh administrator loss in actual HTTP before reads or further allocations', async () => {
    const before = await rowCounts(); await db().query('UPDATE users SET is_admin=false WHERE id=$1', [actorId]);
    try {
      const read = await http(main, '/' + positiveSession.id + '/context'), write = await http(main, '/' + positiveSession.id + '/pages', { method: 'POST', body: pageCommand(positiveSession, 1) });
      expect(read.status).toBe(403); expect(read.body.code).toBe('ADMIN_REQUIRED'); expect(write.status).toBe(403); expect(await rowCounts()).toEqual(before);
    } finally { await db().query('UPDATE users SET is_admin=true WHERE id=$1', [actorId]); }
  });
  it('rejects a different Viewer cookie path and a permanently revoked own cookie session', async () => {
    const other = await createViewer(), { receipt } = await admit(other), before = await rowCounts();
    const swapped = await http(other, '/' + receipt.session.id + '/context', { cookie: main.cookie }); expect(swapped.status).toBe(401);
    await db().query('UPDATE viewer_resource_sessions SET revoked_at=now() WHERE id=$1', [other.sessionId]);
    const revoked = await http(other, '/' + receipt.session.id + '/context'); expect(revoked.status).toBe(409); expect(revoked.body.code).toBe('BARRIER_MULTIPART_VIEWER_CHANGED');
    expect(await rowCounts()).toEqual(before);
  });
  it('enforces actual login tombstone without renewing or replacing the immutable capture context', async () => {
    const other = await createViewer(), { receipt } = await admit(other), before = await rowCounts();
    await db().query('UPDATE viewer_login_bindings SET revoked_at=now() WHERE login_id=$1', [other.loginId]);
    const response = await http(other, '/' + receipt.session.id + '/context'); expect(response.status).toBe(401); expect(response.body.code).toBe('LOGIN_REVOKED');
    expect(await rowCounts()).toEqual(before);
  });
  it('withholds final receipt after real bytes are fsynced and the current administrator is revoked before COMMIT', async () => {
    const { receipt } = await admit(), command = pageCommand(receipt.session), before = await rowCounts();
    controls.afterStore = async () => { await db().query('UPDATE users SET is_admin=false WHERE id=$1', [actorId]); };
    try {
      const response = await http(main, '/' + receipt.session.id + '/pages', { method: 'POST', body: command }); expect(response.status).toBe(403); expect(response.body.code).toBe('ADMIN_REQUIRED');
      const counts = await rowCounts(); expect(counts.receipts).toBe(before.receipts); expect(counts.allocations).toBe(before.allocations + 1); expect(counts.heads).toBe(0);
      const retained = (await db().query('SELECT charged_files,counts,pending_allocation FROM pf_barrier_multipart_sessions WHERE id=$1', [receipt.session.id])).rows[0];
      expect(retained.charged_files).toBe(2); expect(retained.counts.pages).toBe(0); expect(retained.pending_allocation).not.toBeNull();
    } finally { controls.afterStore = null; await db().query('UPDATE users SET is_admin=true WHERE id=$1', [actorId]); }
  });
  it('withholds final receipt after file IO when the actual Viewer cookie is revoked', async () => {
    const other = await createViewer(), { receipt } = await admit(other), command = pageCommand(receipt.session), before = await rowCounts();
    controls.afterStore = async () => { await db().query('UPDATE viewer_resource_sessions SET revoked_at=now() WHERE id=$1', [other.sessionId]); };
    const response = await http(other, '/' + receipt.session.id + '/pages', { method: 'POST', body: command }); expect(response.status).toBe(409); expect(response.body.code).toBe('BARRIER_MULTIPART_VIEWER_CHANGED');
    expect((await rowCounts()).receipts).toBe(before.receipts); expect((await rowCounts()).heads).toBe(0);
  });
});
