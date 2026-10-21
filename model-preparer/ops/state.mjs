import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { MODES, ROOTS, boundedRead, canonical, exact, fail, hashFile, noLinks, parseJson, relative, SHA, UUID } from './common.mjs';

export async function auditState({ roots = ROOTS, runtimeRoot = '/opt/preparer', packageModule = '/opt/package/index.mjs', verifyPackages = true } = {}) {
  const { createStore, parsePersistentJson } = await import(pathToFileURL(path.join(runtimeRoot, 'lib/store.mjs')).href);
  const { validateStoredJob, digest } = await import(pathToFileURL(path.join(runtimeRoot, 'lib/contracts.mjs')).href);
  const modes = (await fs.readdir(roots.data)).sort();
  if (modes.some(name => !MODES.includes(name))) fail('UNKNOWN_DATA_NAMESPACE');
  const jobs = [], namespaces = [], references = [], orphanFiles = [], checked = new Map(), verifiedPackages = new Map();
  const mapped = value => {
    if (typeof value !== 'string' || !value.startsWith('/') || value.includes('\\')) fail('UNSAFE_REFERENCE');
    for (const [role, virtualRoot] of Object.entries(ROOTS)) if (value.startsWith(virtualRoot + '/')) {
      const rel = relative(value.slice(virtualRoot.length + 1)); if (!roots[role]) fail('MISSING_REFERENCE'); return { role, path: rel, filename: path.join(roots[role], ...rel.split('/')) };
    }
    fail('UNSAFE_REFERENCE');
  };
  const checkFile = async (virtualPath, expected, type) => {
    const entry = mapped(virtualPath); let actual = checked.get(virtualPath);
    if (!actual) { try { actual = await hashFile(entry.filename); } catch { fail('MISSING_OR_CHANGED_REFERENCE'); } checked.set(virtualPath, actual); }
    if (expected && (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256)) fail('MISSING_OR_CHANGED_REFERENCE');
    if (!references.some(value => value.virtualPath === virtualPath)) references.push({ type, virtualPath, role: entry.role, path: entry.path, ...actual }); return entry;
  };
  for (const mode of modes) {
    const corePath = path.join(roots.data, mode, 'core'), servicePath = path.join(roots.data, mode, 'service');
    await noLinks(corePath, { directory: true }); await noLinks(servicePath, { directory: true });
    if ((await fs.readdir(path.join(corePath, 'locks'))).length) fail('UNSAFE_LOCK_HISTORY');
    for (const directory of [corePath, servicePath]) {
      const entries = await fs.readdir(directory);
      if (entries.some(name => /(?:mutex|service-owner\.json|\.initialize)/.test(name))) fail('UNSAFE_LOCK_HISTORY');
    }
    const store = createStore({ dataDirectory: corePath, workDirectory: path.join(roots.work, mode, 'core-work'), readOnly: true }); await store.init();
    const kindCounts = {};
    for (const kind of ['job', 'submission', 'target', 'cost']) {
      const values = await store.list(kind); kindCounts[kind] = values.length;
      if (kind !== 'job') continue;
      for (const value of values) {
        const job = validateStoredJob(value); jobs.push({ mode, job });
        if (job.kind === 'captured') await checkFile(job.frozen.source.snapshotPath, job.frozen.source, 'captured-source');
        const packages = [job.package, job.lastGoodPackage].filter(Boolean);
        for (const pkg of packages) {
          const entry = await checkFile(pkg.path, pkg, 'verified-package');
          if (verifyPackages) {
            const api = await import(pathToFileURL(packageModule).href);
            let report = verifiedPackages.get(entry.filename);
            if (!report) { report = await api.verifyPackage(entry.filename); verifiedPackages.set(entry.filename, report); }
            if (report.package.sha256 !== pkg.sha256 || report.package.bytes !== pkg.bytes || report.package.packageId !== pkg.packageId || report.contentFingerprint !== pkg.contentFingerprint) fail('PACKAGE_IDENTITY_CHANGED');
          }
        }
        if (job.download?.checkpoints) for (const [name, checkpoint] of Object.entries(job.download.checkpoints)) {
          relative(name); const virtualPath = `${job.download.modelDirectory}/${name}`;
          try { await checkFile(virtualPath, checkpoint, 'download-checkpoint'); }
          catch (error) { if (job.download.status === 'downloaded') throw error; orphanFiles.push({ mode, jobId: job.jobId, kind: 'unusable-partial-checkpoint', pathSha256: digest(virtualPath) }); }
        }
      }
    }
    const identity = parsePersistentJson(await boundedRead(path.join(servicePath, 'service-store.json')));
    exact(identity, ['schemaVersion', 'storeId']); if (identity.schemaVersion !== 1 || !UUID.test(identity.storeId)) fail('SERVICE_HISTORY_CORRUPT');
    const index = parsePersistentJson(await boundedRead(path.join(servicePath, 'service-index.json')));
    exact(index, ['schemaVersion', 'entries', 'checksum']); const kinds = ['operations', 'requests', 'uploads', 'artifacts', 'browser']; exact(index.entries, kinds);
    if (index.schemaVersion !== 1 || index.checksum !== digest(index.entries)) fail('SERVICE_HISTORY_CORRUPT');
    for (const kind of kinds) {
      const ids = index.entries[kind]; if (!Array.isArray(ids) || ids.some((id, i) => !UUID.test(id) || i > 0 && ids[i - 1] >= id)) fail('SERVICE_HISTORY_CORRUPT');
      const names = (await fs.readdir(path.join(servicePath, kind))).sort(); if (names.join(',') !== ids.map(id => `${id}.json`).join(',')) fail('SERVICE_HISTORY_CORRUPT');
      for (const id of ids) { const envelope = parsePersistentJson(await boundedRead(path.join(servicePath, kind, `${id}.json`))); exact(envelope, ['schemaVersion', 'id', 'kind', 'value', 'checksum']); if (envelope.schemaVersion !== 1 || envelope.id !== id || envelope.kind !== kind || envelope.checksum !== digest(envelope.value)) fail('SERVICE_HISTORY_CORRUPT'); }
    }
    const security = path.join(roots.data, mode, 'security');
    try { for (const name of await fs.readdir(security)) { if (name !== 'cost-hmac.key') fail('UNKNOWN_SECURITY_ARTIFACT'); const key = await noLinks(path.join(security, name)); if (key.size !== 32 || key.mode & 0o077) fail('PRIVATE_KEY_INVALID'); } }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    namespaces.push({ mode, coreStoreId: parsePersistentJson(await boundedRead(path.join(corePath, 'store.json'))).storeId, serviceStoreId: identity.storeId, counts: kindCounts });
  }
  // Original NWD chooser entries are optional when immutable captures provide
  // all job bytes. Include the exact locally available matching originals only.
  for (const { job } of jobs.filter(value => value.job.kind === 'captured')) {
    const source = job.frozen.source, virtualPath = `${ROOTS.sources}/${source.name}`;
    if (!roots.sources) continue;
    try { const actual = await hashFile(mapped(virtualPath).filename); if (actual.bytes === source.bytes && actual.sha256 === source.sha256) await checkFile(virtualPath, source, 'original-source-input'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (roots.proof) {
    // Preserve the narrowly mounted proof directory as historical provenance,
    // including opaque/expired inputs; none is passed to the restored provider.
    let proofEntries = 0; const proofJsonFiles = [];
    const visitProof = async rel => {
      if (++proofEntries > 200000 || rel.split('/').length > 64) fail('LIMIT_EXCEEDED');
      const file = path.join(roots.proof, ...rel.split('/')), stat = await fs.lstat(file);
      if (stat.isDirectory()) { for (const name of (await fs.readdir(file)).sort()) await visitProof(rel ? `${rel}/${name}` : name); }
      else { await checkFile(`${ROOTS.proof}/${relative(rel)}`, null, 'historical-proof-input'); if (rel.endsWith('.json')) proofJsonFiles.push(rel); }
    };
    for (const name of (await fs.readdir(roots.proof)).sort()) await visitProof(relative(name));
    for (const name of proofJsonFiles.sort()) {
      const file = path.join(roots.proof, ...name.split('/')); let proof; try { proof = parseJson(await boundedRead(file, 262144), 262144); } catch { continue; }
      if (proof.kind !== 'autodesk-account-operator-review') continue;
      for (const artifact of proof.observations?.artifacts ?? []) {
        if (!artifact || typeof artifact.name !== 'string' || artifact.name.includes('/') || !SHA.test(artifact.sha256) || !Number.isSafeInteger(artifact.bytes) || artifact.bytes < 0) fail('INVALID_PROOF_REFERENCE');
        const directory = path.posix.dirname(name), rel = relative(directory === '.' ? artifact.name : `${directory}/${artifact.name}`);
        await checkFile(`${ROOTS.proof}/${rel}`, artifact, 'proof-observation');
      }
    }
  }
  return { namespaces, jobs: jobs.map(({ mode, job }) => ({ mode, jobId: job.jobId, kind: job.kind, status: job.status, frozenDigest: job.frozenDigest,
    package: job.lastGoodPackage ? { bytes: job.lastGoodPackage.bytes, sha256: job.lastGoodPackage.sha256, packageId: job.lastGoodPackage.packageId, contentFingerprint: job.lastGoodPackage.contentFingerprint } : null,
    submissionAttempts: job.submission?.attempts?.length ?? 0 })), references, orphanFiles,
    historyPolicy: 'All committed revisions, heads, ledgers, allowances, captured snapshots and namespace identities are retained unchanged. Partial unusable checkpoints are classified, never reset.' };
}
