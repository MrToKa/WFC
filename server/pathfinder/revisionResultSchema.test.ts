// @vitest-environment node
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { initializeRevisionResultSchema, REVISION_RESULT_SQL } from './revisionResultSchema.js';

describe('additive immutable cable revision schema', () => {
  it('creates tenant-bound admissions, baselines and seals without mutating historical facts', async () => {
    const query = vi.fn(async (_sql: string) => ({ rows: [] })), release = vi.fn();
    await initializeRevisionResultSchema({ connect: async () => ({ query, release }) } as unknown as Pool);
    expect(query.mock.calls[0]).toEqual(['BEGIN']); expect(query.mock.calls.at(-1)).toEqual(['COMMIT']);
    expect(REVISION_RESULT_SQL).not.toMatch(/(?:UPDATE|DELETE FROM|INSERT INTO)\s+(?:cables|pf_proposals|pf_apply_receipts|pf_reviews|pf_jobs)\b/i);
    expect(REVISION_RESULT_SQL).toContain('FOREIGN KEY(project_id,admission_id,job_id)');
    expect(REVISION_RESULT_SQL).toContain('FOREIGN KEY(project_id,admission_id,cable_id)');
    expect(REVISION_RESULT_SQL).toContain("kind='automatic' AND generation IS NOT NULL");
    expect(query.mock.calls.filter(call => String(call[0]).startsWith('CREATE TRIGGER'))).toHaveLength(3);
  });
  it('retains all-blocked no-job admission and separate uniqueness, and allows deletion only after project removal', () => {
    expect(REVISION_RESULT_SQL).toContain("WHERE job_id IS NOT NULL");
    expect(REVISION_RESULT_SQL).toContain("WHERE kind='automatic'");
    expect(REVISION_RESULT_SQL).toContain("TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id)");
    expect(REVISION_RESULT_SQL).toContain("RAISE EXCEPTION 'Cable revision admission, baseline and result are immutable'");
    expect(REVISION_RESULT_SQL).not.toMatch(/REFERENCES cables\s*\(/);
  });
  it.each(['ddl', 'commit', 'rollback'] as const)('retains %s failure and discards uncertain connections', async phase => {
    const query = vi.fn(async (sql: string) => { if (phase === 'commit' ? sql === 'COMMIT' : sql === REVISION_RESULT_SQL || phase === 'rollback' && sql === 'ROLLBACK') throw Error('retained failure'); return { rows: [] }; }), release = vi.fn();
    await expect(initializeRevisionResultSchema({ connect: async () => ({ query, release }) } as unknown as Pool)).rejects.toThrow('retained failure');
    expect(release).toHaveBeenCalledExactlyOnceWith(phase === 'ddl' ? undefined : true);
  });
});
