// @vitest-environment node
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { barrierCanonicalJson, type BarrierCapture, type BarrierModelScope } from '../../shared/pathfinderBarriers.js';
import { MIXED_BARRIER_POLICY } from '../../shared/pathfinderBarrierMixed.js';
import { supportedBarrierCaptureCommandSchema, supportedBarrierPublicationReceiptSchema, supportedBarrierCaptureOutcomeSchema, supportedBarrierSnapshotSchema, supportedBarrierIntentReceiptSchema } from '../../shared/pathfinderBarrierSupported.js';
import { barrierCommandRecoveryTargetSchema, barrierCommandRecoveryResponseSchema, matchBarrierCommandRecovery,
  type BarrierCommandRecoveryTarget } from '../../shared/pathfinderBarrierRecovery.js';
import { barrierCaptureOutcomeSchema, barrierPublicationReceiptSchema, barrierPublicationRefusalReceiptSchema } from '../../shared/pathfinderBarrierOutcomes.js';
import { barrierEnumerationHashInput } from '../../viewer-runtime/barrier-capture.mjs';
import { createBarrierRouter } from './barrierRoutes.js';
import { initializeBarrierRegistrySchema } from './barrierRegistrySchema.js';
import { currentBarrierScope } from './barrierScope.js';
import { geometryTraceFixture } from './geometryTraceFixtures.js';
import { buildGeometryTrace } from './geometryTraceBuilder.js';
import { readBarrierBytes } from './barrierStorage.js';
import { BarrierCaptureQualificationRefusal, createBarrierRegistryRepository, type BarrierRegistryAdapters } from './barrierRegistryRepository.js';
import type { JobPrincipal } from './jobContracts.js';

