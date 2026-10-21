import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import {
  CoreError, fail, canonical, digest, clone, abortCheck, nowIso, validateLocalPath,
  validateId, validateSourceName, identifier, validateManifestObservation, contextFromSpec,
} from './contracts.mjs';

const PROFILE = 'svf-local-7.130.0-v1';
const SHA = /^[0-9a-f]{64}$/;
const RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i;
const REQUIRED_PATHS = ['output/0/0.svf', 'output/0/properties.db'];
const FIELDS = ['schemaVersion', 'submissionIdentity', 'objectId', 'urn', 'region', 'rootId', 'supportProfile', 'resources'];
const samePath = (a, b) => process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);
function inside(root, value) { const relative = path.relative(root, value); return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); }
function strict(value, fields, code = 'DOWNLOAD_INVALID') {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some(key => !fields.includes(key))) fail(code);
}
function bytes(value) { return Number.isSafeInteger(value) && value >= 0; }
function resourcePath(value) {
  if (typeof value !== 'string' || !/^output\/0\/[A-Za-z0-9._-]{1,255}$/.test(value)) fail('UNSAFE_PATH');
  const basename = value.slice('output/0/'.length);
  if (basename === '.' || basename === '..' || /\.$/.test(basename) || /^\.env(?:\.|$)/i.test(basename) || RESERVED.test(basename)) fail('UNSAFE_PATH');
  if (!['0.svf', 'properties.db', 'Materials.json.gz', 'objects_attrs.json.gz', 'objects_avs.json.gz', 'objects_ids.json.gz', 'objects_offs.json.gz', 'objects_vals.json.gz', 'objects_viewables.json.gz'].includes(basename) && !/\.(pf|bin|pack)$/.test(basename)) fail('UNSUPPORTED_PROFILE');
  return value;
}

