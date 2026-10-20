// @vitest-environment node
import type { PoolClient } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sealedCableItemApplicabilitySchema } from '../../shared/pathfinderItemApplicability.js';
import { readProposalApplicability, type ProposalApplicabilityInput } from './proposalApplicability.js';
import { freezeScopedCableDependencies, hash, type CommonCalculationInputs } from './dependencies.js';
import { syntheticEngineIdentity } from './calculationFixtures.js';
import type { EndpointCalculationPoint } from './endpointCalculationProvenance.js';

const authority = vi.hoisted(() => vi.fn());
vi.mock('./locationImpactRepository.js', () => ({ readLocationImpactJobAuthority: authority }));
const id = (n: number) => `ad300000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const projectId = id(1), cableId = id(2), jobId = id(3), proposalId = id(4);
function fixture(jobState = 'running') {
  const common: CommonCalculationInputs = { projectId, registryRevision: '9', comparison: null,
    routing: { catalogRevision: '2', routingContentSha256: 'a'.repeat(64), routingPolicyRevision: '3', routingPolicySha256: 'b'.repeat(64) },
    model: { id: id(5), selectionRevision: '1', contentFingerprint: 'c'.repeat(64) }, artifact: { id: id(6), sha256: 'd'.repeat(64) },
    preparation: { aggregateId: id(7), geometryRevision: '1', captureFrameId: id(8), projectionSha256: 'd'.repeat(64) },
    settings: { revision: '1', connectionGap: '1', secondaryTrayLength: '7', endConnectionLength: '5', additionalBendingPercent: '10' },
    options: { connectionToleranceMeters: 1, sampleSpacingMeters: 0.125, secondaryDistanceMeters: 2, preferVerticalApproach: true,
      maxGraphNodes: 200000, maxGraphConnections: 1000000 }, engineVersion: 'pathfinder-45c24bf5-pf1-modelrunner-v1', engineIdentity: syntheticEngineIdentity() };
  const point = (n: number): EndpointCalculationPoint => ({ locationId: id(n), locationRevision: '1', bindingRevision: '1', point: [n, 2, 3],
    bindingId: id(n + 10), bindingContentSha256: 'e'.repeat(64), mode: 'fixed-world', captureFrameId: id(8), qualifiedProjectFrameId: null,
    aggregateId: id(7), projectionSha256: 'd'.repeat(64), sourceObjectRevisionId: null, migrationDecisionId: null });
  const dependencies = freezeScopedCableDependencies(common, { id: cableId, from_location: 'FROM', to_location: 'TO', mto: 'LV',
    cable_type_id: id(9), cable_write_revision: '7' }, point(10), point(11)).dependencies!;
  const dependencyHash = hash(dependencies), seal = { projectId, cableId, jobId, proposalId, dependencyHash };
  const input: ProposalApplicabilityInput = { ...seal, dependencyVersion: 'pathfinder.dependencies.v7', jobState, cancelRequested: false, seal };
  const row = { state: 'complete', status: 'calculated', dependencies: dependencies as unknown, job_state: jobState, cancel_requested: false };
  const state = { rows: [row] }, query = vi.fn(async (_text: string, _values?: unknown[]) => ({ rows: state.rows }));
  const client = { query } as unknown as PoolClient;
  return { input, row, state, dependencies, client, query, run: () => readProposalApplicability(client, input) };
}
beforeEach(() => { vi.clearAllMocks(); authority.mockResolvedValue({ scope: 'location-impact', enrolled: true, valid: true,
  generation: '9', authorityEpoch: '1', impactId: id(50), code: 'LOCATION_IMPACT_AUTHORITY_CURRENT' }); });

describe('version-specific sealed cable applicability with mocked SQL and scoped authority', () => {
  it.each(['queued', 'running', 'complete'])('permits one exact sealed v7 completed item with parent %s without waiting for siblings', async parent => {
    const f = fixture(parent), result = await f.run();
    expect(result.applicable).toBe(true); expect(sealedCableItemApplicabilitySchema.parse(result.evidence)).toEqual({
      schemaVersion: 'wfc.pf.sealed-cable-applicability.v1', dependencyVersion: 'pathfinder.dependencies.v7', projectId, cableId, jobId, proposalId,
      dependencyHash: f.input.dependencyHash, scope: 'sealed-cable-item' });
    expect(f.query).toHaveBeenCalledOnce(); const [sql, values] = f.query.mock.calls[0];
    expect(sql).toContain('WHERE i.project_id=$1 AND i.job_id=$2 AND i.cable_id=$3 FOR SHARE OF i,j');
    expect(sql).toContain('CASE WHEN octet_length(i.dependencies::text)<=262144'); expect(values).toEqual([projectId, jobId, cableId]);
    expect(sql).not.toMatch(/\b(?:INSERT|DELETE|CREATE|ALTER)\b|\bUPDATE\s+\w+\s+SET|count\s*\(/i);
    expect(authority).toHaveBeenCalledExactlyOnceWith(f.client, { projectId, jobId, cableId, lock: true });
  });
  it.each(['pathfinder.dependencies.v5', 'pathfinder.dependencies.v6'])('preserves whole-job completion semantics for legacy %s', async version => {
    for (const parent of ['queued', 'running', 'complete']) {
      const f = fixture(parent); f.input.dependencyVersion = version; f.input.seal = null;
      expect(await f.run()).toEqual({ applicable: parent === 'complete', evidence: null }); expect(f.query).not.toHaveBeenCalled();
    }
    expect(authority).not.toHaveBeenCalled();
  });
  it.each(['cancelled', 'failed', 'unavailable'])('does not permit a completed item with revoked parent %s', async parent => {
    const f = fixture(parent); expect(await f.run()).toEqual({ applicable: false, evidence: null });
    expect(f.query).not.toHaveBeenCalled(); expect(authority).not.toHaveBeenCalled();
  });
  it.each(['pathfinder.dependencies.v5', 'pathfinder.dependencies.v6', 'pathfinder.dependencies.v7'])('rejects requested cancellation for %s before any proof reads', async version => {
    const f = fixture('complete'); f.input.dependencyVersion = version; f.input.cancelRequested = true;
    expect(await f.run()).toEqual({ applicable: false, evidence: null }); expect(f.query).not.toHaveBeenCalled(); expect(authority).not.toHaveBeenCalled();
  });
  it('does not treat a nonsealed result as a completed cable proof', async () => {
    const f = fixture(); f.input.seal = null;
    expect(await f.run()).toEqual({ applicable: false, evidence: null }); expect(f.query).not.toHaveBeenCalled(); expect(authority).not.toHaveBeenCalled();
  });
  it.each(['projectId', 'jobId', 'cableId', 'proposalId', 'dependencyHash'] as const)('requires seal ownership of the exact %s', async field => {
    const f = fixture(); f.input.seal = { ...f.input.seal!, [field]: field === 'dependencyHash' ? 'f'.repeat(64) : id(99) };
    expect(await f.run()).toEqual({ applicable: false, evidence: null }); expect(f.query).not.toHaveBeenCalled(); expect(authority).not.toHaveBeenCalled();
  });
  it.each(['waiting', 'running', 'blocked'])('does not promote an item in state %s into readiness', async state => {
    const f = fixture(); f.row.state = state;
    expect(await f.run()).toEqual({ applicable: false, evidence: null }); expect(authority).not.toHaveBeenCalled();
  });
  it.each(['no_path', 'stale', 'resource_limit', 'deadline_exceeded', 'calculating', 'locations_required'])('requires a calculated outcome instead of %s', async status => {
    const f = fixture(); f.row.status = status;
    expect(await f.run()).toEqual({ applicable: false, evidence: null }); expect(authority).not.toHaveBeenCalled();
  });
  it.each(['missing-item', 'null-dependencies', 'wrong-hash', 'legacy-dependencies', 'cancelled-row', 'changed-parent'] as const)(
    'refuses unavailable, stale or mismatched item evidence: %s', async kind => {
      const f = fixture();
      if (kind === 'missing-item') f.state.rows = [];
      if (kind === 'null-dependencies') f.row.dependencies = null;
      if (kind === 'wrong-hash') f.row.dependencies = { ...f.dependencies, cableWriteRevision: '8' };
      if (kind === 'legacy-dependencies') { f.row.dependencies = { ...f.dependencies, schemaVersion: 'pathfinder.dependencies.v6' }; f.input.dependencyHash = hash(f.row.dependencies); f.input.seal = { ...f.input.seal!, dependencyHash: f.input.dependencyHash }; }
      if (kind === 'cancelled-row') f.row.cancel_requested = true;
      if (kind === 'changed-parent') f.row.job_state = 'complete';
      expect(await f.run()).toEqual({ applicable: false, evidence: null }); expect(authority).not.toHaveBeenCalled();
    });
  it.each([null, { enrolled: false }, { scope: 'location-impact', enrolled: true, valid: false, code: 'LOCATION_IMPACT_TARGET_SUPERSEDED' },
    { scope: 'location-impact', enrolled: true, valid: false, code: 'LOCATION_IMPACT_AUTHORITY_EXPIRED' }])('requires actual current scoped authority: %s', async value => {
    const f = fixture(); authority.mockResolvedValue(value);
    expect(await f.run()).toEqual({ applicable: false, evidence: null }); expect(authority).toHaveBeenCalledOnce();
  });
  it('propagates a failed SQL proof read instead of manufacturing a display approval', async () => {
    const f = fixture(), failure = new Error('Synthetic SQL read failure.'); f.query.mockRejectedValue(failure);
    await expect(f.run()).rejects.toBe(failure); expect(authority).not.toHaveBeenCalled();
  });
  it('propagates authority errors instead of treating unavailable proof as a successful legacy fallback', async () => {
    const f = fixture(), failure = new Error('Synthetic authority integrity failure.'); authority.mockRejectedValue(failure);
    await expect(f.run()).rejects.toBe(failure);
  });
});
