import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm, symlink, link, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAnalysisCache } from '../lib/cache.mjs';

const key = 'a'.repeat(64);
async function temporary(run) {
  const root = await mkdtemp(join(tmpdir(), 'wfc-ai-cache-test-'));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}
test('cache miss, atomic write and restart retrieval preserve bounded JSON data', () => temporary(async root => {
  const cache = createAnalysisCache(root); const value = { analysis: { projectId: 'test', entities: [] } };
  assert.equal(await cache.get(key), null); await cache.put(key, value);
  assert.deepEqual(await createAnalysisCache(root).get(key), value); await cache.put(key, value);
}));
test('existing key cannot silently overwrite conflicting output', () => temporary(async root => {
  const cache = createAnalysisCache(root); await cache.put(key, { result: 'first' });
  await assert.rejects(cache.put(key, { result: 'second' }), { code: 'CACHE_KEY_CONFLICT' });
  assert.deepEqual(await cache.get(key), { result: 'first' });
}));
test('cache rejects traversal and invalid keys', () => temporary(async root => {
  const cache = createAnalysisCache(root);
  for (const invalid of ['../outside', 'A'.repeat(64), '', null, 'a'.repeat(65)]) {
    await assert.rejects(cache.get(invalid), { code: 'CACHE_INVALID_KEY' });
    await assert.rejects(cache.put(invalid, {}), { code: 'CACHE_INVALID_KEY' });
  }
}));
test('corrupt cache cannot masquerade as miss or be overwritten', () => temporary(async root => {
  const cache = createAnalysisCache(root); await cache.put(key, { result: 1 });
  const path = join(root, key + '.json'); const record = JSON.parse(await readFile(path, 'utf8'));
  record.payload = '{"result":2}'; await writeFile(path, JSON.stringify(record));
  await assert.rejects(cache.get(key), { code: 'CACHE_CORRUPT' });
  await assert.rejects(cache.put(key, { result: 1 }), { code: 'CACHE_CORRUPT' });
  await writeFile(path, '{truncated'); await assert.rejects(cache.get(key), { code: 'CACHE_CORRUPT' });
}));
test('cache envelope refuses another key and oversized data', () => temporary(async root => {
  const cache = createAnalysisCache(root); await cache.put(key, { result: 1 });
  const path = join(root, key + '.json'); const record = JSON.parse(await readFile(path, 'utf8'));
  record.key = 'b'.repeat(64); await writeFile(path, JSON.stringify(record));
  await assert.rejects(cache.get(key), { code: 'CACHE_CORRUPT' });
  await assert.rejects(cache.put('b'.repeat(64), { text: 'x'.repeat(4 * 1024 * 1024) }), { code: 'CACHE_LIMIT' });
}));
test('unsafe JSON values cannot silently truncate when serialized', () => temporary(async root => {
  const cache = createAnalysisCache(root);
  const cyclic = {}; cyclic.self = cyclic;
  for (const value of [{ x: undefined }, { x: NaN }, new Date(), cyclic, JSON.parse('{"__proto__":{}}'), { x: () => 1 }]) {
    await assert.rejects(cache.put(key, value), { code: 'CACHE_INVALID_VALUE' });
  }
}));
test('cache refuses directories at file paths and hardlinked records', () => temporary(async root => {
  const cache = createAnalysisCache(root); await mkdir(join(root, key + '.json'));
  await assert.rejects(cache.get(key), { code: 'CACHE_UNSAFE_FILE' });
  const otherKey = 'b'.repeat(64); await cache.put(otherKey, {});
  await link(join(root, otherKey + '.json'), join(root, 'hardlink.json'));
  await assert.rejects(cache.get(otherKey), { code: 'CACHE_UNSAFE_FILE' });
}));
test('cache refuses symlinked roots and files where OS permits creating links', async t => temporary(async root => {
  const target = join(root, 'target'); await mkdir(target); const linked = join(root, 'linked');
  try { await symlink(target, linked, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip('OS does not permit test links'); return; } throw error; }
  await assert.rejects(createAnalysisCache(linked).get(key), { code: 'CACHE_UNSAFE_DIRECTORY' });
  const cache = createAnalysisCache(target); await writeFile(join(target, 'source.json'), '{}');
  try { await symlink(join(target, 'source.json'), join(target, key + '.json')); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.diagnostic('file symlink permission unavailable; root junction tested'); return; } throw error; }
  await assert.rejects(cache.get(key), { code: 'CACHE_UNSAFE_FILE' });
}));
test('concurrent conflicting publications cannot replace the winning value', () => temporary(async root => {
  const outcomes = await Promise.allSettled([createAnalysisCache(root).put(key, { result: 1 }), createAnalysisCache(root).put(key, { result: 2 })]);
  assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 1);
  const value = await createAnalysisCache(root).get(key); assert.ok(value.result === 1 || value.result === 2);
}));
