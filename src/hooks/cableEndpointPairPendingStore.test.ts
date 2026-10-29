import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cableEndpointPairCommandSchema } from '../../shared/pathfinderCableEndpointPair';
import { cableEndpointCommandSchema } from '../../shared/pathfinderCableEndpoints';
import { CABLE_ENDPOINT_PAIR_PENDING_PREFIX, readPendingCableEndpointPair, retainPendingCableEndpointPair,
  verifyPendingCableEndpointPair, clearPendingCableEndpointPair } from './cableEndpointPairPendingStore';
import { CABLE_ENDPOINT_PENDING_PREFIX, readPendingCableEndpoint, retainPendingCableEndpoint, clearPendingCableEndpoint } from './cableEndpointPendingStore';

const id = (n: number) => `61000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = { accountId: id(1), projectId: id(2) };
function command() {
  const current = { modelVersionId: id(4), selectionRevision: '6', contentFingerprint: 'b'.repeat(64), aggregateId: id(5),
    artifactId: id(6), projectionSha256: 'c'.repeat(64), captureFrameId: id(7), geometryRevision: '7', traceId: id(8) };
  return cableEndpointPairCommandSchema.parse({ schemaVersion: 'wfc.pf.cable-endpoint-pair-command.v1', idempotencyKey: id(3),
    expectedContexts: { from: 'a'.repeat(64), to: 'd'.repeat(64) }, endpoints: (['from', 'to'] as const).map((end, index) => ({ end, command: {
      schemaVersion: 'wfc.pf.cable-endpoint-command.v3', idempotencyKey: id(20 + index),
      expectedContextSha256: index ? 'd'.repeat(64) : 'a'.repeat(64), expectedCableWriteRevision: '4', expectedLogicalName: `LP-00${index + 1}`,
      expectedRegistryRevision: '5', expectedLocationId: null, expectedLocationRevision: null, expectedHeadId: null,
      expectedCurrent: current, reason: 'Confirmed exact cable endpoints', calculation: null, initialFill: null,
      selection: { mode: 'fixed-world', pointProjectMetres: [index, 2, 3], derivation: 'manual-world-point', displaySdkObjectId: null },
    } })) });
}
function legacyCommand() {
  const { calculation: _calculation, initialFill: _initialFill, ...legacy } = command().endpoints[0].command;
  return cableEndpointCommandSchema.parse({ ...legacy, schemaVersion: 'wfc.pf.cable-endpoint-command.v1' });
}
const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
beforeEach(() => {
  localStorage.clear(); const queues = new Map<string, Promise<unknown>>();
  // Independent lock names may nest. A single global queue would itself deadlock
  // the production old-then-new lock sequence and would not model Web Locks.
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: vi.fn((name: string, options: LockOptions, work: (lock: Lock) => unknown) => {
    const task = (queues.get(name) ?? Promise.resolve()).then(() => { options.signal?.throwIfAborted(); return work({ name, mode: 'exclusive' } as Lock); });
    queues.set(name, task.then(() => undefined, () => undefined)); return task;
  }) } });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); localStorage.clear();
  if (originalLocks) Object.defineProperty(navigator, 'locks', originalLocks); else Reflect.deleteProperty(navigator, 'locks'); });
const storageKey = (current = owner) => `${CABLE_ENDPOINT_PAIR_PENDING_PREFIX}${current.accountId}:${current.projectId}`;

describe('durable pair Save ownership and exact recovery', () => {
  it('retains both exact original contexts and explicit policy before any transport can run', async () => {
    const transport = vi.fn(), input = command(); expect(transport).not.toHaveBeenCalled();
    const retained = await retainPendingCableEndpointPair(owner, id(9), input);
    expect(readPendingCableEndpointPair(owner)).toEqual(retained); expect(retained.command).toEqual(input);
    transport(await verifyPendingCableEndpointPair(owner, retained)); expect(transport).toHaveBeenCalledWith(retained);
    const raw = localStorage.getItem(storageKey())!; expect(raw).not.toMatch(/token|Authorization|credential/);
    retained.command.endpoints[0].command.reason = 'Changed caller'; expect(readPendingCableEndpointPair(owner)?.command.endpoints[0].command.reason).toBe('Confirmed exact cable endpoints');
  });
  it('acquires the shared legacy owner lock before the pair lock, always exclusively', async () => {
    await retainPendingCableEndpointPair(owner, id(9), command());
    expect(vi.mocked(navigator.locks.request).mock.calls.map(call => [call[0], call[1]])).toEqual([
      [`${CABLE_ENDPOINT_PENDING_PREFIX}${owner.accountId}:${owner.projectId}`, expect.objectContaining({ mode: 'exclusive', signal: expect.any(AbortSignal) })],
      [storageKey(), expect.objectContaining({ mode: 'exclusive', signal: expect.any(AbortSignal) })],
    ]);
  });
  it('serializes concurrent pair tabs, retaining just the first complete command', async () => {
    const first = command(), second = command(); second.idempotencyKey = id(99);
    const results = await Promise.allSettled([retainPendingCableEndpointPair(owner, id(9), first), retainPendingCableEndpointPair(owner, id(10), second)]);
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected']);
    expect(readPendingCableEndpointPair(owner)).toMatchObject({ cableId: id(9), command: first });
  });
  it.each(['pair-first', 'legacy-first'] as const)('prevents legacy and pair writers racing past their common lock: %s', async order => {
    const pair = () => retainPendingCableEndpointPair(owner, id(9), command()), legacy = () => retainPendingCableEndpoint(owner, id(10), 'from', legacyCommand());
    const results = await Promise.allSettled(order === 'pair-first' ? [pair(), legacy()] : [legacy(), pair()]);
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected']);
    expect(Boolean(readPendingCableEndpointPair(owner))).toBe(order === 'pair-first'); expect(Boolean(readPendingCableEndpoint(owner))).toBe(order === 'legacy-first');
  });
  it('keeps another project and another account independent and never clears their records', async () => {
    const retained = await retainPendingCableEndpointPair(owner, id(9), command()), otherAccount = { ...owner, accountId: id(50) }, otherProject = { ...owner, projectId: id(51) };
    for (const other of [otherAccount, otherProject]) {
      expect(readPendingCableEndpointPair(other)).toBeNull(); await expect(clearPendingCableEndpointPair(other, retained)).rejects.toThrow();
      await retainPendingCableEndpointPair(other, id(10), command());
    }
    expect(localStorage.length).toBe(3); expect(readPendingCableEndpointPair(owner)).toEqual(retained);
  });
  it('does not turn a network error or generic refusal into permission to erase the retained Save', async () => {
    const retained = await retainPendingCableEndpointPair(owner, id(9), command());
    for (const error of [new TypeError('connection lost'), Object.assign(new Error('refused'), { outcome: 'refused', status: 409 })]) {
      const dispatch = vi.fn().mockRejectedValue(error); await expect(dispatch(await verifyPendingCableEndpointPair(owner, retained))).rejects.toBe(error);
      expect(readPendingCableEndpointPair(owner)).toEqual(retained); await expect(retainPendingCableEndpoint(owner, id(10), 'from', legacyCommand())).rejects.toThrow();
    }
  });
  it.each(['cable', 'outer-key', 'inner-key', 'other-context', 'point', 'policy', 'created-at'] as const)('compares the entire durable command before retry or clear: %s', async field => {
    const retained = await retainPendingCableEndpointPair(owner, id(9), command()), changed = structuredClone(retained);
    if (field === 'cable') changed.cableId = id(90); if (field === 'outer-key') changed.command.idempotencyKey = id(90);
    if (field === 'inner-key') changed.command.endpoints[0].command.idempotencyKey = id(90);
    if (field === 'other-context') { changed.command.expectedContexts.to = 'f'.repeat(64); changed.command.endpoints[1].command.expectedContextSha256 = 'f'.repeat(64); }
    if (field === 'point' && changed.command.endpoints[0].command.selection.mode === 'fixed-world') changed.command.endpoints[0].command.selection.pointProjectMetres = [9, 9, 9];
    if (field === 'policy') for (const entry of changed.command.endpoints) entry.command.initialFill = { mode: 'when-both-empty' };
    if (field === 'created-at') changed.createdAt = '2026-10-19T00:00:00Z';
    const raw = JSON.stringify(changed); localStorage.setItem(storageKey(), raw);
    await expect(verifyPendingCableEndpointPair(owner, retained)).rejects.toThrow(); await expect(clearPendingCableEndpointPair(owner, retained)).rejects.toThrow();
    expect(localStorage.getItem(storageKey())).toBe(raw);
  });
  it('clears only an exact retained record after the caller verifies its saved or closed proof', async () => {
    const retained = await retainPendingCableEndpointPair(owner, id(9), command());
    await expect(verifyPendingCableEndpointPair(owner, retained)).resolves.toEqual(retained); await clearPendingCableEndpointPair(owner, retained);
    expect(readPendingCableEndpointPair(owner)).toBeNull(); await expect(clearPendingCableEndpointPair(owner, retained)).rejects.toThrow();
    await retainPendingCableEndpoint(owner, id(10), 'from', legacyCommand()); expect(readPendingCableEndpoint(owner)).not.toBeNull();
  });
  it('never overwrites malformed, duplicate-key, oversized or foreign-owner data', async () => {
    const valid = await retainPendingCableEndpointPair(owner, id(9), command()); await clearPendingCableEndpointPair(owner, valid);
    for (const raw of ['{"accountId":"a","account\\u0049d":"b"}', 'x'.repeat(256 * 1024 + 1),
      JSON.stringify({ ...valid, accountId: id(90) }), JSON.stringify({ ...valid, command: { ...valid.command, secretToken: 'unexpected' } })]) {
      localStorage.setItem(storageKey(), raw); expect(() => readPendingCableEndpointPair(owner)).toThrow();
      await expect(retainPendingCableEndpointPair(owner, id(10), command())).rejects.toThrow();
      await expect(retainPendingCableEndpoint(owner, id(10), 'from', legacyCommand())).rejects.toThrow(); expect(localStorage.getItem(storageKey())).toBe(raw);
    }
  });
  it('does not replace malformed historical legacy data under the shared owner key', async () => {
    const key = `${CABLE_ENDPOINT_PENDING_PREFIX}${owner.accountId}:${owner.projectId}`; localStorage.setItem(key, 'unreadable');
    await expect(retainPendingCableEndpointPair(owner, id(9), command())).rejects.toThrow(); expect(localStorage.getItem(key)).toBe('unreadable'); expect(readPendingCableEndpointPair(owner)).toBeNull();
  });
  it('fails closed without Web Locks or durable write/readback and never falls back to memory', async () => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
    await expect(retainPendingCableEndpointPair(owner, id(9), command())).rejects.toThrow(/Web Locks/); expect(localStorage.length).toBe(0);
  });
  it('requires durable readback and preserves storage errors without sending anything', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});
    await expect(retainPendingCableEndpointPair(owner, id(9), command())).rejects.toThrow(/retained/); expect(readPendingCableEndpointPair(owner)).toBeNull();
  });
  it('retains a confirmed record if the local clear cannot be durably observed', async () => {
    const retained = await retainPendingCableEndpointPair(owner, id(9), command()); vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {});
    await expect(clearPendingCableEndpointPair(owner, retained)).rejects.toThrow(/locally/); expect(readPendingCableEndpointPair(owner)).toEqual(retained);
  });
  it('releases the common legacy lock after failure so a verified old command can still close', async () => {
    const retained = await retainPendingCableEndpoint(owner, id(10), 'from', legacyCommand());
    await expect(retainPendingCableEndpointPair(owner, id(9), command())).rejects.toThrow(); await clearPendingCableEndpoint(owner, retained);
    await expect(retainPendingCableEndpointPair(owner, id(9), command())).resolves.toMatchObject({ cableId: id(9) });
  });
});
