import { describe, expect, it } from 'vitest';
import { barrierRegistrySchema, type BarrierRegistry } from './pathfinderBarriers.js';
import {
  BARRIER_ADMISSION_INTENT_VERSION, barrierAdmissionIntentSchema, createBarrierAdmissionIntent, sameBarrierAdmissionIntent,
  type BarrierAdmissionIntent,
} from './pathfinderBarrierAdmission.js';

const id = (n: number) => `b5100000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function ready(mode: 'mesh-set' | 'explicit-empty' = 'mesh-set'): BarrierRegistry {
  const scope = { projectId: id(1), modelVersionId: id(2), contentFingerprint: 'a'.repeat(64), selectionRevision: '3',
    captureFrameId: id(4), captureFrameSha256: 'b'.repeat(64), coordinateFrame: 'canonical-world-metres' as const };
  return barrierRegistrySchema.parse({ schemaVersion: 'wfc.pf.barrier-registry.v1', scope, registryRevision: '5', state: 'ready',
    selectedParents: mode === 'explicit-empty' ? [] : [{ selectionId: id(6), kind: 'wall', objectId: 'dbid:10', dbId: 10,
      externalId: null, name: 'Synthetic wall parent', identityBasis: 'version-local-only', inclusion: 'own-and-all-descendant-fragments' }],
    snapshot: { snapshotId: id(7), scope, registryRevision: '5', contentSha256: 'c'.repeat(64), mode }, reasonCodes: [] });
}
function unconfigured(): BarrierRegistry {
  return barrierRegistrySchema.parse({ ...ready(), state: 'unconfigured', registryRevision: '0', selectedParents: [], snapshot: null,
    reasonCodes: ['NO_BARRIER_SCOPE_CONFIGURED'] });
}
function intent(): BarrierAdmissionIntent { return createBarrierAdmissionIntent(ready(), false)!; }

describe('strict versioned barrier admission intent without policy or clearance authority', () => {
  it.each(['mesh-set', 'explicit-empty'] as const)('retains the exact current %s reference with drilling off', mode => {
    const registry = ready(mode), value = createBarrierAdmissionIntent(registry, false);
    expect(value).toEqual({ schemaVersion: BARRIER_ADMISSION_INTENT_VERSION, scope: registry.scope, expectedRegistryRevision: '5',
      expectedSnapshot: registry.snapshot, drillThroughWalls: false });
    expect(value?.expectedSnapshot).not.toBeNull(); expect(barrierAdmissionIntentSchema.parse(value)).toEqual(value);
  });
  it.each(['mesh-set', 'explicit-empty'] as const)('retains the current %s reference for explicit drilling too', mode => {
    const registry = ready(mode), value = createBarrierAdmissionIntent(registry, true);
    expect(value?.expectedSnapshot).toEqual(registry.snapshot); expect(value?.drillThroughWalls).toBe(true);
  });
  it('permits only explicit drilling on a strict unconfigured scope; it never treats absence as empty', () => {
    expect(createBarrierAdmissionIntent(unconfigured(), false)).toBeNull();
    expect(createBarrierAdmissionIntent(unconfigured(), true)).toEqual({ schemaVersion: BARRIER_ADMISSION_INTENT_VERSION,
      scope: unconfigured().scope, expectedRegistryRevision: '0', expectedSnapshot: null, drillThroughWalls: true });
    expect(barrierAdmissionIntentSchema.safeParse({ ...intent(), expectedSnapshot: null, drillThroughWalls: false }).success).toBe(false);
  });
  it.each(['capturing', 'partial', 'invalid', 'stale'] as const)('never drops an unavailable %s registry even under explicit drilling', state => {
    const registry = { ...ready(), state, snapshot: state === 'stale' ? ready().snapshot : null, reasonCodes: ['BARRIER_MODEL_SCOPE_CHANGED'] };
    expect(barrierRegistrySchema.safeParse(registry).success).toBe(true);
    expect(createBarrierAdmissionIntent(registry as BarrierRegistry, false)).toBeNull();
    expect(createBarrierAdmissionIntent(registry as BarrierRegistry, true)).toBeNull();
  });
  it.each([null, undefined, {}, { ...ready(), state: 'unknown' }, { ...ready(), snapshot: null }, { ...unconfigured(), snapshot: ready().snapshot }])
    ('does not manufacture authority from unavailable or malformed registry %#', registry => {
      expect(createBarrierAdmissionIntent(registry as BarrierRegistry | null | undefined, true)).toBeNull();
    });
  it('copies the snapshot and scope instead of retaining mutable registry aliases', () => {
    const registry = ready(), value = createBarrierAdmissionIntent(registry, false)!;
    registry.scope.captureFrameSha256 = 'd'.repeat(64); registry.snapshot!.contentSha256 = 'e'.repeat(64);
    expect(value.scope.captureFrameSha256).toBe('b'.repeat(64)); expect(value.expectedSnapshot?.contentSha256).toBe('c'.repeat(64));
  });
  it('has no wire default for drilling; fresh UI default-off is a separate explicit choice', () => {
    const value: Record<string, unknown> = { ...intent() }; delete value.drillThroughWalls;
    expect(barrierAdmissionIntentSchema.safeParse(value).success).toBe(false);
    expect(createBarrierAdmissionIntent(ready(), undefined as unknown as boolean)).toBeNull();
  });
  it.each([undefined, null, 0, 1, 'false', 'true', {}, []])('refuses an implicit/coerced drilling value %#', drillThroughWalls => {
    expect(barrierAdmissionIntentSchema.safeParse({ ...intent(), drillThroughWalls }).success).toBe(false);
    expect(createBarrierAdmissionIntent(ready(), drillThroughWalls as unknown as boolean)).toBeNull();
  });
  it.each(['projectId', 'modelVersionId', 'captureFrameId'] as const)('refuses a snapshot from another %s', key => {
    const value = intent(); value.expectedSnapshot!.scope[key] = id(99);
    expect(barrierAdmissionIntentSchema.safeParse(value).success).toBe(false);
  });
  it.each(['contentFingerprint', 'captureFrameSha256'] as const)('refuses changed snapshot %s evidence', key => {
    const value = intent(); value.expectedSnapshot!.scope[key] = 'd'.repeat(64);
    expect(barrierAdmissionIntentSchema.safeParse(value).success).toBe(false);
  });
  it('refuses snapshot selection or registry revisions that differ from the exact intent', () => {
    const first = intent(); first.expectedSnapshot!.scope.selectionRevision = '4';
    expect(barrierAdmissionIntentSchema.safeParse(first).success).toBe(false);
    const second = intent(); second.expectedSnapshot!.registryRevision = '6';
    expect(barrierAdmissionIntentSchema.safeParse(second).success).toBe(false);
  });
  it.each(['-1', '01', '1.0', ' 1', '1\n', '9223372036854775808', '9'.repeat(1000)])('refuses an invalid expected revision %#', expectedRegistryRevision => {
    expect(barrierAdmissionIntentSchema.safeParse({ ...intent(), expectedRegistryRevision }).success).toBe(false);
  });
  it('accepts the existing signed-bigint maximum exactly, without converting it to a JS number', () => {
    const value = intent(); value.expectedRegistryRevision = '9223372036854775807'; value.expectedSnapshot!.registryRevision = value.expectedRegistryRevision;
    expect(barrierAdmissionIntentSchema.parse(value).expectedRegistryRevision).toBe('9223372036854775807');
  });
  it.each(['actorId', 'policy', 'policySha256', 'ready', 'filesystemPath', 'engineeringAccepted'])('refuses unexpected %s authority fields', key => {
    expect(barrierAdmissionIntentSchema.safeParse({ ...intent(), [key]: true }).success).toBe(false);
  });
  it.each(['scope', 'expectedSnapshot'] as const)('keeps nested %s records strict', key => {
    const value = intent(); expect(barrierAdmissionIntentSchema.safeParse({ ...value, [key]: { ...value[key], forged: true } }).success).toBe(false);
  });
});

describe('immutable request/resume ownership comparison', () => {
  it('compares only two absent legacy values without inventing a new default intent', () => {
    expect(sameBarrierAdmissionIntent(undefined, undefined)).toBe(true);
    expect(sameBarrierAdmissionIntent(undefined, intent())).toBe(false); expect(sameBarrierAdmissionIntent(intent(), undefined)).toBe(false);
    expect(sameBarrierAdmissionIntent(null, null)).toBe(false); expect(sameBarrierAdmissionIntent(undefined, null)).toBe(false);
  });
  it('compares parsed intents canonically without depending on JSON object insertion order', () => {
    const value = intent(); const reordered = { drillThroughWalls: value.drillThroughWalls, expectedSnapshot: value.expectedSnapshot,
      expectedRegistryRevision: value.expectedRegistryRevision, scope: value.scope, schemaVersion: value.schemaVersion };
    expect(sameBarrierAdmissionIntent(value, reordered)).toBe(true);
  });
  it.each(['drill', 'snapshot-id', 'snapshot-hash', 'revision', 'frame', 'model', 'project', 'mode'] as const)
    ('does not resume a new request under changed %s ownership', change => {
      const left = intent(), right = structuredClone(left);
      if (change === 'drill') right.drillThroughWalls = true;
      if (change === 'snapshot-id') right.expectedSnapshot!.snapshotId = id(98);
      if (change === 'snapshot-hash') right.expectedSnapshot!.contentSha256 = 'e'.repeat(64);
      if (change === 'revision') { right.expectedRegistryRevision = '6'; right.expectedSnapshot!.registryRevision = '6'; }
      if (change === 'frame') { right.scope.captureFrameId = id(96); right.expectedSnapshot!.scope.captureFrameId = id(96); }
      if (change === 'model') { right.scope.modelVersionId = id(95); right.expectedSnapshot!.scope.modelVersionId = id(95); }
      if (change === 'project') { right.scope.projectId = id(94); right.expectedSnapshot!.scope.projectId = id(94); }
      if (change === 'mode') right.expectedSnapshot!.mode = 'explicit-empty';
      expect(barrierAdmissionIntentSchema.safeParse(right).success).toBe(true); expect(sameBarrierAdmissionIntent(left, right)).toBe(false);
    });
  it('never treats identical malformed or unknown-version payloads as compatible legacy requests', () => {
    const invalid = { ...intent(), schemaVersion: 'wfc.pf.barrier-admission-intent.v999' };
    expect(sameBarrierAdmissionIntent(invalid, invalid)).toBe(false);
    expect(sameBarrierAdmissionIntent({ ...intent(), forged: true }, { ...intent(), forged: true })).toBe(false);
  });
});
