import path from 'node:path';
import * as fs from 'node:fs/promises';
import { openZip } from './zip.mjs';
import { parseManifest, computeFingerprint, canonicalFingerprintInput } from './manifest.mjs';
import { validateProfile } from './profile.mjs';
import { resolveLimits } from './limits.mjs';
import { fail } from './errors.mjs';
import { assertLocalNoLinks } from './paths.mjs';
import { hashFile, hashStream, extractVerified, checkAbort, decodeJsonText } from './io.mjs';

export async function verifyPackage(input, options = {}) {
  const startedAt = new Date().toISOString();
  const limits = resolveLimits(options.limits ?? {});
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(limits.maxMs)]) : AbortSignal.timeout(limits.maxMs);
  const packagePath = await assertLocalNoLinks(path.resolve(input));
  const before = await fs.stat(packagePath);
  checkAbort(signal);
  const transport = await hashFile(packagePath, { maxBytes: limits.maxArchiveBytes, signal });
  const archive = await openZip(packagePath, { limits, signal });
  try {
    const root = archive.entries.get('manifest.json');
    if (!root || root.isDirectory) fail('INVALID_MANIFEST', 'ZIP must contain one root manifest.json.');
    const manifest = parseManifest(decodeJsonText(await archive.read('manifest.json', { maxBytes: limits.maxManifestBytes, signal })), { limits });
    const expectedNames = new Set(['manifest.json', ...manifest.resources.map(resource => resource.path)]);
    const directoryParents = new Set();
    for (const name of expectedNames) {
      const parts = name.split('/');
      for (let index = 1; index < parts.length; index++) directoryParents.add(parts.slice(0, index).join('/') + '/');
    }
    for (const entry of archive.entries.values()) {
      if (entry.isDirectory ? !directoryParents.has(entry.name) : !expectedNames.has(entry.name)) {
        fail('RESOURCE_UNEXPECTED', 'ZIP contains an unlisted file or unrelated directory.', { path: entry.name });
      }
    }
    let totalBytes = 0;
    const resources = [];
    for (const record of manifest.resources) {
      checkAbort(signal);
      const entry = archive.entries.get(record.path);
      if (!entry || entry.isDirectory) fail('RESOURCE_MISSING', 'A manifest resource is missing.', { path: record.path });
      if (entry.bytes !== record.bytes) fail('RESOURCE_SIZE_MISMATCH', 'Archive and manifest sizes disagree.', { path: record.path });
      const result = await hashStream(archive.stream(record.path, { maxBytes: limits.maxFileBytes, signal }), { maxBytes: limits.maxFileBytes, expectedBytes: record.bytes, signal });
      totalBytes += result.bytes;
      if (totalBytes > limits.maxTotalResourceBytes) fail('PACKAGE_LIMIT_EXCEEDED', 'Actual total resource bytes exceeded limit.');
      if (result.sha256 !== record.sha256) fail('RESOURCE_HASH_MISMATCH', 'Raw SHA-256 does not match the manifest.', { path: record.path });
      resources.push({ ...record, verifiedSha256: result.sha256 });
    }
    const actualFingerprint = computeFingerprint(manifest);
    if (actualFingerprint !== manifest.contentFingerprint) fail('FINGERPRINT_MISMATCH', 'Content fingerprint does not match canonical inventory.');
    if (options.expectedFingerprint && actualFingerprint !== options.expectedFingerprint) fail('FINGERPRINT_MISMATCH', 'Content differs from the requested snapshot.', { expected: options.expectedFingerprint, actual: actualFingerprint });
    const profile = await validateProfile({
      resources: manifest.resources,
      read: (name, readOptions = {}) => archive.read(name, { ...readOptions, signal }),
      stream: name => archive.stream(name, { signal }),
    }, { limits, signal });
    const after = await fs.stat(packagePath);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) fail('RESOURCE_CHANGED', 'Package changed during verification; its results were not published.');
    const transportReadback = await hashFile(packagePath, { maxBytes: limits.maxArchiveBytes, signal });
    if (transportReadback.sha256 !== transport.sha256) fail('RESOURCE_CHANGED', 'Transport ZIP SHA changed during verification.');
    const extraction = options.extractTo ? await extractVerified(archive, manifest, options.extractTo, signal) : null;
    const completedStat = await fs.stat(packagePath);
    if (completedStat.size !== before.size || completedStat.mtimeMs !== before.mtimeMs || completedStat.ino !== before.ino) fail('RESOURCE_CHANGED', 'Package identity changed before the operation completed.');
    return {
      reportSchemaVersion: 1, toolVersion: '1.0.0', nodeVersion: process.version,
      operation: 'verify', status: 'PASS', startedAt, finishedAt: new Date().toISOString(),
      package: { path: packagePath, bytes: transport.bytes, sha256: transport.sha256, packageId: manifest.packageId },
      contentFingerprint: actualFingerprint, canonicalBytes: canonicalFingerprintInput(manifest).length,
      resourceCount: resources.length, totalRawBytes: totalBytes, limits,
      checks: { portableManifest: 'PASS', safeArchive: 'PASS', rawInventory: 'PASS', fingerprint: 'PASS', supportedProfile: 'PASS', nestedReferences: 'PASS' },
      profile, extraction, manifest, resources,
      limitations: ['No Autodesk geometry/PackFile/SQLite semantic audit.', 'No source NWD is required or read by verifier.', 'No SDK, browser, WFC import, sessions, database or second-machine acceptance is implied.'],
    };
  } finally { await archive.close(); }
}
