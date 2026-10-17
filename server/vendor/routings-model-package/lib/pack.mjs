import * as fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { writeZip } from './zip.mjs';
import { parseJson } from './json.mjs';
import { validateManifest, computeFingerprint } from './manifest.mjs';
import { validateProfile } from './profile.mjs';
import { validateResourcePath, assertNoCaseCollisions, assertLocalNoLinks } from './paths.mjs';
import { resolveLimits } from './limits.mjs';
import { fail } from './errors.mjs';
import { hashFile, readBounded, exists, contained, ensureOutputParent, publishFile, writeJsonAtomic, checkAbort, decodeJsonText } from './io.mjs';
import { verifyPackage } from './verify.mjs';

async function inventory(root, limits, signal) {
  const rows = []; let total = 0;
  const visit = async relative => {
    checkAbort(signal);
    const directory = path.join(root, relative);
    await assertLocalNoLinks(directory, { directory: true });
    for (const item of await fs.readdir(directory, { withFileTypes: true })) {
      const name = path.join(relative, item.name);
      const file = path.join(root, name);
      const stat = await fs.lstat(file);
      if (stat.isSymbolicLink()) fail('UNSAFE_PATH', 'Input links/reparse points are forbidden.', { file });
      if (stat.isDirectory()) await visit(name);
      else {
        if (!stat.isFile()) fail('UNSAFE_PATH', 'Input device/special files are forbidden.', { file });
        if (rows.length >= limits.maxFiles) fail('PACKAGE_LIMIT_EXCEEDED', 'Resource count exceeded limit.');
        const resourcePath = `resources/${name.split(path.sep).join('/')}`;
        validateResourcePath(resourcePath);
        const result = await hashFile(file, { maxBytes: limits.maxFileBytes, signal });
        total += result.bytes;
        if (total > limits.maxTotalResourceBytes) fail('PACKAGE_LIMIT_EXCEEDED', 'Total raw resource bytes exceeded limit.');
        rows.push({ path: resourcePath, ...result, localPath: file });
      }
    }
  };
  await visit('output');
  rows.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  assertNoCaseCollisions(rows.map(row => row.path));
  return rows;
}

