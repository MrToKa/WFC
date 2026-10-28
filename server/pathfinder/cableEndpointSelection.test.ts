// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { canonicalPurposeJson } from '../../shared/pathfinderPurposePolicy.js';
import { type GeometryObjectRevision, type GeometryTraceManifest } from '../../shared/pathfinderGeometryTrace.js';
import { geometryTraceFixture } from './geometryTraceFixtures.js';
import { buildGeometryTrace, geometryTraceHash } from './geometryTraceBuilder.js';
import { CABLE_ENDPOINT_SELECTION_LIMITS, readCableEndpointSelection } from './cableEndpointSelection.js';

const id = (n: number) => `ca000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
type Data = Record<string, unknown>;
function fixture() {
  const input = geometryTraceFixture(), built = buildGeometryTrace(input), record = built.records[2];
  const current = { modelVersionId: input.aggregate.modelVersionId, selectionRevision: input.aggregate.selectionRevision,
    contentFingerprint: input.aggregate.contentFingerprint, aggregateId: input.aggregate.id, artifactId: input.aggregate.artifactId,
    projectionSha256: input.aggregate.projection.sha256, captureFrameId: input.aggregate.coordinateFrameId,
    geometryRevision: input.aggregate.geometryRevision, traceId: input.traceId };
  const scope: Data = { active_model_version_id: current.modelVersionId, selection_revision: current.selectionRevision,
    content_fingerprint: current.contentFingerprint, state: 'ready', health: 'healthy', current_aggregate_id: current.aggregateId,
    current_artifact_id: current.artifactId, geometry_revision: current.geometryRevision, snapshot_sha256: current.projectionSha256, artifact_content_fingerprint: current.contentFingerprint,
    session_id: input.aggregate.sessionId, aggregate_model_version_id: current.modelVersionId, aggregate_artifact_id: current.artifactId,
    aggregate_geometry_revision: current.geometryRevision, aggregate_selection_revision: current.selectionRevision,
    aggregate_content_fingerprint: current.contentFingerprint, aggregate_projection_sha256: current.projectionSha256,
    aggregate_capture_frame_id: current.captureFrameId, trace_id: current.traceId, trace_aggregate_id: current.aggregateId,
    trace_model_version_id: current.modelVersionId, manifest: built.manifest };
  const state = { scopes: [scope], candidates: [{ object_id: record.identity.objectId, db_id: record.identity.dbId,
    geometry_role: record.geometry.role, visibility: 'unknown' } as Data], records: [{ id: record.id, project_id: record.projectId,
    trace_id: record.traceId, object_id: record.identity.objectId, record, record_sha256: geometryTraceHash(record) } as Data],
    onQuery: (_sql: string) => {} };
  const query = vi.fn(async (sql: string, _values?: unknown[]) => {
    state.onQuery(sql);
    if (sql.includes('cable-endpoint-selection:scope')) return { rows: state.scopes };
    if (sql.includes('cable-endpoint-selection:objects')) return { rows: state.candidates };
    if (sql.includes('cable-endpoint-selection:record')) return { rows: state.records };
    throw new Error('Unexpected selection read.');
  });
  const client = { query } as unknown as PoolClient, check = vi.fn();
  const request = { projectId: input.aggregate.projectId, current, sdkObjectId: 5 };
  const setRecord = (value: GeometryObjectRevision) => { state.records[0].record = value; state.records[0].record_sha256 = geometryTraceHash(value); };
  const setTrace = (value: GeometryTraceManifest) => {
    const { contentSha256: _hash, ...body } = value; state.scopes[0].manifest = { ...value, contentSha256: geometryTraceHash(body) };
  };
  return { input, built, state, request, record, query, check, client, setRecord, setTrace,
    run: () => readCableEndpointSelection(client, request, check) };
}
async function expectUnavailable(f: ReturnType<typeof fixture>, reason: string, status = 'unavailable') {
  const result = await f.run();
  expect(result).toMatchObject({ status, reasonCodes: [reason], object: null, pointProjectMetres: null, bounds: null, derivation: null, approximate: true });
  return result;
}

describe('exact current SDK selection and immutable endpoint evidence', () => {
  it('returns only a server-derived approximate anchor with exact retained object proof', async () => {
    const f = fixture(), result = await f.run();
    expect(result).toMatchObject({ schemaVersion: 'wfc.pf.cable-endpoint-selection.v1', projectId: f.request.projectId,
      current: f.request.current, sdkObjectId: 5, status: 'available', reasonCodes: [],
      object: { traceId: f.request.current.traceId, objectRevisionId: f.record.id, recordSha256: geometryTraceHash(f.record) },
      pointProjectMetres: [21, 3, 1], bounds: f.record.geometry.bounds, approximate: true, derivation: 'equipment-bottom-aabb.v1' });
    expect(result).not.toHaveProperty('record'); expect(result).not.toHaveProperty('engineeringAccepted');
    expect(f.query).toHaveBeenCalledTimes(3); expect(f.check).toHaveBeenCalledTimes(5);
    const calls = f.query.mock.calls;
    expect(calls[0][1]).toEqual([f.request.projectId, f.request.current.traceId, CABLE_ENDPOINT_SELECTION_LIMITS.traceBytes]);
    expect(calls[1][1]).toEqual([f.request.projectId, f.request.current.artifactId, 5]);
    expect(calls[2][1]).toEqual([f.request.projectId, f.request.current.traceId, f.record.identity.objectId, CABLE_ENDPOINT_SELECTION_LIMITS.objectBytes]);
    expect(calls.every(([sql]) => /^\/\* cable-endpoint-selection:[a-z]+ \*\/ SELECT/.test(sql) && sql.includes('LIMIT 2') && sql.includes('FOR SHARE'))).toBe(true);
    expect(calls.map(([sql]) => sql).join('\n')).not.toMatch(/\b(?:INSERT|DELETE|CREATE|ALTER|SET|COMMIT|ROLLBACK)\b|\bUPDATE\s+\w+\s+SET/i);
    expect(calls[0][0]).toContain('CASE WHEN octet_length(t.manifest::text)<=$3');
    expect(calls[2][0]).toContain('CASE WHEN octet_length(record::text)<=$4');
  });

  it('finds a retained object beyond every displayed page using its SDK integer, including a custom object identifier', async () => {
    const f = fixture(), objectId = 'external-equipment:consumer-50000'; f.request.sdkObjectId = 50000;
    f.state.candidates[0] = { ...f.state.candidates[0], object_id: objectId, db_id: 50000 };
    const identity = { ...f.record.identity, objectId, dbId: 50000 };
    f.setRecord({ ...f.record, identity, geometry: { ...f.record.geometry, mesh: { ...f.record.geometry.mesh, objectId } },
      signatures: { ...f.record.signatures, identityEvidenceSha256: geometryTraceHash(identity) } });
    f.state.records[0].object_id = objectId;
    expect(await f.run()).toMatchObject({ status: 'available', sdkObjectId: 50000, pointProjectMetres: [21, 3, 1] });
    expect(f.query.mock.calls[1][0]).toContain('artifact_id=$2 AND db_id=$3');
    expect(f.query.mock.calls[1][1]).toEqual([f.request.projectId, f.request.current.artifactId, 50000]);
    expect(f.query.mock.calls[2][1]?.[2]).toBe(objectId);
    expect(f.query.mock.calls.some(([sql]) => /\bOFFSET\b|LIMIT (?:25|100)\b|\bname\s*=/.test(sql))).toBe(false);
  });

  it('does not invent a trace or point for an unprepared current selection', async () => {
    const f = fixture(); f.request.current.traceId = null as unknown as string;
    await expectUnavailable(f, 'CURRENT_GEOMETRY_TRACE_REQUIRED'); expect(f.query).not.toHaveBeenCalled();
  });
  it.each([0, -1, 1.5, 2147483648, NaN, Infinity])('rejects invalid SDK dbId %s before querying', async sdkObjectId => {
    const f = fixture(); f.request.sdkObjectId = sdkObjectId;
    await expect(f.run()).rejects.toThrow(); expect(f.query).not.toHaveBeenCalled();
  });
  it.each(['active_model_version_id', 'selection_revision', 'content_fingerprint', 'state', 'health', 'current_aggregate_id', 'current_artifact_id',
    'geometry_revision', 'snapshot_sha256', 'artifact_content_fingerprint', 'aggregate_model_version_id', 'aggregate_artifact_id', 'aggregate_geometry_revision',
    'aggregate_selection_revision', 'aggregate_content_fingerprint', 'aggregate_projection_sha256', 'aggregate_capture_frame_id',
    'trace_id', 'trace_aggregate_id', 'trace_model_version_id'])('rejects changed live publication identity %s before looking up an object', async field => {
    const f = fixture(); f.state.scopes[0][field] = 'changed';
    await expectUnavailable(f, 'CURRENT_GEOMETRY_SCOPE_CHANGED'); expect(f.query).toHaveBeenCalledTimes(1);
  });
  it.each([0, 2])('refuses a missing or ambiguous live scope (%s rows)', async count => {
    const f = fixture(); f.state.scopes = Array.from({ length: count }, () => f.state.scopes[0]);
    await expectUnavailable(f, 'CURRENT_GEOMETRY_SCOPE_UNAVAILABLE'); expect(f.query).toHaveBeenCalledTimes(1);
  });
  it.each(['missing', 'oversize'] as const)('does not transfer or accept a %s trace manifest', async kind => {
    const f = fixture(); f.state.scopes[0].manifest = kind === 'missing' ? null : { payload: 'x'.repeat(CABLE_ENDPOINT_SELECTION_LIMITS.traceBytes) };
    await expectUnavailable(f, 'CURRENT_GEOMETRY_TRACE_LIMIT'); expect(f.query).toHaveBeenCalledTimes(1);
  });
  it.each(['hash', 'project', 'session', 'frame', 'geometry', 'projection'] as const)('rejects mismatched immutable trace %s', async kind => {
    const f = fixture(), trace = structuredClone(f.built.manifest);
    if (kind === 'hash') f.state.scopes[0].manifest = { ...trace, contentSha256: '0'.repeat(64) };
    else { if (kind === 'project') trace.projectId = id(90); if (kind === 'session') trace.sessionId = id(90);
      if (kind === 'frame') trace.captureFrameId = id(90); if (kind === 'geometry') trace.geometryRevision = '9';
      if (kind === 'projection') trace.projection.sha256 = '0'.repeat(64); f.setTrace(trace); }
    await expectUnavailable(f, 'CURRENT_GEOMETRY_TRACE_INVALID'); expect(f.query).toHaveBeenCalledTimes(1);
  });
  it('keeps absent SDK inventory and absent retained geometry distinct without fabricating coordinates', async () => {
    const f = fixture(); f.state.candidates = []; await expectUnavailable(f, 'SDK_OBJECT_NOT_RETAINED'); expect(f.query).toHaveBeenCalledTimes(2);
    const g = fixture(); g.state.records = []; await expectUnavailable(g, 'SDK_OBJECT_GEOMETRY_NOT_RETAINED');
  });
  it.each(['candidates', 'records'] as const)('rejects duplicate %s rather than selecting the first valid row', async table => {
    const f = fixture(); f.state[table] = [f.state[table][0], f.state[table][0]];
    await expectUnavailable(f, table === 'candidates' ? 'SDK_OBJECT_ID_AMBIGUOUS' : 'SDK_OBJECT_EVIDENCE_AMBIGUOUS', 'ambiguous');
  });
  it.each(['hierarchy', 'routing-leaf', 'hidden'] as const)('retains honest unsupported %s selection without promoting a parent or tray into equipment', async kind => {
    const f = fixture(); if (kind === 'hidden') f.state.candidates[0].visibility = 'hidden'; else f.state.candidates[0].geometry_role = kind;
    await expectUnavailable(f, kind === 'hidden' ? 'SDK_OBJECT_HIDDEN' : 'SDK_OBJECT_EQUIPMENT_GEOMETRY_REQUIRED', 'unsupported');
    expect(f.query).toHaveBeenCalledTimes(2);
  });
  it.each(['null', 'oversize'] as const)('returns unavailable for %s geometry without returning any record body', async kind => {
    const f = fixture(); f.state.records[0].record = kind === 'null' ? null : { payload: 'x'.repeat(CABLE_ENDPOINT_SELECTION_LIMITS.objectBytes) };
    await expectUnavailable(f, 'SDK_OBJECT_EVIDENCE_LIMIT');
  });
  it.each(['hash', 'project', 'trace', 'model', 'aggregate', 'dbId', 'objectId', 'frame', 'fingerprint', 'projection', 'session', 'mesh', 'fitted', 'identity-signature', 'catalog-signature'] as const)(
    'rejects stale, foreign or inconsistent record %s even after a matching record hash', async kind => {
      const f = fixture(), record = structuredClone(f.record);
      if (kind === 'hash') { f.state.records[0].record_sha256 = '0'.repeat(64); }
      else {
        if (kind === 'project') record.projectId = id(90); if (kind === 'trace') record.traceId = id(90);
        if (kind === 'model') record.modelVersionId = id(90); if (kind === 'aggregate') record.aggregateId = id(90);
        if (kind === 'dbId') record.identity.dbId = 6; if (kind === 'objectId') record.identity.objectId = 'other';
        if (kind === 'frame') record.coordinates.captureFrameId = id(90); if (kind === 'fingerprint') record.provenance.contentFingerprint = '0'.repeat(64);
        if (kind === 'projection') record.provenance.projectionSha256 = '0'.repeat(64); if (kind === 'session') record.provenance.sessionId = id(90);
        if (kind === 'mesh') record.geometry.mesh.projection.sha256 = '0'.repeat(64); if (kind === 'fitted') record.provenance.fittedTraceSha256 = '0'.repeat(64);
        if (kind === 'identity-signature') record.signatures.identityEvidenceSha256 = '0'.repeat(64); if (kind === 'catalog-signature') record.signatures.policySha256 = '0'.repeat(64);
        f.setRecord(record);
      }
      await expectUnavailable(f, 'SDK_OBJECT_EVIDENCE_SCOPE_INVALID');
    });
  it.each(['units', 'matrix', 'finite', 'bounds', 'world-frame', 'transforms'] as const)('does not accept invalid %s geometry', async kind => {
    const f = fixture(), record = structuredClone(f.record);
    if (kind === 'units') record.coordinates.metresPerSourceUnit = -1;
    if (kind === 'matrix') record.coordinates.displayToWorldMetres[0] = Infinity;
    if (kind === 'finite') record.geometry.bounds.minimum[0] = NaN;
    if (kind === 'bounds') record.geometry.bounds.minimum[0] = record.geometry.bounds.maximum[0] + 1;
    if (kind === 'world-frame') Object.assign(record.coordinates, { vertexFrame: 'object-local' });
    if (kind === 'transforms') Object.assign(record.coordinates, { transformsAlreadyApplied: false });
    // Nonfinite values cannot be given a canonical retained-record hash.
    if (kind === 'matrix' || kind === 'finite') f.state.records[0].record = record; else f.setRecord(record);
    await expectUnavailable(f, 'SDK_OBJECT_EVIDENCE_INVALID');
  });
  it('does not accept a mismatched producer or an altered retained anchor', async () => {
    const f = fixture(), record = structuredClone(f.record); record.provenance.engine.version = 'different'; f.setRecord(record);
    await expectUnavailable(f, 'SDK_OBJECT_PRODUCER_INVALID');
    const g = fixture(), other = structuredClone(g.record); other.geometry.equipmentAnchor!.pointMetres[0]++;
    g.setRecord(other); await expectUnavailable(g, 'SDK_OBJECT_ANCHOR_INVALID');
  });
  it('propagates cancellation/authority checks without catching them as missing geometry', async () => {
    const f = fixture(), reason = new Error('Synthetic authority revoked during selection read.');
    f.state.onQuery = () => { f.check.mockImplementation(() => { throw reason; }); };
    await expect(f.run()).rejects.toBe(reason); expect(f.query).toHaveBeenCalledTimes(1);
  });
  it('never receives SDK bounds or a requested point as authority inputs', async () => {
    const f = fixture(), original = canonicalPurposeJson(f.record.geometry.bounds), result = await readCableEndpointSelection(f.client,
      { ...f.request, bottomCentre: [999, 999, 999], bounds: { minimum: [999, 999, 999], maximum: [1000, 1000, 1000] } } as typeof f.request, f.check);
    expect(result.pointProjectMetres).toEqual([21, 3, 1]); expect(canonicalPurposeJson(result.bounds)).toBe(original);
  });
});
