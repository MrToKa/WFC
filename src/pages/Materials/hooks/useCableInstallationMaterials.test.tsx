import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MaterialCableInstallationMaterial } from '@/api/client';
import { useCableInstallationMaterials } from './useCableInstallationMaterials';

const apiMocks = vi.hoisted(() => ({
  fetchCableInstallationMaterials: vi.fn(),
}));

vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  fetchMaterialCableInstallationMaterials: apiMocks.fetchCableInstallationMaterials,
}));

const baseMaterial: MaterialCableInstallationMaterial = {
  id: '00000000-0000-4000-8000-000000000001',
  type: 'Power cable gland',
  purpose: 'Power',
  material: null,
  description: null,
  manufacturer: null,
  partNo: null,
  dimensionMm: null,
  weightKg: null,
  minimumOrderQuantity: 1,
  orderMeasurement: 'pcs',
  packaging: 'Box',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const materials: MaterialCableInstallationMaterial[] = [
  baseMaterial,
  {
    ...baseMaterial,
    id: '00000000-0000-4000-8000-000000000002',
    type: 'Control cable tie',
    purpose: 'Control',
  },
  {
    ...baseMaterial,
    id: '00000000-0000-4000-8000-000000000003',
    type: 'Control cable marker',
    purpose: 'Control',
  },
];

describe('useCableInstallationMaterials', () => {
  beforeEach(() => {
    apiMocks.fetchCableInstallationMaterials.mockReset();
    apiMocks.fetchCableInstallationMaterials.mockResolvedValue({
      cableInstallationMaterials: materials,
    });
  });

  it('combines the Purpose dropdown filter with text search', async () => {
    const { result } = renderHook(() =>
      useCableInstallationMaterials({
        token: null,
        isAdmin: false,
        showToast: vi.fn(),
      }),
    );

    await waitFor(() => expect(result.current.pagedCableInstallationMaterials).toHaveLength(3));
    expect(result.current.purposeFilterOptions).toEqual(['Control', 'Power']);

    act(() => result.current.setPurposeFilter('Control'));
    expect(result.current.pagedCableInstallationMaterials.map((item) => item.type)).toEqual([
      'Control cable marker',
      'Control cable tie',
    ]);

    act(() => result.current.setSearchText('marker'));
    expect(result.current.pagedCableInstallationMaterials.map((item) => item.type)).toEqual([
      'Control cable marker',
    ]);
  });
});
