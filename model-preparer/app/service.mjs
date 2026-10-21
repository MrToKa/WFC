import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID, randomBytes, timingSafeEqual } from 'node:crypto';
import { createModelPreparer, createFakeProvider, createFakeCostProvider, createClosedProvider, createClosedCostProvider } from '../index.mjs';
import * as CoreAPI from '../index.mjs';
import { readConfiguration, loadPrivateAPSConfiguration } from './config.mjs';
import { simulationResources } from './simulation.mjs';
import { bad, safeError, ServiceError, MESSAGES } from './errors.mjs';
import { uuid, canonical, digest, inside, safePath, hashFile, removeOwned, createJournal } from './io.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const MAX_UPLOAD = 2147483648, MAX_JSON = 16384;
const ACTIONS = ['approve-cost', 'prepare', 'reconcile', 'wait', 'download', 'package', 'verify', 'preview'];
const MIME = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
function exact(value, keys) { if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some(k => !keys.includes(k))) bad('INVALID_REQUEST'); return value; }
function label(value) { if (typeof value !== 'string' || value.length < 1 || value.length > 200 || /[\x00-\x1f]|https?:\/\/|(?:bearer|access_token|client_secret)/i.test(value)) bad('INVALID_REQUEST'); return value; }
function filename(value, kind) {
  let name; try { name = decodeURIComponent(value || ''); } catch { bad('UPLOAD_INVALID'); }
  if (name.length > 180 || !/^[A-Za-z0-9][A-Za-z0-9._ -]*\.(nwd|zip)$/i.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) || !name.toLowerCase().endsWith(kind === 'nwd' ? '.nwd' : '.zip')) bad('UPLOAD_INVALID');
  return name;
}
function cleanSegments(url) {
  const raw = url.split('?')[0];
  let decoded; try { decoded = decodeURIComponent(raw); } catch { bad('INVALID_REQUEST'); }
  if (!decoded.startsWith('/') || /[\\\x00-\x1f%]/.test(decoded) || decoded.split('/').some(p => p === '.' || p === '..')) bad('UNSAFE_PATH');
  return decoded;
}
async function jsonBody(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) bad('INVALID_REQUEST');
  let bytes = 0; const chunks = [];
  for await (const chunk of req) { bytes += chunk.length; if (bytes > MAX_JSON) bad('INVALID_REQUEST', 413); chunks.push(chunk); }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); } catch { bad('INVALID_REQUEST'); }
}
function send(res, status, value) { const body = Buffer.from(JSON.stringify(value)); res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' }); res.end(body); }
function timestamp() { return new Date().toISOString(); }
function fileStamp(stat) { return { bytes: stat.size, device: stat.dev, inode: stat.ino, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs }; }
function operationDTO(op) { return { operationId: op.operationId, jobId: op.jobId, type: op.type, status: op.status, phase: op.phase, counts: op.counts || {}, createdAt: op.createdAt, updatedAt: op.updatedAt, error: op.error || null, ...(op.result ? { result: op.result } : {}) }; }
const BROWSER_FIELDS = ['jobId', 'sdkVersion', 'geometryLoaded', 'propertiesLoaded', 'geometryCount', 'propertyCount', 'cspViolationCount', 'externalRequestCount', 'previewStatus'];
function browserFields(value) {
  uuid(value.jobId);
  if (value.sdkVersion !== '7.130.0' || ['geometryLoaded', 'propertiesLoaded'].some(k => typeof value[k] !== 'boolean') || ['geometryCount', 'propertyCount', 'cspViolationCount', 'externalRequestCount'].some(k => !Number.isSafeInteger(value[k]) || value[k] < 0 || value[k] > 100000000) || value.previewStatus !== undefined && !['PASS', 'FAIL'].includes(value.previewStatus)) bad('INVALID_REQUEST');
  return Object.fromEntries(BROWSER_FIELDS.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
}

export async function createPreparerService(options = {}) {
  const configuration = options.configuration || readConfiguration(options.env);
  const config = configuration;
  if (!['closed', 'simulation', 'live'].includes(config.mode)) bad('INVALID_REQUEST');
  const roots = [config.dataDirectory, config.workDirectory, config.outputDirectory];
  if (roots.some((a, i) => roots.some((b, j) => i !== j && inside(a, b)))) bad('UNSAFE_PATH');
  for (const root of roots) await safePath(root, { directory: true, create: true });
  const mode = config.mode, data = path.join(config.dataDirectory, mode), work = path.join(config.workDirectory, mode), output = path.join(config.outputDirectory, mode);
  const coreData = path.join(data, 'core'), serviceData = path.join(data, 'service'), coreWork = path.join(work, 'core-work'), incoming = path.join(work, 'incoming'), previews = path.join(work, 'previews');
  async function refuseRecoveryMarker() { try { await fs.lstat(path.join(coreData, '.docker-recovery.mutex')); bad('LOCK_BUSY', 409); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  for (const directory of [data, work, output, incoming, previews]) await safePath(directory, { directory: true, create: true });
  await safePath(config.packageModulePath);
  const packageApi = await import(pathToFileURL(config.packageModulePath).href);
  if (typeof packageApi.verifyPackage !== 'function') bad('INVALID_REQUEST');
  await refuseRecoveryMarker();
  const journal = await createJournal(serviceData, { instanceId: config.instanceId || null });
  const resources = simulationResources(), acknowledged = new Set();
  let provider = mode === 'simulation' ? createFakeProvider({ resources, handlers: {
    getManifest: async (ctx, _opts, fixture) => {
      if (acknowledged.has(ctx.submissionIdentity)) return { status: 'success', objectId: ctx.objectId, urn: ctx.urn, submissionIdentity: ctx.submissionIdentity, roots: [{ rootId: 'root-0', format: 'svf', supportProfile: ctx.supportProfile }] };
      return fixture.default();
    },
  } }) : createClosedProvider();
  let costProvider = mode === 'simulation' ? createFakeCostProvider() : createClosedCostProvider();
  // Only trusted in-process test callers can supply branded simulation fixtures.
  // Neither environment configuration nor HTTP requests expose these controls.
  if (options.simulationProvider || options.simulationCostProvider) {
    if (mode !== 'simulation' || options.simulationProvider && !CoreAPI.isFakeProvider(options.simulationProvider) || options.simulationCostProvider && !CoreAPI.isFakeCostProvider(options.simulationCostProvider)) { await journal.close(); bad('INVALID_REQUEST'); }
    if (options.simulationProvider) provider = options.simulationProvider;
    if (options.simulationCostProvider) costProvider = options.simulationCostProvider;
  }
  let providerMode = mode === 'simulation' ? 'simulation' : 'closed';
  let liveNamespace = null;
  let liveRegion = null;
  let logicalBucket = null;
  let liveCostState = { state: 'blocked', code: 'LIVE_COST_UNVERIFIED', message: MESSAGES.CLOUD_CLOSED };
  let sharedStore;
  try { sharedStore = CoreAPI.createStore({ dataDirectory: coreData, workDirectory: coreWork, ...(config.instanceId ? { instanceId: config.instanceId } : {}), ...(options.clock ? { clock: options.clock } : {}) }); await sharedStore.init(); await refuseRecoveryMarker(); }
  catch (error) { await journal.close(); throw error; }
  if (mode === 'live' && options.createLiveRuntime) {
    // Trusted server composition only; this is never an HTTP/config callback.
    const runtime = await options.createLiveRuntime({ store: sharedStore, packageApi });
    if (!CoreAPI.isAPSProvider(runtime?.provider) || !CoreAPI.isAPSCostProvider(runtime?.costProvider)
      || !runtime.namespace || !['US', 'EMEA'].includes(runtime.region) || !/^target-[0-9a-f]{64}$/.test(runtime.logicalBucket || '')) {
      await journal.close(); bad('CONFIGURATION_INVALID');
    }
    provider = runtime.provider; costProvider = runtime.costProvider; providerMode = 'live';
    liveNamespace = runtime.namespace; liveRegion = runtime.region; logicalBucket = runtime.logicalBucket;
    liveCostState = costProvider.getReadiness();
  } else if (mode === 'live') {
    try {
      if (typeof CoreAPI.createAPSCostProvider !== 'function' || typeof CoreAPI.createAPSProvider !== 'function' || !config.proofPath || !config.proofSha256 || !config.signingKeyPath) bad('CLOUD_CLOSED', 409);
      await safePath(config.proofPath);
      const proofBytes = await fs.readFile(config.proofPath); if (proofBytes.length > 1024 * 1024 || createHash('sha256').update(proofBytes).digest('hex') !== config.proofSha256) bad('CLOUD_CLOSED', 409);
      const proof = JSON.parse(proofBytes.toString('utf8'));
      if (![proof.account?.applicationHash, proof.account?.teamHash, proof.account?.bucketHash].every(v => /^[0-9a-f]{64}$/.test(v || ''))) bad('CLOUD_CLOSED', 409);
      const credentials = options.privateAPSConfiguration || loadPrivateAPSConfiguration(options.env);
      if (createHash('sha256').update(credentials.clientId || '').digest('hex') !== proof.account.applicationHash || createHash('sha256').update(credentials.bucket || '').digest('hex') !== proof.account.bucketHash || createHash('sha256').update(credentials.region || '').digest('hex') !== proof.account.regionHash || !['EMEA', 'US'].includes(credentials.region) || !credentials.clientSecret) bad('CLOUD_CLOSED', 409);
      liveNamespace = { account: 'team-' + proof.account.teamHash, application: 'app-' + proof.account.applicationHash };
      liveRegion = credentials.region; logicalBucket = 'target-' + proof.account.bucketHash;
      costProvider = await CoreAPI.createAPSCostProvider({ proofPath: config.proofPath, proofSha256: config.proofSha256, signingKeyPath: config.signingKeyPath, store: sharedStore, ...(options.clock ? { clock: options.clock } : {}) });
      provider = await CoreAPI.createAPSProvider({ ...credentials, namespace: liveNamespace, packageApi, authorizeRead: costProvider.reserveRead,
        objectKeysBySource: { '11b2739d92020ee58a52a4e793cf8fd538fb30758eb42176aba93ac7319b048a': 'aalborg-11b2739d92020ee58a52a4e793cf8fd538fb30758eb42176aba93ac7319b048a.nwd' }, reuseOnly: config.liveReuseOnly !== false,
        ...(options.clock ? { clock: options.clock } : {}), ...(options.apsTestTransport ? { testTransport: options.apsTestTransport } : {}) });
      providerMode = 'live';
      const inspect = costProvider.getReadiness || costProvider.readiness || costProvider.inspect;
      if (typeof inspect === 'function') { const result = await inspect.call(costProvider); liveCostState = { state: result.state, code: result.code || 'CURRENT_OPERATOR_PROOF', message: result.state === 'verified' ? 'Current account allowance is verified for the approved source and explicit bounded operations.' : MESSAGES.CLOUD_CLOSED, ...(result.checkedAt ? { checkedAt: result.checkedAt } : {}), ...(result.expiresAt ? { expiresAt: result.expiresAt } : {}) }; }
      else liveCostState = { state: 'ready', code: 'CURRENT_OPERATOR_PROOF', message: 'Current account proof is bound to the approved source; explicit actions remain required.' };
      if (liveCostState.state === 'blocked') { provider = createClosedProvider(); costProvider = createClosedCostProvider(); providerMode = 'closed'; liveNamespace = null; liveRegion = null; logicalBucket = null; }
    } catch {
      provider = createClosedProvider(); costProvider = createClosedCostProvider(); providerMode = 'closed'; liveNamespace = null; liveRegion = null; logicalBucket = null;
      liveCostState = { state: 'blocked', code: 'LIVE_PROOF_INVALID', message: 'Live APS remains closed: current source-bound account proof or configuration is missing, invalid or expired.' };
    }
  }
  let core;
  const startupCloudCalls = providerMode === 'live' ? provider.counts?.totalRequests || 0 : 0;
  try { core = await createModelPreparer({ dataDirectory: coreData, workDirectory: coreWork, packageModulePath: config.packageModulePath, provider, costProvider, ...(sharedStore ? { store: sharedStore } : {}), ...(options.clock ? { clock: options.clock } : {}) }); }
  catch (error) { await journal.close(); throw error; }
  const operations = new Map(), requests = new Map(), uploads = new Map(), artifacts = new Map(), jobs = new Map(), browserObservations = new Map();
  // Immutable preview authority is acquired by full public verification, not
  // reconstructed from an unchecked persisted resource path or job cache.
  const previewCapabilities = new Map(), previewPriming = new Map(), issuedPreviewCapabilities = new WeakSet();
  try {
  for (const op of await journal.list('operations')) {
    if (!op || !['queued', 'running', 'succeeded', 'failed', 'interrupted'].includes(op.status) || !ACTIONS.concat(['capture', 'capture-known', 'register', 'register-known', 'simulation-capture']).includes(op.type)) bad('STORE_CORRUPT', 500);
    uuid(op.operationId); if (op.jobId !== null) uuid(op.jobId);
    if (['queued', 'running'].includes(op.status)) { op.status = 'interrupted'; op.error = { code: 'OPERATION_INTERRUPTED', message: MESSAGES.OPERATION_INTERRUPTED }; op.updatedAt = timestamp(); await journal.write('operations', op.operationId, op); }
    operations.set(op.operationId, op);
  }
  for (const request of await journal.list('requests')) {
    uuid(request.requestId);
    if (request.type === 'upload' && request.status === 'running') { request.status = 'interrupted'; await journal.write('requests', request.requestId, request); }
    requests.set(request.requestId, request);
  }
  for (const upload of await journal.list('uploads')) { uuid(upload.uploadId); filename(encodeURIComponent(upload.name), upload.kind); uploads.set(upload.uploadId, upload); }
  for (const artifact of await journal.list('artifacts')) { uuid(artifact.jobId); artifacts.set(artifact.jobId, artifact); }
  for (const value of await journal.list('browser')) {
    try { exact(value, [...BROWSER_FIELDS, 'mode', 'observedAt', 'basis']); browserFields(value); if (value.basis !== 'client-reported-observation' || !['closed', 'simulation', 'live'].includes(value.mode) || typeof value.observedAt !== 'string' || !Number.isFinite(Date.parse(value.observedAt))) bad('STORE_CORRUPT', 500); }
    catch { bad('STORE_CORRUPT', 500); }
    const previous = browserObservations.get(value.jobId);
    if (!previous || value.observedAt > previous.observedAt || value.observedAt === previous.observedAt && value.previewStatus === 'FAIL') browserObservations.set(value.jobId, { ...browserFields(value), mode: value.mode, observedAt: value.observedAt, basis: value.basis });
  }
  for (const job of await core.listJobs()) {
    jobs.set(job.jobId, job);
    if (mode === 'simulation' && job.kind === 'captured') {
      if (job.upload?.status === 'uploaded') provider.setObject(job.frozen, { objectId: job.frozen.objectId, bytes: job.frozen.source.bytes, sha256: job.frozen.source.sha256 });
      // Rehydrate only acknowledged simulation facts. Unknown WAL remains unknown.
      if (job.submission?.acknowledgements?.length) acknowledged.add(job.frozen.submissionIdentity);
    }
  }
  } catch (error) { await journal.close(); throw error; }
  let sdkAvailable = false;
  if (config.sdkDirectory) { try { await safePath(path.join(config.sdkDirectory, 'viewer3D.min.js')); await safePath(path.join(config.sdkDirectory, 'style.min.css')); sdkAvailable = true; } catch {} }
  try { if (config.importRoot) await safePath(config.importRoot, { directory: true }); if (config.sourceRoot) await safePath(config.sourceRoot, { directory: true }); }
  catch (error) { await journal.close(); throw error; }
  const csrfToken = randomBytes(32).toString('hex');
  let origin = config.publicOrigin, shuttingDown = false, active = null, activeUpload = null, serial = Promise.resolve(), closePromise;
  const sockets = new Set(), readWork = new Set(), shutdownController = new AbortController();
  function serialized(fn) { const next = serial.then(fn); serial = next.catch(() => {}); return next; }
  function providerDiagnostics() {
    const names = ['auth', 'getStorage', 'createStorage', 'getObject', 'getManifest', 'signedResource', 'rawResource', 'initiateUpload', 'uploadPart', 'completeUpload', 'upload', 'submit', 'getDownloadPlan', 'readResource'];
    const counts = Object.fromEntries(names.map(name => [name, Number.isSafeInteger(provider.counts?.[name]) && provider.counts[name] >= 0 ? provider.counts[name] : 0]));
    const requests = (provider.calls || []).filter(row => names.includes(row.operation)).map(row => ({ operation: row.operation,
      ...(providerMode === 'live' ? { method: ['GET', 'HEAD', 'POST', 'PUT'].includes(row.method) ? row.method : null, status: Number.isInteger(row.status) ? row.status : null,
        outcome: ['pending', 'response', 'interrupted', 'failed'].includes(row.outcome) ? row.outcome : 'failed', cloudDataMutation: row.cloudDataMutation === true } : {}) }));
    return { mode: providerMode, scope: 'service-process', requests, counts,
      cloudMutations: providerMode === 'live' ? Number.isSafeInteger(provider.counts?.cloudDataMutations) ? provider.counts.cloudDataMutations : ['createStorage', 'initiateUpload', 'uploadPart', 'completeUpload', 'submit'].reduce((sum, name) => sum + counts[name], 0) : 0, startupCloudCalls };
  }
  function guard(req, mutation) {
    const configured = new URL(origin);
    const ownAddress = server.address();
    const ownPort = typeof ownAddress === 'object' && ownAddress ? ownAddress.port : config.port;
    const hosts = new Set([configured.host, `127.0.0.1:${ownPort}`, `localhost:${ownPort}`, `[::1]:${ownPort}`]);
    if (!hosts.has(req.headers.host)) bad('HOST_DENIED', 403);
    if (req.headers.origin && req.headers.origin !== origin) bad('ORIGIN_DENIED', 403);
    if (req.headers['sec-fetch-site'] === 'cross-site') bad('ORIGIN_DENIED', 403);
    if (!mutation) return;
    if (req.headers.origin !== origin) bad('ORIGIN_DENIED', 403);
    const token = req.headers['x-preparer-token'];
    if (typeof token !== 'string' || token.length !== csrfToken.length || !timingSafeEqual(Buffer.from(token), Buffer.from(csrfToken))) bad('CSRF_DENIED', 403);
    uuid(req.headers['x-request-id']);
    if (shuttingDown) bad('SHUTTING_DOWN', 503);
  }
  async function getJob(id) { uuid(id); const job = await core.readJob(id); jobs.set(id, job); return job; }
  function allowed(job) {
    const list = [];
    if (job.package || job.lastGoodPackage) { list.push('verify'); if (sdkAvailable) list.push('preview'); }
    if (job.kind === 'captured' && job.download?.status === 'downloaded') list.push('package');
    if (job.kind === 'captured' && ['simulation', 'live'].includes(providerMode)) {
      list.push('approve-cost');
      if (!['submission-unknown', 'failed'].includes(job.submission?.phase)) list.push('prepare');
      list.push('reconcile', 'wait');
      if (job.submission?.phase === 'complete') list.push('download');
    }
    return list;
  }
  function jobDTO(job) {
    const pkg = job.package || job.lastGoodPackage;
    const obs = job.submission?.observations?.at(-1);
    return { jobId: job.jobId, label: job.frozen.label, kind: job.kind, mode, providerMode, status: job.status,
      createdAt: job.createdAt, updatedAt: job.updatedAt, error: job.error ? safeError(new ServiceError(job.error.code)) : null,
      roots: (obs?.roots || []).map((root, i) => ({ rootId: root.rootId, label: `3D view ${i + 1}` })),
      facts: {
        source: { name: job.frozen.source.name, bytes: job.frozen.source.bytes, sha256: job.frozen.source.sha256 },
        cost: { allowed: job.costDecision?.allowed === true, code: /^[A-Z][A-Z0-9_]*$/.test(job.costDecision?.code || '') ? job.costDecision.code : null, ...(job.costEvidence?.checkedAt ? { checkedAt: job.costEvidence.checkedAt } : {}), ...(job.costEvidence?.expiresAt ? { expiresAt: job.costEvidence.expiresAt } : {}) },
        upload: job.upload ? { status: job.upload.status } : null,
        submission: job.submission ? { phase: job.submission.phase, attempts: job.submission.attempts.length, reads: job.submission.observations.length } : null,
        download: job.download ? { status: job.download.status, completedResources: Object.keys(job.download.checkpoints || {}).length } : null,
        package: pkg ? { packageId: pkg.packageId, bytes: pkg.bytes, sha256: pkg.sha256, contentFingerprint: pkg.contentFingerprint, resourceCount: pkg.resourceCount, sourceIdentityBasis: pkg.sourceIdentityBasis || pkg.source?.identityBasis || artifacts.get(job.jobId)?.sourceIdentityBasis || null, sdkVersion: '7.130.0' } : null,
      }, allowedActions: allowed(job), operationId: active?.jobId === job.jobId ? active.operationId : null };
  }
  async function operationView(op) {
    const dto = operationDTO(op);
    if (op.status === 'running' && op.jobId) {
      try { const job = await getJob(op.jobId); dto.phase = job.status; dto.counts = { ...(job.download ? { completedResources: Object.keys(job.download.checkpoints || {}).length } : {}) }; } catch {}
    }
    return dto;
  }
  async function recordArtifact(job, report, originalFileStamp) {
    const previous = artifacts.get(job.jobId);
    const value = { jobId: job.jobId, bytes: report.package.bytes, sha256: report.package.sha256, packageId: report.package.packageId,
      contentFingerprint: report.contentFingerprint, resourceCount: report.resourceCount,
      manifest: { entrypoint: report.manifest.entrypoint, resources: report.manifest.resources }, sourceIdentityBasis: report.manifest.source.identityBasis, originalFileStamp, verifiedAt: timestamp(),
      ...(previous?.sha256 === report.package.sha256 && previous.previewDirectory ? { previewDirectory: previous.previewDirectory } : {}) };
    await journal.write('artifacts', job.jobId, value); artifacts.set(job.jobId, value); return value;
  }
  function packagePath(job) {
    const pkg = job.lastGoodPackage || job.package;
    if (!pkg?.path) bad('ARTIFACT_INVALID', 409);
    const candidate = path.resolve(pkg.path);
    if (!(inside(output, candidate) || inside(incoming, candidate) || config.importRoot && inside(config.importRoot, candidate))) bad('UNSAFE_PATH');
    return candidate;
  }
  function rememberPreview(job, artifact) {
    if (!artifact.previewDirectory) { previewCapabilities.delete(job.jobId); return; }
    const expected = job.lastGoodPackage || job.package;
    if (!expected || artifact.jobId !== job.jobId || artifact.packageId !== expected.packageId || artifact.bytes !== expected.bytes || artifact.sha256 !== expected.sha256 || artifact.contentFingerprint !== expected.contentFingerprint || !artifact.originalFileStamp || !inside(previews, artifact.previewDirectory)) bad('ARTIFACT_INVALID', 409);
    const capability = Object.freeze({ artifact, jobId: job.jobId, filename: packagePath(job),
      packageId: artifact.packageId, bytes: artifact.bytes, sha256: artifact.sha256, contentFingerprint: artifact.contentFingerprint, resourceCount: artifact.resourceCount,
      originalFileStamp: Object.freeze({ ...artifact.originalFileStamp }), previewDirectory: artifact.previewDirectory, manifest: artifact.manifest,
      resources: new Map(artifact.manifest.resources.map(resource => [resource.path, Object.freeze({ ...resource })])) });
    issuedPreviewCapabilities.add(capability); previewCapabilities.set(job.jobId, capability);
  }
  function currentPreview(capability) {
    const current = previewCapabilities.get(capability?.jobId), artifact = artifacts.get(capability?.jobId);
    // A concurrent report can issue a fresh equivalent capability. Both must
    // originate in full verification and still bind the exact same bytes/cache.
    return Boolean(capability && current && issuedPreviewCapabilities.has(capability) && issuedPreviewCapabilities.has(current) && artifact === current.artifact && artifact.jobId === current.jobId && artifact.packageId === current.packageId && artifact.bytes === current.bytes && artifact.sha256 === current.sha256 && artifact.contentFingerprint === current.contentFingerprint && artifact.resourceCount === current.resourceCount && artifact.previewDirectory === current.previewDirectory && artifact.manifest === current.manifest && canonical(artifact.originalFileStamp) === canonical(current.originalFileStamp) && capability.filename === current.filename && capability.packageId === current.packageId && capability.bytes === current.bytes && capability.sha256 === current.sha256 && capability.contentFingerprint === current.contentFingerprint && capability.resourceCount === current.resourceCount && capability.previewDirectory === current.previewDirectory && canonical(capability.originalFileStamp) === canonical(current.originalFileStamp));
  }
  async function previewCapability(jobId) {
    const cached = previewCapabilities.get(jobId);
    if (currentPreview(cached)) return cached;
    let pending = previewPriming.get(jobId);
    if (!pending) {
      pending = (async () => {
        const job = await getJob(jobId);
        await verifyArtifact(job, shutdownController.signal);
        const capability = previewCapabilities.get(jobId);
        if (!currentPreview(capability)) bad('PREVIEW_NOT_READY', 409);
        return capability;
      })();
      previewPriming.set(jobId, pending);
      pending.finally(() => { if (previewPriming.get(jobId) === pending) previewPriming.delete(jobId); }).catch(() => {});
    }
    return pending;
  }
  async function verifyArtifact(job, signal, extract = false) {
    const filename = packagePath(job), originalFileStamp = fileStamp((await safePath(filename)).stat);
    const verifyOptions = { signal };
    const expected = job.lastGoodPackage || job.package;
    if (expected.contentFingerprint) verifyOptions.expectedFingerprint = expected.contentFingerprint;
    let extractTo;
    if (extract) {
      if (!sdkAvailable) bad('SDK_UNAVAILABLE', 409);
      extractTo = path.join(previews, job.jobId, randomUUID()); await safePath(path.dirname(extractTo), { directory: true, create: true });
      verifyOptions.extractTo = extractTo;
    }
    let report;
    try { report = await packageApi.verifyPackage(filename, verifyOptions); }
    catch (error) { if (signal?.aborted) bad('LOCAL_ABORTED'); bad('ARTIFACT_INVALID', 409); }
    if (report.package.bytes !== expected.bytes || report.package.sha256 !== expected.sha256 || report.package.packageId !== expected.packageId) { if (extractTo) await removeOwned(previews, extractTo); bad('ARTIFACT_INVALID', 409); }
    if (options.fault) await options.fault('artifactVerified', { jobId: job.jobId, signal });
    if (signal?.aborted) bad('LOCAL_ABORTED');
    if (canonical(originalFileStamp) !== canonical(fileStamp((await safePath(filename)).stat))) { if (extractTo) await removeOwned(previews, extractTo); bad('ARTIFACT_INVALID', 409); }
    const artifact = await recordArtifact(job, report, originalFileStamp);
    if (extractTo) {
      const previousDirectory = artifact.previewDirectory;
      artifact.previewDirectory = extractTo;
      await journal.write('artifacts', job.jobId, artifact);
      artifacts.set(job.jobId, artifact);
      if (previousDirectory && previousDirectory !== extractTo) await removeOwned(previews, previousDirectory);
    }
    rememberPreview(job, artifact);
    return artifact;
  }
  async function startOperation(requestId, route, input, type, jobId, workFn) {
    return serialized(async () => {
      const identity = digest({ route, input });
      const previous = requests.get(requestId);
      if (previous) {
        if (previous.identity !== identity || !previous.operationId) bad('REQUEST_CONFLICT', 409);
        const op = operations.get(previous.operationId); if (!op) bad('STORE_CORRUPT', 500);
        return op;
      }
      if (active || activeUpload) bad('OPERATION_BUSY', 409);
      const at = timestamp(), op = { operationId: randomUUID(), jobId, type, status: 'queued', phase: type, counts: {}, createdAt: at, updatedAt: at, error: null };
      await journal.write('operations', op.operationId, op);
      const request = { requestId, type: 'operation', identity, operationId: op.operationId };
      await journal.write('requests', requestId, request); requests.set(requestId, request); operations.set(op.operationId, op);
      const controller = new AbortController();
      active = { operationId: op.operationId, jobId, controller, promise: null };
      const run = async () => {
        op.status = 'running'; op.updatedAt = timestamp(); await journal.write('operations', op.operationId, op);
        try {
          if (options.fault) await options.fault('beforeWork', { operationId: op.operationId, jobId: op.jobId, type: op.type });
          const result = await workFn(controller.signal, op);
          if (controller.signal.aborted) bad('LOCAL_ABORTED');
          op.status = 'succeeded'; op.phase = 'complete'; op.result = result || { jobId: op.jobId };
        } catch (error) {
          op.error = controller.signal.aborted ? { code: 'LOCAL_ABORTED', message: MESSAGES.LOCAL_ABORTED } : safeError(error);
          op.status = controller.signal.aborted ? 'interrupted' : 'failed'; op.phase = op.status;
          if (options.fault && error instanceof CoreAPI.CoreError && error.code === 'STORE_CORRUPT') await options.fault('storeReadFailure', { jobId: op.jobId, operationId: op.operationId, type: op.type, code: error.code, message: error.message, stack: error.stack });
        } finally {
          op.updatedAt = timestamp();
          try { await journal.write('operations', op.operationId, op); }
          finally { if (active?.operationId === op.operationId) active = null; }
        }
      };
      // The durable request and queued operation exist before work starts.
      active.promise = Promise.resolve().then(run); active.promise.catch(() => {});
      return op;
    });
  }
  async function enumerateInputs(kind = 'package') {
    const root = kind === 'nwd' ? config.sourceRoot : config.importRoot;
    if (!root) return [];
    const records = [];
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(kind === 'nwd' ? '.nwd' : '.zip')) continue;
      try {
        filename(encodeURIComponent(entry.name), kind);
        const target = path.join(root, entry.name), checked = await safePath(target);
        if (checked.stat.size > MAX_UPLOAD) continue;
        records.push({ inputId: digest({ name: entry.name, bytes: checked.stat.size, mtimeMs: checked.stat.mtimeMs }), name: entry.name, bytes: checked.stat.size });
      } catch {}
    }
    return records;
  }
  async function uploadRequest(req, res, route, kind) {
    if (!['nwd', 'package'].includes(kind)) bad('UPLOAD_INVALID');
    const name = filename(req.headers['x-file-name'], kind), requestId = uuid(req.headers['x-request-id']);
    const declared = req.headers['content-length'] === undefined ? null : Number(req.headers['content-length']);
    if (declared !== null && (!Number.isSafeInteger(declared) || declared < 1 || declared > MAX_UPLOAD)) bad('UPLOAD_LIMIT', 413);
    const identity = digest({ route, kind, name, declared });
    const previous = await serialized(async () => {
      const saved = requests.get(requestId);
      if (saved) { if (saved.identity !== identity) bad('REQUEST_CONFLICT', 409); return saved; }
      if (active || activeUpload) bad('OPERATION_BUSY', 409);
      const request = { requestId, type: 'upload', identity, status: 'running', uploadId: randomUUID() };
      await journal.write('requests', requestId, request); requests.set(requestId, request);
      activeUpload = { requestId, controller: new AbortController(), promise: null, request: req };
      return null;
    });
    if (previous) {
      if (previous.status !== 'succeeded') bad('UPLOAD_INTERRUPTED', 409);
      const saved = uploads.get(previous.uploadId); if (!saved) bad('STORE_CORRUPT', 500);
      let count = 0; const hash = createHash('sha256');
      for await (const chunk of req) { count += chunk.length; if (count > MAX_UPLOAD) bad('UPLOAD_LIMIT', 413); hash.update(chunk); }
      if (count !== saved.bytes || hash.digest('hex') !== saved.sha256) bad('REQUEST_CONFLICT', 409);
      send(res, 200, { uploadId: saved.uploadId, name: saved.name, bytes: saved.bytes, sha256: saved.sha256 }); return;
    }
    const request = requests.get(requestId), directory = path.join(incoming, request.uploadId), part = path.join(directory, 'upload.part'), target = path.join(directory, name);
    const controller = activeUpload.controller;
    const onAborted = () => controller.abort(); req.once('aborted', onAborted);
    let handle, bytes = 0; const hash = createHash('sha256');
    const streamWork = async () => {
      try {
        await safePath(directory, { directory: true, create: true }); handle = await fs.open(part, 'wx', 0o600);
        for await (const chunk of req) {
          if (controller.signal.aborted) bad('UPLOAD_INTERRUPTED'); bytes += chunk.length;
          if (bytes > MAX_UPLOAD) bad('UPLOAD_LIMIT', 413); hash.update(chunk);
          if (options.fault) await options.fault('uploadWrite', { bytes });
          let offset = 0; while (offset < chunk.length) { const write = await handle.write(chunk, offset, chunk.length - offset); if (!write.bytesWritten) bad('UPLOAD_INTERRUPTED'); offset += write.bytesWritten; }
        }
        if (!req.complete || controller.signal.aborted || !bytes || declared !== null && bytes !== declared) bad('UPLOAD_INTERRUPTED');
        await handle.sync(); await handle.close(); handle = null; await fs.rename(part, target);
        const uploaded = { uploadId: request.uploadId, kind, name, bytes, sha256: hash.digest('hex'), consumedBy: null };
        await journal.write('uploads', uploaded.uploadId, uploaded); uploads.set(uploaded.uploadId, uploaded);
        request.status = 'succeeded'; await journal.write('requests', requestId, request);
        send(res, 200, { uploadId: uploaded.uploadId, name, bytes, sha256: uploaded.sha256 });
      } catch (error) {
        request.status = 'interrupted';
        try { if (options.fault) await options.fault('uploadFailurePersist', {}); await journal.write('requests', requestId, request); }
        catch { /* Restart conservatively changes the existing running receipt to interrupted. */ }
        finally { if (handle) await handle.close(); await removeOwned(incoming, directory); }
        if (!res.destroyed) throw error;
      } finally { req.removeListener('aborted', onAborted); if (activeUpload?.requestId === requestId) activeUpload = null; }
    };
    activeUpload.promise = streamWork(); return activeUpload.promise;
  }
  function spec(sourcePath, jobId, versionLabel, sourceSha) {
    return { jobId, sourcePath, namespace: liveNamespace || { account: `${mode}-local`, application: `${mode}-preparer` }, region: liveRegion || 'EMEA',
      destination: { bucket: logicalBucket || `${mode}-preparer-fixtures`, objectKey: liveNamespace && !options.createLiveRuntime ? path.basename(sourcePath) : `${sourceSha}.nwd` }, conversion: { format: 'svf', views: ['3d'], xAdsForce: false }, supportProfile: 'svf-local-7.130.0-v1', label: versionLabel, output: path.join(output, `${jobId}.zip`) };
  }
  async function requestUpload(input, kind, jobId, signal) {
    const uploaded = uploads.get(uuid(input.uploadId));
    if (!uploaded || uploaded.kind !== kind || uploaded.consumedBy) bad('UPLOAD_INVALID', 409);
    const source = path.join(incoming, uploaded.uploadId, uploaded.name);
    const observed = await hashFile(source, { signal });
    if (observed.bytes !== uploaded.bytes || observed.sha256 !== uploaded.sha256) bad('ARTIFACT_INVALID', 409);
    uploaded.consumedBy = jobId; await journal.write('uploads', uploaded.uploadId, uploaded);
    return { uploaded, source };
  }
  async function streamFile(req, res, file, contentType, attachment, expected) {
    const signal = shutdownController.signal;
    if (signal.aborted) bad('LOCAL_ABORTED');
    const checked = (await safePath(file)).stat, handle = await fs.open(file, 'r');
    try {
    const before = await handle.stat();
    if (canonical(fileStamp(checked)) !== canonical(fileStamp(before))) bad('ARTIFACT_INVALID', 409);
    if (expected) {
      const hash = createHash('sha256'), buffer = Buffer.alloc(65536); let bytes = 0;
      for (;;) {
        if (signal.aborted) bad('LOCAL_ABORTED');
        const result = await handle.read(buffer, 0, buffer.length, bytes); if (!result.bytesRead) break;
        bytes += result.bytesRead; if (bytes > expected.bytes || bytes > MAX_UPLOAD) bad('ARTIFACT_INVALID', 409); hash.update(buffer.subarray(0, result.bytesRead));
      }
      if (bytes !== expected.bytes || hash.digest('hex') !== expected.sha256 || canonical(fileStamp(before)) !== canonical(fileStamp(await handle.stat()))) bad('ARTIFACT_INVALID', 409);
    }
    let start = 0, end = before.size - 1, status = 200;
    if (req.headers.range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
      if (!match || !Number.isSafeInteger(Number(match[1]))) bad('INVALID_REQUEST', 416);
      start = Number(match[1]); end = match[2] ? Number(match[2]) : end;
      if (!Number.isSafeInteger(end) || start > end || start >= before.size || end >= before.size) bad('INVALID_REQUEST', 416); status = 206;
    }
    const headers = { 'Content-Type': contentType, 'Content-Length': Math.max(0, end - start + 1), 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${before.size}`;
    if (attachment) headers['Content-Disposition'] = `attachment; filename="${attachment}"`;
    res.writeHead(status, headers);
    if (req.method === 'HEAD' || !before.size) { res.end(); return; }
    await new Promise((resolve, reject) => {
      const stream = handle.createReadStream({ start, end, autoClose: false, signal });
      stream.once('error', reject); res.once('error', reject); res.once('close', () => { stream.destroy(); resolve(); }); stream.once('end', () => { stream.destroy(); resolve(); }); stream.pipe(res);
    });
    } finally { await handle.close(); }
  }
  async function handle(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    const route = cleanSegments(req.url), mutation = req.method === 'POST';
    // The trusted offline Viewer CSS embeds one WOFF icon font. Only preview
    // documents need data fonts; scripts retain the same restricted policy.
    const fontSources = /^\/preview\/[0-9a-f-]{36}$/.test(route) ? "'self' data:" : "'self'";
    res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src ${fontSources}; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'`);
    guard(req, mutation);
    if (!['GET', 'HEAD', 'POST'].includes(req.method)) bad('INVALID_REQUEST', 405);
    if (route === '/health' && !mutation) { send(res, 200, { status: 'ok', mode: providerMode, requestedMode: mode }); return; }
    if (route === '/api/provider-diagnostics' && !mutation) { send(res, 200, providerDiagnostics()); return; }
    if (route === '/api/config' && !mutation) {
      if (providerMode === 'live') { const inspect = costProvider.getReadiness || costProvider.readiness || costProvider.inspect; if (typeof inspect === 'function') { try { const result = await inspect.call(costProvider); liveCostState = { state: result.state, code: result.code || 'CURRENT_OPERATOR_PROOF', message: result.state === 'verified' ? 'Current account allowance is verified for the approved source and explicit bounded operations.' : MESSAGES.CLOUD_CLOSED, ...(result.checkedAt ? { checkedAt: result.checkedAt } : {}), ...(result.expiresAt ? { expiresAt: result.expiresAt } : {}) }; } catch { liveCostState = { state: 'blocked', code: 'LIVE_PROOF_INVALID', message: MESSAGES.CLOUD_CLOSED }; } } }
      send(res, 200, { mode: providerMode, requestedMode: mode, providerMode, livePolicy: { reuseOnly: config.liveReuseOnly !== false }, configuration: config.configuration || {}, configurationVerification: 'local-presence-and-syntax-only', cost: liveCostState, previewRuntime: { available: sdkAvailable, sdkVersion: '7.130.0' }, limits: { maxUploadBytes: MAX_UPLOAD, maxJsonBytes: MAX_JSON }, csrfToken, startupCloudCalls }); return;
    }
    if (route === '/api/jobs' && !mutation) { send(res, 200, { jobs: (await core.listJobs()).map(jobDTO) }); return; }
    if (route === '/api/imports' && !mutation) { send(res, 200, { inputs: await enumerateInputs() }); return; }
    if (route === '/api/source-inputs' && !mutation) { send(res, 200, { inputs: await enumerateInputs('nwd') }); return; }
    let match = /^\/api\/jobs\/([0-9a-f-]+)$/.exec(route);
    if (match && !mutation) { send(res, 200, { job: jobDTO(await getJob(match[1])) }); return; }
    match = /^\/api\/operations\/([0-9a-f-]+)$/.exec(route);
    if (match && !mutation) { const op = operations.get(uuid(match[1])); if (!op) bad('NOT_FOUND', 404); send(res, 200, { operation: await operationView(op) }); return; }
    match = /^\/api\/requests\/([0-9a-f-]+)$/.exec(route);
    if (match && !mutation) {
      const request = requests.get(uuid(match[1])); if (!request) bad('NOT_FOUND', 404);
      if (request.operationId) send(res, 200, { operation: await operationView(operations.get(request.operationId)) });
      else if (request.type === 'browser') send(res, 200, { evidence: request.result });
      else if (request.status === 'succeeded') { const upload = uploads.get(request.uploadId); if (!upload) bad('STORE_CORRUPT', 500); send(res, 200, { upload: { uploadId: upload.uploadId, name: upload.name, bytes: upload.bytes, sha256: upload.sha256 } }); }
      else send(res, 200, { request: { requestId: request.requestId, type: 'upload', status: request.status } });
      return;
    }
    if (route === '/api/uploads' && mutation) { const query = new URL(req.url, origin).searchParams; if ([...query.keys()].some(k => k !== 'kind') || query.getAll('kind').length !== 1) bad('UPLOAD_INVALID'); await uploadRequest(req, res, route, query.get('kind')); return; }
    if (route === '/api/browser-evidence' && mutation) {
      const input = browserFields(exact(await jsonBody(req), BROWSER_FIELDS));
      await getJob(input.jobId);
      const requestId = req.headers['x-request-id'], identity = digest({ route, input });
      const evidence = await serialized(async () => {
        const previous = requests.get(requestId); if (previous) { if (previous.identity !== identity || previous.type !== 'browser') bad('REQUEST_CONFLICT', 409); return previous.result; }
        const result = { ...input, mode, observedAt: timestamp(), basis: 'client-reported-observation' };
        await journal.write('browser', requestId, result);
        browserObservations.set(input.jobId, result);
        const request = { requestId, type: 'browser', identity, result }; await journal.write('requests', requestId, request); requests.set(requestId, request); return result;
      });
      send(res, 200, { evidence }); return;
    }
    if (['/api/jobs/capture', '/api/jobs/capture-known', '/api/jobs/register', '/api/jobs/register-known', '/api/simulation/capture'].includes(route) && mutation) {
      const input = exact(await jsonBody(req), route.endsWith('capture-known') ? ['inputId', 'label'] : route.endsWith('register-known') ? ['inputId'] : route === '/api/simulation/capture' ? ['label'] : route.endsWith('capture') ? ['uploadId', 'label'] : ['uploadId']);
      if (route.includes('capture')) label(input.label);
      if (route.endsWith('-known')) { if (!/^[0-9a-f]{64}$/.test(input.inputId || '')) bad('INVALID_REQUEST'); } else if (!route.includes('simulation')) uuid(input.uploadId);
      if (input.uploadId) uuid(input.uploadId);
      if (route === '/api/simulation/capture' && mode !== 'simulation') bad('SIMULATION_ONLY', 409);
      const jobId = randomUUID(), type = route === '/api/simulation/capture' ? 'simulation-capture' : route.split('/').at(-1);
      const op = await startOperation(req.headers['x-request-id'], route, input, type, jobId, async signal => {
        let job;
        if (type === 'simulation-capture') {
          const directory = path.join(incoming, jobId); await safePath(directory, { directory: true, create: true });
          const sourcePath = path.join(directory, 'synthetic.nwd'); await fs.writeFile(sourcePath, 'Synthetic simulation bytes; not a real NWD model.\n', { flag: 'wx', mode: 0o600 });
          const sourceSha = createHash('sha256').update('Synthetic simulation bytes; not a real NWD model.\n').digest('hex');
          try { job = await core.captureJob(spec(sourcePath, jobId, input.label, sourceSha), { signal }); }
          finally { await removeOwned(incoming, directory); }
        } else if (type === 'capture-known') {
          const known = (await enumerateInputs('nwd')).find(row => row.inputId === input.inputId); if (!known) bad('NOT_FOUND', 404);
          const source = path.join(config.sourceRoot, known.name), actual = await hashFile(source, { signal });
          job = await core.captureJob(spec(source, jobId, input.label, actual.sha256), { signal });
        } else if (type === 'capture') {
          const { uploaded, source } = await requestUpload(input, 'nwd', jobId, signal);
          job = await core.captureJob(spec(source, jobId, input.label, uploaded.sha256), { signal });
          await removeOwned(incoming, path.dirname(source)); uploaded.cleaned = true; await journal.write('uploads', uploaded.uploadId, uploaded);
        } else if (type === 'register') {
          const { source } = await requestUpload(input, 'package', jobId, signal);
          job = await core.registerPackage({ packagePath: source, jobId }, { signal });
          await verifyArtifact(job, signal);
        } else {
          const known = (await enumerateInputs()).find(row => row.inputId === input.inputId); if (!known) bad('NOT_FOUND', 404);
          job = await core.registerPackage({ packagePath: path.join(config.importRoot, known.name), jobId }, { signal });
          await verifyArtifact(job, signal);
        }
        jobs.set(jobId, job); return { jobId };
      });
      send(res, 202, { operation: await operationView(op) }); return;
    }
    match = /^\/api\/jobs\/([0-9a-f-]+)\/actions$/.exec(route);
    if (match && mutation) {
      const jobId = uuid(match[1]), input = exact(await jsonBody(req), ['action', 'rootId', 'recoverDead']);
      if (!ACTIONS.includes(input.action) || input.recoverDead !== undefined && typeof input.recoverDead !== 'boolean' || input.rootId !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(input.rootId)) bad('INVALID_REQUEST');
      // Accepted request identity wins over eligibility changes caused by its
      // own work, restart or expiring cost proof. This only observes the WAL.
      const previous = requests.get(req.headers['x-request-id']);
      if (previous) { if (previous.identity !== digest({ route, input }) || !previous.operationId) bad('REQUEST_CONFLICT', 409); const op = operations.get(previous.operationId); if (!op) bad('STORE_CORRUPT', 500); send(res, 202, { operation: await operationView(op) }); return; }
      if (providerMode === 'closed' && !['package', 'verify', 'preview'].includes(input.action)) bad('CLOUD_CLOSED', 409);
      const job = await getJob(jobId);
      if (!allowed(job).includes(input.action)) bad(input.action === 'preview' && !sdkAvailable ? 'SDK_UNAVAILABLE' : 'ACTION_NOT_ALLOWED', 409);
      const op = await startOperation(req.headers['x-request-id'], route, input, input.action, jobId, async signal => {
        const args = { signal, recoverDead: input.recoverDead === true, ...(input.rootId ? { rootId: input.rootId } : {}) };
        if (input.action === 'verify' || input.action === 'preview') { await verifyArtifact(await getJob(jobId), signal, input.action === 'preview'); return { jobId, ...(input.action === 'preview' ? { previewUrl: `/preview/${jobId}` } : {}) }; }
        const method = { 'approve-cost': 'approveCost', prepare: 'prepare', reconcile: 'reconcile', wait: 'waitForDerivative', download: 'download', package: 'buildPackage' }[input.action];
        await core[method](jobId, args); const updated = await getJob(jobId);
        if (input.action === 'package') await verifyArtifact(updated, signal);
        return { jobId };
      });
      send(res, 202, { operation: await operationView(op) }); return;
    }
    match = /^\/api\/operations\/([0-9a-f-]+)\/cancel$/.exec(route);
    if (match && mutation) {
      exact(await jsonBody(req), []); const operationId = uuid(match[1]), op = operations.get(operationId); if (!op) bad('NOT_FOUND', 404);
      const requestId = req.headers['x-request-id'], identity = digest({ route, input: {} });
      await serialized(async () => { const previous = requests.get(requestId); if (previous && previous.identity !== identity) bad('REQUEST_CONFLICT', 409); if (!previous) { const value = { requestId, type: 'operation', identity, operationId }; await journal.write('requests', requestId, value); requests.set(requestId, value); } });
      if (active?.operationId === operationId) { active.controller.abort(); if (active.jobId) core.stop(active.jobId); }
      send(res, 202, { operation: await operationView(op) }); return;
    }
    match = /^\/api\/artifacts\/([0-9a-f-]+)\/(package|report|preview)$/.exec(route);
    if (match && !mutation) {
      const jobId = uuid(match[1]), job = await getJob(jobId), artifact = artifacts.get(jobId); if (!artifact) bad('ARTIFACT_INVALID', 409);
      if (match[2] === 'package') {
        const current = await verifyArtifact(job, shutdownController.signal); await streamFile(req, res, packagePath(job), 'application/zip', `${jobId}.zip`, current); return;
      }
      if (match[2] === 'report') { const current = await verifyArtifact(job, shutdownController.signal), diagnostics = providerDiagnostics(); res.setHeader('Content-Disposition', `attachment; filename="${jobId}-report.json"`); send(res, 200, { reportSchemaVersion: 1, mode, providerMode, job: jobDTO(job), verification: { status: 'PASS', verifiedAt: current.verifiedAt, packageId: current.packageId, bytes: current.bytes, sha256: current.sha256, contentFingerprint: current.contentFingerprint, resourceCount: current.resourceCount }, cloudActivity: { scope: diagnostics.scope, requestCount: providerMode === 'live' ? diagnostics.requests.length : 0, cloudMutations: diagnostics.cloudMutations, startupCloudCalls }, ...(providerMode === 'simulation' ? { simulationActivity: { callCount: diagnostics.requests.length } } : {}), ...(browserObservations.has(jobId) ? { browserObservation: browserObservations.get(jobId) } : {}), liveCostVerification: providerMode === 'live' ? costProvider.getReadiness().state : 'blocked' }); return; }
      if (!artifact.previewDirectory) bad('PREVIEW_NOT_READY', 409);
      const current = await verifyArtifact(job, shutdownController.signal);
      send(res, 200, { jobId, sdkVersion: '7.130.0', modelUrl: `/preview-resources/${jobId}/${current.manifest.entrypoint}`, resourceCount: current.resourceCount, contentFingerprint: current.contentFingerprint }); return;
    }
    match = /^\/preview-resources\/([0-9a-f-]+)\/(.+)$/.exec(route);
    if (match && !mutation) {
      const jobId = uuid(match[1]); if (!artifacts.get(jobId)?.previewDirectory) bad('PREVIEW_NOT_READY', 409);
      const capability = await previewCapability(jobId);
      if (!currentPreview(capability) || canonical(fileStamp((await safePath(capability.filename)).stat)) !== canonical(capability.originalFileStamp)) bad('ARTIFACT_INVALID', 409);
      const resource = capability.resources.get(match[2]); if (!resource) bad('NOT_FOUND', 404);
      const target = path.join(capability.previewDirectory, ...resource.path.split('/'));
      if (!currentPreview(capability)) bad('ARTIFACT_INVALID', 409);
      if (!inside(previews, capability.previewDirectory) || !inside(capability.previewDirectory, target)) bad('UNSAFE_PATH');
      await streamFile(req, res, target, 'application/octet-stream', null, resource); return;
    }
    if (!mutation && (route === '/' || /^\/preview\/[0-9a-f-]{36}$/.test(route) || route.startsWith('/web/') || route.startsWith('/sdk/'))) {
      let target;
      if (route.startsWith('/sdk/')) { if (!sdkAvailable) bad('SDK_UNAVAILABLE', 404); target = path.join(config.sdkDirectory, route.slice(5)); if (!inside(config.sdkDirectory, target)) bad('UNSAFE_PATH'); }
      else { const relative = route === '/' ? 'index.html' : route.startsWith('/preview/') ? 'preview.html' : route.slice(5); target = path.join(options.webDirectory || path.join(ROOT, 'web'), relative); if (!inside(options.webDirectory || path.join(ROOT, 'web'), target)) bad('UNSAFE_PATH'); }
      await streamFile(req, res, target, MIME[path.extname(target)] || 'application/octet-stream'); return;
    }
    bad('NOT_FOUND', 404);
  }
  const server = http.createServer((req, res) => {
    const work = handle(req, res).catch(error => { if (res.headersSent) { res.destroy(); return; } const safe = safeError(error); send(res, safe.code === 'NO_SPACE' ? 507 : error instanceof ServiceError ? error.status : safe.code === 'JOB_MISSING' ? 404 : safe.code === 'LOCAL_ABORTED' ? 409 : 400, { error: safe }); });
    if (['GET', 'HEAD'].includes(req.method)) { readWork.add(work); work.finally(() => readWork.delete(work)).catch(() => {}); }
  });
  server.requestTimeout = 600000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000;
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  async function listen() {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, config.host, resolve); });
    if (config.port === 0) origin = `http://127.0.0.1:${server.address().port}`;
    return origin;
  }
  async function close({ drainMs = 5000 } = {}) {
    if (closePromise) return closePromise;
    closePromise = (async () => {
      shuttingDown = true;
      shutdownController.abort();
      if (active) { active.controller.abort(); if (active.jobId) core.stop(active.jobId); }
      if (activeUpload) { activeUpload.controller.abort(); activeUpload.request.destroy(); }
      const finished = Promise.allSettled([active?.promise, activeUpload?.promise, ...readWork].filter(Boolean));
      let timer; await Promise.race([finished, new Promise(resolve => { timer = setTimeout(resolve, drainMs); })]); clearTimeout(timer);
      await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); for (const socket of sockets) socket.destroy(); });
      await journal.close();
    })(); return closePromise;
  }
  return { server, listen, close, get address() { return origin; }, mode, get startupCloudCalls() { return startupCloudCalls; } };
}
