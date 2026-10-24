// Read-only recovery evidence. Never import the application runtime, DB
// initializer, registry service or its audit method (which updates health).
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const plain = value => value && Object.getPrototypeOf(value) === Object.prototype;
export const MODEL_AUDIT_LIMITS = Object.freeze({ maxModels: 1000, maxArchives: 10000, maxResources: 1000000, maxFilesPerModel: 100000, maxFileBytes: 2 * 1024 ** 3, maxModelBytes: 8 * 1024 ** 3, maxArchiveBytes: 2 * 1024 ** 3, maxTotalBytes: 64 * 1024 ** 3, maxTempBytes: 2 * 1024 ** 3, maxManifestBytes: 32 * 1024 ** 2, maxMetadataBytes: 256 * 1024 ** 2, maxMs: 1800000, maxObjectMs: 600000 });
export class ModelAuditError extends Error { constructor(code) { super(code); this.name = 'ModelAuditError'; this.code = code; } }
const fail = code => { throw new ModelAuditError(code); };
function checkedLimits(input = {}) {
  if (!plain(input)) fail('MODEL_AUDIT_LIMIT_INVALID');
  const limits = { ...MODEL_AUDIT_LIMITS };
  for (const [key, value] of Object.entries(input)) { if (!Object.hasOwn(limits, key) || !Number.isSafeInteger(value) || value < 1 || value > limits[key]) fail('MODEL_AUDIT_LIMIT_INVALID'); limits[key] = value; }
  return Object.freeze(limits);
}
function interrupted(signal) { if (signal?.aborted) fail(signal.reason?.name === 'TimeoutError' ? 'MODEL_AUDIT_TIMEOUT' : 'MODEL_AUDIT_INTERRUPTED'); }
function exact(value, fields, code) { if (!plain(value) || Object.keys(value).sort().join('|') !== [...fields].sort().join('|')) fail(code); }
function number(value, maximum, code) {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/.test(value))) fail(code);
  const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum || Object.is(parsed, -0)) fail(code); return parsed;
}
async function noLinks(filename, { directory = false } = {}) {
  if (typeof filename !== 'string' || !path.isAbsolute(filename)) fail('MODEL_AUDIT_PRIVATE_PATH_INVALID');
  const absolute = path.resolve(filename), parsed = path.parse(absolute); let current = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part); const stat = await fs.lstat(current);
    if (stat.isSymbolicLink() || (current === absolute && !directory ? !stat.isFile() || stat.nlink !== 1 : !stat.isDirectory())) fail('MODEL_AUDIT_PRIVATE_PATH_INVALID');
  }
  const real = await fs.realpath(absolute); if ((process.platform === 'win32' ? real.toLowerCase() : real) !== (process.platform === 'win32' ? absolute.toLowerCase() : absolute)) fail('MODEL_AUDIT_PRIVATE_PATH_INVALID');
  return absolute;
}
function resourcePath(value) {
  if (typeof value !== 'string' || value.length > 1024 || !/^resources\/[A-Za-z0-9._/-]+$/.test(value) || !/(?:\.svf|\.pf|\.bin|\.pack|\.json\.gz|\.db)$/.test(value)) fail('MODEL_MANIFEST_INVALID');
  for (const part of value.split('/')) if (!part || part === '.' || part === '..' || part.length > 255 || /[. ]$/.test(part) || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part)) fail('MODEL_MANIFEST_INVALID');
}
function checkedManifest(manifest, limits) {
  exact(manifest, ['schemaVersion', 'packageId', 'label', 'source', 'preparedAt', 'supportProfile', 'format', 'sdkVersion', 'entrypoint', 'resources', 'contentFingerprint'], 'MODEL_MANIFEST_INVALID');
  if (manifest.schemaVersion !== 1 || manifest.supportProfile !== 'svf-local-7.130.0-v1' || manifest.format !== 'svf' || manifest.sdkVersion !== '7.130.0' || manifest.entrypoint !== 'resources/output/0/0.svf' || typeof manifest.packageId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(manifest.packageId)) fail('MODEL_MANIFEST_INVALID');
  const text = (value, max) => typeof value === 'string' && value.length > 0 && [...value].length <= max && value.trim() === value && !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value);
  const instant = typeof manifest.preparedAt === 'string' && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/.exec(manifest.preparedAt);
  if (!text(manifest.label, 200) || !instant || !Number.isFinite(Date.parse(manifest.preparedAt))) fail('MODEL_MANIFEST_INVALID');
  const [year, month, day, hour, minute, second] = instant.slice(1).map(Number), leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0), days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59) fail('MODEL_MANIFEST_INVALID');
  exact(manifest.source, ['name', 'bytes', 'sha256', 'identityBasis'], 'MODEL_MANIFEST_INVALID');
  if (!text(manifest.source.name, 255) || /[\\/<>:"|?*%#]|[. ]$/.test(manifest.source.name) || /^(?:\.|\.\.|CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(manifest.source.name) || !SHA.test(manifest.source.sha256 || '') || !['observed-local-file', 'captured-at-conversion'].includes(manifest.source.identityBasis)) fail('MODEL_MANIFEST_INVALID');
  if (typeof manifest.source.bytes !== 'number') fail('MODEL_MANIFEST_INVALID'); number(manifest.source.bytes, Number.MAX_SAFE_INTEGER, 'MODEL_MANIFEST_INVALID');
  if (!Array.isArray(manifest.resources) || !manifest.resources.length || manifest.resources.length > limits.maxFilesPerModel) fail('MODEL_MANIFEST_INVALID');
  let totalBytes = 0, previous = ''; const names = new Map();
  const lines = ['wfc-model-content-v1', 'schemaVersion=1', 'supportProfile=svf-local-7.130.0-v1', 'format=svf', 'sdkVersion=7.130.0', 'entrypoint=resources/output/0/0.svf'];
  for (const resource of manifest.resources) {
    exact(resource, ['path', 'bytes', 'sha256'], 'MODEL_MANIFEST_INVALID'); resourcePath(resource.path);
    if (resource.path <= previous || typeof resource.bytes !== 'number' || !SHA.test(resource.sha256 || '')) fail('MODEL_MANIFEST_INVALID'); previous = resource.path;
    const bytes = number(resource.bytes, limits.maxFileBytes, 'MODEL_MANIFEST_INVALID'); totalBytes += bytes;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.maxModelBytes) fail('MODEL_AUDIT_LIMIT_EXCEEDED');
    const parts = resource.path.split('/');
    for (let index = 1; index <= parts.length; index++) { const name = parts.slice(0, index).join('/'), kind = index === parts.length ? 'file' : 'directory', key = name.toLowerCase(), old = names.get(key); if (old && (old.name !== name || old.kind !== kind || kind === 'file')) fail('MODEL_MANIFEST_INVALID'); names.set(key, { name, kind }); }
    lines.push(`${resource.path}\t${bytes}\t${resource.sha256}`);
  }
  if (!manifest.resources.some(resource => resource.path === manifest.entrypoint)) fail('MODEL_MANIFEST_INVALID');
  const fingerprint = hash(Buffer.from(lines.join('\n') + '\n'));
  if (manifest.contentFingerprint !== fingerprint) fail('MODEL_FINGERPRINT_MISMATCH');
  return { totalBytes, resourceCount: manifest.resources.length, fingerprint, manifestHash: hash(Buffer.from(JSON.stringify(manifest))) };
}
function checkedVersion(row, limits) {
  if (!plain(row) || !UUID.test(row.id || '') || !UUID.test(row.project_id || '') || !UUID.test(row.package_id || '') || row.state !== 'ready' || !['healthy', 'unavailable'].includes(row.health) || row.failure !== null || !UUID.test(row.validation_report_id || '') || row.imported_at == null || !Number.isFinite(new Date(row.imported_at).getTime())) fail('MODEL_VERSION_INVALID');
  const prefix = `projects/${row.project_id}/versions/${row.id}/`;
  if (row.storage_prefix !== prefix) fail('MODEL_STORAGE_PREFIX_INVALID');
  const checked = checkedManifest(row.manifest, limits);
  if (row.package_id !== row.manifest.packageId || row.label !== row.manifest.label || !isDeepStrictEqual(row.source, row.manifest.source) || row.schema_version !== 1 || row.support_profile !== row.manifest.supportProfile || row.format !== row.manifest.format || row.sdk_version !== row.manifest.sdkVersion || row.entrypoint !== row.manifest.entrypoint || new Date(row.prepared_at).getTime() !== Date.parse(row.manifest.preparedAt) || row.content_fingerprint !== checked.fingerprint || number(row.resource_count, limits.maxFilesPerModel, 'MODEL_VERSION_INVALID') !== checked.resourceCount || number(row.total_bytes, limits.maxModelBytes, 'MODEL_VERSION_INVALID') !== checked.totalBytes) fail('MODEL_VERSION_MANIFEST_MISMATCH');
  return { row, ...checked, prefix };
}
function checkedArchive(row, limits) {
  if (!plain(row) || !UUID.test(row.project_id || '') || !UUID.test(row.model_version_id || '') || !UUID.test(row.import_id || '') || row.published !== true || row.cleaned_at !== null || !SHA.test(row.archive_sha256 || '')) fail('MODEL_ARCHIVE_INVALID');
  const prefix = `archives/${row.project_id}/${row.import_id}/`; if (row.storage_prefix !== prefix) fail('MODEL_STORAGE_PREFIX_INVALID');
  const bytes = number(row.archive_bytes, limits.maxArchiveBytes, 'MODEL_ARCHIVE_INVALID'); if (!bytes) fail('MODEL_ARCHIVE_INVALID');
  return { row, bytes, sha256: row.archive_sha256, key: prefix + 'package.zip' };
}
async function withSignal(promise, signal, onLate) {
  let settled = false, abortListener;
  const observed = Promise.resolve(promise); observed.then(value => { if (settled && signal?.aborted) { try { onLate?.(value); } catch {} } }, () => {});
  if (signal?.aborted) { settled = true; interrupted(signal); }
  try { return await Promise.race([observed, new Promise((resolve, reject) => { abortListener = () => { try { interrupted(signal); } catch (error) { reject(error); } }; signal?.addEventListener('abort', abortListener, { once: true }); if (signal?.aborted) abortListener(); })]); }
  finally { settled = true; signal?.removeEventListener('abort', abortListener); }
}

