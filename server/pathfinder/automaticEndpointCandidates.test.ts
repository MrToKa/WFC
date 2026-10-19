// @vitest-environment node
import type { PoolClient } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readAutomaticEndpointCandidates } from './automaticEndpointCandidates.js';
import { geometryTraceFixture } from './geometryTraceFixtures.js';
import { buildGeometryTrace, geometryTraceHash } from './geometryTraceBuilder.js';
import { automaticEndpointContentHash } from './endpointCalculationProvenance.js';
import { RECALCULATION_LIMITS } from '../../shared/pathfinderRecalculation.js';

const id = (n: number) => `af000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function fixture() {
  const input = geometryTraceFixture(), built = buildGeometryTrace(input), object = built.records[2];
  const current = { modelVersionId: input.aggregate.modelVersionId, selectionRevision: input.aggregate.selectionRevision,
    contentFingerprint: input.aggregate.contentFingerprint, aggregateId: input.aggregate.id, artifactId: input.aggregate.artifactId,
    projectionSha256: input.aggregate.projection.sha256, captureFrameId: input.aggregate.coordinateFrameId,
    geometryRevision: input.aggregate.geometryRevision, traceId: input.traceId };
  const state = { aggregate: input.aggregate, policy: input.plan.matchingPolicyVersion, planSha: input.plan.orderedPlanSha256,
    evidence: input.plan.requestedScope.endpointEvidence, trace: built.manifest,
    locations: [{ id: id(1), name: 'EQ01', revision: '1', aliases: ['EQ01'], has_head: false, has_legacy: false }],
    objects: [{ object_id: object.identity.objectId, record: object, record_sha256: geometryTraceHash(object), visibility: 'unknown' }],
    omitTrace: false, duplicateObject: false, omittedPlan: false, onQuery: (_sql: string) => {} };
  const query = vi.fn(async (sql: string, args: unknown[] = []) => {
    state.onQuery(sql);
    if (sql.includes('automatic-endpoints:plan')) return { rows: state.omittedPlan ? [] : [{ manifest: state.aggregate, matching_policy: state.policy,
      ordered_plan_sha256: state.planSha, endpoint_evidence: state.evidence }] };
    if (sql.includes('automatic-endpoints:trace')) return { rows: state.omitTrace ? [] : [{ manifest: state.trace }] };
    if (sql.includes('automatic-endpoints:locations')) return { rows: state.locations.filter(value => (args[1] as string[]).includes(value.id)) };
    if (sql.includes('automatic-endpoints:objects')) {
      const rows = state.objects.filter(value => (args[3] as string[]).includes(value.object_id));
      return { rows: state.duplicateObject ? [...rows, ...rows] : rows };
    }
    throw Error('Unexpected automatic endpoint query');
  });
  const client = { query } as unknown as PoolClient;
  const request = { projectId: input.aggregate.projectId, current, locationIds: [id(1)] };
  return { input, built, state, query, client, request, run: () => readAutomaticEndpointCandidates(client, request) };
}
beforeEach(() => vi.clearAllMocks());

describe('automatic proposal endpoint candidates from frozen immutable evidence', () => {
  it('derives the actual approximate bounding-box anchor without writing confirmation or manual heads', async () => {
    const f = fixture(), result = (await f.run()).get(id(1))!;
    expect(result.status).toBe('automatic-ready');
    expect(result.point).toMatchObject({ kind: 'automatic-equipment-anchor', point: [21, 3, 1],
      sourceObjectId: 'dbid:5', approximate: true, engineeringAccepted: false,
      modelVersionId: f.request.current.modelVersionId, aggregateId: f.request.current.aggregateId,
      artifactId: f.request.current.artifactId, traceId: f.request.current.traceId,
      matchedNames: ['EQ01'], derivation: 'equipment-bottom-aabb.v1' });
    expect(result.point).not.toHaveProperty('confirmedBy'); expect(result.point).not.toHaveProperty('confirmedAt');
    expect(result.point).not.toHaveProperty('bindingId');
    const { contentSha256, ...body } = result.point!; expect(contentSha256).toBe(automaticEndpointContentHash(body));
    expect(f.query.mock.calls.every(([sql]) => /^\/\* automatic-endpoints:[a-z]+ \*\/ SELECT/.test(sql))).toBe(true);
    expect(f.query.mock.calls.some(([sql]) => /\b(?:INSERT|UPDATE|DELETE)\b/.test(sql))).toBe(false);
  });
  it('reuses the exact location anchor through aliases and preserves a missing alias as absence evidence', async () => {
    const f = fixture(); f.state.locations[0] = { ...f.state.locations[0], name: 'Shared equipment', aliases: ['ALIAS', 'EQ01'] };
    f.state.evidence = [...f.state.evidence, { name: 'ALIAS', candidateObjectIds: [], status: 'missing' }];
    const first = (await f.run()).get(id(1)), second = (await f.run()).get(id(1));
    expect(first?.status).toBe('automatic-ready'); expect(first).toEqual(second);
    expect(first?.point?.matchedNames).toEqual(['EQ01']);
  });
  it.each(['has_head', 'has_legacy'] as const)('does not replace any existing %s binding authority', async key => {
    const f = fixture(); f.state.locations[0][key] = true;
    expect((await f.run()).get(id(1))).toEqual({ status: 'saved-binding-required', candidateObjectIds: [], point: null });
    expect(f.query.mock.calls.some(([sql]) => sql.includes('automatic-endpoints:objects'))).toBe(false);
  });
  it('retains a missing frozen name without inventing coordinates', async () => {
    const f = fixture(); f.state.evidence = [{ name: 'EQ01', candidateObjectIds: [], status: 'missing' }];
    expect((await f.run()).get(id(1))).toEqual({ status: 'missing', candidateObjectIds: [], point: null });
  });
  it('retains every ambiguous frozen candidate rather than selecting the first object', async () => {
    const f = fixture(); f.state.evidence = [{ name: 'EQ01', candidateObjectIds: ['dbid:5', 'dbid:6'], status: 'ambiguous' }];
    expect((await f.run()).get(id(1))).toEqual({ status: 'ambiguous', candidateObjectIds: ['dbid:5', 'dbid:6'], point: null });
  });
  it('does not erase ambiguity between two aliases of the same shared location', async () => {
    const f = fixture(); f.state.locations[0].aliases.push('ALIAS');
    f.state.evidence = [...f.state.evidence, { name: 'ALIAS', candidateObjectIds: ['dbid:6'], status: 'unique_candidate' }];
    expect((await f.run()).get(id(1))?.status).toBe('ambiguous');
  });
  it('requires current trace evidence without querying a different artifact as fallback', async () => {
    const f = fixture();
    expect((await readAutomaticEndpointCandidates(f.client, { ...f.request, current: { ...f.request.current, traceId: null } })).get(id(1))?.status).toBe('preparation-required');
    expect(f.query).not.toHaveBeenCalled();
  });
  it.each(['missing-object', 'hidden', 'role', 'different-name'] as const)('leaves %s evidence unresolved', async kind => {
    const f = fixture();
    if (kind === 'missing-object') f.state.objects = [];
    else {
      const row = f.state.objects[0];
      if (kind === 'hidden') row.visibility = 'hidden';
      if (kind === 'role') row.record = { ...row.record, geometry: { ...row.record.geometry, role: 'hierarchy', equipmentAnchor: null } };
      if (kind === 'different-name') row.record = { ...row.record, historicalModel: { ...row.record.historicalModel, name: 'Other equipment' } };
      row.record_sha256 = geometryTraceHash(row.record);
    }
    expect((await f.run()).get(id(1))?.status).toBe('object-unverified');
  });
  it.each(['wfc.pf.project-exact-candidates.v1', 'wfc.pf.project-exact-candidates.v2'] as const)('applies the frozen %s name policy, not a globally upgraded interpretation', async policy => {
    const f = fixture(); f.state.policy = policy; const row = f.state.objects[0];
    row.record = { ...row.record, historicalModel: { ...row.record.historicalModel, name: '/EQ01' } };
    row.record_sha256 = geometryTraceHash(row.record);
    expect((await f.run()).get(id(1))?.status).toBe(policy.endsWith('.v2') ? 'automatic-ready' : 'object-unverified');
  });
  it('corroborates property-only equipment tags and preserves engineering punctuation and leading zeroes', async () => {
    const f = fixture(), row = f.state.objects[0];
    f.state.evidence = [{ name: '=EQ001', candidateObjectIds: ['dbid:5'], status: 'unique_candidate' }];
    f.state.locations[0] = { ...f.state.locations[0], name: '=EQ001', aliases: ['=EQ001'] };
    row.record = { ...row.record, historicalModel: { ...row.record.historicalModel, name: 'Consumer',
      properties: [{ category: 'Element', name: 'Equipment Tag', value: '=eq001' }] } };
    row.record_sha256 = geometryTraceHash(row.record);
    expect((await f.run()).get(id(1))?.status).toBe('automatic-ready');
    f.state.evidence[0].name = 'EQ1'; f.state.locations[0] = { ...f.state.locations[0], name: 'EQ1', aliases: ['EQ1'] };
    expect((await f.run()).get(id(1))?.status).toBe('object-unverified');
  });
  it.each(['model', 'aggregate', 'frame', 'record-hash', 'trace-hash', 'duplicate-record', 'anchor'] as const)('refuses corrupted or mismatched %s authority', async kind => {
    const f = fixture(), row = f.state.objects[0];
    if (kind === 'model') row.record = { ...row.record, modelVersionId: id(99) };
    if (kind === 'aggregate') row.record = { ...row.record, aggregateId: id(99) };
    if (kind === 'frame') row.record = { ...row.record, coordinates: { ...row.record.coordinates, captureFrameId: id(99) } };
    if (kind === 'anchor') row.record = { ...row.record, geometry: { ...row.record.geometry,
      equipmentAnchor: { pointMetres: [0, 0, 0], approximate: true, derivation: 'equipment-bottom-aabb' } } };
    row.record_sha256 = geometryTraceHash(row.record);
    if (kind === 'record-hash') row.record_sha256 = 'f'.repeat(64);
    if (kind === 'trace-hash') f.state.trace = { ...f.state.trace, contentSha256: 'f'.repeat(64) };
    if (kind === 'duplicate-record') f.state.duplicateObject = true;
    await expect(f.run()).rejects.toBeDefined();
  });
  it.each(['missing-plan', 'missing-trace', 'foreign-artifact'] as const)('refuses %s preparation instead of treating it as missing equipment', async kind => {
    const f = fixture(); if (kind === 'missing-plan') f.state.omittedPlan = true;
    if (kind === 'missing-trace') f.state.omitTrace = true;
    if (kind === 'foreign-artifact') f.state.aggregate = { ...f.state.aggregate, artifactId: id(99) };
    await expect(f.run()).rejects.toBeDefined();
  });
  it('refuses non-finite evidence inside the resolver before producing an anchor', async () => {
    const f = fixture(), row = f.state.objects[0];
    row.record = { ...row.record, geometry: { ...row.record.geometry,
      bounds: { minimum: [NaN, 0, 0], maximum: [1, 1, 1] } } };
    // Keep the original finite record hash: non-finite JSON cannot have a
    // canonical evidence hash. The production reader must refuse this row,
    // rather than the fixture setup throwing before the assertion runs.
    await expect(f.run()).rejects.toThrow('NON_FINITE_POLICY_JSON');
  });
  it('rejects oversize location scope before any database access', async () => {
    const f = fixture(); await expect(readAutomaticEndpointCandidates(f.client,
      { ...f.request, locationIds: Array(RECALCULATION_LIMITS.neededLocations + 1).fill(id(1)) })).rejects.toMatchObject({ code: 'ENDPOINT_NEEDED_LOCATION_LIMIT' });
    expect(f.query).not.toHaveBeenCalled();
  });
  it('honors cancellation and an elapsed admission deadline before reading evidence', async () => {
    const f = fixture(), controller = new AbortController(); controller.abort();
    await expect(readAutomaticEndpointCandidates(f.client, { ...f.request, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    await expect(readAutomaticEndpointCandidates(f.client, { ...f.request, deadline: Date.now() - 1 })).rejects.toMatchObject({ code: 'RECALCULATION_COLLECTION_DEADLINE' });
    expect(f.query).not.toHaveBeenCalled();
  });
});
