import fs, { type FileHandle } from 'node:fs/promises';
import { constants, type BigIntStats } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { barrierMultipartCanonicalBytes, barrierMultipartPageSchema, barrierMultipartSealSchema } from '../../shared/pathfinderBarrierMultipart.js';
import { policyHashSchema, policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { PathFinderError } from './errors.js';
import { parsePolicyJson } from './policyJson.js';

/** Refusal ceilings only; this stage does not qualify multipart geometry capacity. */
export const BARRIER_MULTIPART_STORAGE_LIMITS = Object.freeze({ totalBytes: 8 * 1024 ** 3, totalFiles: 50_000,
  pageBytes: 256 * 1024, partBytes: 32 * 1024 ** 2, namespace: 'barrier-multipart-v2' });
export type BarrierMultipartStorageTicket = Readonly<{ projectId: string; sessionId: string; allocationId: string; blobId: string;
  requestSha256: string; sha256: string; bytes: number; kind: 'control' | 'part'; reservedBytes: number; reservedFiles: number }>;
export type BarrierMultipartStoredBytes = Readonly<{ blobId: string; sha256: string; bytes: number; durability: 'file-and-directory-fsynced' }>;
export type BarrierMultipartScannedEntry = Readonly<{ blobId: string; allocationId: string | null; kind: 'control' | 'part'; bytes: number }>;
/** Mandatory trusted repository seam. It reauthorizes the exact retained allocation
 * and lease, and returns authoritative totals including every retained session
 * reservation, unfinished write/orphan and the one namespace directory entry.
 * During final receipt COMMIT, use the already locked transaction client. */
export type AssertBarrierMultipartReservation = (ticket: BarrierMultipartStorageTicket, entry?: BarrierMultipartScannedEntry) => Promise<{
  globalReservedBytes: number; globalReservedFiles: number;
}>;
type Options = { signal?: AbortSignal };
type Directory = { root: string; directory: string; rootStat: BigIntStats; directoryStat: BigIntStats };
const L = BARRIER_MULTIPART_STORAGE_LIMITS;
const fail = (code = 'BARRIER_MULTIPART_STORAGE_INTEGRITY', status = 409): never => { throw new PathFinderError(code, status); };
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const integer = (value: number, maximum = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= 0 && value <= maximum && !Object.is(value, -0);
const sameInode = (left: BigIntStats, right: BigIntStats) => left.dev === right.dev && left.ino === right.ino && left.ino > 0n;
const sameFile = (left: BigIntStats, right: BigIntStats) => sameInode(left, right) && left.nlink === right.nlink
  && left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
function check(signal?: AbortSignal): void { if (signal?.aborted) fail('BARRIER_MULTIPART_STORAGE_CANCELLED'); }
function ticketCopy(value: BarrierMultipartStorageTicket): BarrierMultipartStorageTicket {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype
    || Reflect.ownKeys(value).some(key => typeof key !== 'string')
    || Object.keys(value).sort().join(',') !== 'allocationId,blobId,bytes,kind,projectId,requestSha256,reservedBytes,reservedFiles,sessionId,sha256'
    || Object.values(Object.getOwnPropertyDescriptors(value)).some(descriptor => !('value' in descriptor))) return fail();
  const ticket = Object.freeze({ ...value });
  for (const id of [ticket.projectId, ticket.sessionId, ticket.allocationId, ticket.blobId]) if (!policyUuidSchema.safeParse(id).success) return fail();
  if (!policyHashSchema.safeParse(ticket.requestSha256).success || !policyHashSchema.safeParse(ticket.sha256).success
    || !['control', 'part'].includes(ticket.kind) || !integer(ticket.bytes, ticket.kind === 'control' ? L.pageBytes : L.partBytes)
    || ticket.bytes < 1 || ticket.reservedBytes !== ticket.bytes * 2 || ticket.reservedFiles !== 2) return fail();
  return ticket;
}
async function assertAuthority(ticket: BarrierMultipartStorageTicket, assertion: AssertBarrierMultipartReservation, signal?: AbortSignal,
  entry?: BarrierMultipartScannedEntry) {
  check(signal); if (typeof assertion !== 'function') return fail('BARRIER_MULTIPART_RESERVATION_REQUIRED', 503);
  const totals = await assertion(ticket, entry && Object.freeze({ ...entry })); check(signal);
  if (!totals || Object.keys(totals).sort().join(',') !== 'globalReservedBytes,globalReservedFiles'
    || !integer(totals.globalReservedBytes, L.totalBytes) || totals.globalReservedBytes < ticket.reservedBytes
    || !integer(totals.globalReservedFiles, L.totalFiles) || totals.globalReservedFiles < ticket.reservedFiles + 1)
    return fail('BARRIER_MULTIPART_STORAGE_QUOTA', 413);
  return { ...totals };
}
/** Strict canonical control JSON, separate from opaque original geometry bytes. */
export function encodeBarrierMultipartControl(value: unknown): Buffer {
  const page = barrierMultipartPageSchema.safeParse(value);
  const parsed = page.success ? page : barrierMultipartSealSchema.safeParse(value);
  if (!parsed.success) return fail('BARRIER_MULTIPART_CONTROL_INVALID', 400);
  const bytes = Buffer.from(barrierMultipartCanonicalBytes(parsed.data));
  if (!bytes.length || bytes.length > L.pageBytes) return fail('BARRIER_MULTIPART_STORAGE_LIMIT', 413);
  return bytes;
}
function validateBytes(ticket: BarrierMultipartStorageTicket, bytes: Buffer): void {
  if (bytes.length !== ticket.bytes || hash(bytes) !== ticket.sha256) return fail();
  if (ticket.kind === 'control') {
    let canonical: Buffer;
    try { canonical = encodeBarrierMultipartControl(parsePolicyJson(bytes, { maxBytes: L.pageBytes })); }
    catch { return fail('BARRIER_MULTIPART_CONTROL_INVALID', 400); }
    if (!canonical.equals(bytes)) return fail('BARRIER_MULTIPART_CONTROL_INVALID', 400);
  }
}
async function directoryStat(filename: string): Promise<BigIntStats> {
  const stat = await fs.lstat(filename, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.ino <= 0n || await fs.realpath(filename) !== path.resolve(filename)) return fail();
  return stat;
}
async function syncDirectory(filename: string): Promise<void> {
  let handle: FileHandle | undefined;
  try { handle = await fs.open(filename, constants.O_RDONLY); await handle.sync(); }
  catch { return fail(process.platform === 'win32' ? 'BARRIER_MULTIPART_DIRECTORY_DURABILITY_UNSUPPORTED' : 'BARRIER_MULTIPART_STORAGE_DURABILITY', 503); }
  finally { await handle?.close(); }
}
function privateNamespace(stat: BigIntStats): void {
  if (process.platform !== 'win32' && (typeof process.getuid !== 'function' || stat.uid !== BigInt(process.getuid()) || (stat.mode & 0o077n) !== 0n)) return fail();
}
async function verifyDirectory(value: Directory): Promise<void> {
  const namespace = await directoryStat(value.directory); privateNamespace(namespace);
  if (!sameInode(value.rootStat, await directoryStat(value.root)) || !sameInode(value.directoryStat, namespace)) return fail();
}
async function ownedDirectory(root: string, create: boolean): Promise<Directory> {
  const rootStat = await directoryStat(root), directory = path.join(root, L.namespace);
  if (create) {
    try { await fs.mkdir(directory, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  }
  const directoryStatValue = await directoryStat(directory), result = { root, directory, rootStat, directoryStat: directoryStatValue };
  privateNamespace(directoryStatValue);
  if (rootStat.dev !== directoryStatValue.dev) return fail();
  await verifyDirectory(result); await syncDirectory(root); await syncDirectory(directory); return result;
}
async function checkCapacity(directory: Directory, totals: { globalReservedBytes: number; globalReservedFiles: number },
  ticket: BarrierMultipartStorageTicket, assertion: AssertBarrierMultipartReservation, signal?: AbortSignal, prospective = false): Promise<void> {
  await verifyDirectory(directory); check(signal);
  const disk = await fs.statfs(directory.directory, { bigint: true }); check(signal);
  if (disk.bsize <= 0n || disk.bavail < 0n || disk.bavail * disk.bsize < BigInt(totals.globalReservedBytes))
    return fail('BARRIER_MULTIPART_STORAGE_DISK_HEADROOM', 507);
  // Bounded opendir traversal counts retained temporary files too. No broad
  // cleanup, quota release or process-local accounting can authorize a write.
  const handle = await fs.opendir(directory.directory); let bytes = 0, entries = 1, allocationTemporary = false, allocationFinal = false;
  try {
    for await (const entry of handle) {
      check(signal);
      if (++entries > totals.globalReservedFiles || entries > L.totalFiles) return fail('BARRIER_MULTIPART_STORAGE_QUOTA', 413);
      const final = /^([a-f0-9-]{36})\.(control|part)$(?![\s\S])/u.exec(entry.name);
      const temporary = /^([a-f0-9-]{36})\.([a-f0-9-]{36})\.(control|part)\.tmp$(?![\s\S])/u.exec(entry.name);
      if ((!final && !temporary) || !policyUuidSchema.safeParse((final ?? temporary)![1]).success
        || temporary && !policyUuidSchema.safeParse(temporary[2]).success) return fail();
      const filename = path.join(directory.directory, entry.name), stat = await fs.lstat(filename, { bigint: true });
      const kind = (final?.[2] ?? temporary![3]) as 'control' | 'part', maximum = kind === 'control' ? L.pageBytes : L.partBytes;
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || stat.ino <= 0n || stat.dev !== directory.directoryStat.dev || stat.size < 0n
        || stat.size > BigInt(maximum) || await fs.realpath(filename) !== filename) return fail();
      await assertAuthority(ticket, assertion, signal, { blobId: (final ?? temporary)![1], allocationId: temporary?.[2] ?? null, kind, bytes: Number(stat.size) });
      if (!sameFile(stat, await fs.lstat(filename, { bigint: true }))) return fail();
      bytes += Number(stat.size);
      if (!integer(bytes, totals.globalReservedBytes)) return fail('BARRIER_MULTIPART_STORAGE_QUOTA', 413);
      if (prospective) {
        if (entry.name === ticket.blobId + '.' + ticket.kind) allocationFinal = true;
        if (entry.name === ticket.blobId + '.' + ticket.allocationId + '.' + ticket.kind + '.tmp') allocationTemporary = true;
      }
    }
  } finally { await handle.close().catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ERR_DIR_CLOSED') throw error; }); }
  if (prospective) {
    const missing = Number(!allocationTemporary) + Number(!allocationFinal);
    if (entries + missing > totals.globalReservedFiles || bytes + missing * ticket.bytes > totals.globalReservedBytes)
      return fail('BARRIER_MULTIPART_STORAGE_QUOTA', 413);
  }
  await verifyDirectory(directory); check(signal);
}
async function fileStat(filename: string, ticket: BarrierMultipartStorageTicket, links: bigint): Promise<BigIntStats> {
  const stat = await fs.lstat(filename, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== links || stat.ino <= 0n || stat.size !== BigInt(ticket.bytes)
    || await fs.realpath(filename) !== filename) return fail();
  return stat;
}
async function verifiedRead(filename: string, ticket: BarrierMultipartStorageTicket, signal?: AbortSignal, links = 1n): Promise<Buffer> {
  check(signal); const before = await fileStat(filename, ticket, links);
  const handle = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || !sameFile(before, opened)) return fail();
    const bytes = Buffer.alloc(ticket.bytes); let offset = 0;
    while (offset < bytes.length) {
      check(signal); const result = await handle.read(bytes, offset, Math.min(1024 * 1024, bytes.length - offset), offset);
      if (result.bytesRead <= 0) return fail(); offset += result.bytesRead;
    }
    const probe = await handle.read(Buffer.alloc(1), 0, 1, bytes.length); check(signal);
    if (probe.bytesRead !== 0 || !sameFile(opened, await handle.stat({ bigint: true }))
      || !sameFile(before, await fileStat(filename, ticket, links))) return fail();
    validateBytes(ticket, bytes); await handle.sync(); return bytes;
  } finally { await handle.close(); }
}
async function writeTemporary(filename: string, ticket: BarrierMultipartStorageTicket, bytes: Buffer, signal?: AbortSignal): Promise<void> {
  let handle: FileHandle;
  try { handle = await fs.open(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    // A same-allocation retry never creates a second temporary file. Only exact
    // complete retained bytes can resume; partial/conflicting evidence stays.
    await verifiedRead(filename, ticket, signal);
    const retained = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try { if (!sameFile(await fileStat(filename, ticket, 1n), await retained.stat({ bigint: true }))) return fail(); await retained.sync(); }
    finally { await retained.close(); }
    await verifiedRead(filename, ticket, signal); return;
  }
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || opened.nlink !== 1n || opened.ino <= 0n || opened.size !== 0n) return fail();
    let offset = 0;
    while (offset < bytes.length) {
      check(signal); const written = await handle.write(bytes, offset, Math.min(1024 * 1024, bytes.length - offset), offset);
      if (written.bytesWritten <= 0) return fail(); offset += written.bytesWritten;
    }
    check(signal); await handle.sync();
    const after = await handle.stat({ bigint: true });
    if (!sameInode(opened, after) || after.nlink !== 1n || after.size !== BigInt(ticket.bytes)) return fail();
  } finally { await handle.close(); }
  await verifiedRead(filename, ticket, signal);
}

