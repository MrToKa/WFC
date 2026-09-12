import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MaterialSupport, MaterialTray, Project, Tray } from '../../api/client';
import { getTrayDisplayMaterial } from './trayMaterialSnapshot';
import { useTrayCalculations } from './hooks/useTrayCalculations';
import { toTrayFormState } from './TrayDetails.utils';

const material = {
  id: 'source',
  type: 'Original',
  weightKgPerM: 3,
  widthMm: 400,
  heightMm: 100,
  rungHeightMm: 20,
} as MaterialTray;
const tray = {
  id: 'tray',
  type: 'Original',
  widthMm: 450,
  heightMm: 110,
  lengthMm: 6000,
  materialSnapshot: {
    schemaVersion: 1,
    capturedAt: '2026-09-12',
    material,
    loadCurve: null,
    imageAvailable: false,
  },
} as Tray;

describe('project tray snapshot presentation', () => {
  it('uses captured values after source changes/deletion, including while editing the same selection', () => {
    const current = vi.fn(() => ({ ...material, weightKgPerM: 999 }));
    expect(getTrayDisplayMaterial(tray, 'Original', false, current)).toBe(material);
    expect(getTrayDisplayMaterial(tray, 'original', true, current)).toBe(material);
    expect(current).not.toHaveBeenCalled();
    expect(toTrayFormState(tray)).toMatchObject({
      widthMm: '450',
      heightMm: '110',
      weightKgPerM: '3.000',
    });
  });

  it('leaves missing historical data unknown while preserving known local dimensions', () => {
    const legacy = { ...tray, materialSnapshot: null };
    const current = vi.fn(() => material);
    expect(getTrayDisplayMaterial(legacy, 'Original', false, current)).toBeNull();
    expect(getTrayDisplayMaterial(legacy, 'Original', true, current)).toBeNull();
    expect(toTrayFormState(legacy)).toMatchObject({
      widthMm: '450',
      heightMm: '110',
      weightKgPerM: '',
    });
    expect(current).not.toHaveBeenCalled();
  });

  it('previews the current catalog only for an explicit different type selection', () => {
    const current = vi.fn(() => ({ ...material, id: 'new', type: 'New', weightKgPerM: 9 }));
    expect(getTrayDisplayMaterial(tray, 'New', true, current)?.weightKgPerM).toBe(9);
    expect(current).toHaveBeenCalledWith('New');
  });

  it('calculates support weight from the captured support and keeps missing selected support data unknown', () => {
    const support = { id: 'support', type: 'Captured support', weightKg: 2 } as MaterialSupport;
    const project = {
      supportDistance: 2,
      supportWeight: 99,
      supportDistanceOverrides: {
        Original: {
          distance: 2,
          supportId: 'support',
          supportType: support.type,
          supportSnapshot: support,
        },
      },
    } as unknown as Project;
    const { result, rerender } = renderHook(
      ({ value }) => useTrayCalculations(value, tray, [], 3, null),
      { initialProps: { value: project } },
    );
    expect(result.current.supportCalculations).toMatchObject({
      supportsCount: 4,
      weightPerPieceKg: 2,
      totalWeightKg: 8,
    });
    rerender({
      value: {
        ...project,
        supportDistanceOverrides: {
          Original: { distance: 2, supportId: 'support', supportType: null, supportSnapshot: null },
        },
      },
    });
    expect(result.current.supportCalculations.weightPerPieceKg).toBeNull();
    expect(result.current.supportCalculations.totalWeightKg).toBeNull();
  });
});
