// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { canonicalPurposeJson } from '../../shared/pathfinderPurposePolicy.js';
import { geometryObjectComputationalHashInput, geometryTraceContentHashInput } from '../../shared/pathfinderGeometryTrace.js';
import { geometryTraceFixture } from './geometryTraceFixtures.js';
import { buildGeometryTrace, geometryTraceBytesHash, geometryTraceHash, objectRevisionId } from './geometryTraceBuilder.js';
import { CABLE_ENDPOINT_SELECTION_INDEX_SQL } from './cableEndpointSelectionSchema.js';
import { CABLE_ENDPOINT_SELECTION_LIMITS, readCableEndpointSelection } from './cableEndpointSelection.js';

// Actual PostgreSQL selection/projection/index slice only. This internal reader
// requires its caller to hold current principal/project locks; these tests do
// not establish route authorization, binding writes or native geometry parity.
const fixturePath = process.env.PF_U2_SQL_FIXTURE;
const id = (n: number) => `ca100000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let pool: Pool;
const queries: Array<{ text: string; values?: unknown[]; records?: unknown[] }> = [];
const schema = `
CREATE TABLE projects(id uuid PRIMARY KEY);
CREATE TABLE project_model_selections(project_id uuid PRIMARY KEY REFERENCES projects(id),active_model_version_id uuid,selection_revision bigint);
CREATE TABLE model_versions(project_id uuid REFERENCES projects(id),id uuid,content_fingerprint text,state text,health text,PRIMARY KEY(project_id,id));
CREATE TABLE pf_project_preparations(project_id uuid PRIMARY KEY REFERENCES projects(id),current_aggregate_id uuid,current_artifact_id uuid,geometry_revision bigint);
CREATE TABLE pf_preparation_aggregates(id uuid PRIMARY KEY,project_id uuid REFERENCES projects(id),session_id uuid,model_version_id uuid,
 artifact_id uuid,geometry_revision bigint,manifest jsonb NOT NULL,UNIQUE(project_id,id));
CREATE TABLE pf_artifacts(project_id uuid REFERENCES projects(id),id uuid,model_version_id uuid,snapshot_sha256 text,content_fingerprint text,PRIMARY KEY(project_id,id));
CREATE TABLE pf_geometry_trace_sets(id uuid PRIMARY KEY,project_id uuid REFERENCES projects(id),aggregate_id uuid,model_version_id uuid,manifest jsonb NOT NULL,
 UNIQUE(project_id,id),FOREIGN KEY(project_id,aggregate_id) REFERENCES pf_preparation_aggregates(project_id,id));
CREATE TABLE pf_model_objects(project_id uuid,artifact_id uuid,object_id text,db_id integer,geometry_role text,visibility text,
 PRIMARY KEY(project_id,artifact_id,object_id),FOREIGN KEY(project_id,artifact_id) REFERENCES pf_artifacts(project_id,id));
CREATE TABLE pf_geometry_object_revisions(id uuid PRIMARY KEY,project_id uuid,trace_id uuid,object_id text,summary jsonb NOT NULL,record jsonb NOT NULL,
 UNIQUE(project_id,trace_id,object_id),FOREIGN KEY(project_id,trace_id) REFERENCES pf_geometry_trace_sets(project_id,id));
