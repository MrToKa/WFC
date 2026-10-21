import { createStore } from '../lib/store.mjs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { digest } from '../lib/contracts.mjs';

const mode = process.argv[2], key = 'c'.repeat(64), kind = 'submission';
const store = createStore({ dataDirectory: '/state/data', workDirectory: '/state/work' }); await store.init();
const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
let release;
const stopped = new Promise(resolve => { release = resolve; });
if (mode === 'idle') {
  const keepAlive = setInterval(() => {}, 1000);
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, release);
  emit({ ready: true, pid: process.pid, pidNamespace: await fs.readlink('/proc/self/ns/pid') });
  await stopped; clearInterval(keepAlive);
} else if (mode === 'hold') {
  const keepAlive = setInterval(() => {}, 1000);
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, release);
  try {
    await store.withLock(kind, key, async lease => {
      const previous = await store.read(kind, key);
      await store.write(kind, key, { phase: 'submission-unknown', count: (previous?.count ?? 0) + 1 }, { lease });
      const lock = JSON.parse(await fs.readFile(path.join('/state/data/locks', `${digest({ kind, key })}.lock`)));
      emit({ ready: true, pid: process.pid, processIdentity: lock.processIdentity, phase: (await store.read(kind, key)).phase });
      await stopped;
    });
  } finally { clearInterval(keepAlive); }
  emit({ released: true, preserved: await store.read(kind, key) });
} else if (mode === 'recover' || mode === 'contend') {
  const previous = await store.read(kind, key);
  try {
    await store.withLock(kind, key, async lease => {
      await store.write(kind, key, { phase: 'submission-unknown', count: (previous?.count ?? 0) + 1 }, { lease });
    }, { recoverDead: true });
    emit({ acquired: true, pid: process.pid, pidNamespace: await fs.readlink('/proc/self/ns/pid'), previous, current: await store.read(kind, key) });
  } catch (error) { emit({ acquired: false, pid: process.pid, pidNamespace: await fs.readlink('/proc/self/ns/pid'), error: error.code || 'UNKNOWN', previous }); }
} else throw new Error('Unknown lifecycle fixture mode.');
