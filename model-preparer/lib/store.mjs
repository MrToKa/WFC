import * as fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { canonical, digest, fail, abortCheck, nowIso, validateId, validateSourceName, validateLocalPath } from './contracts.mjs';

const KINDS = new Set(['job', 'submission', 'target', 'cost']);
const MAX_RECORD_BYTES = 32 * 1024 ** 2;
const MAX_REVISIONS = 100000;
const SHA = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const revisionName = revision => `${String(revision).padStart(16, '0')}.json`;
const folded = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const contains = (root, value) => folded(value) === folded(root) || folded(value).startsWith(folded(root) + path.sep);

function exact(value, keys, code = 'STORE_CORRUPT') {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    fail(code, 'Unrecognized persistent record shape.');
  }
}

// Persistent checksums are meaningful only after parsing without duplicate-key
// loss. This bounded parser deliberately has no duplicate exception.
function json(bytes) {
  if (bytes.length > MAX_RECORD_BYTES) fail('PACKAGE_LIMIT_EXCEEDED', 'Persistent record exceeds its byte limit.');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { fail('STORE_CORRUPT', 'Persistent JSON is not valid UTF-8.'); }
  let cursor = 0;
  const invalid = () => fail('STORE_CORRUPT', 'Persistent JSON is malformed, truncated or ambiguous.');
  const white = () => { while (cursor < text.length && /[ \t\r\n]/.test(text[cursor])) cursor++; };
  function string() {
    const start = cursor++;
    while (cursor < text.length) {
      const current = text[cursor++];
      if (current === '"') { try { return JSON.parse(text.slice(start, cursor)); } catch { invalid(); } }
      if (current.charCodeAt(0) < 32) invalid();
      if (current === '\\') {
        const escaped = text[cursor++];
        if (escaped === 'u') { if (!/^[0-9a-fA-F]{4}$/.test(text.slice(cursor, cursor + 4))) invalid(); cursor += 4; }
        else if (!'"\\/bfnrt'.includes(escaped ?? '')) invalid();
      }
    }
    invalid();
  }
  function value(depth) {
    white();
    if (depth > 64) fail('PACKAGE_LIMIT_EXCEEDED', 'Persistent JSON nesting is excessive.');
    const current = text[cursor];
    if (current === '{' || current === '[') {
      cursor++;
      const object = current === '{', end = object ? '}' : ']';
      const result = object ? {} : [];
      white(); if (text[cursor] === end) { cursor++; return result; }
      while (true) {
        white(); let key;
        if (object) { if (text[cursor] !== '"') invalid(); key = string(); white(); if (text[cursor++] !== ':') invalid(); }
        const parsed = value(depth + 1);
        if (object) {
          if (Object.hasOwn(result, key)) invalid();
          Object.defineProperty(result, key, { value: parsed, enumerable: true, writable: true, configurable: true });
        } else result.push(parsed);
        white(); if (text[cursor] === end) { cursor++; return result; }
        if (text[cursor++] !== ',') invalid();
      }
    }
    if (current === '"') return string();
    for (const [literal, result] of [['true', true], ['false', false], ['null', null]]) {
      if (text.startsWith(literal, cursor)) { cursor += literal.length; return result; }
    }
    const numeric = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(cursor));
    if (!numeric) invalid();
    cursor += numeric[0].length;
    const result = Number(numeric[0]); if (!Number.isFinite(result)) invalid(); return result;
  }
  const result = value(0); white(); if (cursor !== text.length) invalid(); return result;
}

// Internal controlled-recovery tool shares the exact persistent parser. This
// is intentionally not re-exported from the public application entry point.
export const parsePersistentJson = bytes => json(bytes);

function safeValue(value, depth = 0) {
  if (depth > 64) fail('PACKAGE_LIMIT_EXCEEDED', 'State value nesting is excessive.');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    if (typeof value === 'string' && /https?:\/\/\S+[?&](?:signature|sig|token|x-amz-|x-ads-)/i.test(value)) fail('INVALID_JOB', 'Signed URLs cannot be stored.');
    return;
  }
  if (typeof value === 'number') { if (!Number.isFinite(value)) fail('INVALID_JOB', 'State values require finite JSON numbers.'); return; }
  if (!value || typeof value !== 'object' || (![Object.prototype, null].includes(Object.getPrototypeOf(value)) && !Array.isArray(value))) fail('INVALID_JOB', 'Only plain JSON values can be stored.');
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === 'length') continue;
    if (typeof key !== 'string' || /^(?:password|secret|clientSecret|accessToken|refreshToken|authorization|signedUrl)$/i.test(key)) fail('INVALID_JOB', 'Credentials and non-JSON fields cannot be stored.');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor.get || descriptor.set || !descriptor.enumerable) fail('INVALID_JOB', 'State fields must be JSON data properties.');
    safeValue(value[key], depth + 1);
  }
}

