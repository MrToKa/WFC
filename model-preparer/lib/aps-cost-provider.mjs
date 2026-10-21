import * as fs from 'node:fs/promises';
import { openSync, readSync, fstatSync, closeSync, lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { brandAPSCostProvider } from './aps-capabilities.mjs';
import { costIdentity } from './cost.mjs';
import { abortCheck, canonical, clone, digest, fail, plain, validateId, validateLocalPath, validateSourceName, PROFILE } from './contracts.mjs';

const SHA = /^[0-9a-f]{64}$/;
const ISSUER = 'routings-model-preparer/aps-operator-cost-v1';
const DOMAIN = 'MODEL_PREPARER_APS_OPERATOR_COST_V1';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const instant = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value ? Date.parse(value) : NaN;
const count = value => Number.isSafeInteger(value) && value >= 0;
function exact(value, keys, code = 'COST_UNVERIFIABLE') { plain(value, keys, code); if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail(code); }
function linkFree(file, directory = false) {
  const absolute = validateLocalPath(file), root = path.parse(absolute).root;
  let current = root;
  for (const component of ['', ...path.relative(root, absolute).split(path.sep).filter(Boolean)]) {
    if (component) current = path.join(current, component);
    const stat = lstatSync(current), last = current === absolute;
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()) || (stat.isFile() && stat.nlink !== 1) || ((!last || directory) && !stat.isDirectory())) fail('COST_UNVERIFIABLE');
    const resolved = realpathSync(current);
    if ((process.platform === 'win32' ? resolved.toLowerCase() : resolved) !== (process.platform === 'win32' ? current.toLowerCase() : current)) fail('COST_UNVERIFIABLE');
  }
  return absolute;
}
function boundedFile(file, maxBytes) {
  linkFree(file); const before = lstatSync(file);
  if (!before.isFile() || before.size > maxBytes) fail('COST_UNVERIFIABLE');
  const descriptor = openSync(file, 'r'), chunks = []; let total = 0;
  try {
    while (true) {
      const chunk = Buffer.alloc(64 * 1024), length = readSync(descriptor, chunk, 0, chunk.length, total);
      if (!length) break; total += length;
      if (total > maxBytes || total > before.size) fail('COST_UNVERIFIABLE');
      chunks.push(chunk.subarray(0, length));
    }
    const after = fstatSync(descriptor);
    if (total !== before.size || after.size !== before.size || after.ino !== before.ino || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) fail('COST_UNVERIFIABLE');
    return Buffer.concat(chunks, total);
  } finally { closeSync(descriptor); }
}
function validateProof(proof, clock) {
  exact(proof, ['schemaVersion', 'kind', 'reviewId', 'checkedAt', 'expiresAt', 'account', 'operations', 'approvedSources', 'conversion', 'supportProfile', 'origins', 'observations', 'verifier', 'authorization']);
  if (proof.schemaVersion !== 1 || proof.kind !== 'autodesk-account-operator-review') fail('COST_UNVERIFIABLE');
  validateId(proof.reviewId);
  const checked = instant(proof.checkedAt), expires = instant(proof.expiresAt), now = clock.now();
  if (![checked, expires, now].every(Number.isSafeInteger) || checked > now || expires <= checked || expires - checked > 30 * 60000 || now >= expires) fail('COST_EXPIRED');
  exact(proof.account, ['applicationHash', 'teamHash', 'hubHash', 'offering', 'paidFallback', 'regionHash', 'bucketHash']);
  if (['applicationHash', 'teamHash', 'hubHash', 'regionHash', 'bucketHash'].some(key => !SHA.test(proof.account[key] ?? ''))) fail('COST_UNVERIFIABLE');
  if (proof.account.offering !== 'Free' || proof.account.paidFallback !== false) fail('COST_NONZERO');
  exact(proof.operations, ['storage', 'upload', 'submit', 'read']);
  for (const operation of ['storage', 'upload', 'submit']) {
    exact(proof.operations[operation], ['zero', 'count', ...(operation === 'upload' ? ['maxBytes'] : operation === 'submit' ? ['complexJobsRemaining'] : [])]);
    if (proof.operations[operation].zero !== true || !count(proof.operations[operation].count)) fail('COST_UNKNOWN');
  }
  if (!count(proof.operations.upload.maxBytes) || proof.operations.upload.maxBytes > 2 * 1024 ** 3 || !count(proof.operations.submit.complexJobsRemaining)) fail('COST_QUOTA');
  exact(proof.operations.read, ['zero', 'maxCalls', 'remainingConservative']);
  if (proof.operations.read.zero !== true || !count(proof.operations.read.maxCalls) || proof.operations.read.maxCalls < 1 || proof.operations.read.maxCalls > 2000 || !count(proof.operations.read.remainingConservative) || proof.operations.read.remainingConservative < proof.operations.read.maxCalls) fail('COST_QUOTA');
  if (!Array.isArray(proof.approvedSources) || proof.approvedSources.length < 1 || proof.approvedSources.length > 100) fail('COST_UNVERIFIABLE');
  const sources = new Set();
  for (const source of proof.approvedSources) { exact(source, ['name', 'bytes', 'sha256']); validateSourceName(source.name); if (!count(source.bytes) || source.bytes < 1 || !SHA.test(source.sha256 ?? '') || sources.has(canonical(source))) fail('COST_UNVERIFIABLE'); sources.add(canonical(source)); }
  exact(proof.conversion, ['format', 'views', 'xAdsForce']);
  if (proof.conversion.format !== 'svf' || canonical(proof.conversion.views) !== '["3d"]' || proof.conversion.xAdsForce !== false || proof.supportProfile !== PROFILE) fail('COST_IDENTITY_MISMATCH');
  if (!Array.isArray(proof.origins) || !proof.origins.length || proof.origins.length > 20 || proof.origins.some(value => {
    try { const url = new URL(value); return url.protocol !== 'https:' || url.username || url.password || url.search || !/^(?:[a-z0-9-]+\.)*autodesk\.com$/.test(url.hostname); } catch { return true; }
  })) fail('COST_UNVERIFIABLE');
  exact(proof.observations, ['artifacts', 'basicCallsObserved', 'complexJobsObserved', 'complexChargedUnitsAvailable', 'complexJobsPerChargedUnit', 'basicCallsPerChargedUnit', 'nextRefresh', 'readAllowanceDerivation']);
  for (const key of ['basicCallsObserved', 'complexJobsObserved', 'complexChargedUnitsAvailable', 'complexJobsPerChargedUnit', 'basicCallsPerChargedUnit']) if (!count(proof.observations[key])) fail('COST_UNVERIFIABLE');
  if (proof.operations.read.remainingConservative !== proof.observations.basicCallsPerChargedUnit - proof.observations.basicCallsObserved || proof.operations.submit.complexJobsRemaining !== proof.observations.complexChargedUnitsAvailable * proof.observations.complexJobsPerChargedUnit || !/^\d{4}-\d{2}-\d{2}$/.test(proof.observations.nextRefresh ?? '') || typeof proof.observations.readAllowanceDerivation !== 'string' || proof.observations.readAllowanceDerivation.length > 300) fail('COST_UNVERIFIABLE');
  exact(proof.verifier, ['method', 'actor', 'bindingMatches']);
  if (proof.verifier.method !== 'authenticated-browser-review' || proof.verifier.actor !== 'authorized-operator' || proof.verifier.bindingMatches !== true) fail('COST_UNVERIFIABLE');
  exact(proof.authorization, ['explicitUserAuthorized', 'confirmedAt']);
  const authorized = instant(proof.authorization.confirmedAt);
  if (proof.authorization.explicitUserAuthorized !== true || !Number.isSafeInteger(authorized) || authorized > now || authorized >= expires) fail('COST_UNVERIFIABLE');
  return proof;
}
function bind(proof, context) {
  if (!context?.source || !context.namespace || !context.destination || !context.conversion || !proof.approvedSources.some(source => source.name === context.source.name && source.bytes === context.source.bytes && source.sha256 === context.source.sha256) ||
      context.namespace.account !== `team-${proof.account.teamHash}` || context.namespace.application !== `app-${proof.account.applicationHash}` || context.destination.bucket !== `target-${proof.account.bucketHash}` || hash(context.region) !== proof.account.regionHash || canonical(context.conversion) !== canonical(proof.conversion) || context.supportProfile !== proof.supportProfile) fail('COST_IDENTITY_MISMATCH');
  return costIdentity(context);
}

