// @vitest-environment node
import type { Request, Response } from 'express';
import type { Pool, PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { createJobSubmissionHandler } from './jobSubmissionRoutes.js';
import { PathFinderError } from './errors.js';
import { transaction } from './transactions.js';

const projectId = '11111111-1111-4111-8111-111111111111';
function fixture() {
  const req = { params: { projectId }, body: { expectedRegistryRevision: '7', force: true },
    userId: '22222222-2222-4222-8222-222222222222', loginId: '33333333-3333-4333-8333-333333333333', loginExpiresAt: Date.now() + 60_000 } as unknown as Request;
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  return { req, res, response: res as unknown as Response };
}
describe('calculation submission phase evidence', () => {
  it('returns the committed acknowledgement unchanged', async () => {
    const f = fixture(), result = { jobId: projectId, registryRevision: '7', duplicate: false }, create = vi.fn(async () => result);
    await createJobSubmissionHandler(create)(f.req, f.response);
    expect(f.res.status).toHaveBeenCalledWith(202); expect(f.res.json).toHaveBeenCalledWith(result); expect(create).toHaveBeenCalledOnce();
  });
  it('marks a matching conflict as no calculation committed for this invocation', async () => {
    const f = fixture(), create = vi.fn(async () => { throw new PathFinderError('ENDPOINT_PREPARATION_REQUIRED', 409, 'Prepare the current model.'); });
    await createJobSubmissionHandler(create)(f.req, f.response);
    expect(f.res.status).toHaveBeenCalledWith(409);
    expect(f.res.json).toHaveBeenCalledWith({ schemaVersion: 'wfc.pf.calculation-submission-refusal.v1', calculationSubmitted: false,
      code: 'ENDPOINT_PREPARATION_REQUIRED', error: 'Prepare the current model.' });
  });
  it.each(['matching', 'job-admission'] as const)('keeps lost %s COMMIT acknowledgement unknown even when driver reports409', async phase => {
    const f = fixture(), calls: string[] = [], release = vi.fn();
    const query = vi.fn(async (sql: string) => { calls.push(sql); if (sql === 'COMMIT') throw new PathFinderError('REGISTRY_CONFLICT', 409); return { rows: [] }; });
    const client = { query, release } as unknown as PoolClient, pool = { connect: async () => client } as unknown as Pool;
    await createJobSubmissionHandler(async () => transaction(pool, async c => { await c.query(`SYNTHETIC ${phase}`); return { jobId: projectId }; }))(f.req, f.response);
    expect(f.res.status).toHaveBeenCalledWith(503); expect(f.res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'PATHFINDER_COMMIT_OUTCOME_UNKNOWN' }));
    expect(f.res.json.mock.calls[0][0]).not.toHaveProperty('calculationSubmitted');
    expect(calls).toEqual(['BEGIN', `SYNTHETIC ${phase}`, 'COMMIT']); expect(release).toHaveBeenCalledWith(true);
  });
  it('marks a conflict after provisional job insertion only after rollback', async () => {
    const f = fixture(), calls: string[] = [];
    const client = { query: async (sql: string) => { calls.push(sql); return { rows: [] }; }, release: vi.fn() } as unknown as PoolClient;
    const pool = { connect: async () => client } as unknown as Pool;
    await createJobSubmissionHandler(async () => transaction(pool, async c => {
      await c.query('SYNTHETIC JOB INSERT'); throw new PathFinderError('BARRIER_CALCULATION_SCOPE_CHANGED', 409);
    }))(f.req, f.response);
    expect(calls).toEqual(['BEGIN', 'SYNTHETIC JOB INSERT', 'ROLLBACK']); expect(f.res.status).toHaveBeenCalledWith(409);
    expect(f.res.json).toHaveBeenCalledWith(expect.objectContaining({ calculationSubmitted: false }));
  });
  it('does not call admission for an invalid body', async () => {
    const f = fixture(), create = vi.fn(); f.req.body = { ...f.req.body, unexpected: true };
    await createJobSubmissionHandler(create)(f.req, f.response);
    expect(create).not.toHaveBeenCalled(); expect(f.res.status).toHaveBeenCalledWith(400);
  });
  it('never reclassifies failure while sending a successful acknowledgement', async () => {
    const f = fixture(), lost = new Error('Synthetic transport loss.'); f.res.json.mockImplementation(() => { throw lost; });
    await expect(createJobSubmissionHandler(async () => ({ jobId: projectId }))(f.req, f.response)).rejects.toBe(lost);
    expect(f.res.status).toHaveBeenCalledExactlyOnceWith(202);
  });
});
