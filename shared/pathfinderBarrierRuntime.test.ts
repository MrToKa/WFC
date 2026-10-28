import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BARRIER_LIMITS, barrierCanonicalJson } from './pathfinderBarriers.js';
import {
  BARRIER_RUNTIME_PROFILE, barrierExecutionSchema, barrierRouteHashInput, barrierRuntimeContextSchema, barrierRuntimeProfileSchema,
  createBarrierRuntimePolicy, verifyBarrierExecutionRoute, verifyBarrierRuntimeContext, type BarrierExecution, type BarrierRuntimeContext,
} from './pathfinderBarrierRuntime.js';
import { DIRECT_SECONDARY_POLICY } from './pathfinderDirectSecondary.js';

const id = (n: number) => `b6000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function context(mode: 'mesh-set' | 'explicit-empty' | null = 'mesh-set', drill = false): BarrierRuntimeContext {
  const scope = { projectId: id(1), modelVersionId: id(2), contentFingerprint: 'a'.repeat(64), selectionRevision: '3',
    captureFrameId: id(4), captureFrameSha256: 'b'.repeat(64), coordinateFrame: 'canonical-world-metres' as const };
  const policy = createBarrierRuntimePolicy(drill);
  return { schemaVersion: 'wfc.pf.barrier-runtime.v1', binding: { scope, registryRevision: '5',
    snapshot: mode === null ? null : { snapshotId: id(6), scope: structuredClone(scope), registryRevision: '5', contentSha256: 'c'.repeat(64), mode },
    policy, policySha256: hash(barrierCanonicalJson(policy)) }, profile: structuredClone(BARRIER_RUNTIME_PROFILE),
    profileSha256: hash(barrierCanonicalJson(BARRIER_RUNTIME_PROFILE)), storage: mode === null ? null : {
      intentId: id(7), manifest: { blobId: id(8), sha256: 'd'.repeat(64), bytes: 1000 },
      capture: mode === 'mesh-set' ? { blobId: id(9), sha256: 'e'.repeat(64), bytes: 2000 } : null } };
}
type MutableObject = Record<string, unknown>;
function changedAt<T>(value: T, path: string[], change: unknown): T {
  const copy = structuredClone(value);
  let cursor = copy as MutableObject;
  for (const key of path.slice(0, -1)) cursor = cursor[key] as MutableObject;
  cursor[path.at(-1)!] = change;
  return copy;
}
function leaves(value: object, prefix: string[] = []): Array<{ path: string[]; value: string | number | boolean }> {
  return Object.entries(value).flatMap(([key, entry]) => entry !== null && typeof entry === 'object'
    ? leaves(entry as object, [...prefix, key]) : [{ path: [...prefix, key], value: entry as string | number | boolean }]);
}
function reordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reordered);
  return value !== null && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).reverse().map(([key, entry]) => [key, reordered(entry)])) : value;
}

describe('frozen server-owned barrier computation profile', () => {
  it('freezes every profile record and records the actual bounded B1/B3/B4 policies', () => {
    expect(barrierRuntimeProfileSchema.parse(BARRIER_RUNTIME_PROFILE)).toEqual(BARRIER_RUNTIME_PROFILE);
    expect(Object.isFrozen(BARRIER_RUNTIME_PROFILE)).toBe(true);
    for (const record of Object.values(BARRIER_RUNTIME_PROFILE)) if (typeof record === 'object') expect(Object.isFrozen(record)).toBe(true);
    expect(BARRIER_RUNTIME_PROFILE.qualification.numericToleranceMetres).toBe(1e-7);
    expect(BARRIER_RUNTIME_PROFILE.localConnectors).toMatchObject({ stepMeters: 0.25, paddingMeters: 1, maxAxisSpanMeters: 20,
      maxNodes: 4096, maxEdgeChecks: 16384, maxPlans: 8, maxStraightPairs: 8 });
    expect(BARRIER_RUNTIME_PROFILE.routing).toMatchObject({ maxCandidatesPerEnd: 16, maxPairs: 64, maxWork: 20000000, timeoutMilliseconds: 30000 });
  });
  it.each(leaves(BARRIER_RUNTIME_PROFILE))('rejects a changed profile field $path even with a freshly recomputed hash', ({ path, value }) => {
    const altered = changedAt(context(), ['profile', ...path], typeof value === 'number' ? value + 1 : `${value}.changed`);
    altered.profileSha256 = hash(barrierCanonicalJson(altered.profile));
    expect(barrierRuntimeProfileSchema.safeParse(altered.profile).success).toBe(false);
    expect(verifyBarrierRuntimeContext(altered, hash)).toBe(false);
  });
  it.each([[], ['qualification'], ['kernel'], ['routing'], ['localConnectors']].map(path => ({ path })))('rejects unknown authority at profile path $path', ({ path }) => {
    const altered = changedAt(BARRIER_RUNTIME_PROFILE, [...path, 'unreviewedOverride'], true);
    expect(barrierRuntimeProfileSchema.safeParse(altered).success).toBe(false);
  });
  it('refuses a profile hash tamper despite valid literal profile contents', () => {
    const value = context(); value.profileSha256 = '0'.repeat(64);
    expect(barrierRuntimeContextSchema.safeParse(value).success).toBe(true);
    expect(verifyBarrierRuntimeContext(value, hash)).toBe(false);
  });
});

describe('strict frozen runtime context and original-capture pairing', () => {
  it.each(['mesh-set', 'explicit-empty'] as const)('accepts the exact published %s and independently hashed policy/profile', mode => {
    const value = context(mode); expect(barrierRuntimeContextSchema.parse(value)).toEqual(value);
    expect(verifyBarrierRuntimeContext(value, hash)).toBe(true);
  });
  it('permits an unpublished scope only with an explicit drilling choice and no invented storage', () => {
    expect(verifyBarrierRuntimeContext(context(null, true), hash)).toBe(true);
    expect(barrierRuntimeContextSchema.safeParse(context(null, false)).success).toBe(false);
    const invented = context(null, true); invented.storage = context().storage;
    expect(barrierRuntimeContextSchema.safeParse(invented).success).toBe(false);
  });
  it.each(['mesh-set', 'explicit-empty'] as const)('keeps the published %s reference even for explicit drilling', mode => {
    const value = context(mode, true); expect(verifyBarrierRuntimeContext(value, hash)).toBe(true);
    expect(value.binding.snapshot?.mode).toBe(mode); expect(value.storage).not.toBeNull();
  });
  it('requires original capture storage for mesh sets and forbids it for explicit-empty declarations', () => {
    const missing = context(); missing.storage!.capture = null;
    expect(barrierRuntimeContextSchema.safeParse(missing).success).toBe(false);
    const invented = context('explicit-empty'); invented.storage!.capture = context().storage!.capture;
    expect(barrierRuntimeContextSchema.safeParse(invented).success).toBe(false);
    expect(barrierRuntimeContextSchema.safeParse({ ...context(), storage: null }).success).toBe(false);
  });
  it.each(['projectId', 'modelVersionId', 'captureFrameId'] as const)('rejects a foreign snapshot %s', key => {
    const value = context(); value.binding.snapshot!.scope[key] = id(99);
    expect(barrierRuntimeContextSchema.safeParse(value).success).toBe(false);
  });
  it.each(['contentFingerprint', 'captureFrameSha256', 'selectionRevision', 'registryRevision'] as const)('rejects changed snapshot %s evidence', key => {
    const value = context();
    if (key === 'registryRevision') value.binding.snapshot!.registryRevision = '6';
    else value.binding.snapshot!.scope[key] = key === 'selectionRevision' ? '4' : 'f'.repeat(64);
    expect(barrierRuntimeContextSchema.safeParse(value).success).toBe(false);
  });
  it.each([[], ['binding'], ['binding', 'scope'], ['binding', 'snapshot'], ['storage'], ['storage', 'manifest'], ['storage', 'capture']].map(path => ({ path })))
    ('rejects unexpected runtime authority at path $path', ({ path }) => {
      expect(barrierRuntimeContextSchema.safeParse(changedAt(context(), [...path, 'filesystemPath'], 'C:/foreign.json')).success).toBe(false);
    });
  it.each(['intentId', 'manifest', 'capture'] as const)('refuses a missing required storage field %s', key => {
    const value = context() as unknown as { storage: MutableObject }; delete value.storage[key];
    expect(barrierRuntimeContextSchema.safeParse(value).success).toBe(false);
  });
  it.each(['manifest', 'capture'] as const)('bounds immutable %s references without accepting paths or coerced sizes', key => {
    const value = context(); const existing = value.storage![key]!;
    for (const bytes of [0, -1, 1.5, '2000', Infinity, NaN, BARRIER_LIMITS.captureBytes + 1]) {
      expect(barrierRuntimeContextSchema.safeParse({ ...value, storage: { ...value.storage, [key]: { ...existing, bytes } } }).success).toBe(false);
    }
    for (const blobId of ['../foreign', 'https://example.invalid/mesh', 'not-a-uuid']) {
      expect(barrierRuntimeContextSchema.safeParse({ ...value, storage: { ...value.storage, [key]: { ...existing, blobId } } }).success).toBe(false);
    }
    for (const sha256 of ['A'.repeat(64), '0'.repeat(63), 'g'.repeat(64), `${'a'.repeat(64)}\n`]) {
      expect(barrierRuntimeContextSchema.safeParse({ ...value, storage: { ...value.storage, [key]: { ...existing, sha256 } } }).success).toBe(false);
    }
  });
  it('enforces the smaller manifest ceiling separately from the original capture ceiling', () => {
    const value = context(); value.storage!.manifest.bytes = 256 * 1024;
    value.storage!.capture!.bytes = BARRIER_LIMITS.captureBytes;
    expect(barrierRuntimeContextSchema.safeParse(value).success).toBe(true);
    value.storage!.manifest.bytes++;
    expect(barrierRuntimeContextSchema.safeParse(value).success).toBe(false);
  });
  it('retains historical runtime parent and component limits despite the larger mixed selection lane', () => {
    const value = execution(), base = value.qualification!.computationalMemberships[0];
    value.qualification!.computationalMemberships = Array.from({ length: 257 }, (_, at) => ({ ...base, computationalMeshId: `mesh-${at}` }));
    expect(barrierExecutionSchema.safeParse(value).success).toBe(false);
    value.qualification!.computationalMemberships = [{ ...base, parentSelectionIds: Array.from({ length: 129 }, (_, at) => id(1000 + at)) }];
    expect(barrierExecutionSchema.safeParse(value).success).toBe(false);
  });
  it('hash verification is independent of object insertion order and leaves input objects untouched', () => {
    const value = context(), before = structuredClone(value);
    expect(verifyBarrierRuntimeContext(reordered(value), hash)).toBe(true); expect(value).toEqual(before);
  });
  it.each([null, undefined, {}, { schemaVersion: 'wfc.pf.barrier-runtime.v999' }])('rejects missing or unknown context %# without legacy downgrade', value => {
    expect(verifyBarrierRuntimeContext(value, hash)).toBe(false);
  });
});

describe('explicit server collision policy and hash integrity', () => {
  it.each([false, true])('requires and preserves an explicit drilling value %s', drill => {
    expect(createBarrierRuntimePolicy(drill)).toMatchObject({ drillThroughWalls: drill, numericToleranceMetres: 1e-7,
      physicalClearance: { mode: 'centreline-only', radiusMetres: 0, diameterSource: 'not-qualified' } });
  });
  it.each([undefined, null, 0, 1, 'true', 'false', {}, []].map(drill => ({ drill })))('never defaults or coerces an implicit drilling value %#', ({ drill }) => {
    expect(() => createBarrierRuntimePolicy(drill as boolean)).toThrow();
    const value = context() as unknown as { binding: { policy: MutableObject } }; value.binding.policy.drillThroughWalls = drill;
    expect(barrierRuntimeContextSchema.safeParse(value).success).toBe(false);
  });
  it('returns independently owned policy records for separate calculations', () => {
    const first = createBarrierRuntimePolicy(false), second = createBarrierRuntimePolicy(false);
    first.drillThroughWalls = true; (first.physicalClearance as unknown as MutableObject).radiusMetres = 7;
    expect(second.drillThroughWalls).toBe(false); expect(second.physicalClearance.radiusMetres).toBe(0);
  });
  it('refuses a missing drilling field and never acquires a wire default', () => {
    const value = context() as unknown as { binding: { policy: MutableObject } }; delete value.binding.policy.drillThroughWalls;
    expect(barrierRuntimeContextSchema.safeParse(value).success).toBe(false);
  });
  it.each(leaves(createBarrierRuntimePolicy(false)))('binds every policy field $path to either literal/profile or its digest', ({ path, value }) => {
    const changed = typeof value === 'boolean' ? !value : typeof value === 'number' ? value + 0.000001 : `${value}.changed`;
    expect(verifyBarrierRuntimeContext(changedAt(context(), ['binding', 'policy', ...path], changed), hash)).toBe(false);
  });
  it('refuses tolerance changes even when their new policy digest is recomputed', () => {
    const value = context(); value.binding.policy.numericToleranceMetres = 1e-6;
    value.binding.policySha256 = hash(barrierCanonicalJson(value.binding.policy));
    expect(barrierRuntimeContextSchema.safeParse(value).success).toBe(false);
  });
  it('accepts explicit drilling only after its exact policy digest changes', () => {
    const value = context(); value.binding.policy.drillThroughWalls = true;
    expect(verifyBarrierRuntimeContext(value, hash)).toBe(false);
    value.binding.policySha256 = hash(barrierCanonicalJson(value.binding.policy));
    expect(verifyBarrierRuntimeContext(value, hash)).toBe(true);
  });
  it('refuses a policy digest tamper despite otherwise valid schema', () => {
    const value = context(); value.binding.policySha256 = '0'.repeat(64);
    expect(barrierRuntimeContextSchema.safeParse(value).success).toBe(true); expect(verifyBarrierRuntimeContext(value, hash)).toBe(false);
  });
});

describe('exact binary64 little-endian final-route hash input', () => {
  it('normalizes signed zero for durable JSON while retaining known fractional IEEE754 bits', () => {
    expect(barrierRouteHashInput([[0, -0, 1], [-2, 0.1, 5e-324]])).toEqual({ schemaVersion: 'wfc.pf.route-binary64-le.v1', pointBits: [
      ['0000000000000000', '0000000000000000', '000000000000f03f'],
      ['00000000000000c0', '9a9999999999b93f', '0100000000000000'],
    ] });
    expect(hash(barrierCanonicalJson(barrierRouteHashInput([[0, 0, 0]]))))
      .toBe(hash(barrierCanonicalJson(barrierRouteHashInput([[-0, 0, 0]]))));
  });
  it('preserves point and axis order, singleton occupancy and repeated points exactly', () => {
    const points = [[1, 2, 3], [4, 5, 6]];
    const exact = hash(barrierCanonicalJson(barrierRouteHashInput(points)));
    expect(hash(barrierCanonicalJson(barrierRouteHashInput([...points].reverse())))).not.toBe(exact);
    expect(hash(barrierCanonicalJson(barrierRouteHashInput(points.map(point => [...point].reverse()))))).not.toBe(exact);
    expect(barrierRouteHashInput([points[0]]).pointBits).toHaveLength(1);
    expect(barrierRouteHashInput([points[0], points[0]]).pointBits).toHaveLength(2);
  });
  it('distinguishes adjacent representable finite coordinates and does not round route input', () => {
    const points = [[1, 1 + Number.EPSILON, 1e-300], [1e9, -1e9, -0]], before = structuredClone(points);
    const value = barrierRouteHashInput(points);
    expect(value.pointBits[0][0]).toBe('000000000000f03f'); expect(value.pointBits[0][1]).toBe('010000000000f03f');
    expect(value.pointBits[0][0]).not.toBe(value.pointBits[0][1]); expect(points).toEqual(before);
    expect(Object.is(points[1][2], -0)).toBe(true);
  });
  it.each([[], null, undefined, {}, [[0, 0]], [[0, 0, 0, 0]], [[0, 0, NaN]], [[0, Infinity, 0]], [[-Infinity, 0, 0]],
    [[1e9 + 1, 0, 0]], [[0, -1e9 - 1, 0]], [['1', 0, 0]], [new Float64Array([0, 0, 0])]].map(points => ({ points })))
    ('rejects malformed, nonfinite or outside-domain route %#', ({ points }) => {
      expect(() => barrierRouteHashInput(points as readonly (readonly number[])[])).toThrow();
    });
  it('rejects over-limit point counts before trying to serialize any route entries', () => {
    expect(() => barrierRouteHashInput(new Array(BARRIER_LIMITS.routeSegments + 2))).toThrow();
  });
  it('rejects sparse outer routes and sparse coordinate tuples instead of silently hashing skipped points', () => {
    const sparseOuter = Object.assign(new Array(3), { 0: [0, 0, 0], 2: [1, 1, 1] });
    const sparsePoint = Object.assign(new Array(3), { 0: 0, 2: 0 });
    for (const points of [new Array(1), sparseOuter, [new Array(3)], [sparsePoint]]) {
      expect(() => barrierRouteHashInput(points as readonly (readonly number[])[])).toThrow();
    }
  });
});

const routePoints = [[0, 0, 0], [1, 0, 0]];
function execution(status: 'clear' | 'blocked' | 'indeterminate' | 'bypassed' | 'no-barriers-declared' = 'clear',
  points = routePoints): BarrierExecution {
  const admitted = context(status === 'no-barriers-declared' ? 'explicit-empty' : 'mesh-set', status === 'bypassed');
  const membership = { computationalMeshId: 'shell:000001', parentSelectionIds: [id(20)], fragmentIds: [11] };
  const bypassed = status === 'bypassed' || status === 'no-barriers-declared';
  const proofStatus = status === 'clear' ? 'clear-selected-scope' : status;
  const reasonCode = { clear: 'REGISTERED_SCOPE_CLEAR', blocked: 'REGISTERED_BARRIER_INTERSECTION',
    indeterminate: 'BARRIER_QUERY_INDETERMINATE', bypassed: 'EXPLICIT_DRILLING_BYPASS', 'no-barriers-declared': 'EXPLICIT_EMPTY_SCOPE' }[status];
  return { schemaVersion: 'wfc.pf.barrier-execution.v1', context: admitted, proof: {
    schemaVersion: 'wfc.pf.barrier-check-proof.v2', binding: structuredClone(admitted.binding),
    routeSha256: hash(barrierCanonicalJson(barrierRouteHashInput(points))), status: proofStatus, routePointCount: points.length,
    totalSegments: Math.max(1, points.length - 1), checkedSegments: bypassed || status === 'indeterminate' ? 0 : status === 'blocked' ? 1 : Math.max(1, points.length - 1),
    blocking: status === 'blocked' ? { ...membership, segmentIndex: 0, reason: 'surface-or-containment', surfaceWitness: null } : null,
    failedSegmentIndex: status === 'indeterminate' ? 0 : null, reasonCode, coverage: 'registered-selected-objects-only', engineeringAccepted: false,
  }, directSecondary: null, diagnostics: { status, reasonCode, searchComplete: status !== 'indeterminate', candidatesTruncated: false,
    pairAttempts: 1, collisionQueries: bypassed ? 0 : 4, work: '120', plannerAttempts: 0, straightPairAttempts: 1,
    localEdgeChecks: 0, localPhaseUsed: false, straightPhaseTruncated: false }, connectors: { from: null, to: null },
  qualification: bypassed ? null : { captureSha256: admitted.storage!.capture!.sha256, pureVerificationSha256: 'f'.repeat(64),
    decompositionSha256: '1'.repeat(64), computationalMemberships: [membership] } };
}
function connector(): NonNullable<BarrierExecution['connectors']['from']> {
  return { policyVersion: BARRIER_RUNTIME_PROFILE.localConnectors.policyVersion, status: 'clear', reasonCode: 'LOCAL_CONNECTOR_CLEAR',
    points: [[0, 0, 0], [0, 0.25, 0], [1, 0.25, 0]], lengthMeters: 1.25, directDistanceMeters: Math.sqrt(1.0625), isDetour: true,
    searchComplete: true, domain: { minimum: [-1, -1, -1], maximum: [2, 2, 1], stepMeters: 0.25 }, edgeChecks: 10, queries: 12, work: '200' };
}

describe('strict computation envelope and exact final-route integrity', () => {
  it.each(['clear', 'blocked', 'indeterminate', 'bypassed', 'no-barriers-declared'] as const)('retains consistent %s evidence without manufacturing engineering acceptance', status => {
    const value = execution(status); expect(barrierExecutionSchema.parse(value)).toEqual(value);
    // Failed facts remain readable; the successful-route guard cannot accept them.
    expect(verifyBarrierExecutionRoute(value, { context: value.context, points: routePoints }, hash))
      .toBe(!['blocked', 'indeterminate'].includes(status));
    expect(value.proof?.engineeringAccepted).toBe(false);
  });
  it('requires singleton occupancy rather than a zero-segment clear certificate', () => {
    const points = [[1, 2, 3]], value = execution('clear', points);
    expect(value.proof).toMatchObject({ routePointCount: 1, totalSegments: 1, checkedSegments: 1 });
    expect(verifyBarrierExecutionRoute(value, { context: value.context, points }, hash)).toBe(true);
    value.proof!.checkedSegments = 0;
    expect(verifyBarrierExecutionRoute(value, { context: value.context, points }, hash)).toBe(false);
  });
  it.each([[[1, 0, 0], [0, 0, 0]], [[5e-324, 0, 0], [1, 0, 0]], [[0, 0, 0], [1 + Number.EPSILON, 0, 0]], [[0, 0, 0]]].map(points => ({ points })))
    ('rejects a reordered, bit-changed or different-count route %#', ({ points }) => {
      const value = execution(); expect(verifyBarrierExecutionRoute(value, { context: value.context, points }, hash)).toBe(false);
    });
  it('rejects a substituted admitted context even when it has independently valid hashes', () => {
    const value = execution(), expected = context(); expected.storage!.manifest.blobId = id(99);
    expect(verifyBarrierRuntimeContext(expected, hash)).toBe(true);
    expect(verifyBarrierExecutionRoute(value, { context: expected, points: routePoints }, hash)).toBe(false);
  });
  it.each(['profileSha256', 'policySha256', 'routeSha256', 'captureSha256'] as const)('refuses tampered %s execution evidence', key => {
    const value = execution();
    if (key === 'profileSha256') value.context.profileSha256 = '0'.repeat(64);
    if (key === 'policySha256') { value.context.binding.policySha256 = '0'.repeat(64); value.proof!.binding.policySha256 = '0'.repeat(64); }
    if (key === 'routeSha256') value.proof!.routeSha256 = '0'.repeat(64);
    if (key === 'captureSha256') value.qualification!.captureSha256 = '0'.repeat(64);
    expect(verifyBarrierExecutionRoute(value, { context: value.context, points: routePoints }, hash)).toBe(false);
  });
  it('refuses a proof attached to a different registry/frame than the admitted context', () => {
    const value = execution(); value.proof!.binding.scope.captureFrameSha256 = '0'.repeat(64);
    value.proof!.binding.snapshot!.scope.captureFrameSha256 = '0'.repeat(64);
    expect(barrierExecutionSchema.safeParse(value).success).toBe(false);
  });
  it.each(['clear', 'blocked', 'indeterminate'] as const)('requires actual qualified capture memberships for physical %s evidence', status => {
    const value = execution(status); value.qualification = null;
    expect(barrierExecutionSchema.safeParse(value).success).toBe(false);
  });
  it('retains complete computational memberships for a blocking shell and refuses unsupported witnesses or subsets', () => {
    const value = execution('blocked');
    value.proof!.blocking!.fragmentIds = [12];
    expect(barrierExecutionSchema.safeParse(value).success).toBe(true);
    expect(verifyBarrierExecutionRoute(value, { context: value.context, points: routePoints }, hash)).toBe(false);
    const invented = execution('blocked') as unknown as { proof: { blocking: MutableObject } };
    invented.proof.blocking.surfaceWitness = { pointMetres: [0, 0, 0], fragmentId: 11 };
    expect(barrierExecutionSchema.safeParse(invented).success).toBe(false);
  });
  it('requires a unique nonempty qualified shell inventory', () => {
    const value = execution(), first = value.qualification!.computationalMemberships[0];
    value.qualification!.computationalMemberships = [];
    expect(barrierExecutionSchema.safeParse(value).success).toBe(false);
    value.qualification!.computationalMemberships = [first, first];
    expect(barrierExecutionSchema.safeParse(value).success).toBe(false);
  });
  it.each(['clear', 'bypassed', 'no-barriers-declared'] as const)('refuses a successful %s diagnostic with missing/mismatched proof or excessive completed work', status => {
    const missing = execution(status); missing.proof = null; expect(barrierExecutionSchema.safeParse(missing).success).toBe(false);
    const exceeded = execution(status); exceeded.diagnostics.work = String(BARRIER_RUNTIME_PROFILE.routing.maxWork + 1); expect(barrierExecutionSchema.safeParse(exceeded).success).toBe(false);
    const mismatch = execution(status); mismatch.proof = execution(status === 'clear' ? 'bypassed' : 'clear').proof;
    expect(barrierExecutionSchema.safeParse(mismatch).success).toBe(false);
  });
  it.each(['clear', 'blocked', 'indeterminate', 'bypassed', 'no-barriers-declared'] as const)('refuses diagnostic/proof disagreement for %s evidence', status => {
    const value = execution(status); value.diagnostics.status = status === 'clear' ? 'blocked' : 'clear';
    expect(barrierExecutionSchema.safeParse(value).success).toBe(false);
    expect(verifyBarrierExecutionRoute(value, { context: value.context, points: routePoints }, hash)).toBe(false);
  });
  it('accepts a fully checked final route even when the bounded alternative search was truncated', () => {
    const value = execution(); value.diagnostics.searchComplete = false; value.diagnostics.candidatesTruncated = true;
    expect(barrierExecutionSchema.safeParse(value).success).toBe(true);
    expect(verifyBarrierExecutionRoute(value, { context: value.context, points: routePoints }, hash)).toBe(true);
  });
  it('retains bounded search-incomplete/unavailable diagnostics without inventing a final route proof', () => {
    for (const status of ['search-incomplete', 'unavailable'] as const) {
      const value = execution(); value.proof = null; value.qualification = null;
      value.diagnostics.status = status; value.diagnostics.reasonCode = 'BARRIER_EXECUTION_UNAVAILABLE'; value.diagnostics.searchComplete = false;
      value.diagnostics.work = '9223372036854775807';
      expect(barrierExecutionSchema.safeParse(value).success).toBe(true);
      expect(verifyBarrierExecutionRoute(value, { context: value.context, points: routePoints }, hash)).toBe(false);
    }
  });
  it.each(['01', '-1', '1.5', '1\n', '9223372036854775808', 12, null])('refuses imprecise, wrapped or noncanonical work %#', work => {
    const value = changedAt(execution(), ['diagnostics', 'work'], work);
    expect(barrierExecutionSchema.safeParse(value).success).toBe(false);
  });
  it.each([['pairAttempts', 65], ['collisionQueries', 100001], ['plannerAttempts', 9], ['straightPairAttempts', 65], ['localEdgeChecks', 16385]] as const)
    ('refuses an over-limit %s diagnostic', (key, count) => {
      expect(barrierExecutionSchema.safeParse(changedAt(execution(), ['diagnostics', key], count)).success).toBe(false);
    });
  it('retains an exact completed local connector and its domain, instead of treating a partial path as clear', () => {
    const value = execution(); value.connectors.from = connector(); value.diagnostics.localPhaseUsed = true; value.diagnostics.plannerAttempts = 1;
    expect(barrierExecutionSchema.safeParse(value).success).toBe(true);
    for (const alteration of [{ status: 'blocked' }, { status: 'indeterminate' }, { status: 'search-incomplete' }, { points: [] }, { searchComplete: false }]) {
      expect(barrierExecutionSchema.safeParse({ ...value, connectors: { ...value.connectors, from: { ...connector(), ...alteration } } }).success).toBe(false);
    }
    const coarsened = connector(); coarsened.domain.stepMeters = 0.5 as 0.25;
    expect(barrierExecutionSchema.safeParse({ ...value, connectors: { ...value.connectors, from: coarsened } }).success).toBe(false);
    const reversed = connector(); reversed.domain.minimum = [3, 3, 3];
    expect(barrierExecutionSchema.safeParse({ ...value, connectors: { ...value.connectors, from: reversed } }).success).toBe(false);
  });
  it('retains the exact constrained direct-secondary decision binding separately from the final route proof', () => {
    const value = execution();
    value.directSecondary = { schemaVersion: 'wfc.pf.constrained-direct-secondary.v2', policyVersion: 'nearest-eligible-tray-or-registered-barriers.v2',
      binding: structuredClone(value.context.binding), mode: 'direct-secondary', reasonCode: 'DIRECT_SECONDARY_CLEAR',
      directRouteSha256: value.proof!.routeSha256, directCheck: structuredClone(value.proof!), distanceDecision: {
        schemaVersion: 'wfc.pf.direct-secondary.v1', policyVersion: DIRECT_SECONDARY_POLICY, coordinateFrame: 'canonical-world-metres', mode: 'direct-secondary',
        fromPoint: [0, 0, 0], toPoint: [1, 0, 0], distanceMeters: 1, nearestFromMeters: 2, nearestToMeters: 2, eligibleTrays: 1, comparison: 'both' } };
    expect(barrierExecutionSchema.safeParse(value).success).toBe(true);
    value.directSecondary.binding.registryRevision = '6'; value.directSecondary.binding.snapshot!.registryRevision = '6';
    value.directSecondary.directCheck!.binding = structuredClone(value.directSecondary.binding);
    expect(barrierExecutionSchema.safeParse(value).success).toBe(false);
  });
  it.each([[], ['diagnostics'], ['connectors'], ['qualification']].map(path => ({ path })))('refuses unexpected execution authority at path $path', ({ path }) => {
    expect(barrierExecutionSchema.safeParse(changedAt(execution(), [...path, 'engineeringApproval'], true)).success).toBe(false);
  });
  it('returns false for malformed expected route input rather than throwing or inferring a legacy route', () => {
    const value = execution();
    expect(verifyBarrierExecutionRoute(value, { context: value.context, points: new Array(1) }, hash)).toBe(false);
    expect(verifyBarrierExecutionRoute(value, { context: value.context, points: [[NaN, 0, 0]] }, hash)).toBe(false);
  });
});
