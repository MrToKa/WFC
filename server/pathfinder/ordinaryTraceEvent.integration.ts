/** Root-invokable, one case per fresh owned database. Importing opens no connection.
 * The model metadata is a deliberately seeded synthetic SQL state, never a claim
 * that a converted package or a human engineering review has been verified.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { canonicalPurposeJson } from '../../shared/pathfinderPurposePolicy.js';
import { preparationAggregateSchema, preparationPartV1Schema, type PreparationContext } from '../../shared/pathfinderPreparation.js';
import { GEOMETRY_TRACE_DERIVATION, type GeometryTraceReceipt } from '../../shared/pathfinderGeometryTrace.js';
import { geometryTraceFixture } from './geometryTraceFixtures.js';
import { buildPreparationPlan } from './preparationPlans.js';
import { encodePreparationPayload, storePreparationBytes } from './preparationStorage.js';
import { storeSnapshotBytes } from './storage.js';
import { createConfiguredEngineExecutor, type EngineExecutor } from './engineSession.js';
import { createGeometryTraceEngine } from './geometryTraceEngine.js';
import { createGeometryTraceRepository, type GeometryTraceAdapters } from './geometryTraceRepository.js';

const optionsSchema = z.object({
  scenario: z.enum(['commit', 'rollback', 'lost-ack']),
  policy: z.enum(['disabled', 'paused', 'expired']),
  expectedDatabase: z.string().regex(/^wfc_pf_trace_evt_[a-f0-9]{12}$/),
  ownerId: z.string().uuid(),
}).strict();
export type OrdinaryTraceEventControlOptions = z.infer<typeof optionsSchema>;
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

/** Rebuild the pure corpus with recognised straight shapes. Its fabricated fitted
 * export and executable fingerprint are deliberately never used by this control.
 */
function smallSyntheticFixture() {
  const source = geometryTraceFixture();
  const scope = Object.fromEntries(['modelVersionId', 'contentFingerprint', 'selectionRevision', 'catalogRevision', 'routingContentSha256', 'routingPolicyRevision', 'routingPolicySha256', 'locationRegistryRevision', 'resolutionRevision'].map(key => [key, source.plan[key as keyof typeof source.plan]])) as PreparationContext['scope'];
  const context: PreparationContext = {
    schemaVersion: 'wfc.pf.preparation-context.v1', projectId: source.plan.projectId, scope,
    trays: source.plan.requestedScope.trays.map(tray => ({ projectTrayId: tray.projectTrayId, rawName: tray.rawName, routeName: tray.routeName, purposeKey: tray.purposeKey, policyState: 'configured', allowedCategories: tray.allowedCategories, diagnosticCodes: [] })),
    endpointNames: source.plan.requestedScope.endpointNames, resolutions: [], diagnostics: [], currentAggregate: null,
  };
  // Keep exact tray names on hierarchy roots; their physical children carry the
  // recognised shape. Renaming the roots would violate exact-candidate admission.
  const objects = [
    { objectId: 'dbid:9', parentId: null, name: 'B001', hasGeometry: false, isPhysicalLeaf: false, orderIndex: 0 },
    { objectId: 'dbid:19', parentId: 'dbid:9', name: 'STRAIGHT', hasGeometry: true, isPhysicalLeaf: true, orderIndex: 1 },
    { objectId: 'dbid:2', parentId: null, name: 'B002', hasGeometry: false, isPhysicalLeaf: false, orderIndex: 2 },
    { objectId: 'dbid:12', parentId: 'dbid:2', name: 'STRAIGHT', hasGeometry: true, isPhysicalLeaf: true, orderIndex: 3 },
    { objectId: 'dbid:5', parentId: null, name: 'EQ01', hasGeometry: true, isPhysicalLeaf: true, orderIndex: 4 },
  ];
  const plan = buildPreparationPlan(context, {
    schemaVersion: 'wfc.pf.preparation-create.v1', expected: scope, idempotencyKey: randomUUID(),
    discovery: {
      schemaVersion: 'wfc.pf.discovery-report.v1', modelVersionId: scope.modelVersionId, contentFingerprint: scope.contentFingerprint, selectionRevision: scope.selectionRevision,
      matchingPolicyVersion: 'wfc.pf.project-exact-candidates.v1', complete: true,
      propertyScan: { indexedObjectCount: objects.length, attemptedObjectCount: objects.length, returnedObjectCount: objects.length, omittedObjectCount: 0, complete: true },
      objects, trays: source.plan.requestedScope.trays.map(tray => ({ projectTrayId: tray.projectTrayId, candidateRootObjectIds: tray.orderedRootObjectIds })),
      endpointCandidates: source.plan.requestedScope.endpointEvidence.map(endpoint => ({ name: endpoint.name, objectIds: endpoint.candidateObjectIds })),
    },
  }, source.plan.id);
  assert.deepEqual(plan.diagnostics, []); assert.equal(plan.partPlan.length, 1);
  const snapshot = structuredClone(source.snapshot);
  snapshot.capture.adapterVersion = 'ordinary-trace-event-synthetic-sql-control-v1';
  snapshot.objects = [];
  for (const [index, rootId, leafId] of [[0, 9, 19], [1, 2, 12]] as const) {
    const original = source.snapshot.objects[index], root = structuredClone(original), leaf = structuredClone(original);
    root.id = 'dbid:' + rootId; root.dbId = rootId; root.geometryRole = 'hierarchy'; root.fragments = [];
    root.categoryAssignmentSource = 'unassigned'; root.allowedCategories = []; delete root.routeName; delete root.shapeName;
    leaf.id = 'dbid:' + leafId; leaf.dbId = leafId; leaf.parentId = root.id; leaf.name = 'STRAIGHT'; leaf.shapeName = 'STRAIGHT'; leaf.leafToRootNames = ['STRAIGHT', root.name];
    leaf.fragments = leaf.fragments.map(fragment => ({ ...fragment, id: 'fragment:' + leafId }));
    snapshot.objects.push(root, leaf);
  }
  snapshot.objects.push(structuredClone(source.snapshot.objects[2]));
  const leaves = new Map(plan.partPlan.flatMap(part => part.objects.map(object => ['dbid:' + object.objectId, object] as const)));
  const traceIndex = {
    schemaVersion: 'wfc.pf.preparation-trace-index.v1' as const, sessionId: plan.id, coordinateFrameId: plan.coordinateFrameId,
    objects: snapshot.objects.map(object => {
      const leaf = leaves.get(object.id);
      return { objectId: object.id, geometryRole: object.geometryRole, projectTrayId: leaf?.projectTrayId ?? null, rootObjectId: leaf ? 'dbid:' + leaf.rootObjectId : null,
        partIds: plan.partPlan.filter(part => [...part.physicalLeafIds, ...part.equipmentObjectIds, ...part.ancestorObjectIds].includes(object.id)).map(part => part.partId) };
    }),
  };
  return { source, plan, snapshot, traceIndex };
}

