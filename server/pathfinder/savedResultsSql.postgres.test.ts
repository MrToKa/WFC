// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto';
import { Client, Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readModelLocationMatchSummary } from './modelLocationMatchSummary.js';
import { createCableWorkflowRepository } from './cableWorkflowRepository.js';
import { endpointBindingFixture } from '../../shared/pathfinderEndpointFixtures.js';
import { canonicalPurposeJson } from '../../shared/pathfinderPurposePolicy.js';
import { MODEL_LOCATION_MATCH_LIMITS, type ModelLocationMatchAssign, type ModelLocationMatchContext,
  type ModelLocationMatchReceipt, type ModelLocationMatchResult } from '../../shared/pathfinderModelLocationMatch.js';

// SQL, current login/project authorization, and workflow transactions are real.
// Geometry/preparation and retained proof are explicit seams: these tests do
// not qualify engineering acceptance or converted-model parity.
const proof = vi.hoisted(() => ({ accepted: vi.fn(), savedExactDisplay: vi.fn() }));
vi.mock('./dependencies.js', async original => ({ ...await original<typeof import('./dependencies.js')>(),
  collectCommonCalculationInputs: async () => ({ inputs: null, bindingContext: null, status: 'model_required', message: '' }) }));
vi.mock('./endpointBindingRepository.js', async original => ({ ...await original<typeof import('./endpointBindingRepository.js')>(),
  readCurrentEndpointBindingContext: async () => null,
  readNeededEndpointBindingHeads: async (_client: unknown, input: { projectId: string; locationIds: string[] }) =>
    new Map(input.locationIds.map(locationId => [locationId, { ready: true,
      binding: { ...endpointBindingFixture(), projectId: input.projectId, locationId } }])) }));
vi.mock('./automaticEndpointCandidates.js', () => ({ readAutomaticEndpointCandidates: async () => new Map() }));
vi.mock('./cableWorkflowProof.js', () => ({ createCableWorkflowProofReader: () => ({
  verified: async () => null, reviewable: async () => ({ currentness: 'unavailable', reviewable: false, reasonCodes: [] }),
  accepted: proof.accepted, savedExactDisplay: proof.savedExactDisplay }) }));

// Explicit opt-in only. This administrative connection must address localhost's
// maintenance database. Never derive a test target from application DATABASE_URL.
const adminUrl = process.env.WFC_SAVED_RESULTS_SQL_ADMIN_URL;
const owner = randomUUID(), suffix = owner.replaceAll('-', '');
const database = `wfc_saved_results_${suffix}`;
const summarySchema = `pf_summary_${suffix}`, workflowSchema = `pf_saved_route_${suffix}`;
const id = (n: number) => `5a100000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const hash = (value: unknown) => createHash('sha256').update(canonicalPurposeJson(value)).digest('hex');
let admin: Client | undefined, control: Client | undefined, summaryPool: Pool | undefined, workflowPool: Pool | undefined;
let created = false;
const current = { modelVersionId: id(10), selectionRevision: '1', contentFingerprint: 'a'.repeat(64), aggregateId: id(11),
  artifactId: id(12), projectionSha256: 'b'.repeat(64), captureFrameId: id(13), geometryRevision: '1', traceId: id(14) };
const context: ModelLocationMatchContext = { schemaVersion: 'wfc.pf.model-location-match-context.v1', projectId: id(1),
  current, registryRevision: '9', names: ['FIRST', 'SECOND', 'THIRD'], namesSha256: hash(['FIRST', 'SECOND', 'THIRD']) };

function command(names: string[], key: string): ModelLocationMatchAssign {
  return { schemaVersion: 'wfc.pf.model-location-match-assign.v1', current, namesSha256: context.namesSha256,
    expectedRegistryRevision: '1', idempotencyKey: key, names,
    scan: { matchingPolicyVersion: 'wfc.pf.project-exact-candidates.v3', visibilityScope: {
      schemaVersion: 'wfc.pf.sdk-display-visibility.v1', basis: 'sdk-display-before-pf-appearance', contentSha256: 'c'.repeat(64) },
    indexedObjectCount: names.length, propertyScan: { attemptedObjectCount: names.length, returnedObjectCount: names.length,
      omittedObjectCount: 0, complete: true }, complete: true,
    candidates: names.map((name, index) => ({ objectId: index + 1, name: 'SDK ' + name, matchedNames: [name],
      bounds: { minimum: [1, 2, 3], maximum: [3, 4, 5] }, bottomCentre: [2, 3, 3] })) } };
}

async function insertCommand(value: ModelLocationMatchAssign, results: ModelLocationMatchResult[], time: string, actor = id(2)) {
  const request = { schemaVersion: 'wfc.pf.model-location-match-owner.v1', command: value };
  const receipt: ModelLocationMatchReceipt = { schemaVersion: 'wfc.pf.model-location-match-receipt.v1', projectId: context.projectId,
    idempotencyKey: value.idempotencyKey, commandSha256: hash(value), registryRevision: '2', results, duplicate: false };
  await summaryPool!.query('INSERT INTO pf_endpoint_binding_commands VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [context.projectId, actor, value.idempotencyKey, 'confirm', hash(request), request, receipt, time]);
  return { request, receipt };
}
const assigned = (name: string, n: number): ModelLocationMatchResult => ({ name, status: 'assigned', candidateObjectIds: [n],
  locationId: id(100 + n), bindingId: id(200 + n), reasonCode: null });
const missing = (name: string): ModelLocationMatchResult => ({ name, status: 'missing', candidateObjectIds: [],
  locationId: null, bindingId: null, reasonCode: 'MODEL_LOCATION_MISSING' });
async function summary() {
  const client = await summaryPool!.connect(), queries: string[] = [];
  const reader = { query: async (text: string, values?: unknown[]) => {
    queries.push(text); return client.query(text, values);
  } } as unknown as PoolClient;
  try { return { value: await readModelLocationMatchSummary(reader, context, () => undefined), queries }; }
  finally { client.release(); }
}

const workflowDdl = `
CREATE TABLE projects(id uuid PRIMARY KEY,pf_settings_revision bigint DEFAULT 0,connection_gap numeric DEFAULT 1,
 secondary_tray_length numeric DEFAULT 7,end_connection_length numeric DEFAULT 5,additional_bending_percent numeric DEFAULT 10);
