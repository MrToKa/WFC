import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChangeEvent } from 'react';
import { ApiError, type MaterialSupport, type MaterialTray } from '@/api/client';
import { useSupports } from './useSupports';
import { useTrays } from './useTrays';
import { makeSupport, makeTray } from './materialCatalog.testUtils';

const apiMocks = vi.hoisted(() => ({
  fetchAllMaterialSupports: vi.fn(),
  fetchAllMaterialTrays: vi.fn(),
  deleteMaterialSupport: vi.fn(),
  deleteMaterialTray: vi.fn(),
  importMaterialSupports: vi.fn(),
  importMaterialTrays: vi.fn(),
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
    import: catalog.handleSupportImportChange,
    importing: catalog.isImportingSupports,
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
    import: catalog.handleTrayImportChange,
    importing: catalog.isImportingTrays,
  };
};

describe.each([
  {
    name: 'supports',
    useCatalog: useSupportCatalog,
    fetchAll: apiMocks.fetchAllMaterialSupports,
    makeItem: makeSupport,
    deleteItem: apiMocks.deleteMaterialSupport,
    importItems: apiMocks.importMaterialSupports,
  },
  {
    name: 'trays',
    useCatalog: useTrayCatalog,
    fetchAll: apiMocks.fetchAllMaterialTrays,
    makeItem: makeTray,
    deleteItem: apiMocks.deleteMaterialTray,
    importItems: apiMocks.importMaterialTrays,
  },
])('$name catalog', ({ name, useCatalog, fetchAll, makeItem, deleteItem, importItems }) => {
  let items: (MaterialSupport | MaterialTray)[];
  beforeEach(() => {
    vi.clearAllMocks();
    items = Array.from({ length: 21 }, (_, index) => makeItem(index));
    fetchAll.mockReset().mockResolvedValue({ [name]: items });
    deleteItem.mockReset().mockResolvedValue(undefined);
    importItems.mockReset();
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

    await act(async () => {
      await result.current.remove();
    });
    expect(deleteItem).toHaveBeenCalledWith('token', items[20].id);
    expect(fetchAll).toHaveBeenCalledTimes(2);
    expect(result.current.page).toBe(2);
    expect(result.current.items).toEqual(items.slice(10, 20));
    expect(result.current.pagination.totalItems).toBe(20);
  });

  it('keeps the latest refreshed catalog when an earlier load finishes late', async () => {
    let resolveInitial!: (value: unknown) => void;
    fetchAll.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveInitial = resolve;
        }),
    );
    const { result } = renderHook(() => useCatalog());
    await waitFor(() => expect(fetchAll).toHaveBeenCalledOnce());
    const refreshedItems = [makeItem(50)];
    fetchAll.mockResolvedValue({ [name]: refreshedItems });

    await act(async () => {
      await result.current.reload(1, { silent: true });
    });
    expect(result.current.items).toEqual(refreshedItems);
    await act(async () => {
      resolveInitial({ [name]: items });
    });
    expect(result.current.items).toEqual(refreshedItems);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('preserves server import errors with row details and keeps the previous catalog intact', async () => {
    const error = new ApiError(400, 'Invalid workbook. No data was changed.');
    error.issues = [{ row: 9, column: 'width_mm', message: 'Must be a non-negative number.' }];
    importItems.mockRejectedValue(error);
    const { result } = renderHook(() => useCatalog());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const previousItems = result.current.items;
    const target = { files: [new File(['workbook'], `${name}.xlsx`)], value: `${name}.xlsx` };
    await act(() => result.current.import({ target } as unknown as ChangeEvent<HTMLInputElement>));

    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: 'error',
        title: 'Excel import rejected',
        body: expect.stringContaining('Row 9, width_mm: Must be a non-negative number.'),
      }),
    );
    expect(showToast.mock.lastCall![0].body).toContain(`"${name}.xlsx"`);
    expect(showToast.mock.lastCall![0].body).toContain('No data was changed.');
    expect(result.current.items).toEqual(previousItems);
    expect(result.current.importing).toBe(false);
    expect(target.value).toBe('');
    expect(fetchAll).toHaveBeenCalledOnce();
  });
});
