import { digestSha256 } from './sha256.mjs';
// Pure completed-observation contract. No SDK, DOM, storage or network access.
export const CAPTURE_EVIDENCE_LIMITS = Object.freeze({
  bytes: 4 * 1024 ** 2,
  fragments: 4096,
  diagnostics: 256,
});
const exact = (value, fields) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value)) &&
  Object.keys(value).length === fields.length &&
  fields.every(
    (key) =>
      Object.hasOwn(value, key) && Object.getOwnPropertyDescriptor(value, key)?.get === undefined,
  );
const text = (value, max = 256) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= max &&
  !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
const uuid = (value) =>
  typeof value === 'string' &&
  /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$(?![\s\S])/u.test(value);
const hash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$(?![\s\S])/u.test(value);
const nullable = (check, value) => value === null || check(value);
const point = (value) =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every(
    (item) => typeof item === 'number' && Number.isFinite(item) && Math.abs(item) <= 1e12,
  );
const matrix = (value) =>
  Array.isArray(value) &&
  value.length === 16 &&
  value.every((item) => typeof item === 'number' && Number.isFinite(item)) &&
  value[3] === 0 &&
  value[7] === 0 &&
  value[11] === 0 &&
  value[15] === 1;
const observation = (value, check) =>
  exact(value, ['status', 'value', 'api', 'reason']) &&
  ['observed', 'derived', 'unavailable'].includes(value.status) &&
  text(value.api) &&
  nullable((v) => text(v, 1024), value.reason) &&
  (value.status === 'unavailable'
    ? value.value === null && value.reason !== null
    : check(value.value));
export function canonicalCaptureEvidenceJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalCaptureEvidenceJson).join(',') + ']';
  if (
    value &&
    typeof value === 'object' &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ':' + canonicalCaptureEvidenceJson(value[key]))
        .join(',') +
      '}'
    );
  throw Error('CAPTURE_EVIDENCE_INVALID');
}
export function validateCompletedCaptureEvidence(value) {
  try {
    if (
      !exact(value, [
        'schemaVersion',
        'binding',
        'observations',
        'fragments',
        'diagnostics',
        'sha256',
      ]) ||
      value.schemaVersion !== 'wfc.pf.completed-capture-evidence.v1' ||
      !hash(value.sha256)
    )
      return false;
    const b = value.binding,
      o = value.observations;
    if (
      !exact(b, [
        'projectId',
        'modelVersionId',
        'contentFingerprint',
        'selectionRevision',
        'loadId',
        'captureId',
        'sessionId',
        'partId',
        'planSha256',
        'coordinateFrameId',
        'partPayloadSha256',
      ]) ||
      !uuid(b.projectId) ||
      !uuid(b.modelVersionId) ||
      !hash(b.contentFingerprint) ||
      !uuid(b.captureId) ||
      !nullable(uuid, b.loadId) ||
      !nullable(
        (v) =>
          typeof v === 'string' &&
          /^(?:0|[1-9][0-9]*)$(?![\s\S])/u.test(v) &&
          BigInt(v) <= 9223372036854775807n,
        b.selectionRevision,
      ) ||
      !['sessionId', 'partId', 'coordinateFrameId'].every((key) => nullable(uuid, b[key])) ||
      !['planSha256', 'partPayloadSha256'].every((key) => nullable(hash, b[key]))
    )
      return false;
    if (
      [b.sessionId, b.partId, b.planSha256, b.coordinateFrameId].some((item) => item !== null) &&
      [b.sessionId, b.partId, b.planSha256, b.coordinateFrameId].some((item) => item === null)
    )
      return false;
    if (
      !exact(o, [
        'sdkVersion',
        'matrixPrecision',
        'sourceUnitLabel',
        'metresPerDisplayUnit',
        'upVector',
        'globalOffsetDisplayUnits',
        'globalOffsetMetres',
        'displayToWorldMetres',
        'legacySourceToWorldMetres',
        'modelTransform',
        'placementTransform',
        'objectLocalFrame',
        'sourceDocumentId',
        'sourceInstancePath',
        'stableExportEntityId',
      ]) ||
      !text(o.sdkVersion, 64) ||
      o.matrixPrecision !== 'binary64' ||
      !observation(o.sourceUnitLabel, (v) => text(v, 64)) ||
      !observation(
        o.metresPerDisplayUnit,
        (v) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 1e9,
      ) ||
      !['upVector', 'globalOffsetDisplayUnits', 'globalOffsetMetres'].every((key) =>
        observation(o[key], point),
      ) ||
      ![
        'displayToWorldMetres',
        'legacySourceToWorldMetres',
        'modelTransform',
        'placementTransform',
      ].every((key) => observation(o[key], matrix)) ||
      !['objectLocalFrame', 'sourceDocumentId', 'sourceInstancePath', 'stableExportEntityId'].every(
        (key) => o[key] === null,
      )
    )
      return false;
    if (
      o.legacySourceToWorldMetres.status !== 'derived' ||
      o.displayToWorldMetres.status !== 'derived' ||
      o.metresPerDisplayUnit.status !== 'observed' ||
      o.sourceUnitLabel.status !== 'observed' ||
      o.upVector.status !== 'observed'
    )
      return false;
    if (
      !Array.isArray(value.fragments) ||
      value.fragments.length > CAPTURE_EVIDENCE_LIMITS.fragments
    )
      return false;
    const ids = new Set();
    for (const fragment of value.fragments) {
      if (
        !exact(fragment, [
          'objectId',
          'fragmentId',
          'originalWorldMatrix',
          'displayWorldMatrix',
          'canonicalMatrix',
          'transformAlreadyApplied',
        ]) ||
        typeof fragment.objectId !== 'string' ||
        typeof fragment.fragmentId !== 'string' ||
        !/^dbid:(?:0|[1-9][0-9]*)$(?![\s\S])/u.test(fragment.objectId) ||
        !/^fragment:(?:0|[1-9][0-9]*)$(?![\s\S])/u.test(fragment.fragmentId) ||
        Number(fragment.objectId.slice(5)) > 2147483647 ||
        Number(fragment.fragmentId.slice(9)) > 2147483647 ||
        ids.has(fragment.fragmentId) ||
        fragment.transformAlreadyApplied !== true ||
        !['originalWorldMatrix', 'displayWorldMatrix', 'canonicalMatrix'].every((key) =>
          observation(fragment[key], matrix),
        ) ||
        fragment.displayWorldMatrix.status !== 'observed' ||
        fragment.canonicalMatrix.status !== 'derived'
      )
        return false;
      ids.add(fragment.fragmentId);
    }
    return (
      Array.isArray(value.diagnostics) &&
      value.diagnostics.length <= CAPTURE_EVIDENCE_LIMITS.diagnostics &&
      value.diagnostics.every((item) => text(item, 1024)) &&
      new TextEncoder().encode(canonicalCaptureEvidenceJson(value)).byteLength <=
        CAPTURE_EVIDENCE_LIMITS.bytes
    );
  } catch {
    return false;
  }
}
export async function completedCaptureEvidenceHash(value) {
  const { sha256: _sha, ...input } = value;
  return [
    ...new Uint8Array(
      await digestSha256(new TextEncoder().encode(canonicalCaptureEvidenceJson(input)),
      ),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
export async function createCompletedCaptureEvidence(input) {
  const value = { ...input, sha256: '0'.repeat(64) };
  if (!validateCompletedCaptureEvidence(value)) throw Error('CAPTURE_EVIDENCE_INVALID_OR_LIMIT');
  value.sha256 = await completedCaptureEvidenceHash(value);
  return value;
}
export async function verifyCompletedCaptureEvidence(value) {
  return (
    validateCompletedCaptureEvidence(value) &&
    (await completedCaptureEvidenceHash(value)) === value.sha256
  );
}
export async function bindCompletedCaptureEvidence(value, binding) {
  if (
    !(await verifyCompletedCaptureEvidence(value)) ||
    !exact(binding, ['selectionRevision', 'partPayloadSha256'])
  )
    throw Error('CAPTURE_EVIDENCE_BINDING_INVALID');
  return createCompletedCaptureEvidence({ ...value, binding: { ...value.binding, ...binding } });
}