// The driver stages this file at server/pathfinder/. It uses only a fresh owned
// PostgreSQL schema, synthetic preparation/capture, real JWT+cookie+routes and
// the exact reused B20 root-compiled portable net9 verifier and its original
// source/log/artifact receipt, pinned by the B21 private fixture driver.
// No SDK/model/business data or B21 recompile claim.
const fixtureFile = process.env.PF_B21_RECOVERY_FIXTURE;
const hash = (value: unknown) => createHash('sha256').update(barrierCanonicalJson(value)).digest('hex');
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function expectStatus(response: { status: number; body: unknown }, expected: number) {
  const candidate = response.body !== null && typeof response.body === 'object' ? (response.body as { code?: unknown }).code : undefined;
  const code = typeof candidate === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/.test(candidate) ? candidate : null;
  // Retain only a closed reason code in failures, never credentials or headers.
    expect(response.status, 'B21_HTTP_STATUS ' + JSON.stringify({ status: response.status, body: { code } })).toBe(expected);
}
describe.skipIf(!fixtureFile).sequential('B21 real SQL + current-admin recovery + cookie HTTP with synthetic exact barriers', () => {
  let pool: Pool, server: Server | undefined, origin = '', projectId = '', modelId = '', actorId = '', loginId = '', loadId = '', sessionId = '', cookie = '', token = '', loginExpiresAt = 0;
  let scope: BarrierModelScope;
  const priorRoot = process.env.PF_ROOT;
  const adminBase = () => `/api/projects/${projectId}/pathfinder/barriers`;
  const viewerBase = () => `/api/projects/${projectId}/model-versions/${modelId}/viewer-sessions/${sessionId}/barriers`;
  const counts = async () => (await pool.query(`SELECT (SELECT count(*)::int FROM pf_barrier_heads) AS heads,
    (SELECT count(*)::int FROM pf_barrier_snapshots) AS snapshots,(SELECT count(*)::int FROM pf_barrier_receipts) AS receipts`)).rows[0];
  async function http(suffix: string, options: { method?: string; body?: unknown; viewer?: boolean; cookie?: string | null; origin?: string; bearer?: string; query?: Record<string, string> } = {}) {
    if (!suffix.startsWith('/') || suffix.includes('://') || suffix.includes('?') || suffix.includes('\\')) throw Error('B21_FIXED_TEST_ROUTE');
    const query = options.query ? '?' + new URLSearchParams(options.query).toString() : '';
    const response = await fetch(origin + (options.viewer ? viewerBase() : adminBase()) + suffix + query, {
      method: options.method ?? 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Authorization: 'Bearer ' + (options.bearer ?? token), Origin: options.origin ?? origin,
        ...(options.viewer && options.cookie !== null ? { Cookie: 'wfc_viewer_session=' + (options.cookie ?? cookie) } : {}),
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body) });
    const text = await response.text(); if (Buffer.byteLength(text) > 1024 * 1024) throw Error('B21_HTTP_BODY_BOUND');
    return { status: response.status, body: JSON.parse(text) as unknown };
  }
  async function observation(kind: 'floor' | 'wall', open: boolean, mode: 'v1' | 'v2' = 'v1') {
    const current = await http('/'); expectStatus(current, 200);
    const registry = current.body as { registryRevision: string };
    const selectedParents = [{ selectionId: randomUUID(), kind, objectId: 'dbid:9', dbId: 9, externalId: null,
      name: open ? 'Synthetic single open floor surface' : 'Synthetic closed obstacle', identityBasis: 'version-local-only', inclusion: 'own-and-all-descendant-fragments' }];
    const command = supportedBarrierCaptureCommandSchema.parse({ ...(mode === 'v2' ? { schemaVersion: 'wfc.pf.barrier-capture-command.v2', geometryPolicy: MIXED_BARRIER_POLICY } : { schemaVersion: 'wfc.pf.barrier-capture-command.v1' }), scope,
      expectedRegistryRevision: registry.registryRevision, idempotencyKey: randomUUID(), selectedParents });
    const admitted = await http('/intents', { method: 'POST', body: command }); expectStatus(admitted, 200);
    const intent = supportedBarrierIntentReceiptSchema.parse(admitted.body).intent;
    const frameBody = { schemaVersion: 'wfc.pf.barrier-frame-observation.v1', projectId, modelVersionId: modelId,
      contentFingerprint: scope.contentFingerprint, loadId, sdkVersion: '7.130.0', matrixPrecision: 'binary64', coordinateFrame: 'canonical-world-metres',
      sourceUnits: 'm', metresPerDisplayUnit: 1, upVector: [0, 0, 1], globalOffsetDisplayUnits: [0, 0, 0], globalOffsetMetres: [0, 0, 0],
      displayToWorldMetres: matrix, modelTransform: null, placementTransform: null };
    const frameObservation = { ...frameBody, contentSha256: hash(frameBody) };
    const capture: BarrierCapture = { schemaVersion: 'wfc.pf.barrier-capture.v1', captureId: intent.id, scope, selectedParents: command.selectedParents,
      fragments: [{ source: { fragmentId: 7, ownerObjectId: 'dbid:9', parentSelectionIds: [command.selectedParents[0].selectionId],
        sourceUnits: 'm', metresPerSourceUnit: 1, sourceToWorldMetres: matrix, transformSha256: hash(matrix) },
      bounds: { minimum: [0, 0, 0], maximum: open ? [4, 4, 0] : [1, 1, 1] },
      verticesMetres: open ? [[0, 0, 0], [4, 0, 0], [4, 4, 0], [0, 4, 0]]
        : [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
      triangleIndices: open ? [0, 1, 2, 0, 2, 3]
        : [0, 3, 2, 0, 2, 1, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5] }],
      observation: { state: 'reported-complete', verification: 'unverified', enumeratedFragmentIds: [7], unavailableFragmentIds: [], enumerationSha256: '0'.repeat(64) } };
    capture.observation.enumerationSha256 = hash(barrierEnumerationHashInput(capture));
    return { intent, command, body: { capture, frameObservation }, query: { commandSha256: hash(command), captureSha256: hash(capture), frameSha256: frameObservation.contentSha256 } };
  }
  beforeAll(async () => {
    if (process.platform !== 'linux' || !fixtureFile || !path.isAbsolute(fixtureFile) || !fixtureFile.startsWith('/proof/')) throw Error('B21_EXPLICIT_PRIVATE_FIXTURE_REQUIRED');
    const stat = await fs.lstat(fixtureFile); if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 8192) throw Error('B21_FIXTURE_FILE');
    const config = JSON.parse(await fs.readFile(fixtureFile, 'utf8')) as { ownerId: string; connectionString: string };
    const url = new URL(config.connectionString);
    if (!/^[a-f0-9-]{36}$/.test(config.ownerId) || url.hostname !== '127.0.0.1' || url.port !== '55439' || url.pathname !== '/pf_b2_fixture'
      || decodeURIComponent(url.username) !== 'pf_b2_fixture' || url.search || url.hash) throw Error('B21_FIXTURE_DATABASE');
    const check = new Pool({ connectionString: config.connectionString, max: 1 });
    try {
      const owners = (await check.query('SELECT owner::text FROM pfb21_owner.ownership')).rows;
      if (owners.length !== 1 || owners[0].owner !== config.ownerId || (await check.query("SELECT 1 FROM pg_namespace WHERE nspname='pfb21_recovery'")).rows.length) throw Error('B21_FRESH_SCHEMA_OWNER');
      await check.query('CREATE SCHEMA pfb21_recovery');
    } finally { await check.end(); }
    const httpRoot = process.env.PF_B21_RECOVERY_ROOT;
    if (!httpRoot || httpRoot !== '/app/source/pathfinder-engine/.scratch/b21-' + config.ownerId + '/recovery-storage') throw Error('B21_HTTP_STORAGE_SCOPE');
    await fs.mkdir(httpRoot, { mode: 0o700 }); process.env.PF_ROOT = httpRoot;
    pool = new Pool({ connectionString: config.connectionString, max: 4, connectionTimeoutMillis: 3000, query_timeout: 15000, options: '-c search_path=pfb21_recovery,public' });
    await pool.query(`CREATE TABLE projects(id uuid PRIMARY KEY); CREATE TABLE users(id uuid PRIMARY KEY,is_admin boolean NOT NULL);
      CREATE TABLE viewer_login_bindings(login_id uuid PRIMARY KEY,user_id uuid NOT NULL,expires_at timestamptz NOT NULL,revoked_at timestamptz);
      CREATE TABLE viewer_resource_sessions(id uuid PRIMARY KEY,project_id uuid NOT NULL,model_version_id uuid NOT NULL,user_id uuid NOT NULL,login_id uuid NOT NULL,
        load_id uuid NOT NULL,selection_revision bigint NOT NULL,secret_hash text NOT NULL,expires_at timestamptz NOT NULL,absolute_expires_at timestamptz NOT NULL,revoked_at timestamptz);
      CREATE TABLE model_versions(id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id),content_fingerprint text NOT NULL,state text NOT NULL,health text NOT NULL,UNIQUE(project_id,id));
      CREATE TABLE project_model_selections(project_id uuid PRIMARY KEY,active_model_version_id uuid NOT NULL,selection_revision bigint NOT NULL);
      CREATE TABLE pf_project_preparations(project_id uuid PRIMARY KEY,current_aggregate_id uuid NOT NULL,current_artifact_id uuid NOT NULL);
      CREATE TABLE pf_preparation_aggregates(id uuid PRIMARY KEY,project_id uuid NOT NULL,manifest jsonb NOT NULL);
      CREATE TABLE pf_artifacts(id uuid PRIMARY KEY,project_id uuid NOT NULL,model_version_id uuid NOT NULL,snapshot_sha256 text NOT NULL);
      CREATE TABLE pf_geometry_trace_sets(id uuid PRIMARY KEY,project_id uuid NOT NULL,aggregate_id uuid NOT NULL,manifest jsonb NOT NULL);
      CREATE TABLE pf_geometry_object_revisions(id uuid PRIMARY KEY,project_id uuid NOT NULL,trace_id uuid NOT NULL,record jsonb NOT NULL,summary jsonb NOT NULL);`);
    await initializeBarrierRegistrySchema(pool);
    const source = geometryTraceFixture(), built = buildGeometryTrace(source), aggregate = source.aggregate;
    projectId = aggregate.projectId; modelId = aggregate.modelVersionId; actorId = randomUUID(); loginId = randomUUID(); loadId = randomUUID(); sessionId = randomUUID(); cookie = randomBytes(32).toString('base64url');
    await pool.query('INSERT INTO projects VALUES($1)', [projectId]); await pool.query('INSERT INTO users VALUES($1,true)', [actorId]);
    await pool.query("INSERT INTO model_versions VALUES($1,$2,$3,'ready','healthy')", [modelId, projectId, aggregate.contentFingerprint]);
    await pool.query('INSERT INTO project_model_selections VALUES($1,$2,$3)', [projectId, modelId, aggregate.selectionRevision]);
    await pool.query('INSERT INTO pf_project_preparations VALUES($1,$2,$3)', [projectId, aggregate.id, aggregate.artifactId]);
    await pool.query('INSERT INTO pf_preparation_aggregates VALUES($1,$2,$3::jsonb)', [aggregate.id, projectId, JSON.stringify(aggregate)]);
    await pool.query('INSERT INTO pf_artifacts VALUES($1,$2,$3,$4)', [aggregate.artifactId, projectId, modelId, aggregate.projection.sha256]);
    await pool.query('INSERT INTO pf_geometry_trace_sets VALUES($1,$2,$3,$4::jsonb)', [built.manifest.id, projectId, aggregate.id, JSON.stringify(built.manifest)]);
    for (let i = 0; i < built.records.length; i++) await pool.query('INSERT INTO pf_geometry_object_revisions VALUES($1,$2,$3,$4::jsonb,$5::jsonb)',
      [built.records[i].id, projectId, built.manifest.id, JSON.stringify(built.records[i]), JSON.stringify(built.summaries[i])]);
    const client = await pool.connect(); try { await client.query('BEGIN'); scope = await currentBarrierScope(client, projectId); await client.query('COMMIT'); } finally { client.release(); }
    const expires = new Date(Math.floor((Date.now() + 600000) / 1000) * 1000);
    loginExpiresAt = expires.getTime();
    await pool.query('INSERT INTO viewer_login_bindings VALUES($1,$2,$3,NULL)', [loginId, actorId, expires]);
    await pool.query('INSERT INTO viewer_resource_sessions VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,NULL)', [sessionId, projectId, modelId, actorId, loginId, loadId, scope.selectionRevision, sha(cookie), expires]);
    token = jwt.sign({ sub: actorId, jti: loginId, exp: Math.floor(expires.getTime() / 1000) }, process.env.JWT_SECRET!);
    const app = express(); app.use('/api/projects/:projectId/pathfinder', createBarrierRouter(pool));
    app.use('/api/projects/:projectId/model-versions/:modelVersionId/viewer-sessions/:sessionId/barriers', createBarrierRouter(pool, 'viewer'));
    server = createServer(app); await new Promise<void>((resolve, reject) => { server!.once('error', reject); server!.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => { server!.off('error', reject); resolve(); }); });
    const address = server.address(); if (!address || typeof address === 'string' || address.address !== '127.0.0.1') throw Error('B21_LOOPBACK_LISTENER');
    origin = 'http://127.0.0.1:' + address.port; process.env.WFC_VIEWER_ALLOWED_ORIGINS = origin; process.env.WFC_VIEWER_ALLOW_HTTP_LOOPBACK = 'true';
  }, 30000);
  afterAll(async () => {
    if (server) await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => { server!.closeAllConnections(); reject(Error('B21_HTTP_JOIN_UNCONFIRMED')); }, 5000);
      server!.close(error => { clearTimeout(timer); if (error) reject(error); else resolve(); }); server!.closeIdleConnections(); });
    await pool?.end();
    if (priorRoot === undefined) delete process.env.PF_ROOT; else process.env.PF_ROOT = priorRoot;
  });
  it('refuses one synthetic open floor and reconciles its exact durable outcome without a published head/snapshot', async () => {
    const input = await observation('floor', true), before = await counts();
    const uploaded = await http('/captures/' + input.intent.id, { method: 'PUT', body: input.body, viewer: true }); expectStatus(uploaded, 200);
    const refusal = barrierPublicationRefusalReceiptSchema.parse(uploaded.body); expect(refusal).toMatchObject({ outcome: 'not-published', ...input.query });
    const after = await counts(); expect(after.heads).toBe(before.heads); expect(after.snapshots).toBe(before.snapshots); expect(after.receipts).toBe(before.receipts + 1);
    const read = await http('/intents/' + input.intent.id + '/outcome', { query: input.query, cookie: null }); expectStatus(read, 200);
    expect(barrierCaptureOutcomeSchema.parse(read.body)).toEqual({ ...refusal, duplicate: true });
    for (const field of ['commandSha256', 'captureSha256', 'frameSha256'] as const) {
      const foreign = await http('/intents/' + input.intent.id + '/outcome', { query: { ...input.query, [field]: '8'.repeat(64) } });
      expectStatus(foreign, 409); expect(foreign.body).not.toHaveProperty('outcome');
    }
    const replay = await http('/captures/' + input.intent.id, { method: 'PUT', body: input.body, viewer: true }); expectStatus(replay, 200);
    expect(replay.body).toEqual({ ...refusal, duplicate: true }); expect(await counts()).toEqual(after);
    await pool.query('UPDATE viewer_resource_sessions SET revoked_at=now() WHERE id=$1', [sessionId]);
    try { expect((await http('/intents/' + input.intent.id + '/outcome', { query: input.query })).body).toEqual({ ...refusal, duplicate: true }); }
    finally { await pool.query('UPDATE viewer_resource_sessions SET revoked_at=NULL WHERE id=$1', [sessionId]); }
    const otherLogin = randomUUID(), expires = new Date(Math.floor((Date.now() + 600000) / 1000) * 1000);
    await pool.query('INSERT INTO viewer_login_bindings VALUES($1,$2,$3,NULL)', [otherLogin, actorId, expires]);
    const otherToken = jwt.sign({ sub: actorId, jti: otherLogin, exp: Math.floor(expires.getTime() / 1000) }, process.env.JWT_SECRET!);
    expectStatus(await http('/intents/' + input.intent.id + '/outcome', { query: input.query, bearer: otherToken }), 403);
  }, 30000);
  it('publishes a synthetic closed obstacle once and reads exact historical success without inventing full-frame evidence', async () => {
    const input = await observation('wall', false), uploaded = await http('/captures/' + input.intent.id, { method: 'PUT', body: input.body, viewer: true });
    expectStatus(uploaded, 200); const publication = barrierPublicationReceiptSchema.parse(uploaded.body);
    const read = await http('/intents/' + input.intent.id + '/outcome', { query: input.query }); expectStatus(read, 200);
    expect(barrierCaptureOutcomeSchema.parse(read.body)).toEqual({ schemaVersion: 'wfc.pf.barrier-capture-outcome.v1', outcome: 'published',
      intentId: input.intent.id, commandSha256: input.query.commandSha256, captureSha256: input.query.captureSha256,
      frameBinding: 'not-recorded', frameSha256: null, publication: { ...publication, duplicate: true } });
  }, 30000);
  it('publishes a synthetic original open floor only through explicit mixed-v2, retains all original geometry and settles exact historical success', async () => {
    const input = await observation('floor', true, 'v2'), before = await counts();
    const uploaded = await http('/captures/' + input.intent.id, { method: 'PUT', body: input.body, viewer: true }); expectStatus(uploaded, 200);
    const publication = supportedBarrierPublicationReceiptSchema.parse(uploaded.body); expect(publication).toMatchObject({ schemaVersion: 'wfc.pf.barrier-publication-receipt.v2', snapshot: { mode: 'mixed-mesh-set', geometryPolicy: MIXED_BARRIER_POLICY } });
    const snapshotResponse = await http('/snapshots/' + publication.snapshot.snapshotId); expectStatus(snapshotResponse, 200);
    const snapshot = supportedBarrierSnapshotSchema.parse(snapshotResponse.body); if (snapshot.geometry.mode !== 'mixed-mesh-set') throw Error('B20_MIXED_SNAPSHOT_REQUIRED');
    expect(snapshot.geometry.verification.componentMemberships).toEqual([expect.objectContaining({ kind: 'original-surface', fragmentIds: [7], parentSelectionIds: [input.command.selectedParents[0].selectionId], triangleCount: 2 })]);
    const mesh = await readBarrierBytes(projectId, input.intent.id, snapshot.geometry.fragments[0].mesh);
    expect(JSON.parse(mesh.toString())).toEqual({ verticesMetres: input.body.capture.fragments[0].verticesMetres, triangleIndices: input.body.capture.fragments[0].triangleIndices });
    const after = await counts(); expect(after.snapshots).toBe(before.snapshots + 1); expect(after.receipts).toBe(before.receipts + 1);
    const replay = await http('/captures/' + input.intent.id, { method: 'PUT', body: input.body, viewer: true }); expectStatus(replay, 200); expect(replay.body).toEqual({ ...publication, duplicate: true }); expect(await counts()).toEqual(after);
    await pool.query('UPDATE viewer_resource_sessions SET revoked_at=now() WHERE id=$1', [sessionId]);
    try {
      const read = await http('/intents/' + input.intent.id + '/outcome', { query: input.query }); expectStatus(read, 200);
      expect(supportedBarrierCaptureOutcomeSchema.parse(read.body)).toEqual({ schemaVersion: 'wfc.pf.barrier-capture-outcome.v2', outcome: 'published', intentId: input.intent.id,
        commandSha256: input.query.commandSha256, captureSha256: input.query.captureSha256, frameBinding: 'not-recorded', frameSha256: null, publication: { ...publication, duplicate: true } });
    } finally { await pool.query('UPDATE viewer_resource_sessions SET revoked_at=NULL WHERE id=$1', [sessionId]); }
  }, 30000);
  it('qualifies a synthetic closed obstacle independently inside the new mixed lane', async () => {
    const input = await observation('wall', false, 'v2'), uploaded = await http('/captures/' + input.intent.id, { method: 'PUT', body: input.body, viewer: true }); expectStatus(uploaded, 200);
    const receipt = supportedBarrierPublicationReceiptSchema.parse(uploaded.body); expect(receipt.schemaVersion).toBe('wfc.pf.barrier-publication-receipt.v2');
    const read = await http('/snapshots/' + receipt.snapshot.snapshotId); expectStatus(read, 200); const snapshot = supportedBarrierSnapshotSchema.parse(read.body);
    if (snapshot.geometry.mode !== 'mixed-mesh-set') throw Error('B20_MIXED_SNAPSHOT_REQUIRED');
    expect(snapshot.geometry.verification.componentMemberships).toEqual([expect.objectContaining({ kind: 'qualified-closed-solid', fragmentIds: [7], triangleCount: 12 })]);
    expect(snapshot).toMatchObject({ engineeringAccepted: false, ownTerminalExemptionsSupported: false, authority: 'none' });
  }, 30000);
  it('refuses missing/wrong cookie, invalid bearer and foreign origin without publishing', async () => {
    const input = await observation('floor', true), before = await counts();
    for (const options of [{ cookie: null, status: 401 }, { cookie: 'q'.repeat(43), status: 409 }, { bearer: 'invalid', status: 401 }, { origin: 'http://foreign.test', status: 403 }]) {
      const response = await http('/captures/' + input.intent.id, { method: 'PUT', body: input.body, viewer: true, ...options }); expectStatus(response, options.status);
    }
    expect(await counts()).toEqual(before);
  });

  // Recovery races below use synthetic trusted qualification only where an
  // explicit deferred adapter is needed. The five baseline HTTP cases above
  // still execute the real portable verifier and real protected cookie path.
  const who = (): JobPrincipal => ({ userId: actorId, loginId, loginExpiresAt });
  const registryHistory = async () => ({
    heads: (await pool.query('SELECT to_jsonb(t)::text AS record FROM pf_barrier_heads t ORDER BY project_id')).rows,
    snapshots: (await pool.query('SELECT to_jsonb(t)::text AS record FROM pf_barrier_snapshots t ORDER BY id')).rows,
    receipts: (await pool.query('SELECT to_jsonb(t)::text AS record FROM pf_barrier_receipts t ORDER BY project_id,actor_id,idempotency_key')).rows,
  });
  const closures = async () => (await pool.query('SELECT to_jsonb(t)::text AS record FROM pf_barrier_command_closures t ORDER BY project_id,command_sha256')).rows;
  const repository = (qualifyCapture: BarrierRegistryAdapters['qualifyCapture'] = async () => ({ producerVersion: 'wfc.pf.barrier-verifier.v1', computationalMeshes: 1, verificationSha256: 'c'.repeat(64) }), source: Pool = pool) =>
    createBarrierRegistryRepository(source, { currentScope: currentBarrierScope, publicationFrameSha256: () => {
      const frame = { schemaVersion: 'wfc.pf.barrier-frame-observation.v1', projectId, modelVersionId: modelId,
        contentFingerprint: scope.contentFingerprint, loadId, sdkVersion: '7.130.0', matrixPrecision: 'binary64', coordinateFrame: 'canonical-world-metres',
        sourceUnits: 'm', metresPerDisplayUnit: 1, upVector: [0, 0, 1], globalOffsetDisplayUnits: [0, 0, 0], globalOffsetMetres: [0, 0, 0], displayToWorldMetres: matrix, modelTransform: null, placementTransform: null };
      return hash(frame);
    }, qualifyCapture });
  function target(command: { schemaVersion: string; scope: BarrierModelScope }, known?: { id: string; snapshotId: string; createdBy: string; loginId: string }, publication?: { captureSha256: string; frameSha256: string }): BarrierCommandRecoveryTarget {
    const mixed = command.schemaVersion.endsWith('.v2'), empty = command.schemaVersion.includes('registry-command');
    return barrierCommandRecoveryTargetSchema.parse({ schemaVersion: 'wfc.pf.barrier-command-recovery-target.v1', projectId,
      commandSha256: hash(command), scope: command.scope, pendingRecordSha256: sha('synthetic retained pending record:' + hash(command)),
      pendingRecordVersion: mixed ? 'wfc.pf.barrier-pending-command.v2' : 'wfc.pf.barrier-pending-command.v1', ...(mixed ? { geometryPolicy: MIXED_BARRIER_POLICY } : {}),
      ...(empty ? { kind: 'empty' } : { kind: publication ? 'publication' : 'capture-intent', knownIntent: known ? { actorId: known.createdBy, loginId: known.loginId, intentId: known.id, snapshotId: known.snapshotId } : null,
        ...(publication ? { ...publication, loadId } : {}) }) });
  }
  const closeBody = (value: BarrierCommandRecoveryTarget) => ({ schemaVersion: 'wfc.pf.barrier-command-close.v1', target: value });
  async function inspect(value: BarrierCommandRecoveryTarget, bearer = token) {
    const response = await http('/recovery/outcome', { query: { target: barrierCanonicalJson(value) }, bearer, cookie: null, origin: 'http://foreign.test' });
    expectStatus(response, 200); const parsed = barrierCommandRecoveryResponseSchema.parse(response.body);
    matchBarrierCommandRecovery(value, parsed, sha); return parsed;
  }
  async function newCommand(mixed = false) {
    const current = await http('/'); expectStatus(current, 200);
    return supportedBarrierCaptureCommandSchema.parse({ schemaVersion: mixed ? 'wfc.pf.barrier-capture-command.v2' : 'wfc.pf.barrier-capture-command.v1',
      ...(mixed ? { geometryPolicy: MIXED_BARRIER_POLICY } : {}), scope, expectedRegistryRevision: (current.body as { registryRevision: string }).registryRevision,
      idempotencyKey: randomUUID(), selectedParents: [{ selectionId: randomUUID(), kind: 'floor', objectId: 'dbid:9', dbId: 9, externalId: null,
        name: 'Synthetic deferred recovery scope', identityBasis: 'version-local-only', inclusion: 'own-and-all-descendant-fragments' }] });
  }
  async function anotherAdministrator() {
    const userId = randomUUID(), currentLogin = randomUUID(), expiry = new Date(Math.floor((Date.now() + 600000) / 1000) * 1000);
    await pool.query('INSERT INTO users VALUES($1,true)', [userId]); await pool.query('INSERT INTO viewer_login_bindings VALUES($1,$2,$3,NULL)', [currentLogin, userId, expiry]);
    return { principal: { userId, loginId: currentLogin, loginExpiresAt: expiry.getTime() }, token: jwt.sign({ sub: userId, jti: currentLogin, exp: Math.floor(expiry.getTime() / 1000) }, process.env.JWT_SECRET!) };
  }
  async function bounded<T>(promise: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('B21_RECOVERY_GATE_TIMEOUT')), 10000); })]); }
    finally { if (timer) clearTimeout(timer); }
  }

  it('keeps absent exact-hash inspection nonterminal without a Viewer cookie or current frame grant', async () => {
    const request = await newCommand(), value = target(request), before = { history: await registryHistory(), closed: await closures() };
    await pool.query('UPDATE viewer_resource_sessions SET revoked_at=now() WHERE id=$1', [sessionId]);
    try { expect((await inspect(value)).outcome).toBe('not-recorded'); }
    finally { await pool.query('UPDATE viewer_resource_sessions SET revoked_at=NULL WHERE id=$1', [sessionId]); }
    expect({ history: await registryHistory(), closed: await closures() }).toEqual(before);
  });
  it.each([['legacy', 'capture'], ['mixed', 'capture'], ['legacy', 'empty'], ['mixed', 'empty']] as const)('closes absent %s %s and fences delayed admission under the actual project lock', async (lane, kind) => {
    const capture = await newCommand(lane === 'mixed'), request = kind === 'capture' ? capture : { schemaVersion: lane === 'mixed' ? 'wfc.pf.barrier-registry-command.v2' : 'wfc.pf.barrier-registry-command.v1',
      ...(lane === 'mixed' ? { geometryPolicy: MIXED_BARRIER_POLICY } : {}), action: 'declare-empty', scope, expectedRegistryRevision: capture.expectedRegistryRevision, idempotencyKey: randomUUID(), reason: 'Synthetic explicitly absent empty command' };
    const value = target(request), before = await registryHistory();
    const first = await http('/recovery/close', { method: 'POST', body: closeBody(value), cookie: null }); expectStatus(first, 200);
    const response = barrierCommandRecoveryResponseSchema.parse(first.body); expect(response).toMatchObject({ outcome: 'closed', closure: { original: { state: 'not-recorded' }, grantsCalculation: false, mayPublish: false } });
    expect(await inspect(value)).toEqual(response);
    const duplicate = await http('/recovery/close', { method: 'POST', body: closeBody(value) }); expectStatus(duplicate, 200); expect(duplicate.body).toEqual(response);
    const delayed = await http(kind === 'capture' ? '/intents' : '/commands', { method: 'POST', body: request }); expectStatus(delayed, 409); expect(delayed.body).toMatchObject({ code: 'BARRIER_COMMAND_CLOSED' });
    expect(await registryHistory()).toEqual(before);
    expect((await pool.query('SELECT 1 FROM pf_barrier_capture_intents WHERE project_id=$1 AND request_sha256=$2', [projectId, value.commandSha256])).rows).toEqual([]);
  }, 30000);
  it('closes an acknowledged intent and refuses delayed actual-cookie PUT without altering published history', async () => {
    const input = await observation('wall', false), value = target(input.command, input.intent), before = await registryHistory();
    const closed = await http('/recovery/close', { method: 'POST', body: closeBody(value), cookie: null }); expectStatus(closed, 200); expect(closed.body).toMatchObject({ outcome: 'closed' });
    const delayed = await http('/captures/' + input.intent.id, { method: 'PUT', body: input.body, viewer: true }); expectStatus(delayed, 409);
    expect(delayed.body).toMatchObject({ code: 'BARRIER_COMMAND_CLOSED' }); expect(await registryHistory()).toEqual(before);
  });
  it.each(['success', 'logical-refusal'] as const)('fences a paused %s worker after HTTP Close commits and preserves original identity/allocation', async result => {
    const input = await observation('wall', false), value = target(input.command, input.intent, input.query), before = await registryHistory();
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; }), wait = new Promise<void>(resolve => { release = resolve; });
    const active = repository(async observed => { entered(); await wait;
      if (result === 'logical-refusal') throw new BarrierCaptureQualificationRefusal(observed.captureSha256, input.query.frameSha256, '9'.repeat(64));
      return { producerVersion: 'wfc.pf.barrier-verifier.v1', computationalMeshes: 1, verificationSha256: 'c'.repeat(64) }; });
    const controller = new AbortController();
    const worker = active.publish(projectId, who(), input.intent.id, Buffer.from(barrierCanonicalJson(input.body.capture)), controller.signal)
      .then(value => ({ ok: true, value, code: null }), error => ({ ok: false, value: null, code: typeof error?.code === 'string' ? error.code : 'UNCLASSIFIED' }));
    let retained: Record<string, unknown> | undefined;
    let failed = false, primaryFailure: unknown, joinFailed = false, joinFailure: unknown, workerResult: Awaited<typeof worker> | undefined;
    try {
      await bounded(started); retained = (await pool.query('SELECT frozen,capture_sha256,allocation FROM pf_barrier_capture_intents WHERE id=$1', [input.intent.id])).rows[0];
      const response = await http('/recovery/close', { method: 'POST', body: closeBody(value) }); expectStatus(response, 200); expect(response.body).toMatchObject({ outcome: 'closed' });
    } catch (error) { failed = true; primaryFailure = error; }
    finally {
      if (failed) controller.abort(); release();
      try { workerResult = await bounded(worker); }
      catch (error) { joinFailed = true; joinFailure = error; }
    }
    if (joinFailed) throw new AggregateError(failed ? [primaryFailure, joinFailure] : [joinFailure], 'B21_RECOVERY_WORKER_JOIN_UNCONFIRMED');
    if (failed) throw primaryFailure;
    expect(workerResult).toMatchObject({ ok: false, code: 'BARRIER_COMMAND_CLOSED' });
    expect((await pool.query('SELECT frozen,capture_sha256,allocation FROM pf_barrier_capture_intents WHERE id=$1', [input.intent.id])).rows).toEqual([retained]);
    expect((await pool.query('SELECT state,lease_token,lease_expires_at FROM pf_barrier_capture_intents WHERE id=$1', [input.intent.id])).rows).toEqual([{ state: 'pending', lease_token: null, lease_expires_at: null }]);
    expect(await registryHistory()).toEqual(before);
  }, 30000);
  it('returns committed mixed publication before Close without writing a contradictory fence', async () => {
    const input = await observation('floor', true, 'v2'), value = target(input.command, input.intent, input.query);
    const uploaded = await http('/captures/' + input.intent.id, { method: 'PUT', body: input.body, viewer: true }); expectStatus(uploaded, 200);
    const before = { history: await registryHistory(), closed: await closures() };
    const response = await http('/recovery/close', { method: 'POST', body: closeBody(value) }); expectStatus(response, 200);
    expect(response.body).toMatchObject({ outcome: 'published', frameBinding: 'not-recorded', frameSha256: null }); expect(await inspect(value)).toEqual(response.body);
    expect({ history: await registryHistory(), closed: await closures() }).toEqual(before);
  }, 30000);
  it('returns committed geometry refusal before Close and preserves exact stored full-frame hash', async () => {
    const input = await observation('floor', true), value = target(input.command, input.intent, input.query);
    const uploaded = await http('/captures/' + input.intent.id, { method: 'PUT', body: input.body, viewer: true }); expectStatus(uploaded, 200);
    const before = { history: await registryHistory(), closed: await closures() };
    const response = await http('/recovery/close', { method: 'POST', body: closeBody(value) }); expectStatus(response, 200);
    expect(response.body).toMatchObject({ outcome: 'geometry-refused', refusal: { frameSha256: input.query.frameSha256 } });
    expect({ history: await registryHistory(), closed: await closures() }).toEqual(before);
  }, 30000);
  it('recovers an empty publication across a new administrator login using its persisted original owner', async () => {
    const current = await newCommand(true), request = { schemaVersion: 'wfc.pf.barrier-registry-command.v2', geometryPolicy: MIXED_BARRIER_POLICY,
      action: 'declare-empty', scope, expectedRegistryRevision: current.expectedRegistryRevision, idempotencyKey: randomUUID(), reason: 'Explicit synthetic recovery declaration' };
    const stored = await http('/commands', { method: 'POST', body: request }); expectStatus(stored, 200);
    const other = await anotherAdministrator(), before = { history: await registryHistory(), closed: await closures() }, value = target(request);
    const response = await http('/recovery/close', { method: 'POST', body: closeBody(value), bearer: other.token }); expectStatus(response, 200);
    expect(response.body).toMatchObject({ outcome: 'published', original: { kind: 'declare-empty', actorId, loginId } });
    expect({ history: await registryHistory(), closed: await closures() }).toEqual(before);
  });
  it('reconciles a real persisted Close after a synthetic lost COMMIT acknowledgement', async () => {
    const command = await newCommand(), value = target(command); let lose = true;
    const wrapped = { connect: async () => { const client = await pool.connect(); return { query: async (sql: string, values?: unknown[]) => {
      const result = await client.query(sql, values); if (sql === 'COMMIT' && lose) { lose = false; throw Error('Synthetic lost commit acknowledgement'); } return result;
    }, release: (error?: boolean) => client.release(error) }; } } as unknown as Pool;
    await expect(repository(undefined, wrapped).closeCommand(projectId, who(), closeBody(value))).rejects.toMatchObject({ code: 'BARRIER_COMMIT_OUTCOME_UNKNOWN' });
    const outcome = await inspect(value); expect(outcome).toMatchObject({ outcome: 'closed' });
    const again = await http('/recovery/close', { method: 'POST', body: closeBody(value) }); expectStatus(again, 200); expect(again.body).toEqual(outcome);
  });
  it('preserves an immutable exact closure and all original history across idempotent initialization', async () => {
    const request = await newCommand(), value = target(request), before = await registryHistory();
    const response = await http('/recovery/close', { method: 'POST', body: closeBody(value) }); expectStatus(response, 200);
    const original = await closures(); await initializeBarrierRegistrySchema(pool); expect(await closures()).toEqual(original);
    await expect(pool.query('UPDATE pf_barrier_command_closures SET closed_at=now() WHERE project_id=$1 AND command_sha256=$2', [projectId, value.commandSha256])).rejects.toMatchObject({ code: 'P0001' });
    await expect(pool.query('DELETE FROM pf_barrier_command_closures WHERE project_id=$1 AND command_sha256=$2', [projectId, value.commandSha256])).rejects.toMatchObject({ code: 'P0001' });
    expect(await closures()).toEqual(original); expect(await registryHistory()).toEqual(before);
  });
  it('refuses two real original owners for one indexed command hash instead of choosing or closing one', async () => {
    const request = await newCommand(), other = await anotherAdministrator(), active = repository();
    await active.begin(projectId, who(), request); await active.begin(projectId, other.principal, request);
    const before = { history: await registryHistory(), closed: await closures() }, value = target(request);
    const response = await http('/recovery/outcome', { query: { target: barrierCanonicalJson(value) } }); expectStatus(response, 409); expect(response.body).toMatchObject({ code: 'BARRIER_RECOVERY_AMBIGUOUS' });
    const close = await http('/recovery/close', { method: 'POST', body: closeBody(value) }); expectStatus(close, 409);
    expect({ history: await registryHistory(), closed: await closures() }).toEqual(before);
  });
  it.each(['lane', 'frame', 'known-owner'] as const)('refuses exchanged %s target metadata with actual auth and SQL', async field => {
    const input = await observation('wall', false); let value = target(input.command, input.intent);
    if (field === 'lane') value = barrierCommandRecoveryTargetSchema.parse({ ...value, pendingRecordVersion: 'wfc.pf.barrier-pending-command.v2', geometryPolicy: MIXED_BARRIER_POLICY });
    if (field === 'frame') value.scope.captureFrameSha256 = '9'.repeat(64);
    if (field === 'known-owner' && value.kind !== 'empty') value.knownIntent!.actorId = randomUUID();
    const before = { history: await registryHistory(), closed: await closures() };
    const response = await http('/recovery/close', { method: 'POST', body: closeBody(value) }); expectStatus(response, 409); expect(response.body).toMatchObject({ code: 'BARRIER_RECOVERY_TARGET_CHANGED' });
    expect({ history: await registryHistory(), closed: await closures() }).toEqual(before);
  });
  it('uses only current close authority while preserving expired original owner identities', async () => {
    const input = await observation('wall', false), value = target(input.command, input.intent), other = await anotherAdministrator(), before = await registryHistory();
    await pool.query('UPDATE viewer_login_bindings SET expires_at=now()-interval \'1 second\' WHERE login_id=$1', [loginId]);
    try {
      const response = await http('/recovery/close', { method: 'POST', body: closeBody(value), bearer: other.token, cookie: null }); expectStatus(response, 200);
      expect(response.body).toMatchObject({ outcome: 'closed', closure: { original: { state: 'recorded', command: { actorId, loginId } }, closedBy: { actorId: other.principal.userId, loginId: other.principal.loginId } } });
      expect((await inspect(value, other.token)).outcome).toBe('closed');
    } finally { await pool.query('UPDATE viewer_login_bindings SET expires_at=$2 WHERE login_id=$1', [loginId, new Date(loginExpiresAt)]); }
    expect(await registryHistory()).toEqual(before);
  });
  it('keeps a valid pending command unresolved when the current administrator role is revoked', async () => {
    const command = await newCommand(), value = target(command), before = { history: await registryHistory(), closed: await closures() };
    await pool.query('UPDATE users SET is_admin=false WHERE id=$1', [actorId]);
    try { const response = await http('/recovery/close', { method: 'POST', body: closeBody(value) }); expectStatus(response, 403); expect(response.body).toMatchObject({ code: 'ADMIN_REQUIRED' }); }
    finally { await pool.query('UPDATE users SET is_admin=true WHERE id=$1', [actorId]); }
    expect({ history: await registryHistory(), closed: await closures() }).toEqual(before);
  });
});
