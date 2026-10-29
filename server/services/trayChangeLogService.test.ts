// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import type { TrayRow } from '../models/tray.js';
import { describeTrayChanges, recordTrayChanges } from './trayChangeLogService.js';

const tray: TrayRow = {
  id: 'tray',
  project_id: 'project',
  name: 'T1',
  tray_type: 'KL',
  purpose: 'Power',
  width_mm: '300.00',
  height_mm: 60,
  length_mm: 3000,
  include_grounding_cable: false,
  grounding_cable_type_id: null,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
};

describe('tray change history', () => {
  it('records approval of an automatic source even when the measured length is unchanged', () => {
    const calculation = { lengthMm: 3000, elementCount: 1, modelVersionId: '00000000-0000-4000-8000-000000000001', geometryRevision: '2', aggregateId: '00000000-0000-4000-8000-000000000002', traceId: '00000000-0000-4000-8000-000000000003', calculatedAt: '2026-10-29T12:00:00.000Z' };
    const automatic = { ...tray, length_source: 'auto' as const, length_calculation: calculation };
    expect(describeTrayChanges(tray, automatic)).toEqual(['Length source: manual → auto']);
    expect(describeTrayChanges(automatic, { ...tray, length_source: 'manual', length_calculation: null })).toEqual(['Length source: auto → manual']);
  });
  it('treats missing clamp preferences as the default settings', () => {
    expect(
      describeTrayChanges(tray, {
        ...tray,
        use_trefoil_clamps: false,
        trefoil_clamp_spacing_mm: '600.00',
      }),
    ).toEqual([]);
  });

  it('describes clamp preferences and spacing changes', () => {
    expect(
      describeTrayChanges(tray, {
        ...tray,
        use_trefoil_clamps: true,
        trefoil_clamp_spacing_mm: 900,
      }),
    ).toEqual(['Use trefoil clamps: No → Yes', 'Trefoil clamp spacing [mm]: 600 → 900']);
  });

  it('ignores numeric formatting, timestamps and equivalent empty settings', () => {
    expect(
      describeTrayChanges(tray, {
        ...tray,
        width_mm: 300,
        include_grounding_cable: null,
        updated_at: '2026-02-01',
      }),
    ).toEqual([]);
  });

  it('describes edited and cleared data and grounding preferences', () => {
    expect(
      describeTrayChanges(tray, {
        ...tray,
        name: 'T2',
        purpose: null,
        length_mm: 4000,
        include_grounding_cable: true,
        grounding_cable_type_id: 'cable-type',
      }),
    ).toEqual([
      'Name: T1 → T2',
      'Purpose: Power → Not specified',
      'Length [mm]: 3000 → 4000',
      'Include grounding cable: No → Yes',
      'Grounding cable type ID: Not specified → cable-type',
    ]);
  });

  it('records creation and initial values', () => {
    expect(describeTrayChanges(null, tray)).toEqual(
      expect.arrayContaining([
        'Tray created.',
        'Name: Not specified → T1',
        'Width [mm]: Not specified → 300',
      ]),
    );
  });

  it('appends the authenticated actor and preserves existing entries in the response', async () => {
    const existing = {
      id: 'old',
      userId: 'actor',
      userName: 'Editor',
      changedAt: '2026-01-01',
      changes: ['Tray created.'],
    };
    const after = { ...tray, length_mm: 4000, change_log: [existing] };
    const query = vi.fn().mockResolvedValue({ rows: [{ name: 'Editor' }] });
    const entry = await recordTrayChanges({ query } as unknown as PoolClient, 'actor', tray, after);
    expect(entry).toMatchObject({
      userId: 'actor',
      userName: 'Editor',
      changes: ['Length [mm]: 3000 → 4000'],
    });
    expect(query.mock.calls[1]).toEqual([
      expect.stringContaining('change_log = change_log ||'),
      ['project', 'tray', JSON.stringify([entry])],
    ]);
    expect(after.change_log).toEqual([existing, entry]);
  });

  it('does not write a log for an unchanged save', async () => {
    const query = vi.fn();
    expect(
      await recordTrayChanges({ query } as unknown as PoolClient, 'actor', tray, { ...tray }),
    ).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});
