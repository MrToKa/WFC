// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  describeMaterialEvents,
  mapMaterialChangeLogRow,
  type MaterialChangeEvent,
} from './materialChangeLogService.js';

const event = (
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): MaterialChangeEvent => ({
  kind: 'material',
  key: 'material-1',
  label: null,
  before,
  after,
});

describe('material change descriptions', () => {
  it('describes edits and cleared fields without timestamps or IDs', () => {
    expect(
      describeMaterialEvents([
        event(
          { id: '1', unit_price: 2, source: 'https://old.example', updated_at: 'old' },
          { id: '1', unit_price: 3, source: null, updated_at: 'new' },
        ),
      ]),
    ).toEqual(['Price: 2 → 3', 'Source: https://old.example → Not specified']);
  });

  it('collapses a transaction to the initial and final values', () => {
    expect(
      describeMaterialEvents([
        event({ unit_price: 2 }, { unit_price: 3 }),
        event({ unit_price: 3 }, { unit_price: 4 }),
      ]),
    ).toEqual(['Price: 2 → 4']);
    expect(
      describeMaterialEvents([
        event({ unit_price: 2 }, { unit_price: 3 }),
        event({ unit_price: 3 }, { unit_price: 2 }),
      ]),
    ).toEqual([]);
  });

  it('compares replaced curve points by order without reporting new UUIDs', () => {
    const point = {
      id: 'old',
      load_curve_id: 'curve',
      point_order: 1,
      span_m: 2,
      load_kn_per_m: 4,
    };
    const removed: MaterialChangeEvent = { ...event(point, null), kind: 'point', key: '1' };
    const added: MaterialChangeEvent = {
      ...event(null, { ...point, id: 'new' }),
      kind: 'point',
      key: '1',
    };
    expect(describeMaterialEvents([removed, added])).toEqual([]);
    expect(
      describeMaterialEvents([removed, { ...added, after: { ...added.after, load_kn_per_m: 5 } }]),
    ).toEqual(['Point 1 / Load [kN/m]: 4 → 5']);
  });

  it('names Standard Materials and records additions, edits, and removals', () => {
    const item = {
      id: 'a',
      cable_type_id: 'owner',
      referenced_material_id: 'child',
      quantity: 2,
      unit: 'pcs',
    };
    const standard: MaterialChangeEvent = {
      ...event(null, item),
      kind: 'standard-material',
      label: 'Gland',
    };
    expect(describeMaterialEvents([standard])).toContain('Standard Material "Gland" created.');
    expect(
      describeMaterialEvents([{ ...standard, before: item, after: { ...item, quantity: 4 } }]),
    ).toEqual(['Standard Material "Gland" / Quantity: 2 → 4']);
    expect(describeMaterialEvents([{ ...standard, before: item, after: null }])).toContain(
      'Standard Material "Gland" deleted.',
    );
    expect(describeMaterialEvents([standard]).join(' ')).not.toContain('owner');
  });

  it('keeps the saved actor name and timestamp', () => {
    expect(
      mapMaterialChangeLogRow({
        id: '42',
        user_id: 'user',
        user_name: 'Jane Doe',
        changed_at: new Date('2026-09-18T10:00:00Z'),
        events: [event(null, { name: 'Cable' })],
      }),
    ).toMatchObject({
      id: '42',
      userId: 'user',
      userName: 'Jane Doe',
      changedAt: '2026-09-18T10:00:00.000Z',
    });
  });
});
