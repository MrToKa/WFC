import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BARRIER_PENDING_STORAGE_KEY, barrierPendingHash, clearPendingBarrierCommand, createBarrierCommandSentinel,
  createPendingBarrierRecoveryTarget, matchPendingBarrierCommandRecovery, matchBarrierCaptureOutcome,
  readPendingBarrierCommand, retainPendingBarrierCommand, sealPendingBarrierCommand, type BarrierPendingCommand } from './barrierPendingPublication';
import { MIXED_BARRIER_POLICY } from '../../../../shared/pathfinderBarrierMixed';
import { BARRIER_COMMAND_HASH_FENCE, barrierCommandClosureHashInput, barrierCommandClosureSchema,
  barrierCommandRecoveryTargetHashInput } from '../../../../shared/pathfinderBarrierRecovery';
const id = (n: number) => `b5210000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = { projectId: id(1), modelVersionId: id(2), selectionRevision: '1', contentFingerprint: 'a'.repeat(64),
  captureFrameId: id(3), captureFrameSha256: 'b'.repeat(64), coordinateFrame: 'canonical-world-metres' as const };
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); sessionStorage.clear(); });
afterEach(() => vi.unstubAllGlobals());
async function publication(projectId = id(1), mixed = false) {
  const command = { schemaVersion: mixed ? 'wfc.pf.barrier-capture-command.v2' : 'wfc.pf.barrier-capture-command.v1',
    ...(mixed ? { geometryPolicy: MIXED_BARRIER_POLICY } : {}), scope: { ...scope, projectId }, expectedRegistryRevision: '1', idempotencyKey: id(4),
    selectedParents: [{ selectionId: id(10), kind: 'floor', objectId: 'dbid:7', dbId: 7, externalId: null, name: 'Private equipment',
      identityBasis: 'version-local-only', inclusion: 'own-and-all-descendant-fragments' }] };
  const sentinel = await createBarrierCommandSentinel('capture-intent', command, { ...scope, projectId }, 'private-raw-token');
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
it('retains a mixed command through refresh and accepts only its exact mixed historical terminal lane', async () => {
  const value = await publication(id(1), true); retainPendingBarrierCommand(sessionStorage, value, null);
  expect(value.schemaVersion).toBe('wfc.pf.barrier-pending-command.v2');
  expect(await readPendingBarrierCommand(sessionStorage, id(1))).toEqual(value);
  const reference = { schemaVersion: 'wfc.pf.barrier-snapshot-reference.v2', geometryPolicy: MIXED_BARRIER_POLICY,
    snapshotId: value.snapshotId, scope, registryRevision: '2', contentSha256: 'e'.repeat(64), mode: 'mixed-mesh-set' };
  const terminal = { schemaVersion: 'wfc.pf.barrier-capture-outcome.v2', outcome: 'published', intentId: value.intentId,
    commandSha256: value.commandSha256, captureSha256: value.captureSha256, frameBinding: 'not-recorded', frameSha256: null,
    publication: { schemaVersion: 'wfc.pf.barrier-publication-receipt.v2', snapshot: reference, duplicate: true } };
  expect(matchBarrierCaptureOutcome(value, terminal)).toEqual(terminal);
  const { schemaVersion: _tag, geometryPolicy: _policy, ...legacyReference } = reference;
  const legacy = { ...terminal, schemaVersion: 'wfc.pf.barrier-capture-outcome.v1',
    publication: { schemaVersion: 'wfc.pf.barrier-publication-receipt.v1', snapshot: { ...legacyReference, mode: 'mesh-set' }, duplicate: true } };
  expect(() => matchBarrierCaptureOutcome(value, legacy)).toThrow('BARRIER_OUTCOME_SNAPSHOT_CHANGED');
  expect(() => matchBarrierCaptureOutcome(legacyRecord(value), terminal)).toThrow('BARRIER_OUTCOME_SNAPSHOT_CHANGED');
  expect(() => matchBarrierCaptureOutcome(value, { ...terminal, frameBinding: 'verified', frameSha256: value.frameSha256 })).toThrow('BARRIER_OUTCOME_INVALID');
  expect(sessionStorage.getItem(BARRIER_PENDING_STORAGE_KEY)).not.toBeNull();
});
function legacyRecord(value: Awaited<ReturnType<typeof publication>>) {
  const { schemaVersion: _tag, ...body } = value;
  if (!('geometryPolicy' in body)) throw Error('fixture');
  const { geometryPolicy: _policy, ...legacy } = body;
  return { ...legacy, schemaVersion: 'wfc.pf.barrier-pending-command.v1' as const };
}
it('never upgrades a retained legacy command to a different policy on replacement', async () => {
  const old = await publication(); retainPendingBarrierCommand(sessionStorage, old, null);
  const changed = await sealPendingBarrierCommand({ ...old, schemaVersion: 'wfc.pf.barrier-pending-command.v2', geometryPolicy: MIXED_BARRIER_POLICY });
  expect(() => retainPendingBarrierCommand(sessionStorage, changed, old)).toThrow('BARRIER_PENDING_COMMAND_CHANGED');
  expect(await readPendingBarrierCommand(sessionStorage, id(1))).toEqual(old);
});

async function recoveryClosure(value: BarrierPendingCommand) {
  const target = await createPendingBarrierRecoveryTarget(value), mixed = value.schemaVersion === 'wfc.pf.barrier-pending-command.v2';
  const command = { commandSchemaVersion: mixed ? 'wfc.pf.barrier-capture-command.v2' : 'wfc.pf.barrier-capture-command.v1',
    ...(mixed ? { geometryPolicy: MIXED_BARRIER_POLICY } : {}), kind: 'capture', commandSha256: value.commandSha256, scope: value.scope,
    actorId: value.actorId, loginId: value.loginId, intentId: value.intentId, snapshotId: value.snapshotId, expectedRegistryRevision: '1',
    captureSha256: value.kind === 'publication' ? value.captureSha256 : null };
  const closure = barrierCommandClosureSchema.parse({ schemaVersion: 'wfc.pf.barrier-command-closure.v1', closureId: id(81), projectId: value.projectId,
    commandSha256: value.commandSha256, requestedCommand: { lane: mixed ? 'mixed-v2' : 'legacy-v1', kind: value.kind === 'empty' ? 'declare-empty' : 'capture', scope: value.scope },
    original: value.kind !== 'empty' && value.actorId !== null ? { state: 'recorded', command } : { state: 'not-recorded' },
    outcome: 'closed-not-published', fence: BARRIER_COMMAND_HASH_FENCE, closedBy: { authority: 'current-project-administrator-close-only', actorId: id(82), loginId: id(83) },
    closedAt: '2026-10-22T10:00:00.000Z', mayResumeCapture: false, mayPublish: false, establishesCurrentFrame: false, grantsCalculation: false, contentSha256: '0'.repeat(64) });
  closure.contentSha256 = await barrierPendingHash(barrierCommandClosureHashInput(closure));
  return { schemaVersion: 'wfc.pf.barrier-command-recovery.v1', outcome: 'closed', closure,
    pendingRecordSha256: value.recordSha256, targetSha256: await barrierPendingHash(barrierCommandRecoveryTargetHashInput(target)) };
}
it.each([false, true])('projects all retained kinds from the exact hash-verified original source policy; mixed=%s', async mixed => {
  const value = await publication(id(1), mixed);
  const { captureSha256: _capture, frameSha256: _frame, loadId: _load, recordSha256: _record, ...source } = value;
  const capture = await sealPendingBarrierCommand({ ...source, kind: 'capture-intent', actorId: null, loginId: null, intentId: null, snapshotId: null });
  const empty = await sealPendingBarrierCommand({ ...source, kind: 'empty', actorId: null, loginId: null, intentId: null, snapshotId: null });
  for (const original of [value, capture, empty]) {
    const target = await createPendingBarrierRecoveryTarget(original);
    expect(target).toMatchObject({ pendingRecordVersion: original.schemaVersion, pendingRecordSha256: original.recordSha256,
      commandSha256: original.commandSha256, scope: original.scope, kind: original.kind });
    expect('geometryPolicy' in target).toBe(mixed); expect(JSON.stringify(target)).not.toContain(original.tokenSha256);
    expect(JSON.stringify(target)).not.toContain('private-raw-token'); expect(JSON.stringify(target)).not.toContain('Private equipment');
    expect(await matchPendingBarrierCommandRecovery(original, await recoveryClosure(original))).toMatchObject({ outcome: 'closed' });
  }
});
it('refuses a tampered full retained record before deriving its recovery target', async () => {
  const value = await publication();
  await expect(createPendingBarrierRecoveryTarget({ ...value, tokenSha256: 'f'.repeat(64) })).rejects.toThrow('BARRIER_PENDING_STORAGE_CHANGED');
  await expect(createPendingBarrierRecoveryTarget({ ...value, commandSha256: 'f'.repeat(64) })).rejects.toThrow('BARRIER_PENDING_STORAGE_CHANGED');
});
it('requires exact original record, target, closure digest and acknowledged owner before terminal matching', async () => {
  const value = await publication(id(1), true), terminal = await recoveryClosure(value); retainPendingBarrierCommand(sessionStorage, value, null);
  await expect(matchPendingBarrierCommandRecovery(value, { ...terminal, pendingRecordSha256: '0'.repeat(64) })).rejects.toThrow();
  await expect(matchPendingBarrierCommandRecovery(value, { ...terminal, targetSha256: '0'.repeat(64) })).rejects.toThrow();
  await expect(matchPendingBarrierCommandRecovery(value, { ...terminal, closure: { ...terminal.closure, contentSha256: '0'.repeat(64) } })).rejects.toThrow();
  const wrong = structuredClone(terminal);
  if (wrong.closure.original.state !== 'recorded') throw Error('fixture');
  wrong.closure.original.command.actorId = id(99);
  wrong.closure.contentSha256 = await barrierPendingHash(barrierCommandClosureHashInput(wrong.closure));
  await expect(matchPendingBarrierCommandRecovery(value, wrong)).rejects.toThrow();
  expect(await readPendingBarrierCommand(sessionStorage, id(1))).toEqual(value);
});
it('treats null and exact not-recorded responses as nonterminal without removing storage', async () => {
  const value = await publication(), target = await createPendingBarrierRecoveryTarget(value); retainPendingBarrierCommand(sessionStorage, value, null);
  expect(await matchPendingBarrierCommandRecovery(value, null)).toBeNull();
  expect(await matchPendingBarrierCommandRecovery(value, { schemaVersion: 'wfc.pf.barrier-command-recovery.v1', outcome: 'not-recorded',
    pendingRecordSha256: value.recordSha256, targetSha256: await barrierPendingHash(barrierCommandRecoveryTargetHashInput(target)) })).toBeNull();
  expect(await readPendingBarrierCommand(sessionStorage, id(1))).toEqual(value);
});
