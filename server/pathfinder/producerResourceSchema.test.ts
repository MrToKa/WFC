// @vitest-environment node
import type { Pool, PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { initializeProducerResourceSchema, PRODUCER_RESOURCE_SQL } from './producerResourceSchema.js';
import { schedulerTransaction } from './schedulerTransaction.js';
vi.mock('./schedulerTransaction.js', () => ({ schedulerTransaction: vi.fn() }));
describe('separate producer capability persistence', () => {
  it('initializes in the root-owned bounded scheduler transaction with serialized schema ownership', async () => {
    const query = vi.fn(async () => ({ rows: [] })); vi.mocked(schedulerTransaction).mockImplementation(async (_pool, operation) => operation({ query } as unknown as PoolClient));
    await initializeProducerResourceSchema({} as Pool); expect(query).toHaveBeenNthCalledWith(1, expect.stringContaining('pg_advisory_xact_lock')); expect(query).toHaveBeenNthCalledWith(2, PRODUCER_RESOURCE_SQL);
  });
  it('binds one finite resource session per actual lease without adding human identity or mutable grant authority', () => {
    expect(PRODUCER_RESOURCE_SQL).toContain('lease_id uuid NOT NULL UNIQUE'); expect(PRODUCER_RESOURCE_SQL).toContain("interval '15 minutes'"); expect(PRODUCER_RESOURCE_SQL).toContain('REFERENCES pf_calculation_grant_leases(project_id,id)');
    expect(PRODUCER_RESOURCE_SQL).not.toMatch(/viewer_resource_sessions|viewer_login_bindings|REFERENCES users|owner_token|cookie_secret/); expect(PRODUCER_RESOURCE_SQL).toContain("to_jsonb(OLD)-'revoked_at'");
  });
});