async function exists(file) {
  try { await fs.lstat(file); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function noLinks(value, { directory = false } = {}) {
  await validateLocalPath(value);
  const absolute = path.resolve(value), root = path.parse(absolute).root;
  const components = path.relative(root, absolute).split(path.sep).filter(Boolean);
  let current = root;
  for (let index = -1; index < components.length; index++) {
    if (index >= 0) current = path.join(current, components[index]);
    const stat = await fs.lstat(current), last = index === components.length - 1;
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()) || (stat.isFile() && stat.nlink !== 1)) fail('UNSAFE_PATH', 'Links and special local files are unsupported.');
    if ((!last || directory) && !stat.isDirectory()) fail('UNSAFE_PATH', 'Expected a safe local directory.');
    if (last && !directory && !stat.isFile()) fail('UNSAFE_PATH', 'Expected a regular local file.');
    if (folded(await fs.realpath(current)) !== folded(current)) fail('UNSAFE_PATH', 'Path resolves outside its canonical location.');
  }
  return absolute;
}

async function safeDirectory(value) {
  let ancestor = path.resolve(value);
  while (!(await exists(ancestor))) {
    const parent = path.dirname(ancestor); if (parent === ancestor) fail('UNSAFE_PATH', 'No safe directory ancestor.'); ancestor = parent;
  }
  await noLinks(ancestor, { directory: true });
  await fs.mkdir(value, { recursive: true, mode: 0o700 });
  return noLinks(value, { directory: true });
}

async function boundedRead(file) {
  await noLinks(file);
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat(); if (stat.size > MAX_RECORD_BYTES) fail('PACKAGE_LIMIT_EXCEEDED', 'State file exceeds its byte limit.');
    const chunks = []; let total = 0;
    while (true) {
      const buffer = Buffer.alloc(64 * 1024), result = await handle.read(buffer, 0, buffer.length, total);
      if (!result.bytesRead) break;
      total += result.bytesRead;
      if (total > MAX_RECORD_BYTES || total > stat.size) fail('STORE_CORRUPT', 'State changed or grew during its bounded read.');
      chunks.push(buffer.subarray(0, result.bytesRead));
    }
    const after = await handle.stat();
    if (total !== stat.size || !sameStat(stat, after)) fail('STORE_CORRUPT', 'State changed during its read.');
    return Buffer.concat(chunks, total);
  } finally { await handle.close(); }
}

