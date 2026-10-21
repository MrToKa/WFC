import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import os from 'node:os';
import { bad } from './errors.mjs';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function uuid(value) { if (!UUID.test(value || '')) bad('INVALID_REQUEST'); return value; }
export function canonical(value) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && Object.getPrototypeOf(value) === Object.prototype) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  bad('STORE_CORRUPT', 500);
}
export const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
export function inside(root, target) { const rel = path.relative(path.resolve(root), path.resolve(target)); return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)); }
const samePath = (a, b) => process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);
export async function safePath(value, { directory = false, create = false } = {}) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /(^|[\\/])\.env(?:[.\\/]|$)/i.test(value)) bad('UNSAFE_PATH');
  const target = path.resolve(value), root = path.parse(target).root;
  const parts = path.relative(root, target).split(path.sep).filter(Boolean);
  let current = root, last;
  for (let i = -1; i < parts.length; i++) {
    if (i >= 0) current = path.join(current, parts[i]);
    const final = i === parts.length - 1;
    try { last = await fs.lstat(current); }
    catch (error) {
      if (error.code !== 'ENOENT' || !create || final && !directory) throw error;
      try { await fs.mkdir(current, { mode: 0o700 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
      last = await fs.lstat(current);
    }
    if (last.isSymbolicLink() || (!last.isDirectory() && !last.isFile()) || last.isFile() && last.nlink !== 1 || !samePath(await fs.realpath(current), current)) bad('UNSAFE_PATH');
    if ((!final || directory) ? !last.isDirectory() : !last.isFile()) bad('UNSAFE_PATH');
  }
  return { path: target, stat: last };
}
export async function hashFile(filename, { maxBytes = 2147483648, signal } = {}) {
  const before = (await safePath(filename)).stat, handle = await fs.open(filename, 'r');
  const hash = createHash('sha256'); let bytes = 0;
  try { for await (const chunk of handle.createReadStream({ autoClose: false, signal })) { bytes += chunk.length; if (bytes > maxBytes) bad('UPLOAD_LIMIT', 413); hash.update(chunk); } }
  finally { await handle.close(); }
  const after = (await safePath(filename)).stat;
  if (before.size !== bytes || after.size !== bytes || before.ino !== after.ino || before.mtimeMs !== after.mtimeMs) bad('ARTIFACT_INVALID', 409);
  return { bytes, sha256: hash.digest('hex') };
}
export async function removeOwned(root, target) {
  if (!inside(root, target) || samePath(root, target)) bad('UNSAFE_PATH');
  try { await safePath(target, { directory: true }); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  await fs.rm(target, { recursive: true, force: true });
}
export async function createJournal(root, { instanceId = null } = {}) {
  if (instanceId !== null) uuid(instanceId);
  await safePath(root, { directory: true, create: true });
  const lifecycle = path.join(root, '.service-owner.mutex');
  async function lifecycleMutex(action) {
    try { await fs.mkdir(lifecycle, { mode: 0o700 }); } catch (error) { if (error.code === 'EEXIST') bad('LOCK_BUSY', 409); throw error; }
    try { await safePath(lifecycle, { directory: true }); return await action(); }
    finally { await fs.rmdir(lifecycle); }
  }
  async function linuxIdentity() {
    if (process.platform !== 'linux') return null;
    const [bootId, pidNamespace, stat] = await Promise.all([fs.readFile('/proc/sys/kernel/random/boot_id', 'utf8'), fs.readlink(`/proc/${process.pid}/ns/pid`), fs.readFile(`/proc/${process.pid}/stat`, 'utf8')]);
    const startTicks = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/)[19];
    return { bootId: bootId.trim(), pidNamespace, startTicks };
  }
  const identityFile = path.join(root, 'service-store.json');
  let initialized = false;
  try {
    await safePath(identityFile);
    const identity = JSON.parse(await fs.readFile(identityFile, 'utf8'));
    if (identity.schemaVersion !== 1 || !UUID.test(identity.storeId) || Object.keys(identity).sort().join(',') !== 'schemaVersion,storeId') bad('STORE_CORRUPT', 500);
    initialized = true;
  } catch (error) { if (error.code !== 'ENOENT') bad('STORE_CORRUPT', 500); }
  const kinds = ['operations', 'requests', 'uploads', 'artifacts', 'browser'];
  const indexFile = path.join(root, 'service-index.json');
  let index = Object.fromEntries(kinds.map(kind => [kind, []]));
  if (initialized) for (const kind of kinds) { try { await safePath(path.join(root, kind), { directory: true }); } catch { bad('STORE_CORRUPT', 500); } }
  else if ((await fs.readdir(root)).length) bad('STORE_CORRUPT', 500);
  if (initialized) {
    try {
      const stat = (await safePath(indexFile)).stat; if (stat.size > 4 * 1024 * 1024) bad('STORE_CORRUPT', 500);
      const record = JSON.parse(await fs.readFile(indexFile, 'utf8'));
      if (record.schemaVersion !== 1 || record.checksum !== digest(record.entries) || Object.keys(record).sort().join(',') !== 'checksum,entries,schemaVersion' || Object.keys(record.entries).sort().join(',') !== kinds.slice().sort().join(',')) bad('STORE_CORRUPT', 500);
      for (const kind of kinds) if (!Array.isArray(record.entries[kind]) || record.entries[kind].some((id, i, array) => !UUID.test(id) || i > 0 && array[i - 1] >= id)) bad('STORE_CORRUPT', 500);
      index = record.entries;
    } catch { bad('STORE_CORRUPT', 500); }
  }
  const lock = path.join(root, 'service-owner.json'), nonce = randomUUID(), processIdentity = await linuxIdentity();
  const lease = await lifecycleMutex(async () => {
    try {
      const before = (await safePath(lock)).stat;
      const existing = await fs.readFile(lock, 'utf8');
      let owner; try { owner = JSON.parse(existing); } catch { bad('LOCK_BUSY', 409); }
      if (owner.hostname !== os.hostname() || !UUID.test(owner.nonce) || !Number.isInteger(owner.pid) || owner.pid < 1) bad('LOCK_BUSY', 409);
      if (processIdentity && (!owner.processIdentity || owner.processIdentity.bootId !== processIdentity.bootId || owner.processIdentity.pidNamespace !== processIdentity.pidNamespace || !/^\d+$/.test(owner.processIdentity.startTicks || ''))) bad('LOCK_BUSY', 409);
      try { process.kill(owner.pid, 0); bad('LOCK_BUSY', 409); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      const after = (await safePath(lock)).stat, readback = JSON.parse(await fs.readFile(lock, 'utf8'));
      if (before.ino !== after.ino || before.dev !== after.dev || readback.nonce !== owner.nonce) bad('LOCK_BUSY', 409);
      await fs.unlink(lock);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const handle = await fs.open(lock, 'wx', 0o600);
    try { await handle.writeFile(canonical({ pid: process.pid, hostname: os.hostname(), nonce, ...(instanceId ? { instanceId } : {}), ...(processIdentity ? { processIdentity } : {}) })); await handle.sync(); }
    catch (error) { await handle.close(); throw error; }
    return handle;
  });
  const directories = {};
  for (const kind of kinds) { directories[kind] = path.join(root, kind); await safePath(directories[kind], { directory: true, create: !initialized }); }
  if (!initialized) {
    const head = await fs.open(indexFile, 'wx', 0o600);
    try { await head.writeFile(canonical({ schemaVersion: 1, entries: index, checksum: digest(index) })); await head.sync(); } finally { await head.close(); }
    const handle = await fs.open(identityFile, 'wx', 0o600);
    try { await handle.writeFile(canonical({ schemaVersion: 1, storeId: randomUUID() })); await handle.sync(); } finally { await handle.close(); }
  }
  async function read(kind, id) {
    uuid(id); const file = path.join(directories[kind], id + '.json');
    if (!index[kind].includes(id)) return null;
    try {
      const stat = (await safePath(file)).stat; if (stat.size > 4 * 1024 * 1024) bad('STORE_CORRUPT', 500);
      const envelope = JSON.parse(await fs.readFile(file, 'utf8'));
      if (envelope.schemaVersion !== 1 || envelope.id !== id || envelope.kind !== kind || envelope.checksum !== digest(envelope.value) || Object.keys(envelope).sort().join(',') !== 'checksum,id,kind,schemaVersion,value') bad('STORE_CORRUPT', 500);
      return envelope.value;
    } catch (error) { if (error.code === 'STORE_CORRUPT') throw error; bad('STORE_CORRUPT', 500); }
  }
  let queue = Promise.resolve(), closing = false;
  async function writeNow(kind, id, value) {
    uuid(id); const file = path.join(directories[kind], id + '.json'), temporary = path.join(directories[kind], `.pending-${randomUUID()}.tmp`);
    try { await safePath(file); } catch (error) { if (error.code !== 'ENOENT') throw error; if (index[kind].includes(id)) bad('STORE_CORRUPT', 500); }
    const envelope = { schemaVersion: 1, id, kind, value, checksum: digest(value) };
    const bytes = Buffer.from(canonical(envelope)); if (bytes.length > 4 * 1024 * 1024) bad('STORE_CORRUPT', 500);
    const handle = await fs.open(temporary, 'wx', 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    try {
      await fs.rename(temporary, file);
      if (!index[kind].includes(id)) {
        const nextIndex = { ...index, [kind]: [...index[kind], id].sort() };
        const headBytes = Buffer.from(canonical({ schemaVersion: 1, entries: nextIndex, checksum: digest(nextIndex) })); if (headBytes.length > 4 * 1024 * 1024) bad('STORE_CORRUPT', 500);
        const pendingHead = path.join(root, `.index-${randomUUID()}.tmp`), head = await fs.open(pendingHead, 'wx', 0o600);
        try { await head.writeFile(headBytes); await head.sync(); } finally { await head.close(); }
        try { await fs.rename(pendingHead, indexFile); } finally { await fs.rm(pendingHead, { force: true }); }
        index = nextIndex;
      }
      if (digest(await read(kind, id)) !== envelope.checksum) bad('STORE_CORRUPT', 500);
    }
    finally { await fs.rm(temporary, { force: true }); }
    return value;
  }
  function write(kind, id, value) { if (closing) bad('SHUTTING_DOWN', 503); const next = queue.then(() => writeNow(kind, id, value)); queue = next.catch(() => {}); return next; }
  async function list(kind) {
    const names = await fs.readdir(directories[kind]);
    if (names.sort().join(',') !== index[kind].map(id => id + '.json').join(',')) bad('STORE_CORRUPT', 500);
    return Promise.all(names.map(name => read(kind, name.slice(0, -5))));
  }
  async function close() {
    closing = true;
    await queue;
    try {
      await lifecycleMutex(async () => {
        const current = (await safePath(lock)).stat, held = await lease.stat(), owner = JSON.parse(await fs.readFile(lock, 'utf8'));
        if (owner.nonce !== nonce || owner.pid !== process.pid || current.ino !== held.ino || current.dev !== held.dev) bad('LOCK_BUSY', 409);
        await fs.unlink(lock);
      });
    } finally { await lease.close(); }
  }
  return { read, write, list, close };
}
