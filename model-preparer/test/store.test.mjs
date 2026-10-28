import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createStore } from '../lib/store.mjs';
import { digest } from '../lib/contracts.mjs';

const JOB = '4db9e77c-7f82-467e-b336-51f5cf023c4b';
const KEY = 'c'.repeat(64);
const childPath = fileURLToPath(new URL('./fixtures/store-child.mjs', import.meta.url));
const code = expected => error => error?.code === expected;
async function fixture(t, options = {}) {
  const { initialize = true, ...storeOptions } = options;
  const parent = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(parent, 'preparer-store-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(parent));
    assert.ok(path.basename(root).startsWith('preparer-store-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const dataDirectory = path.join(root, 'data'), workDirectory = path.join(root, 'work');
  const store = createStore({ dataDirectory, workDirectory, clock: { now: () => 1792144800000 }, ...storeOptions });
  if (initialize) await store.init();
  return { root, store, dataDirectory, workDirectory };
}
async function write(store, kind, key, value) { return store.withLock(kind, key, lease => store.write(kind, key, value, { lease })); }
function child(f, mode, kind = 'submission', key = KEY, parameter) {
  const process = spawn(globalThis.process.execPath, [childPath, mode, f.dataDirectory, f.workDirectory, kind, key, ...(parameter ? [String(parameter)] : [])], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  const lines = [];
  let readyResolve;
  const ready = new Promise(resolve => { readyResolve = resolve; });
  process.stdout.setEncoding('utf8');
  process.stdout.on('data', chunk => {
    stdout += chunk;
    const complete = stdout.split('\n').slice(0, -1);
    while (lines.length < complete.length) {
      const line = JSON.parse(complete[lines.length]); lines.push(line);
      if (line.ready) readyResolve(line);
    }
  });
  process.stderr.setEncoding('utf8'); process.stderr.on('data', chunk => { stderr += chunk; });
  const completed = new Promise((resolve, reject) => {
    process.on('error', reject);
    process.on('exit', (exitCode, signal) => { readyResolve({ exitedBeforeReady: true, lines, stdout, stderr }); resolve({ exitCode, signal, lines, stdout, stderr }); });
  });
  return { process, ready, completed };
}

test('construct/init/list/read are explicit local operations with empty state', async t => {
  const f = await fixture(t);
  assert.equal(await f.store.read('job', JOB), null);
  assert.deepEqual(await f.store.list('job'), []);
  const fresh = createStore({ dataDirectory: f.dataDirectory, workDirectory: f.workDirectory });
  await assert.rejects(() => fresh.read('job', JOB), code('CONFIGURATION_INVALID'));
  await fresh.init(); assert.equal(await fresh.read('job', JOB), null);
});

test('records retain checksummed immutable revisions and return detached caller values', async t => {
  const f = await fixture(t), value = { status: 'captured', nested: { count: 1 } };
  await write(f.store, 'job', JOB, value); value.nested.count = 999;
  assert.equal((await f.store.read('job', JOB)).nested.count, 1);
  const readback = await f.store.read('job', JOB); readback.status = 'changed';
  assert.equal((await f.store.read('job', JOB)).status, 'captured');
  await write(f.store, 'job', JOB, { status: 'uploaded', nested: { count: 2 } });
  const directory = path.join(f.dataDirectory, 'records', 'job', JOB);
  const names = (await fs.readdir(directory)).sort(); assert.deepEqual(names, ['0000000000000001.json', '0000000000000002.json']);
  const first = JSON.parse(await fs.readFile(path.join(directory, names[0]), 'utf8'));
  const second = JSON.parse(await fs.readFile(path.join(directory, names[1]), 'utf8'));
  assert.equal(second.previousHash, first.recordHash);
  assert.equal(first.value.status, 'captured');
  assert.deepEqual(await f.store.list('job'), [{ status: 'uploaded', nested: { count: 2 } }]);
});

test('write requires the exact owned active lease and serializes same-lease writers', async t => {
  const f = await fixture(t);
  await assert.rejects(() => f.store.write('job', JOB, { count: 1 }), code('LOCK_OWNER_MISMATCH'));
  await assert.rejects(() => f.store.write('job', JOB, { count: 1 }, { lease: { kind: 'job', key: JOB } }), code('LOCK_OWNER_MISMATCH'));
  let expired;
  await f.store.withLock('job', JOB, async lease => {
    expired = lease;
    await Promise.all([f.store.write('job', JOB, { count: 1 }, { lease }), f.store.write('job', JOB, { count: 2 }, { lease })]);
  });
  assert.equal((await f.store.read('job', JOB)).count, 2);
  await assert.rejects(() => f.store.write('job', JOB, { count: 3 }, { lease: expired }), code('LOCK_OWNER_MISMATCH'));
});

test('malformed, unknown and truncated records fail closed without reset', async t => {
  const f = await fixture(t);
  await write(f.store, 'submission', KEY, { status: 'submission-unknown' });
  const file = path.join(f.dataDirectory, 'records', 'submission', KEY, '0000000000000001.json');
  const original = await fs.readFile(file);
  for (const malformed of [Buffer.from('{'), Buffer.from(original.toString().replace('"kind":', '"unknown":1,"kind":')), Buffer.from(original.toString().replace('"kind":', '"kind":"submission","kind":')), Buffer.from([0xff])]) {
    await fs.writeFile(file, malformed);
    await assert.rejects(() => f.store.read('submission', KEY), code('STORE_CORRUPT'));
    await assert.rejects(() => write(f.store, 'submission', KEY, { status: 'captured' }), code('STORE_CORRUPT'));
    assert.deepEqual(await fs.readFile(file), malformed);
  }
});

test('modified checksums, missing middle/tail and removed chain directory are detected', async t => {
  const f = await fixture(t);
  await write(f.store, 'submission', KEY, { count: 1 }); await write(f.store, 'submission', KEY, { count: 2 });
  const directory = path.join(f.dataDirectory, 'records', 'submission', KEY), tail = path.join(directory, '0000000000000002.json');
  const saved = await fs.readFile(tail);
  const changed = JSON.parse(saved); changed.value.count = 9; await fs.writeFile(tail, JSON.stringify(changed));
  await assert.rejects(() => f.store.read('submission', KEY), code('STORE_CORRUPT'));
  await fs.writeFile(tail, saved); await fs.unlink(tail);
  await assert.rejects(() => f.store.read('submission', KEY), code('STORE_CORRUPT'));
  await fs.writeFile(tail, saved); await fs.unlink(path.join(directory, '0000000000000001.json'));
  await assert.rejects(() => f.store.read('submission', KEY), code('STORE_CORRUPT'));
});

test('missing identity and corrupt bootstrap are not treated as an empty new store', async t => {
  const f = await fixture(t); await write(f.store, 'job', JOB, { status: 'captured' });
  await fs.unlink(path.join(f.dataDirectory, 'store.json'));
  const reopened = createStore(f);
  await assert.rejects(() => reopened.init(), code('STORE_CORRUPT'));
  assert.equal((await fs.readdir(path.join(f.dataDirectory, 'records', 'job', JOB))).length, 1);
});

test('required-root loss cannot restore a shared ledger or admit a new job', async t => {
  for (const lost of [['records', 'heads'], ['records/submission'], ['locks'], ['snapshots']]) {
    const f = await fixture(t); await write(f.store, 'submission', KEY, { status: 'submission-unknown' });
    const marker = await fs.readFile(path.join(f.dataDirectory, 'store.json'));
    for (const relative of lost) await fs.rm(path.join(f.dataDirectory, ...relative.split('/')), { recursive: true });
    await assert.rejects(() => f.store.read('submission', KEY), code('STORE_CORRUPT'));
    await assert.rejects(() => f.store.read('job', JOB), code('STORE_CORRUPT'));
    await assert.rejects(() => f.store.withLock('job', JOB, () => assert.fail('a new job must not restore missing ledger roots')), code('STORE_CORRUPT'));
    await assert.rejects(() => f.store.init(), code('STORE_CORRUPT'));
    const reopened = createStore(f); await assert.rejects(() => reopened.init(), code('STORE_CORRUPT'));
    for (const relative of lost) await assert.rejects(() => fs.stat(path.join(f.dataDirectory, ...relative.split('/'))), { code: 'ENOENT' });
    assert.deepEqual(await fs.readFile(path.join(f.dataDirectory, 'store.json')), marker);
  }
});

test('each active operation revalidates the pinned bootstrap identity', async t => {
  const f = await fixture(t), marker = path.join(f.dataDirectory, 'store.json');
  const original = await fs.readFile(marker), replacement = JSON.parse(original);
  replacement.createdAt = '2026-10-15T00:00:00.000Z';
  const { checksum, ...body } = replacement; replacement.checksum = digest(body);
  await fs.writeFile(marker, JSON.stringify(replacement));
  for (const operation of [
    () => f.store.init(), () => f.store.read('job', JOB), () => f.store.list('job'),
    () => f.store.withLock('job', JOB, () => assert.fail('must not acquire under replaced identity')),
    () => f.store.captureSource(JOB, path.join(f.root, 'input.nwd')),
    () => f.store.verifySnapshot({})
  ]) await assert.rejects(operation, code('STORE_CORRUPT'));
  await fs.writeFile(marker, original);
  await f.store.withLock('job', JOB, async lease => {
    await fs.writeFile(marker, '{');
    await assert.rejects(() => f.store.write('job', JOB, { status: 'captured' }, { lease }), code('STORE_CORRUPT'));
  });
  assert.equal(await fs.readFile(marker, 'utf8'), '{');
});

test('concurrent first initialization publishes one intact identity or refuses safely', async t => {
  const f = await fixture(t, { initialize: false });
  const results = await Promise.all([child(f, 'init'), child(f, 'init'), child(f, 'init')].map(item => item.completed));
  assert.ok(results.some(result => result.lines.some(line => line.initialized)));
  assert.ok(results.every(result => result.exitCode === 0 || result.lines.some(line => line.error === 'LOCK_BUSY')));
  await f.store.init(); assert.equal(await f.store.read('submission', KEY), null);
  const marker = await fs.readFile(path.join(f.dataDirectory, 'store.json'));
  await f.store.init(); assert.deepEqual(await fs.readFile(path.join(f.dataDirectory, 'store.json')), marker);
});

test('beforeCommit fault leaves previous state; afterCommit fault preserves unknown intent', async t => {
  let phase;
  const f = await fixture(t, { fault: async point => { if (point === phase) throw new Error('injected local write failure'); } });
  await write(f.store, 'submission', KEY, { status: 'captured' });
  phase = 'beforeCommit'; await assert.rejects(() => write(f.store, 'submission', KEY, { status: 'submission-unknown' }));
  assert.equal((await f.store.read('submission', KEY)).status, 'captured');
  phase = 'afterCommit'; await assert.rejects(() => write(f.store, 'submission', KEY, { status: 'submission-unknown' }));
  assert.equal((await f.store.read('submission', KEY)).status, 'submission-unknown');
});

test('failed publication between record and high-water head remains corrupt across restarts', async t => {
  let phase;
  const f = await fixture(t, { fault: async point => { if (point === phase) throw new Error('injected multi-file commit failure'); } });
  await write(f.store, 'submission', KEY, { status: 'captured' });
  phase = 'afterRecordCommit'; await assert.rejects(() => write(f.store, 'submission', KEY, { status: 'submission-unknown' }));
  const record = await fs.readFile(path.join(f.dataDirectory, 'records', 'submission', KEY, '0000000000000002.json'));
  assert.equal(JSON.parse(record).value.status, 'submission-unknown');
  await assert.rejects(() => f.store.read('submission', KEY), code('STORE_CORRUPT'));
  phase = undefined;
  await assert.rejects(() => write(f.store, 'submission', KEY, { status: 'captured' }), code('STORE_CORRUPT'));
  const reopened = createStore(f); await reopened.init();
  await assert.rejects(() => reopened.read('submission', KEY), code('STORE_CORRUPT'));
  assert.deepEqual(await fs.readFile(path.join(f.dataDirectory, 'records', 'submission', KEY, '0000000000000002.json')), record);
});

test('paused publication fences read/list across independent store instances', async t => {
  let pause, entered, release;
  const reached = new Promise(resolve => { entered = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { fault: async (point, details) => {
    if (pause && point === 'afterRecordCommit' && details.revision === 2) { entered(); await blocked; }
  } });
  await write(f.store, 'submission', KEY, { count: 1 });
  const second = createStore(f); await second.init();
  pause = true;
  const writing = write(f.store, 'submission', KEY, { count: 2 }); await reached;
  const reading = Promise.all([f.store.read('submission', KEY), f.store.list('submission'), second.read('submission', KEY)]);
  await new Promise(resolve => setTimeout(resolve, 30)); release();
  await writing;
  assert.deepEqual(await reading, [{ count: 2 }, [{ count: 2 }], { count: 2 }]);
});

test('read-only inspection creates no locks and refuses every mutation', async t => {
  const f = await fixture(t); await write(f.store, 'job', JOB, { count: 1 });
  const inspected = createStore({ ...f, readOnly: true }); await inspected.init();
  assert.deepEqual(await inspected.read('job', JOB), { count: 1 });
  assert.deepEqual(await fs.readdir(path.join(f.dataDirectory, 'locks')), []);
  await assert.rejects(() => inspected.withLock('job', JOB, () => {}), code('CONFIGURATION_INVALID'));
  await assert.rejects(() => inspected.captureSource(JOB, path.join(f.root, 'input.nwd')), code('CONFIGURATION_INVALID'));
});

test('container recovery marker blocks initialization and current operations', async t => {
  const f = await fixture(t), marker = path.join(f.dataDirectory, '.docker-recovery.mutex'); await fs.mkdir(marker);
  await assert.rejects(() => createStore(f).init(), code('LOCK_BUSY'));
  await assert.rejects(() => f.store.read('job', JOB), code('LOCK_BUSY'));
  await assert.rejects(() => f.store.withLock('job', JOB, () => {}), code('LOCK_BUSY'));
  await fs.rmdir(marker);
  assert.equal(await f.store.read('job', JOB), null);
});

test('optional instance identity is serialized and pinned to each owned lease', async t => {
  const f = await fixture(t, { instanceId: JOB });
  await f.store.withLock('job', JOB, async lease => {
    const file = path.join(f.dataDirectory, 'locks', `${digest({ kind: 'job', key: JOB })}.lock`);
    assert.equal(JSON.parse(await fs.readFile(file)).instanceId, JOB);
    await f.store.write('job', JOB, { count: 1 }, { lease });
  });
});

test('real crash between record and high-water publication never falls back to eligibility', async t => {
  const f = await fixture(t), crashed = child(f, 'crash-afterRecordCommit');
  assert.equal((await crashed.completed).exitCode, 77);
  const reopened = createStore(f); await reopened.init();
  await assert.rejects(() => reopened.read('submission', KEY), code('STORE_CORRUPT'));
  await assert.rejects(() => reopened.withLock('submission', KEY, lease => reopened.write('submission', KEY, { status: 'captured' }, { lease }), { recoverDead: true }), code('STORE_CORRUPT'));
  assert.equal(JSON.parse(await fs.readFile(path.join(f.dataDirectory, 'records', 'submission', KEY, '0000000000000001.json'))).value.status, 'submission-unknown');
});

test('real live owner cannot be stolen or recovered by another process', async t => {
  const f = await fixture(t), held = child(f, 'hold');
  t.after(async () => { if (held.process.exitCode === null) held.process.kill('SIGKILL'); await held.completed; });
  const ready = await held.ready; assert.equal(ready.ready, true, JSON.stringify(ready));
  await assert.rejects(() => f.store.withLock('submission', KEY, () => assert.fail('must not acquire')), code('LOCK_BUSY'));
  await assert.rejects(() => f.store.withLock('submission', KEY, () => assert.fail('must not recover'), { recoverDead: true }), code('LOCK_BUSY'));
  held.process.stdin.end('release\n'); assert.equal((await held.completed).exitCode, 0);
});

test('real crash before write-ahead marker leaves no committed submission and permits explicit dead-owner recovery', async t => {
  const f = await fixture(t), crashed = child(f, 'crash-beforeCommit');
  assert.equal((await crashed.completed).exitCode, 77);
  assert.equal(await f.store.read('submission', KEY), null);
  await f.store.withLock('submission', KEY, lease => f.store.write('submission', KEY, { status: 'submission-unknown', count: 1 }, { lease }), { recoverDead: true });
  assert.equal((await f.store.read('submission', KEY)).status, 'submission-unknown');
});

test('real crash after write-ahead commit survives multiple fresh process restarts', async t => {
  const f = await fixture(t), crashed = child(f, 'crash-afterCommit');
  assert.equal((await crashed.completed).exitCode, 77);
  for (let index = 0; index < 3; index++) { const reopened = createStore(f); await reopened.init(); assert.equal((await reopened.read('submission', KEY)).status, 'submission-unknown'); }
  await f.store.withLock('submission', KEY, () => {}, { recoverDead: true });
  assert.equal((await f.store.read('submission', KEY)).count, 1);
});

test('two actual recovering processes cannot own or commit the same submission simultaneously', async t => {
  const f = await fixture(t), crashed = child(f, 'crash-afterCommit'); await crashed.completed;
  const processes = [child(f, 'recover', 'submission', KEY, 500), child(f, 'recover', 'submission', KEY, 500)];
  const results = await Promise.all(processes.map(item => item.completed));
  assert.equal(results.filter(result => result.lines.some(line => line.acquired)).length, 1);
  assert.equal(results.filter(result => result.lines.some(line => line.error === 'LOCK_BUSY')).length, 1);
  assert.equal((await f.store.read('submission', KEY)).count, 2);
});

test('ambiguous lock owner and abandoned lifecycle mutex refuse automatic recovery', async t => {
  const f = await fixture(t), file = path.join(f.dataDirectory, 'locks', `${digest({ kind: 'submission', key: KEY })}.lock`);
  await fs.writeFile(file, '{');
  await assert.rejects(() => f.store.withLock('submission', KEY, () => {}, { recoverDead: true }), code('LOCK_BUSY'));
  assert.equal(await fs.readFile(file, 'utf8'), '{');
  await fs.unlink(file); await fs.mkdir(file + '.mutex');
  await assert.rejects(() => f.store.withLock('submission', KEY, () => {}, { recoverDead: true }), code('LOCK_BUSY'));
  assert.equal((await fs.stat(file + '.mutex')).isDirectory(), true);
});

test('owner mismatch at release preserves a replaced foreign lock', async t => {
  const f = await fixture(t), file = path.join(f.dataDirectory, 'locks', `${digest({ kind: 'job', key: JOB })}.lock`);
  await assert.rejects(() => f.store.withLock('job', JOB, async () => { const owner = JSON.parse(await fs.readFile(file, 'utf8')); owner.nonce = '2eb23b2a-8e3f-43d6-8757-964004914b18'; await fs.writeFile(file, JSON.stringify(owner)); }), code('LOCK_OWNER_MISMATCH'));
  assert.ok(await fs.stat(file));
});

test('source capture preserves basename and exact bytes independently from original updates', async t => {
  const f = await fixture(t), source = path.join(f.root, 'input.nwd'), bytes = Buffer.alloc(300000, 23); await fs.writeFile(source, bytes);
  const captured = await f.store.captureSource(JOB, source);
  assert.equal(captured.name, 'input.nwd'); assert.equal(captured.bytes, bytes.length);
  assert.equal(captured.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(captured.snapshotPath, f.store.snapshotPath(JOB, 'input.nwd'));
  assert.deepEqual(await fs.readFile(captured.snapshotPath), bytes);
  await fs.writeFile(source, 'updated original');
  await f.store.verifySnapshot(captured);
  await assert.rejects(() => f.store.captureSource(JOB, source), code('SOURCE_EXISTS'));
  await fs.writeFile(captured.snapshotPath, 'corrupted snapshot');
  await assert.rejects(() => f.store.verifySnapshot(captured), code('SNAPSHOT_CHANGED'));
});

test('source mutation during streamed capture is refused and its unpublished staging is removed', async t => {
  const f = await fixture(t), source = path.join(f.root, 'input.nwd'); await fs.writeFile(source, Buffer.alloc(1024 * 1024, 5));
  let changed = false;
  await assert.rejects(() => f.store.captureSource(JOB, source, { onChunk: async () => { if (!changed) { changed = true; await fs.writeFile(source, 'different'); } } }), code('SOURCE_CHANGED'));
  await assert.rejects(() => fs.stat(path.dirname(f.store.snapshotPath(JOB, 'input.nwd'))), { code: 'ENOENT' });
});

test('capture/roots reject hardlinks, junction ancestors and overlapping directories', async t => {
  const f = await fixture(t), source = path.join(f.root, 'input.nwd'), hard = path.join(f.root, 'hard.nwd'); await fs.writeFile(source, 'bytes'); await fs.link(source, hard);
  await assert.rejects(() => f.store.captureSource(JOB, hard), code('UNSAFE_PATH'));
  assert.throws(() => createStore({ dataDirectory: f.dataDirectory, workDirectory: path.join(f.dataDirectory, 'nested') }), code('UNSAFE_PATH'));
  const actual = path.join(f.root, 'actual'), alias = path.join(f.root, 'alias'); await fs.mkdir(actual);
  try { await fs.symlink(actual, alias, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('Host cannot create a link fixture.'); return; } throw error; }
  const linked = createStore({ dataDirectory: path.join(alias, 'data'), workDirectory: path.join(f.root, 'separate-work') });
  await assert.rejects(() => linked.init(), code('UNSAFE_PATH'));
});

test('abort and secret-containing or unsupported identities cannot commit state', async t => {
  const f = await fixture(t), controller = new AbortController(); controller.abort();
  await assert.rejects(() => f.store.withLock('job', JOB, () => assert.fail('aborted callback'), { signal: controller.signal }), code('LOCAL_ABORTED'));
  await assert.rejects(() => f.store.read('job', '../escape'), code('INVALID_JOB'));
  await assert.rejects(() => write(f.store, 'job', JOB, { accessToken: 'never-persist' }), code('INVALID_JOB'));
  await assert.rejects(() => write(f.store, 'job', JOB, { signedUrl: 'https://invalid.example/?sig=never-persist' }), code('INVALID_JOB'));
  await assert.rejects(() => write(f.store, 'job', JOB, null), code('INVALID_JOB'));
  assert.equal(await f.store.read('job', JOB), null);
});
