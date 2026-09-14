import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCableTypes } from './useCableTypes';
import {
  useCableInstallationMaterials,
  useTrayInstallationMaterials,
  useInstruments,
  useInstrumentInstallationMaterials,
} from './useCableInstallationMaterials';
import { useTrays } from './useTrays';
import { useSupports } from './useSupports';
import { makeSupport, makeTray } from './materialCatalog.testUtils';

vi.mock('../Materials.utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../Materials.utils')>()),
  downloadBlob: vi.fn(),
}));

const params = { token: 'token', isAdmin: true, showToast: vi.fn() };
const useCableTypeExport = () => {
  const catalog = useCableTypes(params);
  return {
    loading: catalog.cableTypesLoading,
    items: catalog.pagedCableTypes,
    setSearch: catalog.setSearchText,
    setFilter: catalog.setPurposeFilter,
    export: catalog.handleExportCableTypes,
  };
};
const useTrayExport = () => {
  const catalog = useTrays(params);
  return {
    loading: catalog.isLoadingTrays,
    items: catalog.trays,
    setSearch: catalog.setSearchText,
    setFilter: catalog.setManufacturerFilter,
    export: catalog.handleExportTrays,
  };
};
const useSupportExport = () => {
  const catalog = useSupports(params);
  return {
    loading: catalog.isLoadingSupports,
    items: catalog.supports,
    setSearch: catalog.setSearchText,
    setFilter: catalog.setManufacturerFilter,
    export: catalog.handleExportSupports,
  };
};
const installationExportHook = (useCatalog: typeof useCableInstallationMaterials) =>
  function useInstallationExport() {
    const catalog = useCatalog(params);
    return {
      loading: catalog.cableInstallationMaterialsLoading,
      items: catalog.pagedCableInstallationMaterials,
      setSearch: catalog.setSearchText,
      setFilter: catalog.setPurposeFilter,
      export: catalog.handleExportCableInstallationMaterials,
    };
  };

const catalogs = [
  { key: 'cableTypes', path: 'cable-types', useExport: useCableTypeExport },
  { key: 'trays', path: 'trays', useExport: useTrayExport },
  { key: 'supports', path: 'supports', useExport: useSupportExport },
  {
    key: 'cableInstallationMaterials',
    path: 'cable-installation-materials',
    useExport: installationExportHook(useCableInstallationMaterials),
  },
  {
    key: 'trayInstallationMaterials',
    path: 'tray-installation-materials',
    useExport: installationExportHook(useTrayInstallationMaterials),
  },
  { key: 'instruments', path: 'instruments', useExport: installationExportHook(useInstruments) },
  {
    key: 'instrumentInstallationMaterials',
    path: 'instrument-installation-materials',
    useExport: installationExportHook(useInstrumentInstallationMaterials),
  },
];

describe.each(catalogs)('$key Excel export', ({ key, path, useExport }) => {
  afterEach(() => vi.unstubAllGlobals());

  it('exports all matching pages, combines filters, and exports no rows for no matches', async () => {
    const items = Array.from({ length: 61 }, (_, index) => ({
      ...makeSupport(index),
      ...makeTray(index),
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      type: index < 60 ? `Match ${index}` : 'Other',
      name: index < 60 ? `Match ${index}` : 'Other',
      purpose: index % 2 === 0 ? 'Alpha' : 'Beta',
      material: null,
      description: null,
      partNo: null,
      remarks: null,
      dimensionMm: null,
      diameterMm: 10,
    }));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => ({ [key]: items }),
      blob: async () => new Blob(['workbook']),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useExport());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const expectExport = async (expectedIds: string[]) => {
      await act(async () => result.current.export());
      const [url, options] = fetchMock.mock.lastCall!;
      expect(url).toContain(`/api/materials/${path}/export`);
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(options.headers.Authorization).toBe('Bearer token');
      expect(JSON.parse(options.body).ids.sort()).toEqual([...expectedIds].sort());
    };

    await expectExport(items.map((item) => item.id));
    act(() => {
      result.current.setSearch('Match');
      result.current.setFilter('Alpha');
    });
    const matchingIds = items
      .filter((_, index) => index < 60 && index % 2 === 0)
      .map((item) => item.id);
    expect(result.current.items.length).toBeLessThan(matchingIds.length);
    await expectExport(matchingIds);

    act(() => result.current.setSearch('no matching material'));
    expect(result.current.items).toHaveLength(0);
    await expectExport([]);

    act(() => {
      result.current.setSearch('');
      result.current.setFilter('');
    });
    await expectExport(items.map((item) => item.id));
  });
});
