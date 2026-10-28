import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT, openWork, safePath, runCommand } from '../pathfinder-tray-catalog/guard-io.mjs';

export const HOST_PROOF_JOURNAL_LIMITS = Object.freeze({ files: 256, records: 255, fileBytes: 4096 });
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$(?![\s\S])/;
const SHA = /^[a-f0-9]{64}$(?![\s\S])/;
const IMAGE = /^sha256:[a-f0-9]{64}$(?![\s\S])/;
const PROJECT = /^wfc-pathfinder-local-[a-f0-9]{12}$(?![\s\S])/;
const RECORD = 'wfc.pf.host-join-proof.v1', OWNER = 'wfc.pf.host-join-proof-owner.v1', ACK = 'wfc.pf.host-join-proof-ack.v1';
const fail = code => { throw Object.assign(new Error(code), { code }); };
const need = (condition, code = 'PRODUCER_PROOF_JOURNAL_INVALID') => { if (!condition) fail(code); };
const plain = value => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key); return descriptor && !descriptor.get && !descriptor.set;
});
const canonical = value => JSON.stringify(Array.isArray(value) ? value.map(normalize) : normalize(value));
const normalize = value => plain(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])])) : Array.isArray(value) ? value.map(normalize) : value;
const bytes = value => Buffer.from(canonical(value) + '\n');
const sha = value => createHash('sha256').update(value).digest('hex');
const stamp = stat => [stat.dev, stat.ino, stat.size, stat.nlink, stat.mode, stat.uid, stat.gid, stat.mtimeNs, stat.ctimeNs].join(':');
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const proof = value => {
  need(exact(value, ['joined', 'removed', 'containerId']) && value.joined === true && value.removed === true && typeof value.containerId === 'string' && SHA.test(value.containerId));
  return Object.freeze({ joined: true, removed: true, containerId: value.containerId });
};
const acknowledgement = value => {
  need(exact(value, ['acknowledged', 'duplicate']) && value.acknowledged === true && typeof value.duplicate === 'boolean', 'PRODUCER_PROOF_ACK_REQUIRED');
  return { acknowledged: true, duplicate: value.duplicate };
};

async function privateWindowsAcl(filename, directory) {
  // Child ACLs inherit the already verified private work directory. Read and
  // check them; reopening a journal never repairs permissions or broadens them.
  const quoted = "'" + filename.replaceAll("'", "''") + "'";
  const code = `$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User;$acl=[System.IO.${directory ? 'Directory' : 'File'}]::GetAccessControl(${quoted});$rules=$acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]);if(@($rules).Count -lt 1){throw 'ACL'};foreach($r in $rules){if($r.IdentityReference.Value -ne $sid.Value -or $r.AccessControlType -ne 'Allow'){throw 'ACL'}};'PRIVATE'`;
  const result = await runCommand('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(code, 'utf16le').toString('base64')]);
  need(result.exitCode === 0 && !result.error && result.stderrBytes === 0 && result.stdout.toString().trim() === 'PRIVATE', 'PRODUCER_PROOF_JOURNAL_ACL');
}
async function privateDirectory(directory) {
  const stat = await fs.lstat(directory);
  need(stat.isDirectory() && !stat.isSymbolicLink() && samePath(await fs.realpath(directory), directory), 'PRODUCER_PROOF_JOURNAL_PATH');
  if (process.platform !== 'win32') { need((stat.mode & 0o077) === 0, 'PRODUCER_PROOF_JOURNAL_ACL'); return; }
  await privateWindowsAcl(directory, true);
}
async function syncDirectory(directory) {
  // Windows has no Node directory-fsync primitive. The durable, appended ACK
  // below survives an uncertain unlink and is reconciled before any new claim.
  if (process.platform === 'win32') return;
  const handle = await fs.open(directory, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0));
  try { await handle.sync(); } finally { await handle.close(); }
}
async function readBounded(filename) {
  if (process.platform === 'win32') await privateWindowsAcl(filename, false);
  const handle = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat({ bigint: true });
    need(before.isFile() && before.nlink === 1n && before.size > 0n && before.size <= BigInt(HOST_PROOF_JOURNAL_LIMITS.fileBytes), 'PRODUCER_PROOF_JOURNAL_FILE');
    if (process.platform !== 'win32') need((before.mode & 0o077n) === 0n, 'PRODUCER_PROOF_JOURNAL_ACL');
    const buffer = Buffer.alloc(HOST_PROOF_JOURNAL_LIMITS.fileBytes + 1); let size = 0;
    while (size < buffer.length) { const part = await handle.read(buffer, size, buffer.length - size, size); if (!part.bytesRead) break; size += part.bytesRead; }
    need(size <= HOST_PROOF_JOURNAL_LIMITS.fileBytes && BigInt(size) === before.size, 'PRODUCER_PROOF_JOURNAL_FILE');
    const after = await handle.stat({ bigint: true }), located = await fs.lstat(filename, { bigint: true });
    need(!located.isSymbolicLink() && stamp(before) === stamp(after) && stamp(before) === stamp(located), 'PRODUCER_PROOF_JOURNAL_CHANGED');
    return { raw: buffer.subarray(0, size), stat: before };
  } finally { await handle.close(); }
}
async function writeNew(filename, raw) {
  need(raw.length <= HOST_PROOF_JOURNAL_LIMITS.fileBytes, 'PRODUCER_PROOF_JOURNAL_LIMIT');
  const handle = await fs.open(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
  try { need((await handle.stat()).nlink === 1, 'PRODUCER_PROOF_JOURNAL_FILE'); await handle.writeFile(raw); await handle.sync(); } finally { await handle.close(); }
}
function parseLine(raw) {
  let value; try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); } catch { fail('PRODUCER_PROOF_JOURNAL_INVALID'); }
  need(bytes(value).equals(Buffer.concat([raw, Buffer.from('\n')]))); return value;
}

