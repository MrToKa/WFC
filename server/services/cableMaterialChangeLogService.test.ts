// @vitest-environment node
import { expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import type { CableMaterialRow } from '../models/cableMaterial.js';
import {
  describeCableMaterialChanges,
  recordCableMaterialChanges,
} from './cableMaterialChangeLogService.js';

const material: CableMaterialRow = {
  id: 'material',
  cable_id: 'cable',
  name: 'Cleat',
  quantity: '2.00',
  unit: 'pcs',
  remarks: null,
  source: 'manual',
  cable_type_default_material_id: null,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
};

it('records edits, including cleared values and unit changes', () => {
  expect(
    describeCableMaterialChanges(
      [material],
      [{ ...material, quantity: null, unit: 'meters', remarks: 'Updated' }],
    ),
  ).toEqual([
    'Material "Cleat" / Quantity: 2 → Not specified',
    'Material "Cleat" / Unit: pcs → meters',
    'Material "Cleat" / Remarks: Not specified → Updated',
  ]);
});

it('records additions and removals with their values', () => {
  expect(describeCableMaterialChanges([], [material])).toEqual([
    'Added material "Cleat" (Quantity: 2; Unit: pcs; Remarks: Not specified; Source: Manual)',
  ]);
  expect(describeCableMaterialChanges([material], [])).toEqual([
    'Removed material "Cleat" (Quantity: 2; Unit: pcs; Remarks: Not specified; Source: Manual)',
  ]);
});

it('ignores numeric formatting, timestamps and identical rows recreated by reload', () => {
  expect(
    describeCableMaterialChanges(
      [material],
      [{ ...material, id: 'new', quantity: 2, updated_at: '2026-02-01' }],
    ),
  ).toEqual([]);
  expect(describeCableMaterialChanges([material], [{ ...material, quantity: 2 }])).toEqual([]);
});

it('records reload changes while preserving the history of manual materials', () => {
  const inherited: CableMaterialRow = {
    ...material,
    id: 'default',
    name: 'Gland',
    source: 'default',
  };
  const changes = describeCableMaterialChanges(
    [material, inherited],
    [material, { ...inherited, quantity: 4 }],
  );
  expect(changes).toEqual(['Material "Gland" / Quantity: 2 → 4']);
});

it('does not write a history entry for an unchanged save', async () => {
  const query = vi.fn();
  expect(
    await recordCableMaterialChanges(
      { query } as unknown as PoolClient,
      'cable',
      'actor',
      [material],
      [material],
    ),
  ).toBeNull();
  expect(query).not.toHaveBeenCalled();
});
