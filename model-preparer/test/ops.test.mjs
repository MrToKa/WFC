import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ROOTS, canonical, digest, fail, hashFile, noLinks, parseJson, putBlob, relative, secureDirectory } from '../ops/common.mjs';
import { validateManifest, publishManifest, verifyBackup } from '../ops/manifest.mjs';
import { inspectImageArchive } from '../ops/image-archive.mjs';
import { auditState } from '../ops/state.mjs';
import { verify } from '../ops/preparer-ops.mjs';
import { sameRoots } from '../ops/docker.mjs';
import { createStore } from '../lib/store.mjs';
import { createJournal } from '../app/io.mjs';

async function temp(t) { const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'preparer-ops-')); t.after(async () => { await fs.rm(root, { recursive: true, force: true }); }); return root; }
const rejectsCode = (operation, code) => assert.rejects(operation, error => error.code === code);
function tar(entries) {
  const chunks = [];
  for (const entry of entries) {
    const bytes = Buffer.from(entry.text ?? ''), header = Buffer.alloc(512);
    header.write(entry.name, 0); header.write('0000600\0', 100); header.write('0000000\0', 108); header.write('0000000\0', 116);
    header.write(bytes.length.toString(8).padStart(11, '0') + '\0', 124); header.write('00000000000\0', 136); header.fill(32, 148, 156); header.write(entry.type ?? '0', 156); header.write('ustar\0', 257);
    const checksum = header.reduce((sum, value) => sum + value, 0); header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148);
    chunks.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  return Buffer.concat([...chunks, Buffer.alloc(1024)]);
}
async function fixture(t) {
  const root = await temp(t), bundle = path.join(root, 'bundle'); await fs.mkdir(bundle); await fs.mkdir(path.join(bundle, 'objects')); await fs.mkdir(path.join(bundle, 'operator'));
  const config = '{"architecture":"amd64","os":"linux"}', imageId = `sha256:${digest(config)}`;
  const archive = tar([{ name: 'config.json', text: config }, { name: 'layer.tar', text: 'opaque owned fixture layer' }, { name: 'manifest.json', text: JSON.stringify([{ Config: 'config.json', RepoTags: null, Layers: ['layer.tar'] }]) }]);
  await fs.writeFile(path.join(bundle, 'image.tar'), archive); await fs.writeFile(path.join(bundle, 'operator', 'preparer-ops.mjs'), '// owned fixture');
  const bytes = Buffer.from('immutable history\n'), sha256 = digest(bytes); await fs.writeFile(path.join(bundle, 'objects', sha256), bytes);
  const manifest = { schemaVersion: 1, kind: 'preparer-stopped-backup', backupId: randomUUID(), createdAt: new Date().toISOString(),
    container: { mode: 'live', imageId }, image: { id: imageId, os: 'linux', architecture: 'amd64', archive: { path: 'image.tar', ...await hashFile(path.join(bundle, 'image.tar')) } },
    roots: ['data', 'work', 'outputs'].map(role => ({ role, virtualRoot: ROOTS[role], policy: 'full', mode: 0o700, uid: 1000, gid: 1000 })),
    entries: [{ role: 'data', path: 'record.json', type: 'file', mode: 0o600, uid: 1000, gid: 1000, bytes: bytes.length, sha256 }], audit: { jobs: [], namespaces: [] },
    operatorFiles: [{ path: 'operator/preparer-ops.mjs', ...await hashFile(path.join(bundle, 'operator', 'preparer-ops.mjs')) }], configurationPolicy: { credentials: 'separate protected operator artifact' } };
  return { root, bundle, manifest, archive, config, imageId, sha256 };
}

