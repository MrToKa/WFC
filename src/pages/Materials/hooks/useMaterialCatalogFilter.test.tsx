import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  useMaterialCatalogFilter,
  type MaterialCatalogSearchCriteria,
} from './useMaterialCatalogFilter';
import { makeSupport, makeTray } from './materialCatalog.testUtils';

describe('useMaterialCatalogFilter', () => {
  it('searches the full catalog before pagination and combines manufacturer with text', () => {
    const items = Array.from({ length: 25 }, (_, index) => makeSupport(index));
    const { result } = renderHook(() => useMaterialCatalogFilter(items));

    expect(result.current.pagedItems).toHaveLength(10);
    expect(result.current.pagination).toEqual({
      page: 1,
      pageSize: 10,
      totalPages: 3,
      totalItems: 25,
    });
    act(() => result.current.setPage(3));
    expect(result.current.pagedItems).toHaveLength(5);

    act(() => result.current.setSearchText('  SUPPORT 2  '));
    expect(result.current.page).toBe(1);
    expect(result.current.pagedItems.map((item) => item.id)).toEqual([
      'support-20',
      'support-21',
      'support-22',
      'support-23',
      'support-24',
    ]);
    act(() => result.current.setManufacturerFilter(' beta '));
    expect(result.current.pagedItems.map((item) => item.id)).toEqual(['support-21', 'support-23']);
    expect(result.current.pagination.totalItems).toBe(2);
    expect(result.current.showPagination).toBe(false);

    act(() => result.current.setSearchText('not present'));
    expect(result.current.pagedItems).toEqual([]);
    expect(result.current.pagination).toEqual({
      page: 1,
      pageSize: 10,
      totalPages: 1,
      totalItems: 0,
    });
  });

  it('resets each filter change to the first page and keeps manufacturer choices across filters', () => {
    const items = Array.from({ length: 25 }, (_, index) => makeSupport(index));
    items.push({ ...makeSupport(25), manufacturer: ' alpha ' });
    items.push({ ...makeSupport(26), manufacturer: '  ' });
    const { result } = renderHook(() => useMaterialCatalogFilter(items));
    expect(result.current.manufacturerFilterOptions).toEqual(['alpha', 'Beta']);
    act(() => result.current.setPage(2));
    act(() => result.current.setSearchCriteria('type'));
    expect(result.current.page).toBe(1);
    act(() => result.current.setPage(2));
    act(() => result.current.setManufacturerFilter('Beta'));
    expect(result.current.page).toBe(1);
    expect(result.current.pagination.totalItems).toBe(12);
    expect(result.current.manufacturerFilterOptions).toEqual(['alpha', 'Beta']);
    act(() => result.current.setPage(2));
    act(() => result.current.setSearchText('support'));
    expect(result.current.page).toBe(1);
  });

  it.each<[MaterialCatalogSearchCriteria, string]>([
    ['type', 'tray 00'],
    ['manufacturer', 'alpha'],
    ['height', '150'],
    ['rungHeight', '31'],
    ['width', '600'],
    ['weight', '3.509'],
    ['loadCurve', 'medium'],
    ['minimumOrder', '5 pcs'],
    ['packaging', 'box'],
    ['price', '42.5'],
  ])('searches the tray %s field', (criteria, query) => {
    const items = [makeTray(0)];
    const { result } = renderHook(() => useMaterialCatalogFilter(items));
    act(() => {
      result.current.setSearchCriteria(criteria);
      result.current.setSearchText(query);
    });
    expect(result.current.pagedItems).toHaveLength(1);
    act(() => result.current.setSearchText('absent'));
    expect(result.current.pagedItems).toEqual([]);
  });

  it('supports length searches and restricts search to the selected field', () => {
    const items = [makeSupport(0)];
    const { result } = renderHook(() => useMaterialCatalogFilter(items));
    act(() => {
      result.current.setSearchCriteria('length');
      result.current.setSearchText('1200');
    });
    expect(result.current.pagedItems).toHaveLength(1);
    act(() => result.current.setSearchCriteria('width'));
    expect(result.current.pagedItems).toEqual([]);
  });

  it('matches the displayed three-decimal weight as well as the raw value', () => {
    const item = { ...makeTray(0), weightKgPerM: 8.34 };
    const displayedWeight = new Intl.NumberFormat(undefined, {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    }).format(8.34);
    const { result } = renderHook(() => useMaterialCatalogFilter([item]));

    act(() => {
      result.current.setSearchCriteria('weight');
      result.current.setSearchText(displayedWeight);
    });
    expect(result.current.pagedItems).toEqual([item]);
    act(() => result.current.setSearchText('8.34'));
    expect(result.current.pagedItems).toEqual([item]);
    act(() => {
      result.current.setSearchCriteria('all');
      result.current.setSearchText(displayedWeight);
    });
    expect(result.current.pagedItems).toEqual([item]);
    act(() => result.current.setSearchCriteria('width'));
    expect(result.current.pagedItems).toEqual([]);
  });

  it.each<['height' | 'price', number]>([
    ['height', 1234.567],
    ['price', 9876.543],
  ])('matches locale-formatted and raw %s values', (criteria, value) => {
    const item = { ...makeSupport(0), heightMm: 1234.567, unitPrice: 9876.543 };
    const displayedValue = new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 2,
    }).format(value);
    const { result } = renderHook(() => useMaterialCatalogFilter([item]));

    act(() => {
      result.current.setSearchCriteria(criteria);
      result.current.setSearchText(displayedValue);
    });
    expect(result.current.pagedItems).toEqual([item]);
    act(() => result.current.setSearchText(String(value)));
    expect(result.current.pagedItems).toEqual([item]);
    act(() => {
      result.current.setSearchCriteria('all');
      result.current.setSearchText(displayedValue);
    });
    expect(result.current.pagedItems).toEqual([item]);
  });

  it('clamps the page after data shrinks and stays clamped when records are added again', () => {
    const items = Array.from({ length: 21 }, (_, index) => makeSupport(index));
    const { result, rerender } = renderHook(({ catalog }) => useMaterialCatalogFilter(catalog), {
      initialProps: { catalog: items },
    });
    act(() => result.current.setPage(3));
    expect(result.current.pagedItems).toEqual([items[20]]);

    rerender({ catalog: items.slice(0, 20) });
    expect(result.current.page).toBe(2);
    expect(result.current.pagedItems).toEqual(items.slice(10, 20));
    rerender({ catalog: items });
    expect(result.current.page).toBe(2);

    rerender({ catalog: [] });
    expect(result.current.page).toBe(1);
    expect(result.current.pagedItems).toEqual([]);
  });
});
