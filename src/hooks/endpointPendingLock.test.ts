import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { EndpointPendingLockError, withEndpointPendingLock } from './endpointPendingLock';

const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
beforeEach(() => {
  Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
  vi.stubGlobal('indexedDB', new IDBFactory());
});
afterEach(() => {
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (originalLocks) Object.defineProperty(navigator, 'locks', originalLocks); else Reflect.deleteProperty(navigator, 'locks');
});

describe('HTTP endpoint pending-command coordination', () => {
  it('serializes overlapping readwrite critical sections from separate database connections', async () => {
    const order: number[] = [];
    expect(await Promise.all([1, 2, 3].map(index => withEndpointPendingLock(['shared-owner', 'pair-owner'], () => {
      order.push(index); return [...order];
    })))).toEqual([[1], [1, 2], [1, 2, 3]]);
  });
  it('propagates an exact storage failure and releases the transaction for the next operation', async () => {
    const failure = new DOMException('Storage permission denied', 'SecurityError');
    await expect(withEndpointPendingLock(['owner'], () => { throw failure; })).rejects.toBe(failure);
    await expect(withEndpointPendingLock(['owner'], () => 'next Save can check its pending record')).resolves.toBe('next Save can check its pending record');
  });
  it('does not execute the critical section when opening browser storage is refused', async () => {
    const work = vi.fn(); vi.stubGlobal('indexedDB', { open: () => { throw new DOMException('Storage denied', 'SecurityError'); } });
    await expect(withEndpointPendingLock(['owner'], work)).rejects.toBeInstanceOf(EndpointPendingLockError);
    expect(work).not.toHaveBeenCalled();
  });
  it('bounds a stalled database open and ignores late success without executing the Save', async () => {
    vi.useFakeTimers();
    const opening: Partial<IDBOpenDBRequest> = {}, database = { close: vi.fn() };
    vi.stubGlobal('indexedDB', { open: () => opening });
    const work = vi.fn(), operation = withEndpointPendingLock(['owner'], work);
    const outcome = expect(operation).rejects.toThrow(/another browser window/);
    await vi.advanceTimersByTimeAsync(5000); await outcome;
    Object.assign(opening, { result: database }); opening.onsuccess?.call(opening as IDBOpenDBRequest, new Event('success'));
    expect(database.close).toHaveBeenCalledOnce(); expect(work).not.toHaveBeenCalled();
  });
});