/** pool and storage are injected read-only transports; no initialization occurs. */
export async function auditRecoveredModels({ pool, storage, verifyPackage, privateDirectory, signal, limits: input = {}, ownerId = null } = {}) {
  const limits = checkedLimits(input), active = signal ? AbortSignal.any([signal, AbortSignal.timeout(limits.maxMs)]) : AbortSignal.timeout(limits.maxMs);
  if (typeof pool?.connect !== 'function' || typeof storage?.getObject !== 'function' || typeof verifyPackage !== 'function' || typeof privateDirectory !== 'string' || !path.isAbsolute(privateDirectory) || ownerId !== null && !UUID.test(ownerId)) fail('MODEL_AUDIT_ARGUMENT_INVALID');
  interrupted(active);
  await noLinks(path.dirname(privateDirectory), { directory: true });
  try { await fs.mkdir(privateDirectory, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const directory = await noLinks(privateDirectory, { directory: true }); if ((await fs.readdir(directory)).length) fail('MODEL_AUDIT_DIRECTORY_NOT_EMPTY');
  const reportPath = path.join(directory, 'model-audit.private.json');
  const report = { schemaVersion: 'wfc.preparer.model-integrity-audit.v1', ownerId, status: 'RUNNING', startedAt: new Date().toISOString(), database: { transaction: 'REPEATABLE READ READ ONLY', mutationQueries: 0 }, limits, archivesSchema: null, models: [], archives: [], limitations: ['Read-only integrity evidence; no application initialization, health updates, browser acceptance, original NWD comparison or engineering acceptance.', 'Undeclared storage/staging objects remain covered by the cold storage archive; this audit does not infer mappings for them.'] };
  const counts = { models: 0, resources: 0, resourceBytes: 0, archives: 0, archiveBytes: 0, legacyArchiveAbsent: 0, retainedIndependentArchives: 0, unavailableDeclarations: 0 };
  let client, transaction = false, committed = false, totalRead = 0, metadataBytes = 0, context = null;
  const query = async (text, values = []) => { interrupted(active); return withSignal(client.query({ text, values, query_timeout: Math.min(30000, limits.maxMs) }), active); };
  const writeReport = async () => { report.finishedAt = new Date().toISOString(); report.counts = counts; const data = Buffer.from(JSON.stringify(report, null, 2) + '\n'); if (data.length > limits.maxMetadataBytes || data.length > limits.maxTempBytes) fail('MODEL_AUDIT_LIMIT_EXCEEDED'); const handle = await fs.open(reportPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600); try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); } return { reportSha256: hash(data), reportBytes: data.length }; };
  const readObject = async (key, expected, output) => {
    interrupted(active); const objectSignal = AbortSignal.any([active, AbortSignal.timeout(limits.maxObjectMs)]); let stream, abortListener;
    try {
      stream = await withSignal(Promise.resolve().then(() => storage.getObject(key, { signal: objectSignal })), objectSignal, late => late?.destroy?.());
      if (!stream || typeof stream[Symbol.asyncIterator] !== 'function' || typeof stream.destroy !== 'function') fail('MODEL_STORAGE_STREAM_INVALID');
      abortListener = () => { try { interrupted(objectSignal); } catch (error) { stream.destroy(error); } }; objectSignal.addEventListener('abort', abortListener, { once: true }); interrupted(objectSignal);
      const digest = createHash('sha256'); let bytes = 0;
      for await (const raw of stream) { interrupted(objectSignal); if (!(raw instanceof Uint8Array)) fail('MODEL_STORAGE_STREAM_INVALID'); const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength); bytes += chunk.length; totalRead += chunk.length; if (!Number.isSafeInteger(bytes) || bytes > expected.bytes || totalRead > limits.maxTotalBytes) fail('MODEL_RESOURCE_SIZE_MISMATCH'); digest.update(chunk); if (output) await output.writeFile(chunk); }
      if (bytes !== expected.bytes) fail('MODEL_RESOURCE_SIZE_MISMATCH'); if (digest.digest('hex') !== expected.sha256) fail('MODEL_RESOURCE_HASH_MISMATCH');
      return bytes;
    } catch (error) { interrupted(objectSignal); if (error instanceof ModelAuditError) throw error; fail('MODEL_STORAGE_READ_FAILED'); }
    finally { if (abortListener) objectSignal.removeEventListener('abort', abortListener); stream?.destroy?.(); }
  };
  try {
    client = await withSignal(pool.connect(), active, late => late?.release?.(true));
    await query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); transaction = true;
    const state = (await query("SELECT current_setting('transaction_read_only') AS read_only, current_setting('transaction_isolation') AS isolation")).rows;
    if (state.length !== 1 || state[0].read_only !== 'on' || state[0].isolation !== 'repeatable read') fail('MODEL_AUDIT_READ_ONLY_REQUIRED');
    const tables = (await query("SELECT to_regclass('public.model_versions') AS models, to_regclass('public.model_package_archives') AS archives")).rows;
    if (tables.length !== 1 || !/^(?:public\.)?model_versions$/.test(tables[0].models || '')) fail('MODEL_REGISTRY_ABSENT');
    const archivesPresent = tables[0].archives !== null; if (archivesPresent && !/^(?:public\.)?model_package_archives$/.test(tables[0].archives || '')) fail('MODEL_ARCHIVE_SCHEMA_INVALID');
    report.archivesSchema = archivesPresent ? 'PRESENT' : 'ABSENT_OLD_SCHEMA';
    // Bound JSON sizes on the server before transferring/parsing full manifests.
    const heads = (await query("SELECT id,project_id,octet_length(manifest::text) AS manifest_bytes,octet_length(source::text) AS source_bytes,octet_length(label) AS label_bytes FROM public.model_versions WHERE state='ready' ORDER BY project_id,id LIMIT $1", [limits.maxModels + 1])).rows;
    if (!Array.isArray(heads) || heads.length > limits.maxModels) fail('MODEL_AUDIT_LIMIT_EXCEEDED');
    for (const head of heads) { if (!UUID.test(head.id || '') || !UUID.test(head.project_id || '')) fail('MODEL_VERSION_INVALID'); metadataBytes += number(head.manifest_bytes, limits.maxManifestBytes, 'MODEL_AUDIT_LIMIT_EXCEEDED'); number(head.source_bytes, 4096, 'MODEL_AUDIT_LIMIT_EXCEEDED'); number(head.label_bytes, 800, 'MODEL_AUDIT_LIMIT_EXCEEDED'); if (metadataBytes > limits.maxMetadataBytes) fail('MODEL_AUDIT_LIMIT_EXCEEDED'); }
    const versions = new Map(); let plannedBytes = 0, plannedResources = 0;
    for (const head of heads) {
      const rows = (await query("SELECT * FROM public.model_versions WHERE id=$1 AND project_id=$2 AND state='ready'", [head.id, head.project_id])).rows;
      if (!Array.isArray(rows) || rows.length !== 1) fail('MODEL_VERSION_INVALID'); const row = rows[0];
      context = { stage: 'manifest', projectId: row.project_id, versionId: row.id };
      let bytes; try { bytes = Buffer.byteLength(JSON.stringify(row.manifest)); } catch { fail('MODEL_MANIFEST_INVALID'); }
      if (bytes > limits.maxManifestBytes || bytes > Number(head.manifest_bytes)) fail('MODEL_AUDIT_LIMIT_EXCEEDED');
      const version = checkedVersion(row, limits); if (versions.has(row.id)) fail('MODEL_VERSION_INVALID'); versions.set(row.id, version);
      plannedResources += version.resourceCount; plannedBytes += version.totalBytes;
      if (plannedResources > limits.maxResources || !Number.isSafeInteger(plannedBytes) || plannedBytes > limits.maxTotalBytes) fail('MODEL_AUDIT_LIMIT_EXCEEDED');
    }
    const archiveRows = archivesPresent ? (await query('SELECT * FROM public.model_package_archives WHERE published=TRUE ORDER BY project_id,import_id LIMIT $1', [limits.maxArchives + 1])).rows : [];
    if (!Array.isArray(archiveRows) || archiveRows.length > limits.maxArchives) fail('MODEL_AUDIT_LIMIT_EXCEEDED');
    const archives = [], archiveKeys = new Set(), archiveVersions = new Set();
    for (const row of archiveRows) {
      context = { stage: 'archive-metadata', projectId: row.project_id, versionId: row.model_version_id, importId: row.import_id };
      const archive = checkedArchive(row, limits); if (archiveKeys.has(archive.key)) fail('MODEL_ARCHIVE_INVALID'); archiveKeys.add(archive.key); archiveVersions.add(row.model_version_id);
      const version = versions.get(row.model_version_id); if (version && version.row.project_id !== row.project_id) fail('MODEL_ARCHIVE_SCOPE_INVALID');
      plannedBytes += archive.bytes; if (!Number.isSafeInteger(plannedBytes) || plannedBytes > limits.maxTotalBytes || archive.bytes > limits.maxTempBytes) fail('MODEL_AUDIT_LIMIT_EXCEEDED'); archives.push(archive);
    }
    for (const version of versions.values()) {
      const row = version.row; const evidence = { projectId: row.project_id, versionId: row.id, storagePrefix: version.prefix, contentFingerprint: version.fingerprint, manifestSha256: version.manifestHash, declaredHealth: row.health, resourceCount: version.resourceCount, totalBytes: version.totalBytes, archiveStatus: !archivesPresent ? 'ABSENT_OLD_SCHEMA' : archiveVersions.has(row.id) ? 'PUBLISHED_ARCHIVE_PRESENT' : 'LEGACY_ARCHIVE_ABSENT', status: 'RUNNING' }; report.models.push(evidence);
      for (const resource of row.manifest.resources) { context = { stage: 'resource', projectId: row.project_id, versionId: row.id, path: resource.path }; counts.resourceBytes += await readObject(version.prefix + resource.path, resource); counts.resources++; }
      evidence.status = 'PASS'; counts.models++; if (!archiveVersions.has(row.id)) counts.legacyArchiveAbsent++; if (row.health === 'unavailable') counts.unavailableDeclarations++;
    }
    for (const archive of archives) {
      const row = archive.row, version = versions.get(row.model_version_id), filename = path.join(directory, 'archive-' + randomUUID() + '.zip'); let handle;
      context = { stage: 'archive', projectId: row.project_id, versionId: row.model_version_id, importId: row.import_id, key: archive.key };
      try {
        handle = await fs.open(filename, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
        await readObject(archive.key, archive, handle); await handle.sync(); await handle.close(); handle = null;
        const verified = await withSignal(Promise.resolve().then(() => verifyPackage(filename, { signal: active, ...(version ? { expectedFingerprint: version.fingerprint } : {}), limits: { maxArchiveBytes: limits.maxArchiveBytes, maxTotalResourceBytes: limits.maxModelBytes, maxFileBytes: limits.maxFileBytes, maxFiles: limits.maxFilesPerModel, maxManifestBytes: limits.maxManifestBytes, maxMs: Math.min(limits.maxObjectMs, 600000) } })), active);
        if (verified?.reportSchemaVersion !== 1 || verified.status !== 'PASS' || verified.operation !== 'verify' || verified.package?.path !== filename || verified.package?.bytes !== archive.bytes || verified.package?.sha256 !== archive.sha256 || verified.checks?.portableManifest !== 'PASS' || verified.checks?.safeArchive !== 'PASS' || verified.checks?.rawInventory !== 'PASS' || verified.checks?.fingerprint !== 'PASS' || verified.checks?.supportedProfile !== 'PASS' || verified.checks?.nestedReferences !== 'PASS') fail('MODEL_ARCHIVE_VERIFICATION_FAILED');
        const checked = checkedManifest(verified.manifest, limits);
        if (verified.package.packageId !== verified.manifest.packageId || !Array.isArray(verified.resources) || verified.resources.length !== checked.resourceCount || verified.resources.some((resource,index) => !isDeepStrictEqual(resource, { ...verified.manifest.resources[index], verifiedSha256: verified.manifest.resources[index].sha256 })) || verified.contentFingerprint !== checked.fingerprint || verified.resourceCount !== checked.resourceCount || verified.totalRawBytes !== checked.totalBytes || version && (checked.fingerprint !== version.fingerprint || !isDeepStrictEqual(verified.manifest.resources, version.row.manifest.resources))) fail('MODEL_ARCHIVE_VERSION_MISMATCH');
        report.archives.push({ projectId: row.project_id, versionId: row.model_version_id, importId: row.import_id, storageKey: archive.key, bytes: archive.bytes, sha256: archive.sha256, contentFingerprint: checked.fingerprint, association: version ? 'READY_VERSION' : 'INDEPENDENT_RETAINED_ARCHIVE', status: 'PASS' });
        counts.archives++; counts.archiveBytes += archive.bytes; if (!version) counts.retainedIndependentArchives++;
      } catch (error) { if (error instanceof ModelAuditError) throw error; interrupted(active); fail('MODEL_ARCHIVE_VERIFICATION_FAILED'); }
      finally { await handle?.close().catch(() => {}); await fs.unlink(filename).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    }
    await query('COMMIT'); committed = true; report.status = 'PASS'; const evidence = await writeReport();
    return { status: 'PASS', readOnly: true, counts, archivesSchema: report.archivesSchema, ...evidence, privateReportPath: reportPath };
  } catch (error) {
    report.status = 'FAIL'; report.failure = { code: error instanceof ModelAuditError ? error.code : 'MODEL_AUDIT_FAILED', context };
    if (client && transaction && !committed) { try { await withSignal(client.query('ROLLBACK'), AbortSignal.timeout(1000)); } catch {} }
    try { await writeReport(); } catch {}
    const safe = new ModelAuditError(report.failure.code); safe.privateReportPath = reportPath; throw safe;
  } finally { client?.release?.(!committed); }
}

