import { randomUUID } from 'node:crypto';
import { abortCheck, canonical, clone, digest, identifier, nowIso, PROFILE } from './contracts.mjs';

const ISSUER = 'routings-model-preparer/fake-cost-v1';
const DOMAIN = 'MODEL_PREPARER_FAKE_COST_ATTESTATION_V1';
const OPERATIONS = Object.freeze(['storage', 'upload', 'submit']);
const fakeBrands = new WeakSet();
const KEYS = ['schemaVersion', 'evidenceId', 'kind', 'issuer', 'identity', 'checkedAt', 'expiresAt', 'status', 'price', 'origin', 'allowances', 'uploadBytes', 'attestation'];
const reasonByCode = Object.freeze({
  COST_MISSING: 'Zero-cost evidence is missing.', COST_UNKNOWN: 'Zero price or remaining allowance is unknown.',
  COST_EXPIRED: 'Zero-cost evidence is not current.', COST_NONZERO: 'The operation is not verified to cost zero.',
  COST_QUOTA: 'The evidence allowance is insufficient.', COST_IDENTITY_MISMATCH: 'The evidence belongs to a different immutable operation.',
  COST_UNVERIFIABLE: 'The evidence cannot be verified by its trusted issuer.',
});
function object(value, keys) {
  return value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).every(key => keys.includes(key)) && keys.every(key => Object.hasOwn(value, key));
}
function count(value) { return Number.isSafeInteger(value) && value >= 0; }
function instant(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : NaN;
  if (value instanceof Date) return value.getTime();
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return NaN;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value ? time : NaN;
}
function clockObject(clock) { return typeof clock === 'function' ? { now: clock } : clock ?? { now: () => Date.now() }; }
function safeIdentifier(value) { try { identifier(value, 'COST_UNVERIFIABLE'); return true; } catch { return false; } }
function evidencePayload(evidence) {
  const { attestation, ...payload } = evidence;
  return payload;
}
function attestation(evidence) { return digest({ domain: DOMAIN, evidence: evidencePayload(evidence) }); }

// Private capture paths/times, jobId, label and output never enter this binding.
// The remote/source/settings identities remain authoritative across retries.
export function costIdentity(context) {
  return digest({ schemaVersion: 1, submissionIdentity: context.submissionIdentity, remoteTargetIdentity: context.remoteTargetIdentity,
    source: { name: context.source.name, bytes: context.source.bytes, sha256: context.source.sha256 },
    namespace: { account: context.namespace.account, application: context.namespace.application }, region: context.region,
    destination: { bucket: context.destination.bucket, objectKey: context.destination.objectKey },
    conversion: { format: context.conversion.format, views: context.conversion.views, xAdsForce: context.conversion.xAdsForce },
    supportProfile: context.supportProfile });
}

/** A deterministic simulation proof; its public digest is not production trust. */
export function issueFakeCostEvidence(context, options = {}) {
  const clock = clockObject(options.clock);
  const checkedAt = options.checkedAt ?? nowIso(clock);
  const checked = instant(checkedAt), ttlMs = options.ttlMs ?? 60000;
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || !Number.isFinite(checked)) throw new TypeError('Fake evidence requires a positive TTL and a valid UTC clock.');
  const allowed = options.allowedOperations ?? OPERATIONS;
  if (!Array.isArray(allowed) || allowed.some(value => !OPERATIONS.includes(value)) || new Set(allowed).size !== allowed.length) throw new TypeError('Invalid fake allowed operations.');
  const counts = options.counts ?? {}, quota = options.quota ?? {};
  const allowances = Object.fromEntries(OPERATIONS.map(operation => [operation, {
    count: allowed.includes(operation) ? counts[operation] ?? 1 : 0,
    quotaRemaining: typeof quota === 'number' ? quota : quota[operation] ?? 1,
  }]));
  const evidence = {
    schemaVersion: 1, evidenceId: options.evidenceId ?? randomUUID(), kind: 'fake', issuer: ISSUER, identity: costIdentity(context),
    checkedAt, expiresAt: options.expiresAt ?? new Date(checked + ttlMs).toISOString(), status: options.status ?? 'zero',
    price: { amount: options.amount ?? 0, currency: options.currency ?? 'USD', basis: options.basis ?? 'synthetic-zero-cost-fixture' },
    origin: { kind: 'fake', reference: options.originReference ?? 'synthetic-test-fixture' }, allowances,
    uploadBytes: options.uploadBytes ?? context.source.bytes,
  };
  identifier(evidence.evidenceId, 'COST_UNVERIFIABLE');
  identifier(evidence.origin.reference, 'COST_UNVERIFIABLE');
  identifier(evidence.price.basis, 'COST_UNVERIFIABLE');
  evidence.attestation = attestation(evidence);
  return clone(evidence);
}