`;

function syntheticSelection(customIdentity = false) {
  const input = geometryTraceFixture(), built = buildGeometryTrace(input);
  if (customIdentity) {
    // Exercise the allowed version-local identity surface independently of the
    // current preparer's dbid-prefixed producer. Geometry still comes from the
    // real synthetic builder; record/index/blob hashes are closed again here.
    const record = built.records[2], objectId = 'external-equipment:consumer-50000';
    record.id = objectRevisionId(input.traceId, objectId);
    record.identity = { ...record.identity, objectId, dbId: 50000 };
    record.geometry.mesh.objectId = objectId;
    record.signatures.identityEvidenceSha256 = geometryTraceHash(record.identity);
    built.summaries[2] = { ...built.summaries[2], id: record.id, objectId,
      computationalSha256: geometryTraceHash(geometryObjectComputationalHashInput(record)), recordSha256: geometryTraceHash(record) };
    const bytes = Buffer.from(canonicalPurposeJson(built.records));
    built.manifest.objectRecords = { ...built.manifest.objectRecords, bytes: bytes.length, sha256: geometryTraceBytesHash(bytes) };
    built.manifest.objectIndexSha256 = geometryTraceHash(built.summaries);
    built.manifest.computationalSha256 = geometryTraceHash({ projectionSha256: input.aggregate.projection.sha256,
      fittedTraceSha256: input.fittedBlob.sha256, signaturePolicyVersion: built.manifest.signaturePolicyVersion,
      objects: built.summaries.map(({ objectId: key, computationalSha256 }) => ({ objectId: key, computationalSha256 })) });
    built.manifest.contentSha256 = geometryTraceHash(geometryTraceContentHashInput(built.manifest));
  }
  const current = { modelVersionId: input.aggregate.modelVersionId, selectionRevision: input.aggregate.selectionRevision,
    contentFingerprint: input.aggregate.contentFingerprint, aggregateId: input.aggregate.id, artifactId: input.aggregate.artifactId,
    projectionSha256: input.aggregate.projection.sha256, captureFrameId: input.aggregate.coordinateFrameId,
    geometryRevision: input.aggregate.geometryRevision, traceId: input.traceId };
  return { input, built, record: built.records[2], request: { projectId: input.aggregate.projectId, current, sdkObjectId: customIdentity ? 50000 : 5 } };
}
type SyntheticSelection = ReturnType<typeof syntheticSelection>;
let sample: SyntheticSelection;

async function seed(value = syntheticSelection()) {
  const { input, built, request } = value, { projectId, current } = request;
  await pool.query('INSERT INTO projects VALUES($1)', [projectId]);
  await pool.query('INSERT INTO project_model_selections VALUES($1,$2,$3)', [projectId, current.modelVersionId, current.selectionRevision]);
  await pool.query("INSERT INTO model_versions VALUES($1,$2,$3,'ready','healthy')", [projectId, current.modelVersionId, current.contentFingerprint]);
  await pool.query('INSERT INTO pf_artifacts VALUES($1,$2,$3,$4,$5)', [projectId, current.artifactId, current.modelVersionId, current.projectionSha256, current.contentFingerprint]);
  await pool.query('INSERT INTO pf_preparation_aggregates VALUES($1,$2,$3,$4,$5,$6,$7)', [current.aggregateId, projectId, input.aggregate.sessionId,
    current.modelVersionId, current.artifactId, current.geometryRevision, input.aggregate]);
  await pool.query('INSERT INTO pf_project_preparations VALUES($1,$2,$3,$4)', [projectId, current.aggregateId, current.artifactId, current.geometryRevision]);
  await pool.query('INSERT INTO pf_geometry_trace_sets VALUES($1,$2,$3,$4,$5)', [current.traceId, projectId, current.aggregateId, current.modelVersionId, built.manifest]);
  for (const [at, record] of built.records.entries()) {
    await pool.query("INSERT INTO pf_model_objects VALUES($1,$2,$3,$4,$5,'unknown')", [projectId, current.artifactId, record.identity.objectId, record.identity.dbId, record.geometry.role]);
    await pool.query('INSERT INTO pf_geometry_object_revisions VALUES($1,$2,$3,$4,$5,$6)', [record.id, projectId, current.traceId, record.identity.objectId, built.summaries[at], record]);
  }
  queries.length = 0;
  return value;
}
async function read(value = sample) {
  const client = await pool.connect(), deadline = Date.now() + 15_000;
  const check = () => { if (Date.now() > deadline) throw new Error('Synthetic SQL selection deadline exceeded.'); };
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    await client.query("SET LOCAL lock_timeout='1000ms';SET LOCAL statement_timeout='3000ms'");
    const reader = { query: async (text: string, values?: unknown[]) => {
      const result = await client.query(text, values); queries.push({ text, values, records: result.rows }); return result;
    } } as unknown as PoolClient;
    const result = await readCableEndpointSelection(reader, value.request, check);
    await client.query('COMMIT'); return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
async function reset() {
  // Every table is explicitly owned by this test's guarded disposable schema.
  await pool.query('TRUNCATE pfu2_validation.projects CASCADE');
}

describe.runIf(Boolean(fixturePath))('PF-U2 actual SQL exact SDK selection in an explicitly owned fixture', () => {
  beforeAll(async () => {
    const config = JSON.parse(await readFile(fixturePath!, 'utf8')) as { database: string; url: string; owner: string };
    if (!/^wfc_pfu2_[a-f0-9_]+$/.test(config.database) || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(config.owner))
      throw new Error('Refuse a nonfixture database or ownership capability.');
    const url = new URL(config.url);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || decodeURIComponent(url.pathname.slice(1)) !== config.database) throw new Error('Refuse a nonlocal or mismatched fixture URL.');
    pool = new Pool({ connectionString: config.url, options: '-c search_path=pfu2_validation,pg_catalog', max: 2, connectionTimeoutMillis: 3000, query_timeout: 5000 });
    const identity = (await pool.query('SELECT current_database() AS db,owner FROM public.pfu2_fixture_owner')).rows;
    if (identity.length !== 1 || identity[0].db !== config.database || identity[0].owner !== config.owner) throw new Error('Fixture ownership mismatch before schema creation.');
    // A preexisting schema is refused rather than overwritten. Root owns the
    // complete new disposable fixture and its later retirement.
    await pool.query('CREATE SCHEMA pfu2_validation');
    await pool.query(schema);
    await pool.query(CABLE_ENDPOINT_SELECTION_INDEX_SQL);
  });
  beforeEach(async () => { await reset(); sample = await seed(); });
  afterAll(async () => { await pool?.end(); });

  it('runs all three actual bounded SELECT projections and returns a genuine builder anchor', async () => {
    const result = await read();
    expect(result).toMatchObject({ status: 'available', sdkObjectId: 5, pointProjectMetres: [21, 3, 1],
      bounds: sample.record.geometry.bounds, object: { objectRevisionId: sample.record.id, recordSha256: geometryTraceHash(sample.record) } });
    expect(queries).toHaveLength(3);
    expect(queries.every(value => /^\/\* cable-endpoint-selection:[a-z]+ \*\/ SELECT/.test(value.text) && value.text.includes('LIMIT 2'))).toBe(true);
    expect(queries.map(value => value.text).join('\n')).not.toMatch(/\b(?:INSERT|DELETE|CREATE|ALTER|DROP)\b|\bUPDATE\s+\w+\s+SET/i);
    const index = (await pool.query("SELECT indexdef FROM pg_indexes WHERE schemaname='pfu2_validation' AND indexname='pf_model_object_sdk'")).rows;
    expect(index).toHaveLength(1); expect(index[0].indexdef).toContain('(project_id, artifact_id, db_id, object_id)');
  });
  it('uses the actual SDK index for a custom retained object beyond one thousand earlier inventory rows', async () => {
    await reset(); sample = await seed(syntheticSelection(true));
    await pool.query(`INSERT INTO pf_model_objects(project_id,artifact_id,object_id,db_id,geometry_role,visibility)
      SELECT $1,$2,'earlier-'||n::text,n,'hierarchy','unknown' FROM generate_series(1000,2000) AS n`,
    [sample.request.projectId, sample.request.current.artifactId]);
    const result = await read(); expect(result).toMatchObject({ status: 'available', sdkObjectId: 50000, pointProjectMetres: [21, 3, 1] });
    expect(queries[1].values).toEqual([sample.request.projectId, sample.request.current.artifactId, 50000]);
    const client = await pool.connect();
    try {
      await client.query('BEGIN'); await client.query('SET LOCAL enable_seqscan=off');
      const plan = await client.query('EXPLAIN (FORMAT JSON) SELECT object_id FROM pf_model_objects WHERE project_id=$1 AND artifact_id=$2 AND db_id=$3 ORDER BY object_id LIMIT 2',
        [sample.request.projectId, sample.request.current.artifactId, 50000]);
      expect(JSON.stringify(plan.rows)).toContain('pf_model_object_sdk'); await client.query('ROLLBACK');
    } finally { client.release(); }
  });
  it('rejects duplicate SDK integers before reading either candidate geometry', async () => {
    await pool.query("INSERT INTO pf_model_objects VALUES($1,$2,'duplicate-sdk-5',5,'object','unknown')", [sample.request.projectId, sample.request.current.artifactId]);
    expect(await read()).toMatchObject({ status: 'ambiguous', reasonCodes: ['SDK_OBJECT_ID_AMBIGUOUS'], object: null, pointProjectMetres: null });
    expect(queries).toHaveLength(2);
  });
  it.each(['model', 'frame'] as const)('refuses an actual stale %s publication without guessing a point', async kind => {
    if (kind === 'model') await pool.query('UPDATE model_versions SET content_fingerprint=$2 WHERE project_id=$1', [sample.request.projectId, '0'.repeat(64)]);
    else await pool.query("UPDATE pf_preparation_aggregates SET manifest=jsonb_set(manifest,'{coordinateFrameId}',$2::jsonb) WHERE project_id=$1",
      [sample.request.projectId, JSON.stringify(id(99))]);
    expect(await read()).toMatchObject({ status: 'unavailable', reasonCodes: ['CURRENT_GEOMETRY_SCOPE_CHANGED'], object: null, pointProjectMetres: null });
    expect(queries).toHaveLength(1);
  });
  it('rejects a wrong retained record hash on actual JSONB instead of accepting its valid-looking box', async () => {
    await pool.query("UPDATE pf_geometry_object_revisions SET summary=jsonb_set(summary,'{recordSha256}',$2::jsonb) WHERE id=$1", [sample.record.id, JSON.stringify('0'.repeat(64))]);
    expect(await read()).toMatchObject({ status: 'unavailable', reasonCodes: ['SDK_OBJECT_EVIDENCE_SCOPE_INVALID'], object: null, pointProjectMetres: null });
  });
  it('suppresses an oversized JSONB record inside SQL before transfer to the selection reader', async () => {
    await pool.query("UPDATE pf_geometry_object_revisions SET record=jsonb_build_object('oversized',$2::text) WHERE id=$1",
      [sample.record.id, 'x'.repeat(CABLE_ENDPOINT_SELECTION_LIMITS.objectBytes)]);
    expect(await read()).toMatchObject({ status: 'unavailable', reasonCodes: ['SDK_OBJECT_EVIDENCE_LIMIT'], object: null, pointProjectMetres: null });
    expect(queries.at(-1)?.records?.[0]).toMatchObject({ record: null });
  });
  it.each(['hierarchy', 'hidden'] as const)('does not turn an actual %s SDK inventory row into equipment evidence', async kind => {
    const column = kind === 'hidden' ? 'visibility' : 'geometry_role';
    await pool.query(`UPDATE pf_model_objects SET ${column}=$3 WHERE project_id=$1 AND artifact_id=$2 AND db_id=5`,
      [sample.request.projectId, sample.request.current.artifactId, kind]);
    expect(await read()).toMatchObject({ status: 'unsupported', object: null, pointProjectMetres: null, bounds: null, derivation: null });
    expect(queries).toHaveLength(2);
  });
});