// Local IO is deliberately independent of the package module's private locks
// and helpers. The orchestrator must hold its own durable per-job lock.
async function inspectLocal(value, { directory = false, create = false } = {}) {
  const target = validateLocalPath(value);
  const drive = path.parse(target).root;
  const segments = path.relative(drive, target).split(path.sep).filter(Boolean);
  let current = drive;
  const check = async (candidate, last) => {
    let stat;
    try { stat = await fs.lstat(candidate); }
    catch (error) {
      if (error.code !== 'ENOENT' || !create || (last && !directory)) throw error;
      try { await fs.mkdir(candidate, { mode: 0o700 }); } catch (mkdirError) { if (mkdirError.code !== 'EEXIST') throw mkdirError; }
      stat = await fs.lstat(candidate);
    }
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()) || (stat.isFile() && stat.nlink !== 1)) fail('UNSAFE_PATH');
    if ((!last || directory) ? !stat.isDirectory() : !stat.isFile()) fail('UNSAFE_PATH');
    if (!samePath(await fs.realpath(candidate), candidate)) fail('UNSAFE_PATH');
    return stat;
  };
  let result = await check(drive, segments.length === 0);
  for (let at = 0; at < segments.length; at++) { current = path.join(current, segments[at]); result = await check(current, at === segments.length - 1); }
  return { path: target, stat: result };
}
async function optionalFile(filename) {
  try { return await inspectLocal(filename); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function hashLocal(filename, maxBytes, signal) {
  abortCheck(signal);
  const { stat: before } = await inspectLocal(filename);
  const hash = createHash('sha256'); let total = 0;
  for await (const chunk of createReadStream(filename, { signal })) {
    abortCheck(signal); total += chunk.length;
    if (total > maxBytes) fail('PACKAGE_LIMIT_EXCEEDED');
    hash.update(chunk);
  }
  const { stat: after } = await inspectLocal(filename);
  if (before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || total !== after.size) fail('DOWNLOAD_INVALID');
  return { bytes: total, sha256: hash.digest('hex') };
}
async function replaceJson(filename, value) {
  await inspectLocal(path.dirname(filename), { directory: true });
  await optionalFile(filename);
  const temporary = path.join(path.dirname(filename), `.adapter-json-${randomUUID()}.tmp`);
  const handle = await fs.open(temporary, 'wx', 0o600);
  try { await handle.writeFile(canonical(value) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
  try { await fs.rename(temporary, filename); }
  finally { await fs.rm(temporary, { force: true }); }
}
function packageFailure(error, fallback = 'PACKAGE_ADAPTER_FAILURE') {
  if (error instanceof CoreError) return error;
  const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code) ? error.code : undefined;
  return new CoreError(fallback, undefined, code ? { packageCode: code } : {});
}
async function abortable(promise, signal) {
  // The caller may already have received a rejected provider promise before
  // noticing cancellation. Consume it even when cancellation wins immediately.
  if (signal?.aborted) Promise.resolve(promise).catch(() => {});
  abortCheck(signal);
  if (!signal) return promise;
  let abort;
  const stopped = new Promise((_, reject) => { abort = () => reject(new CoreError('LOCAL_ABORTED')); signal.addEventListener('abort', abort, { once: true }); });
  try { return await Promise.race([promise, stopped]); }
  finally { signal.removeEventListener('abort', abort); }
}

function validatePlan(plan, frozen, rootId, limits) {
  strict(plan, FIELDS);
  if (FIELDS.some(key => !Object.hasOwn(plan, key)) || plan.schemaVersion !== 1 || plan.supportProfile !== PROFILE || !Array.isArray(plan.resources)) fail('DOWNLOAD_INVALID');
  for (const key of ['submissionIdentity', 'objectId', 'urn', 'region']) if (plan[key] !== frozen[key]) fail('IDENTITY_MISMATCH');
  if (plan.rootId !== rootId) fail('IDENTITY_MISMATCH');
  if (plan.resources.length === 0 || plan.resources.length > limits.maxFiles) fail('PACKAGE_LIMIT_EXCEEDED');
  let total = 0;
  const seen = new Set(), refs = new Set();
  const rows = plan.resources.map(row => {
    strict(row, ['path', 'resourceId', 'bytes', 'sha256']);
    resourcePath(row.path); identifier(row.resourceId, 'DOWNLOAD_INVALID');
    if (!bytes(row.bytes) || (row.sha256 !== undefined && !SHA.test(row.sha256))) fail('DOWNLOAD_INVALID');
    if (row.bytes > limits.maxFileBytes) fail('PACKAGE_LIMIT_EXCEEDED');
    const key = row.path.toLowerCase();
    if (seen.has(key) || refs.has(row.resourceId)) fail('DOWNLOAD_INVALID');
    seen.add(key); refs.add(row.resourceId); total += row.bytes;
    if (!Number.isSafeInteger(total) || total > limits.maxTotalResourceBytes) fail('PACKAGE_LIMIT_EXCEEDED');
    return { path: row.path, resourceId: row.resourceId, bytes: row.bytes, ...(row.sha256 === undefined ? {} : { sha256: row.sha256 }) };
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (REQUIRED_PATHS.some(item => !rows.some(row => row.path === item))) fail('DOWNLOAD_INCOMPLETE');
  return { ...plan, resources: rows };
}
function validatePrevious(previous, plan, planDigest, modelDirectory) {
  if (!previous) return;
  strict(previous, ['schemaVersion', 'status', 'planDigest', 'rootId', 'checkpoints', 'modelDirectory'], 'STORE_CORRUPT');
  if (previous.schemaVersion !== 1 || !['downloading', 'downloaded', 'failed', 'interrupted'].includes(previous.status) || !previous.checkpoints || Object.getPrototypeOf(previous.checkpoints) !== Object.prototype) fail('STORE_CORRUPT');
  if (previous.planDigest !== planDigest || previous.rootId !== plan.rootId || (previous.modelDirectory !== undefined && !samePath(validateLocalPath(previous.modelDirectory), modelDirectory))) fail('DOWNLOAD_PLAN_CHANGED');
  const rows = new Map(plan.resources.map(row => [row.path, row]));
  for (const [name, checkpoint] of Object.entries(previous.checkpoints)) {
    resourcePath(name); strict(checkpoint, ['bytes', 'sha256', 'resourceId'], 'STORE_CORRUPT');
    if (!rows.has(name) || !bytes(checkpoint.bytes) || !SHA.test(checkpoint.sha256) || checkpoint.resourceId !== rows.get(name).resourceId) fail('STORE_CORRUPT');
  }
}

export async function createPackageAdapter({ packageModulePath, packageApi, workDirectory, clock = { now: () => Date.now() }, downloadMaxMs = 1800000 } = {}) {
  if (!Number.isSafeInteger(downloadMaxMs) || downloadMaxMs < 1 || downloadMaxMs > 1800000) fail('CONFIGURATION_INVALID');
  if ((packageModulePath === undefined) === (packageApi === undefined)) fail('CONFIGURATION_INVALID');
  if (packageModulePath !== undefined) {
    const entry = validateLocalPath(packageModulePath, { label: 'package module' });
    if (path.basename(entry) !== 'index.mjs') fail('CONFIGURATION_INVALID');
    await inspectLocal(entry);
    packageApi = await import(pathToFileURL(entry).href);
  }
  for (const name of ['packModel', 'verifyPackage', 'validateProfile']) if (typeof packageApi?.[name] !== 'function') fail('CONFIGURATION_INVALID');
  if (!packageApi.DEFAULT_LIMITS || ['maxFileBytes', 'maxTotalResourceBytes', 'maxFiles', 'maxManifestBytes', 'maxNestedBytes', 'maxMs'].some(name => !bytes(packageApi.DEFAULT_LIMITS[name]) || packageApi.DEFAULT_LIMITS[name] === 0)) fail('CONFIGURATION_INVALID');
  const limits = packageApi.DEFAULT_LIMITS;
  const work = (await inspectLocal(validateLocalPath(workDirectory, { label: 'work directory' }), { directory: true, create: true })).path;

  function jobContext(job) {
    validateId(job?.jobId);
    const frozen = job.frozen;
    if (!frozen || frozen.supportProfile !== PROFILE || frozen.conversion?.format !== 'svf' || canonical(frozen.conversion.views) !== '["3d"]' || frozen.conversion.xAdsForce !== false) fail('UNSUPPORTED_PROFILE');
    validateSourceName(frozen.source?.name);
    if (!bytes(frozen.source.bytes) || frozen.source.bytes === 0 || !SHA.test(frozen.source.sha256) || !SHA.test(frozen.submissionIdentity) || !SHA.test(frozen.remoteTargetIdentity)) fail('INVALID_JOB');
    validateLocalPath(frozen.source.snapshotPath);
    validateLocalPath(frozen.output);
    if (path.basename(frozen.source.snapshotPath) !== frozen.source.name) fail('IDENTITY_MISMATCH');
    const restored = contextFromSpec({ ...frozen, sourcePath: frozen.source.snapshotPath }, frozen.source);
    for (const key of ['submissionIdentity', 'remoteTargetIdentity', 'objectId', 'urn']) if (restored[key] !== frozen[key]) fail('IDENTITY_MISMATCH');
    return frozen;
  }
  async function download(job, { provider, rootId, signal, previous, onCheckpoint } = {}) {
    const frozen = jobContext(job);
    if (typeof onCheckpoint !== 'function' || !provider || ['getManifest', 'getDownloadPlan', 'readResource'].some(name => typeof provider[name] !== 'function')) fail('CONFIGURATION_INVALID');
    const downloadBudget = new AbortController();
    const downloadTimer = setTimeout(() => downloadBudget.abort(), downloadMaxMs);
    let operationSignal = signal ? AbortSignal.any([signal, downloadBudget.signal]) : downloadBudget.signal;
    let state;
    try {
      abortCheck(operationSignal);
      const observation = validateManifestObservation(await abortable(provider.getManifest(frozen, { signal: operationSignal }), operationSignal), frozen);
      if (observation.status === 'failed') fail('DERIVATIVE_FAILED');
      if (observation.status !== 'success') fail('DERIVATIVE_PENDING');
      if (rootId === undefined) { if (observation.roots.length !== 1) fail('DERIVATIVE_AMBIGUOUS'); rootId = observation.roots[0].rootId; }
      identifier(rootId, 'DERIVATIVE_AMBIGUOUS');
      if (!observation.roots.some(root => root.rootId === rootId)) fail('DERIVATIVE_AMBIGUOUS');
      const plan = validatePlan(await abortable(provider.getDownloadPlan(frozen, { rootId, signal: operationSignal }), operationSignal), frozen, rootId, limits);
      const planDigest = digest(plan);
      const jobRoot = path.join(work, job.jobId);
      const base = path.join(jobRoot, planDigest);
      const modelDirectory = path.join(base, 'model');
      validatePrevious(previous, plan, planDigest, modelDirectory);
      if (inside(modelDirectory, frozen.source.snapshotPath) || inside(path.dirname(frozen.source.snapshotPath), modelDirectory) || inside(modelDirectory, frozen.output)) fail('UNSAFE_PATH');
      await inspectLocal(path.join(modelDirectory, 'output', '0'), { directory: true, create: true });
      const partsDirectory = path.join(base, 'parts');
      await inspectLocal(partsDirectory, { directory: true, create: true });
      state = { schemaVersion: 1, status: 'downloading', planDigest, rootId, checkpoints: clone(previous?.checkpoints ?? {}), modelDirectory };
      // Parent's store is authoritative. No additional download ledger is read.
      await onCheckpoint(clone(state));
      for (const filename of ['model.json', 'integrity.json']) {
        const target = path.join(modelDirectory, filename);
        if (await optionalFile(target)) await fs.unlink(target);
      }
      for (const resource of plan.resources) {
        abortCheck(operationSignal);
        const filename = path.join(modelDirectory, ...resource.path.split('/'));
        let reusable = false;
        const checkpoint = state.checkpoints[resource.path];
        if (checkpoint && await optionalFile(filename)) {
          const actual = await hashLocal(filename, limits.maxFileBytes, operationSignal);
          reusable = actual.bytes === resource.bytes && actual.bytes === checkpoint.bytes && actual.sha256 === checkpoint.sha256 && (resource.sha256 === undefined || resource.sha256 === actual.sha256);
        }
        if (reusable) continue;
        delete state.checkpoints[resource.path];
        const temporary = path.join(partsDirectory, `resource-${randomUUID()}.part`);
        const handle = await fs.open(temporary, 'wx', 0o600);
        let iterable, iterator, streamHash = createHash('sha256'), total = 0;
        try {
          iterable = await abortable(provider.readResource(frozen, { resourceId: resource.resourceId, signal: operationSignal }), operationSignal);
          if (!iterable || typeof iterable[Symbol.asyncIterator] !== 'function') fail('DOWNLOAD_INVALID');
          iterator = iterable[Symbol.asyncIterator]();
          while (true) {
            abortCheck(operationSignal);
            const item = await abortable(iterator.next(), operationSignal);
            if (item.done) break;
            abortCheck(operationSignal);
            if (!Buffer.isBuffer(item.value) && !(item.value instanceof Uint8Array)) fail('DOWNLOAD_INVALID');
            const chunk = Buffer.from(item.value);
            total += chunk.length;
            if (total > resource.bytes || total > limits.maxFileBytes) fail('PACKAGE_LIMIT_EXCEEDED');
            streamHash.update(chunk);
            let offset = 0;
            while (offset < chunk.length) { const written = await handle.write(chunk, offset, chunk.length - offset); if (!written.bytesWritten) fail('DOWNLOAD_INVALID'); offset += written.bytesWritten; }
          }
          if (total !== resource.bytes) fail('DOWNLOAD_INVALID');
          const sha256 = streamHash.digest('hex');
          if (resource.sha256 !== undefined && sha256 !== resource.sha256) fail('DOWNLOAD_INVALID');
          await handle.sync(); await handle.close();
          await optionalFile(filename);
          await fs.rename(temporary, filename);
          state.checkpoints[resource.path] = { bytes: total, sha256, resourceId: resource.resourceId };
          // A failed checkpoint commit blocks all later dependent work.
          await onCheckpoint(clone(state));
        } finally {
          await handle.close().catch(() => {});
          try { iterable?.destroy?.(); } catch { /* Foreign cleanup must not expose provider messages. */ }
          try { if (iterator?.return) Promise.resolve(iterator.return()).catch(() => {}); } catch { /* Same boundary as provider destruction. */ }
          if (path.dirname(temporary) !== partsDirectory || !path.basename(temporary).startsWith('resource-')) fail('UNSAFE_PATH');
          await fs.rm(temporary, { force: true });
        }
      }
      const expected = new Set(plan.resources.map(row => path.basename(row.path)));
      const actualFiles = await fs.readdir(path.join(modelDirectory, 'output', '0'));
      if (actualFiles.length !== expected.size || actualFiles.some(name => !expected.has(name))) fail('DOWNLOAD_INCOMPLETE');
      const inventory = [];
      for (const row of plan.resources) {
        const result = await hashLocal(path.join(modelDirectory, ...row.path.split('/')), limits.maxFileBytes, operationSignal);
        const checkpoint = state.checkpoints[row.path];
        if (!checkpoint || result.bytes !== row.bytes || result.bytes !== checkpoint.bytes || result.sha256 !== checkpoint.sha256) fail('DOWNLOAD_INCOMPLETE');
        inventory.push({ path: 'resources/' + row.path, ...result });
      }
      const paths = new Map(plan.resources.map(row => ['resources/' + row.path, path.join(modelDirectory, ...row.path.split('/'))]));
      // Transport and its byte/hash inventory have a separate bounded budget.
      // Package validation retains its own fixed ten-minute profile deadline.
      abortCheck(operationSignal);
      clearTimeout(downloadTimer);
      operationSignal = signal;
      try {
        await packageApi.validateProfile({ resources: inventory,
          read: async (name, { maxBytes }) => {
            const target = paths.get(name); if (!target) fail('DOWNLOAD_INCOMPLETE');
            const { stat } = await inspectLocal(target); if (stat.size > maxBytes) fail('PACKAGE_LIMIT_EXCEEDED');
            return fs.readFile(target);
          }, stream: name => { const target = paths.get(name); if (!target) fail('DOWNLOAD_INCOMPLETE'); return createReadStream(target, { signal: operationSignal }); },
        }, { signal: operationSignal });
      } catch (error) { throw packageFailure(error, 'DOWNLOAD_INCOMPLETE'); }
      const integrity = Object.fromEntries(plan.resources.map(row => [row.path, { bytes: state.checkpoints[row.path].bytes, sha256: state.checkpoints[row.path].sha256, transport: 'raw-http-v1' }]));
      const descriptor = { name: frozen.source.name, format: 'svf', entrypoint: '/model/output/0/0.svf', viewerVersion: '7.130.0', preparedAt: nowIso(clock), sourceBytes: frozen.source.bytes, resourceCount: inventory.length, totalBytes: inventory.reduce((sum, row) => sum + row.bytes, 0) };
      await replaceJson(path.join(modelDirectory, 'integrity.json'), integrity);
      await replaceJson(path.join(modelDirectory, 'model.json'), descriptor);
      abortCheck(operationSignal);
      state.status = 'downloaded';
      await onCheckpoint(clone(state));
      return { modelDirectory, download: clone(state) };
    } catch (error) {
      // The orchestrator records interruption/error. Do not retry a failed
      // state commit or replace durable checkpoint evidence in this catch.
      if (signal?.aborted) throw new CoreError('LOCAL_ABORTED');
      if (downloadBudget.signal.aborted) throw new CoreError('PACKAGE_LIMIT_EXCEEDED');
      if (error instanceof CoreError) throw error;
      throw new CoreError('PROVIDER_FAILURE');
    } finally {
      clearTimeout(downloadTimer);
    }
  }
  async function buildPackage(job, { modelDirectory, signal } = {}) {
    abortCheck(signal);
    const frozen = jobContext(job);
    const local = validateLocalPath(modelDirectory, { label: 'model directory' });
    if (!inside(path.join(work, job.jobId), local) || samePath(path.join(work, job.jobId), local)) fail('UNSAFE_PATH');
    await inspectLocal(local, { directory: true });
    let snapshot;
    try { snapshot = await hashLocal(frozen.source.snapshotPath, limits.maxFileBytes, signal); }
    catch (error) { if (signal?.aborted) throw new CoreError('LOCAL_ABORTED'); throw packageFailure(error); }
    if (snapshot.bytes !== frozen.source.bytes || snapshot.sha256 !== frozen.source.sha256) fail('SNAPSHOT_CHANGED');
    try {
      await packageApi.packModel({ modelDir: local, source: frozen.source.snapshotPath, output: frozen.output, label: frozen.label, signal });
      const result = await packageApi.verifyPackage(frozen.output, { signal });
      if (result.status !== 'PASS' || result.manifest.source.identityBasis !== 'observed-local-file' || result.manifest.source.name !== frozen.source.name || result.manifest.source.sha256 !== frozen.source.sha256 || result.manifest.source.bytes !== frozen.source.bytes) fail('IDENTITY_MISMATCH');
      return { schemaVersion: 1, status: 'PASS', path: result.package.path, bytes: result.package.bytes,
        sha256: result.package.sha256, packageId: result.package.packageId, contentFingerprint: result.contentFingerprint,
        source: clone(result.manifest.source), resourceCount: result.resourceCount, totalRawBytes: result.totalRawBytes,
        verifiedAt: nowIso(clock), toolVersion: result.toolVersion };
    } catch (error) { if (signal?.aborted) throw new CoreError('LOCAL_ABORTED'); throw packageFailure(error); }
  }
  async function registerPackage(packagePath, { signal } = {}) {
    abortCheck(signal);
    const target = validateLocalPath(packagePath, { label: 'existing package' });
    await inspectLocal(target);
    try { return await packageApi.verifyPackage(target, { signal }); }
    catch (error) { if (signal?.aborted) throw new CoreError('LOCAL_ABORTED'); throw packageFailure(error); }
  }
  return Object.freeze({ download, buildPackage, registerPackage });
}
