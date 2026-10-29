// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { collectDependenciesForVersion, createTransactionDependencyReadCollector, hash } from './dependencies.js';
import { createPathFinderJobs } from './jobs.js';
import { defaultOptions, type EngineOptions } from './jobContracts.js';
import { syntheticBarrierEngineIdentity, syntheticEngineIdentity } from './calculationFixtures.js';
import { BARRIER_RUNTIME_PROFILE, createBarrierRuntimePolicy, type BarrierRuntimeContext } from '../../shared/pathfinderBarrierRuntime.js';
import { PathFinderError } from './errors.js';
import type { PathFinderRepository } from './repository.js';

const seams = vi.hoisted(() => ({ active: vi.fn(), artifact: vi.fn(), context: vi.fn(), routing: vi.fn(), settings: vi.fn(),
  comparison: vi.fn(), barriers: vi.fn(), binding: vi.fn(), automatic: vi.fn(), identity: vi.fn(), barrierIdentity: vi.fn(),
  seal: vi.fn(), enrollment: vi.fn(), applicability: vi.fn(), versionedScope: vi.fn(), geometryRead: vi.fn() }));
vi.mock('./repository.js', () => ({ activeModel: seams.active, latestArtifact: seams.artifact }));
vi.mock('./endpointBindingRepository.js', () => ({ readCurrentEndpointBindingContext: seams.context, readEndpointBindingScope: seams.binding }));
vi.mock('./routingScope.js', () => ({ requirePreparedRoutingScope: seams.routing, requireVersionedCalculationScope: seams.versionedScope }));
vi.mock('./settings.js', () => ({ projectRoutingSettings: seams.settings }));
vi.mock('./revisionComparisonRepository.js', () => ({ readComparisonDependency: seams.comparison }));
vi.mock('./barrierCalculationScope.js', () => ({ collectBarrierCalculationScope: seams.barriers }));
vi.mock('./automaticEndpointCandidates.js', () => ({ readAutomaticEndpointCandidates: seams.automatic }));
vi.mock('./calculationEngineIdentity.js', () => ({ calculationEngineIdentity: seams.identity, barrierCalculationEngineIdentity: seams.barrierIdentity }));
vi.mock('./revisionResultRepository.js', () => ({ persistRevisionAdmission: vi.fn(), verifyRevisionResultForProposal: seams.seal }));
vi.mock('./recalculationRepository.js', () => ({ readRecalculationJobAuthority: seams.enrollment, pauseRecalculationForJob: vi.fn(), requireEnrollmentAuthority: vi.fn() }));
vi.mock('./proposalApplicability.js', () => ({ readProposalApplicability: seams.applicability }));
// Only the immutable result-proof seam is synthetic here; the current common,
// per-cable and endpoint dependency collectors below are the production code.
vi.mock('./barrierWrites.js', () => ({ readBarrierWriteEvidence: () => ({}), BARRIER_WRITE_UNVERIFIED_MESSAGE: 'Unverified result.' }));