CREATE TABLE users(id uuid PRIMARY KEY,is_admin boolean NOT NULL);
CREATE TABLE viewer_login_bindings(login_id uuid PRIMARY KEY,user_id uuid,expires_at timestamptz,revoked_at timestamptz);
CREATE TABLE project_model_selections(project_id uuid PRIMARY KEY,active_model_version_id uuid,selection_revision bigint DEFAULT 0);
CREATE TABLE model_versions(project_id uuid,id uuid,content_fingerprint text,state text,health text);
CREATE TABLE pf_project_state(project_id uuid PRIMARY KEY,registry_revision bigint DEFAULT 0);
CREATE TABLE pf_project_preparations(project_id uuid PRIMARY KEY,current_aggregate_id uuid,current_artifact_id uuid,geometry_revision bigint DEFAULT 0);
CREATE TABLE pf_purpose_project_state(project_id uuid PRIMARY KEY,catalog_revision bigint DEFAULT 0,routing_policy_revision bigint DEFAULT 0);
CREATE TABLE pf_recalculation_state(project_id uuid PRIMARY KEY,desired_generation bigint DEFAULT 0);
CREATE TABLE pf_barrier_heads(project_id uuid PRIMARY KEY,revision bigint,snapshot_id uuid);
CREATE TABLE pf_revision_comparison_targets(project_id uuid,target_aggregate_id uuid,target_model_version_id uuid,current_comparison_id uuid,
 comparison_revision bigint,decision_set_sha256 text);
CREATE TABLE cables(project_id uuid,id uuid PRIMARY KEY,cable_type_id uuid,cable_write_revision bigint DEFAULT 0,
 tag text,from_location text,to_location text,routing text,mto text,design_length numeric,install_length numeric);
