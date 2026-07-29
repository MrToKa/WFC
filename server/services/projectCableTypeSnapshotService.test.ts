import { describe, expect, it, vi } from 'vitest';
import type { PoolClient, QueryResult } from 'pg';
import { snapshotStandardMaterialsToProjectCableType } from './projectCableTypeSnapshotService.js';

const queryResult = <T extends Record<string, unknown>>(rows: T[]): QueryResult<T> => ({
  command: 'SELECT',
  rowCount: rows.length,
  oid: 0,
  fields: [],
  rows,
});

describe('Project Cable Type Standard Material snapshots', () => {
  it('copies expanded defaults with stable provenance and historical values', async () => {
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes('UNION ALL')) {
        return queryResult([
          {
            id: '00000000-0000-4000-8000-000000000010',
            owner_id: '00000000-0000-4000-8000-000000000020',
            owner_category: 'cable-type',
            referenced_material_id: '00000000-0000-4000-8000-000000000030',
            referenced_material_name: 'Cable gland M32',
            referenced_material_purpose: null,
            referenced_material_material: 'Brass',
            referenced_material_description: 'Historical gland description',
            referenced_material_manufacturer: 'Maker',
            referenced_material_part_no: 'M32',
            quantity: '2',
            unit: 'pcs',
            remarks: 'Fit at both ends',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          },
        ]);
      }
      if (sql.includes('INSERT INTO cable_type_default_materials')) {
        expect(values?.slice(2)).toEqual([
          'Cable gland M32',
          2,
          'pcs',
          'Fit at both ends',
          '00000000-0000-4000-8000-000000000030',
          ['00000000-0000-4000-8000-000000000010'],
        ]);
      }
      return queryResult([]);
    });

    const count = await snapshotStandardMaterialsToProjectCableType(
      { query } as unknown as PoolClient,
      '00000000-0000-4000-8000-000000000040',
      '00000000-0000-4000-8000-000000000020',
      { replaceInherited: false },
    );

    expect(count).toBe(1);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('removes inherited defaults only during source replacement', async () => {
    const query = vi.fn(async (_sql: string) => queryResult([]));
    await snapshotStandardMaterialsToProjectCableType(
      { query } as unknown as PoolClient,
      '00000000-0000-4000-8000-000000000040',
      '00000000-0000-4000-8000-000000000020',
      { replaceInherited: true },
    );
    expect(String(query.mock.calls[0][0])).toContain("source_kind = 'standard-material'");
    expect(String(query.mock.calls[0][0])).not.toContain("source_kind = 'manual'");
  });
});
