import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { setImmediate } from 'node:timers/promises';
import { auditRecoveredModels, validateAuditConnection } from './model-audit.mjs';
import { computeFingerprint, validateManifest } from '../../server/vendor/routings-model-package/index.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const errorCode = code => error => error.code === code && error.message === code;
function manifestFor(data) {
  const manifest = { schemaVersion: 1, packageId: randomUUID(), label: 'Synthetic recovered model', source: { name: 'synthetic.nwd', bytes: 123, sha256: sha('synthetic source identity'), identityBasis: 'observed-local-file' }, preparedAt: '2026-10-24T12:00:00.000Z', supportProfile: 'svf-local-7.130.0-v1', format: 'svf', sdkVersion: '7.130.0', entrypoint: 'resources/output/0/0.svf', resources: [...data].map(([name, bytes]) => ({ path: name, bytes: bytes.length, sha256: sha(bytes) })), contentFingerprint: '' };
  manifest.resources.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0); manifest.contentFingerprint = computeFingerprint(manifest); validateManifest(manifest); return manifest;
}
async function fixture(t, { archivesTable = true, withArchive = true, modelCount = 1 } = {}) {
  const parent = await fs.realpath(os.tmpdir()), root = await fs.mkdtemp(path.join(parent, 'preparer-model-audit-test-'));
  t.after(async () => { assert.equal(path.dirname(root), parent); await fs.rm(root, { recursive: true, force: true }); });
  const directory = path.join(root, 'private-audit'), queries = [], gets = [], streams = [], rows = [], archives = [], objects = new Map(), control = { readOnly: 'on', isolation: 'repeatable read', released: [], verifierCalls: 0, archivesTable };
  const resources = new Map([['resources/output/0/0.svf', Buffer.from('synthetic SVF test bytes')], ['resources/output/0/properties.db', Buffer.from('synthetic property database bytes')]]);
  for (let index = 0; index < modelCount; index++) {
    const id = randomUUID(), project = randomUUID(), manifest = manifestFor(resources), storagePrefix = `projects/${project}/versions/${id}/`;
    const row = { id, project_id: project, package_id: manifest.packageId, content_fingerprint: manifest.contentFingerprint, label: manifest.label, source: structuredClone(manifest.source), schema_version: 1, support_profile: manifest.supportProfile, format: manifest.format, sdk_version: manifest.sdkVersion, entrypoint: manifest.entrypoint, prepared_at: new Date(manifest.preparedAt), imported_at: new Date('2026-10-24T12:01:00Z'), state: 'ready', health: 'healthy', resource_count: resources.size, total_bytes: [...resources.values()].reduce((sum, bytes) => sum + bytes.length, 0).toString(), validation_report_id: randomUUID(), failure: null, manifest, storage_prefix: storagePrefix };
    rows.push(row); for (const [name, bytes] of resources) objects.set(storagePrefix + name, bytes);
    if (withArchive) {
      const importId = randomUUID(), key = `archives/${project}/${importId}/`, bytes = Buffer.from('synthetic transport ZIP fixture ' + index);
      archives.push({ import_id: importId, project_id: project, model_version_id: id, storage_prefix: key, archive_sha256: sha(bytes), archive_bytes: String(bytes.length), published: true, cleaned_at: null }); objects.set(key + 'package.zip', bytes);
    }
  }
  const client = {
    async query(input, values) {
      const text = typeof input === 'string' ? input : input.text, params = values || input.values || []; queries.push({ text, values: params });
      if (control.query) { const result = await control.query(text, params); if (result !== undefined) return result; }
      if (text === 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
      if (text.startsWith("SELECT current_setting('transaction_read_only')")) return { rows: [{ read_only: control.readOnly, isolation: control.isolation }] };
      if (text.startsWith("SELECT to_regclass('public.model_versions')")) return { rows: [{ models: 'model_versions', archives: control.archivesTable ? 'model_package_archives' : null }] };
      if (text.startsWith('SELECT id,project_id,octet_length(manifest::text)')) return { rows: rows.map(row => ({ id: row.id, project_id: row.project_id, manifest_bytes: Buffer.byteLength(JSON.stringify(row.manifest)), source_bytes: Buffer.byteLength(JSON.stringify(row.source)), label_bytes: Buffer.byteLength(row.label) })) };
      if (text.startsWith('SELECT * FROM public.model_versions WHERE id=$1')) return { rows: rows.filter(row => row.id === params[0] && row.project_id === params[1]) };
      if (text.startsWith('SELECT * FROM public.model_package_archives WHERE published=TRUE')) { assert.equal(control.archivesTable, true); return { rows: archives }; }
      assert.fail('The auditor attempted an unexpected or mutating query');
    },
    release(destroy) { control.released.push(destroy); },
  };
  const pool = { async connect() { return client; } };
  const storage = new Proxy({
    async getObject(key, options) {
      gets.push(key); assert.ok(options.signal instanceof AbortSignal);
      if (control.getObject) { const result = await control.getObject(key, options); if (result !== undefined) { streams.push(result); return result; } }
      if (!objects.has(key)) throw Object.assign(new Error('Synthetic private object missing'), { code: 'NoSuchKey' });
      const bytes = objects.get(key), stream = Readable.from([bytes.subarray(0, 4), bytes.subarray(4)]); streams.push(stream); return stream;
    },
  }, { get(target, property) { assert.equal(property, 'getObject', 'No storage initialization/listing/write API is available'); return target[property]; } });
  const verifyPackage = async (filename, options) => {
    control.verifierCalls++; const bytes = await fs.readFile(filename), archive = archives.find(row => row.archive_sha256 === sha(bytes)); assert.ok(archive);
    const model = rows.find(row => row.id === archive.model_version_id), manifest = structuredClone(control.archiveManifest || model?.manifest || control.retainedManifest);
    if (model) assert.equal(options.expectedFingerprint, model.content_fingerprint); else assert.equal(options.expectedFingerprint, undefined);
    const report = { reportSchemaVersion: 1, operation: 'verify', status: 'PASS', package: { path: filename, bytes: bytes.length, sha256: sha(bytes), packageId: manifest.packageId }, contentFingerprint: manifest.contentFingerprint, resourceCount: manifest.resources.length, totalRawBytes: manifest.resources.reduce((sum, value) => sum + value.bytes, 0), manifest, resources: manifest.resources.map(resource => ({ ...resource, verifiedSha256: resource.sha256 })), checks: { portableManifest: 'PASS', safeArchive: 'PASS', rawInventory: 'PASS', fingerprint: 'PASS', supportedProfile: 'PASS', nestedReferences: 'PASS' } };
    return control.verifier ? control.verifier(report) : report;
  };
  const run = options => auditRecoveredModels({ pool, storage, verifyPackage, privateDirectory: directory, ...options });
  return { root, directory, rows, archives, objects, control, queries, gets, streams, run, resources };
}

test('read-only snapshot hashes every declared object and verifies the original ZIP without any DB/S3 write interface', async t => {
  const f = await fixture(t), result = await f.run();
  assert.equal(result.status, 'PASS'); assert.equal(result.readOnly, true); assert.equal(result.counts.models, 1); assert.equal(result.counts.resources, 2); assert.equal(result.counts.archives, 1); assert.equal(result.archivesSchema, 'PRESENT');
  assert.equal(f.gets.length, 3); assert.equal(f.control.verifierCalls, 1); assert.ok(f.streams.every(stream => stream.destroyed)); assert.deepEqual(f.control.released, [false]);
  assert.equal(f.queries[0].text, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); assert.equal(f.queries.at(-1).text, 'COMMIT');
  assert.ok(f.queries.every(query => /^(?:SELECT\b|BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY$|COMMIT$|ROLLBACK$)/.test(query.text))); assert.ok(f.queries.every(query => !/\b(?:UPDATE|INSERT|DELETE|CREATE|ALTER|DROP|FOR UPDATE|set_config)\b/i.test(query.text)));
  const bytes = await fs.readFile(result.privateReportPath), report = JSON.parse(bytes); assert.equal(sha(bytes), result.reportSha256); assert.equal(bytes.length, result.reportBytes); assert.equal(report.models[0].versionId, f.rows[0].id); assert.equal(report.database.mutationQueries, 0);
  const { privateReportPath, ...summary } = result; assert.equal(JSON.stringify(summary).includes(f.rows[0].id), false); assert.equal(JSON.stringify(summary).includes(f.rows[0].label), false);
  assert.deepEqual(await fs.readdir(f.directory), ['model-audit.private.json']);
});

test('old schema reports absent original ZIP table without creating it or fabricating a ZIP', async t => {
  const f = await fixture(t, { archivesTable: false, withArchive: false }), result = await f.run();
  assert.equal(result.archivesSchema, 'ABSENT_OLD_SCHEMA'); assert.equal(result.counts.legacyArchiveAbsent, 1); assert.equal(result.counts.archives, 0); assert.equal(f.control.verifierCalls, 0);
  assert.equal(f.queries.some(query => query.text.startsWith('SELECT * FROM public.model_package_archives')), false); const report = JSON.parse(await fs.readFile(result.privateReportPath)); assert.equal(report.models[0].archiveStatus, 'ABSENT_OLD_SCHEMA');
});

test('ready legacy version without a published original ZIP is explicit absence rather than invented success', async t => {
  const f = await fixture(t, { withArchive: false }), result = await f.run(), report = JSON.parse(await fs.readFile(result.privateReportPath));
  assert.equal(result.counts.legacyArchiveAbsent, 1); assert.equal(result.counts.archives, 0); assert.equal(report.models[0].archiveStatus, 'LEGACY_ARCHIVE_ABSENT');
});

test('a published ZIP record whose object is missing fails and closes every earlier resource stream', async t => {
  const f = await fixture(t); f.objects.delete(f.archives[0].storage_prefix + 'package.zip');
  await assert.rejects(f.run(), errorCode('MODEL_STORAGE_READ_FAILED')); assert.ok(f.streams.every(stream => stream.destroyed)); assert.equal(f.control.verifierCalls, 0); assert.deepEqual(f.control.released, [true]);
  assert.equal(f.queries.at(-1).text, 'ROLLBACK'); const report = JSON.parse(await fs.readFile(path.join(f.directory, 'model-audit.private.json'))); assert.equal(report.status, 'FAIL'); assert.equal(report.failure.context.stage, 'archive'); assert.deepEqual(await fs.readdir(f.directory), ['model-audit.private.json']);
});

test('resource short/long bytes, hash mismatch and missing objects fail independently and always destroy streams', async t => {
  for (const mode of ['short', 'long', 'hash', 'missing']) {
    const f = await fixture(t, { withArchive: false }), key = f.rows[0].storage_prefix + f.rows[0].manifest.resources[0].path, original = f.objects.get(key);
    if (mode === 'missing') f.objects.delete(key); else f.objects.set(key, mode === 'short' ? original.subarray(1) : mode === 'long' ? Buffer.concat([original, Buffer.from('x')]) : Buffer.alloc(original.length, 0x41));
    await assert.rejects(f.run(), errorCode(mode === 'missing' ? 'MODEL_STORAGE_READ_FAILED' : mode === 'hash' ? 'MODEL_RESOURCE_HASH_MISMATCH' : 'MODEL_RESOURCE_SIZE_MISMATCH')); assert.ok(f.streams.every(stream => stream.destroyed)); assert.equal(f.control.released[0], true);
  }
});

test('manifest fingerprint, scope, metadata counts, unknown fields and calendar damage fail before object reads', async t => {
  const cases = [
    [f => { f.rows[0].manifest.contentFingerprint = '0'.repeat(64); }, 'MODEL_FINGERPRINT_MISMATCH'],
    [f => { f.rows[0].storage_prefix = 'projects/foreign/versions/foreign/'; }, 'MODEL_STORAGE_PREFIX_INVALID'],
    [f => { f.rows[0].resource_count = 3; }, 'MODEL_VERSION_MANIFEST_MISMATCH'],
    [f => { f.rows[0].manifest.unknown = true; }, 'MODEL_MANIFEST_INVALID'],
    [f => { f.rows[0].manifest.resources[0].path = 'resources/../escape.svf'; }, 'MODEL_MANIFEST_INVALID'],
    [f => { f.rows[0].manifest.preparedAt = '2026-02-31T12:00:00.000Z'; }, 'MODEL_MANIFEST_INVALID'],
  ];
  for (const [mutate, code] of cases) { const f = await fixture(t); mutate(f); await assert.rejects(f.run(), errorCode(code)); assert.equal(f.gets.length, 0); }
});

test('published archive size/hash corruption fails before trusting even a verifier that would say PASS', async t => {
  for (const mode of ['size', 'hash']) {
    const f = await fixture(t), key = f.archives[0].storage_prefix + 'package.zip', original = f.objects.get(key); f.objects.set(key, mode === 'size' ? original.subarray(1) : Buffer.alloc(original.length, 0x42));
    await assert.rejects(f.run(), errorCode(mode === 'size' ? 'MODEL_RESOURCE_SIZE_MISMATCH' : 'MODEL_RESOURCE_HASH_MISMATCH')); assert.equal(f.control.verifierCalls, 0); assert.deepEqual(await fs.readdir(f.directory), ['model-audit.private.json']);
  }
});

test('strict package verifier checks, verified resource receipts and fingerprints cannot be bypassed by a loose PASS', async t => {
  for (const mutate of [report => { delete report.resources; }, report => { report.checks.nestedReferences = 'FAIL'; }, report => { report.resources[0].verifiedSha256 = '0'.repeat(64); }, report => { report.contentFingerprint = '0'.repeat(64); }]) {
    const f = await fixture(t); f.control.verifier = report => { mutate(report); return report; };
    await assert.rejects(f.run(), error => ['MODEL_ARCHIVE_VERIFICATION_FAILED', 'MODEL_ARCHIVE_VERSION_MISMATCH'].includes(error.code)); assert.deepEqual(await fs.readdir(f.directory), ['model-audit.private.json']);
  }
});

test('duplicate import ZIP may retain its distinct package identity while proving identical model resources', async t => {
  const f = await fixture(t); f.control.archiveManifest = structuredClone(f.rows[0].manifest); f.control.archiveManifest.packageId = randomUUID(); f.control.archiveManifest.label = 'Synthetic duplicate package label';
  const result = await f.run(); assert.equal(result.counts.archives, 1); assert.notEqual(f.control.archiveManifest.packageId, f.rows[0].package_id);
});

test('all published archives are audited even after their independent retained version/project is absent', async t => {
  const f = await fixture(t), retained = f.rows.pop(); f.control.retainedManifest = retained.manifest;
  const result = await f.run(); assert.equal(result.counts.models, 0); assert.equal(result.counts.archives, 1); assert.equal(result.counts.retainedIndependentArchives, 1); assert.equal(f.gets.length, 1);
  const report = JSON.parse(await fs.readFile(result.privateReportPath)); assert.equal(report.archives[0].association, 'INDEPENDENT_RETAINED_ARCHIVE');
});

test('archive association cannot silently cross project boundaries', async t => {
  const f = await fixture(t); f.archives[0].project_id = randomUUID(); f.archives[0].storage_prefix = `archives/${f.archives[0].project_id}/${f.archives[0].import_id}/`;
  await assert.rejects(f.run(), errorCode('MODEL_ARCHIVE_SCOPE_INVALID')); assert.equal(f.gets.length, 0);
});

test('model, manifest, resource and temporary-byte limits fail before storage access', async t => {
  for (const options of [{ modelCount: 2, limits: { maxModels: 1 } }, { limits: { maxManifestBytes: 16 } }, { limits: { maxResources: 1 } }, { limits: { maxTempBytes: 1 } }, { limits: { maxTotalBytes: 1 } }]) {
    const f = await fixture(t, { modelCount: options.modelCount || 1 }); await assert.rejects(f.run({ limits: options.limits }), errorCode('MODEL_AUDIT_LIMIT_EXCEEDED')); assert.equal(f.gets.length, 0);
  }
});

test('a non-read-only/non-repeatable transaction fails before schema or model queries', async t => {
  for (const field of ['readOnly', 'isolation']) { const f = await fixture(t); f.control[field] = field === 'readOnly' ? 'off' : 'read committed'; await assert.rejects(f.run(), errorCode('MODEL_AUDIT_READ_ONLY_REQUIRED')); assert.equal(f.gets.length, 0); assert.equal(f.queries.at(-1).text, 'ROLLBACK'); }
});

test('abort destroys an active object stream and releases the read-only transaction', async t => {
  const f = await fixture(t, { withArchive: false }), controller = new AbortController(); f.control.getObject = () => new Readable({ read() {} });
  const timer = setTimeout(() => controller.abort(), 20); try { await assert.rejects(f.run({ signal: controller.signal }), errorCode('MODEL_AUDIT_INTERRUPTED')); } finally { clearTimeout(timer); }
  assert.ok(f.streams.every(stream => stream.destroyed)); assert.equal(f.control.released[0], true); assert.equal(f.queries.at(-1).text, 'ROLLBACK');
});

test('a late storage stream arriving after abort is destroyed without reading it', async t => {
  const f = await fixture(t, { withArchive: false }), controller = new AbortController(); let release, entered;
  const ready = new Promise(resolve => { entered = resolve; }); f.control.getObject = () => { entered(); return new Promise(resolve => { release = resolve; }); };
  const running = f.run({ signal: controller.signal }); await ready; controller.abort(); await assert.rejects(running, errorCode('MODEL_AUDIT_INTERRUPTED'));
  const stream = Readable.from([Buffer.from('late synthetic bytes')]); release(stream); await setImmediate(); await setImmediate(); assert.equal(stream.destroyed, true);
});

test('global time limit is bounded and destroys blocked reads', async t => {
  const f = await fixture(t, { withArchive: false }); f.control.getObject = () => new Readable({ read() {} });
  const keepAlive = setTimeout(() => {}, 1000); try { await assert.rejects(f.run({ limits: { maxMs: 25 } }), errorCode('MODEL_AUDIT_TIMEOUT')); } finally { clearTimeout(keepAlive); }
  assert.ok(f.streams.every(stream => stream.destroyed));
});

test('each object has its own bounded deadline after its stream is opened', async t => {
  const f = await fixture(t, { withArchive: false }); f.control.getObject = () => new Readable({ read() {} });
  const keepAlive = setTimeout(() => {}, 1000); try { await assert.rejects(f.run({ limits: { maxObjectMs: 25 } }), errorCode('MODEL_AUDIT_TIMEOUT')); } finally { clearTimeout(keepAlive); }
  assert.equal(f.streams.length, 1); assert.equal(f.streams[0].destroyed, true);
});

test('published but currently unavailable health is reported without changing database health', async t => {
  const f = await fixture(t, { withArchive: false }); f.rows[0].health = 'unavailable'; const result = await f.run(); assert.equal(result.counts.unavailableDeclarations, 1); assert.equal(f.rows[0].health, 'unavailable');
});

test('explicit clone connection pins reject ambient/missing credentials, foreign hosts and owner mismatches', () => {
  const ownerId = randomUUID(), scope = { postgresHost: 'owned-pg-clone', minioHost: 'owned-minio-clone', ownerId };
  const connection = { ownerId, database: { host: scope.postgresHost, port: 5432, user: 'synthetic-user', password: 'synthetic-password', database: 'wfc_app' }, storage: { host: scope.minioHost, port: 9000, useSSL: false, accessKey: 'synthetic-access', secretKey: 'synthetic-secret', bucket: 'wfc-models' } };
  assert.equal(validateAuditConnection(connection, scope), connection);
  for (const mutate of [value => { delete value.database.password; }, value => { value.database.password = ''; }, value => { value.storage.secretKey = ''; }, value => { value.database.host = 'original-pg'; }, value => { value.storage.host = 'http://owned-minio-clone'; }, value => { value.ownerId = randomUUID(); }, value => { value.database.connectionString = 'postgres://unsafe'; }, value => { value.storage.useSSL = true; }]) {
    const copy = structuredClone(connection); mutate(copy); assert.throws(() => validateAuditConnection(copy, scope), errorCode('MODEL_AUDIT_CONNECTION_INVALID'));
  }
});

test('operator module has no import-time CLI, application runtime or environment credential fallback', async () => {
  const source = await fs.readFile(new URL('./model-audit.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /process\.env|modelRegistry\/runtime|operations\/service|from ['"].*\/db\./); assert.match(source, /createRequire\('\/app\/package\.json'\)/);
  assert.match(source, /process\.argv\[1\].*fileURLToPath\(import\.meta\.url\)/);
});
