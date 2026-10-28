import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cableEndpointCommandSchema } from '../../shared/pathfinderCableEndpoints';
import { CABLE_ENDPOINT_PENDING_PREFIX, readPendingCableEndpoint, retainPendingCableEndpoint, verifyPendingCableEndpoint, clearPendingCableEndpoint } from './cableEndpointPendingStore';

const id = (n: number) => `60000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = { accountId: id(1), projectId: id(2) };
function command() { return cableEndpointCommandSchema.parse({ schemaVersion: 'wfc.pf.cable-endpoint-command.v1', idempotencyKey: id(3), expectedContextSha256: 'a'.repeat(64),
  expectedCableWriteRevision: '4', expectedLogicalName: 'LP-001', expectedRegistryRevision: '5', expectedLocationId: null, expectedLocationRevision: null, expectedHeadId: null,
  expectedCurrent: { modelVersionId: id(4), selectionRevision: '6', contentFingerprint: 'b'.repeat(64), aggregateId: id(5), artifactId: id(6), projectionSha256: 'c'.repeat(64), captureFrameId: id(7), geometryRevision: '7', traceId: id(8) },
  reason: 'Confirmed selected panel', selection: { mode: 'fixed-world', pointProjectMetres: [1, 2, 3], derivation: 'manual-world-point', displaySdkObjectId: null } }); }
const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
beforeEach(() => {
  localStorage.clear(); let queue = Promise.resolve();
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: vi.fn((_name: string, options: LockOptions, work: (lock: Lock) => unknown) => {
    const task = queue.then(() => { options.signal?.throwIfAborted(); return work({} as Lock); }); queue = task.then(() => undefined, () => undefined); return task;
  }) } });
});
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); if (originalLocks) Object.defineProperty(navigator, 'locks', originalLocks); else Reflect.deleteProperty(navigator, 'locks'); });

describe('Web-Locked durable endpoint commands', () => {
  it('retains the exact strict body and ownership before dispatch, with no token field', async () => {
    const retained = await retainPendingCableEndpoint(owner, id(9), 'from', command());
    expect(readPendingCableEndpoint(owner)).toEqual(retained); expect(retained.command).toEqual(command());
    const raw = localStorage.getItem(localStorage.key(0)!); expect(raw).not.toMatch(/token|Authorization|credential/);
    expect(navigator.locks.request).toHaveBeenCalledWith(expect.stringContaining(`${owner.accountId}:${owner.projectId}`), expect.objectContaining({ mode: 'exclusive' }), expect.any(Function));
    retained.command.reason = 'Mutated caller'; expect(readPendingCableEndpoint(owner)?.command.reason).toBe('Confirmed selected panel');
  });
  it('serializes concurrent tabs so only one unresolved command can be retained', async () => {
    const results = await Promise.allSettled([retainPendingCableEndpoint(owner, id(9), 'from', command()),
      retainPendingCableEndpoint(owner, id(10), 'to', { ...command(), idempotencyKey: id(11) })]);
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected']); expect(readPendingCableEndpoint(owner)?.cableId).toBe(id(9));
    expect(readPendingCableEndpoint(owner)?.command.idempotencyKey).toBe(id(3));
  });
  it('never reads, overwrites or clears another principal or project’s pending command', async () => {
    const retained = await retainPendingCableEndpoint(owner, id(9), 'from', command()), other = { ...owner, accountId: id(20) };
    expect(readPendingCableEndpoint(other)).toBeNull(); await expect(clearPendingCableEndpoint(other, retained)).rejects.toThrow();
    expect(readPendingCableEndpoint(owner)).toEqual(retained);
    await retainPendingCableEndpoint(other, id(10), 'to', { ...command(), idempotencyKey: id(21) }); expect(localStorage.length).toBe(2);
  });
  it('compares the complete pending body before replay or clearing and preserves a changed record', async () => {
    const retained = await retainPendingCableEndpoint(owner, id(9), 'from', command());
    await expect(verifyPendingCableEndpoint(owner, retained)).resolves.toEqual(retained);
    const storageKey = localStorage.key(0)!, changed = { ...retained, command: { ...retained.command, reason: 'Different command' } }; localStorage.setItem(storageKey, JSON.stringify(changed));
    await expect(verifyPendingCableEndpoint(owner, retained)).rejects.toThrow(); await expect(clearPendingCableEndpoint(owner, retained)).rejects.toThrow();
    expect(readPendingCableEndpoint(owner)?.command.reason).toBe('Different command');
  });
  it('removes only the exact retained command after its caller verifies a receipt or closure', async () => {
    const retained = await retainPendingCableEndpoint(owner, id(9), 'to', command()); await clearPendingCableEndpoint(owner, retained);
    expect(readPendingCableEndpoint(owner)).toBeNull(); await expect(clearPendingCableEndpoint(owner, retained)).rejects.toThrow();
  });
  it('fails closed when Web Locks or durable storage are unavailable', async () => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
    await expect(retainPendingCableEndpoint(owner, id(9), 'from', command())).rejects.toThrow(/Web Locks/); expect(localStorage.length).toBe(0);
  });
  it('does not replace malformed, oversized or foreign data found under the owned key', async () => {
    const storageKey = `${CABLE_ENDPOINT_PENDING_PREFIX}${owner.accountId}:${owner.projectId}`;
    for (const raw of ['{"accountId":"a","account\\u0049d":"b"}', 'x'.repeat(128 * 1024 + 1), JSON.stringify({ secretToken: 'do not accept unknown fields' })]) {
      localStorage.setItem(storageKey, raw); expect(() => readPendingCableEndpoint(owner)).toThrow();
      await expect(retainPendingCableEndpoint(owner, id(9), 'from', command())).rejects.toThrow(); expect(localStorage.getItem(storageKey)).toBe(raw);
    }
  });
  it('requires successful durable readback rather than falling back to memory', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => undefined);
    await expect(retainPendingCableEndpoint(owner, id(9), 'from', command())).rejects.toThrow(/retained/); expect(readPendingCableEndpoint(owner)).toBeNull();
  });
});
