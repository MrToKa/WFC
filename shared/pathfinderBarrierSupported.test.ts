import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { barrierCanonicalJson, barrierCaptureCommandSchema, barrierSnapshotReferenceSchema, barrierSnapshotSchema } from './pathfinderBarriers.js';
import { barrierPublishedOutcomeSchema, barrierPublicationReceiptSchema } from './pathfinderBarrierOutcomes.js';
import { MIXED_BARRIER_POLICY, mixedBarrierCaptureCommandSchema, mixedBarrierSnapshotReferenceSchema } from './pathfinderBarrierMixed.js';
import * as supported from './pathfinderBarrierSupported.js';

const id = (n: number) => `ba000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sha = (c = 'a') => c.repeat(64);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const scope = () => ({ projectId: id(1), modelVersionId: id(2), contentFingerprint: sha(), selectionRevision: '3', captureFrameId: id(3),
  captureFrameSha256: sha('b'), coordinateFrame: 'canonical-world-metres' as const });
const parent = () => ({ selectionId: id(4), kind: 'floor' as const, objectId: 'dbid:7', dbId: 7, externalId: null, name: 'Selected floor',
  identityBasis: 'version-local-only' as const, inclusion: 'own-and-all-descendant-fragments' as const });
function command(mixed: boolean): supported.AnyBarrierCaptureCommand {
  const common = { scope: scope(), expectedRegistryRevision: '5', idempotencyKey: id(5), selectedParents: [parent()] };
  return supported.supportedBarrierCaptureCommandSchema.parse(mixed ? { ...common, schemaVersion: 'wfc.pf.barrier-capture-command.v2', geometryPolicy: MIXED_BARRIER_POLICY }
    : { ...common, schemaVersion: 'wfc.pf.barrier-capture-command.v1' });
}
function snapshot(mixed: boolean): supported.AnyBarrierSnapshot {
  const common = { snapshotId: id(6), scope: scope(), registryRevision: '5', contentSha256: sha(), selectedParents: [], capture: null,
    geometry: { mode: 'explicit-empty', declarationId: id(7), declaration: 'administrator-declared-no-selected-barriers', reason: 'Explicit test declaration' },
    coverage: 'registered-selected-objects-only', engineeringAccepted: false };
  const value = supported.supportedBarrierSnapshotSchema.parse(mixed ? { ...common, schemaVersion: 'wfc.pf.barrier-snapshot.v2', geometryPolicy: MIXED_BARRIER_POLICY,
    ownTerminalExemptionsSupported: false, authority: 'none' } : { ...common, schemaVersion: 'wfc.pf.barrier-snapshot.v1' });
  value.contentSha256 = hash(barrierCanonicalJson(supported.supportedBarrierSnapshotHashInput(value))); return value;
}
function registry(mixed: boolean): supported.AnyBarrierRegistry {
  const common = { scope: scope(), registryRevision: '5', state: 'ready', selectedParents: [], snapshot: supported.supportedBarrierSnapshotReference(snapshot(mixed)), reasonCodes: [] };
  return supported.supportedBarrierRegistrySchema.parse(mixed ? { ...common, schemaVersion: 'wfc.pf.barrier-registry.v2', geometryPolicy: MIXED_BARRIER_POLICY }
    : { ...common, schemaVersion: 'wfc.pf.barrier-registry.v1' });
}
function intentReceipt(mixed: boolean): supported.AnyBarrierIntentReceipt {
  return supported.supportedBarrierIntentReceiptSchema.parse({ schemaVersion: mixed ? 'wfc.pf.barrier-intent-receipt.v2' : 'wfc.pf.barrier-intent-receipt.v1', state: 'pending', duplicate: false,
    intent: { id: id(8), snapshotId: id(6), captureBlobId: id(9), manifestBlobId: id(10), createdBy: id(11), loginId: id(12), command: command(mixed) } });
}
function published(mixed: boolean): supported.AnyBarrierCaptureOutcome {
  return supported.supportedBarrierCaptureOutcomeSchema.parse({ schemaVersion: mixed ? 'wfc.pf.barrier-capture-outcome.v2' : 'wfc.pf.barrier-capture-outcome.v1', outcome: 'published',
    intentId: id(8), commandSha256: sha(), captureSha256: sha('b'), frameBinding: 'not-recorded', frameSha256: null,
    publication: { schemaVersion: mixed ? 'wfc.pf.barrier-publication-receipt.v2' : 'wfc.pf.barrier-publication-receipt.v1', snapshot: supported.supportedBarrierSnapshotReference(snapshot(mixed)), duplicate: false } })!;
}

describe('explicit supported v1 and mixed-v2 lanes', () => {
  it.each([false, true])('retains the exact %s command, receipt and snapshot lane', mixed => {
    const receipt = intentReceipt(mixed), value = snapshot(mixed), reference = supported.supportedBarrierSnapshotReference(value);
    expect(receipt.intent.command).toEqual(command(mixed)); expect(supported.verifySupportedBarrierSnapshot(value, hash)).toBe(true);
    expect((mixed ? mixedBarrierSnapshotReferenceSchema : barrierSnapshotReferenceSchema).safeParse(reference).success).toBe(true);
    expect((mixed ? barrierSnapshotReferenceSchema : mixedBarrierSnapshotReferenceSchema).safeParse(reference).success).toBe(false);
    expect(supported.supportedBarrierCaptureCommandSchema.safeParse({ ...command(mixed), schemaVersion: 'unknown' }).success).toBe(false);
    value.contentSha256 = sha('f'); expect(supported.verifySupportedBarrierSnapshot(value, hash)).toBe(false);
  });
  it('never decodes a mixed command inside an old intent receipt or vice versa', () => {
    const old = intentReceipt(false), mixed = intentReceipt(true);
    expect(supported.barrierIntentReceiptSchema.safeParse(mixed).success).toBe(false);
    expect(supported.mixedBarrierIntentReceiptSchema.safeParse(old).success).toBe(false);
    expect(supported.supportedBarrierIntentReceiptSchema.safeParse({ ...old, intent: mixed.intent }).success).toBe(false);
    expect(supported.supportedBarrierIntentReceiptSchema.safeParse({ ...mixed, intent: old.intent }).success).toBe(false);
  });
  it('can create a fresh explicit mixed command from a legacy registry without changing its route admission', () => {
    const old = registry(false), before = structuredClone(old);
    const fresh = mixedBarrierCaptureCommandSchema.parse({ ...command(true), scope: old.scope, expectedRegistryRevision: old.registryRevision });
    expect(barrierCaptureCommandSchema.safeParse(fresh).success).toBe(false); expect(old).toEqual(before);
    expect(supported.createSupportedBarrierAdmissionIntent(old, false)?.schemaVersion).toBe('wfc.pf.barrier-admission-intent.v1');
    expect(supported.createSupportedBarrierAdmissionIntent(registry(true), false)?.schemaVersion).toBe('wfc.pf.barrier-admission-intent.v2');
    expect(supported.createSupportedBarrierAdmissionIntent({ ...old, state: 'stale', reasonCodes: ['STALE_SCOPE'] }, true)).toBeNull();
    expect(supported.sameSupportedBarrierAdmissionIntent(supported.createSupportedBarrierAdmissionIntent(old, false), supported.createSupportedBarrierAdmissionIntent(registry(true), false))).toBe(false);
  });
  it('preserves an exact v2 historical success without manufacturing full-frame evidence', () => {
    const old = published(false), value = published(true);
    expect(barrierPublishedOutcomeSchema.safeParse(old).success).toBe(true); expect(barrierPublishedOutcomeSchema.safeParse(value).success).toBe(false);
    expect(supported.mixedBarrierPublishedOutcomeSchema.safeParse(old).success).toBe(false);
    if (value.outcome !== 'published' || old.outcome !== 'published') throw Error('fixture');
    expect(barrierPublicationReceiptSchema.safeParse(value.publication).success).toBe(false);
    for (const patch of [{ frameSha256: sha('c') }, { frameBinding: 'verified' }, { publication: old.publication }, { sdkCoverageVerified: true }])
      expect(supported.supportedBarrierCaptureOutcomeSchema.safeParse({ ...value, ...patch }).success).toBe(false);
    expect(supported.supportedBarrierCaptureOutcomeSchema.safeParse(null).success).toBe(true);
  });
  it('leaves refusal.v1 unchanged and exact-command bound for either lane', () => {
    const value = { schemaVersion: 'wfc.pf.barrier-publication-refusal.v1', outcome: 'not-published', intentId: id(8), commandSha256: sha(),
      captureSha256: sha('b'), frameSha256: sha('c'), implementationSha256: sha('d'), reasonCode: 'BARRIER_GEOMETRY_REFUSED', duplicate: false };
    expect(supported.supportedBarrierCaptureOutcomeSchema.parse(value)).toEqual(value);
    expect(supported.supportedBarrierPublicationOutcomeSchema.parse(value)).toEqual(value);
    expect(supported.supportedBarrierCaptureOutcomeSchema.safeParse({ ...value, geometryPolicy: MIXED_BARRIER_POLICY }).success).toBe(false);
  });
  it('keeps explicitly empty new publication tagged even though its mode name is shared', () => {
    const value = snapshot(true), reference = supported.supportedBarrierSnapshotReference(value);
    expect(barrierSnapshotSchema.safeParse(value).success).toBe(false);
    expect(supported.supportedBarrierSnapshotReferenceSchema.safeParse({ ...reference, schemaVersion: 'wfc.pf.barrier-snapshot-reference.v3' }).success).toBe(false);
    expect(supported.supportedBarrierRegistryCommandSchema.safeParse({ schemaVersion: 'wfc.pf.barrier-registry-command.v2', geometryPolicy: MIXED_BARRIER_POLICY,
      scope: scope(), expectedRegistryRevision: '5', idempotencyKey: id(13), action: 'declare-empty', reason: 'Explicit declaration' }).success).toBe(true);
  });
});
