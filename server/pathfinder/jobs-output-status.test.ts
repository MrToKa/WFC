// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { createPathFinderJobs } from './jobs.js';
import type { PathFinderRepository } from './repository.js';
const fx = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('./auth.js', () => ({ assertLoginNotExpired: vi.fn(), principalTransaction: async (_pool: unknown, _project: string, _who: unknown, read: (client: unknown) => unknown) => read({ query: fx.query }) }));
const id = (n: number) => `1e730000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const who = { userId: id(2), loginId: id(3), loginExpiresAt: Date.parse('2099-01-01T00:00:00Z') };
const repository = () => createPathFinderJobs({} as Pool, {} as PathFinderRepository);
const row = (jobId: string) => ({ id: jobId, project_id: id(1), state: 'complete', total: 1, completed: 1, cancel_requested: false, failure: null, attempts: 1, created_at: '2026-10-27T00:00:00Z', updated_at: '2026-10-27T00:00:01Z' });
const item = (extra = {}) => ({ cable_id: id(4), state: 'complete', status: 'calculated', message: 'Route found.', ...extra });
beforeEach(() => vi.clearAllMocks());
describe('read-only job output disposition', () => {
  it('joins only the requested project/job/cable, never the cable latest output from another job', async () => {
    fx.query.mockImplementation(async (sql: string, args: string[]) => {
      if (sql.startsWith('SELECT * FROM pf_jobs')) return { rows: [row(args[1])] };
      expect(sql).toContain('d.project_id=i.project_id AND d.job_id=i.job_id AND d.cable_id=i.cable_id');
      expect(sql).toContain('WHERE i.project_id=$1 AND i.job_id=$2');
      return { rows: [item({ automatic_update_status: args[1] === id(5) ? 'refused' : 'written',
        automatic_update_receipt: args[1] === id(5) ? null : id(8), automatic_update_reason: args[1] === id(5) ? 'PROPOSAL_NOT_APPLICABLE' : null })] };
    });
    expect((await repository().get(id(1), who, id(5))).items[0]).toMatchObject({ status: 'calculated', automaticUpdate: { status: 'refused', receiptId: null, reasonCode: 'PROPOSAL_NOT_APPLICABLE' } });
    expect((await repository().get(id(1), who, id(6))).items[0]).toMatchObject({ automaticUpdate: { status: 'written', receiptId: id(8), reasonCode: null } });
    expect(fx.query.mock.calls.every(([sql]) => sql.startsWith('SELECT ') || sql.startsWith('/* job-output-items */ SELECT '))).toBe(true);
  });
  it('keeps historical calculation items without an automatic write mandate unchanged', async () => {
    fx.query.mockResolvedValueOnce({ rows: [row(id(5))] }).mockResolvedValueOnce({ rows: [item({ automatic_update_status: null })] });
    expect((await repository().get(id(1), who, id(5))).items).toEqual([{ cableId: id(4), status: 'calculated', state: 'complete', message: 'Route found.' }]);
  });
  it.each([{ automatic_update_status: 'unknown-status' }, { automatic_update_status: 'written', automatic_update_receipt: null },
    { automatic_update_status: 'refused', automatic_update_reason: 'BAD\nREASON' }])('rejects malformed stored output status without claiming success: %j', async extra => {
    fx.query.mockResolvedValueOnce({ rows: [row(id(5))] }).mockResolvedValueOnce({ rows: [item(extra)] });
    await expect(repository().get(id(1), who, id(5))).rejects.toMatchObject({ code: 'JOB_AUTOMATIC_UPDATE_INVALID' });
  });
});
