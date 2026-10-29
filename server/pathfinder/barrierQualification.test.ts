// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { barrierCanonicalJson, barrierCaptureSchema } from '../../shared/pathfinderBarriers.js';
import { MIXED_BARRIER_COLLISION_VERSION, MIXED_BARRIER_POLICY, MIXED_BARRIER_VERIFIER_VERSION,
  mixedBarrierSnapshotSchema, mixedBarrierSnapshotHashInput } from '../../shared/pathfinderBarrierMixed.js';
import { barrierBytesHash, encodeBarrierJson } from './barrierStorage.js';
import { deriveMixedBarrierQualification } from './barrierQualification.js';
const id = (n: number) => `ba710000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = (value: unknown) => barrierBytesHash(Buffer.from(barrierCanonicalJson(value)));
function fixture(unusedMagnitude = 10) {
  const scope = { projectId: id(1), modelVersionId: id(2), contentFingerprint: 'a'.repeat(64), selectionRevision: '1', captureFrameId: id(3), captureFrameSha256: 'b'.repeat(64), coordinateFrame: 'canonical-world-metres' };
  const parent = { selectionId: id(4), kind: 'floor', objectId: 'dbid:7', dbId: 7, externalId: null, name: 'Original selected floor', identityBasis: 'version-local-only', inclusion: 'own-and-all-descendant-fragments' };
  const source = { fragmentId: 9, ownerObjectId: 'dbid:7', parentSelectionIds: [id(4)], sourceUnits: 'm', metresPerSourceUnit: 1,
    sourceToWorldMetres: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], transformSha256: 'c'.repeat(64) };
  const capture = barrierCaptureSchema.parse({ schemaVersion: 'wfc.pf.barrier-capture.v1', captureId: id(5), scope, selectedParents: [parent],
    fragments: [{ source, bounds: { minimum: [0, 0, 0], maximum: [unusedMagnitude, 1, 0] }, verticesMetres: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [unusedMagnitude, 0, 0]], triangleIndices: [0, 1, 2] }],
    observation: { state: 'reported-complete', verification: 'unverified', enumeratedFragmentIds: [9], unavailableFragmentIds: [], enumerationSha256: 'd'.repeat(64) } });
  const fragment = capture.fragments[0], mesh = encodeBarrierJson({ verticesMetres: fragment.verticesMetres, triangleIndices: fragment.triangleIndices });
  const manifest = mixedBarrierSnapshotSchema.parse({ schemaVersion: 'wfc.pf.barrier-snapshot.v2', geometryPolicy: MIXED_BARRIER_POLICY,
    snapshotId: id(6), scope, registryRevision: '2', contentSha256: '0'.repeat(64), selectedParents: [parent], capture: { captureId: id(5), payloadSha256: hash(capture) },
    geometry: { mode: 'mixed-mesh-set', fragments: [{ source, bounds: fragment.bounds, vertices: 4, triangles: 1,
      mesh: { blobId: id(7), sha256: barrierBytesHash(mesh), bytes: mesh.length } }], verification: { producerVersion: MIXED_BARRIER_VERIFIER_VERSION,
      geometryPolicy: MIXED_BARRIER_POLICY, selectionClosure: 'complete-selected-scope', verifiedCaptureSha256: hash(capture), originalGeometrySha256: 'e'.repeat(64),
      verificationSha256: 'f'.repeat(64), componentMemberships: [{ componentId: 'component:000000', kind: 'original-surface', fragmentIds: [9], parentSelectionIds: [id(4)], triangleCount: 1, sourceMembershipSha256: '1'.repeat(64) }],
      engineeringAccepted: false, ownTerminalExemptionsSupported: false, authority: 'none' } }, coverage: 'registered-selected-objects-only', engineeringAccepted: false,
    ownTerminalExemptionsSupported: false, authority: 'none' });
  manifest.contentSha256 = hash(mixedBarrierSnapshotHashInput(manifest)); return { manifest, capture };
}
describe('independent protected-original mixed qualification expectation', () => {
  it('derives exact full counts, original memberships and the independent pure hash domain', () => {
    const { manifest, capture } = fixture(), before = structuredClone({ manifest, capture });
    const value = deriveMixedBarrierQualification(manifest, capture, false);
    if (manifest.geometry.mode !== 'mixed-mesh-set' || !value) throw Error('fixture');
    const expected = barrierBytesHash(Buffer.from(MIXED_BARRIER_VERIFIER_VERSION + '\n' + MIXED_BARRIER_POLICY + '\n' + MIXED_BARRIER_COLLISION_VERSION
      + '\n' + manifest.capture!.payloadSha256 + '\n' + manifest.geometry.verification.originalGeometrySha256 + '\n' + 0x3e7ad7f29abcaf48n.toString()));
    expect(value.verificationSha256).toBe(expected); expect(value.verificationSha256).not.toBe(manifest.geometry.verification.verificationSha256);
    expect(value).toMatchObject({ vertexCount: 4, triangleCount: 1, fragmentCount: 1, originalSurfaceComponents: 1, qualifiedClosedSolidComponents: 0,
      numericToleranceMetres: 1e-7, sdkCoverageVerified: false, sdkSourceBytesVerified: false, currentFrameVerified: false, ownTerminalExemptionsSupported: false, engineeringAccepted: false, authority: 'none' });
    expect(value.componentMemberships).toEqual(manifest.geometry.verification.componentMemberships); expect({ manifest, capture }).toEqual(before);
    value.componentMemberships[0].fragmentIds[0] = 100; expect(manifest.geometry.verification.componentMemberships[0].fragmentIds).toEqual([9]);
  });
  it('uses every original coordinate including unused vertices for the effective tolerance', () => {
    const { manifest, capture } = fixture(1e8), value = deriveMixedBarrierQualification(manifest, capture, false);
    expect(value?.numericToleranceMetres).toBe(64 * Number.EPSILON * 1e8);
    expect(value?.numericToleranceMetres).toBeGreaterThan(1e-7);
  });
  it.each(['missing', 'scope', 'parent', 'capture-id', 'coordinate', 'triangle', 'source', 'manifest-hash'] as const)('refuses an unmatched original %s join', field => {
    const { manifest, capture } = fixture();
    if (field === 'scope') capture.scope.captureFrameId = id(90);
    if (field === 'parent') capture.selectedParents[0].name = 'Changed selection';
    if (field === 'capture-id') capture.captureId = id(90);
    if (field === 'coordinate') capture.fragments[0].verticesMetres[1][0] = .5;
    if (field === 'triangle') capture.fragments[0].triangleIndices = [0, 2, 1];
    if (field === 'source') capture.fragments[0].source.ownerObjectId = 'dbid:8';
    if (field === 'manifest-hash') manifest.contentSha256 = 'a'.repeat(64);
    expect(() => deriveMixedBarrierQualification(manifest, field === 'missing' ? null : capture, false)).toThrow();
  });
  it('retains null for explicit bypass/empty without claiming new geometric qualification', () => {
    const { manifest } = fixture(); expect(deriveMixedBarrierQualification(manifest, null, true)).toBeNull();
    const empty = mixedBarrierSnapshotSchema.parse({ ...manifest, selectedParents: [], capture: null,
      geometry: { mode: 'explicit-empty', declarationId: id(8), declaration: 'administrator-declared-no-selected-barriers', reason: 'Explicit empty selected scope' } });
    empty.contentSha256 = hash(mixedBarrierSnapshotHashInput(empty)); expect(deriveMixedBarrierQualification(empty, null, false)).toBeNull();
    expect(() => deriveMixedBarrierQualification(manifest, null, undefined as unknown as boolean)).toThrow();
  });
});