async function guardFreshDatabase(pool: Pool, input: OrdinaryTraceEventControlOptions): Promise<string> {
  const target = (await pool.query<{ database: string; username: string; owner: string; port: number }>(`SELECT current_database() AS database,current_user AS username,
    pg_get_userbyid(datdba) AS owner,inet_server_port() AS port FROM pg_database WHERE datname=current_database()`)).rows;
  assert.equal(target.length, 1); assert.equal(target[0].database, input.expectedDatabase); assert.equal(target[0].username, 'pf_local'); assert.equal(target[0].owner, 'pf_local'); assert.equal(target[0].port, 5432);
  const marker = (await pool.query<{ owner_id: string; kind: string }>('SELECT owner_id::text,kind FROM pf_fixture_ownership ORDER BY owner_id LIMIT 2')).rows;
  assert.deepEqual(marker, [{ owner_id: input.ownerId, kind: 'ordinary-trace-event' }]);
  assert.equal((await pool.query<{ relation: string | null }>("SELECT to_regclass('public.projects')::text AS relation")).rows[0].relation, null, 'Only a new database without application schema is allowed.');
  assert.equal(process.platform, 'linux'); assert.equal(process.env.PF_LOCAL_DEMO, 'true'); assert.equal(process.env.PF_ENGINE_MODE ?? 'oneshot', 'oneshot');
  assert.equal(process.env.PF_ENGINE_DLL, '/opt/pathfinder/PathFinder.ModelRunner.dll');
  const configured = new URL(process.env.DATABASE_URL!); assert.equal(decodeURIComponent(configured.pathname.slice(1)), input.expectedDatabase);
  const root = process.env.PF_ROOT;
  assert.ok(root && path.isAbsolute(root) && root !== '/' && !root.startsWith('/var/lib/wfc/') && !root.startsWith('/app/') && !root.startsWith('/opt/'), 'Use a fresh separately mounted fixture PF_ROOT.');
  const stat = await fs.lstat(root); assert.ok(stat.isDirectory() && !stat.isSymbolicLink()); assert.equal(await fs.realpath(root), path.resolve(root));
  assert.deepEqual(await fs.readdir(root), [], 'The fixture storage must be new and empty.');
  const markerFile = path.join(root, 'ordinary-trace-event-owner.json');
  const bytes = Buffer.from(JSON.stringify({ ownerId: input.ownerId, database: input.expectedDatabase, kind: 'ordinary-trace-event' }));
  const handle = await fs.open(markerFile, 'wx', 0o600); try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  assert.equal(hash(await fs.readFile(markerFile)), hash(bytes));
  return root;
}

