import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { ownWork } from '../pathfinder-tray-catalog/guard-io.mjs';
import { createHostProofJournal, HOST_PROOF_JOURNAL_LIMITS } from './host-proof-journal.mjs';

const id = n => `ea900000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = value => createHash('sha256').update(value).digest('hex');
const normalize = value => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])])) : Array.isArray(value) ? value.map(normalize) : value;
const encoded = value => Buffer.from(JSON.stringify(normalize(value)) + '\n');
const proof = { joined: true, removed: true, containerId: 'b'.repeat(64) }, ack = { acknowledged: true, duplicate: false };
async function fixture(t) {
  const temporaryRoot = await fs.realpath(os.tmpdir()), root = await fs.realpath(await fs.mkdtemp(path.join(temporaryRoot, 'wfc-host-proof-journal-')));
  t.after(async () => {
    const absolute = path.resolve(root); assert.equal(path.dirname(absolute), path.resolve(temporaryRoot));
    assert.ok(path.basename(absolute).startsWith('wfc-host-proof-journal-')); assert.equal(await fs.realpath(absolute), absolute);
    await fs.rm(absolute, { recursive: true, force: false });
  });
  await fs.mkdir(path.join(root, 'pathfinder-engine/.scratch'), { recursive: true });
  const work = await ownWork({ root, id: id(1) });
  const configuration = { workPath: work.relative, owner: id(2), project: 'wfc-pathfinder-local-abcdef123456', image: 'sha256:' + 'c'.repeat(64), runtimeInventorySha256: 'd'.repeat(64) };
  const directory = path.join(work.directory, 'host-join-proofs'), recordPath = attemptId => path.join(directory, attemptId + '.private.json');
  const open = value => createHostProofJournal(value ?? configuration, { root });
  return { root, work, configuration, directory, recordPath, open };
}

test('journal starts empty only inside a verified private owned work directory', async t => {
  const f = await fixture(t), journal = await f.open(); assert.deepEqual(await journal.list(), []);
  assert.deepEqual(await fs.readdir(f.directory), ['owner.private.json']);
  if (process.platform !== 'win32') assert.equal((await fs.stat(f.directory)).mode & 0o077, 0);
  const marker = JSON.parse(await fs.readFile(path.join(f.directory, 'owner.private.json')));
  assert.equal(marker.workOwner, f.work.owner); assert.equal(marker.owner, f.configuration.owner);
});

test('retain persists one canonical fsynced bounded record with exact immutable config and no credentials', async t => {
  const f = await fixture(t), journal = await f.open(), record = await journal.retain({ attemptId: id(3), proof });
  const raw = await fs.readFile(f.recordPath(id(3))), { recordSha256, ...stored } = record;
  assert.deepEqual(raw, encoded(stored)); assert.equal(recordSha256, hash(raw)); assert.ok(raw.length <= HOST_PROOF_JOURNAL_LIMITS.fileBytes);
  assert.equal(Object.isFrozen(record), true); assert.equal(Object.isFrozen(record.proof), true);
  assert.deepEqual(record, { schemaVersion: 'wfc.pf.host-join-proof.v1', workOwner: f.work.owner, owner: f.configuration.owner, project: f.configuration.project,
    image: f.configuration.image, runtimeInventorySha256: f.configuration.runtimeInventorySha256, attemptId: id(3), proof, recordSha256: hash(raw) });
  assert.equal(/key|cookie|bearer|token|secret/i.test(raw.toString()), false);
});

test('a new daemon lists durable proof without rerunning capture or forgetting a lost POST ACK', async t => {
  const f = await fixture(t), first = await f.open(), record = await first.retain({ attemptId: id(3), proof });
  assert.deepEqual(await (await f.open()).list(), [record]); assert.equal((await fs.readdir(f.directory)).length, 2);
});

test('retain replays the same proof exactly and refuses changed physical evidence without overwriting it', async t => {
  const f = await fixture(t), journal = await f.open(), record = await journal.retain({ attemptId: id(3), proof }), before = await fs.readFile(f.recordPath(id(3)));
  assert.deepEqual(await journal.retain({ attemptId: id(3), proof }), record);
  await assert.rejects(journal.retain({ attemptId: id(3), proof: { ...proof, containerId: 'f'.repeat(64) } }), { code: 'PRODUCER_PROOF_JOURNAL_CONFLICT' });
  assert.deepEqual(await fs.readFile(f.recordPath(id(3))), before);
});

test('retirement requires an explicit successful exact ACK before changing any record', async t => {
  const f = await fixture(t), journal = await f.open(), record = await journal.retain({ attemptId: id(3), proof }), before = await fs.readFile(f.recordPath(id(3)));
  for (const bad of [undefined, {}, { acknowledged: false, duplicate: false }, { acknowledged: true }, { acknowledged: true, duplicate: false, ignored: true }]) {
    await assert.rejects(journal.retire(record, bad), { code: 'PRODUCER_PROOF_ACK_REQUIRED' }); assert.deepEqual(await fs.readFile(f.recordPath(id(3))), before);
  }
});

test('retirement cannot substitute a record, configuration, digest or container proof', async t => {
  const f = await fixture(t), journal = await f.open(), record = await journal.retain({ attemptId: id(3), proof });
  for (const change of [{ owner: id(99) }, { attemptId: id(99) }, { recordSha256: 'f'.repeat(64) }, { proof: { ...proof, containerId: 'e'.repeat(64) } }, { image: 'sha256:' + 'f'.repeat(64) }]) {
    await assert.rejects(journal.retire({ ...record, ...change }, ack)); assert.deepEqual(await journal.list(), [record]);
  }
});

test('only the exact acknowledged record retires; a repeated local ACK is harmless', async t => {
  const f = await fixture(t), journal = await f.open(), first = await journal.retain({ attemptId: id(3), proof }), second = await journal.retain({ attemptId: id(4), proof });
  await journal.retire(first, ack); await journal.retire(first, { acknowledged: true, duplicate: true });
  assert.deepEqual(await journal.list(), [second]); await assert.rejects(fs.stat(f.recordPath(id(3))), { code: 'ENOENT' });
  assert.deepEqual((await fs.readdir(f.directory)).sort(), [id(4) + '.private.json', 'owner.private.json'].sort());
});

test('restart finishes a durable exact ACK marker after an uncertain unlink', async t => {
  const f = await fixture(t), journal = await f.open(), record = await journal.retain({ attemptId: id(3), proof });
  const handle = await fs.open(f.recordPath(id(3)), 'a');
  try { await handle.writeFile(encoded({ schemaVersion: 'wfc.pf.host-join-proof-ack.v1', recordSha256: record.recordSha256, acknowledgement: ack })); await handle.sync(); }
  finally { await handle.close(); }
  assert.deepEqual(await (await f.open()).list(), []); await assert.rejects(fs.stat(f.recordPath(id(3))), { code: 'ENOENT' });
});

test('partial or foreign ACK markers fail closed and preserve the physical proof file', async t => {
  const f = await fixture(t), journal = await f.open(); await journal.retain({ attemptId: id(3), proof });
  await fs.appendFile(f.recordPath(id(3)), '{"schemaVersion":"unfinished'); const before = await fs.readFile(f.recordPath(id(3)));
  await assert.rejects(f.open()); assert.deepEqual(await fs.readFile(f.recordPath(id(3))), before);
});

test('another owner, image, project or inventory cannot reopen the same journal', async t => {
  const f = await fixture(t), journal = await f.open(); await journal.retain({ attemptId: id(3), proof }); const before = await fs.readFile(f.recordPath(id(3)));
  for (const change of [{ owner: id(99) }, { project: 'wfc-pathfinder-local-123456abcdef' }, { image: 'sha256:' + 'f'.repeat(64) }, { runtimeInventorySha256: 'f'.repeat(64) }]) {
    await assert.rejects(f.open({ ...f.configuration, ...change }), { code: 'PRODUCER_PROOF_JOURNAL_OWNER' });
  }
  assert.deepEqual(await fs.readFile(f.recordPath(id(3))), before);
});

test('oversized proof files are rejected before an unbounded read and are preserved', async t => {
  const f = await fixture(t), journal = await f.open(); await journal.retain({ attemptId: id(3), proof });
  await fs.appendFile(f.recordPath(id(3)), Buffer.alloc(HOST_PROOF_JOURNAL_LIMITS.fileBytes)); const size = (await fs.stat(f.recordPath(id(3)))).size;
  await assert.rejects(f.open(), { code: 'PRODUCER_PROOF_JOURNAL_FILE' }); assert.equal((await fs.stat(f.recordPath(id(3)))).size, size);
});

test('unknown child files are refused and never cleaned as journal entries', async t => {
  const f = await fixture(t); await f.open(); const foreign = path.join(f.directory, 'do-not-delete.txt'); await fs.writeFile(foreign, 'synthetic foreign file', { mode: 0o600 });
  await assert.rejects(f.open(), { code: 'PRODUCER_PROOF_JOURNAL_UNKNOWN_FILE' }); assert.equal(await fs.readFile(foreign, 'utf8'), 'synthetic foreign file');
});

test('hard-linked proof files cannot be consumed or retired', async t => {
  const f = await fixture(t), journal = await f.open(); await journal.retain({ attemptId: id(3), proof });
  const link = path.join(f.work.directory, 'proof-link.private.json'); await fs.link(f.recordPath(id(3)), link);
  await assert.rejects(journal.list(), { code: 'CATALOG_IO_TYPE' }); assert.equal((await fs.stat(link)).nlink, 2);
});

test('a redirected child directory cannot create files outside the owned journal', async t => {
  const f = await fixture(t), outside = path.join(f.root, 'synthetic-outside'); await fs.mkdir(outside, { mode: 0o700 });
  try { await fs.symlink(outside, f.directory, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('This host does not permit creating a synthetic link fixture'); return; } throw error; }
  await assert.rejects(f.open(), { code: 'CATALOG_IO_LINK' }); assert.deepEqual(await fs.readdir(outside), []);
});

test('record file count is bounded before scanning or mutating excess entries', async t => {
  const f = await fixture(t); await f.open();
  for (let n = 0; n < HOST_PROOF_JOURNAL_LIMITS.files; n++) await fs.writeFile(f.recordPath(id(100 + n)), '{}', { mode: 0o600, flag: 'wx' });
  await assert.rejects(f.open(), { code: 'PRODUCER_PROOF_JOURNAL_LIMIT' }); assert.equal((await fs.readdir(f.directory)).length, HOST_PROOF_JOURNAL_LIMITS.files + 1);
});

test('concurrent same-proof retention is serialized and never duplicates the durable record', async t => {
  const f = await fixture(t), journal = await f.open();
  const values = await Promise.all(Array.from({ length: 4 }, () => journal.retain({ attemptId: id(3), proof })));
  for (const value of values) assert.deepEqual(value, values[0]); assert.deepEqual(await journal.list(), [values[0]]);
  assert.equal((await fs.readdir(f.directory)).length, 2);
});

test('invalid paths, extra credentials and inexact proof scalars cannot enter the journal', async t => {
  const f = await fixture(t);
  await assert.rejects(f.open({ ...f.configuration, workPath: '../outside' }), { code: 'CATALOG_IO_WORK_PATH' });
  await assert.rejects(f.open({ ...f.configuration, key: 'must-not-be-stored' }), { code: 'PRODUCER_PROOF_JOURNAL_CONFIGURATION' });
  const journal = await f.open();
  for (const input of [{ attemptId: '../outside', proof }, { attemptId: id(3), proof: { ...proof, containerId: proof.containerId + '\n' } }, { attemptId: id(3), proof: { ...proof, removed: false } }, { attemptId: id(3), proof, ignored: true }]) await assert.rejects(journal.retain(input));
  assert.deepEqual(await journal.list(), []);
});