const id = (n: number) => `d9270000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const projectId = id(1), modelId = id(2), artifactId = id(3), aggregateId = id(4), frameId = id(5);
const who = { userId: id(6), loginId: id(7), loginExpiresAt: Date.parse('2099-01-01T00:00:00Z') };
const scope = { projectId, modelVersionId: modelId, contentFingerprint: 'c'.repeat(64), selectionRevision: '1', captureFrameId: frameId,
  captureFrameSha256: 'b'.repeat(64), coordinateFrame: 'canonical-world-metres' as const };
const snapshot = { snapshotId: id(8), scope, registryRevision: '1', contentSha256: 'a'.repeat(64), mode: 'mesh-set' as const };
const options = (): EngineOptions => ({ ...defaultOptions, barrierRouting: { schemaVersion: 'wfc.pf.barrier-admission-intent.v1', scope,
  expectedRegistryRevision: '1', expectedSnapshot: snapshot, drillThroughWalls: false } });
const runtime = (): BarrierRuntimeContext => {
  const policy = createBarrierRuntimePolicy(false);
  return { schemaVersion: 'wfc.pf.barrier-runtime.v1', binding: { scope, registryRevision: '1', snapshot, policy, policySha256: hash(policy) },
    profile: structuredClone(BARRIER_RUNTIME_PROFILE), profileSha256: hash(BARRIER_RUNTIME_PROFILE), storage: {
      intentId: id(9), manifest: { blobId: id(10), sha256: 'd'.repeat(64), bytes: 100 }, capture: { blobId: id(11), sha256: 'e'.repeat(64), bytes: 200 } } };
};
const current = () => ({ modelVersionId: modelId, selectionRevision: '1', contentFingerprint: scope.contentFingerprint, artifactId, aggregateId,
  projectionSha256: 'd'.repeat(64), captureFrameId: frameId, geometryRevision: '2', traceId: null });
const binding = (locationId: string) => ({ id: id(800 + Number(locationId.slice(-3))), locationId, artifactId, locationRevision: '2', bindingRevision: '3',
  pointProjectMetres: [1, 2, 3], contentSha256: 'a'.repeat(64), mode: 'fixed-world', captureFrameId: frameId, qualifiedProjectFrameId: null,
  aggregateId, projectionSha256: 'd'.repeat(64), sourceObject: null, sourceDecisionId: null });

/** Synthetic SQL protocol only; no database, model, storage or network is used. */
function fixture() {
  const cables = Array.from({ length: 5 }, (_, n) => ({ id: id(100 + n), from_location: `FROM ${n}`, to_location: `TO ${n}`, mto: 'Instrumentation',
    cable_type_id: id(20), cable_write_revision: '4', routing: '/OLD', design_length: '23', install_length: '24' }));
  const proposals: Array<Record<string, any>> = [];
  const state = { admin: true, revoked: false };
  const query = vi.fn(async (sql: string, args: unknown[] = []): Promise<{ rows: Array<Record<string, any>> }> => {
    if (sql.startsWith('SELECT id FROM projects')) return { rows: [{ id: projectId }] };
    if (sql.startsWith('SELECT is_admin')) return { rows: [{ is_admin: state.admin }] };
    if (sql.startsWith('SELECT user_id,expires_at')) return { rows: [{ user_id: who.userId, expires_at: new Date(who.loginExpiresAt), revoked_at: state.revoked ? new Date() : null }] };
    if (sql.startsWith('SELECT * FROM pf_jobs')) return { rows: [] };
    if (sql.startsWith('SELECT p.*,j.state AS job_state')) return { rows: proposals };
    if (sql.includes('FROM cables WHERE')) return { rows: cables.filter(cable => cable.id === args[1]) };
    if (sql.includes('FROM pf_project_state')) return { rows: [{ registry_revision: '9' }] };
    if (sql.includes('FROM pf_location_aliases')) {
      const match = /^(FROM|TO) ([0-4])$/.exec(String(args[1]));
      return { rows: match ? [{ id: id(200 + Number(match[2]) * 2 + (match[1] === 'TO' ? 1 : 0)) }] : [] };
    }
    if (/^(?:BEGIN|COMMIT|ROLLBACK|INSERT INTO viewer_login_bindings)/.test(sql)) return { rows: [] };
    throw Error('Unexpected synthetic SQL: ' + sql.slice(0, 100));
  });
  const release = vi.fn(), client = { query, release } as unknown as PoolClient, pool = { connect: async () => client } as unknown as Pool;
  const jobs = createPathFinderJobs(pool, {} as PathFinderRepository);
  const seed = async (preferences: EngineOptions[] = cables.map(() => options())) => {
    for (let n = 0; n < cables.length; n++) {
      const dependencies = (await collectDependenciesForVersion(client, projectId, cables[n].id, preferences[n], 'pathfinder.dependencies.v8')).dependencies!;
      proposals.push({ id: id(300 + n), project_id: projectId, job_id: id(400), cable_id: cables[n].id, status: 'calculated',
        proposal_hash: hash({ n }), dependency_hash: hash(dependencies), dependencies, job_state: 'complete', cancel_requested: false,
        created_at: '2026-10-23T00:00:00Z', result: { message: 'Synthetic sealed result.', calculationMode: 'calculate',
          route: { success: true, routeText: '/A', segmentIds: ['dbid:1'], pathPoints: [{ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }] },
          design: { designLengthMeters: '6' } } });
    }
    vi.clearAllMocks();
  };
  return { cables, proposals, state, client, pool, jobs, query, release, seed };
}

beforeEach(() => {
  vi.resetAllMocks();
  seams.active.mockResolvedValue({ active_model_version_id: modelId, selection_revision: '1', state: 'ready', health: 'healthy', content_fingerprint: scope.contentFingerprint });
  seams.artifact.mockResolvedValue({ id: artifactId, content_fingerprint: scope.contentFingerprint, snapshot_sha256: 'd'.repeat(64) });
  seams.context.mockResolvedValue(current());
  seams.routing.mockResolvedValue({ catalogRevision: '1', routingContentSha256: 'e'.repeat(64), routingPolicyRevision: '1', routingPolicySha256: 'f'.repeat(64) });
  seams.settings.mockImplementation(async (_client: unknown, _project: string, requested: EngineOptions) => ({ settings: {
    revision: '1', connectionGap: '1', secondaryTrayLength: '7', endConnectionLength: '5', additionalBendingPercent: '10' }, options: requested }));
  seams.comparison.mockResolvedValue({ readiness: 'not-required', scope: null });
  seams.identity.mockResolvedValue(syntheticEngineIdentity()); seams.barrierIdentity.mockResolvedValue(syntheticBarrierEngineIdentity());
  seams.barriers.mockImplementation(async () => {
    // Model the retained verifier's per-fragment I/O work, not actual geometry qualification.
    for (let n = 0; n < 100; n++) seams.geometryRead(n);
    return runtime();
  });
  seams.binding.mockImplementation(async (_client: unknown, input: { locationId: string }) => ({ status: 'confirmed', binding: binding(input.locationId) }));
  seams.automatic.mockResolvedValue(new Map()); seams.enrollment.mockResolvedValue({ enrolled: false });
  seams.applicability.mockResolvedValue({ applicable: true, evidence: null });
  seams.seal.mockResolvedValue({ revisionResultSha256: 'c'.repeat(64), baselineHash: 'd'.repeat(64), ledgerHash: 'e'.repeat(64) });
});

describe('transaction-local common verification for the recent proposal state', () => {
  it('performs one full common verification for five proposals while independently checking every cable, endpoint, seal and authority', async () => {
    const db = fixture(); await db.seed();
    const result = await db.jobs.state(projectId, who);
    expect(seams.barriers).toHaveBeenCalledOnce(); expect(seams.geometryRead).toHaveBeenCalledTimes(100);
    expect(seams.active).toHaveBeenCalledOnce(); expect(seams.context).toHaveBeenCalledOnce();
    expect(db.query.mock.calls.filter(([sql]) => sql.includes('FROM cables WHERE'))).toHaveLength(5);
    expect(db.query.mock.calls.filter(([sql]) => sql.includes('FROM pf_location_aliases'))).toHaveLength(10);
    expect(seams.binding).toHaveBeenCalledTimes(10); expect(seams.seal).toHaveBeenCalledTimes(5);
    expect(seams.enrollment).toHaveBeenCalledTimes(5); expect(seams.applicability).toHaveBeenCalledTimes(5);
    expect(seams.enrollment.mock.calls.map(call => call[1].cableId)).toEqual(db.cables.map(cable => cable.id));
    expect(seams.seal.mock.calls.map(call => call[1].proposalId)).toEqual(db.proposals.map(proposal => proposal.id));
    expect(seams.applicability.mock.calls.map(call => call[1].cableId)).toEqual(db.cables.map(cable => cable.id));
    expect(result.proposals.every(value => !value.stale && value.canApply)).toBe(true);
    expect(db.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
  });

  it('keeps a changed cable and a changed endpoint non-current without borrowing another cable proof', async () => {
    const db = fixture(); await db.seed(); db.cables[1].cable_write_revision = '5';
    seams.binding.mockImplementation(async (_client: unknown, input: { locationId: string }) => ({ status: 'confirmed', binding: {
      ...binding(input.locationId), ...(input.locationId === id(204) ? { pointProjectMetres: [9, 2, 3] } : {}) } }));
    const result = await db.jobs.state(projectId, who);
    expect(result.proposals.map(value => value.stale)).toEqual([false, true, true, false, false]);
    expect(result.proposals.map(value => value.canApply)).toEqual([true, false, false, true, true]);
    expect(seams.barriers).toHaveBeenCalledOnce(); expect(seams.binding).toHaveBeenCalledTimes(10); expect(seams.seal).toHaveBeenCalledTimes(5);
  });

  it('does not borrow common inputs across exact preferences or retained dependency versions', async () => {
    const db = fixture(), changed = { ...options(), preferVerticalApproach: false }, another = { ...options(), secondaryDistanceMeters: 4 };
    await db.seed([options(), options(), changed, another, options()]);
    const result = await db.jobs.state(projectId, who);
    expect(seams.barriers).toHaveBeenCalledTimes(3); expect(seams.geometryRead).toHaveBeenCalledTimes(300);
    expect(result.proposals.every(value => !value.stale)).toBe(true);
    vi.clearAllMocks(); const read = createTransactionDependencyReadCollector(db.client, projectId);
    await read(db.cables[0].id, defaultOptions, 'pathfinder.dependencies.v5');
    await read(db.cables[0].id, defaultOptions, 'pathfinder.dependencies.v7');
    expect(seams.active).toHaveBeenCalledTimes(2); expect(seams.barriers).not.toHaveBeenCalled();
  });

  it('checks each cable authority independently even when all mathematical common inputs are equal', async () => {
    const db = fixture(); await db.seed();
    seams.enrollment.mockImplementation(async (_client: unknown, input: { cableId: string }) => input.cableId === db.cables[3].id
      ? { enrolled: true, valid: false } : { enrolled: false });
    const result = await db.jobs.state(projectId, who);
    expect(result.proposals.map(value => value.stale)).toEqual([false, false, false, true, false]);
    expect(result.proposals[3].canApply).toBe(false); expect(seams.enrollment).toHaveBeenCalledTimes(5);
    expect(seams.barriers).toHaveBeenCalledOnce(); expect(seams.seal).toHaveBeenCalledTimes(5);
  });

  it('starts a fresh common verification in each later state transaction', async () => {
    const db = fixture(); await db.seed(); await db.jobs.state(projectId, who); await db.jobs.state(projectId, who);
    expect(seams.barriers).toHaveBeenCalledTimes(2); expect(seams.geometryRead).toHaveBeenCalledTimes(200);
    expect(seams.binding).toHaveBeenCalledTimes(20); expect(seams.seal).toHaveBeenCalledTimes(10);
  });

  it('retains a failed common verification as unavailable history rather than converting it into an empty or current set', async () => {
    const db = fixture(); await db.seed(); seams.barriers.mockRejectedValue(new PathFinderError('BARRIER_CALCULATION_STORAGE_INVALID', 409));
    const result = await db.jobs.state(projectId, who);
    expect(seams.barriers).toHaveBeenCalledOnce(); expect(seams.binding).not.toHaveBeenCalled();
    expect(result.proposals.every(value => value.stale && !value.canApply && value.message.includes('barrier scope changed or became unavailable'))).toBe(true);
    expect(seams.seal).toHaveBeenCalledTimes(5);
  });

  it('propagates an unknown verification failure and rechecks authority before another request', async () => {
    const db = fixture(); await db.seed(); const failure = new PathFinderError('ENGINE_IMPLEMENTATION_RESTART_REQUIRED', 503);
    seams.barriers.mockRejectedValue(failure);
    await expect(db.jobs.state(projectId, who)).rejects.toBe(failure);
    expect(seams.seal).not.toHaveBeenCalled(); expect(db.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    db.state.admin = false; vi.clearAllMocks();
    await expect(db.jobs.state(projectId, who)).rejects.toMatchObject({ code: 'ADMIN_REQUIRED' });
    expect(seams.barriers).not.toHaveBeenCalled(); expect(seams.active).not.toHaveBeenCalled();
  });

  it('does not turn a rejected cached promise into a successful read after a verifier recovers', async () => {
    const db = fixture(), read = createTransactionDependencyReadCollector(db.client, projectId);
    const failure = new PathFinderError('BARRIER_CALCULATION_STORAGE_INVALID', 409);
    seams.barriers.mockRejectedValueOnce(failure);
    await expect(read(db.cables[0].id, options(), 'pathfinder.dependencies.v8')).rejects.toBe(failure);
    await expect(read(db.cables[1].id, options(), 'pathfinder.dependencies.v8')).rejects.toBe(failure);
    expect(seams.barriers).toHaveBeenCalledOnce();
    const fresh = createTransactionDependencyReadCollector(db.client, projectId);
    expect((await fresh(db.cables[0].id, options(), 'pathfinder.dependencies.v8')).dependencies?.schemaVersion).toBe('pathfinder.dependencies.v8');
    expect(seams.barriers).toHaveBeenCalledTimes(2);
  });
});
