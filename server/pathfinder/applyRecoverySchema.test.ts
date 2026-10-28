// @vitest-environment node
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { APPLY_RECOVERY_SQL, initializeApplyRecoverySchema } from './applyRecoverySchema.js';

describe('immutable tenant-scoped Apply abandonment schema', () => {
  it('adds only closure history, retains audit after cable/user deletion, and cannot close a foreign proposal', async () => {
    const query = vi.fn(async (_sql: string) => ({ rows: [] })), release = vi.fn();
    await initializeApplyRecoverySchema({ connect: async () => ({ query, release }) } as unknown as Pool);
    expect(query.mock.calls[0]).toEqual(['BEGIN']); expect(query.mock.calls.at(-1)).toEqual(['COMMIT']);
    expect(APPLY_RECOVERY_SQL).toContain('PRIMARY KEY(project_id,actor_id,idempotency_key)');
    expect(APPLY_RECOVERY_SQL).toContain('FOREIGN KEY(project_id,proposal_id) REFERENCES pf_proposals(project_id,id)');
    expect(APPLY_RECOVERY_SQL).toContain('expected_cable_write_revision bigint NOT NULL CHECK(expected_cable_write_revision>=0)');
    expect(APPLY_RECOVERY_SQL).toContain("payload_hash~'^[a-f0-9]{64}$'");
    expect(APPLY_RECOVERY_SQL).not.toMatch(/REFERENCES (?:cables|users|viewer_login_bindings)\b/);
    expect(APPLY_RECOVERY_SQL).not.toMatch(/(?:UPDATE|DELETE FROM|INSERT INTO)\s+(?:cables|pf_proposals|pf_reviews|pf_apply_receipts|pf_jobs)\b/i);
    expect(release).toHaveBeenCalledExactlyOnceWith(undefined);
  });
  it('forbids both update and delete while a project exists, permitting only project cascade', () => {
    expect(APPLY_RECOVERY_SQL).toContain('BEFORE UPDATE OR DELETE ON pf_apply_abandonments');
    expect(APPLY_RECOVERY_SQL).toContain("TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id)");
    expect(APPLY_RECOVERY_SQL).toContain("RAISE EXCEPTION 'PathFinder Apply abandonment is immutable'");
  });
  it.each(['ddl', 'commit', 'rollback'] as const)('retains %s failure and discards an uncertain connection', async phase => {
    const query = vi.fn(async (sql: string) => {
      if (phase === 'commit' ? sql === 'COMMIT' : sql === APPLY_RECOVERY_SQL || phase === 'rollback' && sql === 'ROLLBACK') throw Error('retained failure');
      return { rows: [] };
    }), release = vi.fn();
    await expect(initializeApplyRecoverySchema({ connect: async () => ({ query, release }) } as unknown as Pool)).rejects.toThrow('retained failure');
    expect(release).toHaveBeenCalledExactlyOnceWith(phase === 'ddl' ? undefined : true);
  });
});