/** Restart recovery contains only already observed physical join/removal proof.
 * It grants no operation, creates no helper and contains no host key or bearer. */
export async function createHostProofJournal(configuration, { root = ROOT } = {}) {
  need(exact(configuration, ['workPath', 'owner', 'project', 'image', 'runtimeInventorySha256']) && Object.values(configuration).every(value => typeof value === 'string') &&
    UUID.test(configuration.owner ?? '') && PROJECT.test(configuration.project ?? '') && IMAGE.test(configuration.image ?? '') && SHA.test(configuration.runtimeInventorySha256 ?? ''), 'PRODUCER_PROOF_JOURNAL_CONFIGURATION');
  const work = await openWork(configuration.workPath, { root });
  const binding = Object.freeze({ workOwner: work.owner, owner: configuration.owner, project: configuration.project, image: configuration.image, runtimeInventorySha256: configuration.runtimeInventorySha256 });
  const directory = path.join(work.directory, 'host-join-proofs'), marker = { schemaVersion: OWNER, ...binding }, markerRaw = bytes(marker);
  try { await safePath(work.directory, 'host-join-proofs', 'new-directory'); await fs.mkdir(directory, { mode: 0o700 }); await syncDirectory(work.directory); }
  catch (error) { if (error.code !== 'CATALOG_IO_EXISTS' && error.code !== 'EEXIST') throw error; }
  await privateDirectory(directory);
  const markerPath = path.join(directory, 'owner.private.json');
  try { await writeNew(markerPath, markerRaw); await syncDirectory(directory); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  need((await readBounded(await safePath(directory, 'owner.private.json'))).raw.equals(markerRaw), 'PRODUCER_PROOF_JOURNAL_OWNER');
  let queue = Promise.resolve(); const retired = new Map();
  const serialize = work_ => { const result = queue.then(work_); queue = result.catch(() => undefined); return result; };
  const check = async () => {
    const reopened = await openWork(configuration.workPath, { root });
    need(reopened.owner === work.owner && reopened.directory === work.directory, 'PRODUCER_PROOF_JOURNAL_OWNER');
    await safePath(work.directory, 'host-join-proofs', 'directory'); await privateDirectory(directory);
    need((await readBounded(await safePath(directory, 'owner.private.json'))).raw.equals(markerRaw), 'PRODUCER_PROOF_JOURNAL_OWNER');
  };
  const baseRecord = (attemptId, value) => {
    need(typeof attemptId === 'string' && UUID.test(attemptId));
    return { schemaVersion: RECORD, ...binding, attemptId, proof: proof(value) };
  };
  const ref = record => Object.freeze({ ...record, proof: Object.freeze({ ...record.proof }), recordSha256: sha(bytes(record)) });
  const validateRef = value => {
    need(exact(value, ['schemaVersion', ...Object.keys(binding), 'attemptId', 'proof', 'recordSha256']));
    need(value.schemaVersion === RECORD && Object.entries(binding).every(([key, expected]) => value[key] === expected) && typeof value.recordSha256 === 'string' && SHA.test(value.recordSha256));
    const expected = ref(baseRecord(value.attemptId, value.proof));
    need(canonical(value) === canonical(expected), 'PRODUCER_PROOF_JOURNAL_CONFLICT'); return expected;
  };
  const filename = attemptId => path.join(directory, attemptId + '.private.json');
  const readRecord = async attemptId => {
    const name = attemptId + '.private.json', file = await readBounded(await safePath(directory, name));
    const lines = file.raw.toString('utf8').split('\n'); need(lines.pop() === '' && (lines.length === 1 || lines.length === 2));
    const record = parseLine(Buffer.from(lines[0])); need(plain(record)); const expected = baseRecord(attemptId, record.proof);
    need(canonical(record) === canonical(expected), 'PRODUCER_PROOF_JOURNAL_CONFLICT');
    const reference = ref(expected); let ack;
    if (lines.length === 2) {
      ack = parseLine(Buffer.from(lines[1])); need(exact(ack, ['schemaVersion', 'recordSha256', 'acknowledgement']) && ack.schemaVersion === ACK && ack.recordSha256 === reference.recordSha256);
      acknowledgement(ack.acknowledgement);
    }
    return { reference, ack, ...file };
  };
  const rememberRetired = reference => { retired.set(reference.attemptId, reference.recordSha256); if (retired.size > HOST_PROOF_JOURNAL_LIMITS.files) retired.delete(retired.keys().next().value); };
  const removeAcknowledged = async (attemptId, file) => {
    need(file.ack, 'PRODUCER_PROOF_ACK_REQUIRED');
    const located = await fs.lstat(await safePath(directory, attemptId + '.private.json'), { bigint: true });
    need(stamp(file.stat) === stamp(located), 'PRODUCER_PROOF_JOURNAL_CHANGED');
    await fs.unlink(filename(attemptId)); await syncDirectory(directory); rememberRetired(file.reference);
  };
  const scan = async () => {
    await check(); const names = await fs.readdir(directory);
    need(names.length <= HOST_PROOF_JOURNAL_LIMITS.files, 'PRODUCER_PROOF_JOURNAL_LIMIT'); const records = [];
    for (const name of names.sort()) {
      if (name === 'owner.private.json') continue;
      const attemptId = name.endsWith('.private.json') ? name.slice(0, -'.private.json'.length) : '';
      need(UUID.test(attemptId), 'PRODUCER_PROOF_JOURNAL_UNKNOWN_FILE'); const file = await readRecord(attemptId);
      if (file.ack) await removeAcknowledged(attemptId, file); else records.push(file.reference);
    }
    return records;
  };
  // Refuse corrupt, foreign, linked, oversized or unknown existing entries now,
  // before the caller may claim work or send a cleanup acknowledgement.
  await scan();
  return Object.freeze({
    list: () => serialize(scan),
    retain: input => serialize(async () => {
      need(exact(input, ['attemptId', 'proof'])); const reference = ref(baseRecord(input.attemptId, input.proof));
      const records = await scan(), existing = records.find(value => value.attemptId === reference.attemptId);
      if (existing) { need(existing.recordSha256 === reference.recordSha256, 'PRODUCER_PROOF_JOURNAL_CONFLICT'); return existing; }
      if (retired.has(reference.attemptId)) { need(retired.get(reference.attemptId) === reference.recordSha256, 'PRODUCER_PROOF_JOURNAL_CONFLICT'); fail('PRODUCER_PROOF_ALREADY_ACKNOWLEDGED'); }
      need(records.length < HOST_PROOF_JOURNAL_LIMITS.records, 'PRODUCER_PROOF_JOURNAL_LIMIT');
      try { await writeNew(filename(reference.attemptId), bytes(baseRecord(reference.attemptId, reference.proof))); await syncDirectory(directory); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      const readback = await readRecord(reference.attemptId); need(!readback.ack && readback.reference.recordSha256 === reference.recordSha256, 'PRODUCER_PROOF_JOURNAL_CONFLICT');
      return readback.reference;
    }),
    retire: (record, receipt) => serialize(async () => {
      const reference = validateRef(record), ack = acknowledgement(receipt); await check();
      if (retired.get(reference.attemptId) === reference.recordSha256) return;
      const before = await readRecord(reference.attemptId); need(before.reference.recordSha256 === reference.recordSha256, 'PRODUCER_PROOF_JOURNAL_CONFLICT');
      if (!before.ack) {
        const append = bytes({ schemaVersion: ACK, recordSha256: reference.recordSha256, acknowledgement: ack });
        need(before.raw.length + append.length <= HOST_PROOF_JOURNAL_LIMITS.fileBytes, 'PRODUCER_PROOF_JOURNAL_LIMIT');
        const handle = await fs.open(filename(reference.attemptId), constants.O_WRONLY | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0));
        try {
          need(stamp(await handle.stat({ bigint: true })) === stamp(before.stat), 'PRODUCER_PROOF_JOURNAL_CHANGED');
          await handle.writeFile(append); await handle.sync();
        } finally { await handle.close(); }
      }
      const persisted = await readRecord(reference.attemptId); need(persisted.ack && persisted.reference.recordSha256 === reference.recordSha256, 'PRODUCER_PROOF_JOURNAL_CONFLICT');
      await removeAcknowledged(reference.attemptId, persisted);
    }),
  });
}
