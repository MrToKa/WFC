// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
const seams = vi.hoisted(() => ({ collect: vi.fn(), synthetic: vi.fn(), seal: vi.fn(), scope: vi.fn(), engine: vi.fn() }));
vi.mock('./dependencies.js', async original => ({ ...await original<typeof import('./dependencies.js')>(), collectDependencies: seams.collect, collectDependenciesForVersion: seams.collect,
  createTransactionDependencyReadCollector: (client: PoolClient, projectId: string) => (cableId: string, options: unknown, version: string) => seams.collect(client, projectId, cableId, options, version),
  hasSyntheticProof: seams.synthetic }));
vi.mock('./revisionResultRepository.js', () => ({ persistRevisionAdmission: vi.fn(), verifyRevisionResultForProposal: seams.seal }));
vi.mock('./recalculationRepository.js', () => ({ readRecalculationJobAuthority: async () => ({ enrolled: false }), pauseRecalculationForJob: vi.fn(), requireEnrollmentAuthority: vi.fn() }));
vi.mock('./routingScope.js', async original => ({ ...await original<typeof import('./routingScope.js')>(), requireVersionedCalculationScope: seams.scope }));
vi.mock('./calculationEngineIdentity.js', () => ({ calculationEngineIdentity: seams.engine }));
import { createPathFinderJobs } from './jobs.js';
import { hash } from './dependencies.js';
import { defaultOptions } from './jobContracts.js';
import { PathFinderError } from './errors.js';
import type { PathFinderRepository } from './repository.js';

const id = (n: number) => 'd9200000-0000-4000-8000-' + n.toString(16).padStart(12, '0');
const projectId = id(1), who = { userId: id(2), loginId: id(3), loginExpiresAt: Date.parse('2099-01-01T00:00:00Z') };
function fixture() {
  const proposals = Array.from({ length: 8 }, (_, n) => {
    const dependencies = { schemaVersion: 'pathfinder.dependencies.v5', projectId, cableId: id(100 + n), cableWriteRevision: '7', options: { ...defaultOptions }, engineVersion: 'unchanged-test-version' };
    return { id: id(10 + n), project_id: projectId, job_id: id(50), cable_id: dependencies.cableId, status: 'calculated', proposal_hash: hash({ n }), dependency_hash: hash(dependencies),
      dependencies, job_state: 'complete', cancel_requested: false, created_at: '2026-10-20T00:00:00Z', result: { message: 'Sealed proposal.', calculationMode: 'calculate',
        route: { success: true, routeText: '/A', segmentIds: ['dbid:1'], pathPoints: [{ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }] },
        design: { designLengthMeters: '6' }, lengthLedger: { schemaVersion: 'synthetic-sealed-marker' } } };
  });
  const query = vi.fn(async (sql: string, args: unknown[] = []): Promise<{ rows: Record<string, unknown>[] }> => {
    if (sql.startsWith('SELECT id FROM projects')) return { rows: [{ id: projectId }] };
    if (sql.startsWith('SELECT is_admin')) return { rows: [{ is_admin: true }] };
    if (sql.startsWith('SELECT user_id,expires_at')) return { rows: [{ user_id: who.userId, expires_at: new Date(who.loginExpiresAt), revoked_at: null }] };
    if (sql.startsWith('SELECT * FROM pf_jobs')) return { rows: [] };
    if (sql.startsWith('SELECT p.*,j.state AS job_state')) {
      if (sql.includes('AND p.id=$2')) return { rows: proposals.filter(row => row.id === args[1]) };
      const limit = /LIMIT (\d+)/.exec(sql);
      if (!limit) throw Error('The state projection must declare a bounded recent-proposal window.');
      return { rows: proposals.slice(0, Number(limit[1])) };
    }
    return { rows: [] };
  });
  const release = vi.fn(), client = { query, release } as unknown as PoolClient, pool = { connect: async () => client } as unknown as Pool;
  seams.collect.mockImplementation(async (_client: unknown, _project: string, cableId: string) => ({ dependencies: proposals.find(row => row.cable_id === cableId)!.dependencies }));
  return { proposals, query, client, pool, release, jobs: createPathFinderJobs(pool, {} as PathFinderRepository) };
}
beforeEach(() => {
  vi.clearAllMocks(); seams.synthetic.mockResolvedValue(false); seams.scope.mockImplementation(() => undefined);
  seams.seal.mockResolvedValue({ revisionResultSha256: 'c'.repeat(64), baselineHash: 'd'.repeat(64), ledgerHash: 'e'.repeat(64), dependencyHash: 'f'.repeat(64) });
  seams.engine.mockResolvedValue({ contentSha256: 'a'.repeat(64) });
});

describe('bounded recent-proposal state preview', () => {
  it('validates every one of five recent proposals and keeps missing or changed dependencies non-applicable', async () => {
    const db = fixture();
    seams.collect.mockImplementation(async (_client: unknown, _project: string, cableId: string) => {
      const row = db.proposals.find(value => value.cable_id === cableId)!;
      if (row === db.proposals[0]) throw new PathFinderError('CABLE_NOT_FOUND', 404);
      return { dependencies: row === db.proposals[1] ? { ...row.dependencies, cableWriteRevision: '8' } : row.dependencies };
    });
    const value = await db.jobs.state(projectId, who);
    expect(value.proposals.map(row => row.id)).toEqual(db.proposals.slice(0, 5).map(row => row.id));
    expect(seams.collect).toHaveBeenCalledTimes(5); expect(seams.seal).toHaveBeenCalledTimes(5); expect(seams.synthetic).toHaveBeenCalledTimes(5);
    expect(value.proposals.slice(0, 2).every(row => row.stale && !row.canApply)).toBe(true);
    expect(value.proposals.slice(2).every(row => !row.stale && !row.canApply && row.compatibilityIssue?.includes('historical or unverified'))).toBe(true);
    expect(db.query.mock.calls.some(([sql]) => sql === 'SELECT is_admin FROM users WHERE id=$1 FOR SHARE')).toBe(true);
    expect(db.query.mock.calls.at(-1)?.[0]).toBe('COMMIT'); expect(db.release).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  it('still reads any exact historical proposal outside the preview window with fresh validation', async () => {
    const db = fixture(), row = db.proposals[7], value = await db.jobs.proposal(projectId, who, row.id);
    expect(value).toMatchObject({ id: row.id, canApply: false, stale: false }); expect(value.route?.points).toEqual([[0, 0, 0], [5, 0, 0]]);
    expect(seams.collect).toHaveBeenCalledExactlyOnceWith(db.client, projectId, row.cable_id, row.dependencies.options,row.dependencies.schemaVersion);
    expect(db.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
  });

  it('does not grant historical output new Review authority outside the state window', async () => {
    const db = fixture(), row = db.proposals[7];
    await expect(db.jobs.review(projectId, who, row.id, row.proposal_hash)).rejects.toMatchObject({code:'BARRIER_WRITE_PROOF_REQUIRED'});
    expect(seams.collect).not.toHaveBeenCalled();expect(seams.engine).not.toHaveBeenCalled();
    expect(db.query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO pf_reviews'))).toBe(false);
  });
});