function validFakeProof(evidence) {
  try {
    if (!object(evidence, KEYS) || evidence.schemaVersion !== 1 || evidence.kind !== 'fake' || evidence.issuer !== ISSUER ||
      !object(evidence.origin, ['kind', 'reference']) || evidence.origin.kind !== 'fake' || !safeIdentifier(evidence.origin.reference)) return false;
    identifier(evidence.evidenceId, 'COST_UNVERIFIABLE');
    if (!/^[0-9a-f]{64}$/.test(evidence.identity) || !/^[0-9a-f]{64}$/.test(evidence.attestation)) return false;
    return evidence.attestation === attestation(evidence);
  } catch { return false; }
}

function validAPSProof(evidence) {
  return object(evidence, KEYS) && evidence.schemaVersion === 1 && evidence.kind === 'aps-operator' &&
    evidence.issuer === 'routings-model-preparer/aps-operator-cost-v1' && object(evidence.origin, ['kind', 'reference']) &&
    evidence.origin.kind === 'operator-verified-autodesk-account' && /^[0-9a-f]{64}$/.test(evidence.origin.reference) &&
    safeIdentifier(evidence.evidenceId) && /^[0-9a-f]{64}$/.test(evidence.identity) && /^[0-9a-f]{64}$/.test(evidence.attestation);
}
function validEngineerProof(evidence) {
  return object(evidence, KEYS) && evidence.schemaVersion === 1 && evidence.kind === 'engineer-declared-free' &&
    evidence.issuer === 'routings-model-preparer/engineer-declared-cost-v1' && object(evidence.origin, ['kind', 'reference']) &&
    evidence.origin.kind === 'engineer-declared-free' && /^[0-9a-f]{64}$/.test(evidence.origin.reference) &&
    evidence.price?.basis === 'engineer-declared-autodesk-free-plan-quota-unknown' &&
    safeIdentifier(evidence.evidenceId) && /^[0-9a-f]{64}$/.test(evidence.identity) && /^[0-9a-f]{64}$/.test(evidence.attestation);
}
const recognizedProof = evidence => validFakeProof(evidence) || validAPSProof(evidence) || validEngineerProof(evidence);

