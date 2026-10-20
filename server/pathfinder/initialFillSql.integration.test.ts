// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cableEndpointCommandSchema } from '../../shared/pathfinderCableEndpoints.js';
import { createCableEndpointCommands } from './cableEndpointCommands.js';
import { initializeEndpointBindingSchema } from './endpointBindingSchema.js';
import { initializePathFinderJobs } from './jobsSchema.js';
import { initializeInitialFillMandateSchema } from './initialFillMandateSchema.js';
import { initializeInitialFillAttemptSchema } from './initialFillAttemptSchema.js';
import { createInitialFillAttempts } from './initialFillAttempts.js';
import { createInitialFillWriter } from './initialFillWriter.js';
import { initialFillIdempotencyKey } from './initialFillIdentity.js';
import { readInitialFillMandate } from './initialFillMandates.js';
import { syntheticEngineIdentity } from './calculationFixtures.js';
import { defaultOptions, type EngineResponse, type ScopedDependencySnapshot } from './jobContracts.js';
import { hash } from './dependencies.js';
import { INITIAL_FILL_ROUTING_WHITESPACE, initialFillProvenanceSchema } from '../../shared/pathfinderInitialFill.js';
import { CABLE_ENDPOINT_SELECTION_INDEX_SQL } from './cableEndpointSelectionSchema.js';
import { geometryTraceFixture } from './geometryTraceFixtures.js';
import { buildGeometryTrace } from './geometryTraceBuilder.js';
import { initializeLocationImpactSchema } from './locationImpactSchema.js';
import { readLocationImpactJobAuthority } from './locationImpactRepository.js';
import { PathFinderError } from './errors.js';

// Actual owned PostgreSQL. Binding/impact/mandate/authority/writer/history SQL are real.
// Admission and engineering proof/collector/artifact adapters are explicitly synthetic.
// This is not full engine, deployed-schema, HTTP/UI or native parity evidence.
const fixturePath = process.env.PF_U4_SQL_FIXTURE;
const id = (n: number) => `af310000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const who = { userId: id(2), loginId: id(3), loginExpiresAt: Date.parse('2099-01-01T00:00:00Z') };
const schemaName = 'pfu4_initialfill', logicalName = 'SHARED LOCATION';
const cableIds = Array.from({ length: 20 }, (_, at) => id(100 + at));
let pool: Pool, commands: ReturnType<typeof createCableEndpointCommands>, sample: ReturnType<typeof geometryTraceFixture>;
const schema = `
CREATE TABLE projects(id uuid PRIMARY KEY,connection_gap numeric,secondary_tray_length numeric,end_connection_length numeric,additional_bending_percent numeric);
CREATE TABLE users(id uuid PRIMARY KEY,is_admin boolean NOT NULL,pf_admin_revision bigint NOT NULL DEFAULT 0,first_name text,last_name text,email text);
CREATE TABLE viewer_login_bindings(login_id uuid PRIMARY KEY,user_id uuid NOT NULL,expires_at timestamptz NOT NULL,revoked_at timestamptz);
CREATE TABLE cable_types(id uuid PRIMARY KEY,name text NOT NULL);
CREATE TABLE cables(id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id),cable_write_revision bigint NOT NULL DEFAULT 7,
 from_location text,to_location text,mto text,routing text,design_length numeric,install_length numeric,revision text,
 cable_id text,tag text,cable_type_id uuid NOT NULL REFERENCES cable_types(id),delivery text,pull_date date,connected_from boolean DEFAULT false,
 connected_to boolean DEFAULT false,tested boolean DEFAULT false,updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(project_id,id));
CREATE TABLE cable_versions(id uuid PRIMARY KEY,cable_id uuid NOT NULL,version_number integer NOT NULL,change_type text,change_source text,
 cable_number text,revision text,mto text,tag text,cable_type_id uuid,cable_type_name text,from_location text,to_location text,routing text,delivery text,
 design_length numeric,install_length numeric,pull_date date,connected_from boolean,connected_to boolean,tested boolean,changed_by uuid,changed_by_snapshot jsonb,
 UNIQUE(cable_id,version_number));
CREATE TABLE pf_project_state(project_id uuid PRIMARY KEY REFERENCES projects(id),registry_revision bigint NOT NULL,updated_at timestamptz DEFAULT now());
CREATE TABLE pf_locations(id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id),name text NOT NULL,revision bigint NOT NULL DEFAULT 1,
 created_by uuid NOT NULL,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),UNIQUE(project_id,id));
