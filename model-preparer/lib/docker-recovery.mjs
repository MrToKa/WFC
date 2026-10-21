import * as fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createStore, parsePersistentJson } from './store.mjs';
import { canonical, digest, fail, validateId } from './contracts.mjs';

const KINDS = ['job', 'submission', 'target', 'cost'];
const SERVICE_KINDS = ['operations', 'requests', 'uploads', 'artifacts', 'browser'];
const SHA = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const exact = (value, keys) => {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).sort().join(',') !== keys.slice().sort().join(',')) fail('LOCK_BUSY', 'Recovery identity has an unsupported shape.');
};
async function safe(value, directory = false) {
  if (!path.isAbsolute(value)) fail('UNSAFE_PATH');
  const root = path.parse(value).root, parts = path.relative(root, value).split(path.sep).filter(Boolean);
  let current = root, stat;
  for (let i = -1; i < parts.length; i++) {
    if (i >= 0) current = path.join(current, parts[i]);
    stat = await fs.lstat(current);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()) || stat.isFile() && stat.nlink !== 1 || await fs.realpath(current) !== current) fail('UNSAFE_PATH');
    if ((i < parts.length - 1 || directory) && !stat.isDirectory()) fail('UNSAFE_PATH');
  }
  if (!directory && !stat.isFile()) fail('UNSAFE_PATH');
  return stat;
}
async function pinned(file) {
  const before = await safe(file), hash = createHash('sha256'); let bytes = 0;
  if (before.size > 2147483648) fail('PACKAGE_LIMIT_EXCEEDED');
  const stream = createReadStream(file);
  for await (const chunk of stream) { bytes += chunk.length; if (bytes > before.size) fail('STORE_CORRUPT'); hash.update(chunk); }
  const after = await safe(file);
  if (before.ino !== after.ino || before.dev !== after.dev || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || bytes !== before.size) fail('LOCK_OWNER_MISMATCH');
  return { bytes, sha256: hash.digest('hex'), ino: String(before.ino), dev: String(before.dev) };
}
async function parsed(file) {
  const stat = await safe(file); if (stat.size > 32 * 1024 ** 2) fail('PACKAGE_LIMIT_EXCEEDED');
  return parsePersistentJson(await fs.readFile(file));
}
function processFields(owner, service = false) {
  const identity = owner.processIdentity;
  exact(identity, service ? ['bootId', 'pidNamespace', 'startTicks'] : ['kind', 'bootId', 'pidNamespace', 'startTicks']);
  if (!service && identity.kind !== 'linux-proc-v1' || !/^[a-f0-9-]{36}$/.test(identity.bootId ?? '') || !/^pid:\[\d+\]$/.test(identity.pidNamespace ?? '') || !/^\d+$/.test(identity.startTicks ?? '')) fail('LOCK_BUSY');
  return { bootId: identity.bootId, pidNamespace: identity.pidNamespace, startTicks: identity.startTicks };
}
function anchorOwner(owner, instanceId) {
  exact(owner, ['pid', 'hostname', 'nonce', 'instanceId', 'processIdentity']);
  if (!Number.isSafeInteger(owner.pid) || owner.pid < 1 || owner.hostname !== 'routings-preparer' || !UUID.test(owner.nonce) || owner.instanceId !== instanceId) fail('LOCK_BUSY', 'Service owner does not match the stopped deployment instance.');
  processFields(owner, true);
}
function matchingLock(owner, anchor, filename) {
  exact(owner, ['schemaVersion', 'kind', 'key', 'pid', 'hostname', 'nonce', 'acquiredAt', 'processIdentity', 'instanceId']);
  if (owner.schemaVersion !== 2 || !KINDS.includes(owner.kind) || (!UUID.test(owner.key) && !SHA.test(owner.key)) || !UUID.test(owner.nonce) || owner.pid !== anchor.pid || owner.hostname !== anchor.hostname || owner.instanceId !== anchor.instanceId || digest(processFields(owner)) !== digest(processFields(anchor, true)) || !Number.isFinite(Date.parse(owner.acquiredAt))) fail('LOCK_BUSY', 'Foreign or ambiguous core lock is preserved.');
  const stem = digest({ kind: owner.kind, key: owner.key });
  if (filename !== `${stem}.lock` && filename !== `${stem}.publication.lock`) fail('LOCK_BUSY', 'Core lock filename does not match its owner.');
}
async function journalAudit(root) {
  const identity = await parsed(path.join(root, 'service-store.json'));
  exact(identity, ['schemaVersion', 'storeId']); if (identity.schemaVersion !== 1 || !UUID.test(identity.storeId)) fail('STORE_CORRUPT');
  const index = await parsed(path.join(root, 'service-index.json'));
  exact(index, ['schemaVersion', 'entries', 'checksum']); exact(index.entries, SERVICE_KINDS);
  if (index.schemaVersion !== 1 || index.checksum !== digest(index.entries)) fail('STORE_CORRUPT');
  for (const kind of SERVICE_KINDS) {
    const ids = index.entries[kind];
    if (!Array.isArray(ids) || ids.some((id, i) => !UUID.test(id) || i > 0 && ids[i - 1] >= id)) fail('STORE_CORRUPT');
    await safe(path.join(root, kind), true);
    if ((await fs.readdir(path.join(root, kind))).sort().join(',') !== ids.map(id => `${id}.json`).join(',')) fail('STORE_CORRUPT');
    for (const id of ids) {
      const envelope = await parsed(path.join(root, kind, `${id}.json`));
      exact(envelope, ['schemaVersion', 'id', 'kind', 'value', 'checksum']);
      if (envelope.schemaVersion !== 1 || envelope.id !== id || envelope.kind !== kind || envelope.checksum !== digest(envelope.value)) fail('STORE_CORRUPT');
    }
  }
}
async function tree(root, excluded = []) {
  const result = []; let total = 0;
  async function visit(directory, relative = '') {
    await safe(directory, true);
    for (const name of (await fs.readdir(directory)).sort()) {
      const rel = relative ? `${relative}/${name}` : name;
      if (excluded.includes(rel)) continue;
      const file = path.join(directory, name), stat = await fs.lstat(file);
      if (stat.isDirectory() && !stat.isSymbolicLink()) await visit(file, rel);
      else {
        const entry = await pinned(file); total += entry.bytes;
        if (total > 8 * 1024 ** 3 || result.length >= 100000) fail('PACKAGE_LIMIT_EXCEEDED');
        result.push({ path: rel, ...entry });
      }
    }
  }
  await visit(root); return result;
}

