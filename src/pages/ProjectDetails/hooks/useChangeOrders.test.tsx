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