/** Server-controlled operator proof, private persistent signing key and ledger. */
export async function createAPSCostProvider({ proofPath, proofSha256, signingKeyPath, store, clock = { now: () => Date.now() } } = {}) {
  validateLocalPath(proofPath); validateLocalPath(signingKeyPath);
  if (!SHA.test(proofSha256 ?? '') || !store || typeof store.withLock !== 'function' || typeof store.write !== 'function') fail('CONFIGURATION_INVALID');
  let ancestor = path.dirname(signingKeyPath);
  while (true) { try { linkFree(ancestor, true); break; } catch (error) { if (error.code !== 'ENOENT') throw error; const parent = path.dirname(ancestor); if (parent === ancestor) throw error; ancestor = parent; } }
  await fs.mkdir(path.dirname(signingKeyPath), { recursive: true, mode: 0o700 }); linkFree(path.dirname(signingKeyPath), true);
  try {
    const handle = await fs.open(signingKeyPath, 'wx', 0o600);
    try { await handle.writeFile(randomBytes(32)); await handle.sync(); } finally { await handle.close(); }
  } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const signingKey = boundedFile(signingKeyPath, 32);
  if (signingKey.length !== 32 || (process.platform !== 'win32' && (lstatSync(signingKeyPath).mode & 0o077))) fail('COST_UNVERIFIABLE');
  const sign = evidence => { const { attestation, ...payload } = evidence; return createHmac('sha256', signingKey).update(canonical({ domain: DOMAIN, evidence: payload })).digest('hex'); };
  function loadProof() {
    const bytes = boundedFile(proofPath, 256 * 1024);
    if (hash(bytes) !== proofSha256) fail('COST_UNVERIFIABLE');
    let proof;
    try { proof = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)); } catch { fail('COST_UNVERIFIABLE'); }
    validateProof(proof, clock);
    if (!Array.isArray(proof.observations.artifacts) || !proof.observations.artifacts.length || proof.observations.artifacts.length > 16) fail('COST_UNVERIFIABLE');
    const names = new Set(); let total = 0;
    for (const artifact of proof.observations.artifacts) {
      exact(artifact, ['name', 'sha256', 'bytes']);
      if (typeof artifact.name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}\.(?:json|txt|png)$/.test(artifact.name) || names.has(artifact.name) || !SHA.test(artifact.sha256 ?? '') || !count(artifact.bytes) || artifact.bytes > 16 * 1024 ** 2) fail('COST_UNVERIFIABLE');
      names.add(artifact.name); total += artifact.bytes; if (total > 64 * 1024 ** 2) fail('COST_UNVERIFIABLE');
      const content = boundedFile(path.join(path.dirname(proofPath), artifact.name), 16 * 1024 ** 2);
      if (content.length !== artifact.bytes || hash(content) !== artifact.sha256) fail('COST_UNVERIFIABLE');
    }
    const currentKey = boundedFile(signingKeyPath, 32);
    if (currentKey.length !== signingKey.length || !timingSafeEqual(currentKey, signingKey)) fail('COST_UNVERIFIABLE');
    return proof;
  }
  function evidenceFor(proof, context) {
    const identity = bind(proof, context);
    const evidence = { schemaVersion: 1, evidenceId: digest({ issuer: ISSUER, proofSha256, identity }), kind: 'aps-operator', issuer: ISSUER, identity,
      checkedAt: proof.checkedAt, expiresAt: proof.expiresAt, status: 'zero', price: { amount: 0, currency: 'USD', basis: 'operator-verified-autodesk-free-allowance' },
      origin: { kind: 'operator-verified-autodesk-account', reference: proofSha256 },
      allowances: { storage: { count: proof.operations.storage.count, quotaRemaining: proof.operations.storage.count }, upload: { count: proof.operations.upload.count, quotaRemaining: proof.operations.upload.count }, submit: { count: proof.operations.submit.count, quotaRemaining: proof.operations.submit.complexJobsRemaining } }, uploadBytes: proof.operations.upload.maxBytes };
    evidence.attestation = sign(evidence); return evidence;
  }
  function getReadiness() {
    try { const proof = loadProof(); return { state: 'verified', checkedAt: proof.checkedAt, expiresAt: proof.expiresAt }; }
    catch (error) { return { state: 'blocked', code: /^COST_/.test(error.code ?? '') ? error.code : 'COST_UNVERIFIABLE' }; }
  }
  const api = {
    kind: 'aps-operator', mode: 'live', getReadiness,
    async getEvidence(context, { signal } = {}) { abortCheck(signal); try { return clone(evidenceFor(loadProof(), context)); } catch (error) { abortCheck(signal); return null; } },
    verifyEvidence(evidence, context) {
      try {
        const expected = evidenceFor(loadProof(), context);
        if (!evidence || evidence.kind !== 'aps-operator' || evidence.issuer !== ISSUER || evidence.origin?.reference !== proofSha256 || typeof evidence.attestation !== 'string' || !SHA.test(evidence.attestation)) return false;
        const actual = Buffer.from(evidence.attestation, 'hex'), signed = Buffer.from(sign(evidence), 'hex');
        return actual.length === signed.length && timingSafeEqual(actual, signed) && canonical(evidence) === canonical(expected);
      } catch { return false; }
    },
    async reserveMutation(context, operation, { signal, recoverDead = false } = {}) {
      abortCheck(signal); if (!['storage', 'upload', 'submit'].includes(operation)) fail('COST_UNVERIFIABLE');
      bind(loadProof(), context);
      const key = digest({ kind: 'aps-mutation-budget', proofSha256 });
      await store.withLock('cost', key, async lease => {
        const proof = loadProof(); bind(proof, context);
        const current = await store.read('cost', key);
        if (current) {
          exact(current, ['schemaVersion', 'kind', 'proofSha256', 'counts'], 'STORE_CORRUPT'); exact(current.counts, ['storage', 'upload', 'submit'], 'STORE_CORRUPT');
          if (current.schemaVersion !== 1 || current.kind !== 'aps-mutation-budget' || current.proofSha256 !== proofSha256 || Object.values(current.counts).some(value => !count(value))) fail('STORE_CORRUPT');
        }
        const counts = current?.counts ?? { storage: 0, upload: 0, submit: 0 };
        const maximum = Math.min(proof.operations[operation].count, operation === 'submit' ? proof.operations.submit.complexJobsRemaining : proof.operations[operation].count);
        if (counts[operation] >= maximum || (operation === 'upload' && context.source.bytes > proof.operations.upload.maxBytes)) fail('COST_QUOTA');
        counts[operation]++;
        await store.write('cost', key, { schemaVersion: 1, kind: 'aps-mutation-budget', proofSha256, counts }, { lease, signal });
        bind(loadProof(), context); abortCheck(signal);
      }, { signal, recoverDead });
    },
    async reserveRead(context, { signal, recoverDead = false } = {}) {
      abortCheck(signal); const proof = loadProof(); bind(proof, context);
      const key = digest({ kind: 'aps-read-budget', proofSha256 });
      await store.withLock('cost', key, async lease => {
        const currentProof = loadProof(); bind(currentProof, context);
        const current = await store.read('cost', key);
        if (current) { exact(current, ['schemaVersion', 'kind', 'proofSha256', 'used', 'maxCalls'], 'STORE_CORRUPT'); if (current.schemaVersion !== 1 || current.kind !== 'aps-read-budget' || current.proofSha256 !== proofSha256 || !count(current.used) || current.maxCalls !== currentProof.operations.read.maxCalls) fail('STORE_CORRUPT'); }
        const used = current?.used ?? 0; if (used >= currentProof.operations.read.maxCalls) fail('READ_LIMIT');
        await store.write('cost', key, { schemaVersion: 1, kind: 'aps-read-budget', proofSha256, used: used + 1, maxCalls: currentProof.operations.read.maxCalls }, { lease, signal });
        // Awaited durable reservation comes before each API read. Expiry after
        // a slow commit blocks the call and conservatively retains the slot.
        bind(loadProof(), context); abortCheck(signal);
      }, { signal, recoverDead });
    },
  };
  brandAPSCostProvider(api); return Object.freeze(api);
}
