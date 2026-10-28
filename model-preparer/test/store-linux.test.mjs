import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createStore } from '../lib/store.mjs';
import { digest } from '../lib/contracts.mjs';

const JOB = '4db9e77c-7f82-467e-b336-51f5cf023c4b';
const linux = { skip: process.platform !== 'linux' };
const errorCode = code => error => error?.code === code;
async function fixture(t) {
  const base = await fs.realpath(os.tmpdir()), root = await fs.mkdtemp(path.join(base, 'preparer-linux-'));
  t.after(async () => { assert.equal(path.dirname(root), base); await fs.rm(root, { recursive: true, force: true }); });
  const store = createStore({ dataDirectory: path.join(root, 'data'), workDirectory: path.join(root, 'work') }); await store.init();
  return { root, store, file: path.join(root, 'data', 'locks', `${digest({ kind: 'job', key: JOB })}.lock`) };
}
async function owner(f) {
  let result;
  await f.store.withLock('job', JOB, async () => { result = JSON.parse(await fs.readFile(f.file)); });
  return result;
}

test('Linux leases persist boot, namespace and exact start ticks and refuse the live owner', linux, async t => {
  const f = await fixture(t);
  await f.store.withLock('job', JOB, async () => {
    const value = JSON.parse(await fs.readFile(f.file));
    assert.equal(value.schemaVersion, 2); assert.equal(value.pid, process.pid);
    assert.equal(value.processIdentity.bootId, (await fs.readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim());
    assert.equal(value.processIdentity.pidNamespace, await fs.readlink('/proc/self/ns/pid'));
    assert.match(value.processIdentity.startTicks, /^\d+$/);
    await assert.rejects(() => f.store.withLock('job', JOB, () => assert.fail('must not steal'), { recoverDead: true }), errorCode('LOCK_BUSY'));
  });
});

test('same-namespace stale start-tick fixture proves a reused PID does not retain its previous lease', linux, async t => {
  const f = await fixture(t), previous = await owner(f);
  previous.processIdentity.startTicks = String(BigInt(previous.processIdentity.startTicks) - 1n);
  await fs.writeFile(f.file, JSON.stringify(previous));
  await f.store.withLock('job', JOB, async lease => {
    await f.store.write('job', JOB, { status: 'captured' }, { lease });
    const current = JSON.parse(await fs.readFile(f.file));
    assert.notEqual(current.nonce, previous.nonce); assert.notEqual(current.processIdentity.startTicks, previous.processIdentity.startTicks);
  }, { recoverDead: true });
  assert.equal((await f.store.read('job', JOB)).status, 'captured');
});

test('foreign namespace and boot fixtures never prove death even with a different start tick', linux, async t => {
  const f = await fixture(t), previous = await owner(f);
  for (const changed of [
    { ...previous, processIdentity: { ...previous.processIdentity, pidNamespace: 'pid:[1]', startTicks: '1' } },
    { ...previous, processIdentity: { ...previous.processIdentity, bootId: '00000000-0000-0000-0000-000000000000', startTicks: '1' } }
  ]) {
    await fs.writeFile(f.file, JSON.stringify(changed));
    await assert.rejects(() => f.store.withLock('job', JOB, () => assert.fail('foreign identity must not acquire'), { recoverDead: true }), errorCode('LOCK_BUSY'));
    assert.deepEqual(JSON.parse(await fs.readFile(f.file)), changed);
  }
});

test('legacy Linux owner records remain readable but cannot authorize namespace-blind recovery', linux, async t => {
  const f = await fixture(t), value = await owner(f);
  delete value.processIdentity; value.schemaVersion = 1; value.pid = 2147483647;
  await fs.writeFile(f.file, JSON.stringify(value));
  await assert.rejects(() => f.store.withLock('job', JOB, () => assert.fail('legacy namespace is unknown'), { recoverDead: true }), errorCode('LOCK_BUSY'));
  assert.deepEqual(JSON.parse(await fs.readFile(f.file)), value);
});

test('release verifies the entire Linux process identity and preserves a changed owner', linux, async t => {
  const f = await fixture(t);
  await assert.rejects(() => f.store.withLock('job', JOB, async () => {
    const value = JSON.parse(await fs.readFile(f.file)); value.processIdentity.startTicks = '1'; await fs.writeFile(f.file, JSON.stringify(value));
  }), errorCode('LOCK_OWNER_MISMATCH'));
  assert.equal(JSON.parse(await fs.readFile(f.file)).processIdentity.startTicks, '1');
});
