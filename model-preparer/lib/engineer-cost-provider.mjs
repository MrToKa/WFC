import * as fs from 'node:fs/promises';
import { closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { brandAPSCostProvider } from './aps-capabilities.mjs';
import { costIdentity } from './cost.mjs';
import { abortCheck, canonical, clone, digest, fail, plain, PROFILE, validateLocalPath, validateSourceName } from './contracts.mjs';

const SHA = /^[0-9a-f]{64}$/;
const KIND = 'engineer-declared-free';
const ISSUER = 'routings-model-preparer/engineer-declared-cost-v1';
const DOMAIN = 'MODEL_PREPARER_ENGINEER_DECLARED_COST_V1';
const BASIS = 'engineer-declared-autodesk-free-plan-quota-unknown';
const OPERATIONS = ['storage', 'upload', 'submit'];
const MAX_READS = 2000;
const HOUR = 60 * 60 * 1000;
const AUTH_FIELDS = ['enabled', 'configurationId', 'accountHash', 'applicationHash', 'bucketHash', 'region', 'freePlanConfirmedBy', 'freePlanConfirmedAt'];
const count = value => Number.isSafeInteger(value) && value >= 0;
const instant = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value ? Date.parse(value) : NaN;
function exact(value, keys, code = 'COST_UNVERIFIABLE') {
  plain(value, keys, code);
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail(code);
}
function linkFree(file, directory = false) {
  const absolute = validateLocalPath(file), root = path.parse(absolute).root;
  let current = root;
  for (const component of ['', ...path.relative(root, absolute).split(path.sep).filter(Boolean)]) {
    if (component) current = path.join(current, component);
    const stat = lstatSync(current), last = current === absolute;
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()) || stat.isFile() && stat.nlink !== 1 || (!last || directory) && !stat.isDirectory()) fail('COST_UNVERIFIABLE');
    const resolved = realpathSync(current);
    if ((process.platform === 'win32' ? resolved.toLowerCase() : resolved) !== (process.platform === 'win32' ? current.toLowerCase() : current)) fail('COST_UNVERIFIABLE');
  }
  return absolute;
}
function readKey(file) {
  linkFree(file);
  const before = lstatSync(file);
  if (!before.isFile() || before.size !== 32 || process.platform !== 'win32' && before.mode & 0o077) fail('COST_UNVERIFIABLE');
  const fd = openSync(file, 'r'), key = Buffer.alloc(33);
  try {
    let total = 0;
    while (total < key.length) {
      const length = readSync(fd, key, total, key.length - total, total);
      if (!length) break;
      total += length;
    }
    const after = fstatSync(fd);
    if (total !== 32 || after.size !== before.size || after.ino !== before.ino || after.dev !== before.dev || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) fail('COST_UNVERIFIABLE');
    return key.subarray(0, total);
  } finally { closeSync(fd); }
}

/** A server authorization based on an engineer's declared Free plan. It is
 * deliberately not Autodesk quota evidence: all external remaining quotas are
 * unknown. The provider's counts bound local actions only, and the real Free
 * team must enforce its monthly cap. getAuthorization must be synchronous so
 * revocation is checked immediately before a cloud mutation. */
