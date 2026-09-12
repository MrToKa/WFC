// @vitest-environment node
import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import {
  captureTrayMaterialSnapshot,
  syncProjectSupportSnapshots,
  type SupportMaterialSnapshot,
} from './projectCatalogSnapshotService.js';

describe('project catalog capture boundaries', () => {
  it('does not infer a source for missing or ambiguous new tray names', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const client = { query } as unknown as PoolClient;
    expect(await captureTrayMaterialSnapshot(client, null)).toBeNull();
    expect(query).not.toHaveBeenCalled();
    expect(await captureTrayMaterialSnapshot(client, 'Missing')).toBeNull();
    query.mockResolvedValue({ rows: [{ id: 'one' }, { id: 'two' }] });
    expect(await captureTrayMaterialSnapshot(client, 'Ambiguous')).toBeNull();
    expect(query.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
  });

  it.each([
    null,
    { schemaVersion: 1, material: { id: 'source', weightKg: 3 } } as SupportMaterialSnapshot,
  ])('preserves the same source snapshot, including historical unknown %j', async (snapshot) => {
    const query = vi.fn(async (sql: string) =>
      sql.startsWith('SELECT tray_type')
        ? { rows: [{ tray_type: 'Tray', support_id: 'source', support_snapshot: snapshot }] }
        : { rows: [] },
    );
    await syncProjectSupportSnapshots({ query } as unknown as PoolClient, 'project', {
      Tray: { distance: 4, supportId: 'source' },
    });
    expect(query.mock.calls.some(([sql]) => sql.includes('FROM material_supports'))).toBe(false);
    const insert = query.mock.calls.find(([sql]) =>
      sql.includes('INSERT INTO project_support_distances'),
    );
    expect(insert).toBeDefined();
    expect(query).toHaveBeenLastCalledWith(expect.any(String), [
      'project',
      'Tray',
      4,
      'source',
      snapshot,
    ]);
  });

  it('preserves a retired identity snapshot without recreating the deleted catalog foreign key', async () => {
    const snapshot = {
      schemaVersion: 1,
      material: { id: 'retired', weightKg: 3 },
    } as SupportMaterialSnapshot;
    const query = vi.fn(async (sql: string) =>
      sql.startsWith('SELECT tray_type')
        ? { rows: [{ tray_type: 'Tray', support_id: null, support_snapshot: snapshot }] }
        : { rows: [] },
    );
    await syncProjectSupportSnapshots({ query } as unknown as PoolClient, 'project', {
      Tray: { distance: 4, supportId: 'retired' },
    });
    expect(query).toHaveBeenLastCalledWith(expect.any(String), [
      'project',
      'Tray',
      4,
      null,
      snapshot,
    ]);
  });
});
