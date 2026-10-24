import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { captureArchive, restoreArchive, verifyArchive, measureDirectory, PG_ROOT_ARCHIVE_FORMAT, PG_ROOT_ARCHIVE_VERSION } from './pg-root-archives.mjs';
import { captureArchive as genericCapture, measureDirectory as genericMeasure, verifyArchive as genericVerify } from './foundation/archives.mjs';

const execute = promisify(execFile);
const linuxRoot = process.platform === 'linux' && process.getuid?.() === 0;
const linux = { skip: !linuxRoot, timeout: 30000 };
const sha = value => createHash('sha256').update(value).digest('hex');
const BASE_SHA = '2f0f89696c13a66eaab0bc4006b57240944fac5be01cf6d88518b4674c5f5066';
const MTIME = 1712345678123456789n;

async function fixture(t) {
  const base = await fs.realpath(os.tmpdir()), root = await fs.mkdtemp(path.join(base, 'preparer-pg-archive-test-'));
  t.after(async () => { assert.equal(path.dirname(root), base); await fs.rm(root, { recursive: true, force: true }); });
  return root;
}
async function touch(filename, ns) {
  await execute('touch', ['--no-dereference', '--no-create', '-m', '--date=@' + ns / 1000000000n + '.' + String(ns % 1000000000n).padStart(9, '0'), filename], { windowsHide: true });
  assert.equal((await fs.lstat(filename, { bigint: true })).mtimeNs, ns);
}
async function pgSource(root) {
  const source = path.join(root, 'source'); await fs.mkdir(path.join(source, '18', 'docker', 'base'), { recursive: true });
  await fs.writeFile(path.join(source, '18', 'docker', 'PG_VERSION'), '18\n');
  await fs.writeFile(path.join(source, '18', 'docker', 'base', 'synthetic'), Buffer.alloc(1024 * 1024 + 19, 0x5a));
  await fs.symlink('.', path.join(source, 'data'));
  const entries = [
    ['18/docker/base/synthetic', 0o600, 999, 999], ['18/docker/PG_VERSION', 0o640, 999, 999],
    ['18/docker/base', 0o700, 999, 999], ['18/docker', 0o700, 999, 999], ['18', 0o755, 999, 999], ['', 0o755, 0, 0],
  ];
  for (const [name, mode, uid, gid] of entries) { const filename = path.join(source, ...name.split('/').filter(Boolean)); await fs.chown(filename, uid, gid); await fs.chmod(filename, mode); }
  await fs.lchown(path.join(source, 'data'), 0, 0);
  for (const [index, [name]] of entries.entries()) await touch(path.join(source, ...name.split('/').filter(Boolean)), MTIME + BigInt(index));
  await touch(path.join(source, 'data'), MTIME + 123n);
  return source;
}
async function snapshot(root) {
  const result = [];
  const visit = async name => {
    const filename = name ? path.join(root, ...name.split('/')) : root, stat = await fs.lstat(filename, { bigint: true });
    const type = stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : 'file';
    const entry = { path: name, type, mode: Number(stat.mode) & 0o777, uid: Number(stat.uid), gid: Number(stat.gid), mtimeNs: String(stat.mtimeNs) };
    if (type === 'symlink') { entry.target = await fs.readlink(filename); entry.nlink = Number(stat.nlink); }
    else if (type === 'file') { entry.bytes = Number(stat.size); entry.sha256 = sha(await fs.readFile(filename)); }
    result.push(entry);
    if (type === 'directory') for (const child of (await fs.readdir(filename)).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))) await visit(name ? name + '/' + child : child);
  };
  await visit(''); return result;
}
function directory(name) { return { path: name, type: 'directory', mode: 0o755, uid: 0, gid: 0, mtimeNs: String(MTIME) }; }
function file(name, content) { const data = Buffer.from(content); return { header: { path: name, type: 'file', mode: 0o600, uid: 0, gid: 0, mtimeNs: String(MTIME), bytes: data.length, sha256: sha(data) }, data }; }
function syntheticEntries() {
  return [directory(''), directory('18'), directory('18/docker'), file('18/docker/PG_VERSION', '18\n'),
    { path: 'data', type: 'symlink', mode: 0o777, uid: 0, gid: 0, mtimeNs: String(MTIME + 123n), target: '.', nlink: 1 }];
}
function archiveBytes(entries, { magic = 'WFCPG02\n', format = PG_ROOT_ARCHIVE_FORMAT, version = PG_ROOT_ARCHIVE_VERSION } = {}) {
  const chunks = [Buffer.from(magic)]; let files = 0, totalBytes = 0;
  const header = value => { const bytes = Buffer.from(JSON.stringify(value)), length = Buffer.alloc(4); length.writeUInt32BE(bytes.length); chunks.push(length, bytes); };
  for (const entry of entries) { const value = entry.header || entry; header(value); if (value.type === 'file') { files++; totalBytes += value.bytes; chunks.push(entry.data); } }
  chunks.push(Buffer.alloc(4)); header({ format, version, members: entries.length, files, totalBytes });
  return Buffer.concat(chunks);
}