async function withLockMutex(lockPath, operation, retry = false) {
  const mutexPath = `${lockPath}.mutex`;
  let claimed = false;
  for (let attempt = 0; attempt < (retry ? 100 : 1); attempt++) {
    try { await fs.mkdir(mutexPath, { mode: 0o700 }); claimed = true; break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (!retry) fail('OUTPUT_BUSY', 'Another lock lifecycle operation owns the mutex; no stale mutex is automatically deleted.');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  if (!claimed) fail('OUTPUT_BUSY', 'Lock lifecycle mutex remains busy; it was preserved.');
  try { return await operation(); }
  finally { await fs.rmdir(mutexPath); }
}

async function acquireLock(lockPath, recover, startedAt) {
  return withLockMutex(lockPath, async () => {
    if (recover && await exists(lockPath)) {
      const old = parseJson(decodeJsonText(await readBounded(lockPath, 4096)));
      if (!Number.isSafeInteger(old.pid) || old.pid < 1) fail('OUTPUT_BUSY', 'Unrecognized publication lock; preserved for inspection.');
      let alive = true;
      try { process.kill(old.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
      if (alive) fail('OUTPUT_BUSY', 'The publication owner is still running; its lock was preserved.');
      // Every tool acquisition/recovery/release uses the same exclusive mutex.
      // It prevents two recoverers from deleting a newly acquired tool lock.
      await fs.unlink(lockPath);
    }
    let handle;
    try { handle = await fs.open(lockPath, 'wx', 0o600); }
    catch (error) { if (error.code === 'EEXIST') fail('OUTPUT_BUSY', 'Another publication owns this output; use recovery only after its process stopped.'); throw error; }
    const nonce = randomUUID();
    try { await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt, nonce }) + '\n'); }
    catch (error) { await handle.close(); await fs.unlink(lockPath); throw error; }
    return { handle, nonce };
  });
}

async function releaseLock(lockPath, lock) {
  try {
    await withLockMutex(lockPath, async () => {
      const pathnameStat = await fs.lstat(lockPath);
      const handleStat = await lock.handle.stat();
      const owner = parseJson(decodeJsonText(await readBounded(lockPath, 4096)));
      if (pathnameStat.ino !== handleStat.ino || owner.nonce !== lock.nonce || owner.pid !== process.pid) fail('OUTPUT_BUSY', 'Lock ownership changed; the other lock was preserved.');
      await fs.unlink(lockPath);
    }, true);
  } finally { await lock.handle.close(); }
}

export async function packModel(options) {
  const startedAt = new Date().toISOString();
  const limits = resolveLimits(options.limits ?? {});
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(limits.maxMs)]) : AbortSignal.timeout(limits.maxMs);
  checkAbort(signal);
  const modelDir = await assertLocalNoLinks(path.resolve(options.modelDir), { directory: true });
  const sourcePath = await assertLocalNoLinks(path.resolve(options.source));
  const forbiddenRoots = [modelDir, path.dirname(sourcePath)];
  const output = await ensureOutputParent(options.output, forbiddenRoots);
  if (output.toLowerCase() === sourcePath.toLowerCase()) fail('UNSAFE_PATH', 'Output cannot overwrite the source NWD.');
  const manifestPath = options.manifest ?? `${output}.manifest.json`;
  const reportPath = options.report ?? `${output}.validation.json`;
  for (const file of [manifestPath, reportPath]) {
    if (path.resolve(file).toLowerCase() === output.toLowerCase() || path.resolve(file).toLowerCase() === sourcePath.toLowerCase() || forbiddenRoots.some(root => contained(root, file))) fail('UNSAFE_PATH', 'Reports cannot overwrite package/input files.');
  }
  if (path.resolve(manifestPath).toLowerCase() === path.resolve(reportPath).toLowerCase()) fail('UNSAFE_PATH', 'Manifest and report outputs must differ.');
  const lockPath = `${output}.lock`, journalPath = `${output}.publication.json`;
  for (const file of [manifestPath, reportPath]) {
    if ([lockPath, journalPath].some(reserved => path.resolve(reserved).toLowerCase() === path.resolve(file).toLowerCase()) || contained(`${lockPath}.mutex`, file)) fail('UNSAFE_PATH', 'Sidecars cannot alias reserved lock/publication files.');
  }
  const lock = await acquireLock(lockPath, options.recover, startedAt);
  let staging;
  try {
    const meta = parseJson(decodeJsonText(await readBounded(path.join(modelDir, 'model.json'), limits.maxManifestBytes, signal)));
    if (meta.format !== 'svf' || meta.viewerVersion !== '7.130.0' || meta.entrypoint !== '/model/output/0/0.svf') fail('UNSUPPORTED_PROFILE', 'Local model descriptor is not the supported offline SVF snapshot profile.');
    const source = { name: path.basename(sourcePath), ...(await hashFile(sourcePath, { maxBytes: limits.maxFileBytes, signal })), identityBasis: 'observed-local-file' };
    if (meta.name !== source.name || meta.sourceBytes !== source.bytes) fail('PROVENANCE_CONFLICT', 'Observed source name/size differs from the local model descriptor.');
    const rows = await inventory(modelDir, limits, signal);
    if (meta.resourceCount !== rows.length || meta.totalBytes !== rows.reduce((sum, row) => sum + row.bytes, 0)) fail('RESOURCE_SIZE_MISMATCH', 'Physical model inventory differs from model.json.');
    const integrity = parseJson(decodeJsonText(await readBounded(path.join(modelDir, 'integrity.json'), limits.maxManifestBytes, signal)));
    const names = new Set(rows.map(row => row.path.slice('resources/'.length)));
    if (Object.keys(integrity).length !== rows.length || Object.keys(integrity).some(name => !names.has(name))) fail('RESOURCE_UNEXPECTED', 'integrity.json does not list exactly the full output inventory.');
    for (const row of rows) {
      const expected = integrity[row.path.slice('resources/'.length)];
      if (!expected || expected.bytes !== row.bytes) fail('RESOURCE_SIZE_MISMATCH', 'Input integrity record size differs.', { path: row.path });
      if (expected.sha256 !== row.sha256) fail('RESOURCE_HASH_MISMATCH', 'Input integrity record SHA differs.', { path: row.path });
    }
    const resources = rows.map(({ localPath, ...row }) => row);
    const base = { schemaVersion: 1, packageId: options.packageId ?? randomUUID(), label: options.label,
      source, preparedAt: options.preparedAt ?? new Date().toISOString(), supportProfile: 'svf-local-7.130.0-v1',
      format: 'svf', sdkVersion: '7.130.0', entrypoint: 'resources/output/0/0.svf', resources };
    base.contentFingerprint = computeFingerprint(base);
    if (options.expectedFingerprint && base.contentFingerprint !== options.expectedFingerprint) fail('FINGERPRINT_MISMATCH', 'Local model bytes differ from requested baseline snapshot.');
    const reservedIdentity = await exists(journalPath);
    if (reservedIdentity) {
      const reserved = parseJson(decodeJsonText(await readBounded(journalPath, limits.maxManifestBytes, signal)));
      if (reserved.contentFingerprint !== base.contentFingerprint || !isDeepStrictEqual(reserved.source, source) || reserved.label !== options.label || (options.packageId && options.packageId !== reserved.packageId) || (options.preparedAt && options.preparedAt !== reserved.preparedAt)) fail('PACKAGE_ID_CONFLICT', 'A prior publication reserved a different identity/input; retry cannot silently replace it.');
      base.packageId = reserved.packageId; base.preparedAt = reserved.preparedAt;
    }
    validateManifest(base, { limits });
    const lookup = new Map(rows.map(row => [row.path, row.localPath]));
    const profile = await validateProfile({ resources, read: (name, { maxBytes = limits.maxNestedBytes } = {}) => readBounded(lookup.get(name), maxBytes, signal), stream: name => createReadStream(lookup.get(name), { signal }) }, { limits, signal });
    let verification;
    let resumed = false;
    if (await exists(output)) {
      verification = await verifyPackage(output, { limits, expectedFingerprint: base.contentFingerprint, signal });
      const prior = verification.manifest;
      if (reservedIdentity && (prior.packageId !== base.packageId || prior.preparedAt !== base.preparedAt)) fail('PACKAGE_ID_CONFLICT', 'Existing output contradicts the reserved publication UUID/time; both were preserved.');
      if (!isDeepStrictEqual(prior.source, base.source) || prior.label !== base.label || (options.packageId && options.packageId !== prior.packageId) || (options.preparedAt && options.preparedAt !== prior.preparedAt)) fail('PACKAGE_ID_CONFLICT', 'Existing good output has a different reserved identity; it was preserved.');
      base.packageId = prior.packageId; base.preparedAt = prior.preparedAt; resumed = true;
    } else {
      if (!(await exists(journalPath))) await writeJsonAtomic(journalPath, { packageId: base.packageId, label: base.label, preparedAt: base.preparedAt, source: base.source, contentFingerprint: base.contentFingerprint }, { forbiddenRoots });
      staging = await fs.mkdtemp(path.join(path.dirname(output), '.routings-stage-'));
      const stagedZip = path.join(staging, 'model.zip');
      await writeZip(stagedZip, [{ name: 'manifest.json', data: Buffer.from(JSON.stringify(base, null, 2) + '\n', 'utf8') }, ...rows.map(row => ({ name: row.path, path: row.localPath }))], { limits, signal });
      verification = await verifyPackage(stagedZip, { limits, expectedFingerprint: base.contentFingerprint, signal });
      const sourceReadback = await hashFile(sourcePath, { maxBytes: limits.maxFileBytes, signal });
      if (sourceReadback.bytes !== source.bytes || sourceReadback.sha256 !== source.sha256) fail('RESOURCE_CHANGED', 'Source NWD changed during packaging; nothing was published.');
      checkAbort(signal);
      await publishFile(stagedZip, output);
      verification.package.path = output;
    }
    if (!(await exists(manifestPath))) await writeJsonAtomic(manifestPath, base, { forbiddenRoots });
    else if (!isDeepStrictEqual(parseJson(decodeJsonText(await readBounded(manifestPath, limits.maxManifestBytes, signal))), base)) fail('OUTPUT_EXISTS', 'Existing sidecar manifest differs; it was preserved.');
    const result = { ...verification, operation: 'pack', startedAt, finishedAt: new Date().toISOString(),
      input: { modelDir, sourcePath }, sourceIdentity: source, publication: { status: 'PASS', resumed, manifestPath: path.resolve(manifestPath), reportPath: path.resolve(reportPath) }, preflightProfile: profile };
    // A repeated successful publication retains its archive/identity and may
    // refresh only its explicitly requested validation evidence sidecar.
    if (await exists(reportPath)) {
      const previousReport = parseJson(decodeJsonText(await readBounded(reportPath, limits.maxManifestBytes, signal)));
      if (!resumed || previousReport.toolVersion !== '1.0.0' || previousReport.status !== 'PASS' || previousReport.package?.packageId !== base.packageId || previousReport.package?.sha256 !== verification.package.sha256) fail('OUTPUT_EXISTS', 'An existing unrelated report was preserved.');
    }
    await writeJsonAtomic(reportPath, result, { replace: resumed, forbiddenRoots });
    await fs.rm(journalPath, { force: true });
    return result;
  } finally {
    try {
      if (staging) {
        if (path.dirname(path.resolve(staging)).toLowerCase() !== path.dirname(output).toLowerCase() || !path.basename(staging).startsWith('.routings-stage-')) fail('UNSAFE_PATH', 'Unexpected staging cleanup target; preserved.');
        await fs.rm(staging, { recursive: true, force: true });
      }
    } finally { await releaseLock(lockPath, lock); }
  }
}