export function validateAuditConnection(value, { postgresHost, minioHost, ownerId } = {}) {
  exact(value, ['database', 'storage', 'ownerId'], 'MODEL_AUDIT_CONNECTION_INVALID'); exact(value.database, ['host', 'port', 'user', 'password', 'database'], 'MODEL_AUDIT_CONNECTION_INVALID'); exact(value.storage, ['host', 'port', 'useSSL', 'accessKey', 'secretKey', 'bucket'], 'MODEL_AUDIT_CONNECTION_INVALID');
  const host = value => typeof value === 'string' && /^[a-z0-9][a-z0-9_.-]{0,127}$/.test(value), secret = value => typeof value === 'string' && value.length > 0 && value.length <= 16384 && !/[\x00-\x1f\x7f]/.test(value);
  if (!UUID.test(ownerId || '') || value.ownerId !== ownerId || !host(postgresHost) || !host(minioHost) || value.database.host !== postgresHost || value.storage.host !== minioHost || value.database.port !== 5432 || value.storage.port !== 9000 || value.storage.useSSL !== false || value.database.database !== 'wfc_app' || !secret(value.database.user) || !secret(value.database.password) || !secret(value.storage.accessKey) || !secret(value.storage.secretKey) || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(value.storage.bucket || '')) fail('MODEL_AUDIT_CONNECTION_INVALID');
  return value;
}

