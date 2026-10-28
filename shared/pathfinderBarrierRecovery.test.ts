// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { barrierCanonicalJson } from './pathfinderBarriers.js';
import { MIXED_BARRIER_POLICY } from './pathfinderBarrierMixed.js';
import { BARRIER_COMMAND_HASH_FENCE, barrierCommandCloseSchema, barrierCommandClosureHashInput, barrierCommandClosureSchema,
  barrierCommandRecoveryTargetHashInput, barrierCommandRecoveryTargetSchema, barrierCommandRecoveryResponseSchema,
  matchBarrierCommandRecovery, parseBarrierCommandRecoveryQuery, verifyBarrierCommandClosure,
  type BarrierCommandClosure, type BarrierCommandRecoveryTarget } from './pathfinderBarrierRecovery.js';

const id = (value: number) => `bc210000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const scope = { projectId: id(1), modelVersionId: id(2), selectionRevision: '0', contentFingerprint: 'a'.repeat(64),
  captureFrameId: id(3), captureFrameSha256: 'b'.repeat(64), coordinateFrame: 'canonical-world-metres' as const };
const knownIntent = { actorId: id(4), loginId: id(5), intentId: id(6), snapshotId: id(7) };
function target(kind: 'capture-intent' | 'empty' | 'publication' = 'capture-intent', mixed = false): BarrierCommandRecoveryTarget {
  return barrierCommandRecoveryTargetSchema.parse({ schemaVersion: 'wfc.pf.barrier-command-recovery-target.v1', projectId: id(1),
    commandSha256: 'c'.repeat(64), scope: structuredClone(scope), pendingRecordSha256: 'd'.repeat(64),
    pendingRecordVersion: mixed ? 'wfc.pf.barrier-pending-command.v2' : 'wfc.pf.barrier-pending-command.v1',
    ...(mixed ? { geometryPolicy: MIXED_BARRIER_POLICY } : {}), kind,
    ...(kind === 'capture-intent' ? { knownIntent: null } : kind === 'publication'
      ? { knownIntent, captureSha256: 'e'.repeat(64), frameSha256: 'f'.repeat(64), loadId: id(8) } : {}) });
}
function original(mixed = false) {
  return { kind: 'capture' as const, commandSchemaVersion: mixed ? 'wfc.pf.barrier-capture-command.v2' as const : 'wfc.pf.barrier-capture-command.v1' as const,
    ...(mixed ? { geometryPolicy: MIXED_BARRIER_POLICY } : {}), commandSha256: 'c'.repeat(64), scope: structuredClone(scope),
    actorId: knownIntent.actorId, loginId: knownIntent.loginId, intentId: knownIntent.intentId, snapshotId: knownIntent.snapshotId,
    captureSha256: 'e'.repeat(64), expectedRegistryRevision: '3' };
}
function closure(t: BarrierCommandRecoveryTarget, recorded = false): BarrierCommandClosure {
  const value = barrierCommandClosureSchema.parse({ schemaVersion: 'wfc.pf.barrier-command-closure.v1', closureId: id(9),
    projectId: t.projectId, commandSha256: t.commandSha256, requestedCommand: { lane: t.pendingRecordVersion.endsWith('.v2') ? 'mixed-v2' : 'legacy-v1',
      kind: t.kind === 'empty' ? 'declare-empty' : 'capture', scope: t.scope }, original: recorded ? { state: 'recorded', command: original(t.pendingRecordVersion.endsWith('.v2')) } : { state: 'not-recorded' },
    outcome: 'closed-not-published', fence: BARRIER_COMMAND_HASH_FENCE,
    // Current closer is deliberately different from the original, expired owner.
    closedBy: { authority: 'current-project-administrator-close-only', actorId: id(10), loginId: id(11) }, closedAt: '2026-10-22T12:00:00.000Z',
    mayResumeCapture: false, mayPublish: false, establishesCurrentFrame: false, grantsCalculation: false, contentSha256: '0'.repeat(64) });
  value.contentSha256 = digest(barrierCanonicalJson(barrierCommandClosureHashInput(value)));
  return value;
}
const response = <T extends object>(t: BarrierCommandRecoveryTarget, body: T) => ({ schemaVersion: 'wfc.pf.barrier-command-recovery.v1',
  targetSha256: digest(barrierCanonicalJson(barrierCommandRecoveryTargetHashInput(t))), pendingRecordSha256: t.pendingRecordSha256, ...body });

describe('additive exact-hash barrier recovery contract, pure synthetic metadata only', () => {
  it.each(([false, true] as const).flatMap(mixed => (['capture-intent', 'empty', 'publication'] as const).map(kind => ({ mixed, kind }))))
    ('keeps $kind/$mixed pending source lineage without an original body, token or names', ({ kind, mixed }) => {
      const t = target(kind, mixed), before = structuredClone(t);
      expect(parseBarrierCommandRecoveryQuery({ target: barrierCanonicalJson(t) })).toEqual(t);
      expect(barrierCommandCloseSchema.parse({ schemaVersion: 'wfc.pf.barrier-command-close.v1', target: t }).target).toEqual(t);
      expect(t).toEqual(before); expect(JSON.stringify(t)).not.toMatch(/token|selectedParents|verticesMetres|idempotencyKey/);
    });
  it('refuses a legacy pending tag with injected mixed policy instead of reinterpreting it', () => {
    expect(barrierCommandRecoveryTargetSchema.safeParse({ ...target(), geometryPolicy: MIXED_BARRIER_POLICY }).success).toBe(false);
    expect(barrierCommandRecoveryTargetSchema.safeParse({ ...target(), pendingRecordVersion: 'wfc.pf.barrier-pending-command.v3' }).success).toBe(false);
  });
  it.each(['capture-intent', 'empty'] as const)('distinguishes absent original %s closure from proof that the request never existed', kind => {
    const t = target(kind), closed = closure(t), value = response(t, { outcome: 'closed', closure: closed });
    expect(verifyBarrierCommandClosure(closed, digest)).toBe(true); expect(matchBarrierCommandRecovery(t, value, digest)).toEqual(value);
    expect(closed.original).toEqual({ state: 'not-recorded' }); expect(closed.fence).toBe(BARRIER_COMMAND_HASH_FENCE);
  });
  it('settles a recorded mixed publication by cancellation without granting the new closer its old capture rights', () => {
    const t = target('publication', true), closed = closure(t, true), value = response(t, { outcome: 'closed', closure: closed });
    expect(matchBarrierCommandRecovery(t, value, digest)).toEqual(value);
    expect(closed).toMatchObject({ mayResumeCapture: false, mayPublish: false, establishesCurrentFrame: false, grantsCalculation: false });
    expect(closed.closedBy.actorId).not.toBe(knownIntent.actorId);
  });
  it('cannot settle acknowledged identities with an alleged absent original', () => {
    const t = target('publication'); expect(() => matchBarrierCommandRecovery(t, response(t, { outcome: 'closed', closure: closure(t) }), digest)).toThrow('BARRIER_RECOVERY_CLOSURE_CHANGED');
  });
  it('keeps no-row and pending observations nonterminal, including a captured but unresolved original', () => {
    const t = target('publication');
    expect(matchBarrierCommandRecovery(t, response(t, { outcome: 'not-recorded' }), digest)).toBeNull();
    expect(matchBarrierCommandRecovery(t, response(t, { outcome: 'pending', original: original() }), digest)).toBeNull();
  });
  it.each(['record', 'target', 'scope', 'lane', 'kind', 'owner', 'closure-digest'] as const)('refuses a changed %s binding before local deletion', field => {
    const t = target('publication', true), closed = closure(t, true), value = response(t, { outcome: 'closed' as const, closure: closed });
    if (field === 'record') value.pendingRecordSha256 = '1'.repeat(64);
    if (field === 'target') value.targetSha256 = '1'.repeat(64);
    if (field === 'scope') value.closure.requestedCommand.scope.captureFrameSha256 = '1'.repeat(64);
    if (field === 'lane') value.closure.requestedCommand.lane = 'legacy-v1';
    if (field === 'kind') value.closure.requestedCommand.kind = 'declare-empty';
    if (field === 'owner' && value.closure.original.state === 'recorded') {
      value.closure.original.command.actorId = id(99);
      value.closure.contentSha256 = digest(barrierCanonicalJson(barrierCommandClosureHashInput(value.closure)));
    }
    if (field === 'closure-digest') value.closure.contentSha256 = '1'.repeat(64);
    expect(() => matchBarrierCommandRecovery(t, value, digest)).toThrow();
  });
  it('retains exact historical publication and explicit missing frame attestation', () => {
    const t = target('publication', true), value = response(t, { outcome: 'published', original: original(true), frameBinding: 'not-recorded', frameSha256: null,
      publication: { schemaVersion: 'wfc.pf.barrier-publication-receipt.v2', duplicate: true, snapshot: { schemaVersion: 'wfc.pf.barrier-snapshot-reference.v2',
        geometryPolicy: MIXED_BARRIER_POLICY, snapshotId: knownIntent.snapshotId, scope: t.scope, registryRevision: '4', contentSha256: '2'.repeat(64), mode: 'mixed-mesh-set' } } });
    expect(matchBarrierCommandRecovery(t, value, digest)).toEqual(value);
    expect(barrierCommandRecoveryResponseSchema.safeParse({ ...value, frameBinding: 'verified', frameSha256: t.kind === 'publication' ? t.frameSha256 : null }).success).toBe(false);
  });
  it('requires the original publication full-frame hash for a geometry refusal', () => {
    const t = target('publication', true), value = response(t, { outcome: 'geometry-refused', original: original(true), refusal: {
      schemaVersion: 'wfc.pf.barrier-publication-refusal.v1', outcome: 'not-published', intentId: knownIntent.intentId, commandSha256: t.commandSha256,
      captureSha256: 'e'.repeat(64), frameSha256: 'f'.repeat(64), implementationSha256: '3'.repeat(64), reasonCode: 'BARRIER_GEOMETRY_REFUSED', duplicate: true } });
    expect(matchBarrierCommandRecovery(t, value, digest)).toEqual(value);
    value.refusal.frameSha256 = '1'.repeat(64); expect(() => matchBarrierCommandRecovery(t, value, digest)).toThrow('BARRIER_RECOVERY_FRAME_CHANGED');
  });
  it('rejects malformed/foreign query and terminal shapes without a permissive unknown-version fallback', () => {
    const t = target(); expect(() => parseBarrierCommandRecoveryQuery({ target: '{"scope":{},"scope":{}}' })).toThrow();
    expect(() => parseBarrierCommandRecoveryQuery({ target: barrierCanonicalJson(t), bypass: true })).toThrow();
    expect(barrierCommandRecoveryTargetSchema.safeParse({ ...t, projectId: id(99) }).success).toBe(false);
    expect(barrierCommandRecoveryResponseSchema.safeParse(response(t, { outcome: 'timed-out-so-clear' })).success).toBe(false);
    expect(barrierCommandClosureSchema.safeParse({ ...closure(t), mayPublish: true }).success).toBe(false);
  });
});
