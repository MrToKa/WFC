// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import type { PathFinderRepository } from './repository.js';
import type { BarrierAdmissionIntent } from '../../shared/pathfinderBarrierAdmission.js';
import type { RecalculationPreferences } from '../../shared/pathfinderRecalculation.js';

const seams = vi.hoisted(() => ({ collect: vi.fn(), current: vi.fn(), persist: vi.fn(), transaction: vi.fn() }));
vi.mock('./dependencyBatch.js', () => ({ collectDependencyBatchInTransaction: seams.collect }));
vi.mock('./barrierCalculationScope.js', () => ({ readCurrentBarrierAdmissionIntent: seams.current, collectBarrierCalculationScope: vi.fn() }));
vi.mock('./revisionResultRepository.js', () => ({ persistRevisionAdmission: seams.persist, verifyRevisionResultForProposal: vi.fn() }));
vi.mock('./auth.js', async original => ({ ...await original<typeof import('./auth.js')>(), principalTransaction: seams.transaction }));
import { createAutomaticJobInTransaction, createPathFinderJobs } from './jobs.js';
import { createPathFinderPreviews, previewSchema } from './previews.js';
import { createJobSchema, defaultOptions } from './jobContracts.js';
import { PathFinderError } from './errors.js';
import { grantOperationPrincipal } from './operationAuthority.js';

