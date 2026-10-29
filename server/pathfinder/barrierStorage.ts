import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { threadId } from 'node:worker_threads';
import { BARRIER_LIMITS, barrierCanonicalJson } from '../../shared/pathfinderBarriers.js';
import { policyHashSchema, policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { PathFinderError } from './errors.js';
import { pathFinderRoot } from './storage.js';

export type BarrierBlob = { blobId: string; sha256: string; bytes: number };
/** Storage refusal ceilings, not a measured resident-memory capacity claim. */
export const BARRIER_STORAGE_LIMITS = Object.freeze({ entries: 50_000, intentBytes: 256 * 1024 ** 2, totalBytes: 8 * 1024 ** 3, waitMilliseconds: 60_000 });
const shared = (globalThis as typeof globalThis & { __wfcBarrierStorageLock?: SharedArrayBuffer }).__wfcBarrierStorageLock;
export const barrierStorageLockBuffer = shared ?? new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
const mutex = new Int32Array(barrierStorageLockBuffer);
const fail = (): never => { throw new PathFinderError('BARRIER_BLOB_INTEGRITY', 409); };
export const barrierBytesHash = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
export const barrierValueHash = (value: unknown): string => barrierBytesHash(Buffer.from(barrierCanonicalJson(value)));
export function releaseBarrierStorageOwner(workerThreadId: number): void {
  if (Number.isSafeInteger(workerThreadId) && workerThreadId > 0) Atomics.compareExchange(mutex, 0, workerThreadId + 1, 0);
}
async function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const owner = threadId + 1, deadline = Date.now() + BARRIER_STORAGE_LIMITS.waitMilliseconds;
  while (Atomics.compareExchange(mutex, 0, 0, owner) !== 0) {
    if (Date.now() >= deadline) throw new PathFinderError('BARRIER_STORAGE_BUSY', 503);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  try { return await operation(); } finally { Atomics.compareExchange(mutex, 0, owner, 0); }
}
async function syncDirectory(directory: string): Promise<void> {
  const handle = await fs.open(directory, 'r'); try { await handle.sync(); } finally { await handle.close(); }
}
async function directory(projectId: string, intentId: string): Promise<string> {
  policyUuidSchema.parse(projectId); policyUuidSchema.parse(intentId);
  let current = await pathFinderRoot();
  for (const segment of ['barriers', projectId, intentId]) {
    current = path.join(current, segment);
    await fs.mkdir(current, { recursive: false, mode: 0o700 }).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; });
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(current) !== path.resolve(current)) return fail();
    await syncDirectory(path.dirname(current));
  }
  return current;
}
function checkLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > BARRIER_LIMITS.captureBytes) throw new PathFinderError('BARRIER_BLOB_LIMIT', 413);
}
async function verifiedBytes(filename: string, expected: BarrierBlob, limit: number, links: number): Promise<Buffer> {
  const before = await fs.lstat(filename, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== BigInt(links) || before.size !== BigInt(expected.bytes)
    || before.size > BigInt(limit) || before.ino <= 0n || await fs.realpath(filename) !== path.resolve(filename)) return fail();
  const bytes = await fs.readFile(filename), after = await fs.lstat(filename, { bigint: true });
  if (!after.isFile() || after.isSymbolicLink() || after.nlink !== before.nlink || after.dev !== before.dev || after.ino !== before.ino
    || after.size !== before.size || bytes.length !== expected.bytes || barrierBytesHash(bytes) !== expected.sha256) return fail();
  return bytes;
}
/** Recover only a proved exact two-link publication pair; never remove an ambiguous alias. */
async function reconcileTemporaryLink(filename: string, expected: BarrierBlob, limit: number): Promise<void> {
  const target = await fs.lstat(filename, { bigint: true });
  if (!target.isFile() || target.isSymbolicLink() || target.nlink !== 2n || target.ino <= 0n || target.size !== BigInt(expected.bytes)) return fail();
  const dir = path.dirname(filename), entries = await fs.readdir(dir, { withFileTypes: true });
  if (entries.length > BARRIER_STORAGE_LIMITS.entries) throw new PathFinderError('BARRIER_STORAGE_ENTRY_LIMIT', 413);
  const matches: string[] = [];
  for (const entry of entries) {
    if (!entry.name.endsWith('.tmp') || !policyUuidSchema.safeParse(entry.name.slice(0, -4)).success) continue;
    const candidate = path.join(dir, entry.name), stat = await fs.lstat(candidate, { bigint: true });
    if (stat.dev !== target.dev || stat.ino !== target.ino) continue;
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 2n || stat.size !== target.size || await fs.realpath(candidate) !== path.resolve(candidate)) return fail();
    matches.push(candidate);
  }
  if (matches.length !== 1) return fail();
  await verifiedBytes(filename, expected, limit, 2); await verifiedBytes(matches[0], expected, limit, 2);
  const finalTarget = await fs.lstat(filename, { bigint: true }), finalTemporary = await fs.lstat(matches[0], { bigint: true });
  if ([finalTarget, finalTemporary].some(stat => !stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 2n
    || stat.dev !== target.dev || stat.ino !== target.ino || stat.size !== target.size)) return fail();
  await fs.unlink(matches[0]); await syncDirectory(dir); await verifiedBytes(filename, expected, limit, 1);
}
async function readFile(filename: string, expected: BarrierBlob, limit: number): Promise<Buffer> {
  if ((await fs.lstat(filename)).nlink === 2) await reconcileTemporaryLink(filename, expected, limit);
  const bytes = await verifiedBytes(filename, expected, limit, 1); await syncDirectory(path.dirname(filename)); return bytes;
}
async function quota(dir: string, additional: number): Promise<void> {
  const root = path.dirname(path.dirname(dir)); let entries = 0, total = 0, intent = 0;
  const visit = async (current: string, depth: number): Promise<void> => {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      if (++entries > BARRIER_STORAGE_LIMITS.entries) throw new PathFinderError('BARRIER_STORAGE_ENTRY_LIMIT', 413);
      const target = path.join(current, entry.name), stat = await fs.lstat(target);
      if (stat.isSymbolicLink() || await fs.realpath(target) !== path.resolve(target)) return fail();
      if (stat.isDirectory()) {
        if (depth >= 2 || !policyUuidSchema.safeParse(entry.name).success) return fail();
        await visit(target, depth + 1);
      } else {
        if (depth !== 2 || !stat.isFile() || stat.nlink !== 1 || !/^[a-f0-9-]{36}\.(?:json|tmp)$(?![\s\S])/u.test(entry.name)
          || !policyUuidSchema.safeParse(entry.name.slice(0, 36)).success || !Number.isSafeInteger(stat.size)) return fail();
        total += stat.size; if (current === dir) intent += stat.size;
        if (total + additional > BARRIER_STORAGE_LIMITS.totalBytes || intent + additional > BARRIER_STORAGE_LIMITS.intentBytes)
          throw new PathFinderError('BARRIER_STORAGE_QUOTA', 413);
      }
    }
  };
  await visit(root, 0);
  if (additional > BARRIER_STORAGE_LIMITS.intentBytes || additional > BARRIER_STORAGE_LIMITS.totalBytes) throw new PathFinderError('BARRIER_STORAGE_QUOTA', 413);
}
/** IDs originate in the repository. Public request bodies never supply paths or blob IDs. */
export async function storeBarrierBytes(projectId: string, intentId: string, blobId: string, value: Buffer, limit = BARRIER_LIMITS.meshBlobBytes): Promise<BarrierBlob> {
  checkLimit(limit); policyUuidSchema.parse(projectId); policyUuidSchema.parse(intentId); policyUuidSchema.parse(blobId);
  if (!Buffer.isBuffer(value) || value.length === 0 || value.length > limit) throw new PathFinderError('BARRIER_BLOB_LIMIT', 413);
  const bytes = Buffer.from(value), expected = { blobId, sha256: barrierBytesHash(bytes), bytes: bytes.length };
  return serialize(async () => {
    const dir = await directory(projectId, intentId), filename = path.join(dir, blobId + '.json');
    try { await readFile(filename, expected, limit); return expected; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await quota(dir, bytes.length);
    const temporary = path.join(dir, randomUUID() + '.tmp'), handle = await fs.open(temporary, 'wx', 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    try { await fs.link(temporary, filename); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    await fs.unlink(temporary); await syncDirectory(dir); await readFile(filename, expected, limit); return expected;
  });
}
export function encodeBarrierJson(value: unknown, limit = BARRIER_LIMITS.meshBlobBytes): Buffer {
  checkLimit(limit); const bytes = Buffer.from(barrierCanonicalJson(value));
  if (!bytes.length || bytes.length > limit) throw new PathFinderError('BARRIER_BLOB_LIMIT', 413); return bytes;
}
export async function readBarrierBytes(projectId: string, intentId: string, expected: BarrierBlob, limit = BARRIER_LIMITS.meshBlobBytes): Promise<Buffer> {
  checkLimit(limit); policyUuidSchema.parse(projectId); policyUuidSchema.parse(intentId); policyUuidSchema.parse(expected.blobId); policyHashSchema.parse(expected.sha256);
  if (!Number.isSafeInteger(expected.bytes) || expected.bytes <= 0 || expected.bytes > limit) return fail();
  return serialize(async () => readFile(path.join(await directory(projectId, intentId), expected.blobId + '.json'), expected, limit));
}
