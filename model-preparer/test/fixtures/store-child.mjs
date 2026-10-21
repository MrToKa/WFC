import { createStore } from '../../lib/store.mjs';

const [mode, dataDirectory, workDirectory, kind, key, parameter] = process.argv.slice(2);
const output = value => process.stdout.write(JSON.stringify(value) + '\n');
const store = createStore({ dataDirectory, workDirectory, fault: async point => {
  if (mode === `crash-${point}`) process.exit(77);
} });
try {
  await store.init();
  if (mode === 'init') { output({ initialized: true }); process.exit(0); }
  await store.withLock(kind, key, async lease => {
    if (mode === 'hold') {
      output({ ready: true, pid: process.pid });
      await new Promise(resolve => process.stdin.once('data', resolve));
      process.stdin.destroy();
      return;
    }
    const previous = await store.read(kind, key);
    if (mode === 'recover') await new Promise(resolve => setTimeout(resolve, Number(parameter ?? 150)));
    await store.write(kind, key, { status: 'submission-unknown', count: (previous?.count ?? 0) + 1 }, { lease });
    output({ acquired: true, count: (previous?.count ?? 0) + 1 });
  }, { recoverDead: mode === 'recover' });
} catch (error) { output({ error: error.code ?? 'UNKNOWN' }); process.exitCode = 2; }