test('strict decoded-key JSON rejects escaped duplicates, trailing data, invalid UTF8 and poison keys', () => {
  assert.deepEqual(parseJson('{"a":[1,null,true," Ω \\r\\n"]}'), { a: [1, null, true, ' Ω \r\n'] });
  for (const text of ['{"a":1,"\\u0061":2}', '{"__proto__":1}', '{"a":1}{}', '[1,]', '01', '1e999', '"unterminated']) assert.throws(() => parseJson(text));
  assert.throws(() => parseJson(Buffer.from([0xff]))); assert.throws(() => parseJson('['.repeat(65) + '0' + ']'.repeat(65)));
  for (const value of [{ missing: undefined }, [undefined], NaN, new Date()]) assert.throws(() => canonical(value));
});
test('exact root binding compares volume and external input identities without accepting substitutions', () => {
  const expected = { data: { role: 'data', virtualRoot: ROOTS.data, type: 'volume', source: 'own-data' }, imports: { role: 'imports', virtualRoot: ROOTS.imports, type: 'bind', source: path.resolve('C:/Private/imports') } };
  const actual = structuredClone(expected);
  if (process.platform === 'win32') actual.imports.source = '/run/desktop/mnt/host/c/Private/imports';
  assert.equal(sameRoots(actual, expected), true);
  actual.data.source = 'different-data'; assert.equal(sameRoots(actual, expected), false);
  actual.data.source = expected.data.source; actual.imports.source += '-other'; assert.equal(sameRoots(actual, expected), false);
});
test('relative paths reject traversal, rooted, escaped, ADS and ambiguous components', () => {
  assert.equal(relative('live/core/records/job/a.json'), 'live/core/records/job/a.json');
  for (const value of ['../x', '/x', 'a\\x', 'a//x', 'a/./x', 'a:x', 'a/..', 'a/x ', 'a/x.']) assert.throws(() => relative(value));
});
test('content blobs deduplicate exact bytes without overwriting or retaining hardlinks', async t => {
  const root = await temp(t), input = path.join(root, 'input'), bundle = path.join(root, 'bundle'); await fs.mkdir(bundle); await fs.writeFile(input, ' Ω\r\nimmutable ');
  const first = await putBlob(bundle, input), second = await putBlob(bundle, input); assert.deepEqual(first, second);
  assert.equal((await fs.stat(path.join(bundle, 'objects', first.sha256))).nlink, 1); assert.equal((await fs.readdir(path.join(bundle, 'objects'))).length, 1);
  await fs.writeFile(path.join(bundle, 'objects', first.sha256), 'corruption'); await rejectsCode(putBlob(bundle, input), 'BACKUP_CORRUPT');
});
test('filesystem snapshot refuses linked inputs and private roots apply actual platform protection', async t => {
  const root = await temp(t), file = path.join(root, 'a'), hard = path.join(root, 'b'), directory = path.join(root, 'private'); await fs.writeFile(file, 'owned'); await fs.link(file, hard);
  await rejectsCode(noLinks(file), 'UNSAFE_PATH'); await secureDirectory(directory, { create: true });
  if (process.platform !== 'win32') assert.equal((await fs.stat(directory)).mode & 0o077, 0);
});
test('complete marker and full private object/tool/image readback verify a coherent backup', async t => {
  const value = await fixture(t); await publishManifest(value.bundle, value.manifest); const actual = await verifyBackup(value.bundle);
  assert.equal(actual.manifest.backupId, value.manifest.backupId); assert.equal(actual.objectCount, 1); assert.equal(actual.manifest.container.mode, 'live');
  assert.equal((await inspectImageArchive(path.join(value.bundle, 'image.tar'), value.imageId)).savedTags, 0);
});
test('incomplete and changed/truncated manifest, image archive, object and tools fail closed', async t => {
  const value = await fixture(t); await assert.rejects(verifyBackup(value.bundle)); await publishManifest(value.bundle, value.manifest);
  const manifestPath = path.join(value.bundle, 'manifest.json'), original = await fs.readFile(manifestPath);
  await fs.writeFile(manifestPath, original.subarray(0, original.length - 2)); await rejectsCode(verifyBackup(value.bundle), 'BACKUP_CORRUPT'); await fs.writeFile(manifestPath, original);
  const archivePath = path.join(value.bundle, 'image.tar'), archive = await fs.readFile(archivePath); await fs.writeFile(archivePath, archive.subarray(0, 100)); await rejectsCode(verifyBackup(value.bundle), 'BACKUP_CORRUPT'); await fs.writeFile(archivePath, archive);
  await fs.writeFile(path.join(value.bundle, 'objects', value.sha256), 'changed'); await rejectsCode(verifyBackup(value.bundle), 'BACKUP_CORRUPT');
});
test('manifest refuses unknown format, duplicate paths, file-parent conflicts and unsafe restored ownership', async t => {
  const { manifest } = await fixture(t);
  for (const change of [value => { value.schemaVersion = 2; }, value => { value.extra = true; }, value => { value.entries.push(value.entries[0]); }, value => { value.entries[0].uid = 12345; }, value => { value.entries[0].path = '../escape'; }, value => { value.entries[0].path = 'missing/child'; }]) {
    const value = structuredClone(manifest); change(value); assert.throws(() => validateManifest(value));
  }
});
test('outer image tar rejects unsafe paths, links, wrong config identity and saved working tags', async t => {
  const root = await temp(t), filename = path.join(root, 'image.tar'), config = '{"os":"linux","architecture":"amd64"}', imageId = `sha256:${digest(config)}`;
  for (const entry of [{ name: '../escape', text: 'x' }, { name: 'linked', type: '2' }, { name: '/escape', text: 'x' }]) { await fs.writeFile(filename, tar([entry])); await assert.rejects(inspectImageArchive(filename, imageId)); }
  await fs.writeFile(filename, tar([{ name: 'config.json', text: config }, { name: 'manifest.json', text: JSON.stringify([{ Config: 'config.json', RepoTags: ['working:latest'], Layers: [] }]) }]));
  await rejectsCode(inspectImageArchive(filename, imageId), 'IMAGE_TAGS_REFUSED');
  await fs.writeFile(filename, tar([{ name: 'config.json', text: config }, { name: 'manifest.json', text: JSON.stringify([{ Config: 'config.json', RepoTags: null, Layers: [] }]) }]));
  await rejectsCode(inspectImageArchive(filename, 'sha256:' + '0'.repeat(64)), 'WRONG_IMAGE');
});