async function cli(args) {
  const flags = new Map(); for (let index = 0; index < args.length; index += 2) { if (!['--connection', '--directory', '--package-module', '--postgres-host', '--minio-host', '--owner'].includes(args[index]) || !args[index + 1] || flags.has(args[index])) fail('MODEL_AUDIT_ARGUMENT_INVALID'); flags.set(args[index], args[index + 1]); }
  if (flags.size !== 6) fail('MODEL_AUDIT_ARGUMENT_INVALID');
  const connectionFile = await noLinks(flags.get('--connection')), stat = await fs.lstat(connectionFile); if (stat.size > 32768) fail('MODEL_AUDIT_CONNECTION_INVALID');
  let connection; try { connection = JSON.parse(await fs.readFile(connectionFile, 'utf8')); } catch { fail('MODEL_AUDIT_CONNECTION_INVALID'); }
  validateAuditConnection(connection, { postgresHost: flags.get('--postgres-host'), minioHost: flags.get('--minio-host'), ownerId: flags.get('--owner') });
  const packageModule = await noLinks(flags.get('--package-module')), packageApi = await import(pathToFileURL(packageModule).href); if (typeof packageApi.verifyPackage !== 'function') fail('MODEL_AUDIT_PACKAGE_MODULE_INVALID');
  const require = createRequire('/app/package.json'), { Pool } = require('pg'), { Client } = require('minio');
  const agent = new http.Agent({ keepAlive: false, maxSockets: 1, timeout: 600000 });
  agent.on('free', socket => socket.setTimeout(1000));
  const pool = new Pool({ ...connection.database, ssl: false, max: 1, connectionTimeoutMillis: 15000, statement_timeout: 30000, idle_in_transaction_session_timeout: MODEL_AUDIT_LIMITS.maxMs, options: '-c default_transaction_read_only=on', application_name: 'wfc-sp1-model-audit-read-only' });
  const minio = new Client({ endPoint: connection.storage.host, port: 9000, useSSL: false, accessKey: connection.storage.accessKey, secretKey: connection.storage.secretKey, transportAgent: agent, retryOptions: { disableRetry: true } });
  try { const result = await auditRecoveredModels({ pool, storage: { getObject: key => minio.getObject(connection.storage.bucket, key) }, verifyPackage: packageApi.verifyPackage, privateDirectory: flags.get('--directory'), ownerId: connection.ownerId }); const { privateReportPath, ...summary } = result; return summary; }
  finally { agent.destroy(); await pool.end(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(await cli(process.argv.slice(2))) + '\n'); }
  catch (error) { process.stdout.write(JSON.stringify({ status: 'FAIL', code: error instanceof ModelAuditError ? error.code : 'MODEL_AUDIT_FAILED' }) + '\n'); process.exitCode = 1; }
}