export async function createEngineerCostProvider({ store, signingKeyPath, getAuthorization, clock = { now: () => Date.now() }, leaseMs = HOUR, maxReadCalls = MAX_READS } = {}) {
  validateLocalPath(signingKeyPath);
  if (!store || ['read', 'write', 'withLock'].some(method => typeof store[method] !== 'function') || typeof getAuthorization !== 'function' || typeof clock?.now !== 'function' || !Number.isSafeInteger(leaseMs) || leaseMs < 1 || leaseMs > HOUR || !Number.isSafeInteger(maxReadCalls) || maxReadCalls < 1 || maxReadCalls > MAX_READS) fail('CONFIGURATION_INVALID');
  let ancestor = path.dirname(signingKeyPath);
  while (true) {
    try { linkFree(ancestor, true); break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; const parent = path.dirname(ancestor); if (parent === ancestor) throw error; ancestor = parent; }
  }
  await fs.mkdir(path.dirname(signingKeyPath), { recursive: true, mode: 0o700 });
  linkFree(path.dirname(signingKeyPath), true);
  try {
    const handle = await fs.open(signingKeyPath, 'wx', 0o600);
    try { await handle.writeFile(randomBytes(32)); await handle.sync(); } finally { await handle.close(); }
  } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const signingKey = readKey(signingKeyPath);
  const now = () => { const value = clock.now(); if (!Number.isSafeInteger(value)) fail('COST_UNVERIFIABLE'); return value; };
  const sign = evidence => { const { attestation, ...payload } = evidence; return createHmac('sha256', signingKey).update(canonical({ domain: DOMAIN, evidence: payload })).digest('hex'); };
  function authorization() {
    const value = getAuthorization();
    if (!value || value.enabled !== true) fail('COST_UNKNOWN');
    exact(value, AUTH_FIELDS);
    if (['configurationId', 'accountHash', 'applicationHash', 'bucketHash'].some(key => !SHA.test(value[key] ?? '')) || !['EMEA', 'US'].includes(value.region) ||
      typeof value.freePlanConfirmedBy !== 'string' || !value.freePlanConfirmedBy.trim() || value.freePlanConfirmedBy.length > 160 || /[\x00-\x1f\x7f]/.test(value.freePlanConfirmedBy) ||
      !Number.isSafeInteger(instant(value.freePlanConfirmedAt)) || instant(value.freePlanConfirmedAt) > now()) fail('COST_UNVERIFIABLE');
    const currentKey = readKey(signingKeyPath);
    if (!timingSafeEqual(currentKey, signingKey)) fail('COST_UNVERIFIABLE');
    return clone(value);
  }
  function bind(auth, context) {
    if (!context?.source || !context.namespace || !context.destination || !context.conversion ||
      context.namespace.account !== `team-${auth.accountHash}` || context.namespace.application !== `app-${auth.applicationHash}` || context.destination.bucket !== `target-${auth.bucketHash}` || context.region !== auth.region ||
      context.supportProfile !== PROFILE || canonical(context.conversion) !== '{"format":"svf","views":["3d"],"xAdsForce":false}' ||
      !count(context.source.bytes) || context.source.bytes < 1 || context.source.bytes > 2 * 1024 ** 3 || !SHA.test(context.source.sha256 ?? '')) fail('COST_IDENTITY_MISMATCH');
    validateSourceName(context.source.name); validateSourceName(context.destination.objectKey);
    const upload = { source: { bytes: context.source.bytes, sha256: context.source.sha256 }, namespace: context.namespace, region: context.region, destination: context.destination };
    if (context.submissionIdentity !== digest({ ...upload, conversion: context.conversion, supportProfile: context.supportProfile }) ||
      context.remoteTargetIdentity !== digest({ namespace: context.namespace, region: context.region, destination: context.destination })) fail('COST_IDENTITY_MISMATCH');
    const objectId = `urn:adsk.objects:os.object:${context.destination.bucket}/${context.destination.objectKey}`;
    if (context.objectId !== objectId || context.urn !== Buffer.from(objectId).toString('base64url')) fail('COST_IDENTITY_MISMATCH');
    return costIdentity(context);
  }
  function evidenceFor(auth, context, checkedAt, expiresAt) {
    const identity = bind(auth, context), reference = digest({ issuer: ISSUER, declaredFreePlan: auth });
    const evidence = { schemaVersion: 1, evidenceId: digest({ issuer: ISSUER, reference, identity }), kind: KIND, issuer: ISSUER, identity,
      checkedAt, expiresAt, status: 'zero', price: { amount: 0, currency: 'USD', basis: BASIS }, origin: { kind: KIND, reference },
      allowances: Object.fromEntries(OPERATIONS.map(operation => [operation, { count: 1, quotaRemaining: null }])), uploadBytes: context.source.bytes };
    evidence.attestation = sign(evidence);
    return evidence;
  }
  function verifyEvidence(evidence, context) {
    try {
      const auth = authorization(), checked = instant(evidence?.checkedAt), expires = instant(evidence?.expiresAt), at = now();
      if (![checked, expires].every(Number.isSafeInteger) || checked > at || expires <= at || expires <= checked || expires - checked > HOUR ||
        typeof evidence.attestation !== 'string' || !SHA.test(evidence.attestation)) return false;
      const expected = evidenceFor(auth, context, evidence.checkedAt, evidence.expiresAt);
      return timingSafeEqual(Buffer.from(evidence.attestation, 'hex'), Buffer.from(sign(evidence), 'hex')) && canonical(evidence) === canonical(expected);
    } catch { return false; }
  }
  async function currentEvidence(context, { signal, recoverDead = false } = {}) {
    abortCheck(signal);
    const initial = authorization(), identity = bind(initial, context), reference = digest({ issuer: ISSUER, declaredFreePlan: initial });
    const key = digest({ kind: 'engineer-declared-lease', reference, identity });
    return store.withLock('cost', key, async lease => {
      const auth = authorization();
      if (canonical(auth) !== canonical(initial)) fail('COST_IDENTITY_MISMATCH');
      const current = await store.read('cost', key);
      let evidence;
      if (current) {
        exact(current, ['schemaVersion', 'kind', 'reference', 'identity', 'evidence'], 'STORE_CORRUPT');
        if (current.schemaVersion !== 1 || current.kind !== 'engineer-declared-lease' || current.reference !== reference || current.identity !== identity) fail('STORE_CORRUPT');
        const old = current.evidence, checked = instant(old?.checkedAt), expires = instant(old?.expiresAt);
        if (![checked, expires].every(Number.isSafeInteger) || checked > now() || expires <= checked || expires - checked > HOUR ||
          canonical(old) !== canonical(evidenceFor(auth, context, old.checkedAt, old.expiresAt))) fail('STORE_CORRUPT');
        if (expires > now()) evidence = old;
      }
      if (!evidence) {
        const at = now();
        evidence = evidenceFor(auth, context, new Date(at).toISOString(), new Date(at + leaseMs).toISOString());
        await store.write('cost', key, { schemaVersion: 1, kind: 'engineer-declared-lease', reference, identity, evidence }, { lease, signal });
      }
      if (!verifyEvidence(evidence, context)) fail('COST_UNVERIFIABLE');
      abortCheck(signal);
      return clone(evidence);
    }, { signal, recoverDead });
  }
  // These keys intentionally exclude evidence expiry, config revision and the
  // descriptive source name. Approval refresh cannot erase past reservations.
  async function reserve(context, operation, { signal, recoverDead = false } = {}) {
    abortCheck(signal);
    const evidence = await currentEvidence(context, { signal, recoverDead });
    const key = digest({ kind: 'engineer-declared-local-budget', submissionIdentity: context.submissionIdentity });
    await store.withLock('cost', key, async lease => {
      if (!verifyEvidence(evidence, context)) fail('COST_UNVERIFIABLE');
      const current = await store.read('cost', key);
      if (current) {
        exact(current, ['schemaVersion', 'kind', 'submissionIdentity', 'counts', 'reads'], 'STORE_CORRUPT');
        exact(current.counts, OPERATIONS, 'STORE_CORRUPT');
        if (current.schemaVersion !== 1 || current.kind !== 'engineer-declared-local-budget' || current.submissionIdentity !== context.submissionIdentity ||
          Object.values(current.counts).some(value => !count(value) || value > 1) || !count(current.reads) || current.reads > MAX_READS) fail('STORE_CORRUPT');
      }
      const budget = current ?? { schemaVersion: 1, kind: 'engineer-declared-local-budget', submissionIdentity: context.submissionIdentity, counts: { storage: 0, upload: 0, submit: 0 }, reads: 0 };
      if (operation === 'read') {
        if (budget.reads >= maxReadCalls) fail('READ_LIMIT');
        budget.reads++;
      } else {
        if (budget.counts[operation] >= 1) fail('COST_QUOTA');
        budget.counts[operation]++;
      }
      await store.write('cost', key, budget, { lease, signal });
      // Revocation or expiry during a slow commit conservatively keeps the
      // reservation and prevents the subsequent provider request.
      if (!verifyEvidence(evidence, context)) fail('COST_UNVERIFIABLE');
      abortCheck(signal);
    }, { signal, recoverDead });
  }
  const api = {
    kind: KIND, mode: 'live',
    getReadiness() {
      try { const auth = authorization(); return { state: 'engineer-declared', quotaKnown: false, configurationId: auth.configurationId, freePlanConfirmedAt: auth.freePlanConfirmedAt }; }
      catch (error) { return { state: 'blocked', quotaKnown: false, code: /^COST_/.test(error.code ?? '') ? error.code : 'COST_UNVERIFIABLE' }; }
    },
    async getEvidence(context, options = {}) {
      abortCheck(options.signal);
      try { return await currentEvidence(context, options); }
      catch (error) { abortCheck(options.signal); if (error?.code === 'STORE_CORRUPT') throw error; return null; }
    },
    verifyEvidence,
    async reserveMutation(context, operation, options = {}) {
      if (!OPERATIONS.includes(operation)) fail('COST_UNVERIFIABLE');
      return reserve(context, operation, options);
    },
    async reserveRead(context, options = {}) { return reserve(context, 'read', options); },
  };
  brandAPSCostProvider(api);
  return Object.freeze(api);
}