test('dedicated PG format has a distinct name/schema and leaves the generic foundation byte-identical', async () => {
  assert.equal(PG_ROOT_ARCHIVE_FORMAT, 'WFCPGROOT'); assert.equal(PG_ROOT_ARCHIVE_VERSION, 2);
  assert.equal(sha(await fs.readFile(new URL('./foundation/archives.mjs', import.meta.url))), BASE_SHA);
});

test('portable scan accepts only the closed PG root alias and records its metadata', async t => {
  const root = await fixture(t), archive = path.join(root, 'synthetic.pg'); const bytes = archiveBytes(syntheticEntries()); await fs.writeFile(archive, bytes);
  const report = await verifyArchive(archive, { expectedSha256: sha(bytes) });
  assert.equal(report.format, 'WFCPGROOT'); assert.equal(report.version, 2); assert.equal(report.members, 5); assert.equal(report.files, 1); assert.equal(report.totalBytes, 3);
  const alias = report.entries.find(entry => entry.path === 'data');
  assert.equal(alias.type, 'symlink'); assert.equal(alias.target, '.'); assert.equal(alias.nlink, 1); assert.equal(alias.uid, 0); assert.equal(alias.gid, 0); assert.equal(alias.mode, 0o777); assert.equal(alias.mtimeNs, String(MTIME + 123n));
  await assert.rejects(genericVerify(archive), { code: 'ARCHIVE_FORMAT_INVALID' });
});

test('scan rejects every noncanonical alias path, target, owner, mode or link count', async t => {
  const root = await fixture(t);
  const mutations = [{ path: 'alias' }, { path: '18/data' }, { target: '/etc' }, { target: '..' }, { target: './' }, { target: '18' }, { nlink: 2 }, { nlink: '1' }, { uid: 999 }, { gid: 999 }, { mode: 0o755 }];
  for (const [index, mutation] of mutations.entries()) {
    const entries = syntheticEntries(); Object.assign(entries.at(-1), mutation);
    const archive = path.join(root, index + '.pg'); await fs.writeFile(archive, archiveBytes(entries));
    await assert.rejects(verifyArchive(archive), { code: 'ARCHIVE_PG_ALIAS_INVALID' });
  }
});

test('scan forbids descendants below the alias even when their parent target is the root', async t => {
  const root = await fixture(t), entries = syntheticEntries(); entries.push(file('data/escape', 'synthetic'));
  const archive = path.join(root, 'descendant.pg'); await fs.writeFile(archive, archiveBytes(entries));
  await assert.rejects(verifyArchive(archive), { code: 'ARCHIVE_PARENT_INVALID' });
});

test('scan rejects extra roots, wrong PG version, missing PGDATA and a regular data member', async t => {
  const root = await fixture(t), cases = [
    entries => { entries.push(file('extra', 'synthetic')); },
    entries => { entries[3] = file('18/docker/PG_VERSION', '17\n'); },
    entries => { entries.splice(3, 1); },
    entries => { entries[4] = directory('data'); },
  ];
  for (const [index, mutate] of cases.entries()) {
    const entries = syntheticEntries(); mutate(entries); const archive = path.join(root, index + '.pg'); await fs.writeFile(archive, archiveBytes(entries));
    await assert.rejects(verifyArchive(archive), { code: index === 3 ? 'ARCHIVE_PG_ALIAS_INVALID' : 'ARCHIVE_PG_LAYOUT_INVALID' });
  }
});

