// Run as the application user inside api-runtime. Synthetic geometry only;
// exercise the real configured, bounded verifier without a database or project writes.
import assert from 'node:assert/strict';
import { runBarrierVerifier, runMixedBarrierVerifier } from '../server/dist/server/pathfinder/barrierVerifier.js';

const id = value => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const selected = id(201), transform = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const capture = {
  schemaVersion: 'wfc.pf.barrier-capture.v1', captureId: id(101),
  scope: { projectId: id(102), modelVersionId: id(103), contentFingerprint: '1'.repeat(64), selectionRevision: '1',
    captureFrameId: id(104), captureFrameSha256: '3'.repeat(64), coordinateFrame: 'canonical-world-metres' },
  selectedParents: [{ selectionId: selected, kind: 'floor', objectId: 'dbid:10', dbId: 10, externalId: null,
    name: 'Synthetic floor', identityBasis: 'version-local-only', inclusion: 'own-and-all-descendant-fragments' }],
  fragments: [{ source: { fragmentId: 1, ownerObjectId: 'dbid:10', parentSelectionIds: [selected], sourceUnits: 'm',
    metresPerSourceUnit: 1, sourceToWorldMetres: transform, transformSha256: '2'.repeat(64) },
    bounds: { minimum: [0, 0, 0], maximum: [1, 1, 0.2] },
    verticesMetres: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 0.2], [1, 0, 0.2], [1, 1, 0.2], [0, 1, 0.2]],
    triangleIndices: [0, 3, 2, 0, 2, 1, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5] }],
  observation: { state: 'reported-complete', verification: 'unverified', enumeratedFragmentIds: [1],
    unavailableFragmentIds: [], enumerationSha256: '4'.repeat(64) },
};
assert.equal(process.platform, 'linux', 'The production barrier verifier requires its Linux runtime');
assert.ok(process.env.PF_BARRIER_VERIFIER_DLL, 'PF_BARRIER_VERIFIER_DLL must be configured in the API image');
const bytes = Buffer.from(JSON.stringify(capture));
for (const [lane, execute] of [['closed-v1', runBarrierVerifier], ['mixed-v2-2048', runMixedBarrierVerifier]]) {
  const { result, implementationSha256 } = await execute(bytes, new AbortController().signal);
  assert.equal(result.status, 'geometry-qualified', `${lane} must qualify the synthetic closed floor`);
  assert.equal(result.evidence.fragmentCount, 1);
  assert.equal(result.evidence.triangleCount, 12);
  assert.match(implementationSha256, /^[a-f0-9]{64}$/);
}
console.log(JSON.stringify({ barrierVerifier: 'configured', lanes: ['closed-v1', 'mixed-v2-2048'], syntheticFloorQualified: true }));
