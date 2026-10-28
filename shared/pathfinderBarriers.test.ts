import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  BARRIER_CAPTURE_VERSION, BARRIER_COLLISION_VERSION, BARRIER_LIMITS, BARRIER_ROUTING_POLICY, BARRIER_SNAPSHOT_VERSION,
  barrierAdmissionPolicySchema, barrierBoundsSchema, barrierCalculationBindingSchema, barrierCanonicalJson,
  barrierCaptureCommandSchema, barrierCaptureSchema, barrierCapturedFragmentSchema, barrierCheckProofSchema,
  barrierMeshBlobSchema, barrierModelScopeSchema, barrierRegistryCommandSchema, barrierRegistrySchema,
  barrierRoutingPolicySchema, barrierSelectedParentSchema, barrierSnapshotHashInput, barrierSnapshotSchema,
  verifyBarrierCheckProof, verifyBarrierSnapshot,
  type BarrierCalculationBinding, type BarrierCapture, type BarrierCheckProof, type BarrierModelScope,
  type BarrierRoutingPolicy, type BarrierSnapshot,
} from './pathfinderBarriers.js';

const id = (number: number) => `00000000-0000-0000-0000-${number.toString(16).padStart(12, '0')}`;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const h = (number: number) => number.toString(16).padStart(64, '0');
const scope = (): BarrierModelScope => ({ projectId: id(1), modelVersionId: id(2), selectionRevision: '3',
  contentFingerprint: h(4), captureFrameId: id(5), captureFrameSha256: h(6), coordinateFrame: 'canonical-world-metres' });
const parent = (number = 7) => ({ selectionId: id(number), kind: 'wall' as const, objectId: `dbid:${number}`, dbId: number,
  externalId: null, name: 'Selected wall parent', identityBasis: 'version-local-only' as const,
  inclusion: 'own-and-all-descendant-fragments' as const });
const source = (number = 10, parents = [id(7)]) => ({ fragmentId: number, ownerObjectId: 'dbid:8', parentSelectionIds: parents,
  sourceUnits: 'millimetres', metresPerSourceUnit: 0.001,
  sourceToWorldMetres: [0.001, 0, 0, 0, 0, 0.001, 0, 0, 0, 0, 0.001, 0, 0, 0, 0, 1], transformSha256: h(11) });
const fragment = () => ({ source: source(), bounds: { minimum: [0, 0, 0] as [number, number, number], maximum: [1, 1, 1] as [number, number, number] },
  verticesMetres: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]] as [number, number, number][],
  triangleIndices: [0, 2, 1, 0, 1, 3, 1, 2, 3, 2, 0, 3] });
const capture = (): BarrierCapture => ({ schemaVersion: BARRIER_CAPTURE_VERSION, captureId: id(9), scope: scope(),
  selectedParents: [parent()], fragments: [fragment()], observation: { state: 'reported-complete', verification: 'unverified',
    enumeratedFragmentIds: [10], unavailableFragmentIds: [], enumerationSha256: h(12) } });
const policy = (drillThroughWalls = false): BarrierRoutingPolicy => ({ schemaVersion: 'wfc.pf.barrier-routing-policy.v1',
  policyVersion: BARRIER_ROUTING_POLICY, collisionVersion: BARRIER_COLLISION_VERSION, drillThroughWalls, numericToleranceMetres: 1e-6,
  physicalClearance: { mode: 'centreline-only', radiusMetres: 0, diameterSource: 'not-qualified' } });