test('scan rejects hardlink/special types, alias header additions, wrong format and wrong schema', async t => {
  const root = await fixture(t), cases = [
    { mutate: entries => { entries[4].type = 'hardlink'; }, code: 'ARCHIVE_TYPE_REJECTED' },
    { mutate: entries => { entries[4].type = 'fifo'; }, code: 'ARCHIVE_TYPE_REJECTED' },
    { mutate: entries => { entries[4].extra = true; }, code: 'ARCHIVE_HEADER_INVALID' },
    { options: { format: 'WFCOPS' }, code: 'ARCHIVE_FOOTER_INVALID' },
    { options: { version: 1 }, code: 'ARCHIVE_FOOTER_INVALID' },
    { options: { magic: 'WFCOPS01\n' }, code: 'ARCHIVE_FORMAT_INVALID' },
  ];
  for (const [index, value] of cases.entries()) {
    const entries = syntheticEntries(); value.mutate?.(entries); const archive = path.join(root, index + '.pg'); await fs.writeFile(archive, archiveBytes(entries, value.options));
    await assert.rejects(verifyArchive(archive), { code: value.code });
  }
});

test('PG capture and measurement never traverse the root data alias; generic helpers still reject it', linux, async t => {
  const root = await fixture(t), source = await pgSource(root), archive = path.join(root, 'cold.pg');
  const measured = await measureDirectory(source), report = await captureArchive(source, archive), verified = await verifyArchive(archive, { expectedSha256: report.sha256 });
  assert.equal(measured.members, report.members); assert.equal(measured.files, report.files); assert.equal(measured.totalBytes, report.totalBytes);
  assert.equal(report.members, 7); assert.equal(report.files, 2); assert.equal(verified.entries.filter(entry => entry.type === 'symlink').length, 1);
  assert.deepEqual(verified.entries.map(({ offset, ...entry }) => entry), await snapshot(source));
  await assert.rejects(genericMeasure(source), { code: 'ARCHIVE_TYPE_REJECTED' });
  await assert.rejects(genericCapture(source, path.join(root, 'generic.ops')), { code: 'ARCHIVE_TYPE_REJECTED' });
});

test('restore preserves all file/directory metadata and alias nanoseconds without following the alias', linux, async t => {
  const root = await fixture(t), source = await pgSource(root), archive = path.join(root, 'cold.pg'), target = path.join(root, 'restored'); await fs.mkdir(target);
  const before = await snapshot(source), cold = await captureArchive(source, archive);
  const result = await restoreArchive(archive, target, { expectedSha256: cold.sha256 });
  assert.equal(result.status, 'PASS'); assert.equal(result.fullOuterHashVerifiedBeforeWrites, true); assert.deepEqual(await snapshot(target), before);
  assert.equal((await fs.lstat(path.join(target, 'data'), { bigint: true })).mtimeNs, MTIME + 123n);
  assert.equal((await fs.lstat(target, { bigint: true })).mtimeNs, MTIME + 5n, 'Link metadata restoration must not change the root target mtime');
  const recaptured = await captureArchive(target, path.join(root, 'restored.pg')); assert.equal(recaptured.sha256, cold.sha256); assert.equal(recaptured.bytes, cold.bytes);
});

test('capture and measure reject every additional nested symlink', linux, async t => {
  const root = await fixture(t), source = await pgSource(root); await fs.symlink('../../..', path.join(source, '18', 'docker', 'unexpected'));
  await assert.rejects(measureDirectory(source), { code: 'ARCHIVE_TYPE_REJECTED' });
  await assert.rejects(captureArchive(source, path.join(root, 'rejected.pg')), { code: 'ARCHIVE_TYPE_REJECTED' });
});

test('capture and measure reject hardlinked regular files and special files', linux, async t => {
  const root = await fixture(t), source = await pgSource(root), payload = path.join(source, '18', 'docker', 'base', 'synthetic'), extra = path.join(source, '18', 'docker', 'base', 'extra');
  await fs.link(payload, extra);
  await assert.rejects(measureDirectory(source), { code: 'ARCHIVE_TYPE_REJECTED' }); await assert.rejects(captureArchive(source, path.join(root, 'hardlink.pg')), { code: 'ARCHIVE_TYPE_REJECTED' });
  await fs.unlink(extra); await execute('mkfifo', [extra], { windowsHide: true });
  await assert.rejects(measureDirectory(source), { code: 'ARCHIVE_TYPE_REJECTED' }); await assert.rejects(captureArchive(source, path.join(root, 'fifo.pg')), { code: 'ARCHIVE_TYPE_REJECTED' });
});