const id = (number: number) => `b6fa0000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const projectId = id(1), modelId = id(2), who = { userId: id(3), loginId: id(4), loginExpiresAt: Date.parse('2099-01-01T00:00:00Z') };
function intent(revision = '4', drillThroughWalls = false, modelVersionId = modelId): BarrierAdmissionIntent {
  const scope = { projectId, modelVersionId, contentFingerprint: 'a'.repeat(64), selectionRevision: '2', captureFrameId: id(5),
    captureFrameSha256: 'b'.repeat(64), coordinateFrame: 'canonical-world-metres' as const };
  return { schemaVersion: 'wfc.pf.barrier-admission-intent.v1', scope, expectedRegistryRevision: revision, drillThroughWalls,
    expectedSnapshot: { snapshotId: id(20 + Number(revision)), scope, registryRevision: revision, contentSha256: 'c'.repeat(64), mode: 'explicit-empty' } };
}
function automatic(preferences: RecalculationPreferences = { secondaryDistanceMeters: 3, preferVerticalApproach: false }) {
  const query = vi.fn(async (sql: string, _parameters?: unknown[]) => {
    if (sql.startsWith('SELECT desired_generation')) return { rows: [{ generation: '9' }] };
    if (sql.includes('FROM project_model_selections s JOIN')) return { rows: [{ id: modelId, selectionRevision: '2', contentFingerprint: 'a'.repeat(64) }] };
    if (sql.startsWith('INSERT INTO pf_jobs') || sql.startsWith('INSERT INTO pf_job_items')) return { rows: [] };
    throw new Error('Unexpected SQL in synthetic fresh admission fixture: ' + sql.slice(0, 90));
  });
  const client = { query } as unknown as PoolClient;
  const input: Parameters<typeof createAutomaticJobInTransaction>[1] = { projectId, principal: who, scope: 'project', preferences,
    timeoutMilliseconds: 10000, signal: new AbortController().signal, beforeInsert: vi.fn().mockResolvedValue(undefined) };
  // Geometry/dependency/authority readers are boundary mocks. Actual adapter and
  // insertion projections run against synthetic recorded SQL; no DB/SDK is used.
  seams.collect.mockImplementation(async (_client: unknown, command: { options: unknown }) => ({
    items: [{ id: id(6), cable: { id: id(6), mto: 'Control', cable_write_revision: '7' },
      dependencies: { schemaVersion: 'pathfinder.dependencies.v8' }, status: 'ready', message: '' }],
    options: command.options, registryRevision: '8', bytes: 100,
  }));
  return { input, client, query };
}
beforeEach(() => {
  vi.clearAllMocks(); seams.collect.mockReset(); seams.current.mockReset(); seams.persist.mockReset(); seams.transaction.mockReset();
  seams.persist.mockResolvedValue(undefined);
  seams.transaction.mockRejectedValue(new Error('The fresh missing-intent guard must run before any transaction.'));
});

describe('fresh barrier admission boundaries', () => {
  it.each([undefined, { ...defaultOptions }])('manual calculation rejects absent intent before registry matching or pool access (%s)', async options => {
    const connect = vi.fn(), match = vi.fn().mockResolvedValue({ registryRevision: '8' });
    const jobs = createPathFinderJobs({ connect } as unknown as Pool, { match } as unknown as PathFinderRepository);
    const request = createJobSchema.parse({ expectedRegistryRevision: '8', ...(options ? { options } : {}) });
    await expect(jobs.create(projectId, who, request)).rejects.toMatchObject({ code: 'BARRIER_ROUTING_INTENT_REQUIRED', status: 409 });
    expect(match).not.toHaveBeenCalled(); expect(connect).not.toHaveBeenCalled(); expect(seams.transaction).not.toHaveBeenCalled();
    expect(seams.collect).not.toHaveBeenCalled(); expect(seams.persist).not.toHaveBeenCalled();
  });
  it('standalone preview rejects absent intent before pool/transaction access', async () => {
    const connect = vi.fn(), previews = createPathFinderPreviews({ connect } as unknown as Pool);
    const request = previewSchema.parse({ from: { name: 'From', point: [0, 0, 0] }, to: { name: 'To', point: [1, 0, 0] },
      category: 'Control', reverse: false, artifactId: id(7), expectedSelectionRevision: '2', expectedSettingsRevision: '3', expectedRegistryRevision: '8' });
    await expect(previews.create(projectId, who, request)).rejects.toMatchObject({ code: 'BARRIER_ROUTING_INTENT_REQUIRED', status: 409 });
    expect(connect).not.toHaveBeenCalled(); expect(seams.transaction).not.toHaveBeenCalled(); expect(seams.collect).not.toHaveBeenCalled();
  });
  it.each(['absent', 'stale-off', 'stale-true'] as const)('background admission derives current off publication from %s historical preferences', async previous => {
    const old = previous === 'absent' ? undefined : intent('1', previous === 'stale-true', id(90));
    const preferences = { secondaryDistanceMeters: 3, preferVerticalApproach: false, ...(old ? { barrierRouting: old } : {}) };
    const original = structuredClone(preferences), current = intent('4'), f = automatic(preferences); seams.current.mockResolvedValue(current);
    const result = await createAutomaticJobInTransaction(f.client, f.input);
    expect(seams.current).toHaveBeenCalledExactlyOnceWith(f.client, projectId, false);
    expect(seams.collect).toHaveBeenCalledWith(f.client, expect.objectContaining({ dependencyVersion: 'pathfinder.dependencies.v8',
      options: { ...defaultOptions, secondaryDistanceMeters: 3, preferVerticalApproach: false, barrierRouting: current } }));
    const inserted = f.query.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO pf_jobs')); expect(inserted).toBeDefined();
    expect(seams.current.mock.invocationCallOrder[0]).toBeLessThan(seams.collect.mock.invocationCallOrder[0]);
    expect(seams.collect.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(f.input.beforeInsert).mock.invocationCallOrder[0]);
    expect(seams.persist).toHaveBeenCalledWith(f.client, expect.objectContaining({ jobId: result.jobId, kind: 'automatic', generation: '9',
      options: expect.objectContaining({ barrierRouting: current }) }));
    expect(result).toMatchObject({ readyCables: 1, blockedCables: 0, total: 1 }); expect(preferences).toEqual(original);
  });
  it('successive background admissions reread publication rather than caching a prior scope', async () => {
    const f = automatic(), first = intent('4'), second = intent('5'); seams.current.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    await createAutomaticJobInTransaction(f.client, f.input); await createAutomaticJobInTransaction(f.client, f.input);
    expect(seams.current).toHaveBeenCalledTimes(2);
    expect(seams.collect.mock.calls.map(call => call[1].options.barrierRouting)).toEqual([first, second]);
    expect(seams.collect.mock.calls.every(call => call[1].dependencyVersion === 'pathfinder.dependencies.v8')).toBe(true);
  });
  it('a missing/unavailable server publication cannot fall back to a legacy background batch', async () => {
    const f = automatic({ secondaryDistanceMeters: 2, preferVerticalApproach: true, barrierRouting: intent('1', true, id(90)) });
    seams.current.mockRejectedValue(new PathFinderError('BARRIER_REGISTRY_UNAVAILABLE', 409));
    await expect(createAutomaticJobInTransaction(f.client, f.input)).rejects.toMatchObject({ code: 'BARRIER_REGISTRY_UNAVAILABLE' });
    expect(seams.collect).not.toHaveBeenCalled(); expect(f.input.beforeInsert).not.toHaveBeenCalled();
    expect(f.query).not.toHaveBeenCalled(); expect(seams.persist).not.toHaveBeenCalled();
  });
  it('closed-browser grant insertion uses the same newly derived off scope and retains grant provenance without a fabricated login', async () => {
    const f = automatic(), current = intent('4'); seams.current.mockResolvedValue(current);
    f.input.principal = grantOperationPrincipal({ kind: 'calculation-grant', projectId, grantId: id(30), grantRevision: '1', grantEpoch: '2',
      installationEpoch: id(31), issuerId: who.userId, issuerAdminRevision: '3', leaseId: id(32), ownerToken: 'd'.repeat(64),
      leaseExpiresAt: '2099-01-01T00:00:00.000Z', operation: 'calculate', modelVersionId: modelId, selectionRevision: '2', contentFingerprint: 'a'.repeat(64) });
    await createAutomaticJobInTransaction(f.client, f.input);
    expect(seams.current).toHaveBeenCalledExactlyOnceWith(f.client, projectId, false);
    expect(seams.collect.mock.calls[0][1]).toMatchObject({ dependencyVersion: 'pathfinder.dependencies.v8', options: { barrierRouting: current } });
    const call = f.query.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO pf_jobs'));
    const parameters = call?.[1];
    expect(parameters?.[3]).toBeNull(); expect(parameters?.[4]).toBeNull(); expect(parameters?.[11]).toBe('calculation-grant');
    expect(parameters?.[12]).toMatchObject({ kind: 'calculation-grant', grantId: id(30), issuerId: who.userId });
  });
});