CREATE TABLE cable_types(project_id uuid,id uuid,purpose text);
CREATE TABLE pf_revision_admissions(project_id uuid,id uuid PRIMARY KEY,job_id uuid,created_at timestamptz DEFAULT clock_timestamp());
CREATE TABLE pf_revision_baselines(project_id uuid,admission_id uuid,cable_id uuid,status text);
CREATE TABLE pf_jobs(project_id uuid,id uuid PRIMARY KEY,state text,cancel_requested boolean DEFAULT false);
CREATE TABLE pf_job_items(project_id uuid,job_id uuid,cable_id uuid,state text,status text);
CREATE TABLE pf_proposals(project_id uuid,id uuid PRIMARY KEY,job_id uuid,cable_id uuid,status text,proposal_hash text);
CREATE TABLE pf_automatic_pair_dispatch(project_id uuid,job_id uuid,cable_id uuid,status text,receipt_id uuid,reason_code text);
CREATE TABLE pf_location_aliases(project_id uuid,normalized_alias text,location_id uuid);
CREATE TABLE pf_locations(project_id uuid,id uuid,name text,revision bigint);
CREATE TABLE pf_location_bindings(project_id uuid,location_id uuid);
CREATE TABLE pf_apply_receipts(project_id uuid,cable_id uuid,applied_at timestamptz,id uuid,proposal_id uuid);
`;

describe.skipIf(!adminUrl)('saved result readers against an owned disposable PostgreSQL database', () => {
  beforeAll(async () => {
    const url = new URL(adminUrl!);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || url.pathname !== '/postgres' || !/^wfc_saved_results_[a-f0-9]{32}$/.test(database)) throw Error('Refuse nonlocal maintenance connection.');
    admin = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 5000, statement_timeout: 10000 });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`); created = true;
    url.pathname = '/' + database;
    control = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 5000, statement_timeout: 5000 });
    await control.connect();
    await control.query('CREATE TABLE public.pf_saved_results_fixture_owner(owner uuid PRIMARY KEY)');
    await control.query('INSERT INTO public.pf_saved_results_fixture_owner VALUES($1)', [owner]);
    await control.query(`CREATE SCHEMA "${summarySchema}"; CREATE SCHEMA "${workflowSchema}"`);
    summaryPool = new Pool({ connectionString: url.toString(), options: `-c search_path=${summarySchema},pg_catalog`, max: 2,
      connectionTimeoutMillis: 5000, query_timeout: 5000 });
    workflowPool = new Pool({ connectionString: url.toString(), options: `-c search_path=${workflowSchema},pg_catalog`, max: 2,
      connectionTimeoutMillis: 5000, query_timeout: 5000 });
    await summaryPool.query(`CREATE TABLE pf_endpoint_binding_commands(project_id uuid NOT NULL,actor_id uuid NOT NULL,
      idempotency_key uuid NOT NULL,kind text NOT NULL,request_sha256 text NOT NULL,request jsonb NOT NULL,
      receipt jsonb NOT NULL,created_at timestamptz NOT NULL,PRIMARY KEY(project_id,actor_id,idempotency_key))`);
    await workflowPool.query(workflowDdl);
  }, 30000);

  afterAll(async () => {
    await Promise.all([summaryPool?.end(), workflowPool?.end()]);
    try {
      if (created && control) {
        const identity = (await control.query('SELECT current_database() AS database,owner FROM public.pf_saved_results_fixture_owner')).rows;
        if (identity.length !== 1 || identity[0].database !== database || identity[0].owner !== owner
          || !/^wfc_saved_results_[a-f0-9]{32}$/.test(database)) throw Error('Refuse cleanup of an unverified database.');
        await control.end(); control = undefined;
        await admin!.query(`DROP DATABASE "${database}"`);
        expect((await admin!.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount).toBe(0);
      }
    } finally { await control?.end(); await admin?.end(); }
  }, 30000);

  it('uses actual JSONB latest-per-name scope, microseconds and deterministic actor ordering', async () => {
    await insertCommand(command(context.names, id(300)), context.names.map((name, n) => assigned(name, n + 1)), '2026-11-13T12:00:00.000001Z');
    await insertCommand(command(['FIRST'], id(301)), [missing('FIRST')], '2026-11-13T12:00:00.000002Z');
    // Same microsecond: the higher actor wins even when its key sorts lower.
    await insertCommand(command(['SECOND'], id(303)), [missing('SECOND')], '2026-11-13T12:00:00.000003Z', id(4));
    await insertCommand(command(['SECOND'], id(302)), [assigned('SECOND', 8)], '2026-11-13T12:00:00.000003Z', id(5));
    const oldScope = command(['FIRST'], id(304)); oldScope.current = { ...current, selectionRevision: '2' };
    await insertCommand(oldScope, [assigned('FIRST', 9)], '2026-11-13T12:00:00.000004Z');
    const oldNames = command(['THIRD'], id(305)); oldNames.namesSha256 = 'f'.repeat(64);
    await insertCommand(oldNames, [missing('THIRD')], '2026-11-13T12:00:00.000005Z');
    const result = await summary();
    expect(result.value).toMatchObject({ complete: true, counts: { searched: 3, found: 2, assigned: 2, manualAttention: 1 },
      results: [{ name: 'FIRST', status: 'missing' }, { name: 'SECOND', candidateObjectIds: [8] }, { name: 'THIRD', candidateObjectIds: [3] }] });
    expect(result.queries.filter(sql => sql.includes('summary-command'))).toHaveLength(3);
    expect(result.queries.every(sql => /^\/\* model-location-match:summary-(?:index|command) \*\/ SELECT/.test(sql))).toBe(true);
  });

  it('accepts real JSONB separator overhead while retaining the canonical request limit', async () => {
    await summaryPool!.query('TRUNCATE pf_endpoint_binding_commands');
    const value = command(['FIRST'], id(310)), first = value.scan.candidates[0];
    value.scan.indexedObjectCount = 4096;
    value.scan.propertyScan = { attemptedObjectCount: 4096, returnedObjectCount: 4096, omittedObjectCount: 0, complete: true };
    value.scan.candidates = Array.from({ length: 2216 }, (_, n) => ({ ...first, objectId: n + 1, name: 'X'.repeat(350) }));
    const result: ModelLocationMatchResult = { name: 'FIRST', status: 'ambiguous', candidateObjectIds: value.scan.candidates.map(c => c.objectId),
      locationId: null, bindingId: null, reasonCode: 'AMBIGUOUS_MODEL_CANDIDATES' };
    const saved = await insertCommand(value, [result], '2026-11-13T12:00:00Z');
    const canonicalBytes = Buffer.byteLength(canonicalPurposeJson(saved.request));
    const storedBytes = (await summaryPool!.query('SELECT octet_length(request::text) AS bytes FROM pf_endpoint_binding_commands')).rows[0].bytes;
    expect(canonicalBytes).toBeLessThanOrEqual(MODEL_LOCATION_MATCH_LIMITS.bodyBytes);
    expect(storedBytes).toBeGreaterThan(MODEL_LOCATION_MATCH_LIMITS.bodyBytes);
    expect(storedBytes).toBeLessThanOrEqual(2 * MODEL_LOCATION_MATCH_LIMITS.bodyBytes);
    expect((await summary()).value).toMatchObject({ complete: false, counts: { searched: 1, found: 1, assigned: 0, manualAttention: 1 },
      results: [{ name: 'FIRST', status: 'ambiguous', candidateObjectIds: result.candidateObjectIds }] });
    saved.request.command.scan.candidates[0].name += 'X'.repeat(2048 - 350);
    saved.request.command.scan.candidates.push(...Array.from({ length: 100 }, (_, n) => ({ ...first, objectId: n + 3000, name: 'Y'.repeat(350) })));
    expect(Buffer.byteLength(canonicalPurposeJson(saved.request))).toBeGreaterThan(MODEL_LOCATION_MATCH_LIMITS.bodyBytes);
    await summaryPool!.query('UPDATE pf_endpoint_binding_commands SET request=$1,request_sha256=$2', [saved.request, hash(saved.request)]);
    await expect(summary()).rejects.toMatchObject({ code: 'MODEL_LOCATION_MATCH_SUMMARY_LIMIT', status: 413 });
  }, 15000);

  it('selects the latest saved receipt before joining an exact project/cable proposal without falling back', async () => {
    const projectId = id(400), cableId = id(401), who = { userId: id(402), loginId: id(403), loginExpiresAt: Date.parse('2099-01-01T00:00:00Z') };
    await workflowPool!.query('INSERT INTO projects(id) VALUES($1)', [projectId]);
    await workflowPool!.query('INSERT INTO users VALUES($1,true)', [who.userId]);
    await workflowPool!.query('INSERT INTO viewer_login_bindings VALUES($1,$2,$3,NULL)', [who.loginId, who.userId, new Date(who.loginExpiresAt)]);
    await workflowPool!.query("INSERT INTO cables VALUES($1,$2,$3,7,'SAVED','FROM','TO','/SAVED','LV',58,60)", [projectId, cableId, id(404)]);
    await workflowPool!.query("INSERT INTO cable_types VALUES($1,$2,'Control')", [projectId, id(404)]);
    for (const [name, locationId] of [['FROM', id(405)], ['TO', id(406)]]) {
      await workflowPool!.query('INSERT INTO pf_location_aliases VALUES($1,$2,$3)', [projectId, name, locationId]);
      await workflowPool!.query('INSERT INTO pf_locations VALUES($1,$2,$3,1)', [projectId, locationId, name]);
    }
    await workflowPool!.query("INSERT INTO pf_jobs VALUES($1,$2,'failed',false)", [projectId, id(410)]);
    await workflowPool!.query("INSERT INTO pf_revision_admissions VALUES($1,$2,$3,'2026-11-13T13:00:00Z')", [projectId, id(411), id(410)]);
    await workflowPool!.query("INSERT INTO pf_revision_baselines VALUES($1,$2,$3,'ready')", [projectId, id(411), cableId]);
    await workflowPool!.query("INSERT INTO pf_job_items VALUES($1,$2,$3,'blocked','failed')", [projectId, id(410), cableId]);
    const insertProposal = async (proposalId: string, jobId: string, otherProject = projectId, otherCable = cableId) =>
      workflowPool!.query("INSERT INTO pf_proposals VALUES($1,$2,$3,$4,'calculated',$5)", [otherProject, proposalId, jobId, otherCable, 'd'.repeat(64)]);
    const insertReceipt = async (receiptId: string, proposalId: string, time: string, otherProject = projectId, otherCable = cableId) =>
      workflowPool!.query('INSERT INTO pf_apply_receipts VALUES($1,$2,$3,$4,$5)', [otherProject, otherCable, time, receiptId, proposalId]);
    await insertProposal(id(420), id(421)); await insertProposal(id(422), id(423));
    await insertReceipt(id(450), id(420), '2026-11-13T12:00:00.000001Z');
    await insertReceipt(id(440), id(422), '2026-11-13T12:00:00.000002Z');
    // A newer foreign project/cable receipt must not enter the exact selection.
    await insertReceipt(id(460), id(420), '2026-11-13T12:00:00.000009Z', id(499));
    await insertReceipt(id(461), id(420), '2026-11-13T12:00:00.000009Z', projectId, id(498));
    const queries: string[] = [];
    const readPool = { connect: async () => {
      const client = await workflowPool!.connect();
      return { query: async (text: string, values?: unknown[]) => { queries.push(text); return client.query(text, values); },
        release: (discard?: boolean) => client.release(discard) } as unknown as PoolClient;
    } } as Pool;
    const repository = createCableWorkflowRepository(readPool, { cursorKey: Buffer.alloc(32, 42) });
    const read = async () => { queries.length = 0; proof.accepted.mockClear(); return (await repository.detail(projectId, who, cableId, {})).row; };
    proof.accepted.mockResolvedValue(true); proof.savedExactDisplay.mockResolvedValue(false);
    expect((await read()).savedRoute).toEqual({ receiptId: id(440), jobId: id(423), proposalId: id(422), proposalHash: 'd'.repeat(64), currentness: 'current' });
    expect(queries.filter(sql => sql.includes('saved-route-identity'))).toHaveLength(1);
    expect(queries.some(sql => /^\s*(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(sql))).toBe(false);
    await insertReceipt(id(441), id(420), '2026-11-13T12:00:00.000002Z');
    proof.accepted.mockResolvedValue(false); proof.savedExactDisplay.mockResolvedValue(true);
    expect((await read()).savedRoute).toMatchObject({ receiptId: id(441), jobId: id(421), proposalId: id(420), currentness: 'saved-exact' });
    // Latest receipt has no same-project/cable proposal. The LEFT JOIN must not
    // choose an older valid receipt, nor a foreign proposal with the same id.
    await insertProposal(id(470), id(471), id(499));
    await insertReceipt(id(472), id(470), '2026-11-13T12:00:00.000003Z');
    const row = await read();
    expect(row.savedRoute).toBeUndefined();
    expect(row.calculation).toMatchObject({ jobId: id(410), jobStatus: 'failed', outcome: 'failed', acceptedMatchesCurrent: false });
    expect(proof.accepted).not.toHaveBeenCalled();
  }, 15000);
});