async function seed(pool: Pool, input: OrdinaryTraceEventControlOptions) {
  const { source, plan, snapshot, traceIndex } = smallSyntheticFixture();
  const projectId = plan.projectId, actorId = source.createdBy, loginId = randomUUID(), loginExpiresAt = Date.now() + 15 * 60_000;
  const projectionBytes = encodePreparationPayload(snapshot), projectionId = randomUUID();
  const projection = await storePreparationBytes(projectId, plan.id, projectionId, projectionBytes);
  assert.deepEqual(await storeSnapshotBytes(projectionId, projectionBytes), { sha256: projection.sha256, bytes: projection.bytes });
  const index = await storePreparationBytes(projectId, plan.id, randomUUID(), encodePreparationPayload(traceIndex));
  const aggregate = preparationAggregateSchema.parse({ ...source.aggregate, artifactId: projectionId, coordinateFrameId: plan.coordinateFrameId,
    orderedPlanSha256: plan.orderedPlanSha256, orderedScopeSha256: plan.requestedScope.scopeSha256, counts: { ...source.aggregate.counts, objects: snapshot.objects.length },
    partReferences: plan.partPlan.map(part => ({ partId: part.partId, partIndex: part.partIndex, payloadSha256: projection.sha256 })),
    projection: { schemaVersion: snapshot.schemaVersion, ...projection }, traceIndex: { schemaVersion: traceIndex.schemaVersion, ...index }, publishedAt: new Date().toISOString() });
  const part = preparationPartV1Schema.parse({ schemaVersion: 'wfc.pf.preparation-part.v1', sessionId: plan.id, partId: plan.partPlan[0].partId, partIndex: 0,
    sessionPlanSha256: plan.orderedPlanSha256, modelVersionId: plan.modelVersionId, contentFingerprint: plan.contentFingerprint, coordinateFrameId: plan.coordinateFrameId,
    scopeSha256: plan.partPlan[0].scopeSha256, payloadEncoding: 'pathfinder.model.snapshot.v1-json-utf8', payloadSha256: projection.sha256, payloadBytes: projection.bytes, payloadRef: projectionId,
    counts: aggregate.counts, coverage: { partScopeComplete: true, missingObjectIds: [], ambiguousObjectIds: [] },
    producer: { level: 'A', adapterVersion: snapshot.capture.adapterVersion, sourceKind: 'synthetic' }, completedAt: new Date().toISOString() });
  const packageId = randomUUID(), importId = randomUUID(), reportId = randomUUID(), now = new Date().toISOString();
  // Constrained metadata is intentionally simulated only inside this fresh SQL
  // fixture. No model storage verifier, import, or conversion is claimed here.
  const synthetic = { syntheticFixtureOnly: true, scope: 'seeded SQL health state; no SVF package or storage verification performed' };
  // The real ready-model guard compares these identities and the entire JSON
  // manifest. Reuse one explicitly synthetic value; do not bypass that guard.
  const label = 'Synthetic SQL trace transaction fixture', supportProfile = 'svf-local-7.130.0-v1';
  const modelManifest = { ...synthetic, source: synthetic, label, packageId, contentFingerprint: plan.contentFingerprint, supportProfile };
  const verification = { reportSchemaVersion: 1, status: 'PASS', operation: 'verify', checks: Object.fromEntries(['portableManifest', 'safeArchive', 'rawInventory', 'fingerprint', 'supportedProfile', 'nestedReferences'].map(name => [name, 'PASS'])),
    package: { packageId, ...synthetic }, contentFingerprint: plan.contentFingerprint, manifest: modelManifest, resourceCount: 1, totalRawBytes: 0, ...synthetic };
  const readback = { status: 'PASS', algorithm: 'SHA-256', resourceCount: 1, totalBytes: 0, verifiedAt: now, ...synthetic };
  const c = await pool.connect(); let commitStarted = false;
  try {
    await c.query('BEGIN'); await c.query("SET LOCAL lock_timeout='3000ms';SET LOCAL statement_timeout='15000ms';SET LOCAL idle_in_transaction_session_timeout='30000ms'"); await c.query('SET CONSTRAINTS ALL DEFERRED');
    await c.query("INSERT INTO users(id,email,password_hash,is_admin,role) VALUES($1,$2,'No login password; owned direct-service fixture',true,'admin')", [actorId, actorId + '@ordinary-trace-event.invalid']);
    await c.query("INSERT INTO projects(id,project_number,name,customer,connection_gap,secondary_tray_length,end_connection_length,additional_bending_percent) VALUES($1,$2,$2,'Synthetic trace transaction control',1,7,5,10)", [projectId, 'PF-ORDINARY-TRACE-' + input.ownerId]);
    await c.query('INSERT INTO viewer_login_bindings(login_id,user_id,expires_at) VALUES($1,$2,$3)', [loginId, actorId, new Date(loginExpiresAt)]);
    await c.query("INSERT INTO model_package_identities(package_id,content_fingerprint,support_profile,source_sha256,source_bytes,source_identity_basis) VALUES($1,$2,'svf-local-7.130.0-v1',$3,$4,'observed-local-file')", [packageId, plan.contentFingerprint, projection.sha256, projection.bytes]);
    await c.query('INSERT INTO model_validation_reports(id,report,storage_readback) VALUES($1,$2,$3)', [reportId, verification, readback]);
    await c.query("INSERT INTO model_import_jobs(id,project_id,requested_by,idempotency_key,archive_sha256,expected_bytes,owner_token,state,model_version_id) VALUES($1,$2,$3,$4,$5,0,$6,'complete',$7)", [importId, projectId, actorId, randomUUID(), projection.sha256, randomUUID(), plan.modelVersionId]);
    await c.query(`INSERT INTO model_versions(id,project_id,package_id,content_fingerprint,label,source,schema_version,support_profile,format,sdk_version,entrypoint,prepared_at,imported_at,imported_by,state,health,resource_count,total_bytes,validation_report_id,manifest,storage_prefix,owner_import_id)
      VALUES($1,$2,$3,$4,$5,$6,1,'svf-local-7.130.0-v1','svf','7.130.0','resources/output/0/0.svf',$7,$7,$8,'ready','healthy',1,0,$9,$10,$11,$12)`,
    [plan.modelVersionId, projectId, packageId, plan.contentFingerprint, label, synthetic, now, actorId, reportId, modelManifest, `projects/${projectId}/versions/${plan.modelVersionId}/`, importId]);
    await c.query('UPDATE project_model_selections SET active_model_version_id=$2,selection_revision=$3 WHERE project_id=$1', [projectId, plan.modelVersionId, plan.selectionRevision]);
    for (const tray of plan.requestedScope.trays) await c.query("INSERT INTO trays(id,project_id,name,purpose,width_mm,height_mm,length_mm) VALUES($1,$2,$3,'Control',1000,100,10000)", [tray.projectTrayId, projectId, tray.rawName]);
    await c.query('UPDATE pf_project_state SET registry_revision=$2 WHERE project_id=$1', [projectId, plan.locationRegistryRevision]);
    await c.query('INSERT INTO pf_artifacts(id,project_id,model_version_id,content_fingerprint,snapshot_sha256,snapshot_bytes,capture,coordinates,object_count,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [aggregate.artifactId, projectId, plan.modelVersionId, plan.contentFingerprint, projection.sha256, projection.bytes, snapshot.capture, snapshot.coordinates, snapshot.objects.length, actorId]);
    await c.query("INSERT INTO pf_preparation_sessions(id,project_id,plan,state,actor_id,login_id,published_aggregate_id) VALUES($1,$2,$3,'published',$4,$5,$6)", [plan.id, projectId, plan, actorId, loginId, aggregate.id]);
    await c.query('INSERT INTO pf_preparation_parts(project_id,session_id,part_id,part_index,receipt) VALUES($1,$2,$3,0,$4)', [projectId, plan.id, part.partId, part]);
    await c.query('INSERT INTO pf_preparation_aggregates(id,project_id,session_id,model_version_id,geometry_revision,artifact_id,registry_revision,manifest) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [aggregate.id, projectId, plan.id, plan.modelVersionId, aggregate.geometryRevision, aggregate.artifactId, plan.locationRegistryRevision, aggregate]);
    await c.query('INSERT INTO pf_project_preparations(project_id,geometry_revision,current_aggregate_id,current_artifact_id) VALUES($1,$2,$3,$4)', [projectId, aggregate.geometryRevision, aggregate.id, aggregate.artifactId]);
    const enabled = input.policy !== 'disabled', paused = input.policy === 'paused';
    await c.query(`UPDATE pf_recalculation_state SET enabled=$2,paused=$3,control_revision=$4,authority_epoch=$4,
      actor_id=$5,login_id=$6,login_expires_at=$7,authority_expires_at=$8,preferences=$9,timeout_ms=60000,status=$10 WHERE project_id=$1`,
    [projectId, enabled, paused, enabled ? 1 : 0, enabled ? actorId : null, enabled ? loginId : null, enabled ? new Date(loginExpiresAt) : null,
      enabled ? new Date(input.policy === 'expired' ? Date.now() - 60_000 : loginExpiresAt - 60_000) : null,
      enabled ? { secondaryDistanceMeters: 2, preferVerticalApproach: true } : null, input.policy === 'disabled' ? 'disabled' : paused ? 'paused' : 'awaiting_authority']);
    commitStarted = true; await c.query('COMMIT');
  } catch (error) { try { await c.query('ROLLBACK'); } catch { c.release(true); throw error; } c.release(commitStarted ? true : undefined); throw error; }
  c.release();
  return { projectId, plan, aggregate, who: { userId: actorId, loginId, loginExpiresAt } };
}

type DurableState = { generation: string; sets: number; objects: number; diagnostics: number; receipts: number; pending: number; complete: number; events: Array<{ generation: string; domain: string; reason: string; source_revision: string | null }> };
async function durableState(queryable: Pick<Pool, 'query'> | PoolClient, projectId: string): Promise<DurableState> {
  const counts = (await queryable.query<Omit<DurableState, 'events'>>(`SELECT desired_generation::text AS generation,
    (SELECT count(*)::int FROM pf_geometry_trace_sets WHERE project_id=$1) AS sets,
    (SELECT count(*)::int FROM pf_geometry_object_revisions WHERE project_id=$1) AS objects,
    (SELECT count(*)::int FROM pf_geometry_trace_diagnostics WHERE project_id=$1) AS diagnostics,
    (SELECT count(*)::int FROM pf_geometry_trace_receipts WHERE project_id=$1) AS receipts,
    (SELECT count(*)::int FROM pf_geometry_trace_intents WHERE project_id=$1 AND state='pending') AS pending,
    (SELECT count(*)::int FROM pf_geometry_trace_intents WHERE project_id=$1 AND state='complete') AS complete
    FROM pf_recalculation_state WHERE project_id=$1`, [projectId])).rows[0];
  assert.ok(counts);
  const events = (await queryable.query<DurableState['events'][number]>("SELECT generation::text,domain,reason,source_revision FROM pf_recalculation_events WHERE project_id=$1 AND reason='GEOMETRY_TRACE_PUBLISHED' ORDER BY generation", [projectId])).rows;
  return { ...counts, events };
}

async function preservedState(pool: Pool, projectId: string, who: { userId: string; loginId: string }): Promise<string> {
  const proof = (await pool.query<{ proof: string }>(`SELECT jsonb_build_object(
    'project',(SELECT to_jsonb(r) FROM projects r WHERE id=$1),'model',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM model_versions r WHERE project_id=$1),
    'selection',(SELECT to_jsonb(r) FROM project_model_selections r WHERE project_id=$1),'preparation',(SELECT to_jsonb(r) FROM pf_project_preparations r WHERE project_id=$1),
    'sessions',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM pf_preparation_sessions r WHERE project_id=$1),'aggregates',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM pf_preparation_aggregates r WHERE project_id=$1),
    'artifacts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM pf_artifacts r WHERE project_id=$1),'trays',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM trays r WHERE project_id=$1),
    'registry',(SELECT to_jsonb(r) FROM pf_project_state r WHERE project_id=$1),'purpose',(SELECT to_jsonb(r) FROM pf_purpose_project_state r WHERE project_id=$1),
    'authority',(SELECT to_jsonb(r)-ARRAY['desired_generation','first_dirty_at','due_at','attempt_generation','attempts','reason_codes','updated_at'] FROM pf_recalculation_state r WHERE project_id=$1),
    'claims',(SELECT jsonb_agg(to_jsonb(r) ORDER BY project_id) FROM pf_recalculation_claims r WHERE project_id=$1),
    'enrollments',(SELECT jsonb_agg(to_jsonb(r) ORDER BY generation) FROM pf_recalculation_enrollments r WHERE project_id=$1),'commands',(SELECT jsonb_agg(to_jsonb(r) ORDER BY idempotency_key) FROM pf_recalculation_commands r WHERE project_id=$1),
    'grants',(SELECT jsonb_agg(to_jsonb(r) ORDER BY project_id) FROM pf_calculation_grant_heads r WHERE project_id=$1),
    'grantRevisions',(SELECT jsonb_agg(to_jsonb(r) ORDER BY grant_revision) FROM pf_calculation_grant_revisions r WHERE project_id=$1),
    'grantCommands',(SELECT jsonb_agg(to_jsonb(r) ORDER BY idempotency_key) FROM pf_calculation_grant_commands r WHERE project_id=$1),
    'grantLeases',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM pf_calculation_grant_leases r WHERE project_id=$1),
    'user',(SELECT to_jsonb(r) FROM users r WHERE id=$2),'login',(SELECT to_jsonb(r) FROM viewer_login_bindings r WHERE login_id=$3),
    'cables',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM cables r WHERE project_id=$1),'jobs',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM pf_jobs r WHERE project_id=$1),
    'applies',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM pf_apply_receipts r WHERE project_id=$1))::text AS proof`, [projectId, who.userId, who.loginId])).rows[0].proof;
  assert.ok(Buffer.byteLength(proof) <= 2 * 1024 ** 2); return hash(proof);
}

/** Actual SQL is forwarded to a real pg client. Only the retained final trace
 * transaction can receive the one-shot test transport/cancellation injection.
 */
function injectFinalBoundary(pool: Pool, scenario: OrdinaryTraceEventControlOptions['scenario'], projectId: string, controller: AbortController) {
  const observation = { dirtyCalls: 0, finalCommits: 0, abortInjected: false, lostAcknowledgementInjected: false, discardedConnections: 0, inTransaction: null as DurableState | null, stagedTrace: null as { id: string; contentSha256: string } | null };
  const wrapped = {
    async connect() {
      const real = await pool.connect(), facade = Object.create(real) as PoolClient;
      let finalPublication = false;
      facade.query = (async (...args: unknown[]) => {
        const sql = typeof args[0] === 'string' ? args[0] : (args[0] as { text?: string } | undefined)?.text;
        const parameters = Array.isArray(args[1]) ? args[1] : [];
        const result = await Reflect.apply(real.query, real, args);
        if (sql === 'BEGIN') finalPublication = false;
        if (sql?.startsWith('INSERT INTO pf_geometry_trace_sets')) finalPublication = true;
        if (sql === 'SELECT pf_recalculation_dirty($1,$2,$3,$4)' && parameters[2] === 'GEOMETRY_TRACE_PUBLISHED') {
          assert.equal(finalPublication, true); assert.equal(parameters[0], projectId); assert.equal(parameters[1], 'geometry');
          assert.equal(++observation.dirtyCalls, 1); observation.inTransaction = await durableState(real, projectId);
          const published = (await real.query<{ id: string; content_sha256: string }>("SELECT id::text,manifest->>'contentSha256' AS content_sha256 FROM pf_geometry_trace_sets WHERE project_id=$1", [projectId])).rows;
          assert.equal(published.length, 1); observation.stagedTrace = { id: published[0].id, contentSha256: published[0].content_sha256 };
          assert.deepEqual(observation.inTransaction.events, [{ generation: observation.inTransaction.generation, domain: 'geometry', reason: 'GEOMETRY_TRACE_PUBLISHED', source_revision: published[0].id + ':' + published[0].content_sha256 }]);
          if (scenario === 'rollback') { observation.abortInjected = true; controller.abort(); }
        }
        if (sql === 'COMMIT' && finalPublication) {
          observation.finalCommits++;
          if (scenario === 'lost-ack' && !observation.lostAcknowledgementInjected) {
            observation.lostAcknowledgementInjected = true;
            throw Object.assign(new Error('Owned trace final-COMMIT acknowledgement injection.'), { code: 'OWNED_TRACE_COMMIT_ACK_LOST' });
          }
        }
        return result;
      }) as PoolClient['query'];
      facade.release = (discard?: boolean | Error) => { if (discard) observation.discardedConnections++; real.release(discard); };
      return facade;
    },
  } as Pool;
  return { wrapped, observation };
}

/** Run in a dedicated helper with DATABASE_URL/config/PF_ROOT set before import.
 * Root owns the bounded helper, fresh database create/drop and storage cleanup.
 */
export async function runOrdinaryTraceEventControl(raw: OrdinaryTraceEventControlOptions) {
  const input = optionsSchema.parse(raw), started = performance.now();
  const database = await import('../db.js'), pool = database.pool;
  // No connection was opened by importing db.ts. Configure every subsequent
  // connection before the ownership probe, schema installation or fixture writes.
  pool.options.max = 4; pool.options.connectionTimeoutMillis = 5000; pool.options.idleTimeoutMillis = 5000; pool.options.query_timeout = 15000;
  let poolErrors = 0, executor: EngineExecutor | undefined, executorClosed = false, poolClosed = false;
  pool.on('error', () => { poolErrors++; });
  let result: Record<string, unknown> | undefined;
  let primaryFailed = false, primaryFailure: unknown;
  const cleanupFailures: unknown[] = [];
  try {
    await guardFreshDatabase(pool, input); await database.initializeDatabase();
    const fixture = await seed(pool, input), before = await durableState(pool, fixture.projectId), preservedBefore = await preservedState(pool, fixture.projectId, fixture.who);
    assert.deepEqual({ sets: before.sets, objects: before.objects, diagnostics: before.diagnostics, receipts: before.receipts, pending: before.pending, complete: before.complete, events: before.events }, { sets: 0, objects: 0, diagnostics: 0, receipts: 0, pending: 0, complete: 0, events: [] });
    executor = createConfiguredEngineExecutor(); const engine = createGeometryTraceEngine(executor.execute), fingerprint = await engine.getRuntimeFingerprint();
    let exportCalls = 0; let actualExport: Awaited<ReturnType<GeometryTraceAdapters['exportFittedTrace']>> | undefined;
    const adapters: GeometryTraceAdapters = { getRuntimeFingerprint: engine.getRuntimeFingerprint, exportFittedTrace: async (request, signal) => { exportCalls++; actualExport = await engine.exportFittedTrace(request, signal); return actualExport; } };
    const controller = new AbortController(), injection = injectFinalBoundary(pool, input.scenario, fixture.projectId, controller), repository = createGeometryTraceRepository(injection.wrapped, adapters);
    const command = { schemaVersion: 'wfc.pf.geometry-trace-create.v1' as const, aggregateId: fixture.aggregate.id, expectedProjectionSha256: fixture.aggregate.projection.sha256, derivationVersion: GEOMETRY_TRACE_DERIVATION, idempotencyKey: randomUUID() };
    let receipt: GeometryTraceReceipt | undefined;
    if (input.scenario === 'rollback') await assert.rejects(repository.create(fixture.projectId, fixture.who, command, controller.signal), error => error instanceof Error && error.name === 'AbortError');
    else receipt = await repository.create(fixture.projectId, fixture.who, command, controller.signal);
    assert.equal(exportCalls, 1); assert.ok(actualExport); assert.equal(actualExport.counts.objects, fixture.aggregate.counts.objects); assert.equal(actualExport.counts.segments, 2);
    const seen = injection.observation.inTransaction; assert.ok(seen); assert.equal(injection.observation.dirtyCalls, 1);
    assert.equal(seen.generation, String(BigInt(before.generation) + 1n)); assert.equal(seen.sets, 1); assert.equal(seen.objects, actualExport.counts.objects); assert.equal(seen.diagnostics, actualExport.counts.diagnostics); assert.equal(seen.receipts, 1); assert.equal(seen.pending, 0); assert.equal(seen.complete, 1); assert.equal(seen.events.length, 1);
    let after = await durableState(pool, fixture.projectId);
    let replayVerified = false, newKeyReuseVerified = false;
    if (input.scenario === 'rollback') {
      assert.equal(injection.observation.abortInjected, true); assert.equal(injection.observation.finalCommits, 0);
      assert.deepEqual(after, { ...before, pending: 1 });
    } else {
      assert.ok(receipt); assert.equal(receipt.duplicate, input.scenario === 'lost-ack'); assert.equal(injection.observation.finalCommits, 1);
      assert.deepEqual(receipt.trace.runtimeFingerprint, fingerprint); assert.equal(receipt.trace.engineeringAccepted, false); assert.equal(receipt.trace.nativeParity, 'not-performed'); assert.equal(receipt.trace.fittedTrace.sha256, actualExport.sha256);
      assert.deepEqual(after, seen); assert.deepEqual(after.events, [{ generation: String(BigInt(before.generation) + 1n), domain: 'geometry', reason: 'GEOMETRY_TRACE_PUBLISHED', source_revision: receipt.trace.id + ':' + receipt.trace.contentSha256 }]);
      if (input.scenario === 'lost-ack') { assert.equal(injection.observation.lostAcknowledgementInjected, true); assert.ok(injection.observation.discardedConnections >= 1); }
      const stored = (await pool.query<{ request: unknown; receipt: GeometryTraceReceipt }>('SELECT request,receipt FROM pf_geometry_trace_receipts WHERE project_id=$1 AND actor_id=$2 AND idempotency_key=$3', [fixture.projectId, fixture.who.userId, command.idempotencyKey])).rows;
      assert.equal(stored.length, 1); assert.equal(canonicalPurposeJson(stored[0].request), canonicalPurposeJson(command)); assert.equal(stored[0].receipt.duplicate, false); assert.deepEqual(stored[0].receipt.trace, receipt.trace);
      const read = await repository.get(fixture.projectId, fixture.who, receipt.trace.id); assert.deepEqual(read, receipt.trace);
      const page = await repository.objects(fixture.projectId, fixture.who, receipt.trace.id, { limit: 10 }); assert.equal(page.total, fixture.aggregate.counts.objects); assert.equal(page.objects.length, fixture.aggregate.counts.objects);
      for (const summary of page.objects) {
        const object = await repository.object(fixture.projectId, fixture.who, receipt.trace.id, summary.id);
        assert.equal(object.provenance.sourceKind, 'synthetic'); assert.equal(object.coordinates.qualifiedProjectFrame, null);
      }
      const replay = await repository.create(fixture.projectId, fixture.who, command); assert.equal(replay.duplicate, true); assert.deepEqual(replay.trace, receipt.trace); assert.deepEqual(await durableState(pool, fixture.projectId), after); replayVerified = true;
      const newKey = await repository.create(fixture.projectId, fixture.who, { ...command, idempotencyKey: randomUUID() }); assert.equal(newKey.duplicate, true); assert.deepEqual(newKey.trace, receipt.trace);
      after = await durableState(pool, fixture.projectId); assert.deepEqual(after, { ...seen, receipts: 2 }); newKeyReuseVerified = true;
      assert.equal(exportCalls, 1); assert.equal(injection.observation.dirtyCalls, 1); assert.equal(injection.observation.finalCommits, 1);
    }
    const preservedAfter = await preservedState(pool, fixture.projectId, fixture.who); assert.equal(preservedAfter, preservedBefore);
    const empty = (await pool.query<{ cables: number; jobs: number; applies: number; active_grants: number }>(`SELECT (SELECT count(*)::int FROM cables) AS cables,(SELECT count(*)::int FROM pf_jobs) AS jobs,
      (SELECT count(*)::int FROM pf_apply_receipts) AS applies,(SELECT count(*)::int FROM pf_calculation_grant_heads WHERE grant_id IS NOT NULL) AS active_grants`)).rows[0];
    assert.deepEqual(empty, { cables: 0, jobs: 0, applies: 0, active_grants: 0 }); assert.equal(poolErrors, 0); assert.ok(performance.now() - started < 210000);
    result = { schemaVersion: 'wfc.pf.ordinary-trace-event-control.v1', status: 'PASS', scenario: input.scenario, policy: input.policy, ownerId: input.ownerId, database: input.expectedDatabase,
      scope: 'fresh synthetic seeded SQL model; actual CSharp export, bounded trace worker and repository publication; injected failure transport only', modelStorageVerification: 'not-performed; seeded synthetic metadata only',
      input: { objects: fixture.aggregate.counts.objects, physicalLeaves: fixture.aggregate.counts.physicalLeaves, projectionBytes: fixture.aggregate.projection.bytes, projectionSha256: fixture.aggregate.projection.sha256, planSha256: fixture.plan.orderedPlanSha256 },
      actualExport: { calls: exportCalls, bytes: actualExport.bytes, sha256: actualExport.sha256, counts: actualExport.counts },
      runtimeFingerprint: fingerprint, before, inTransaction: seen, stagedTrace: injection.observation.stagedTrace, after, injections: { dirtyCalls: injection.observation.dirtyCalls, finalCommits: injection.observation.finalCommits, abortInjected: injection.observation.abortInjected, lostAcknowledgementInjected: injection.observation.lostAcknowledgementInjected, discardedConnections: injection.observation.discardedConnections },
      exactReplayVerified: replayVerified, completedDerivationNewKeyVerified: newKeyReuseVerified, preservation: { beforeSha256: preservedBefore, afterSha256: preservedAfter }, zeroEffects: empty,
      ...(receipt ? { traceId: receipt.trace.id, contentSha256: receipt.trace.contentSha256, duplicate: receipt.duplicate } : {}),
      engineeringAccepted: false, nativeParity: 'not-performed', cleanup: { executorClosed: false, poolClosed: false }, elapsedMilliseconds: performance.now() - started };
  } catch (error) { primaryFailed = true; primaryFailure = error; }
  finally {
    try { if (executor) await executor.close(); executorClosed = true; } catch (error) { cleanupFailures.push(error); }
    try { await pool.end(); poolClosed = true; } catch (error) { cleanupFailures.push(error); }
  }
  if (cleanupFailures.length) throw Object.assign(new AggregateError(primaryFailed ? [primaryFailure, ...cleanupFailures] : cleanupFailures, 'Owned trace fixture cleanup is unconfirmed.'), { code: 'ORDINARY_TRACE_FIXTURE_CLEANUP_UNCONFIRMED' });
  if (primaryFailed) throw primaryFailure;
  assert.ok(result); assert.equal(poolErrors, 0); result.cleanup = { executorClosed, poolClosed }; result.elapsedMilliseconds = performance.now() - started; return result;
}
