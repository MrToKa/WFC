import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCompletedCaptureEvidence,
  bindCompletedCaptureEvidence,
  validateCompletedCaptureEvidence,
  verifyCompletedCaptureEvidence,
  CAPTURE_EVIDENCE_LIMITS,
} from '../capture-evidence.mjs';
const uuid = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const observed = (value, api = 'syntheticSDK') => ({
    status: 'observed',
    value,
    api,
    reason: null,
  }),
  derived = (value) => ({
    status: 'derived',
    value,
    api: 'explicit synthetic composition',
    reason: null,
  }),
  missing = () => ({
    status: 'unavailable',
    value: null,
    api: 'unavailableSDK',
    reason: 'SDK_VALUE_UNAVAILABLE',
  });
async function fixture() {
  return createCompletedCaptureEvidence({
    schemaVersion: 'wfc.pf.completed-capture-evidence.v1',
    binding: {
      projectId: uuid(1),
      modelVersionId: uuid(2),
      contentFingerprint: 'a'.repeat(64),
      selectionRevision: null,
      loadId: uuid(3),
      captureId: uuid(4),
      sessionId: uuid(5),
      partId: uuid(6),
      planSha256: 'b'.repeat(64),
      coordinateFrameId: uuid(7),
      partPayloadSha256: null,
    },
    observations: {
      sdkVersion: '7.130.0',
      matrixPrecision: 'binary64',
      sourceUnitLabel: observed('mm'),
      metresPerDisplayUnit: observed(0.001),
      upVector: observed([0, 0, 1]),
      globalOffsetDisplayUnits: observed([0, 0, 0]),
      globalOffsetMetres: derived([0, 0, 0]),
      displayToWorldMetres: derived(matrix),
      legacySourceToWorldMetres: derived(matrix),
      modelTransform: missing(),
      placementTransform: missing(),
      objectLocalFrame: null,
      sourceDocumentId: null,
      sourceInstancePath: null,
      stableExportEntityId: null,
    },
    fragments: [
      {
        objectId: 'dbid:2',
        fragmentId: 'fragment:0',
        originalWorldMatrix: observed(matrix),
        displayWorldMatrix: observed(matrix),
        canonicalMatrix: derived(matrix),
        transformAlreadyApplied: true,
      },
    ],
    diagnostics: ['SOURCE_PLACEMENT_NOT_ESTABLISHED'],
  });
}
test('completed evidence SHA covers late fragment observations and exact receipt binding', async () => {
  const evidence = await fixture();
  assert.equal(await verifyCompletedCaptureEvidence(evidence), true);
  const changed = structuredClone(evidence);
  changed.fragments[0].originalWorldMatrix.value[12] = 7;
  assert.equal(validateCompletedCaptureEvidence(changed), true);
  assert.equal(await verifyCompletedCaptureEvidence(changed), false);
  const bound = await bindCompletedCaptureEvidence(evidence, {
    selectionRevision: '4',
    partPayloadSha256: 'c'.repeat(64),
  });
  assert.equal(await verifyCompletedCaptureEvidence(bound), true);
  assert.notEqual(bound.sha256, evidence.sha256);
  assert.equal(evidence.binding.partPayloadSha256, null);
  assert.deepEqual(bound.fragments, evidence.fragments);
});
test('observed zero differs from unavailable offset and never invents local/document identity', async () => {
  const evidence = await fixture(),
    missingInput = structuredClone(evidence);
  missingInput.observations.globalOffsetDisplayUnits = missing();
  missingInput.observations.globalOffsetMetres = missing();
  const absent = await createCompletedCaptureEvidence(missingInput);
  assert.notEqual(absent.sha256, evidence.sha256);
  assert.equal(absent.observations.globalOffsetDisplayUnits.value, null);
  assert.equal(evidence.observations.globalOffsetDisplayUnits.value[0], 0);
  const promoted = structuredClone(evidence);
  promoted.observations.objectLocalFrame = matrix;
  assert.equal(validateCompletedCaptureEvidence(promoted), false);
});
test('strict finite affine rows, count, byte and unknown-field bounds fail closed', async () => {
  const evidence = await fixture();
  for (const mutate of [
    (value) => {
      value.approved = true;
    },
    (value) => {
      value.fragments[0].canonicalMatrix.value[3] = 1;
    },
    (value) => {
      value.observations.metresPerDisplayUnit.value = NaN;
    },
    (value) => {
      value.binding.selectionRevision = '1\n';
    },
    (value) => {
      value.fragments.push(value.fragments[0]);
    },
    (value) => {
      value.observations.legacySourceToWorldMetres.status = 'observed';
    },
    (value) => {
      value.fragments = Array.from({ length: CAPTURE_EVIDENCE_LIMITS.fragments + 1 }, (_, i) => ({
        ...value.fragments[0],
        fragmentId: `fragment:${i}`,
      }));
    },
  ]) {
    const bad = structuredClone(evidence);
    mutate(bad);
    assert.equal(validateCompletedCaptureEvidence(bad), false);
  }
  const large = structuredClone(evidence);
  large.diagnostics = Array(257).fill('x');
  assert.equal(validateCompletedCaptureEvidence(large), false);
});