// The caller must be the deployment CLI after a fresh Docker-daemon attestation
// of an exact stopped own container and exclusive volume use. No HTTP API calls
// this module. Its snapshot is evidence, not sufficient proof of process death.
export async function captureStoppedContainerSnapshot({ dataDirectory, workDirectory, mode, instanceId, recoveryNonce, heldServiceMutex }) {
  validateId(instanceId);
  if (!['closed', 'simulation', 'live'].includes(mode)) fail('CONFIGURATION_INVALID');
  const modeRoot = path.join(dataDirectory, mode), core = path.join(modeRoot, 'core'), service = path.join(modeRoot, 'service');
  await safe(service, true);
  try {
    const stat = await safe(path.join(service, '.service-owner.mutex'), true);
    if (!heldServiceMutex || stat.ino !== heldServiceMutex.ino || stat.dev !== heldServiceMutex.dev) fail('LOCK_BUSY', 'Ambiguous service lifecycle mutex is preserved.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const ownerPath = path.join(service, 'service-owner.json'), owner = await parsed(ownerPath); anchorOwner(owner, instanceId);
  const anchor = { ...await pinned(ownerPath), owner };
  const store = createStore({ dataDirectory: core, workDirectory: path.join(workDirectory, mode, 'core-work'), readOnly: true, recoveryNonce });
  await store.init(); for (const kind of KINDS) await store.list(kind);
  await journalAudit(service);
  const locks = [];
  for (const name of (await fs.readdir(path.join(core, 'locks'))).sort()) {
    if (!/^[a-f0-9]{64}(?:\.publication)?\.lock$/.test(name)) fail('LOCK_BUSY', 'Unrecognized lock or ambiguous lifecycle mutex is preserved.');
    const file = path.join(core, 'locks', name), lockOwner = await parsed(file); matchingLock(lockOwner, owner, name);
    locks.push({ path: name, ...await pinned(file), owner: lockOwner });
  }
  const body = { schemaVersion: 1, instanceId, mode, anchor, locks,
    state: { core: await tree(core, ['locks', '.docker-recovery.mutex']), service: await tree(service, ['service-owner.json', '.service-owner.mutex']) } };
  return { ...body, checksum: digest(body) };
}

export async function recoverStoppedContainer({ dataDirectory, workDirectory, snapshot, attestation }) {
  exact(attestation, ['schemaVersion', 'containerId', 'imageId', 'instanceId', 'project', 'service', 'running', 'pid', 'exclusiveVolumes']);
  if (attestation.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(attestation.containerId) || !/^sha256:[a-f0-9]{64}$/.test(attestation.imageId) || attestation.instanceId !== snapshot.instanceId || attestation.project !== 'routings-preparer' || attestation.service !== 'preparer' || attestation.running !== false || attestation.pid !== 0 || attestation.exclusiveVolumes !== true) fail('LOCK_BUSY', 'Docker stopped-container attestation is insufficient.');
  const { checksum, ...body } = snapshot;
  if (checksum !== digest(body)) fail('LOCK_OWNER_MISMATCH', 'Snapshot checksum differs.');
  const current = await captureStoppedContainerSnapshot({ dataDirectory, workDirectory, mode: snapshot.mode, instanceId: snapshot.instanceId });
  if (digest(current) !== digest(snapshot)) fail('LOCK_OWNER_MISMATCH', 'Stopped owner or immutable state changed since inspection.');
  const core = path.join(dataDirectory, snapshot.mode, 'core'), service = path.join(dataDirectory, snapshot.mode, 'service');
  const mutex = path.join(core, '.docker-recovery.mutex'), serviceMutex = path.join(service, '.service-owner.mutex'), nonce = randomUUID();
  let markerStat, serviceStat, markerHandle;
  try {
    try { await fs.mkdir(mutex, { mode: 0o700 }); markerStat = await fs.lstat(mutex); }
    catch (error) { if (error.code === 'EEXIST') fail('LOCK_BUSY', 'Existing recovery mutex requires operator inspection.'); throw error; }
    markerHandle = await fs.open(path.join(mutex, 'owner.json'), 'wx', 0o600);
    await markerHandle.writeFile(canonical({ schemaVersion: 1, nonce, instanceId: snapshot.instanceId, containerId: attestation.containerId, snapshotChecksum: snapshot.checksum }) + '\n'); await markerHandle.sync();
    try { await fs.mkdir(serviceMutex, { mode: 0o700 }); serviceStat = await fs.lstat(serviceMutex); }
    catch (error) { if (error.code === 'EEXIST') fail('LOCK_BUSY', 'Service lifecycle exclusion is ambiguous.'); throw error; }
    // Audit while the service lifecycle exclusion is held. The captured state
    // excludes only the two mutexes owned by this exact recovery operation.
    const rechecked = await captureStoppedContainerSnapshot({ dataDirectory, workDirectory, mode: snapshot.mode, instanceId: snapshot.instanceId, recoveryNonce: nonce, heldServiceMutex: serviceStat });
    if (digest(rechecked) !== digest(snapshot)) fail('LOCK_OWNER_MISMATCH');
    for (const lock of snapshot.locks) {
      const file = path.join(core, 'locks', lock.path);
      if (digest(await pinned(file)) !== digest({ bytes: lock.bytes, sha256: lock.sha256, ino: lock.ino, dev: lock.dev }) || digest(await parsed(file)) !== digest(lock.owner)) fail('LOCK_OWNER_MISMATCH');
      await fs.unlink(file);
    }
    const ownerFile = path.join(service, 'service-owner.json');
    if (digest(await pinned(ownerFile)) !== digest({ bytes: snapshot.anchor.bytes, sha256: snapshot.anchor.sha256, ino: snapshot.anchor.ino, dev: snapshot.anchor.dev }) || digest(await parsed(ownerFile)) !== digest(snapshot.anchor.owner)) fail('LOCK_OWNER_MISMATCH');
    await fs.unlink(ownerFile);
    return { schemaVersion: 1, instanceId: snapshot.instanceId, containerId: attestation.containerId, preservedStateChecksum: digest(snapshot.state), removedLockCount: snapshot.locks.length, serviceOwnerRemoved: true };
  } finally {
    if (serviceStat) {
      const currentStat = await safe(serviceMutex, true);
      if (currentStat.ino !== serviceStat.ino || currentStat.dev !== serviceStat.dev) fail('LOCK_OWNER_MISMATCH');
      await fs.rmdir(serviceMutex);
    }
    if (markerStat) {
      if (markerHandle) await markerHandle.close();
      const currentStat = await safe(mutex, true), marker = await parsed(path.join(mutex, 'owner.json'));
      if (currentStat.ino !== markerStat.ino || currentStat.dev !== markerStat.dev || marker.nonce !== nonce) fail('LOCK_OWNER_MISMATCH');
      await fs.unlink(path.join(mutex, 'owner.json')); await fs.rmdir(mutex);
    }
  }
}
