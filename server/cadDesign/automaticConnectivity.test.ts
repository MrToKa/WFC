// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import {
  CAD_CONNECTIVITY_POLICY,
  initializeCadAutomaticConnectivity,
} from './automaticConnectivity.js';

describe('current automatic CAD policy adoption', () => {
  it('dirties only published projects once, without enabling automation or rewriting sealed CAD records', async () => {
    let marker: string | null = null;
    const query = vi.fn(async (sql: string) => {
        if (sql.startsWith('UPDATE pf_recalculation_state')) {
          const rows =
            marker === CAD_CONNECTIVITY_POLICY
              ? []
              : [{ project_id: '00000000-0000-4000-8000-000000000001' }];
          marker = CAD_CONNECTIVITY_POLICY;
          return { rows };
        }
        return { rows: [] };
      }),
      release = vi.fn(),
      pool = { connect: async () => ({ query, release }) } as unknown as Pool;
    await initializeCadAutomaticConnectivity(pool);
    await initializeCadAutomaticConnectivity(pool);
    expect(
      query.mock.calls.filter(([sql]) => sql.startsWith('SELECT pf_recalculation_dirty')),
    ).toHaveLength(1);
    const update = query.mock.calls.find(([sql]) =>
      sql.startsWith('UPDATE pf_recalculation_state'),
    )![0];
    expect(update).toContain("g.status='published'");
    expect(update).toContain('g.project_id=s.project_id');
    expect(
      query.mock.calls.some(([sql]) =>
        /SET enabled|UPDATE cad_route_groups|UPDATE pf_proposals|UPDATE pf_apply_receipts/.test(
          sql,
        ),
      ),
    ).toBe(false);
    expect(query.mock.calls.filter(([sql]) => sql === 'COMMIT')).toHaveLength(2);
  });
  it('does not dirty a project without a published CAD route', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    await initializeCadAutomaticConnectivity({
      connect: async () => ({ query, release: vi.fn() }),
    } as unknown as Pool);
    expect(query.mock.calls).toHaveLength(4);
  });
  it('rolls back the policy marker if its invalidation event fails', async () => {
    const query = vi.fn(async (sql: string) => {
        if (sql.startsWith('UPDATE pf_recalculation_state'))
          return { rows: [{ project_id: '00000000-0000-4000-8000-000000000001' }] };
        if (sql.startsWith('SELECT pf_recalculation_dirty')) throw Error('event failure');
        return { rows: [] };
      }),
      release = vi.fn();
    await expect(
      initializeCadAutomaticConnectivity({
        connect: async () => ({ query, release }),
      } as unknown as Pool),
    ).rejects.toThrow('event failure');
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    expect(query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(false);
    expect(release).toHaveBeenCalledExactlyOnceWith(undefined);
  });
});