/** Manifest fixtures exercise producer DTO integrity, not real topology qualification or engineering acceptance. */
const snapshot = (): BarrierSnapshot => {
  const value: BarrierSnapshot = { schemaVersion: BARRIER_SNAPSHOT_VERSION, snapshotId: id(20), scope: scope(), registryRevision: '1',
    contentSha256: h(0), selectedParents: [parent()], capture: { captureId: id(9), payloadSha256: h(13) },
    geometry: { mode: 'mesh-set', fragments: [{ source: source(), bounds: fragment().bounds,
      mesh: { blobId: id(21), sha256: h(22), bytes: 512 }, vertices: 4, triangles: 4 }],
    verification: { producerVersion: 'wfc.pf.barrier-verifier.v1', selectionClosure: 'complete-selected-scope',
      topology: 'qualified-closed-consistent-two-manifold', selfIntersection: 'bounded-verification-passed',
      computationalMeshes: 1, verifiedCaptureSha256: h(13), verificationSha256: h(23) } },
    coverage: 'registered-selected-objects-only', engineeringAccepted: false };
  value.contentSha256 = digest(barrierCanonicalJson(barrierSnapshotHashInput(value))); return value;
};
const binding = (drill = false): BarrierCalculationBinding => {
  const current = snapshot(), selectedPolicy = policy(drill);
  return { scope: current.scope, registryRevision: current.registryRevision,
    snapshot: { snapshotId: current.snapshotId, scope: current.scope, registryRevision: current.registryRevision,
      contentSha256: current.contentSha256, mode: current.geometry.mode }, policy: selectedPolicy,
    policySha256: digest(barrierCanonicalJson(selectedPolicy)) };
};
const proof = (): BarrierCheckProof => ({ schemaVersion: 'wfc.pf.barrier-check-proof.v1', binding: binding(), routeSha256: h(24),
  status: 'clear-selected-scope', routePointCount: 3, totalSegments: 2, checkedSegments: 2, blocking: null, reasonCode: 'REGISTERED_SCOPE_CLEAR',
  coverage: 'registered-selected-objects-only', engineeringAccepted: false });

