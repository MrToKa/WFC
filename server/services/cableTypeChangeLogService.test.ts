// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import {
  describeCableTypeChanges,
  recordCableTypeChanges,
  type CableTypeSnapshot,
} from './cableTypeChangeLogService.js';

const snapshot: CableTypeSnapshot = {
  cableType: {
    id: 'type',
    project_id: 'project',
    name: 'Cable',
    purpose: 'Power',
    diameter_mm: '12.00',
    weight_kg_per_m: '2.000',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  },
  materials: [
    {
      id: 'material',
      cable_type_id: 'type',
      name: 'Cleat',
      quantity: '2.00',
      unit: 'pcs',
      remarks: null,
      source_kind: 'manual',
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    },
  ],
};

describe('cable type change tracker', () => {
  it('ignores timestamps, numeric formatting and recreated material IDs', () => {
    expect(
      describeCableTypeChanges(snapshot, {
        cableType: { ...snapshot.cableType, diameter_mm: 12, updated_at: '2026-02-01' },
        materials: [{ ...snapshot.materials[0], id: 'imported', quantity: 2 }],
      }),
    ).toEqual([]);
  });
  it('records field edits and cleared values', () => {
    expect(
      describeCableTypeChanges(snapshot, {
        ...snapshot,
        cableType: { ...snapshot.cableType, diameter_mm: 14, purpose: null },
      }),
    ).toEqual(['Purpose: Power → Not specified', 'Diameter [mm]: 12 → 14']);
  });
  it('records material quantities, remarks, additions and removals', () => {
    const changes = describeCableTypeChanges(snapshot, {
      ...snapshot,
      materials: [{ ...snapshot.materials[0], quantity: 3, remarks: 'Updated' }],
    });
    expect(changes).toHaveLength(2);
    expect(changes[0]).toContain('Removed default material "Cleat" (Quantity: 2;');
    expect(changes[1]).toContain('Added default material "Cleat" (Quantity: 3;');
    expect(changes[1]).toContain('Remarks: Updated');
  });
  it('counts identical material rows and detects inherited source changes', () => {
    expect(
      describeCableTypeChanges(snapshot, {
        ...snapshot,
        materials: [...snapshot.materials, ...snapshot.materials],
      }),
    ).toHaveLength(1);
    expect(
      describeCableTypeChanges(snapshot, {
        ...snapshot,
        materials: [{ ...snapshot.materials[0], source_kind: 'standard-material' }],
      }).join(' '),
    ).toContain('Inherited from Materials');
  });
  it('records creation with initial values and materials', () => {
    expect(describeCableTypeChanges(null, snapshot)).toEqual(
      expect.arrayContaining([
        'Cable type created.',
        'Type: Not specified → Cable',
        expect.stringContaining('Added default material "Cleat"'),
      ]),
    );
  });
  it('stores the authenticated actor and locks the parent before reading materials', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [snapshot.cableType] })
      .mockResolvedValueOnce({ rows: snapshot.materials })
      .mockResolvedValueOnce({ rows: [{ name: 'Editor' }] })
      .mockResolvedValueOnce({ rowCount: 1 });
    const entry = await recordCableTypeChanges(
      { query } as unknown as PoolClient,
      'project',
      'type',
      'actor',
      null,
    );
    expect(query.mock.calls[0]).toEqual([
      expect.stringContaining('FOR UPDATE'),
      ['project', 'type'],
    ]);
    expect(entry).toMatchObject({
      userId: 'actor',
      userName: 'Editor',
      changes: expect.arrayContaining(['Cable type created.']),
    });
    expect(query.mock.calls[3]).toEqual([
      expect.stringContaining('change_log = change_log ||'),
      ['type', JSON.stringify([entry])],
    ]);
  });
  it('does not write history for unchanged saves', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [snapshot.cableType] })
      .mockResolvedValueOnce({ rows: snapshot.materials });
    expect(
      await recordCableTypeChanges(
        { query } as unknown as PoolClient,
        'project',
        'type',
        'actor',
        snapshot,
      ),
    ).toBeNull();
    expect(query).toHaveBeenCalledTimes(2);
  });
});
