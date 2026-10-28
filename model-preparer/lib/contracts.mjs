import path from 'node:path';
import { createHash } from 'node:crypto';

export const PROFILE = 'svf-local-7.130.0-v1';
export const STATES = Object.freeze(['captured', 'registered', 'cost-blocked', 'uploading', 'uploaded', 'submission-unknown', 'submitted', 'translating', 'downloading', 'downloaded', 'verifying', 'packaged', 'failed', 'interrupted']);
const MESSAGES = Object.freeze({
  INVALID_JOB: 'The explicit job specification is invalid.',
  IDENTITY_MISMATCH: 'The immutable local or provider identity does not match.',
  SOURCE_CHANGED: 'The source changed during capture.',
  SNAPSHOT_CHANGED: 'The captured upload bytes no longer match their identity.',
  STORE_CORRUPT: 'Durable state is corrupt; no mutation is permitted.',
  STORE_WRITE_FAILED: 'Durable state could not be committed.',
  LOCK_BUSY: 'A live or ambiguous owner holds the lock.',
  LOCK_OWNER_MISMATCH: 'Lock ownership could not be confirmed.',
  SOURCE_EXISTS: 'A captured source already exists for this job.',
  JOB_EXISTS: 'This local job identity already exists.',
  JOB_MISSING: 'The requested local job does not exist.',
  JOB_NOT_CAPTURED: 'A registered local package has no remote preparation history.',
  COST_BLOCKED: 'Current verifiable zero-cost evidence is required.',
  COST_MISSING: 'Zero-cost evidence is missing.',
  COST_UNKNOWN: 'Zero price or remaining allowance is unknown.',
  COST_EXPIRED: 'Zero-cost evidence is not current.',
  COST_NONZERO: 'The operation is not verified to cost zero.',
  COST_QUOTA: 'The evidence allowance is insufficient.',
  COST_IDENTITY_MISMATCH: 'The cost evidence belongs to a different immutable operation.',
  COST_UNVERIFIABLE: 'The evidence cannot be verified by its trusted issuer.',
  CLOUD_CLOSED: 'The real cloud adapter is closed in Stage 2.',
  PROVIDER_FAILURE: 'The provider operation did not return a usable result.',
  PROVIDER_RESPONSE_INVALID: 'The provider returned an invalid normalized response.',
  SUBMISSION_UNKNOWN: 'A prior submission has an unknown outcome; reconciliation is required.',
  DERIVATIVE_FAILED: 'The derivative failed; automatic forced conversion is disabled.',
  DERIVATIVE_PENDING: 'The derivative is not ready for download.',
  DERIVATIVE_AMBIGUOUS: 'An explicit compatible derivative root is required.',
  DOWNLOAD_INCOMPLETE: 'The complete supported model has not been downloaded.',
  DOWNLOAD_PLAN_CHANGED: 'The download plan conflicts with the durable checkpoints.',
  DOWNLOAD_INVALID: 'A raw resource or download plan is invalid.',
  UNSAFE_PATH: 'A path or filesystem link is outside the supported boundary.',
  PACKAGE_ADAPTER_FAILURE: 'The package adapter did not publish a verified result.',
  PACKAGE_LIMIT_EXCEEDED: 'A streamed size, count or time limit was exceeded.',
  LOCAL_ABORTED: 'Local work was interrupted; remote cancellation is not implied.',
  READ_LIMIT: 'The bounded read operation did not complete.',
  UNSUPPORTED_PROFILE: 'The requested profile or conversion settings are unsupported.',
  CONFIGURATION_INVALID: 'Explicit local dependency and storage configuration is required.',
});