CREATE TABLE pf_location_aliases(project_id uuid,normalized_alias text,display_alias text,location_id uuid,PRIMARY KEY(project_id,normalized_alias),
 FOREIGN KEY(project_id,location_id) REFERENCES pf_locations(project_id,id) ON DELETE CASCADE);
CREATE TABLE project_model_selections(project_id uuid PRIMARY KEY REFERENCES projects(id),active_model_version_id uuid,selection_revision bigint);
CREATE TABLE model_versions(project_id uuid REFERENCES projects(id),id uuid,content_fingerprint text,state text,health text,PRIMARY KEY(project_id,id));
CREATE TABLE pf_project_preparations(project_id uuid PRIMARY KEY REFERENCES projects(id),current_aggregate_id uuid,current_artifact_id uuid,geometry_revision bigint);
CREATE TABLE pf_preparation_aggregates(id uuid PRIMARY KEY,project_id uuid REFERENCES projects(id),session_id uuid,model_version_id uuid,
 artifact_id uuid,geometry_revision bigint,manifest jsonb NOT NULL,UNIQUE(project_id,id));
CREATE TABLE pf_artifacts(project_id uuid REFERENCES projects(id),id uuid,model_version_id uuid,snapshot_sha256 text,snapshot_bytes bigint,content_fingerprint text,PRIMARY KEY(project_id,id));
CREATE TABLE pf_geometry_trace_sets(id uuid PRIMARY KEY,project_id uuid REFERENCES projects(id),aggregate_id uuid,model_version_id uuid,
 manifest jsonb NOT NULL,created_at timestamptz DEFAULT now(),UNIQUE(project_id,id),FOREIGN KEY(project_id,aggregate_id) REFERENCES pf_preparation_aggregates(project_id,id));
CREATE TABLE pf_model_objects(project_id uuid,artifact_id uuid,object_id text,db_id integer,geometry_role text,visibility text,
 PRIMARY KEY(project_id,artifact_id,object_id),FOREIGN KEY(project_id,artifact_id) REFERENCES pf_artifacts(project_id,id));
CREATE TABLE pf_geometry_object_revisions(id uuid PRIMARY KEY,project_id uuid,trace_id uuid,object_id text,summary jsonb NOT NULL,record jsonb NOT NULL,
 UNIQUE(project_id,trace_id,object_id),FOREIGN KEY(project_id,trace_id) REFERENCES pf_geometry_trace_sets(project_id,id));
CREATE TABLE pf_location_bindings(project_id uuid,location_id uuid,model_version_id uuid,revision bigint,point jsonb,object_id text,derivation text,confirmed_at timestamptz,
 PRIMARY KEY(project_id,location_id,model_version_id));