test('image config platform must match the verified manifest and supported Linux architecture', async t => {
  const value = await fixture(t); value.manifest.image.architecture = 'arm64'; await publishManifest(value.bundle, value.manifest);
  await rejectsCode(verify(value.bundle), 'WRONG_PLATFORM');
  const filename = path.join(value.root, 'windows.tar'), config = '{"os":"windows","architecture":"amd64"}';
  await fs.writeFile(filename, tar([{ name: 'config.json', text: config }, { name: 'manifest.json', text: JSON.stringify([{ Config: 'config.json', RepoTags: null, Layers: [] }]) }]));
  await rejectsCode(inspectImageArchive(filename, `sha256:${digest(config)}`), 'WRONG_PLATFORM');
});

test('OCI-index image IDs verify descriptor/config/layer closure and reject tags or missing blobs', async t => {
  const root = await temp(t), filename = path.join(root, 'oci.tar');
  const config = canonical({ os: 'linux', architecture: 'amd64' }), layer = 'fixture-compressed-layer', configSha = digest(config), layerSha = digest(layer);
  const imageManifest = canonical({ schemaVersion: 2, mediaType: 'application/vnd.oci.image.manifest.v1+json', config: { mediaType: 'application/vnd.oci.image.config.v1+json', digest: `sha256:${configSha}`, size: Buffer.byteLength(config) }, layers: [{ mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip', digest: `sha256:${layerSha}`, size: Buffer.byteLength(layer) }] });
  const manifestSha = digest(imageManifest), index = canonical({ schemaVersion: 2, mediaType: 'application/vnd.oci.image.index.v1+json', manifests: [{ mediaType: 'application/vnd.oci.image.manifest.v1+json', digest: `sha256:${manifestSha}`, size: Buffer.byteLength(imageManifest), platform: { os: 'linux', architecture: 'amd64' } }] }), imageId = `sha256:${digest(index)}`;
  const pointer = { schemaVersion: 2, mediaType: 'application/vnd.oci.image.index.v1+json', manifests: [{ mediaType: 'application/vnd.oci.image.index.v1+json', digest: imageId, size: Buffer.byteLength(index) }] };
  const entries = [{ name: `blobs/sha256/${configSha}`, text: config }, { name: `blobs/sha256/${layerSha}`, text: layer }, { name: `blobs/sha256/${manifestSha}`, text: imageManifest }, { name: `blobs/sha256/${digest(index)}`, text: index }, { name: 'index.json', text: canonical(pointer) }, { name: 'manifest.json', text: canonical([{ Config: `blobs/sha256/${configSha}`, RepoTags: null, Layers: [`blobs/sha256/${layerSha}`] }]) }];
  await fs.writeFile(filename, tar(entries)); assert.equal((await inspectImageArchive(filename, imageId)).identityBasis, 'oci-index-closure');
  await fs.writeFile(filename, tar(entries.filter(value => value.name !== `blobs/sha256/${layerSha}`))); await assert.rejects(inspectImageArchive(filename, imageId));
  pointer.manifests[0].annotations = { 'org.opencontainers.image.ref.name': 'working:latest' }; entries.find(value => value.name === 'index.json').text = canonical(pointer);
  await fs.writeFile(filename, tar(entries)); await rejectsCode(inspectImageArchive(filename, imageId), 'IMAGE_TAGS_REFUSED');
});

test('missing external package refuses audit instead of treating three volumes as a full backup', async t => {
  const root = await temp(t), roots = {};
  for (const role of ['data', 'work', 'outputs']) { roots[role] = path.join(root, role); await fs.mkdir(roots[role]); }
  const data = path.join(roots.data, 'live', 'core'), work = path.join(roots.work, 'live', 'core-work'), service = path.join(roots.data, 'live', 'service');
  await fs.mkdir(work, { recursive: true }); await fs.mkdir(service, { recursive: true });
  const store = createStore({ dataDirectory: data, workDirectory: work }); await store.init(); const journal = await createJournal(service); await journal.close();
  const id = randomUUID(), frozen = { packagePath: '/imports/missing.zip', source: {}, label: 'Existing external package' }, pkg = { path: '/imports/missing.zip', bytes: 12, sha256: '0'.repeat(64), packageId: randomUUID(), contentFingerprint: '1'.repeat(64) };
  const job = { schemaVersion: 1, jobId: id, kind: 'registered', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), frozen, frozenDigest: digest(frozen), status: 'registered', costEvidence: null, costDecision: null, upload: null, submission: null, download: null, package: pkg, lastGoodPackage: pkg, history: [], error: null, interruption: null };
  await store.withLock('job', id, async lease => store.write('job', id, job, { lease }));
  const runtimeRoot = fileURLToPath(new URL('..', import.meta.url));
  await rejectsCode(auditState({ roots, runtimeRoot, verifyPackages: false }), 'MISSING_REFERENCE');
  assert.deepEqual(await store.read('job', id), job);
});

test('nested historical review validates observations relative to its own directory', async t => {
  const root = await temp(t), roots = {};
  for (const role of ['data', 'work', 'outputs', 'proof']) { roots[role] = path.join(root, role); await fs.mkdir(roots[role]); }
  const directory = path.join(roots.proof, 'nested'); await fs.mkdir(directory);
  const observation = 'actual offline observation\n', artifact = { name: 'observation.txt', bytes: Buffer.byteLength(observation), sha256: digest(observation) };
  await fs.writeFile(path.join(directory, 'review.json'), JSON.stringify({ kind: 'autodesk-account-operator-review', observations: { artifacts: [artifact] } }));
  const runtimeRoot = fileURLToPath(new URL('..', import.meta.url));
  await rejectsCode(auditState({ roots, runtimeRoot }), 'MISSING_OR_CHANGED_REFERENCE');
  await fs.writeFile(path.join(directory, artifact.name), observation);
  const actual = await auditState({ roots, runtimeRoot }); assert.ok(actual.references.some(value => value.virtualPath === '/proof/nested/observation.txt' && value.sha256 === artifact.sha256));
  await fs.writeFile(path.join(directory, artifact.name), 'changed observation');
  await rejectsCode(auditState({ roots, runtimeRoot }), 'MISSING_OR_CHANGED_REFERENCE');
});
test('quiescent audit preserves namespace identity, unknown submission history and refuses foreign locks or missing heads', async t => {
  const root = await temp(t), roots = {};
  for (const role of ['data', 'work', 'outputs']) { roots[role] = path.join(root, role); await fs.mkdir(roots[role]); }
  const data = path.join(roots.data, 'live', 'core'), work = path.join(roots.work, 'live', 'core-work'), service = path.join(roots.data, 'live', 'service');
  await fs.mkdir(work, { recursive: true }); await fs.mkdir(service, { recursive: true });
  const store = createStore({ dataDirectory: data, workDirectory: work }); await store.init(); const key = digest('unknown-operation');
  await store.withLock('submission', key, async lease => { await store.write('submission', key, { status: 'submission-unknown', attempts: [{ uncertainty: true }] }, { lease }); });
  const journal = await createJournal(service); await journal.close();
  const runtimeRoot = fileURLToPath(new URL('..', import.meta.url)); const first = await auditState({ roots, runtimeRoot });
  assert.equal(first.namespaces[0].mode, 'live'); assert.equal(first.namespaces[0].counts.submission, 1); assert.deepEqual((await store.read('submission', key)).attempts, [{ uncertainty: true }]);
  const lock = path.join(data, 'locks', 'foreign.lock'); await fs.writeFile(lock, '{}'); await rejectsCode(auditState({ roots, runtimeRoot }), 'UNSAFE_LOCK_HISTORY'); assert.equal(await fs.readFile(lock, 'utf8'), '{}'); await fs.unlink(lock);
  const heads = await fs.readdir(path.join(data, 'heads')); await fs.unlink(path.join(data, 'heads', heads[0])); await assert.rejects(auditState({ roots, runtimeRoot }));
});