test('capture and measure reject changed PG root identity and alias ownership', linux, async t => {
  const root = await fixture(t), source = await pgSource(root), alias = path.join(source, 'data');
  await fs.lchown(alias, 999, 999); await assert.rejects(measureDirectory(source), { code: 'ARCHIVE_PG_ALIAS_INVALID' });
  await fs.lchown(alias, 0, 0); await fs.unlink(alias); await fs.symlink('18', alias);
  await assert.rejects(captureArchive(source, path.join(root, 'wrong-alias.pg')), { code: 'ARCHIVE_PG_ALIAS_INVALID' });
  await fs.unlink(alias); await fs.symlink('.', alias); await fs.writeFile(path.join(source, '18', 'docker', 'PG_VERSION'), '17\n');
  await assert.rejects(measureDirectory(source), { code: 'ARCHIVE_PG_LAYOUT_INVALID' });
  await fs.writeFile(path.join(source, '18', 'docker', 'PG_VERSION'), '18\n'); await fs.writeFile(path.join(source, 'extra'), 'synthetic');
  await assert.rejects(captureArchive(source, path.join(root, 'extra.pg')), { code: 'ARCHIVE_PG_LAYOUT_INVALID' });
});

test('restore validates archive hash and alias layout before writing any target member', linux, async t => {
  const root = await fixture(t), entries = syntheticEntries(), archive = path.join(root, 'rejected.pg'), target = path.join(root, 'target'); await fs.mkdir(target);
  entries[4].target = '..'; const bytes = archiveBytes(entries); await fs.writeFile(archive, bytes);
  await assert.rejects(restoreArchive(archive, target, { expectedSha256: sha(bytes) }), { code: 'ARCHIVE_PG_ALIAS_INVALID' }); assert.deepEqual(await fs.readdir(target), []);
  await fs.writeFile(archive, archiveBytes(syntheticEntries()));
  await assert.rejects(restoreArchive(archive, target, { expectedSha256: '0'.repeat(64) }), { code: 'ARCHIVE_HASH_MISMATCH' }); assert.deepEqual(await fs.readdir(target), []);
  await assert.rejects(restoreArchive(archive, target), { code: 'ARCHIVE_EXPECTED_HASH_REQUIRED' });
});

test('restore rejects link parents, occupied destinations and capture inside the PG root', linux, async t => {
  const root = await fixture(t), source = await pgSource(root), archive = path.join(root, 'cold.pg'), target = path.join(root, 'target'), alias = path.join(root, 'target-alias');
  const cold = await captureArchive(source, archive); await fs.mkdir(target); await fs.symlink(target, alias);
  await assert.rejects(restoreArchive(archive, alias, { expectedSha256: cold.sha256 }), { code: 'ARCHIVE_LINK_REJECTED' });
  await fs.writeFile(path.join(target, 'occupied'), 'synthetic');
  await assert.rejects(restoreArchive(archive, target, { expectedSha256: cold.sha256 }), { code: 'ARCHIVE_TARGET_NOT_EMPTY' });
  await assert.rejects(captureArchive(source, path.join(source, '18', 'inside.pg')), { code: 'ARCHIVE_TARGET_INSIDE_SOURCE' });
});

test('limits and cancellation stay enforced in the PG fork', linux, async t => {
  const root = await fixture(t), source = await pgSource(root), archive = path.join(root, 'cold.pg');
  await assert.rejects(captureArchive(source, archive, { limits: { maxMembers: 3 } }), { code: 'ARCHIVE_LIMIT_EXCEEDED' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(measureDirectory(source, { signal: controller.signal }), { code: 'ARCHIVE_INTERRUPTED' });
  await assert.rejects(captureArchive(source, path.join(root, 'interrupted.pg'), { signal: controller.signal }), { code: 'ARCHIVE_INTERRUPTED' });
});
