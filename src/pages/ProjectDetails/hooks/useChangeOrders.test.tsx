import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChangeOrderDetails } from '@/api/client';
import { useChangeOrders } from './useChangeOrders';

const mocks = vi.hoisted(() => ({ list: vi.fn(), details: vi.fn() }));
vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  fetchChangeOrders: mocks.list,
  fetchChangeOrder: mocks.details,
}));

const order = (id: string): ChangeOrderDetails => ({
  id,
  projectId: 'project-1',
  title: id,
  projectReference: null,
  preparedBy: 'User',
  reportDate: '2026-01-01',
  revision: '0',
  itemCount: 0,
  totalPrice: 0,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  projectName: 'Project',
  projectCustomer: 'Customer',
  createdBy: null,
  items: [],
});
const revisedOrder = (id: string, revision = '2'): ChangeOrderDetails => ({
  ...order(id),
  title: `${id} revision ${revision}`,
  revision,
  latestRevision: '2',
  revisions: ['2', '1', '0'],
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.list.mockResolvedValue({ changeOrders: [order('first'), order('second')] });
  mocks.details.mockImplementation((_token, _project, id) =>
    Promise.resolve({ changeOrder: order(id) }),
  );
});

describe('change order selection', () => {
  it('keeps the latest selected order when requests finish out of order', async () => {
    const first = deferred<{ changeOrder: ChangeOrderDetails }>();
    const second = deferred<{ changeOrder: ChangeOrderDetails }>();
    mocks.details.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useChangeOrders('project-1', 'token'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let firstSelection!: Promise<void>;
    let secondSelection!: Promise<void>;
    act(() => {
      firstSelection = result.current.selectChangeOrder('first');
    });
    act(() => {
      secondSelection = result.current.selectChangeOrder('second');
    });
    await act(async () => {
      second.resolve({ changeOrder: order('second') });
      await secondSelection;
    });
    await act(async () => {
      first.resolve({ changeOrder: order('first') });
      await firstSelection;
    });
    expect(result.current.selectedId).toBe('second');
    expect(result.current.details?.id).toBe('second');
  });

  it('clears pending details and loading when selection is removed', async () => {
    const pending = deferred<{ changeOrder: ChangeOrderDetails }>();
    mocks.details.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useChangeOrders('project-1', 'token'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let selection!: Promise<void>;
    act(() => {
      selection = result.current.selectChangeOrder('first');
    });
    await act(async () => result.current.selectChangeOrder(null));
    expect(result.current.detailsLoading).toBe(false);
    await act(async () => {
      pending.resolve({ changeOrder: order('first') });
      await selection;
    });
    expect(result.current.details).toBeNull();
    expect(result.current.selectedId).toBeNull();
  });

  it('clears private details on sign-out and ignores pending requests', async () => {
    const pending = deferred<{ changeOrder: ChangeOrderDetails }>();
    mocks.details.mockReturnValueOnce(pending.promise);
    const { result, rerender } = renderHook(({ token }) => useChangeOrders('project-1', token), {
      initialProps: { token: 'token' as string | null },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    let selection!: Promise<void>;
    act(() => {
      selection = result.current.selectChangeOrder('first');
    });
    rerender({ token: null });
    await act(async () => {
      pending.resolve({ changeOrder: order('first') });
      await selection;
    });
    expect(result.current.changeOrders).toEqual([]);
    expect(result.current.details).toBeNull();
    expect(result.current.selectedId).toBeNull();
  });

  it('refreshes the current selection instead of restoring the selection at refresh start', async () => {
    const { result } = renderHook(() => useChangeOrders('project-1', 'token'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => result.current.selectChangeOrder('first'));
    const pending = deferred<{ changeOrders: ChangeOrderDetails[] }>();
    mocks.list.mockReturnValueOnce(pending.promise);
    let refresh!: Promise<void>;
    act(() => {
      refresh = result.current.refreshCurrent();
    });
    await act(async () => result.current.selectChangeOrder('second'));
    await act(async () => {
      pending.resolve({ changeOrders: [order('first'), order('second')] });
      await refresh;
    });
    expect(result.current.selectedId).toBe('second');
    expect(result.current.details?.id).toBe('second');
  });
});

describe('change order revision selection', () => {
  beforeEach(() => {
    mocks.details.mockImplementation((_token, _project, id, _collection, revision) =>
      Promise.resolve({ changeOrder: revisedOrder(id, revision) }),
    );
  });

  it('keeps details visible while loading the selected historical revision', async () => {
    const { result } = renderHook(() => useChangeOrders('project-1', 'token'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => result.current.selectChangeOrder('first'));
    const pending = deferred<{ changeOrder: ChangeOrderDetails }>();
    mocks.details.mockReturnValueOnce(pending.promise);
    let selection!: Promise<void>;
    act(() => {
      selection = result.current.selectRevision('1');
    });

    expect(result.current.detailsLoading).toBe(true);
    expect(result.current.details?.revision).toBe('2');
    expect(mocks.details).toHaveBeenLastCalledWith(
      'token',
      'project-1',
      'first',
      'change-orders',
      '1',
    );

    await act(async () => {
      pending.resolve({ changeOrder: revisedOrder('first', '1') });
      await selection;
    });
    expect(result.current.details?.title).toBe('first revision 1');
    expect(result.current.selectedId).toBe('first');
    expect(result.current.detailsLoading).toBe(false);
  });

  it('keeps the newest revision selection when requests finish out of order', async () => {
    const { result } = renderHook(() => useChangeOrders('project-1', 'token'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => result.current.selectChangeOrder('first'));
    const first = deferred<{ changeOrder: ChangeOrderDetails }>();
    const second = deferred<{ changeOrder: ChangeOrderDetails }>();
    mocks.details.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    let firstSelection!: Promise<void>;
    let secondSelection!: Promise<void>;
    act(() => {
      firstSelection = result.current.selectRevision('1');
      secondSelection = result.current.selectRevision('0');
    });
    await act(async () => {
      second.resolve({ changeOrder: revisedOrder('first', '0') });
      await secondSelection;
    });
    await act(async () => {
      first.resolve({ changeOrder: revisedOrder('first', '1') });
      await firstSelection;
    });

    expect(result.current.details?.revision).toBe('0');
    expect(result.current.detailsLoading).toBe(false);
  });

  it('ignores a pending revision when another document is selected', async () => {
    const { result } = renderHook(() => useChangeOrders('project-1', 'token'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => result.current.selectChangeOrder('first'));
    const pending = deferred<{ changeOrder: ChangeOrderDetails }>();
    mocks.details.mockReturnValueOnce(pending.promise);
    let selection!: Promise<void>;
    act(() => {
      selection = result.current.selectRevision('1');
    });
    await act(async () => result.current.selectChangeOrder('second'));
    await act(async () => {
      pending.resolve({ changeOrder: revisedOrder('first', '1') });
      await selection;
    });

    expect(result.current.selectedId).toBe('second');
    expect(result.current.details?.id).toBe('second');
    expect(result.current.details?.revision).toBe('2');
    expect(mocks.details).toHaveBeenLastCalledWith('token', 'project-1', 'second', 'change-orders');
  });

  it('clears private revisions on sign-out and ignores old callbacks and responses', async () => {
    const { result, rerender } = renderHook(({ token }) => useChangeOrders('project-1', token), {
      initialProps: { token: 'token' as string | null },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => result.current.selectChangeOrder('first'));
    const oldSelect = result.current.selectChangeOrder;
    const pending = deferred<{ changeOrder: ChangeOrderDetails }>();
    mocks.details.mockReturnValueOnce(pending.promise);
    let selection!: Promise<void>;
    act(() => {
      selection = result.current.selectRevision('1');
    });
    rerender({ token: null });
    await act(async () => {
      await oldSelect('first');
      pending.resolve({ changeOrder: revisedOrder('first', '1') });
      await selection;
    });

    expect(mocks.details).toHaveBeenCalledTimes(2);
    expect(result.current.changeOrders).toEqual([]);
    expect(result.current.selectedId).toBeNull();
    expect(result.current.details).toBeNull();
    expect(result.current.detailsLoading).toBe(false);
  });

  it('ignores revisions from the previous document collection', async () => {
    const { result, rerender } = renderHook(
      ({ internal }) =>
        useChangeOrders('project-1', 'token', {
          collection: internal ? 'internal-ncrs' : 'change-orders',
        }),
      { initialProps: { internal: false } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => result.current.selectChangeOrder('first'));
    const pending = deferred<{ changeOrder: ChangeOrderDetails }>();
    mocks.details.mockReturnValueOnce(pending.promise);
    let selection!: Promise<void>;
    act(() => {
      selection = result.current.selectRevision('1');
    });
    rerender({ internal: true });
    await act(async () => result.current.selectChangeOrder('second'));
    await act(async () => {
      pending.resolve({ changeOrder: revisedOrder('first', '1') });
      await selection;
    });

    expect(result.current.details?.id).toBe('second');
    expect(mocks.details).toHaveBeenLastCalledWith('token', 'project-1', 'second', 'internal-ncrs');
  });

  it('keeps the previous revision when a revision request fails', async () => {
    const { result } = renderHook(() => useChangeOrders('project-1', 'token'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => result.current.selectChangeOrder('first'));
    await act(async () => result.current.selectRevision('1'));
    mocks.details.mockRejectedValueOnce(new Error('Revision unavailable'));
    await act(async () => result.current.selectRevision('0'));

    expect(result.current.details?.revision).toBe('1');
    expect(result.current.error).toBe('Revision unavailable');
    expect(result.current.detailsLoading).toBe(false);
    await act(async () => result.current.refreshCurrent());
    expect(mocks.details).toHaveBeenLastCalledWith(
      'token',
      'project-1',
      'first',
      'change-orders',
      '1',
    );
  });

  it.each(['2', '1'])('refreshes the currently viewed revision %s', async (revision) => {
    const { result } = renderHook(() => useChangeOrders('project-1', 'token'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => result.current.selectChangeOrder('first'));
    await act(async () => result.current.selectRevision(revision));
    mocks.details.mockClear();
    await act(async () => result.current.refreshCurrent());

    const expectedArgs = ['token', 'project-1', 'first', 'change-orders'];
    if (revision !== '2') expectedArgs.push(revision);
    expect(mocks.details).toHaveBeenLastCalledWith(...expectedArgs);
    expect(result.current.details?.revision).toBe(revision);
  });

  it('refreshes the revision chosen while the list refresh is still pending', async () => {
    const { result } = renderHook(() => useChangeOrders('project-1', 'token'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => result.current.selectChangeOrder('first'));
    const pending = deferred<{ changeOrders: ChangeOrderDetails[] }>();
    mocks.list.mockReturnValueOnce(pending.promise);
    let refresh!: Promise<void>;
    act(() => {
      refresh = result.current.refreshCurrent();
    });
    await act(async () => result.current.selectRevision('1'));
    await act(async () => {
      pending.resolve({ changeOrders: [revisedOrder('first')] });
      await refresh;
    });

    expect(result.current.details?.revision).toBe('1');
    expect(mocks.details).toHaveBeenLastCalledWith(
      'token',
      'project-1',
      'first',
      'change-orders',
      '1',
    );
  });

  it('returns to the newest revision after a saved document replaces historical details', async () => {
    const { result } = renderHook(() => useChangeOrders('project-1', 'token'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => result.current.selectChangeOrder('first'));
    await act(async () => result.current.selectRevision('1'));
    act(() => result.current.setDetails(revisedOrder('first')));
    await act(async () => result.current.refreshCurrent());

    expect(mocks.details).toHaveBeenLastCalledWith('token', 'project-1', 'first', 'change-orders');
    expect(result.current.details?.revision).toBe('2');
  });
});
