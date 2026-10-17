import { createHash } from 'node:crypto';
import { fail } from './errors.mjs';
import { parseJson } from './json.mjs';
import { DEFAULT_LIMITS, resolveLimits } from './limits.mjs';
import { validateResourcePath, assertNoCaseCollisions } from './paths.mjs';

const rootFields = ['schemaVersion', 'packageId', 'label', 'source', 'preparedAt', 'supportProfile', 'format', 'sdkVersion', 'entrypoint', 'resources', 'contentFingerprint'];
const sourceFields = ['name', 'bytes', 'sha256', 'identityBasis'];
const resourceFields = ['path', 'bytes', 'sha256'];
const shaPattern = /^[0-9a-f]{64}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const forbiddenExtension = /\.(?:js|mjs|cjs|html?|css|wasm|exe|dll|com|bat|cmd|ps1|sh|vbs|hta|jar)$/i;
const allowedExtension = /(?:\.svf|\.pf|\.bin|\.pack|\.json\.gz|\.db)$/;
const invalid = (message, details) => fail('INVALID_MANIFEST', message, details);

function exactObject(value, fields, location) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    invalid('Expected a plain JSON object.', { path: location });
  }
  const keys = Reflect.ownKeys(value);
  for (const key of keys) {
    if (typeof key !== 'string' || !fields.includes(key)) invalid('Unknown manifest field.', { path: location, field: String(key) });
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor.get || descriptor.set || !descriptor.enumerable) invalid('Manifest fields must be enumerable data properties.', { path: location, field: key });
  }
  for (const field of fields) if (!Object.hasOwn(value, field)) invalid('Missing required manifest field.', { path: location, field });
}

function boundedText(value, maximum, location, { trim = false } = {}) {
  if (typeof value !== 'string' || !value || [...value].length > maximum || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(value) || (trim && value.trim() !== value)) {
    invalid('Invalid manifest text or Unicode length.', { path: location, maximum });
  }
}

function bytes(value, maximum, location) {
  if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) invalid('Byte counts must be nonnegative safe integers.', { path: location });
  if (value > maximum) fail('PACKAGE_LIMIT_EXCEEDED', 'Declared byte count exceeds the v1 limit.', { path: location, maximum });
}

function sha(value, location) {
  if (typeof value !== 'string' || !shaPattern.test(value)) invalid('Expected exactly 64 lowercase hexadecimal SHA-256 characters.', { path: location });
}

function utcInstant(value) {
  if (typeof value !== 'string') invalid('preparedAt must be an RFC3339 UTC instant with Z.');
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z$/.exec(value);
  if (!match) invalid('preparedAt must be an RFC3339 UTC instant with Z.');
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const [year, month, day, hour, minute, second] = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > monthDays[month - 1] || hour > 23 || minute > 59 || second > 59) {
    invalid('preparedAt contains an invalid UTC calendar date or time.');
  }
}

