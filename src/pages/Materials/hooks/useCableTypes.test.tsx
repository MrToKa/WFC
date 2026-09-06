import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MaterialCableType } from '@/api/client';
import { CABLE_TYPES_PER_PAGE } from '../../ProjectDetails.forms';
import { useCableTypes } from './useCableTypes';

const apiMocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  fetchMaterialCableTypes: apiMocks.fetch,
  deleteMaterialCableType: apiMocks.remove,
}));

const makeCableType = (index: number, purpose: string | null): MaterialCableType => ({
  id: `cable-${index}`,
  name: `Cable ${String(index).padStart(2, '0')}`,
  purpose,
  material: null,
  description: null,
  manufacturer: null,
  partNo: null,
  remarks: null,
  diameterMm: 12,
  weightKgPerM: 0.2,
  minimumOrderQuantity: 1,
  orderMeasurement: 'meters',
  packaging: 'Drum',
  unitPrice: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const showToast = vi.fn();
const renderCatalog = () =>
  renderHook(() => useCableTypes({ token: 'admin-token', isAdmin: true, showToast }));

describe('material cable types filtering and pagination', () => {
  beforeEach(() => {
    apiMocks.fetch.mockReset();
    apiMocks.remove.mockReset().mockResolvedValue(undefined);
    showToast.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('filters the full catalog and resets the page when a purpose or search changes', async () => {
    const cables = [
      ...Array.from({ length: CABLE_TYPES_PER_PAGE }, (_, index) =>
        makeCableType(index, 'Control'),
      ),
      makeCableType(CABLE_TYPES_PER_PAGE, ' Power '),
      makeCableType(CABLE_TYPES_PER_PAGE + 1, 'power'),
      makeCableType(CABLE_TYPES_PER_PAGE + 2, null),
    ];
    apiMocks.fetch.mockResolvedValue({ cableTypes: cables });
    const { result } = renderCatalog();

    await waitFor(() => expect(result.current.cableTypesLoading).toBe(false));
    expect(result.current.pagedCableTypes).toHaveLength(CABLE_TYPES_PER_PAGE);
    expect(result.current.showCableTypePagination).toBe(true);
    expect(result.current.purposeFilterOptions).toEqual(['Control', 'power']);

    act(() => result.current.goToPage(2));
    expect(result.current.cableTypePage).toBe(2);

    act(() => result.current.setPurposeFilter(' POWER '));
    expect(result.current.cableTypePage).toBe(1);
    expect(result.current.pagedCableTypes.map((item) => item.id)).toEqual([
      `cable-${CABLE_TYPES_PER_PAGE}`,
      `cable-${CABLE_TYPES_PER_PAGE + 1}`,
    ]);
    expect(result.current.showCableTypePagination).toBe(false);

    act(() => {
      result.current.setSearchCriteria('name');
      result.current.setSearchText(`  Cable ${CABLE_TYPES_PER_PAGE + 1}  `);
    });
    expect(result.current.pagedCableTypes.map((item) => item.id)).toEqual([
      `cable-${CABLE_TYPES_PER_PAGE + 1}`,
    ]);
    expect(result.current.purposeFilterOptions).toEqual(['Control', 'power']);

    act(() => result.current.setPurposeFilter('Control'));
    expect(result.current.pagedCableTypes).toEqual([]);
    expect(result.current.totalCableTypePages).toBe(1);

    act(() => {
      result.current.setPurposeFilter('');
      result.current.setSearchText('');
    });
    expect(result.current.pagedCableTypes).toHaveLength(CABLE_TYPES_PER_PAGE);
    expect(result.current.totalCableTypePages).toBe(2);

    act(() => result.current.goToPage(2));
    act(() => result.current.setSearchText('Cable'));
    expect(result.current.cableTypePage).toBe(1);
    act(() => result.current.goToPage(2));
    act(() => result.current.setSearchCriteria('all'));
    expect(result.current.cableTypePage).toBe(1);
  });

  it('clamps the selected filtered page after deleting its last matching item', async () => {
    const cables = [
      ...Array.from({ length: CABLE_TYPES_PER_PAGE }, (_, index) =>
        makeCableType(index, 'Control'),
      ),
      ...Array.from({ length: CABLE_TYPES_PER_PAGE + 1 }, (_, index) =>
        makeCableType(index + CABLE_TYPES_PER_PAGE, 'Power'),
      ),
    ];
    apiMocks.fetch.mockResolvedValue({ cableTypes: cables });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { result } = renderCatalog();
    await waitFor(() => expect(result.current.cableTypesLoading).toBe(false));

    act(() => result.current.setPurposeFilter('Power'));
    act(() => result.current.goToNextPage());
    expect(result.current.cableTypePage).toBe(2);
    expect(result.current.pagedCableTypes).toHaveLength(1);
    const lastMatch = result.current.pagedCableTypes[0]!;

    await act(() => result.current.handleDeleteCableType(lastMatch));

    expect(apiMocks.remove).toHaveBeenCalledWith('admin-token', lastMatch.id);
    expect(result.current.cableTypePage).toBe(1);
    expect(result.current.totalCableTypePages).toBe(1);
    expect(result.current.pagedCableTypes).toHaveLength(CABLE_TYPES_PER_PAGE);
    expect(result.current.pagedCableTypes.every((item) => item.purpose === 'Power')).toBe(true);
    expect(result.current.showCableTypePagination).toBe(false);
  });
});