CREATE TABLE pf_installation_state(singleton boolean PRIMARY KEY CHECK(singleton),installation_epoch uuid NOT NULL);
CREATE TABLE pfu4_event_journal(project_id uuid,domain text,reason text,source_revision text);
CREATE OR REPLACE FUNCTION pf_recalculation_dirty(pid uuid,kind text,why text,source_value text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
 BEGIN INSERT INTO pfu4_event_journal VALUES(pid,kind,why,source_value);END $$;
`;
async function seed() {
  sample = geometryTraceFixture(); const built = buildGeometryTrace(sample), aggregate = sample.aggregate, projectId = aggregate.projectId;
  await pool.query('INSERT INTO projects(id,connection_gap,end_connection_length,additional_bending_percent) VALUES($1,1,1,10)', [projectId]); await pool.query("INSERT INTO users VALUES($1,true,8,'Synthetic','Administrator','synthetic@example.invalid')", [who.userId]);
  await pool.query('INSERT INTO viewer_login_bindings VALUES($1,$2,$3,NULL)', [who.loginId, who.userId, new Date(who.loginExpiresAt)]);
  await pool.query('INSERT INTO pf_installation_state VALUES(true,$1)', [id(4)]);
  await pool.query('INSERT INTO pf_project_state(project_id,registry_revision) VALUES($1,4)', [projectId]);
  await pool.query('INSERT INTO project_model_selections VALUES($1,$2,$3)', [projectId, aggregate.modelVersionId, aggregate.selectionRevision]);
  await pool.query("INSERT INTO model_versions VALUES($1,$2,$3,'ready','healthy')", [projectId, aggregate.modelVersionId, aggregate.contentFingerprint]);
  await pool.query('INSERT INTO pf_artifacts VALUES($1,$2,$3,$4,$5,$6)', [projectId, aggregate.artifactId, aggregate.modelVersionId,
    aggregate.projection.sha256, aggregate.projection.bytes, aggregate.contentFingerprint]);
  await pool.query('INSERT INTO pf_preparation_aggregates VALUES($1,$2,$3,$4,$5,$6,$7)', [aggregate.id, projectId, aggregate.sessionId,
    aggregate.modelVersionId, aggregate.artifactId, aggregate.geometryRevision, aggregate]);
  await pool.query('INSERT INTO pf_project_preparations VALUES($1,$2,$3,$4)', [projectId, aggregate.id, aggregate.artifactId, aggregate.geometryRevision]);
  await pool.query('INSERT INTO pf_geometry_trace_sets(id,project_id,aggregate_id,model_version_id,manifest) VALUES($1,$2,$3,$4,$5)',
    [sample.traceId, projectId, aggregate.id, aggregate.modelVersionId, built.manifest]);
  for (const [at, record] of built.records.entries()) {
    await pool.query("INSERT INTO pf_model_objects VALUES($1,$2,$3,$4,$5,'unknown')", [projectId, aggregate.artifactId, record.identity.objectId, record.identity.dbId, record.geometry.role]);
    await pool.query('INSERT INTO pf_geometry_object_revisions VALUES($1,$2,$3,$4,$5,$6)', [record.id, projectId, sample.traceId, record.identity.objectId, built.summaries[at], record]);
  }
  await pool.query("INSERT INTO cable_types VALUES($1,'Synthetic cable type')", [id(5)]);
  for (const [at, cableId] of cableIds.entries()) await pool.query(`INSERT INTO cables(id,project_id,cable_write_revision,from_location,to_location,mto,
    routing,design_length,install_length,revision,cable_id,tag,cable_type_id) VALUES($1,$2,7,$3,$3,$4,NULL,NULL,39.125,'business-original',$5,$5,$6)`,
    [cableId, projectId, logicalName, at === 3 ? 'MV' : at === 4 ? 'Unknown' : at === 1 ? 'Control' : at === 2 ? 'Instrumentation' : 'LV', 'SYNTHETIC-'+at, id(5)]);
  await pool.query('TRUNCATE pfu4_event_journal');
}

async function commandFor(version: 'v1' | 'v2' | 'v3' = 'v3', initialFill: { mode: 'when-both-empty' } | null = { mode: 'when-both-empty' }) {
  const projectId = sample.aggregate.projectId, cableId = cableIds[0], context = await commands.context(projectId, who, cableId, 'from');
  if (!context.current || !context.logicalName) throw Error('Synthetic endpoint context must be bindable.');
  const selected = await commands.selection(projectId, who, cableId, 'from', 5, context.contextSha256);
  if (selected.selection.status !== 'available' || !selected.selection.object) throw Error('Synthetic object evidence must be available.');
  return cableEndpointCommandSchema.parse({ schemaVersion: `wfc.pf.cable-endpoint-command.${version}`, idempotencyKey: randomUUID(),
    expectedContextSha256: context.contextSha256, expectedCableWriteRevision: context.cableWriteRevision, expectedLogicalName: context.logicalName,
    expectedRegistryRevision: context.registryRevision, expectedLocationId: context.location?.id ?? null, expectedLocationRevision: context.location?.revision ?? null,
    expectedHeadId: context.head?.id ?? null, expectedCurrent: context.current, reason: 'Explicit synthetic owned SQL initial-fill test.',
    selection: { mode: 'object-derived', sdkObjectId: 5, object: selected.selection.object },
    ...(version !== 'v1' ? { calculation: { preferences: { secondaryDistanceMeters: 2, preferVerticalApproach: true }, timeoutMilliseconds: 60000 } } : {}),
    ...(version === 'v3' ? { initialFill } : {}) });
}
async function counts() {
  return (await pool.query(`SELECT (SELECT count(*)::int FROM pf_endpoint_binding_commands) commands,
    (SELECT count(*)::int FROM pf_endpoint_binding_revisions) bindings,(SELECT count(*)::int FROM pf_location_impacts) impacts,
    (SELECT count(*)::int FROM pf_initial_fill_mandates) mandates,(SELECT count(*)::int FROM pf_apply_receipts) receipts,
    (SELECT count(*)::int FROM cable_versions) history,(SELECT md5(string_agg(to_jsonb(c)::text,E'\\n' ORDER BY id)) FROM cables c) cable_hash`)).rows[0];
}
async function cable(cableId = cableIds[0]) {
  return (await pool.query(`SELECT to_jsonb(c)||jsonb_build_object('design_length',c.design_length::text,'install_length',c.install_length::text,
    'cable_write_revision',c.cable_write_revision::text) AS value FROM cables c WHERE c.project_id=$1 AND c.id=$2`, [sample.aggregate.projectId, cableId])).rows[0].value;
}
/** Real v3 save/manifest/current authority; explicitly synthetic admission and engine proofs. */
async function writable() {
  const projectId = sample.aggregate.projectId, cableId = cableIds[0], command = await commandFor(), saved = await commands.save(projectId, who, cableId, 'from', command);
  if (!saved.initialFillMandate || !saved.locationImpact || command.schemaVersion !== 'wfc.pf.cable-endpoint-command.v3') throw Error('Synthetic v3 must retain both authority references.');
  const client = await pool.connect(); let mandate;
  try { mandate = await readInitialFillMandate(client, projectId, saved.initialFillMandate.id); } finally { client.release(); }
  if (!mandate) throw Error('Real immutable mandate must be present.');
  const original = await cable(), jobId = randomUUID(), proposalId = randomUUID(), endpoint = {
    locationId: saved.locationId, locationRevision: saved.binding.locationRevision, bindingRevision: saved.binding.binding.bindingRevision,
    point: saved.binding.binding.pointProjectMetres, bindingId: saved.binding.binding.id, bindingContentSha256: saved.binding.binding.contentSha256,
    mode: saved.binding.binding.mode, captureFrameId: mandate.current.captureFrameId, qualifiedProjectFrameId: null, aggregateId: mandate.current.aggregateId,
    projectionSha256: mandate.current.projectionSha256, sourceObjectRevisionId: saved.binding.binding.sourceObject?.objectRevisionId ?? null, migrationDecisionId: null };
  const dependencies: ScopedDependencySnapshot = { schemaVersion: 'pathfinder.dependencies.v7', projectId, cableId, cableWriteRevision: original.cable_write_revision,
    model: { id: mandate.current.modelVersionId, selectionRevision: mandate.current.selectionRevision, contentFingerprint: mandate.current.contentFingerprint },
    artifact: { id: mandate.current.artifactId, sha256: mandate.current.projectionSha256 }, preparation: { aggregateId: mandate.current.aggregateId, geometryRevision: mandate.current.geometryRevision,
      captureFrameId: mandate.current.captureFrameId, projectionSha256: mandate.current.projectionSha256 }, routing: { catalogRevision: '2', routingContentSha256: 'a'.repeat(64), routingPolicyRevision: '3', routingPolicySha256: 'b'.repeat(64) },
    cableInputs: { fromLocation: logicalName, toLocation: logicalName, mto: 'LV', cableTypeId: id(5) }, settings: { revision: '2', connectionGap: '1', secondaryTrayLength: null, endConnectionLength: '1', additionalBendingPercent: '10' },
    options: { ...defaultOptions }, from: endpoint, to: endpoint,
    endpointResolution: { schemaVersion: 'pathfinder.endpoint-resolution.v1', matchingPolicy: 'nfc-trim-uppercase-v1', from: { logicalKey: logicalName, locationId: saved.locationId }, to: { logicalKey: logicalName, locationId: saved.locationId } },
    comparison: null, engineVersion: 'pathfinder-45c24bf5-pf1-modelrunner-v1', engineIdentity: syntheticEngineIdentity() };
  const result: EngineResponse = { schemaVersion: 'pathfinder.model.response.v1', requestId: randomUUID(), status: 'calculated', message: 'Synthetic engine result, not engineering acceptance.', engineeringAccepted: false,
    route: { success: true, message: '', routeText: '/B001', routeCodes: ['B001'], segmentIds: ['dbid:9'], pathPoints: [{ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }], lengthMeters: 5, fromDistanceMeters: 1, toDistanceMeters: 1,
      fromRequiresSecondary: false, toRequiresSecondary: false, connectionGapCount: 0, connectionGapLengthMeters: 0 }, design: { lengthBeforePercentageMeters: '6', unroundedLengthMeters: '6.6', designLengthMeters: '7' },
    lengthLedger: { schemaVersion: 'wfc.pf.length-components.v1', formulaVersion: 'pathfinder-45c24bf5', settingsRevision: '2', raw: { lengthMeters: 5, fromDistanceMeters: 1, toDistanceMeters: 1 }, rawLengthDecimalMeters: '5',
      from: { requiresSecondary: false, removedApproachMeters: '0' }, to: { requiresSecondary: false, removedApproachMeters: '0' }, settings: { secondaryTrayLengthMeters: null, endConnectionLengthMeters: '1', additionalBendingPercent: '10' },
      secondaryEnds: 0, replacementMeters: '0', beforeClampMeters: '5', clampAdjustmentMeters: '0', afterClampMeters: '5', beforePercentageMeters: '6', bendingIncrementMeters: '0.6', unroundedMeters: '6.6', ceilingIncrementMeters: '0.4', designLengthMeters: '7', gapAccounting: 'already-in-raw-geometry' } };
  const proposalHash = hash({ dependencies, result }), inputSha256 = 'e'.repeat(64), admissionId = randomUUID();
  await pool.query(`INSERT INTO pf_jobs(id,project_id,requested_by,login_id,login_expires_at,state,total,completed,options,timeout_ms,request_hash,authority_kind)
    VALUES($1,$2,$3,$4,$5,'complete',$6,$6,$7,60000,$8,'current-login')`, [jobId, projectId, who.userId, who.loginId, new Date(who.loginExpiresAt), mandate.eligibleCableIds.length, dependencies.options, inputSha256]);
  await pool.query(`INSERT INTO pf_job_items(project_id,job_id,cable_id,state,status,message) SELECT $1,$2,unnest($3::uuid[]),'complete','calculated','Synthetic admission'`, [projectId, jobId, mandate.eligibleCableIds]);
  await pool.query(`INSERT INTO pf_location_impact_enrollments(project_id,impact_id,job_id,input_sha256,admission_id,total,ready_cables,blocked_cables)
    VALUES($1,$2,$3,$4,$5,$6,$6,0)`, [projectId, mandate.impactId, jobId, inputSha256, admissionId, mandate.eligibleCableIds.length]);
  await pool.query(`INSERT INTO pf_proposals(id,project_id,job_id,cable_id,status,dependencies,dependency_hash,geometry_hash,result,proposal_hash)
    VALUES($1,$2,$3,$4,'calculated',$5,$6,$7,$8,$9)`, [proposalId, projectId, jobId, cableId, dependencies, hash(dependencies), 'a'.repeat(64), result, proposalHash]);
  const seal = { admissionId, revisionResultSha256: 'd'.repeat(64), baselineHash: 'e'.repeat(64), engineResultSha256: hash(result), ledgerHash: hash(result.lengthLedger), dependencyHash: hash(dependencies) };
  const writer = createInitialFillWriter(pool, { identity: async () => syntheticEngineIdentity(), snapshot: (async () => ({})) as any, seal: (async () => seal) as any,
    proof: async () => true, applicability: (async () => ({ applicable: true })) as any,
    collect: (async (c: import('pg').PoolClient, pid: string, cid: string) => {
      const live = (await c.query(`SELECT cable_write_revision::text,from_location,to_location,mto,cable_type_id FROM cables WHERE project_id=$1 AND id=$2 FOR UPDATE`, [pid, cid])).rows[0];
      return { cable: live, dependencies: { ...dependencies, cableWriteRevision: live.cable_write_revision, cableInputs: { fromLocation: live.from_location, toLocation: live.to_location, mto: live.mto, cableTypeId: live.cable_type_id } } };
    }) as any });
  const request = { schemaVersion: 'wfc.pf.initial-fill-request.v1', proposalId, expectedProposalHash: proposalHash, mandateId: mandate.id, expectedCableWriteRevision: dependencies.cableWriteRevision,
    idempotencyKey: initialFillIdempotencyKey({ projectId, cableId, proposalId, proposalHash, mandateId: mandate.id, expectedCableWriteRevision: dependencies.cableWriteRevision }) };
  return { projectId, cableId, command, saved, mandate, original, jobId, writer, request, run: () => writer.apply(projectId, request, async () => undefined) };
}

describe.runIf(Boolean(fixturePath))('PF-U4 owned actual command/mandate/initial-fill SQL slice with explicit synthetic engineering adapters', () => {
  beforeAll(async () => {
    const scratch = await realpath(fileURLToPath(new URL('../../pathfinder-engine/.scratch/', import.meta.url))), resolved = await realpath(fixturePath!);
    const relative = path.relative(scratch, resolved), parts = relative.split(path.sep);
    if (path.isAbsolute(relative) || relative.startsWith('..') || parts.length !== 2 || !/^initial-fill-u4-[a-f0-9-]{36}$/.test(parts[0]) || !parts[1].endsWith('.private.json'))
      throw Error('Refuse a fixture context outside its newly owned U4 scratch directory.');
    const config = JSON.parse(await readFile(resolved, 'utf8')) as { database: string; url: string; owner: string };
    if (!/^wfc_pfu4_[a-f0-9_]+$/.test(config.database) || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(config.owner)) throw Error('Refuse a nonfixture database or owner capability.');
    const url = new URL(config.url);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || decodeURIComponent(url.pathname.slice(1)) !== config.database)
      throw Error('Refuse a nonlocal or mismatched fixture URL.');
    pool = new Pool({ connectionString: config.url, options: `-c search_path=${schemaName},pg_catalog`, max: 3, connectionTimeoutMillis: 3000, query_timeout: 20000 });
    const identity = (await pool.query('SELECT current_database() AS db,owner FROM public.pfu4_fixture_owner')).rows;
    if (identity.length !== 1 || identity[0].db !== config.database || identity[0].owner !== config.owner) throw Error('Fixture owner mismatch before any DDL.');
    await pool.query(`CREATE SCHEMA ${schemaName}`); await pool.query(schema); await pool.query(CABLE_ENDPOINT_SELECTION_INDEX_SQL);
    await initializeEndpointBindingSchema(pool); await initializePathFinderJobs(pool);
    await pool.query("ALTER TABLE pf_jobs ADD COLUMN authority_kind text NOT NULL DEFAULT 'current-login'");
    await initializeLocationImpactSchema(pool); await initializeInitialFillMandateSchema(pool); await initializeInitialFillAttemptSchema(pool);
    // Use the exact production revision trigger instead of approximating its
    // forced PF increment, normal cable edits or initial insertion semantics.
    const source = await readFile(new URL('./schema.ts', import.meta.url), 'utf8'), start = source.indexOf('CREATE OR REPLACE FUNCTION own_cable_write_revision()');
    const end = source.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS cables_project_record_identity', start);
    if (start < 0 || end <= start || !source.slice(start, end).includes('CREATE TRIGGER cable_write_revision_owned')) throw Error('Production cable revision trigger boundary changed; review this SQL slice.');
    await pool.query(source.slice(start, end)); commands = createCableEndpointCommands(pool);
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE pfu4_initialfill.projects,pfu4_initialfill.users,pfu4_initialfill.viewer_login_bindings,pfu4_initialfill.pf_installation_state,pfu4_initialfill.cable_versions,pfu4_initialfill.cable_types CASCADE'); await seed();
  });
  afterAll(async () => { await pool?.end(); });

  it('v3 saves one shared binding/impact/finite mandate atomically; exact replay never creates a second one', async () => {
    const before = await counts(), command = await commandFor(), receipt = await commands.save(sample.aggregate.projectId, who, cableIds[0], 'from', command);
    expect(receipt.locationImpact).toMatchObject({ eligibleCables: 18, excludedMvCables: 1, blockedCategoryCables: 1 }); expect(receipt.initialFillMandate).toMatchObject({ impactId: receipt.locationImpact!.id, mode: 'when-both-empty' });
    expect(await counts()).toMatchObject({ commands: 1, bindings: 1, impacts: 1, mandates: 1, receipts: 0, history: 0, cable_hash: before.cable_hash });
    expect(await commands.save(sample.aggregate.projectId, who, cableIds[0], 'from', command)).toEqual({ ...receipt, duplicate: true }); expect((await counts()).mandates).toBe(1);
    const retained = (await pool.query('SELECT record FROM pf_initial_fill_mandates')).rows[0].record;
    expect(retained).toMatchObject({ actorId: who.userId, loginId: who.loginId, eligibleCableIds: cableIds.filter((_, at) => at !== 3 && at !== 4) });
    expect(Date.parse(retained.authorityExpiresAt)).toBeLessThanOrEqual(Date.parse(retained.createdAt) + 1800000);
  });
  it('legacy v1, calculation-only v2 and explicit v3 null policy never acquire an initial-fill mandate', async () => {
    for (const version of ['v1', 'v2', 'v3'] as const) { const command = await commandFor(version, null), receipt = await commands.save(sample.aggregate.projectId, who, cableIds[0], 'from', command); expect(receipt.initialFillMandate).toBeUndefined(); }
    expect(await counts()).toMatchObject({ commands: 3, impacts: 2, mandates: 0, receipts: 0, history: 0 });
  });
  it('mandate INSERT failure rolls back binding, shared targets, command ledger and registry together', async () => {
    const before = await counts(), command = await commandFor();
    await pool.query("CREATE FUNCTION pfu4_deny_mandate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic mandate fault';END $$; CREATE TRIGGER pfu4_deny_mandate BEFORE INSERT ON pf_initial_fill_mandates FOR EACH ROW EXECUTE FUNCTION pfu4_deny_mandate()");
    try { await expect(commands.save(sample.aggregate.projectId, who, cableIds[0], 'from', command)).rejects.toThrow('synthetic mandate fault'); expect(await counts()).toEqual(before); expect((await pool.query('SELECT registry_revision::text FROM pf_project_state')).rows[0].registry_revision).toBe('4'); }
    finally { await pool.query('DROP TRIGGER pfu4_deny_mandate ON pf_initial_fill_mandates;DROP FUNCTION pfu4_deny_mandate()'); }
  });
  it('a closed exact v3 command cannot later create a binding, impact or mandate', async () => {
    const command = await commandFor(); expect((await commands.close(sample.aggregate.projectId, who, cableIds[0], 'from', command)).status).toBe('closed');
    await expect(commands.save(sample.aggregate.projectId, who, cableIds[0], 'from', command)).rejects.toMatchObject({ code: 'CABLE_ENDPOINT_COMMAND_CLOSED' }); expect(await counts()).toMatchObject({ commands: 1, bindings: 0, impacts: 0, mandates: 0 });
  });
  it('real v3 mandate/current authority writes one pair/history/receipt without fake review or changed install length', async () => {
    const f = await writable(), attempts = createInitialFillAttempts(pool); expect(await attempts.discover()).toBe(1); expect(await attempts.discover()).toBe(0);
    const claim = await attempts.claim(); if (!claim) throw Error('Synthetic exact initial-fill attempt must be claimable.'); expect(claim.request).toEqual(f.request);
    const result = await f.writer.apply(f.projectId, claim.request, client => attempts.fence(client, claim)); expect(result.status).toBe('written');
    await attempts.finish(claim, { status: result.status, receiptId: result.receiptId }); expect(await attempts.claim()).toBeNull(); const after = await cable();
    expect(after).toMatchObject({ routing: '/B001', design_length: '7', install_length: f.original.install_length, revision: f.original.revision }); expect(BigInt(after.cable_write_revision)).toBe(BigInt(f.original.cable_write_revision) + 1n);
    expect(await counts()).toMatchObject({ history: 1, receipts: 1 }); const receipt = (await pool.query('SELECT * FROM pf_apply_receipts')).rows[0], provenance = initialFillProvenanceSchema.parse(receipt.provenance);
    expect(provenance).toMatchObject({ validationMethod: 'automatic-initial-fill', engineeringAccepted: false, mandate: f.saved.initialFillMandate, authorized: { actorId: who.userId, loginId: who.loginId } });
    expect((await pool.query('SELECT count(*)::int FROM pf_reviews')).rows[0].count).toBe(0); expect((await pool.query('SELECT routing,design_length::text,install_length::text FROM cable_versions')).rows[0]).toMatchObject({ routing: '/B001', design_length: '7', install_length: f.original.install_length });
    expect((await pool.query('SELECT status,attempts,receipt_id,owner_token,lease_until FROM pf_initial_fill_dispatch')).rows[0]).toMatchObject({ status: 'written', attempts: 1, receipt_id: result.receiptId, owner_token: null, lease_until: null });
    expect((await f.run()).status).toBe('already-written'); expect(await counts()).toMatchObject({ history: 1, receipts: 1 });
  });
  it('actual SQL trim accepts the complete JS whitespace set with NULL design', async () => {
    await pool.query('UPDATE cables SET routing=$1 WHERE id=$2', [INITIAL_FILL_ROUTING_WHITESPACE, cableIds[0]]); const f = await writable(); expect((await f.run()).status).toBe('written'); expect((await cable()).routing).toBe('/B001');
  });
  it('zero design, existing route and partial pairs remain unchanged with review-required outcomes', async () => {
    for (const pair of [{ routing: null, length: '0' }, { routing: '/MANUAL', length: null }, { routing: '/MANUAL', length: '21' }]) {
      await pool.query('TRUNCATE pfu4_initialfill.projects,pfu4_initialfill.users,pfu4_initialfill.viewer_login_bindings,pfu4_initialfill.pf_installation_state,pfu4_initialfill.cable_versions,pfu4_initialfill.cable_types CASCADE'); await seed();
      await pool.query('UPDATE cables SET routing=$1,design_length=$2 WHERE id=$3', [pair.routing, pair.length, cableIds[0]]); const f = await writable(), before = await cable();
      expect((await f.run()).status).toBe('review-required'); expect(await cable()).toEqual(before); expect(await counts()).toMatchObject({ receipts: 0, history: 0 });
    }
  });
  it('intervening manual edits cannot regain automatic authority merely by leaving both fields blank', async () => {
    const f = await writable(); await pool.query("UPDATE cables SET tag='Intervening manual edit' WHERE id=$1", [cableIds[0]]); const before = await cable();
    await expect(f.run()).rejects.toMatchObject({ code: 'PROPOSAL_STALE' }); expect(await cable()).toEqual(before); expect(await counts()).toMatchObject({ receipts: 0, history: 0 });
  });
  it('actual final CAS refuses a late competing write and rolls back the attempted pair', async () => {
    const f = await writable(), before = await cable(); let fences = 0;
    await expect(f.writer.apply(f.projectId, f.request, async client => { if (++fences === 2) await client.query("UPDATE cables SET routing='/LATE' WHERE id=$1", [cableIds[0]]); })).rejects.toMatchObject({ code: 'CABLE_WRITE_CONFLICT' });
    expect(await cable()).toEqual(before); expect(await counts()).toMatchObject({ receipts: 0, history: 0 });
  });
  it('history failure rolls back the actual cable update and receipt together', async () => {
    const f = await writable(), before = await cable(); await pool.query("CREATE FUNCTION pfu4_deny_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic history fault';END $$;CREATE TRIGGER pfu4_deny_history BEFORE INSERT ON cable_versions FOR EACH ROW EXECUTE FUNCTION pfu4_deny_history()");
    try { await expect(f.run()).rejects.toThrow('synthetic history fault'); expect(await cable()).toEqual(before); expect(await counts()).toMatchObject({ receipts: 0, history: 0 }); }
    finally { await pool.query('DROP TRIGGER pfu4_deny_history ON cable_versions;DROP FUNCTION pfu4_deny_history()'); }
  });
  it('real immutable triggers refuse receipt and mandate UPDATEs', async () => {
    const f = await writable(); await f.run();
    await expect(pool.query("UPDATE pf_apply_receipts SET payload_hash=$1", ['f'.repeat(64)])).rejects.toThrow('immutable');
    await expect(pool.query("UPDATE pf_initial_fill_mandates SET command_sha256=$1", ['f'.repeat(64)])).rejects.toThrow('immutable'); expect(await counts()).toMatchObject({ receipts: 1, history: 1, mandates: 1 });
  });
  it('current login revocation and restored installation epoch each refuse new initial fill', async () => {
    const f = await writable(); await pool.query('UPDATE viewer_login_bindings SET revoked_at=now() WHERE login_id=$1', [who.loginId]);
    await expect(f.run()).rejects.toMatchObject({ code: 'LOGIN_REVOKED' }); await pool.query('UPDATE viewer_login_bindings SET revoked_at=NULL WHERE login_id=$1', [who.loginId]);
    await pool.query('UPDATE pf_installation_state SET installation_epoch=$1', [randomUUID()]); await expect(f.run()).rejects.toMatchObject({ code: 'LOCATION_IMPACT_RESTORE_FENCED' }); expect(await counts()).toMatchObject({ receipts: 0, history: 0 });
  });
});
