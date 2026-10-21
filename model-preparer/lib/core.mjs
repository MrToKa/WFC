import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createStore } from './store.mjs';
import { createPackageAdapter } from './package-adapter.mjs';
import { createClosedProvider, createClosedCostProvider, isFakeProvider, isFakeCostProvider } from './providers.mjs';
import { evaluateCostEvidence } from './cost.mjs';
import { isAPSProvider, isAPSCostProvider } from './aps-capabilities.mjs';
import { CoreError, fail, clone, freeze, digest, plain, identifier, abortCheck, nowIso, validateId, validateJobSpec, contextFromSpec, validateStoredJob, validateReceipt, validateAPSProviderReceipt, validateManifestObservation, safeError, validateLocalPath } from './contracts.mjs';

const systemClock = { now: () => Date.now(), sleep: (ms, signal) => delay(ms, undefined, { signal }) };

export async function createModelPreparer({ dataDirectory, workDirectory, provider = createClosedProvider(), costProvider = createClosedCostProvider(), clock = systemClock, packageAdapter, packageModulePath, packageApi, store: suppliedStore, readPolicy = {}, fault = async () => {} } = {}) {
  if (Number(process.versions.node.split('.')[0]) !== 24) fail('CONFIGURATION_INVALID', 'Node.js 24 is required.');
  const store = suppliedStore || createStore({ dataDirectory, workDirectory, clock });
  await store.init();
  const adapter = packageAdapter || await createPackageAdapter({ packageModulePath, packageApi, workDirectory, clock });
  const active = new Map();
  const policy = { maxAttempts: 3, maxMs: 5000, backoffMs: 20, maxPolls: 5, ...readPolicy };
  if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1 || policy.maxAttempts > 5 || !Number.isInteger(policy.maxMs) || policy.maxMs < 1 || policy.maxMs > 60000 || !Number.isInteger(policy.maxPolls) || policy.maxPolls < 1 || policy.maxPolls > 20 || !Number.isInteger(policy.backoffMs) || policy.backoffMs < 0 || policy.backoffMs > 1000) fail('CONFIGURATION_INVALID');

  const matchedCapabilities = () => (isFakeProvider(provider) && isFakeCostProvider(costProvider)) || (isAPSProvider(provider) && isAPSCostProvider(costProvider));
  function cloudLikeAllowed() { if (!matchedCapabilities()) fail('CLOUD_CLOSED'); }
  function checkedReceipt(value, context) {
    validateReceipt(value, context);
    if (isAPSProvider(provider) && value.identityBasis !== 'aps-sha1-and-local-sha256') fail('PROVIDER_RESPONSE_INVALID');
    return value;
  }
  const uploadProof = value => value.identityBasis ? { identityBasis: value.identityBasis, remoteSha1: value.remoteSha1, localSha1: value.localSha1, remoteObjectIdHash: value.remoteObjectIdHash } : {};
  async function getJob(id) { validateId(id); const job = await store.read('job', id); if (!job) fail('JOB_MISSING'); return validateStoredJob(job); }
  async function save(job, lease, event, signal) {
    abortCheck(signal);
    job.updatedAt = nowIso(clock);
    if (event) job.history.push({ at: job.updatedAt, event });
    validateStoredJob(job);
    return store.write('job', job.jobId, job, { lease, signal });
  }
  function captured(job) { if (job.kind !== 'captured') fail('JOB_NOT_CAPTURED'); return freeze(job.frozen); }
  function newLedger(context) { return { schemaVersion: 1, ...(isAPSProvider(provider) ? { providerFamily: 'aps' } : isFakeProvider(provider) ? { providerFamily: 'fake' } : {}), submissionIdentity: context.submissionIdentity, remoteTargetIdentity: context.remoteTargetIdentity, binding: digest({ source: { bytes: context.source.bytes, sha256: context.source.sha256 }, namespace: context.namespace, region: context.region, destination: context.destination, conversion: context.conversion, supportProfile: context.supportProfile }), phase: 'none', upload: null, attempts: [], acknowledgements: [], observations: [] }; }
  function validateLedger(ledger, context) {
    plain(ledger, ['schemaVersion', 'providerFamily', 'submissionIdentity', 'remoteTargetIdentity', 'binding', 'phase', 'upload', 'attempts', 'acknowledgements', 'observations'], 'STORE_CORRUPT');
    if (ledger.providerFamily !== undefined && !['fake', 'aps'].includes(ledger.providerFamily)) fail('STORE_CORRUPT');
    if (isAPSProvider(provider) && ledger.providerFamily !== 'aps') fail('CLOUD_CLOSED');
    if (isFakeProvider(provider) && ledger.providerFamily === 'aps') fail('CLOUD_CLOSED');
    if (ledger.schemaVersion !== 1 || ledger.submissionIdentity !== context.submissionIdentity || ledger.remoteTargetIdentity !== context.remoteTargetIdentity || ledger.binding !== newLedger(context).binding || !['none', 'submission-unknown', 'submitted', 'observed', 'complete', 'failed'].includes(ledger.phase) || !Array.isArray(ledger.attempts) || !Array.isArray(ledger.acknowledgements) || !Array.isArray(ledger.observations) || ledger.attempts.length > 1) fail('STORE_CORRUPT');
    if (ledger.attempts.length && ledger.phase === 'none') fail('STORE_CORRUPT');
    for (const attempt of ledger.attempts) {
      plain(attempt, ['attemptId', 'at', 'intent', 'evidenceId'], 'STORE_CORRUPT');
      validateId(attempt.attemptId);
      if (digest(attempt.intent) !== digest(submitIntent(context))) fail('STORE_CORRUPT');
      identifier(attempt.evidenceId, 'STORE_CORRUPT');
    }
    for (const receipt of ledger.acknowledgements) {
      plain(receipt, ['at', 'attemptId', 'providerJobId', 'providerReceipt', 'kind'], 'STORE_CORRUPT');
      if (receipt.providerReceipt !== undefined) { if (ledger.providerFamily !== 'aps') fail('STORE_CORRUPT'); validateAPSProviderReceipt(receipt.providerReceipt, 'STORE_CORRUPT'); }
      else identifier(receipt.providerJobId, 'STORE_CORRUPT');
    }
    return ledger;
  }
  function submitIntent(context) { return { submissionIdentity: context.submissionIdentity, objectId: context.objectId, urn: context.urn, source: { bytes: context.source.bytes, sha256: context.source.sha256 }, namespace: context.namespace, region: context.region, destination: context.destination, conversion: context.conversion, supportProfile: context.supportProfile, retries: 0, xAdsForce: false }; }
  async function ledgerFor(context) { const existing = await store.read('submission', context.submissionIdentity); return existing ? validateLedger(existing, context) : newLedger(context); }
  function projection(job, ledger) { job.submission = clone(ledger); if (ledger.upload) job.upload = clone(ledger.upload); }
  async function readOperation(name, context, signal, extra = {}) {
    const start = clock.now();
    for (let attempt = 0; attempt < policy.maxAttempts; attempt++) {
      abortCheck(signal);
      if (clock.now() - start >= policy.maxMs) fail('READ_LIMIT');
      try {
        const readController = new AbortController();
        const readSignal = signal ? AbortSignal.any([signal, readController.signal]) : readController.signal;
        let timer;
        let response;
        try {
          response = await Promise.race([
            provider[name](context, { signal: readSignal, ...extra }),
            new Promise((_, reject) => { timer = setTimeout(() => { readController.abort(); reject(new CoreError('READ_LIMIT')); }, Math.max(1, policy.maxMs - (clock.now() - start))); }),
          ]);
        } finally { clearTimeout(timer); }
        abortCheck(signal);
        if (clock.now() - start > policy.maxMs) fail('READ_LIMIT');
        return response;
      } catch (error) {
        abortCheck(signal);
        // Only explicitly classified safe reads retry; POST/upload never pass here.
        if (error instanceof CoreError || error?.retryable !== true || attempt + 1 >= policy.maxAttempts) throw error;
        const ms = Math.min(policy.backoffMs * (2 ** attempt), policy.maxMs - (clock.now() - start));
        if (ms <= 0) fail('READ_LIMIT');
        if (clock.sleep) await clock.sleep(ms, signal); else await delay(ms, undefined, { signal });
      }
    }
    fail('READ_LIMIT');
  }
  async function reserveCost(job, operation, signal, recoverDead = false) {
    const context = job.frozen;
    const evidence = job.costEvidence;
    const verified = matchedCapabilities() && await costProvider.verifyEvidence(evidence, context);
    const key = digest({ evidenceId: evidence?.evidenceId || 'missing', submissionIdentity: context.submissionIdentity });
    return store.withLock('cost', key, async lease => {
      const existing = await store.read('cost', key);
      if (existing) {
        plain(existing, ['schemaVersion', 'evidenceId', 'submissionIdentity', 'counts'], 'STORE_CORRUPT');
        if (existing.schemaVersion !== 1 || existing.evidenceId !== evidence?.evidenceId || existing.submissionIdentity !== context.submissionIdentity) fail('STORE_CORRUPT');
        plain(existing.counts, ['storage', 'upload', 'submit'], 'STORE_CORRUPT');
        if (Object.values(existing.counts).some(n => !Number.isSafeInteger(n) || n < 0)) fail('STORE_CORRUPT');
      }
      const decision = evaluateCostEvidence({ evidence, context, operation, now: clock.now(), consumed: existing?.counts?.[operation] || 0, verified });
      job.costDecision = clone(decision);
      if (!decision.allowed) fail('COST_BLOCKED');
      if (isAPSCostProvider(costProvider)) await costProvider.reserveMutation(context, operation, { signal, recoverDead });
      const usage = existing || { schemaVersion: 1, evidenceId: evidence.evidenceId, submissionIdentity: context.submissionIdentity, counts: { storage: 0, upload: 0, submit: 0 } };
      usage.counts[operation]++;
      // A lost outcome retains the durable reservation. Fresh approval cannot erase attempts.
      await store.write('cost', key, usage, { lease, signal });
      return { evidenceId: evidence.evidenceId, consumedBefore: usage.counts[operation] - 1 };
    }, { signal, recoverDead });
  }
  function finalCostCheck(job, operation, reservation, signal) {
    abortCheck(signal);
    const evidence = job.costEvidence;
    const verified = matchedCapabilities() && costProvider.verifyEvidence(evidence, job.frozen) === true;
    const decision = evaluateCostEvidence({ evidence, context: job.frozen, operation, now: clock.now(), consumed: reservation.consumedBefore, verified });
    job.costDecision = clone(decision);
    if (evidence?.evidenceId !== reservation.evidenceId || !decision.allowed) fail('COST_BLOCKED');
    // No asynchronous work may separate this final check from its mutation call.
  }
  async function operation(id, action, { signal, recoverDead = false } = {}) {
    validateId(id);
    const controller = new AbortController();
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const token = randomUUID();
    if (!active.has(id)) active.set(id, new Map());
    active.get(id).set(token, controller);
    try {
      return await store.withLock('job', id, async lease => {
        const job = await getJob(id);
        try { return await action(job, lease, combined); }
        catch (error) {
          const context = job.kind === 'captured' ? job.frozen : null;
          // Rebuild lagging job projection from the authoritative shared WAL after crashes.
          if (context) { const ledger = await ledgerFor(context); projection(job, ledger); }
          const safe = safeError(combined.aborted ? new CoreError('LOCAL_ABORTED') : error);
          job.error = safe;
          if (combined.aborted) { job.status = 'interrupted'; job.interruption = { at: nowIso(clock), localOnly: true, remoteCancellationConfirmed: false }; }
          else if (safe.code === 'COST_BLOCKED') job.status = 'cost-blocked';
          else if (job.submission?.phase === 'submission-unknown' && safe.code !== 'DERIVATIVE_FAILED') job.status = 'submission-unknown';
          else job.status = 'failed';
          // This is a local terminal observation; it is written without the aborted signal.
          await save(job, lease, 'operation-stopped', undefined);
          throw new CoreError(safe.code, safe.message);
        }
      }, { signal: combined, recoverDead });
    } finally {
      active.get(id)?.delete(token); if (!active.get(id)?.size) active.delete(id);
    }
  }

  async function captureJob(spec, { signal } = {}) {
    validateJobSpec(spec);
    spec = freeze(clone(spec));
    validateJobSpec(spec);
    const id = spec.jobId || randomUUID();
    if (await store.read('job', id)) fail('JOB_EXISTS');
    // Capture has its own job lease. An orphan capture is never promoted automatically.
    const source = await store.captureSource(id, spec.sourcePath, { signal });
    const frozen = contextFromSpec(spec, source);
    return store.withLock('job', id, async lease => {
      if (await store.read('job', id)) fail('JOB_EXISTS');
      const at = nowIso(clock);
      const job = { schemaVersion: 1, jobId: id, kind: 'captured', createdAt: at, updatedAt: at, frozen, frozenDigest: digest(frozen), status: 'captured', costEvidence: null, costDecision: null, upload: null, submission: null, download: null, package: null, lastGoodPackage: null, history: [{ at, event: 'captured' }], error: null, interruption: null };
      validateStoredJob(job);
      return store.write('job', id, job, { lease, signal });
    }, { signal });
  }
  async function approveCost(id, options) {
    return operation(id, async (job, lease, signal) => {
      const context = captured(job);
      // Preserve historical local fake approval with a closed provider. Its
      // grant still cannot pass prepare's matched capability boundary.
      if (!(isFakeCostProvider(costProvider) && !isAPSProvider(provider)) && !(isAPSCostProvider(costProvider) && isAPSProvider(provider))) fail('CLOUD_CLOSED');
      const evidence = await costProvider.getEvidence(context, { signal });
      const verified = await costProvider.verifyEvidence(evidence, context);
      const decision = evaluateCostEvidence({ evidence, context, operation: 'submit', now: clock.now(), consumed: 0, verified });
      job.costDecision = clone(decision);
      // Invalid/unverified provider payloads are never copied into durable state.
      if (decision.allowed) { job.costEvidence = clone(evidence); job.error = null; if (job.status === 'cost-blocked') job.status = job.upload?.status === 'uploaded' ? 'uploaded' : 'captured'; }
      else { job.costEvidence = null; job.status = 'cost-blocked'; job.error = { code: 'COST_BLOCKED', message: 'Current verifiable zero-cost evidence is required.' }; }
      await save(job, lease, 'cost-reviewed', signal);
      return clone(decision);
    }, options);
  }
  async function prepare(id, options) {
    return operation(id, async (job, jobLease, signal) => {
      const context = captured(job); cloudLikeAllowed();
      await store.verifySnapshot(context.source, { signal });
      return store.withLock('target', context.remoteTargetIdentity, async targetLease => {
        const target = await store.read('target', context.remoteTargetIdentity);
        const sourceBinding = digest({ bytes: context.source.bytes, sha256: context.source.sha256 });
        if (target) { plain(target, ['schemaVersion', 'sourceBinding', 'remoteTargetIdentity'], 'STORE_CORRUPT'); if (target.schemaVersion !== 1 || target.remoteTargetIdentity !== context.remoteTargetIdentity) fail('STORE_CORRUPT'); if (target.sourceBinding !== sourceBinding) fail('IDENTITY_MISMATCH'); }
        else await store.write('target', context.remoteTargetIdentity, { schemaVersion: 1, sourceBinding, remoteTargetIdentity: context.remoteTargetIdentity }, { lease: targetLease, signal });
        return store.withLock('submission', context.submissionIdentity, async submissionLease => {
          let ledger = await ledgerFor(context);
          projection(job, ledger);
          if (ledger.phase === 'submission-unknown') fail('SUBMISSION_UNKNOWN');
          if (ledger.phase === 'failed') fail('DERIVATIVE_FAILED');
          if (ledger.phase !== 'none') {
            job.status = job.package?.status === 'PASS' ? 'packaged' : job.download?.status === 'downloaded' ? 'downloaded' : 'submitted'; job.error = null;
            await save(job, jobLease, 'submission-reused', signal);
            return clone(job);
          }
          const storage = await readOperation('getStorage', context, signal, { recoverDead: options?.recoverDead });
          if (storage) { plain(storage, ['bucket', 'namespace', 'region'], 'PROVIDER_RESPONSE_INVALID'); if (storage.bucket !== context.destination.bucket || digest(storage.namespace) !== digest(context.namespace) || storage.region !== context.region) fail('IDENTITY_MISMATCH'); }
          else {
            const reservation = await reserveCost(job, 'storage', signal, options?.recoverDead);
            await save(job, jobLease, 'storage-intent', signal);
            await fault('afterStorageIntent', { jobId: id, submissionIdentity: context.submissionIdentity });
            finalCostCheck(job, 'storage', reservation, signal);
            const created = await provider.createStorage(context, { signal, retries: 0, assertMutationAllowed: () => finalCostCheck(job, 'storage', reservation, signal) });
            plain(created, ['bucket', 'namespace', 'region'], 'PROVIDER_RESPONSE_INVALID');
            if (created.bucket !== context.destination.bucket || digest(created.namespace) !== digest(context.namespace) || created.region !== context.region) fail('IDENTITY_MISMATCH');
          }
          let object = await readOperation('getObject', context, signal, { recoverDead: options?.recoverDead });
          if (object) checkedReceipt(object, context);
          const manifest = validateManifestObservation(await readOperation('getManifest', context, signal, { recoverDead: options?.recoverDead }), context);
          if (manifest.status !== 'not-found') {
            if (!object) fail('IDENTITY_MISMATCH');
            ledger.phase = manifest.status === 'success' ? 'complete' : manifest.status === 'failed' ? 'failed' : 'observed';
            ledger.upload = { status: 'uploaded', objectId: object.objectId, bytes: object.bytes, sha256: object.sha256, ...uploadProof(object), reused: true, at: nowIso(clock) };
            ledger.observations.push({ at: nowIso(clock), ...manifest });
            await store.write('submission', context.submissionIdentity, ledger, { lease: submissionLease, signal });
            projection(job, ledger); job.status = manifest.status === 'failed' ? 'failed' : 'submitted';
            await save(job, jobLease, 'derivative-reused', signal);
            if (manifest.status === 'failed') fail('DERIVATIVE_FAILED');
            return clone(job);
          }
          if (!object) {
            const reservation = await reserveCost(job, 'upload', signal, options?.recoverDead);
            ledger.upload = { status: 'uploading', objectId: context.objectId, bytes: context.source.bytes, sha256: context.source.sha256, reused: false, at: nowIso(clock) };
            await store.write('submission', context.submissionIdentity, ledger, { lease: submissionLease, signal });
            projection(job, ledger); job.status = 'uploading'; await save(job, jobLease, 'upload-intent', signal);
            await store.verifySnapshot(context.source, { signal });
            await fault('afterUploadIntent', { jobId: id, submissionIdentity: context.submissionIdentity });
            finalCostCheck(job, 'upload', reservation, signal);
            object = await provider.upload(context, { sourcePath: context.source.snapshotPath, signal, retries: 0, assertMutationAllowed: () => finalCostCheck(job, 'upload', reservation, signal) });
            checkedReceipt(object, context);
            await store.verifySnapshot(context.source, { signal });
          }
          ledger.upload = { status: 'uploaded', objectId: object.objectId, bytes: object.bytes, sha256: object.sha256, ...uploadProof(object), reused: job.upload?.reused ?? true, at: nowIso(clock) };
          await store.write('submission', context.submissionIdentity, ledger, { lease: submissionLease, signal });
          projection(job, ledger); job.status = 'uploaded'; job.error = null;
          await save(job, jobLease, 'upload-confirmed', signal);
          const reservation = await reserveCost(job, 'submit', signal, options?.recoverDead);
          await fault('beforeSubmitIntent', { jobId: id, submissionIdentity: context.submissionIdentity });
          const attempt = { attemptId: randomUUID(), at: nowIso(clock), intent: submitIntent(context), evidenceId: reservation.evidenceId };
          ledger.attempts.push(attempt); ledger.phase = 'submission-unknown';
          await store.write('submission', context.submissionIdentity, ledger, { lease: submissionLease, signal });
          await fault('afterSubmitIntent', { jobId: id, submissionIdentity: context.submissionIdentity });
          projection(job, ledger); job.status = 'submission-unknown';
          await save(job, jobLease, 'submission-intent', signal);
          finalCostCheck(job, 'submit', reservation, signal);
          const response = await provider.submit(context, { attemptId: attempt.attemptId, signal, retries: 0, xAdsForce: false, assertMutationAllowed: () => finalCostCheck(job, 'submit', reservation, signal) });
          plain(response, ['result', 'objectId', 'urn', 'providerJobId', 'providerReceipt', 'submissionIdentity'], 'PROVIDER_RESPONSE_INVALID');
          if (!['success', 'created'].includes(response.result) || response.objectId !== context.objectId || response.urn !== context.urn || response.submissionIdentity !== context.submissionIdentity) fail('IDENTITY_MISMATCH');
          if (isAPSProvider(provider)) {
            validateAPSProviderReceipt(response.providerReceipt);
            if (response.providerJobId !== undefined) identifier(response.providerJobId, 'PROVIDER_RESPONSE_INVALID');
          } else {
            if (response.providerReceipt !== undefined) fail('PROVIDER_RESPONSE_INVALID');
            identifier(response.providerJobId, 'PROVIDER_RESPONSE_INVALID');
          }
          await fault('afterSubmitResponse', { jobId: id, submissionIdentity: context.submissionIdentity });
          abortCheck(signal);
          ledger.acknowledgements.push({ at: nowIso(clock), attemptId: attempt.attemptId, ...(response.providerJobId !== undefined ? { providerJobId: response.providerJobId } : {}), ...(response.providerReceipt !== undefined ? { providerReceipt: clone(response.providerReceipt) } : {}), kind: 'submit-response' }); ledger.phase = 'submitted';
          await store.write('submission', context.submissionIdentity, ledger, { lease: submissionLease, signal });
          projection(job, ledger); job.status = 'submitted'; job.error = null;
          await save(job, jobLease, 'submission-confirmed', signal);
          return clone(job);
        }, { signal, recoverDead: options?.recoverDead });
      }, { signal, recoverDead: options?.recoverDead });
    }, options);
  }
  async function reconcile(id, options) {
    return operation(id, async (job, jobLease, signal) => {
      const context = captured(job); cloudLikeAllowed();
      return store.withLock('submission', context.submissionIdentity, async lease => {
        const ledger = await ledgerFor(context);
        const observation = validateManifestObservation(await readOperation('getManifest', context, signal, { recoverDead: options?.recoverDead }), context);
        ledger.observations.push({ at: nowIso(clock), ...observation });
        // 404, pending and elapsed time never erase an unknown write-ahead intent.
        if (observation.status === 'success') ledger.phase = 'complete';
        else if (observation.status === 'failed' && ledger.phase !== 'submission-unknown') ledger.phase = 'failed';
        await store.write('submission', context.submissionIdentity, ledger, { lease, signal });
        projection(job, ledger);
        job.status = observation.status === 'failed' ? 'failed' : ledger.phase === 'submission-unknown' ? 'submission-unknown' : observation.status === 'success' ? 'submitted' : ledger.phase === 'none' ? 'captured' : 'translating';
        job.error = observation.status === 'failed' ? safeError(new CoreError('DERIVATIVE_FAILED')) : null;
        await save(job, jobLease, 'reconciled', signal);
        return clone(job);
      }, { signal, recoverDead: options?.recoverDead });
    }, options);
  }
  async function waitForDerivative(id, options = {}) {
    validateId(id);
    const controller = new AbortController(), token = randomUUID();
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    if (!active.has(id)) active.set(id, new Map());
    active.get(id).set(token, controller);
    const start = clock.now();
    try {
      for (let n = 0; n < policy.maxPolls; n++) {
        abortCheck(signal);
        const job = await reconcile(id, { ...options, signal });
        const last = job.submission?.observations?.at(-1);
        if (last?.status === 'success' || last?.status === 'failed') return job;
        if (clock.now() - start >= policy.maxMs || n + 1 >= policy.maxPolls) fail('READ_LIMIT');
        if (clock.sleep) await clock.sleep(policy.backoffMs, signal); else await delay(policy.backoffMs, undefined, { signal });
      }
      fail('READ_LIMIT');
    } catch (error) {
      if (!signal.aborted) throw error;
      // stop during backoff is still a durable local interruption, not a remote cancellation.
      await store.withLock('job', id, async lease => {
        const job = await getJob(id);
        job.status = 'interrupted'; job.error = safeError(new CoreError('LOCAL_ABORTED'));
        job.interruption = { at: nowIso(clock), localOnly: true, remoteCancellationConfirmed: false };
        await save(job, lease, 'polling-stopped');
      }, { recoverDead: options.recoverDead });
      throw new CoreError('LOCAL_ABORTED');
    } finally {
      active.get(id)?.delete(token); if (!active.get(id)?.size) active.delete(id);
    }
  }
  async function download(id, options = {}) {
    return operation(id, async (job, lease, signal) => {
      captured(job); cloudLikeAllowed();
      const ledger = await ledgerFor(job.frozen); projection(job, ledger);
      if (ledger.phase !== 'complete') fail(ledger.phase === 'failed' ? 'DERIVATIVE_FAILED' : 'DERIVATIVE_PENDING');
      job.status = 'downloading'; await save(job, lease, 'download-started', signal);
      // The adapter's public contract stays unchanged. Carry explicitly asked
      // recovery through its provider read options without enabling it by age.
      const downloadProvider = options.recoverDead ? Object.fromEntries(['getManifest', 'getDownloadPlan', 'readResource'].map(name => [name, (context, readOptions) => provider[name](context, { ...readOptions, recoverDead: true })])) : provider;
      const result = await adapter.download(job, { provider: downloadProvider, rootId: options.rootId, signal, previous: job.download, onCheckpoint: async state => { job.download = clone(state); await save(job, lease, 'download-checkpoint', signal); } });
      job.download = clone(result.download); job.status = 'downloaded'; job.error = null;
      await save(job, lease, 'download-complete', signal);
      return clone(job);
    }, options);
  }
  async function buildPackage(id, options) {
    return operation(id, async (job, lease, signal) => {
      const context = captured(job);
      if (job.download?.status !== 'downloaded' || !job.download.modelDirectory) fail('DOWNLOAD_INCOMPLETE');
      await store.verifySnapshot(context.source, { signal });
      job.status = 'verifying'; await save(job, lease, 'package-started', signal);
      const result = await adapter.buildPackage(job, { modelDirectory: job.download.modelDirectory, signal });
      job.package = clone(result); job.lastGoodPackage = clone(result); job.status = 'packaged'; job.error = null;
      await save(job, lease, 'package-verified', signal);
      return clone(job);
    }, options);
  }
  async function registerPackage({ packagePath, jobId = randomUUID() }, { signal } = {}) {
    validateId(jobId); validateLocalPath(packagePath);
    const result = await adapter.registerPackage(packagePath, { signal });
    return store.withLock('job', jobId, async lease => {
      if (await store.read('job', jobId)) fail('JOB_EXISTS');
      const at = nowIso(clock);
      const frozen = { packagePath: validateLocalPath(packagePath), source: clone(result.manifest.source), label: result.manifest.label };
      const pkg = { path: validateLocalPath(packagePath), bytes: result.package.bytes, sha256: result.package.sha256, packageId: result.package.packageId, contentFingerprint: result.contentFingerprint, resourceCount: result.resourceCount, totalRawBytes: result.totalRawBytes, sourceIdentityBasis: result.manifest.source.identityBasis };
      const job = { schemaVersion: 1, jobId, kind: 'registered', createdAt: at, updatedAt: at, frozen, frozenDigest: digest(frozen), status: 'registered', costEvidence: null, costDecision: null, upload: null, submission: null, download: null, package: pkg, lastGoodPackage: pkg, history: [{ at, event: 'existing-package-verified' }], error: null, interruption: null };
      return store.write('job', jobId, validateStoredJob(job), { lease, signal });
    }, { signal });
  }
  return Object.freeze({
    captureJob, approveCost, prepare, reconcile, waitForDerivative, download, buildPackage, registerPackage,
    readJob: async id => clone(await getJob(id)),
    listJobs: async () => (await store.list('job')).map(job => clone(validateStoredJob(job))),
    stop(id) { validateId(id); const requests = active.get(id); if (requests) for (const controller of requests.values()) controller.abort(); return { localAbortRequested: !!requests?.size, remoteCancellationConfirmed: false }; },
  });
}
