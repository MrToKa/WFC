import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BARRIER_PENDING_STORAGE_KEY, barrierPendingHash, clearPendingBarrierCommand, createBarrierCommandSentinel,
  matchBarrierCaptureOutcome, readPendingBarrierCommand, retainPendingBarrierCommand, sealPendingBarrierCommand } from './barrierPendingPublication';
const id = (n: number) => `b5210000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = { projectId: id(1), modelVersionId: id(2), selectionRevision: '1', contentFingerprint: 'a'.repeat(64),
  captureFrameId: id(3), captureFrameSha256: 'b'.repeat(64), coordinateFrame: 'canonical-world-metres' as const };
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); sessionStorage.clear(); });
afterEach(() => vi.unstubAllGlobals());
async function publication(projectId = id(1)) {
  const sentinel = await createBarrierCommandSentinel('capture-intent', { businessName: 'Private equipment', idempotencyKey: id(4) }, { ...scope, projectId }, 'private-raw-token');
  const value = await sealPendingBarrierCommand({ ...sentinel, kind: 'publication', actorId: id(5), loginId: id(6),
    intentId: id(7), snapshotId: id(8), captureSha256: 'c'.repeat(64), frameSha256: 'd'.repeat(64), loadId: id(9) });
  if (value.kind !== 'publication') throw Error('Invalid fixture'); return value;
}
it('retains hashes and opaque identities without token, command, geometry or business names', async () => {
  const value = await publication(); retainPendingBarrierCommand(sessionStorage, value, null);
  expect(await readPendingBarrierCommand(sessionStorage, id(1))).toEqual(value);
  const raw = sessionStorage.getItem(BARRIER_PENDING_STORAGE_KEY)!;
  expect(raw).not.toContain('private-raw-token'); expect(raw).not.toContain('Private equipment'); expect(raw).not.toContain('businessName');
  expect(raw).not.toContain('verticesMetres'); expect(raw).not.toContain('frameObservation');
  clearPendingBarrierCommand(sessionStorage, value); expect(await readPendingBarrierCommand(sessionStorage, id(1))).toBeNull();
});
it('detects changed or extra persisted fields and never deletes a retained command while reading it', async () => {
  const value = await publication(); retainPendingBarrierCommand(sessionStorage, value, null);
  const old = sessionStorage.getItem(BARRIER_PENDING_STORAGE_KEY)!;
  sessionStorage.setItem(BARRIER_PENDING_STORAGE_KEY, old.replace(value.loginId, id(90)));
  await expect(readPendingBarrierCommand(sessionStorage, id(1))).rejects.toThrow('BARRIER_PENDING_STORAGE_CHANGED');
  expect(sessionStorage.getItem(BARRIER_PENDING_STORAGE_KEY)).not.toBeNull();
  sessionStorage.setItem(BARRIER_PENDING_STORAGE_KEY, JSON.stringify({ version: 1, commands: [{ ...value, token: 'forbidden' }] }));
  await expect(readPendingBarrierCommand(sessionStorage, id(1))).rejects.toThrow();
});
it('refuses overflow and exact replacement conflicts without evicting unresolved projects', async () => {
  for (let n = 1; n <= 8; n++) retainPendingBarrierCommand(sessionStorage, await publication(id(n + 100)), null);
  const before = sessionStorage.getItem(BARRIER_PENDING_STORAGE_KEY);
  const first = await readPendingBarrierCommand(sessionStorage, id(101));
  const ninth = await publication(id(109));
  expect(() => retainPendingBarrierCommand(sessionStorage, ninth, null)).toThrow('BARRIER_PENDING_STORAGE_FULL');
  expect(() => clearPendingBarrierCommand(sessionStorage, { ...first!, commandSha256: 'e'.repeat(64) })).toThrow('BARRIER_PENDING_COMMAND_CHANGED');
  expect(sessionStorage.getItem(BARRIER_PENDING_STORAGE_KEY)).toBe(before);
});
it('requires write/readback and does not treat storage failure as successful retention', async () => {
  const value = await publication(), broken = { getItem: () => null, setItem: vi.fn(() => { throw Error('quota'); }) } as unknown as Storage;
  expect(() => retainPendingBarrierCommand(broken, value, null)).toThrow('quota'); expect(broken.setItem).toHaveBeenCalledOnce();
  const dropped = { getItem: () => null, setItem: vi.fn() } as unknown as Storage;
  expect(() => retainPendingBarrierCommand(dropped, value, null)).toThrow('BARRIER_PENDING_STORAGE_UNCONFIRMED');
});
it('matches only exact terminal refusal or historically published command/capture identities', async () => {
  const value = await publication(), refused = { schemaVersion: 'wfc.pf.barrier-publication-refusal.v1', outcome: 'not-published',
    intentId: value.intentId, commandSha256: value.commandSha256, captureSha256: value.captureSha256, frameSha256: value.frameSha256,
    implementationSha256: 'e'.repeat(64), reasonCode: 'BARRIER_GEOMETRY_REFUSED', duplicate: false };
  expect(matchBarrierCaptureOutcome(value, null)).toBeNull(); expect(matchBarrierCaptureOutcome(value, refused)).toEqual(refused);
  for (const key of ['intentId', 'commandSha256', 'captureSha256', 'frameSha256'] as const)
    expect(() => matchBarrierCaptureOutcome(value, { ...refused, [key]: key === 'intentId' ? id(90) : 'f'.repeat(64) })).toThrow();
  const published = { schemaVersion: 'wfc.pf.barrier-capture-outcome.v1', outcome: 'published', intentId: value.intentId,
    commandSha256: value.commandSha256, captureSha256: value.captureSha256, frameBinding: 'not-recorded', frameSha256: null,
    publication: { schemaVersion: 'wfc.pf.barrier-publication-receipt.v1', duplicate: true,
      snapshot: { snapshotId: value.snapshotId, scope, registryRevision: '2', contentSha256: 'e'.repeat(64), mode: 'mesh-set' } } };
  expect(matchBarrierCaptureOutcome(value, published)).toEqual(published);
  expect(() => matchBarrierCaptureOutcome(value, { ...published, frameBinding: 'verified' })).toThrow();
  expect(await barrierPendingHash({ example: true })).toMatch(/^[a-f0-9]{64}$/);
});