/** Server configuration chooses the existing owned root. Public DTOs cannot set
 * root paths, blob IDs, reservation totals or the trusted assertion callback. */
export function createBarrierMultipartStorage(root: string) {
  if (!path.isAbsolute(root) || path.resolve(root) !== root) return fail('BARRIER_MULTIPART_STORAGE_ROOT', 503);
  const filename = (directory: Directory, ticket: BarrierMultipartStorageTicket) => path.join(directory.directory, ticket.blobId + '.' + ticket.kind);
  const reference = (ticket: BarrierMultipartStorageTicket): BarrierMultipartStoredBytes => Object.freeze({ blobId: ticket.blobId,
    sha256: ticket.sha256, bytes: ticket.bytes, durability: 'file-and-directory-fsynced' });
  return Object.freeze({
    async store(value: BarrierMultipartStorageTicket, input: Buffer, assertion: AssertBarrierMultipartReservation, { signal }: Options = {}): Promise<BarrierMultipartStoredBytes> {
      const ticket = ticketCopy(value); check(signal);
      if (!Buffer.isBuffer(input) || input.length !== ticket.bytes) return fail('BARRIER_MULTIPART_STORAGE_LIMIT', 413);
      const bytes = Buffer.from(input); validateBytes(ticket, bytes);
      let totals = await assertAuthority(ticket, assertion, signal);
      const directory = await ownedDirectory(root, true); await checkCapacity(directory, totals, ticket, assertion, signal);
      const target = filename(directory, ticket);
      try { await verifiedRead(target, ticket, signal); await verifyDirectory(directory); await assertAuthority(ticket, assertion, signal); return reference(ticket); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      totals = await assertAuthority(ticket, assertion, signal); await checkCapacity(directory, totals, ticket, assertion, signal, true);
      const temporary = path.join(directory.directory, ticket.blobId + '.' + ticket.allocationId + '.' + ticket.kind + '.tmp');
      await writeTemporary(temporary, ticket, bytes, signal); await verifyDirectory(directory);
      await assertAuthority(ticket, assertion, signal);
      try { await fs.link(temporary, target); }
      catch (error) {
        // A conflicting/concurrent publication is retained for exact repository
        // reconciliation; never unlink a file to make an uncertain retry pass.
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') return fail('BARRIER_MULTIPART_STORAGE_UNCERTAIN');
        throw error;
      }
      const sourceStat = await fileStat(temporary, ticket, 2n), targetStat = await fileStat(target, ticket, 2n);
      if (!sameFile(sourceStat, targetStat)) return fail();
      await verifiedRead(target, ticket, signal, 2n); await verifiedRead(temporary, ticket, signal, 2n);
      await assertAuthority(ticket, assertion, signal); await verifyDirectory(directory);
      if (!sameFile(sourceStat, await fileStat(temporary, ticket, 2n)) || !sameFile(targetStat, await fileStat(target, ticket, 2n))) return fail();
      await fs.unlink(temporary); await syncDirectory(directory.directory);
      await verifiedRead(target, ticket, signal); await verifyDirectory(directory);
      await assertAuthority(ticket, assertion, signal); return reference(ticket);
    },
    async read(value: BarrierMultipartStorageTicket, assertion: AssertBarrierMultipartReservation, { signal }: Options = {}): Promise<Buffer> {
      const ticket = ticketCopy(value); await assertAuthority(ticket, assertion, signal);
      const directory = await ownedDirectory(root, false), bytes = await verifiedRead(filename(directory, ticket), ticket, signal);
      await verifyDirectory(directory); await assertAuthority(ticket, assertion, signal); return bytes;
    },
  });
}