/** Pure decision; the caller supplies issuer verification and durable usage. */
export function evaluateCostEvidence({ evidence, context, operation, now, consumed = 0, verified = false }) {
  const denied = code => ({ allowed: false, code, reason: reasonByCode[code],
    ...(verified === true && recognizedProof(evidence) && safeIdentifier(evidence?.evidenceId) ? { evidenceId: evidence.evidenceId } : {}) });
  if (evidence === null || evidence === undefined) return denied('COST_MISSING');
  if (!object(evidence, KEYS) || evidence.schemaVersion !== 1 || !OPERATIONS.includes(operation) || !count(consumed)) return denied('COST_UNVERIFIABLE');
  try { if (evidence.identity !== costIdentity(context)) return denied('COST_IDENTITY_MISMATCH'); }
  catch { return denied('COST_IDENTITY_MISMATCH'); }
  if (evidence.status === 'unknown') return denied('COST_UNKNOWN');
  if (!object(evidence.price, ['amount', 'currency', 'basis']) || typeof evidence.price.amount !== 'number' || !Number.isFinite(evidence.price.amount)) return denied('COST_UNKNOWN');
  if (evidence.status !== 'zero' || evidence.price.amount !== 0) return denied('COST_NONZERO');
  if (!/^[A-Z]{3}$/.test(evidence.price.currency) || !safeIdentifier(evidence.price.basis)) return denied('COST_UNVERIFIABLE');
  const at = instant(now), checked = instant(evidence.checkedAt), expiry = instant(evidence.expiresAt);
  if (![at, checked, expiry].every(Number.isFinite) || checked > at || expiry <= checked || at >= expiry) return denied('COST_EXPIRED');
  if (verified !== true || !recognizedProof(evidence)) return denied('COST_UNVERIFIABLE');
  if (context.region !== 'EMEA' && context.region !== 'US' || context.supportProfile !== PROFILE || context.conversion.format !== 'svf' || canonical(context.conversion.views) !== '["3d"]' || context.conversion.xAdsForce !== false) return denied('COST_IDENTITY_MISMATCH');
  if (!object(evidence.allowances, OPERATIONS)) return denied('COST_UNKNOWN');
  const declared = validEngineerProof(evidence);
  for (const allowance of Object.values(evidence.allowances)) {
    if (!object(allowance, ['count', 'quotaRemaining']) || !count(allowance.count) ||
      (declared ? allowance.count !== 1 || allowance.quotaRemaining !== null : !count(allowance.quotaRemaining))) return denied('COST_UNKNOWN');
  }
  const allowance = evidence.allowances[operation];
  if (consumed >= allowance.count || !declared && consumed >= allowance.quotaRemaining) return denied('COST_QUOTA');
  if (operation === 'upload' && (!count(evidence.uploadBytes) || evidence.uploadBytes < context.source.bytes)) return denied('COST_QUOTA');
  return { allowed: true, code: 'COST_ALLOWED', reason: declared ? 'An engineer declared the Autodesk Free plan; this local authorization covers one exact operation. Autodesk quota is unknown.' : evidence.kind === 'fake' ? 'Current verified simulation evidence covers this exact operation.' : 'Current verified operator evidence covers this exact operation.', evidenceId: evidence.evidenceId };
}

export function createFakeCostProvider({ evidence, clock, ...issuance } = {}) {
  const sourceClock = clockObject(clock), issued = new Map(), calls = [];
  let fixed = evidence;
  const api = {
    kind: 'fake', mode: 'fake',
    get calls() { return clone(calls); },
    async getEvidence(context, { signal } = {}) {
      abortCheck(signal);
      const identity = costIdentity(context);
      calls.push({ operation: 'getEvidence', identity });
      if (fixed !== undefined) return fixed === null ? null : clone(fixed);
      if (!issued.has(identity)) issued.set(identity, issueFakeCostEvidence(context, { ...issuance, clock: sourceClock }));
      return clone(issued.get(identity));
    },
    verifyEvidence(value, context) {
      try { return validFakeProof(value) && value.identity === costIdentity(context); } catch { return false; }
    },
    // Approval refresh is an explicit test/operator action, never implicit IO.
    issue(context, overrides = {}) {
      const value = issueFakeCostEvidence(context, { ...issuance, ...overrides, clock: sourceClock });
      issued.set(costIdentity(context), value); fixed = undefined; return clone(value);
    },
    setEvidence(value) { fixed = value === null ? null : clone(value); },
  };
  fakeBrands.add(api);
  return Object.freeze(api);
}
export function isFakeCostProvider(value) { return fakeBrands.has(value); }
export function createClosedCostProvider() {
  return Object.freeze({ kind: 'closed-real', mode: 'closed-real',
    async getEvidence() { return null; }, verifyEvidence() { return false; } });
}