export class CoreError extends Error {
  constructor(code, message = MESSAGES[code] || 'The operation failed safely.', details = {}) {
    super(message);
    this.name = 'CoreError';
    this.code = code;
    this.details = details;
  }
}
export function fail(code, message, details) { throw new CoreError(code, message, details); }
// Foreign provider/SDK messages, headers, URLs and response bodies never become state/logs.
export function safeError(error) {
  const code = error instanceof CoreError && Object.hasOwn(MESSAGES, error.code) ? error.code : 'PROVIDER_FAILURE';
  return { code, message: MESSAGES[code] };
}
export function abortCheck(signal) { if (signal?.aborted) fail('LOCAL_ABORTED'); }
export function nowIso(clock = { now: () => Date.now() }) {
  const ms = clock.now();
  if (!Number.isSafeInteger(ms) || !Number.isFinite(ms)) fail('CONFIGURATION_INVALID');
  return new Date(ms).toISOString();
}
export function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && Object.getPrototypeOf(value) === Object.prototype) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  fail('STORE_CORRUPT', 'Only plain serializable state is supported.');
}
export function digest(value) { return createHash('sha256').update(canonical(value), 'utf8').digest('hex'); }
export function clone(value) { return JSON.parse(canonical(value)); }
export function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const item of Object.values(value)) freeze(item); Object.freeze(value); }
  return value;
}
export function validateId(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) fail('INVALID_JOB');
  return value;
}
export function validateSourceName(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 180 || !/^[A-Za-z0-9][A-Za-z0-9._ -]*\.nwd$/i.test(value) || /[. ]$/.test(value) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) fail('INVALID_JOB');
  return value;
}
export function validateLocalPath(value, { label = 'path' } = {}) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0') || /(^|[\\/])\.env(?:[.\\/]|$)/i.test(value)) fail('INVALID_JOB', `An absolute safe ${label} is required.`);
  return path.resolve(value);
}
export function plain(value, fields, code = 'INVALID_JOB') {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some(key => !fields.includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))) fail(code);
  return value;
}
export function identifier(value, code = 'INVALID_JOB') {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) || /(?:secret|bearer|access[_-]?token|signed[_-]?url)/i.test(value)) fail(code);
  return value;
}
export function validateJobSpec(value) {
  plain(value, ['jobId', 'sourcePath', 'namespace', 'region', 'destination', 'conversion', 'supportProfile', 'label', 'output']);
  validateLocalPath(value.sourcePath, { label: 'sourcePath' });
  if (value.jobId !== undefined) validateId(value.jobId);
  plain(value.namespace, ['account', 'application']);
  identifier(value.namespace.account); identifier(value.namespace.application);
  if (!['EMEA', 'US'].includes(value.region)) fail('INVALID_JOB');
  plain(value.destination, ['bucket', 'objectKey']);
  if (typeof value.destination.bucket !== 'string' || !/^[a-z0-9][a-z0-9._-]{2,127}$/.test(value.destination.bucket)) fail('INVALID_JOB');
  validateSourceName(value.destination.objectKey);
  plain(value.conversion, ['format', 'views', 'xAdsForce']);
  if (value.conversion.format !== 'svf' || canonical(value.conversion.views) !== '["3d"]' || value.conversion.xAdsForce !== false || value.supportProfile !== PROFILE) fail('UNSUPPORTED_PROFILE');
  if (typeof value.label !== 'string' || value.label.length < 1 || value.label.length > 200 || /[\x00-\x1f]|https?:\/\/|(?:access_token|client_secret|bearer\s)/i.test(value.label)) fail('INVALID_JOB');
  validateLocalPath(value.output, { label: 'output' });
  if (!value.output.toLowerCase().endsWith('.zip')) fail('INVALID_JOB');
  return value;
}
export function contextFromSpec(spec, source) {
  const identitySource = { name: source.name, bytes: source.bytes, sha256: source.sha256 };
  // Source basename is descriptive: identical uploaded bytes cannot bypass the ledger by renaming.
  const uploadBinding = { source: { bytes: source.bytes, sha256: source.sha256 }, namespace: spec.namespace, region: spec.region, destination: spec.destination };
  const conversionBinding = { ...uploadBinding, conversion: spec.conversion, supportProfile: spec.supportProfile };
  const objectId = `urn:adsk.objects:os.object:${spec.destination.bucket}/${spec.destination.objectKey}`;
  return {
    source: { ...identitySource, snapshotPath: source.snapshotPath, capturedAt: source.capturedAt },
    namespace: clone(spec.namespace), region: spec.region, destination: clone(spec.destination), conversion: clone(spec.conversion), supportProfile: spec.supportProfile,
    label: spec.label, output: validateLocalPath(spec.output),
    uploadIdentity: digest(uploadBinding), submissionIdentity: digest(conversionBinding),
    remoteTargetIdentity: digest({ namespace: spec.namespace, region: spec.region, destination: spec.destination }),
    objectId, urn: Buffer.from(objectId, 'utf8').toString('base64url'),
  };
}
export function validateStoredJob(job) {
  plain(job, ['schemaVersion', 'jobId', 'kind', 'createdAt', 'updatedAt', 'frozen', 'frozenDigest', 'status', 'costEvidence', 'costDecision', 'upload', 'submission', 'download', 'package', 'lastGoodPackage', 'history', 'error', 'interruption'], 'STORE_CORRUPT');
  if (job.schemaVersion !== 1 || !['captured', 'registered'].includes(job.kind) || !STATES.includes(job.status) || !Array.isArray(job.history) || digest(job.frozen) !== job.frozenDigest) fail('STORE_CORRUPT');
  validateId(job.jobId);
  if (job.kind === 'captured') {
    const f = job.frozen;
    plain(f, ['source', 'namespace', 'region', 'destination', 'conversion', 'supportProfile', 'label', 'output', 'uploadIdentity', 'submissionIdentity', 'remoteTargetIdentity', 'objectId', 'urn'], 'STORE_CORRUPT');
    plain(f.source, ['name', 'bytes', 'sha256', 'snapshotPath', 'capturedAt'], 'STORE_CORRUPT');
    validateSourceName(f.source.name);
    if (!Number.isSafeInteger(f.source.bytes) || f.source.bytes < 1 || !/^[0-9a-f]{64}$/.test(f.source.sha256)) fail('STORE_CORRUPT');
    try { validateJobSpec({ sourcePath: f.source.snapshotPath, namespace: f.namespace, region: f.region, destination: f.destination, conversion: f.conversion, supportProfile: f.supportProfile, label: f.label, output: f.output }); }
    catch { fail('STORE_CORRUPT'); }
    const restored = contextFromSpec({ ...f, sourcePath: f.source.snapshotPath }, f.source);
    for (const field of ['uploadIdentity', 'submissionIdentity', 'remoteTargetIdentity', 'objectId', 'urn']) if (f[field] !== restored[field]) fail('STORE_CORRUPT');
  }
  return job;
}
export function validateReceipt(receipt, context) {
  plain(receipt, ['objectId', 'bytes', 'sha256', 'identityBasis', 'remoteSha1', 'localSha1', 'remoteObjectIdHash'], 'PROVIDER_RESPONSE_INVALID');
  if (receipt.objectId !== context.objectId || receipt.bytes !== context.source.bytes || receipt.sha256 !== context.source.sha256) fail('IDENTITY_MISMATCH');
  if (['identityBasis', 'remoteSha1', 'localSha1', 'remoteObjectIdHash'].some(key => Object.hasOwn(receipt, key))) {
    if (receipt.identityBasis !== 'aps-sha1-and-local-sha256' || typeof receipt.remoteSha1 !== 'string' || !/^[0-9a-f]{40}$/.test(receipt.remoteSha1) || receipt.remoteSha1 !== receipt.localSha1 || typeof receipt.remoteObjectIdHash !== 'string' || !/^[0-9a-f]{64}$/.test(receipt.remoteObjectIdHash)) fail('PROVIDER_RESPONSE_INVALID');
  }
  return receipt;
}
export function validateAPSProviderReceipt(receipt, code = 'PROVIDER_RESPONSE_INVALID') {
  plain(receipt, ['kind', 'remoteUrnHash', 'format', 'views', 'responseSha256'], code);
  if (receipt.kind !== 'aps-job-response' || !/^[0-9a-f]{64}$/.test(receipt.remoteUrnHash ?? '') || receipt.format !== 'svf' || canonical(receipt.views) !== '["3d"]' || !/^[0-9a-f]{64}$/.test(receipt.responseSha256 ?? '')) fail(code);
  return receipt;
}
export function validateManifestObservation(value, context) {
  plain(value, ['status', 'objectId', 'urn', 'submissionIdentity', 'providerJobId', 'roots'], 'PROVIDER_RESPONSE_INVALID');
  if (!['not-found', 'pending', 'inprogress', 'success', 'failed'].includes(value.status) || value.objectId !== context.objectId || value.urn !== context.urn || value.submissionIdentity !== context.submissionIdentity || !Array.isArray(value.roots)) fail('IDENTITY_MISMATCH');
  if (value.providerJobId !== undefined) identifier(value.providerJobId, 'PROVIDER_RESPONSE_INVALID');
  for (const root of value.roots) { plain(root, ['rootId', 'format', 'supportProfile'], 'PROVIDER_RESPONSE_INVALID'); identifier(root.rootId, 'PROVIDER_RESPONSE_INVALID'); if (root.format !== 'svf' || root.supportProfile !== PROFILE) fail('UNSUPPORTED_PROFILE'); }
  if (new Set(value.roots.map(root => root.rootId)).size !== value.roots.length) fail('PROVIDER_RESPONSE_INVALID');
  return value;
}