describe('separate barrier model/parent and capture contracts', () => {
  it('retains a mixed obstacle classification through capture and immutable publication', () => {
    const observed = capture(); observed.selectedParents[0].kind = 'obstacle';
    expect(barrierCaptureSchema.parse(observed).selectedParents[0]).toEqual({ ...parent(), kind: 'obstacle' });
    const published = snapshot(); published.selectedParents[0].kind = 'obstacle';
    published.contentSha256 = digest(barrierCanonicalJson(barrierSnapshotHashInput(published)));
    expect(barrierSnapshotSchema.parse(published).selectedParents[0].kind).toBe('obstacle');
    expect(verifyBarrierSnapshot(published, digest)).toBe(true);
    published.selectedParents[0].kind = 'wall';
    expect(verifyBarrierSnapshot(published, digest)).toBe(false);
  });
  it('preserves existing structural classifications and refuses undeclared obstacle kinds', () => {
    for (const kind of ['wall', 'partition', 'floor', 'ceiling'])
      expect(barrierSelectedParentSchema.parse({ ...parent(), kind }).kind).toBe(kind);
    for (const kind of ['pipe', 'tank', 'mixed', 'Obstacle', '', 'unknown'])
      expect(barrierSelectedParentSchema.safeParse({ ...parent(), kind }).success).toBe(false);
  });
  it('retains the selected parent separately from its descendant fragments and deduplicates overlapping selections', () => {
    const value = capture(); value.selectedParents.push(parent(8)); value.fragments[0].source.parentSelectionIds.push(id(8));
    const parsed = barrierCaptureSchema.parse(value);
    expect(parsed.selectedParents.map(item => item.objectId)).toEqual(['dbid:7', 'dbid:8']);
    expect(parsed.fragments).toHaveLength(1);
    expect(parsed.fragments[0].source.ownerObjectId).toBe('dbid:8');
  });
  it('retains true indexed opening triangles without substituting their enclosing box', () => {
    const value = fragment(); value.bounds = { minimum: [0, 0, 0], maximum: [4, 4, 0] };
    value.verticesMetres = [[0, 0, 0], [4, 0, 0], [4, 4, 0], [0, 4, 0], [1, 1, 0], [3, 1, 0], [3, 3, 0], [1, 3, 0]];
    value.triangleIndices = [0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
    const parsed = barrierCapturedFragmentSchema.parse(value);
    expect(parsed.verticesMetres).toEqual(value.verticesMetres);
    expect(parsed.triangleIndices).toEqual(value.triangleIndices);
    expect(parsed.triangleIndices).toHaveLength(24);
  });
  it('permits a surface capture as unverified input without certifying a closed solid', () => {
    const value = capture(); value.fragments[0].triangleIndices = [0, 1, 2];
    expect(barrierCaptureSchema.parse(value).observation.verification).toBe('unverified');
    expect(barrierCaptureSchema.safeParse({ ...value, topology: 'qualified-closed-solid' }).success).toBe(false);
  });
  it('represents partial nonresident geometry without a ready state', () => {
    const value = capture(); value.observation.state = 'partial'; value.observation.enumeratedFragmentIds.push(11);
    value.observation.unavailableFragmentIds.push(11);
    expect(barrierCaptureSchema.safeParse(value).success).toBe(true);
    expect(barrierCaptureSchema.safeParse({ ...value, observation: { ...value.observation, state: 'reported-complete' } }).success).toBe(false);
  });
  it.each(['actorId', 'serverPath', 'url', 'ready', 'engineeringAccepted'])('refuses untrusted capture authority/path field %s', field => {
    expect(barrierCaptureSchema.safeParse({ ...capture(), [field]: true }).success).toBe(false);
  });
  it.each([
    { objectId: 'dbid:8' }, { inclusion: 'deepest-child-only' }, { identityBasis: 'name-is-stable' },
    { dbId: -1 }, { dbId: 2147483648 }, { name: 'wall\u0000name' }, { name: '\ud800' },
  ])('refuses ambiguous/nonfinite parent identity %j', change => {
    expect(barrierSelectedParentSchema.safeParse({ ...parent(), ...change }).success).toBe(false);
  });
  it.each(['projectId', 'modelVersionId', 'captureFrameId'])('refuses a malformed scope identity %s', key => {
    expect(barrierModelScopeSchema.safeParse({ ...scope(), [key]: '../other-model' }).success).toBe(false);
  });
  it.each([
    { contentFingerprint: 'A'.repeat(64) }, { captureFrameSha256: 'f'.repeat(63) },
    { selectionRevision: '-1' }, { coordinateFrame: 'display-millimetres' },
  ])('refuses unsupported scope values %j', change => {
    expect(barrierModelScopeSchema.safeParse({ ...scope(), ...change }).success).toBe(false);
  });
  it.each([[0, 1], [0, 1, 4], [0, 0, 1], [0, 1, -1], [0, 1, 1.5], [0, 1, Infinity]].map(indices => ({ indices })))('refuses malformed indexed triangle $indices', ({ indices }) => {
    expect(barrierCapturedFragmentSchema.safeParse({ ...fragment(), triangleIndices: indices }).success).toBe(false);
  });
  it.each([NaN, Infinity, -Infinity, BARRIER_LIMITS.coordinateMagnitudeMetres + 1])('refuses unsafe vertex number %s', number => {
    const value = fragment(); value.verticesMetres[0][0] = number;
    expect(barrierCapturedFragmentSchema.safeParse(value).success).toBe(false);
  });
  it('refuses inverted bounds or bounds that exclude a captured vertex', () => {
    expect(barrierBoundsSchema.safeParse({ minimum: [1, 0, 0], maximum: [0, 1, 1] }).success).toBe(false);
    const value = fragment(); value.bounds.maximum = [0.5, 1, 1];
    expect(barrierCapturedFragmentSchema.safeParse(value).success).toBe(false);
  });
  it('refuses singular/nonaffine transforms and an invented unit scale', () => {
    const value = fragment(); value.source.sourceToWorldMetres[0] = 0;
    expect(barrierCapturedFragmentSchema.safeParse(value).success).toBe(false);
    value.source.sourceToWorldMetres[0] = 0.001; value.source.sourceToWorldMetres[3] = 1;
    expect(barrierCapturedFragmentSchema.safeParse(value).success).toBe(false);
    value.source.sourceToWorldMetres[3] = 0; value.source.metresPerSourceUnit = 0;
    expect(barrierCapturedFragmentSchema.safeParse(value).success).toBe(false);
  });
  it('keeps the source-unit string bound after its well-formed-text refinement', () => {
    const value = fragment(); value.source.sourceUnits = 'm'.repeat(65);
    expect(barrierCapturedFragmentSchema.safeParse(value).success).toBe(false);
    value.source.sourceUnits = 'm'.repeat(64);
    expect(barrierCapturedFragmentSchema.safeParse(value).success).toBe(true);
  });
  it('rejects duplicate fragments, missing enumeration and cross-selection membership', () => {
    const duplicated = capture(); duplicated.fragments.push(fragment());
    expect(barrierCaptureSchema.safeParse(duplicated).success).toBe(false);
    const missing = capture(); missing.observation.enumeratedFragmentIds = [];
    expect(barrierCaptureSchema.safeParse(missing).success).toBe(false);
    const cross = capture(); cross.fragments[0].source.parentSelectionIds = [id(99)];
    expect(barrierCaptureSchema.safeParse(cross).success).toBe(false);
  });
  it('does not accept zero geometry as a complete selected scope', () => {
    const value = capture(); value.fragments = []; value.observation.enumeratedFragmentIds = [];
    expect(barrierCaptureSchema.safeParse(value).success).toBe(false);
    value.observation.state = 'partial';
    expect(barrierCaptureSchema.safeParse(value).success).toBe(true);
  });
  it('bounds parent count and aggregate command bytes before any capture', () => {
    const command = { schemaVersion: 'wfc.pf.barrier-capture-command.v1', scope: scope(), expectedRegistryRevision: '0',
      idempotencyKey: id(30), selectedParents: [parent()] };
    expect(barrierCaptureCommandSchema.safeParse(command).success).toBe(true);
    expect(barrierCaptureCommandSchema.safeParse({ ...command, selectedParents: Array.from({ length: 2048 }, (_, number) => parent(number + 1)) }).success).toBe(true);
    expect(barrierCaptureCommandSchema.safeParse({ ...command, selectedParents: Array.from({ length: 2049 }, (_, number) => parent(number + 1)) }).success).toBe(false);
    expect(barrierCaptureCommandSchema.safeParse({ ...command, selectedParents: Array.from({ length: 2048 }, (_, number) => ({ ...parent(number + 1), name: '界'.repeat(2048) })) }).success).toBe(false);
  });
});

describe('published barrier snapshot integrity and explicit readiness', () => {
  it('verifies canonical manifest integrity without declaring actual geometry accepted', () => {
    const value = snapshot(); expect(verifyBarrierSnapshot(value, digest)).toBe(true);
    expect(value.engineeringAccepted).toBe(false);
    expect(barrierSnapshotHashInput(value)).not.toHaveProperty('contentSha256');
    value.selectedParents[0].name = 'Changed selected parent';
    expect(verifyBarrierSnapshot(value, digest)).toBe(false);
  });
  it('records explicit empty scope separately and refuses implicit empty publication', () => {
    const value = snapshot(); value.selectedParents = []; value.capture = null;
    value.geometry = { mode: 'explicit-empty', declarationId: id(31), declaration: 'administrator-declared-no-selected-barriers', reason: 'No barriers selected for this test scope.' };
    expect(barrierSnapshotSchema.safeParse(value).success).toBe(true);
    expect(barrierSnapshotSchema.safeParse({ ...value, geometry: { ...value.geometry, declarationId: undefined } }).success).toBe(false);
    expect(barrierSnapshotSchema.safeParse({ ...value, selectedParents: [parent()] }).success).toBe(false);
  });
  it('requires matching verified capture, complete parent membership and qualified closed topology', () => {
    const value = snapshot(); if (value.geometry.mode !== 'mesh-set') throw new Error('fixture');
    value.geometry.verification.verifiedCaptureSha256 = h(100);
    expect(barrierSnapshotSchema.safeParse(value).success).toBe(false);
    value.geometry.verification.verifiedCaptureSha256 = h(13); value.geometry.fragments[0].source.parentSelectionIds = [id(99)];
    expect(barrierSnapshotSchema.safeParse(value).success).toBe(false);
    value.geometry.fragments[0].source.parentSelectionIds = [id(7)];
    expect(barrierSnapshotSchema.safeParse({ ...value, geometry: { ...value.geometry, verification: { ...value.geometry.verification, topology: 'open-surface' } } }).success).toBe(false);
  });
  it('bounds computational mesh grouping and refuses arbitrary server paths', () => {
    const value = snapshot(); if (value.geometry.mode !== 'mesh-set') throw new Error('fixture');
    value.geometry.verification.computationalMeshes = BARRIER_LIMITS.computationalMeshes + 1;
    expect(barrierSnapshotSchema.safeParse(value).success).toBe(false);
    expect(barrierMeshBlobSchema.safeParse({ blobId: id(32), sha256: h(33), bytes: 100, path: 'C:/private/mesh' }).success).toBe(false);
    expect(barrierMeshBlobSchema.safeParse({ blobId: id(32), sha256: h(33), bytes: BARRIER_LIMITS.meshBlobBytes + 1 }).success).toBe(false);
  });
  it.each(['vertices', 'triangles', 'bytes'] as const)('refuses an aggregate manifest %s budget even when each fragment is individually bounded', field => {
    const value = snapshot(); if (value.geometry.mode !== 'mesh-set') throw new Error('fixture');
    const template = value.geometry.fragments[0];
    value.geometry.fragments = [0, 1, 2].map(number => ({ ...template, source: source(10 + number),
      mesh: { ...template.mesh, blobId: id(40 + number), bytes: field === 'bytes' ? BARRIER_LIMITS.meshBlobBytes : 512 },
      vertices: field === 'vertices' ? 200_000 : 4, triangles: field === 'triangles' ? 100_000 : 4 }));
    expect(barrierSnapshotSchema.safeParse(value).success).toBe(false);
  });
  it('does not silently treat incomplete, unconfigured or stale registries as ready', () => {
    const current = binding(), ready = { schemaVersion: 'wfc.pf.barrier-registry.v1', scope: scope(), registryRevision: '1', state: 'ready',
      selectedParents: [parent()], snapshot: current.snapshot, reasonCodes: [] };
    expect(barrierRegistrySchema.safeParse(ready).success).toBe(true);
    for (const state of ['capturing', 'partial', 'invalid', 'unconfigured']) {
      expect(barrierRegistrySchema.safeParse({ ...ready, state, reasonCodes: ['CAPTURE_REQUIRED'] }).success).toBe(false);
    }
    expect(barrierRegistrySchema.safeParse({ ...ready, state: 'stale', reasonCodes: ['MODEL_CHANGED'] }).success).toBe(true);
    expect(barrierRegistrySchema.safeParse({ ...ready, snapshot: null }).success).toBe(false);
    expect(barrierRegistrySchema.safeParse({ ...ready, snapshot: { ...current.snapshot, registryRevision: '0' } }).success).toBe(false);
  });
  it('rejects a ready or calculation snapshot from another project, model or frame', () => {
    for (const change of [{ projectId: id(100) }, { modelVersionId: id(101) }, { captureFrameId: id(102) },
      { selectionRevision: '4' }, { contentFingerprint: h(103) }, { captureFrameSha256: h(104) }]) {
      const current = binding(); if (!current.snapshot) throw new Error('fixture');
      current.snapshot.scope = { ...scope(), ...change };
      expect(barrierCalculationBindingSchema.safeParse(current).success).toBe(false);
      expect(barrierRegistrySchema.safeParse({ schemaVersion: 'wfc.pf.barrier-registry.v1', scope: scope(), registryRevision: '1', state: 'ready',
        selectedParents: [parent()], snapshot: current.snapshot, reasonCodes: [] }).success).toBe(false);
    }
  });
  it('allows only strict registry commands without request-owned actor authority', () => {
    const base = { schemaVersion: 'wfc.pf.barrier-registry-command.v1', scope: scope(), expectedRegistryRevision: '1', idempotencyKey: id(35) };
    expect(barrierRegistryCommandSchema.safeParse({ ...base, action: 'remove', selectionIds: [id(7)] }).success).toBe(true);
    expect(barrierRegistryCommandSchema.safeParse({ ...base, action: 'declare-empty', reason: 'Explicit test declaration.' }).success).toBe(true);
    expect(barrierRegistryCommandSchema.safeParse({ ...base, action: 'remove', selectionIds: [id(7)], actorId: id(36) }).success).toBe(false);
    expect(barrierRegistryCommandSchema.safeParse({ ...base, action: 'declare-empty', reason: '' }).success).toBe(false);
  });
});

describe('explicit calculation policy and exact route-check provenance', () => {
  it('defaults drilling off only on fresh admission, never in historical immutable policy readers', () => {
    expect(barrierAdmissionPolicySchema.parse({ schemaVersion: 'wfc.pf.barrier-admission-policy.v1' }).drillThroughWalls).toBe(false);
    expect(barrierAdmissionPolicySchema.parse({ schemaVersion: 'wfc.pf.barrier-admission-policy.v1', drillThroughWalls: true }).drillThroughWalls).toBe(true);
    const { drillThroughWalls: _drill, ...historical } = policy();
    expect(barrierRoutingPolicySchema.safeParse(historical).success).toBe(false);
  });
  it('keeps numeric tolerance separate from an unsupported physical cable radius', () => {
    expect(barrierRoutingPolicySchema.safeParse(policy()).success).toBe(true);
    expect(barrierRoutingPolicySchema.safeParse({ ...policy(), physicalClearance: { mode: 'centreline-only', radiusMetres: 0.01, diameterSource: 'not-qualified' } }).success).toBe(false);
    expect(barrierRoutingPolicySchema.safeParse({ ...policy(), numericToleranceMetres: 0 }).success).toBe(false);
    expect(barrierRoutingPolicySchema.safeParse({ ...policy(), numericToleranceMetres: NaN }).success).toBe(false);
  });
  it('binds the full policy, current scope, exact published snapshot and route hash', () => {
    const value = proof(), expected = { binding: value.binding, routeSha256: value.routeSha256 };
    expect(verifyBarrierCheckProof(value, expected, digest)).toBe(true);
    expect(verifyBarrierCheckProof(value, { ...expected, routeSha256: h(99) }, digest)).toBe(false);
    const changed = binding(); if (!changed.snapshot) throw new Error('fixture'); changed.snapshot.contentSha256 = h(99);
    expect(verifyBarrierCheckProof(value, { ...expected, binding: changed }, digest)).toBe(false);
    expect(verifyBarrierCheckProof(value, { ...expected, binding: binding(true) }, digest)).toBe(false);
    const corrupt = binding(); corrupt.policySha256 = h(99);
    expect(verifyBarrierCheckProof({ ...value, binding: corrupt }, { ...expected, binding: corrupt }, digest)).toBe(false);
  });
  it('records explicit bypass without a geometric-clear claim', () => {
    const value: BarrierCheckProof = { ...proof(), binding: binding(true), status: 'bypassed', checkedSegments: 0, reasonCode: 'EXPLICIT_DRILLING_BYPASS' };
    expect(barrierCheckProofSchema.safeParse(value).success).toBe(true);
    expect(barrierCheckProofSchema.safeParse({ ...value, status: 'clear-selected-scope', checkedSegments: 2, reasonCode: 'REGISTERED_SCOPE_CLEAR' }).success).toBe(false);
    expect(barrierCheckProofSchema.safeParse({ ...value, binding: binding(false) }).success).toBe(false);
  });
  it('records a blocking triangle and bounded route segment index', () => {
    const value: BarrierCheckProof = { ...proof(), status: 'blocked', checkedSegments: 1, reasonCode: 'REGISTERED_BARRIER_INTERSECTION',
      blocking: { selectionId: id(7), fragmentId: 10, segmentIndex: 0, pointMetres: [0, 0, 0] } };
    expect(barrierCheckProofSchema.safeParse(value).success).toBe(true);
    expect(barrierCheckProofSchema.safeParse({ ...value, blocking: null }).success).toBe(false);
    expect(barrierCheckProofSchema.safeParse({ ...value, blocking: { ...value.blocking, segmentIndex: 2 } }).success).toBe(false);
  });
  it('distinguishes an explicit empty declaration from unconfigured/no evidence', () => {
    const value = proof(); if (!value.binding.snapshot) throw new Error('fixture');
    value.binding.snapshot.mode = 'explicit-empty'; value.status = 'no-barriers-declared'; value.checkedSegments = 0; value.reasonCode = 'EXPLICIT_EMPTY_SCOPE';
    expect(barrierCheckProofSchema.safeParse(value).success).toBe(true);
    expect(barrierCheckProofSchema.safeParse({ ...value, status: 'clear-selected-scope', checkedSegments: 2, reasonCode: 'REGISTERED_SCOPE_CLEAR' }).success).toBe(false);
    value.binding.snapshot = null;
    expect(barrierCheckProofSchema.safeParse(value).success).toBe(false);
  });
  it('cannot turn unavailable evidence, partial checks or a missing snapshot into a clear result', () => {
    const value = proof(); value.status = 'unavailable'; value.checkedSegments = 0; value.reasonCode = 'BARRIER_SCOPE_UNCONFIGURED'; value.binding.snapshot = null;
    expect(barrierCheckProofSchema.safeParse(value).success).toBe(true);
    expect(barrierCheckProofSchema.safeParse({ ...value, reasonCode: 'REGISTERED_SCOPE_CLEAR' }).success).toBe(false);
    expect(barrierCheckProofSchema.safeParse({ ...value, status: 'clear-selected-scope', checkedSegments: 2, reasonCode: 'REGISTERED_SCOPE_CLEAR' }).success).toBe(false);
    expect(barrierCheckProofSchema.safeParse({ ...proof(), checkedSegments: 1 }).success).toBe(false);
    expect(barrierCheckProofSchema.safeParse({ ...proof(), checkedSegments: 3 }).success).toBe(false);
  });
  it('checks a coincident one-point route as point occupancy without inventing geometric length', () => {
    expect(barrierCheckProofSchema.safeParse({ ...proof(), routePointCount: 1, totalSegments: 1, checkedSegments: 1 }).success).toBe(true);
    expect(barrierCheckProofSchema.safeParse({ ...proof(), routePointCount: 1, totalSegments: 0, checkedSegments: 0 }).success).toBe(false);
    expect(barrierCheckProofSchema.safeParse({ ...proof(), routePointCount: 2, totalSegments: 2 }).success).toBe(false);
  });
  it('refuses a broader coverage, unversioned algorithm or engineering acceptance claim', () => {
    expect(barrierCheckProofSchema.safeParse({ ...proof(), coverage: 'entire-plant' }).success).toBe(false);
    expect(barrierCheckProofSchema.safeParse({ ...proof(), engineeringAccepted: true }).success).toBe(false);
    expect(barrierRoutingPolicySchema.safeParse({ ...policy(), collisionVersion: 'bbox-only' }).success).toBe(false);
  });
});
