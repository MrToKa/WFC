// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import type { CableMaterialRow } from '../models/cableMaterial.js';
import type { CableTypeDefaultMaterialRow } from '../models/cableTypeDefaultMaterial.js';
import {
  captureInstallationMaterial,
  effectiveCableMaterials,
  inheritedCableMaterialId,
  materializeCableDefaultRows,
  projectDefaultToCableMaterial,
  replaceInheritedCableMaterials,
} from './cableMaterialSnapshotService.js';

const cableId = '00000000-0000-4000-8000-000000000001';
const timestamp = '2026-09-12T00:00:00Z';
const captured = captureInstallationMaterial({ id: 'catalog-1', type: 'Gland', unit_price: 4 });
const defaultRow = (
  id: string,
  source: 'manual' | 'standard-material',
): CableTypeDefaultMaterialRow => ({
  id,
  cable_type_id: 'type-1',
  name: 'Gland',
  quantity: 2,
  unit: 'pcs',
  remarks: null,
  source_kind: source,
  current_material_id: 'catalog-1',
  material_snapshot: captured,
  created_at: timestamp,
  updated_at: timestamp,
});
const existingRow = (id: string, origin: CableMaterialRow['origin_kind']): CableMaterialRow => ({
  ...projectDefaultToCableMaterial(cableId, defaultRow(id, 'standard-material')),
  id,
  origin_kind: origin,
  is_virtual: false,
});

describe('captured cable material scopes', () => {
  it('keeps project and cable additions alongside pure virtual inherited rows', () => {
    const defaults = [
      defaultRow('catalog-default', 'standard-material'),
      defaultRow('project-default', 'manual'),
    ];
    const local = { ...existingRow('individual', 'cable-added'), source: 'manual' as const };
    const input = JSON.stringify({ defaults, local });
    const first = effectiveCableMaterials(cableId, [local], defaults, false, false);
    expect(first.map((row) => row.origin_kind)).toEqual([
      'cable-added',
      'catalog-inherited',
      'project-added',
    ]);
    expect(first).toEqual(effectiveCableMaterials(cableId, [local], defaults, false, false));
    expect(first[1].material_snapshot?.values.unit_price).toBe(4);
    expect(JSON.stringify({ defaults, local })).toBe(input);
  });

  it('does not restore a deliberately empty customized list or infer an origin from names', () => {
    const defaults = [defaultRow('catalog-default', 'standard-material')];
    expect(effectiveCableMaterials(cableId, [], defaults, true, true)).toEqual([]);
    const legacy = {
      ...existingRow('legacy', null),
      source: null,
      cable_type_default_material_id: null,
    };
    expect(effectiveCableMaterials(cableId, [legacy], [], false, false)).toEqual([legacy]);
    expect(legacy.origin_kind).toBeNull();
  });

  it('materializes an explicit write with exactly the UUID and snapshot previously read', async () => {
    const item = defaultRow('project-default', 'manual');
    const virtual = effectiveCableMaterials(cableId, [], [item], false, false)[0];
    const query = vi.fn(async () => ({ rows: [], rowCount: 1 }));
    await materializeCableDefaultRows({ query } as unknown as PoolClient, cableId, [item], []);
    const values = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(values[1][0]).toBe(virtual.id);
    expect(values[1][9]).toBe('project-added');
    expect(JSON.parse(String(values[1][8]))).toEqual(captured);
    expect(inheritedCableMaterialId('other-cable', item.id)).not.toBe(virtual.id);
  });

  it('keeps the original identity when explicitly selecting a different current material', () => {
    const next = captureInstallationMaterial(
      { id: 'catalog-2', type: 'New gland', unit_price: 7 },
      captured,
    );
    expect(next.originMaterialId).toBe('catalog-1');
    expect(next.values.id).toBe('catalog-2');
    expect(captured.values.unit_price).toBe(4);
    expect(captureInstallationMaterial({ id: 'selected-now' }, null).originMaterialId).toBeNull();
    expect(
      captureInstallationMaterial({ id: 'catalog-2' }, { ...captured, originMaterialId: null })
        .originMaterialId,
    ).toBeNull();
  });

  it('replaces only inherited catalog rows and retains explicit and unknown local history', async () => {
    const rows = [
      existingRow('old-inherited', 'catalog-inherited'),
      existingRow('project-addition', 'project-added'),
      existingRow('cable-addition', 'cable-added'),
      existingRow('legacy-unknown', null),
    ];
    const query = vi.fn(async (sql: string, _values?: unknown[]) => ({
      rows: sql.startsWith('SELECT') ? rows : [],
      rowCount: 1,
    }));
    await replaceInheritedCableMaterials({ query } as unknown as PoolClient, cableId, [
      defaultRow('new-inherited', 'standard-material'),
    ]);
    const deletion = query.mock.calls.find(([sql]) => sql.startsWith('DELETE'));
    expect(deletion?.[1]).toEqual([cableId, ['old-inherited']]);
    expect(query.mock.calls.filter(([sql]) => sql.startsWith('INSERT'))).toHaveLength(1);
  });

  it('retains an inherited override without changing its values or any other cable', async () => {
    const query = vi.fn(async (_sql: string) => ({
      rows: [{ ...existingRow('edited', 'catalog-inherited'), inherited_override: true }],
    }));
    await replaceInheritedCableMaterials({ query } as unknown as PoolClient, cableId, []);
    expect(query.mock.calls.some(([sql]) => sql.startsWith('DELETE') || sql.startsWith('INSERT') || sql.startsWith('UPDATE cable_materials'))).toBe(false);
    expect(query.mock.calls[0][0]).toContain('FOR UPDATE');
  });
});
