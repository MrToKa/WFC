import { constants } from 'node:fs';
import { lstat, mkdir, open, link, unlink } from 'node:fs/promises';
import { resolve, dirname, join, parse } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const MAX_BYTES = 5 * 1024 * 1024;
const fail = code => { throw Object.assign(new Error(code), { code }); };
const hash = value => createHash('sha256').update(value).digest('hex');
async function safeDirectory(root) {
  const chain = []; let cursor = root;
  while (cursor !== parse(cursor).root) { chain.push(cursor); cursor = dirname(cursor); }
  chain.push(cursor);
  for (const path of chain.reverse()) {
    let stat;
    try { stat = await lstat(path); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; }); stat = await lstat(path);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail('CACHE_UNSAFE_DIRECTORY');
  }
}
async function readFileSafe(path) {
  let before;
  try { before = await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) fail('CACHE_UNSAFE_FILE');
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.ino !== before.ino || stat.dev !== before.dev) fail('CACHE_UNSAFE_FILE');
    if (stat.size > MAX_BYTES) fail('CACHE_LIMIT');
    // Bounded read even if another process grows the opened file.
    const buffer = Buffer.alloc(MAX_BYTES + 1); let used = 0;
    while (used < buffer.length) { const { bytesRead } = await file.read(buffer, used, buffer.length - used, used); if (!bytesRead) break; used += bytesRead; }
    if (used > MAX_BYTES) fail('CACHE_LIMIT');
    return buffer.subarray(0, used).toString('utf8');
  } finally { await file.close(); }
}
function validateKey(key) { if (typeof key !== 'string' || !/^[0-9a-f]{64}$/.test(key)) fail('CACHE_INVALID_KEY'); }
function stringify(value) {
  const active = new Set();
  function visit(item, depth) {
    if (depth > 32) fail('CACHE_INVALID_VALUE');
    if (item === null || typeof item === 'boolean' || typeof item === 'string' && item.isWellFormed() || typeof item === 'number' && Number.isFinite(item)) return;
    if (!item || typeof item !== 'object' || active.has(item) || Object.getOwnPropertySymbols(item).length) fail('CACHE_INVALID_VALUE');
    const proto = Object.getPrototypeOf(item);
    if (Array.isArray(item) ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) fail('CACHE_INVALID_VALUE');
    active.add(item);
    for (const key of Object.getOwnPropertyNames(item)) {
      if (Array.isArray(item) && key === 'length') continue;
      if (Array.isArray(item) && (!/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= item.length)) fail('CACHE_INVALID_VALUE');
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (['__proto__', 'constructor', 'prototype'].includes(key) || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail('CACHE_INVALID_VALUE');
      visit(descriptor.value, depth + 1);
    }
    if (Array.isArray(item) && Object.keys(item).length !== item.length) fail('CACHE_INVALID_VALUE');
    active.delete(item);
  }
  visit(value, 0); const text = JSON.stringify(value);
  if (Buffer.byteLength(text) > 4 * 1024 * 1024) fail('CACHE_LIMIT'); return text;
}
function envelope(raw, key) {
  try {
    const record = JSON.parse(raw);
    if (!record || Object.keys(record).sort().join(',') !== 'key,payload,payloadSha256,schemaVersion'
      || record.schemaVersion !== 'wfc.ai.analysis-cache.v1' || record.key !== key || typeof record.payload !== 'string'
      || hash(record.payload) !== record.payloadSha256) fail('CACHE_CORRUPT');
    const value = JSON.parse(record.payload); if (stringify(value) !== record.payload) fail('CACHE_CORRUPT'); return { value, payload: record.payload };
  } catch { fail('CACHE_CORRUPT'); }
}
/** A private application-owned directory is required; OS administrator tampering is outside this boundary. */
export function createAnalysisCache(root) {
  if (typeof root !== 'string' || !root.trim()) fail('CACHE_INVALID_DIRECTORY');
  const directory = resolve(root);
  return {
    async get(key) {
      validateKey(key); await safeDirectory(directory);
      const raw = await readFileSafe(join(directory, key + '.json'));
      return raw === null ? null : envelope(raw, key).value;
    },
    async put(key, value) {
      validateKey(key); const payload = stringify(value); await safeDirectory(directory);
      const path = join(directory, key + '.json'); const existing = await readFileSafe(path);
      if (existing !== null) {
        if (envelope(existing, key).payload !== payload) fail('CACHE_KEY_CONFLICT'); return;
      }
      const temp = join(directory, '.' + key + '.' + randomUUID() + '.tmp');
      let file;
      try {
        file = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
        const raw = JSON.stringify({ schemaVersion: 'wfc.ai.analysis-cache.v1', key, payload, payloadSha256: hash(payload) });
        if (Buffer.byteLength(raw) > MAX_BYTES) fail('CACHE_LIMIT');
        await file.writeFile(raw, 'utf8'); await file.sync(); await file.close(); file = undefined;
        await safeDirectory(directory);
        // Atomic no-replace publication: a concurrent writer cannot overwrite the first result.
        try { await link(temp, path); }
        catch (error) {
          if (error.code !== 'EEXIST') throw error;
          const raced = await readFileSafe(path);
          if (raced === null || envelope(raced, key).payload !== payload) fail('CACHE_KEY_CONFLICT');
        }
      } finally {
        if (file) await file.close();
        await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; });
      }
    },
  };
}