async function syncDirectory(directory) {
  let handle;
  try { handle = await fs.open(directory, 'r'); await handle.sync(); }
  catch (error) { if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EINVAL', 'EISDIR', 'ENOTSUP'].includes(error.code)) throw error; }
  finally { if (handle) await handle.close(); }
}

function sameStat(before, after) {
  return before.ino === after.ino && before.dev === after.dev && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs;
}

// Kernel process identity supplements the PID only on Linux. A PID from a
// different namespace is never interpreted as a process on this namespace.
async function linuxProcessIdentity(pid) {
  const bootId = (await fs.readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
  const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
  const close = stat.lastIndexOf(')'), fields = stat.slice(close + 2).trim().split(/\s+/);
  const startTicks = fields[19], pidNamespace = await fs.readlink(`/proc/${pid}/ns/pid`);
  if (close < 0 || !/^\d+\s+\(/.test(stat) || !/^[0-9a-f-]{36}$/.test(bootId) || !/^\d+$/.test(startTicks ?? '') || !/^pid:\[\d+\]$/.test(pidNamespace)) fail('LOCK_BUSY', 'Linux process identity is unreadable or ambiguous.');
  return { kind: 'linux-proc-v1', bootId, startTicks, pidNamespace };
}

function validateProcessIdentity(identity) {
  exact(identity, ['kind', 'bootId', 'startTicks', 'pidNamespace'], 'LOCK_BUSY');
  if (identity.kind !== 'linux-proc-v1' || typeof identity.bootId !== 'string' || !/^[0-9a-f-]{36}$/.test(identity.bootId) || typeof identity.startTicks !== 'string' || !/^\d+$/.test(identity.startTicks) || typeof identity.pidNamespace !== 'string' || !/^pid:\[\d+\]$/.test(identity.pidNamespace)) fail('LOCK_BUSY', 'Unsupported Linux process identity.');
}

async function proveOwnerDead(owner) {
  if (process.platform === 'linux') {
    if (owner.schemaVersion !== 2) fail('LOCK_BUSY', 'Legacy Linux owner lacks a namespace identity; inspection is required.');
    let self;
    try { self = await linuxProcessIdentity(process.pid); }
    catch { fail('LOCK_BUSY', 'Current Linux process identity cannot be established.'); }
    if (owner.processIdentity.bootId !== self.bootId || owner.processIdentity.pidNamespace !== self.pidNamespace) fail('LOCK_BUSY', 'Owner belongs to another boot or PID namespace; death is not proven.');
    try {
      const current = await linuxProcessIdentity(owner.pid);
      if (current.bootId !== self.bootId || current.pidNamespace !== self.pidNamespace) fail('LOCK_BUSY', 'Current PID namespace is ambiguous.');
      if (current.startTicks !== owner.processIdentity.startTicks) return; // same namespace: exact prior process no longer owns this reused PID
      fail('LOCK_BUSY', 'The exact live Linux process owns this lock.');
    } catch (error) {
      if (error.code === 'LOCK_BUSY') throw error;
      if (error.code !== 'ENOENT') fail('LOCK_BUSY', 'Linux process ownership cannot be established safely.');
      // Confirm absence through the OS instead of trusting a missing proc file
      // caused by permission, mount or transient read failures.
    }
  } else if (owner.schemaVersion !== 1) fail('LOCK_BUSY', 'Foreign Linux ownership cannot be recovered here.');
  try { process.kill(owner.pid, 0); fail('LOCK_BUSY', 'A live process owns the lock.'); }
  catch (error) { if (error.code !== 'ESRCH') { if (error.code === 'LOCK_BUSY') throw error; fail('LOCK_BUSY', 'Process death is not proven.'); } }
}

export function createStore({ dataDirectory, workDirectory, clock = { now: () => Date.now() }, fault = async () => {}, instanceId, readOnly = false, recoveryNonce }) {
  if (instanceId !== undefined) validateId(instanceId);
  if (recoveryNonce !== undefined) validateId(recoveryNonce);
  const data = path.resolve(dataDirectory), work = path.resolve(workDirectory);
  if (contains(data, work) || contains(work, data)) fail('UNSAFE_PATH', 'Persistence and work directories must be disjoint.');
  const recordsRoot = path.join(data, 'records'), locksRoot = path.join(data, 'locks'), snapshotsRoot = path.join(data, 'snapshots'), headsRoot = path.join(data, 'heads');
  const requiredDirectories = [data, recordsRoot, locksRoot, snapshotsRoot, headsRoot, ...[...KINDS].map(kind => path.join(recordsRoot, kind))];
  const leases = new WeakMap();
  let initialized = false, bootstrapChecksum;
  const requireInit = () => { if (!initialized) fail('CONFIGURATION_INVALID', 'Initialize this local store explicitly first.'); };
  function validateKey(kind, key) {
    if (!KINDS.has(kind) || typeof key !== 'string' || (!UUID.test(key) && !SHA.test(key))) fail('INVALID_JOB', 'Unsupported record kind or identity.');
  }
  const recordDirectory = (kind, key) => { validateKey(kind, key); return path.join(recordsRoot, kind, key); };
  const lockFile = (kind, key) => path.join(locksRoot, `${digest({ kind, key })}.lock`);
  const publicationFile = (kind, key) => path.join(locksRoot, `${digest({ kind, key })}.publication.lock`);
  const writable = () => { if (readOnly) fail('CONFIGURATION_INVALID', 'This quiescent inspection store is read-only.'); };
  async function checkRecovery() {
    const marker = path.join(data, '.docker-recovery.mutex');
    if (!(await exists(marker))) return;
    if (readOnly && recoveryNonce !== undefined) {
      const owner = json(await boundedRead(path.join(marker, 'owner.json')));
      if (owner.nonce === recoveryNonce) return;
    }
    fail('LOCK_BUSY', 'Explicit stopped-container recovery owns this store; startup and operations are blocked.');
  }

  const headFile = (kind, key) => path.join(headsRoot, `${digest({ kind, key })}.json`);
  async function loadBootstrap() {
    try {
      const meta = json(await boundedRead(path.join(data, 'store.json')));
      exact(meta, ['schemaVersion', 'storeId', 'createdAt', 'checksum']);
      const { checksum, ...body } = meta;
      if (meta.schemaVersion !== 1 || !UUID.test(meta.storeId) || typeof meta.createdAt !== 'string' || !Number.isFinite(Date.parse(meta.createdAt)) || digest(body) !== checksum || (bootstrapChecksum !== undefined && checksum !== bootstrapChecksum)) fail('STORE_CORRUPT', 'Store identity is corrupt, replaced or unsupported.');
      for (const directory of requiredDirectories) await noLinks(directory, { directory: true });
      return checksum;
    } catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes(error.code)) fail('STORE_CORRUPT', 'Required persistent store identity or directory is missing; refusing reset.');
      throw error;
    }
  }
  async function checkBootstrap() { requireInit(); await checkRecovery(); await loadBootstrap(); }
  async function readHead(kind, key) {
    const file = headFile(kind, key);
    if (!(await exists(file))) return null;
    const head = json(await boundedRead(file));
    exact(head, ['schemaVersion', 'kind', 'key', 'revision', 'recordHash', 'checksum']);
    const { checksum, ...body } = head;
    if (head.schemaVersion !== 1 || head.kind !== kind || head.key !== key || !Number.isSafeInteger(head.revision) || head.revision < 0 || (head.revision === 0 ? head.recordHash !== null : !SHA.test(head.recordHash)) || digest(body) !== checksum) fail('STORE_CORRUPT', 'Invalid committed high-water head.');
    return head;
  }
  async function writeHead(kind, key, revision, recordHash) {
    const body = { schemaVersion: 1, kind, key, revision, recordHash }, file = headFile(kind, key);
    const temporary = path.join(headsRoot, `.head-${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await fs.open(temporary, 'wx', 0o600); await handle.writeFile(canonical({ ...body, checksum: digest(body) }) + '\n'); await handle.sync(); await handle.close(); handle = null;
      // Per-identity lease and its serial write queue protect this replacement.
      await fs.rename(temporary, file); await syncDirectory(headsRoot);
    } finally { if (handle) await handle.close(); await fs.rm(temporary, { force: true }); }
  }

  async function mutex(lockPath, operation, { signal, retry = false } = {}) {
    const directory = `${lockPath}.mutex`;
    let ownerStat;
    for (let attempt = 0; attempt < (retry ? 100 : 1); attempt++) {
      if (signal) abortCheck(signal);
      try { await fs.mkdir(directory, { mode: 0o700 }); ownerStat = await fs.lstat(directory); break; }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (!retry) fail('LOCK_BUSY', 'Another lifecycle operation owns this mutex; no stale mutex is deleted automatically.');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    if (!ownerStat) fail('LOCK_BUSY', 'Lifecycle mutex remains busy.');
    try { return await operation(); }
    finally {
      const stat = await fs.lstat(directory);
      if (stat.ino !== ownerStat.ino || stat.dev !== ownerStat.dev || stat.isSymbolicLink()) fail('LOCK_OWNER_MISMATCH', 'Lifecycle directory ownership changed.');
      await fs.rmdir(directory);
    }
  }

  async function readOwner(file) {
    let owner;
    try { owner = json(await boundedRead(file)); }
    catch { fail('LOCK_BUSY', 'Lock owner cannot be established safely.'); }
    const fields = ['schemaVersion', 'kind', 'key', 'pid', 'hostname', 'nonce', 'acquiredAt'];
    if (owner?.schemaVersion === 2) fields.push('processIdentity');
    if (Object.hasOwn(owner ?? {}, 'instanceId')) fields.push('instanceId');
    exact(owner, fields, 'LOCK_BUSY');
    if (![1, 2].includes(owner.schemaVersion) || !Number.isSafeInteger(owner.pid) || owner.pid < 1 || owner.hostname !== os.hostname() || !UUID.test(owner.nonce)) fail('LOCK_BUSY', 'Ambiguous lock ownership.');
    if (owner.schemaVersion === 2) validateProcessIdentity(owner.processIdentity);
    if (owner.instanceId !== undefined && !UUID.test(owner.instanceId)) fail('LOCK_BUSY', 'Invalid instance ownership.');
    validateKey(owner.kind, owner.key);
    return owner;
  }

  async function owned(lease, kind, key) {
    const internal = leases.get(lease);
    if (!internal?.active || internal.kind !== kind || internal.key !== key) fail('LOCK_OWNER_MISMATCH', 'An active matching store lease is required.');
    const owner = await readOwner(internal.file), stat = await fs.lstat(internal.file), held = await internal.handle.stat();
    if (owner.nonce !== internal.nonce || owner.pid !== process.pid || owner.instanceId !== instanceId || digest(owner.processIdentity ?? null) !== digest(internal.processIdentity ?? null) || stat.ino !== held.ino || stat.dev !== held.dev) fail('LOCK_OWNER_MISMATCH', 'Lock identity changed; another owner is preserved.');
    return internal;
  }

  // This fence covers only publication/inspection of one revision. It is not
  // the potentially long job lease. A crashed publisher is never stolen here.
  async function publication(kind, key, operation, { signal, inspectDead = false } = {}) {
    if (readOnly) return operation();
    const file = publicationFile(kind, key);
    let handle, nonce = randomUUID(), processIdentity;
    const deadline = performance.now() + 30000;
    for (let attempt = 0; attempt < 3000 && performance.now() < deadline; attempt++) {
      if (signal) abortCheck(signal);
      await checkBootstrap();
      try { handle = await fs.open(file, 'wx', 0o600); break; }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (inspectDead) {
          try { const owner = await readOwner(file); await proveOwnerDead(owner); return operation(); }
          catch (ownerError) { if (ownerError.code !== 'LOCK_BUSY') throw ownerError; }
        }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    if (!handle) fail('LOCK_BUSY', 'Revision publication remains busy; no marker is deleted automatically.');
    try {
      if (process.platform === 'linux') processIdentity = await linuxProcessIdentity(process.pid);
      const owner = { schemaVersion: processIdentity ? 2 : 1, kind, key, pid: process.pid, hostname: os.hostname(), nonce, acquiredAt: nowIso(clock), ...(processIdentity ? { processIdentity } : {}), ...(instanceId ? { instanceId } : {}) };
      await handle.writeFile(canonical(owner) + '\n'); await handle.sync();
      return await operation();
    } finally {
      try {
        const stat = await fs.lstat(file), held = await handle.stat(), owner = await readOwner(file);
        if (stat.ino !== held.ino || stat.dev !== held.dev || owner.nonce !== nonce || owner.pid !== process.pid || owner.instanceId !== instanceId) fail('LOCK_OWNER_MISMATCH', 'Publication fence ownership changed; replacement is preserved.');
        await fs.unlink(file);
      } finally { await handle.close(); }
    }
  }

  async function readChain(kind, key, fenced = false) {
    await checkBootstrap();
    validateKey(kind, key);
    if (!fenced && !readOnly) return publication(kind, key, () => readChain(kind, key, true), { inspectDead: true });
    const directory = recordDirectory(kind, key);
    const head = await readHead(kind, key);
    if (!(await exists(directory))) {
      if (head?.revision > 0) fail('STORE_CORRUPT', 'Committed record directory is missing.');
      return { value: null, revision: 0, hash: null };
    }
    await noLinks(directory, { directory: true });
    const entries = await fs.readdir(directory, { withFileTypes: true }), names = [];
    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink()) fail('STORE_CORRUPT', 'Unexpected entry in the revision chain.');
      if (/^\.pending-[0-9a-f-]{36}\.tmp$/.test(entry.name)) {
        try { await noLinks(path.join(directory, entry.name)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        continue;
      }
      if (!/^\d{16}\.json$/.test(entry.name)) fail('STORE_CORRUPT', 'Unrecognized revision-chain file.');
      names.push(entry.name);
    }
    if (names.length > MAX_REVISIONS) fail('PACKAGE_LIMIT_EXCEEDED', 'Revision chain exceeds its count limit.');
    names.sort();
    if (!head || head.revision !== names.length) fail('STORE_CORRUPT', 'Revision tail and committed high-water head disagree.');
    let latest = { value: null, revision: 0, hash: null };
    for (const name of names) {
      const record = json(await boundedRead(path.join(directory, name)));
      exact(record, ['schemaVersion', 'kind', 'key', 'revision', 'previousHash', 'committedAt', 'value', 'recordHash']);
      const { recordHash, ...body } = record;
      if (record.schemaVersion !== 1 || record.kind !== kind || record.key !== key || record.revision !== latest.revision + 1 || name !== revisionName(record.revision) || record.previousHash !== latest.hash || !SHA.test(recordHash) || digest(body) !== recordHash || typeof record.committedAt !== 'string' || !Number.isFinite(Date.parse(record.committedAt))) fail('STORE_CORRUPT', 'Revision, checksum or previous-hash continuity failed.');
      try { safeValue(record.value); } catch { fail('STORE_CORRUPT', 'Persistent value is outside the safe JSON contract.'); }
      latest = { value: record.value, revision: record.revision, hash: recordHash };
    }
    if (latest.hash !== head.recordHash) fail('STORE_CORRUPT', 'Committed chain head checksum disagrees.');
    return latest;
  }

  async function init() {
    if (initialized) { await checkBootstrap(); return; }
    await checkRecovery();
    if (readOnly) {
      await noLinks(data, { directory: true }); await noLinks(work, { directory: true });
      bootstrapChecksum = await loadBootstrap(); initialized = true; return;
    }
    await safeDirectory(data); await safeDirectory(work);
    await mutex(path.join(data, '.initialize'), async () => {
      const file = path.join(data, 'store.json');
      if (await exists(file)) {
        bootstrapChecksum = await loadBootstrap();
      } else {
        const entries = (await fs.readdir(data)).filter(name => name !== '.initialize.mutex');
        if (entries.length) fail('STORE_CORRUPT', 'Missing store identity in a nonempty persistence root; refusing reset.');
        // Only an empty, exclusively owned bootstrap may create persistence
        // roots. A crash before marker publication leaves a nonempty root that
        // another process must refuse, rather than silently reset.
        for (const directory of requiredDirectories.slice(1)) await safeDirectory(directory);
        const body = { schemaVersion: 1, storeId: randomUUID(), createdAt: nowIso(clock) };
        const temporary = path.join(data, `.bootstrap-${randomUUID()}.tmp`);
        let handle;
        try {
          handle = await fs.open(temporary, 'wx', 0o600);
          await handle.writeFile(canonical({ ...body, checksum: digest(body) }) + '\n'); await handle.sync(); await handle.close(); handle = null;
          if (await exists(file)) fail('STORE_CORRUPT', 'Another bootstrap identity appeared; refusing replacement.');
          await fs.rename(temporary, file); await syncDirectory(data);
        } finally { if (handle) await handle.close(); await fs.rm(temporary, { force: true }); }
        bootstrapChecksum = await loadBootstrap();
      }
    }, { retry: true });
    initialized = true;
  }

  async function withLock(kind, key, fn, { signal, recoverDead = false } = {}) {
    writable();
    await checkBootstrap(); validateKey(kind, key); if (signal) abortCheck(signal);
    const file = lockFile(kind, key);
    const internal = await mutex(file, async () => {
      if (await exists(file)) {
        if (!recoverDead) fail('LOCK_BUSY', 'An owner already holds this record lock.');
        const owner = await readOwner(file);
        if (owner.kind !== kind || owner.key !== key) fail('LOCK_BUSY', 'Lock record does not match its identity.');
        await proveOwnerDead(owner);
        await fs.unlink(file);
      }
      const handle = await fs.open(file, 'wx', 0o600), nonce = randomUUID();
      let processIdentity;
      try {
        if (process.platform === 'linux') processIdentity = await linuxProcessIdentity(process.pid);
        await handle.writeFile(canonical({ schemaVersion: processIdentity ? 2 : 1, kind, key, pid: process.pid, hostname: os.hostname(), nonce, acquiredAt: nowIso(clock), ...(processIdentity ? { processIdentity } : {}), ...(instanceId ? { instanceId } : {}) }) + '\n'); await handle.sync();
      }
      catch (error) { await handle.close(); await fs.unlink(file); throw error; }
      return { file, handle, nonce, kind, key, processIdentity, active: true, queue: Promise.resolve() };
    }, { signal });
    const lease = Object.freeze({ kind, key, nonce: internal.nonce }); leases.set(lease, internal);
    try { if (signal) abortCheck(signal); return await fn(lease); }
    finally {
      await internal.queue;
      try { await mutex(file, async () => { await owned(lease, kind, key); await fs.unlink(file); }, { retry: true }); }
      finally { internal.active = false; await internal.handle.close(); }
    }
  }

  async function write(kind, key, value, { lease, signal } = {}) {
    writable();
    requireInit(); validateKey(kind, key);
    const internal = leases.get(lease);
    if (!internal?.active || internal.kind !== kind || internal.key !== key) fail('LOCK_OWNER_MISMATCH', 'An active matching store lease is required.');
    if (!value || Object.getPrototypeOf(value) !== Object.prototype) fail('INVALID_JOB', 'State records require a nonempty plain object value.');
    safeValue(value);
    // Freeze caller data at invocation, before any asynchronous serialization.
    const frozen = json(Buffer.from(canonical(value), 'utf8'));
    const operation = internal.queue.then(async () => {
      if (signal) abortCheck(signal); await owned(lease, kind, key);
      const previous = await readChain(kind, key), directory = recordDirectory(kind, key);
      if (previous.revision >= MAX_REVISIONS) fail('PACKAGE_LIMIT_EXCEEDED', 'No further revisions are allowed.');
      await publication(kind, key, async () => {
        if (!(await readHead(kind, key))) await writeHead(kind, key, 0, null);
        await safeDirectory(directory);
      }, { signal });
      const body = { schemaVersion: 1, kind, key, revision: previous.revision + 1, previousHash: previous.hash, committedAt: nowIso(clock), value: frozen };
      const record = { ...body, recordHash: digest(body) }, encoded = Buffer.from(canonical(record) + '\n', 'utf8');
      if (encoded.length > MAX_RECORD_BYTES) fail('PACKAGE_LIMIT_EXCEEDED', 'State record exceeds its byte limit.');
      const temporary = path.join(directory, `.pending-${randomUUID()}.tmp`), final = path.join(directory, revisionName(body.revision));
      let handle;
      try {
        handle = await fs.open(temporary, 'wx', 0o600); await handle.writeFile(encoded); await handle.sync(); await handle.close(); handle = null;
        await fault('beforeCommit', { kind, key, revision: body.revision });
        if (signal) abortCheck(signal); await checkBootstrap(); await owned(lease, kind, key);
        if (await exists(final)) fail('STORE_WRITE_FAILED', 'Committed revision already exists; no overwrite.');
        // The same record lease serializes writers; no other tool owner can
        // publish this revision. External hostile filesystem races are excluded.
        const readback = await publication(kind, key, async () => {
          await fs.rename(temporary, final); await syncDirectory(directory);
          await fault('afterRecordCommit', { kind, key, revision: body.revision });
          await writeHead(kind, key, body.revision, record.recordHash);
          const committed = await readChain(kind, key, true);
          if (committed.hash !== record.recordHash) fail('STORE_CORRUPT', 'Committed state failed readback.');
          return committed;
        }, { signal });
        await fault('afterCommit', { kind, key, revision: body.revision });
        if (signal) abortCheck(signal);
        return readback.value;
      } finally { if (handle) await handle.close(); await fs.rm(temporary, { force: true }); }
    });
    internal.queue = operation.catch(() => {});
    return operation;
  }

  function snapshotPath(jobId, name) {
    validateId(jobId); validateSourceName(name); return path.join(snapshotsRoot, jobId, name);
  }

  async function verifySnapshot(source, { signal } = {}) {
    await checkBootstrap(); if (signal) abortCheck(signal);
    if (!source || typeof source !== 'object' || typeof source.snapshotPath !== 'string' || !Number.isSafeInteger(source.bytes) || source.bytes < 0 || !SHA.test(source.sha256)) fail('SNAPSHOT_CHANGED', 'Invalid snapshot identity.');
    validateSourceName(source.name);
    const relative = path.relative(snapshotsRoot, path.resolve(source.snapshotPath)).split(path.sep);
    if (relative.length !== 2 || !UUID.test(relative[0]) || relative[1] !== source.name || folded(snapshotPath(relative[0], source.name)) !== folded(source.snapshotPath)) fail('SNAPSHOT_CHANGED', 'Snapshot path is not owned by this store.');
    await noLinks(source.snapshotPath);
    const before = await fs.stat(source.snapshotPath), hash = createHash('sha256'); let bytes = 0;
    const stream = createReadStream(source.snapshotPath, { signal });
    try { for await (const chunk of stream) { if (signal) abortCheck(signal); bytes += chunk.length; if (bytes > source.bytes) fail('SNAPSHOT_CHANGED', 'Snapshot exceeds its captured byte size.'); hash.update(chunk); } }
    finally { stream.destroy(); }
    const after = await fs.stat(source.snapshotPath);
    if (!sameStat(before, after) || bytes !== source.bytes || hash.digest('hex') !== source.sha256) fail('SNAPSHOT_CHANGED', 'Snapshot bytes or file identity changed.');
    return { ...source };
  }

  async function captureSource(jobId, sourcePath, { signal, onChunk } = {}) {
    writable();
    await checkBootstrap(); if (signal) abortCheck(signal); validateId(jobId);
    const original = await noLinks(sourcePath), name = path.basename(original); validateSourceName(name);
    if (contains(data, original) || contains(work, original)) fail('UNSAFE_PATH', 'Capture input must be outside persistence and work directories.');
    return withLock('job', jobId, async () => {
      const destination = snapshotPath(jobId, name), directory = path.dirname(destination);
      if (await exists(directory)) fail('SOURCE_EXISTS', 'This job already owns captured data; it cannot be replaced.');
      await fs.mkdir(directory, { mode: 0o700 }); await noLinks(directory, { directory: true });
      const temporary = path.join(directory, `.capture-${randomUUID()}.tmp`);
      const before = await fs.stat(original), hash = createHash('sha256'); let bytes = 0, writer, committed = false;
      const stream = createReadStream(original, { signal });
      try {
        writer = await fs.open(temporary, 'wx', 0o600);
        for await (const chunk of stream) {
          if (signal) abortCheck(signal); bytes += chunk.length;
          if (!Number.isSafeInteger(bytes) || bytes > before.size) fail('SOURCE_CHANGED', 'Input grew during capture.');
          hash.update(chunk); await writer.writeFile(chunk);
          if (onChunk) await onChunk({ bytes, sourcePath: original });
        }
        await writer.sync(); await writer.close(); writer = null;
        const after = await fs.stat(original); await noLinks(original);
        if (!sameStat(before, after) || bytes !== before.size) fail('SOURCE_CHANGED', 'Input changed during capture.');
        if (signal) abortCheck(signal);
        if (await exists(destination)) fail('SOURCE_EXISTS', 'Snapshot already exists.');
        await fs.rename(temporary, destination); await syncDirectory(directory); committed = true;
        return verifySnapshot({ name, bytes, sha256: hash.digest('hex'), snapshotPath: destination, capturedAt: nowIso(clock) }, { signal });
      } finally {
        stream.destroy(); if (writer) await writer.close(); await fs.rm(temporary, { force: true });
        if (!committed) await fs.rmdir(directory);
      }
    }, { signal });
  }

  return Object.freeze({ init, read: async (kind, key) => (await readChain(kind, key)).value,
    list: async kind => {
      await checkBootstrap(); if (!KINDS.has(kind)) fail('INVALID_JOB', 'Unsupported record kind.');
      const directory = path.join(recordsRoot, kind); await noLinks(directory, { directory: true });
      const entries = await fs.readdir(directory, { withFileTypes: true }), values = [];
      for (const entry of entries) { if (!entry.isDirectory() || entry.isSymbolicLink()) fail('STORE_CORRUPT', 'Unexpected kind-directory entry.'); validateKey(kind, entry.name); const latest = await readChain(kind, entry.name); if (latest.value !== null) values.push(latest.value); }
      return values;
    }, withLock, write, captureSource, snapshotPath, verifySnapshot });
}