export function validateManifest(manifest, { limits = DEFAULT_LIMITS } = {}) {
  const checkedLimits = resolveLimits(limits);
  exactObject(manifest, rootFields, '$');
  if (manifest.schemaVersion !== 1) fail('UNSUPPORTED_SCHEMA', 'Only portable manifest schemaVersion 1 is supported.');
  if (manifest.supportProfile !== 'svf-local-7.130.0-v1' || manifest.format !== 'svf' || manifest.sdkVersion !== '7.130.0') {
    fail('UNSUPPORTED_PROFILE', 'Unsupported model format, SDK or compatibility profile.');
  }
  if (typeof manifest.packageId !== 'string' || !uuidPattern.test(manifest.packageId)) invalid('packageId must be a canonical lowercase UUIDv4.');
  boundedText(manifest.label, 200, '$.label', { trim: true });
  utcInstant(manifest.preparedAt);
  exactObject(manifest.source, sourceFields, '$.source');
  boundedText(manifest.source.name, 255, '$.source.name');
  if (manifest.source.name.trim() !== manifest.source.name || /[\\/<>:"|?*%#]/.test(manifest.source.name) || /[. ]$/.test(manifest.source.name) || /^(?:\.|\.\.|CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(manifest.source.name)) {
    invalid('source.name must be a safe basename without path semantics.');
  }
  bytes(manifest.source.bytes, Number.MAX_SAFE_INTEGER, '$.source.bytes');
  sha(manifest.source.sha256, '$.source.sha256');
  if (!['observed-local-file', 'captured-at-conversion'].includes(manifest.source.identityBasis)) invalid('Unsupported source.identityBasis.');
  validateResourcePath(manifest.entrypoint);
  if (manifest.entrypoint !== 'resources/output/0/0.svf') fail('UNSUPPORTED_PROFILE', 'Unsupported entrypoint for the fixed v1 profile.');
  if (!Array.isArray(manifest.resources) || manifest.resources.length === 0) invalid('resources must be a nonempty array.');
  if (manifest.resources.length > checkedLimits.maxFiles) fail('PACKAGE_LIMIT_EXCEEDED', 'Resource count exceeds the v1 limit.');
  let total = 0;
  let previous;
  let hasEntrypoint = false;
  for (let index = 0; index < manifest.resources.length; index++) {
    const resource = manifest.resources[index];
    const location = `$.resources[${index}]`;
    exactObject(resource, resourceFields, location);
    validateResourcePath(resource.path);
    if (forbiddenExtension.test(resource.path)) fail('EXECUTABLE_CONTENT', 'Executable resources are forbidden.', { path: resource.path });
    if (!allowedExtension.test(resource.path)) fail('UNSUPPORTED_PROFILE', 'Unknown resource suffix for the fixed v1 profile.', { path: resource.path });
    bytes(resource.bytes, checkedLimits.maxFileBytes, `${location}.bytes`);
    sha(resource.sha256, `${location}.sha256`);
    total += resource.bytes;
    if (!Number.isSafeInteger(total) || total > checkedLimits.maxTotalResourceBytes) fail('PACKAGE_LIMIT_EXCEEDED', 'Total resource bytes exceed the v1 limit.');
    if (previous !== undefined && previous >= resource.path) invalid('Published resources must be unique and strictly sorted by ordinal ASCII path.', { path: resource.path });
    previous = resource.path;
    if (resource.path === manifest.entrypoint) hasEntrypoint = true;
  }
  assertNoCaseCollisions(manifest.resources.map((resource) => resource.path));
  if (!hasEntrypoint) fail('RESOURCE_MISSING', 'The entrypoint is not listed in resources.', { path: manifest.entrypoint });
  sha(manifest.contentFingerprint, '$.contentFingerprint');
  // Raw byte integrity, reference closure and fingerprint equality belong to
  // the verifier; this function checks the published manifest contract.
  return manifest;
}

export function parseManifest(text, options = {}) {
  const limits = resolveLimits(options.limits ?? DEFAULT_LIMITS);
  if (typeof text !== 'string') invalid('Portable manifest input must be UTF-8 text.');
  if (Buffer.byteLength(text, 'utf8') > limits.maxManifestBytes) fail('PACKAGE_LIMIT_EXCEEDED', 'Root manifest exceeds the v1 byte limit.');
  // No duplicate exception can be passed through for the portable root.
  return validateManifest(parseJson(text, { maxDepth: limits.maxDepth }), { limits });
}

export function canonicalFingerprintInput(manifest) {
  if (!manifest || !Array.isArray(manifest.resources)) invalid('Fingerprint input requires manifest fields and resources.');
  const headerFields = ['schemaVersion', 'supportProfile', 'format', 'sdkVersion', 'entrypoint'];
  for (const field of headerFields) {
    if ((typeof manifest[field] !== 'string' && typeof manifest[field] !== 'number') || /[\r\n\t]/.test(String(manifest[field]))) invalid('Invalid fingerprint header field.', { field });
  }
  const sorted = [...manifest.resources].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  assertNoCaseCollisions(sorted.map((resource) => resource.path));
  const lines = ['wfc-model-content-v1', ...headerFields.map((field) => `${field}=${manifest[field]}`)];
  for (const resource of sorted) {
    validateResourcePath(resource.path);
    bytes(resource.bytes, Number.MAX_SAFE_INTEGER, 'resource.bytes');
    sha(resource.sha256, 'resource.sha256');
    lines.push(`${resource.path}\t${resource.bytes}\t${resource.sha256}`);
  }
  return Buffer.from(`${lines.join('\n')}\n`, 'utf8');
}

export function computeFingerprint(manifest) {
  return createHash('sha256').update(canonicalFingerprintInput(manifest)).digest('hex');
}
