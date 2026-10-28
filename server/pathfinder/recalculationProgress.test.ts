// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { createRecalculationRepository, readRecalculationProgress } from './recalculationRepository.js';
import { recalculationFixture, RECALCULATION_FIXTURE as f } from './recalculationFixtures.js';

const counts = (change: Record<string, unknown> = {}) => ({ job_id: f.jobId, job_total: 2140, enrolled_total: 2140, ready_cables: 360, blocked_cables: 1780,
  total: 2140, eligible: 360, blocked_inputs: 1780, waiting: 360, running: 0, processed: 0, calculated: 0,
  saved: 0, saving: 0, review_required: 0, refused: 0, authority_expired: 0, stale: 0, not_scheduled_for_save: 0, ...change });
function reader(row: ReturnType<typeof counts> | null = counts()) {
  const query = vi.fn(async () => ({ rows: row ? [row] : [] }));
  return { query, client: { query } as unknown as PoolClient };
}
async function currentContext(row: ReturnType<typeof counts>, job: Record<string, unknown> = {}, state: Record<string, unknown> = {}) {
  const x = recalculationFixture(), original = x.query.getMockImplementation()!;
  Object.assign(x.db.state, { enrolled_generation: '2', current_job_id: f.jobId, total: row.total, ready_cables: row.eligible, blocked_cables: row.blocked_inputs, ...state });
  x.db.jobs.set(f.jobId, { state: 'running', cancel_requested: false, completed: row.processed + row.blocked_inputs, total: row.total, ...job });
  x.query.mockImplementation(async (raw, args) => String(raw).includes('recalculation:progress') ? { rows: [row], rowCount: 1 } : original(raw, args));
  return { ...x, context: await createRecalculationRepository(x.pool, x.adapter).context(f.projectId, x.who) };
}
describe('current-job calculation and Cable list progress', () => {
  it('reports zero processed of360 eligible separately from1780 input-blocked rows', async () => {
    const x = await currentContext(counts());
    expect(x.context).toMatchObject({ total: 2140, completed: 1780, readyCables: 360, blockedCables: 1780,
      progress: { jobId: f.jobId, generation: '2', eligible: 360, processed: 0, waiting: 360, calculated: 0, saved: 0 } });
  });
  it('uses the single aggregate snapshot even when the preceding job count was older', async () => {
    const x = await currentContext(counts({ waiting: 354, processed: 6, calculated: 6, saved: 6 }), { completed: 1780 });
    expect(x.context).toMatchObject({ completed: 1786, progress: { processed: 6, saved: 6 } });
  });
  it('reports303 calculated and saved, plus56 waiting and1 running, without treating eligibility as saved', async () => {
    const x = await currentContext(counts({ waiting: 56, running: 1, processed: 303, calculated: 303, saved: 303 }));
    expect(x.context).toMatchObject({ completed: 2083, progress: { eligible: 360, processed: 303, calculated: 303, saved: 303, waiting: 56, running: 1, saving: 0 } });
  });
  it('retains pending Cable list saves after native calculation job is complete', async () => {
    const x = await currentContext(counts({ job_total: 6, enrolled_total: 6, total: 6, ready_cables: 6, blocked_cables: 0, eligible: 6, blocked_inputs: 0,
      waiting: 0, processed: 6, calculated: 6, saved: 4, saving: 2 }), { state: 'complete' });
    expect(x.context).toMatchObject({ status: 'complete', completed: 6, progress: { calculated: 6, saved: 4, saving: 2 } });
  });
  it('keeps manual review, refusal, expired permission, stale and nonautomatic outcomes distinct', async () => {
    const x = await currentContext(counts({ job_total: 7, enrolled_total: 7, total: 7, ready_cables: 7, blocked_cables: 0, eligible: 7, blocked_inputs: 0,
      waiting: 0, processed: 7, calculated: 6, review_required: 2, refused: 1, authority_expired: 1, stale: 1, not_scheduled_for_save: 1 }), { state: 'complete' });
    expect(x.context.progress).toMatchObject({ processed: 7, calculated: 6, saved: 0, saving: 0, reviewRequired: 2,
      refused: 1, authorityExpired: 1, stale: 1, notScheduledForSave: 1, calculationFailed: 1 });
  });
  it('omits optional progress for older DTO fixtures and for absent/currently retired job scope', async () => {
    const old = recalculationFixture(); Object.assign(old.db.state, { enrolled_generation: '2', current_job_id: f.jobId, total: 1, ready_cables: 1, blocked_cables: 0 });
    old.db.jobs.set(f.jobId, { state: 'queued', cancel_requested: false, completed: 0, total: 1 });
    expect(await createRecalculationRepository(old.pool, old.adapter).context(f.projectId, old.who)).not.toHaveProperty('progress');
    const x = reader(null); expect(await readRecalculationProgress(x.client, { projectId: f.projectId, jobId: f.jobId, generation: '2' })).toBeNull();
    const newer = await currentContext(counts(), {}, { desired_generation: '3' });
    expect(newer.context).not.toHaveProperty('progress'); expect(newer.db.queries.some(sql => sql.includes('recalculation:progress'))).toBe(false);
  });
  it.each([{ total: 10001 }, { eligible: 359 }, { waiting: 359 }, { saved: 1 }, { job_total: 1 }, { enrolled_total: 1 },
    { ready_cables: 1 }, { blocked_cables: 1 }, { job_id: f.actorId }])('refuses inconsistent or oversized aggregate%j without manufacturing a completed result', async change => {
    const x = reader(counts(change)); await expect(readRecalculationProgress(x.client, { projectId: f.projectId, jobId: f.jobId, generation: '2' }))
      .rejects.toMatchObject({ code: 'RECALCULATION_PROGRESS_UNAVAILABLE', status: 503 });
  });
  it('binds exact project, job, real enrollment and generation; reads only bounded metadata', async () => {
    const x = reader(); await readRecalculationProgress(x.client, { projectId: f.projectId, jobId: f.jobId, generation: '2' });
    expect(x.query).toHaveBeenCalledOnce(); const [sql, parameters] = x.query.mock.calls[0] as unknown as [string, string[]];
    expect(parameters).toEqual([f.projectId, f.jobId, '2']);
    expect(sql).toContain('e.project_id=s.project_id AND e.job_id=s.current_job_id AND e.generation=s.enrolled_generation');
    expect(sql).toContain('s.project_id=$1 AND s.current_job_id=$2 AND s.desired_generation=$3::bigint AND s.enrolled_generation=$3::bigint');
    expect(sql).toContain('d.project_id=$1 AND d.job_id=j.id AND d.cable_id=i.cable_id');
    expect(sql).toContain("output_status IN('written','already-written') AND receipt_id IS NOT NULL");
    expect(sql).toContain('LIMIT 10001'); expect(sql).toContain('i.dependencies IS NOT NULL AS eligible');
    expect(sql).not.toMatch(/\b(?:UPDATE|INSERT|DELETE|ALTER)\b|FOR SHARE|SELECT \* FROM pf_job_items|pf_proposals|auto_length|route\.success/);
  });
});
