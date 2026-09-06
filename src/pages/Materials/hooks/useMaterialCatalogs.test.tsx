import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MaterialSupport, MaterialTray } from '@/api/client';
import { useSupports } from './useSupports';
import { useTrays } from './useTrays';
import { makeSupport, makeTray } from './materialCatalog.testUtils';

const apiMocks = vi.hoisted(() => ({
  fetchAllMaterialSupports: vi.fn(),
  fetchAllMaterialTrays: vi.fn(),
  deleteMaterialSupport: vi.fn(),
  deleteMaterialTray: vi.fn(),
}));

vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  ...apiMocks,
}));

const showToast = vi.fn();
const params = { token: 'token', isAdmin: true, showToast };

const useSupportCatalog = () => {
  const catalog = useSupports(params);
  return {
    items: catalog.supports,
    page: catalog.supportPage,
    pagination: catalog.supportPagination,
    setPage: catalog.setSupportPage,
    reload: catalog.loadSupports,
    remove: () => catalog.handleSupportDelete(catalog.supports[0]),
    isLoading: catalog.isLoadingSupports,
    error: catalog.supportsError,
    setSearchText: catalog.setSearchText,
  };
};

const useTrayCatalog = () => {
  const catalog = useTrays(params);
  return {
    items: catalog.trays,
    page: catalog.trayPage,
    pagination: catalog.trayPagination,
    setPage: catalog.setTrayPage,
    reload: catalog.loadTrays,
    remove: () => catalog.handleTrayDelete(catalog.trays[0]),
    isLoading: catalog.isLoadingTrays,
    error: catalog.traysError,
    setSearchText: catalog.setSearchText,
  };
};

describe.each([
  { name: 'supports', useCatalog: useSupportCatalog, fetchAll: apiMocks.fetchAllMaterialSupports,
    makeItem: makeSupport, deleteItem: apiMocks.deleteMaterialSupport },
  { name: 'trays', useCatalog: useTrayCatalog, fetchAll: apiMocks.fetchAllMaterialTrays,
    makeItem: makeTray, deleteItem: apiMocks.deleteMaterialTray },
])('$name catalog', ({ name, useCatalog, fetchAll, makeItem, deleteItem }) => {
  let items: (MaterialSupport | MaterialTray)[];
  beforeEach(() => {
    vi.clearAllMocks();
    items = Array.from({ length: 21 }, (_, index) => makeItem(index));
    fetchAll.mockReset().mockResolvedValue({ [name]: items });
    deleteItem.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('loads the full catalog once, then filters and changes pages without another request', async () => {
    const { result } = renderHook(() => useCatalog());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.items).toHaveLength(10);
    act(() => result.current.setPage(3));
    expect(result.current.items).toEqual([items[20]]);
    act(() => result.current.setSearchText(items[20].type));
    expect(result.current.page).toBe(1);
    expect(result.current.items).toEqual([items[20]]);
    expect(result.current.pagination.totalItems).toBe(1);
    expect(fetchAll).toHaveBeenCalledOnce();
  });

  it('reloads after deleting the last row on a page and clamps to the preceding page', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { result } = renderHook(() => useCatalog());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => result.current.setPage(3));
    fetchAll.mockResolvedValue({ [name]: items.slice(0, 20) });

    await act(async () => { await result.current.remove(); });
    expect(deleteItem).toHaveBeenCalledWith('token', items[20].id);
    expect(fetchAll).toHaveBeenCalledTimes(2);
    expect(result.current.page).toBe(2);
    expect(result.current.items).toEqual(items.slice(10, 20));
    expect(result.current.pagination.totalItems).toBe(20);
  });

  it('keeps the latest refreshed catalog when an earlier load finishes late', async () => {
    let resolveInitial!: (value: unknown) => void;
    fetchAll.mockImplementationOnce(() => new Promise((resolve) => { resolveInitial = resolve; }));
    const { result } = renderHook(() => useCatalog());
    await waitFor(() => expect(fetchAll).toHaveBeenCalledOnce());
    const refreshedItems = [makeItem(50)];
    fetchAll.mockResolvedValue({ [name]: refreshedItems });

    await act(async () => { await result.current.reload(1, { silent: true }); });
    expect(result.current.items).toEqual(refreshedItems);
    await act(async () => { resolveInitial({ [name]: items }); });
    expect(result.current.items).toEqual(refreshedItems);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });
});
