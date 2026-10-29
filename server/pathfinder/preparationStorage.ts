import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { threadId } from 'node:worker_threads';
import { policyUuidSchema, policyHashSchema, canonicalPurposeJson } from '../../shared/pathfinderPurposePolicy.js';
import { PREPARATION_LIMITS } from '../../shared/pathfinderPreparation.js';
import { pathFinderRoot } from './storage.js';
import { PathFinderError } from './errors.js';

const fail = (): never => { throw new PathFinderError('PREPARATION_BLOB_INTEGRITY', 409); };
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
export type PreparationBlob = { payloadRef: string; sha256: string; bytes: number };
const shared = (globalThis as typeof globalThis & { __wfcPreparationStorageLock?: SharedArrayBuffer }).__wfcPreparationStorageLock;
export const preparationStorageLockBuffer = shared ?? new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
const mutex = new Int32Array(preparationStorageLockBuffer);
/** Only the host of this exact terminated worker may release its abandoned lease. */
export function releasePreparationStorageOwner(workerThreadId: number): void { if (Number.isSafeInteger(workerThreadId) && workerThreadId > 0) Atomics.compareExchange(mutex, 0, workerThreadId + 1, 0); }
async function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const owner = threadId + 1, deadline = Date.now() + PREPARATION_LIMITS.validationMilliseconds;
  while (Atomics.compareExchange(mutex, 0, 0, owner) !== 0) { if (Date.now() >= deadline) throw new PathFinderError('PREPARATION_STORAGE_BUSY', 503); await new Promise(resolve => setTimeout(resolve, 5)); }
  try { return await operation(); } finally { Atomics.compareExchange(mutex, 0, owner, 0); }
}
async function syncDirectory(directory: string): Promise<void> { const handle = await fs.open(directory, 'r'); try { await handle.sync(); } finally { await handle.close(); } }
async function directory(projectId: string, sessionId: string): Promise<string> {
  policyUuidSchema.parse(projectId); policyUuidSchema.parse(sessionId);
  let current = await pathFinderRoot();
  for (const segment of ['preparations', projectId, sessionId]) {
    current = path.join(current, segment); await fs.mkdir(current, { recursive: false, mode: 0o700 }).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; });
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(current) !== path.resolve(current)) return fail();
    // Sync even an existing entry: it may be a retry after an uncertain mkdir/sync.
    // File+leaf-directory sync alone cannot make newly created ancestors durable.
    await syncDirectory(path.dirname(current));
  }
  return current;
}
export function encodePreparationPayload(value: unknown, limit = PREPARATION_LIMITS.partBytes): Buffer {
  const bytes = Buffer.from(canonicalPurposeJson(value));
  if (bytes.length === 0 || bytes.length > limit) throw new PathFinderError('PREPARATION_BLOB_LIMIT', 413);
  return bytes;
}
async function verifiedBytes(filename: string, expected: PreparationBlob, limit: number, links: number): Promise<Buffer> {
  const stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== links || stat.size !== expected.bytes || stat.size > limit) return fail();
  const bytes = await fs.readFile(filename); if (bytes.length !== expected.bytes || digest(bytes) !== expected.sha256) return fail(); return bytes;
}
/** Reconcile only the exact two aliases left by our link→unlink publication window.
 * Inode/device comparisons use bigint; rounded JS inode numbers are insufficient.
 * Caller holds the shared store/read mutex. Unproved aliases are never removed. */
async function reconcileTemporaryLink(filename: string, expected: PreparationBlob, limit: number): Promise<void> {
  const target = await fs.lstat(filename, { bigint: true });
  if (!target.isFile() || target.isSymbolicLink() || target.nlink !== 2n || target.size !== BigInt(expected.bytes) || target.ino <= 0n || await fs.realpath(filename) !== path.resolve(filename)) return fail();
  const dir = path.dirname(filename), entries = await fs.readdir(dir, { withFileTypes: true });
  if (entries.length > PREPARATION_LIMITS.storageEntries) throw new PathFinderError('PREPARATION_STORAGE_ENTRY_LIMIT', 413);
  const matches: string[] = [];
  for (const entry of entries) {
    if (!entry.name.endsWith('.tmp') || !policyUuidSchema.safeParse(entry.name.slice(0, -4)).success) continue;
    const candidate = path.join(dir, entry.name), stat = await fs.lstat(candidate, { bigint: true });
    if (stat.dev !== target.dev || stat.ino !== target.ino) continue;
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 2n || stat.size !== target.size || await fs.realpath(candidate) !== path.resolve(candidate)) return fail();
    matches.push(candidate);
  }
  if (matches.length !== 1) return fail();
  const temporary = matches[0];
  await verifiedBytes(filename, expected, limit, 2); await verifiedBytes(temporary, expected, limit, 2);
  // Recheck both exact paths immediately before unlink; retain every ambiguous pair.
  const finalTarget = await fs.lstat(filename, { bigint: true }), finalTemporary = await fs.lstat(temporary, { bigint: true });
  if ([finalTarget, finalTemporary].some(stat => !stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 2n || stat.dev !== target.dev || stat.ino !== target.ino || stat.size !== target.size)) return fail();
  await fs.unlink(temporary); await syncDirectory(dir);
  await verifiedBytes(filename, expected, limit, 1);
}
async function readFile(filename: string, expected: PreparationBlob, limit: number): Promise<Buffer> {
  const stat = await fs.lstat(filename);
  if (stat.nlink === 2) await reconcileTemporaryLink(filename, expected, limit);
  const bytes = await verifiedBytes(filename, expected, limit, 1);
  // Existing nlink=1 may itself be a retry after link but before the first dirsync.
  await syncDirectory(path.dirname(filename)); return bytes;
}
/** Server UUIDs only; the durable destination is never replaced, including on retry. */
export async function storePreparationBlob(projectId: string, sessionId: string, blobId: string, value: unknown, limit = PREPARATION_LIMITS.partBytes): Promise<PreparationBlob> {
  return serialize(() => storeBlob(projectId, sessionId, blobId, value, limit));
}
/** Conservative exact owned-tree accounting; unknown layouts/symlinks refuse writes. */
async function quota(dir: string, additional: number): Promise<void> {
  const root = path.dirname(path.dirname(dir)); let entries = 0, total = 0, session = 0;
  const visit = async (current: string, depth: number): Promise<void> => {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      if (++entries > PREPARATION_LIMITS.storageEntries) throw new PathFinderError('PREPARATION_STORAGE_ENTRY_LIMIT', 413);
      const target = path.join(current, entry.name), stat = await fs.lstat(target);
      if (stat.isSymbolicLink() || await fs.realpath(target) !== path.resolve(target)) return fail();
      if (stat.isDirectory()) { if (depth >= 2 || !policyUuidSchema.safeParse(entry.name).success) return fail(); await visit(target, depth + 1); }
      else {
        if (depth !== 2 || !stat.isFile() || stat.nlink !== 1 || !/^[a-f0-9-]{36}\.(?:json|tmp)$(?![\s\S])/.test(entry.name) || !policyUuidSchema.safeParse(entry.name.slice(0, 36)).success || !Number.isSafeInteger(stat.size)) return fail();
        total += stat.size; if (current === dir) session += stat.size;
        if (total + additional > PREPARATION_LIMITS.totalDiskBytes || session + additional > PREPARATION_LIMITS.sessionDiskBytes) throw new PathFinderError('PREPARATION_STORAGE_QUOTA', 413);
      }
    }
  };
  await visit(root, 0);
  if (additional > PREPARATION_LIMITS.sessionDiskBytes || additional > PREPARATION_LIMITS.totalDiskBytes) throw new PathFinderError('PREPARATION_STORAGE_QUOTA', 413);
}
async function storeBlob(projectId: string, sessionId: string, blobId: string, value: unknown, limit: number): Promise<PreparationBlob> {
  return storeBytes(projectId, sessionId, blobId, encodePreparationPayload(value, limit), limit);
}
/** Preserve exact server-produced UTF-8 output bytes; the caller separately validates its strict DTO. */
export async function storePreparationBytes(projectId: string, sessionId: string, blobId: string, value: Buffer, limit = PREPARATION_LIMITS.partBytes): Promise<PreparationBlob> {
  if (!Buffer.isBuffer(value) || !Number.isSafeInteger(limit) || limit <= 0 || limit > PREPARATION_LIMITS.unionBytes || value.length === 0 || value.length > limit) throw new PathFinderError('PREPARATION_BLOB_LIMIT', 413);
  const bytes = Buffer.from(value);
  return serialize(() => storeBytes(projectId, sessionId, blobId, bytes, limit));
}
async function storeBytes(projectId: string, sessionId: string, blobId: string, bytes: Buffer, limit: number): Promise<PreparationBlob> {
  policyUuidSchema.parse(blobId);
  const expected = { payloadRef: blobId, sha256: digest(bytes), bytes: bytes.length };
  const dir = await directory(projectId, sessionId), filename = path.join(dir, blobId + '.json'), temporary = path.join(dir, randomUUID() + '.tmp');
  try { await readFile(filename, expected, limit); return expected; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await quota(dir, bytes.length);
  const handle = await fs.open(temporary, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  try { await fs.link(temporary, filename); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  // A failed sync or uncertain acknowledgement retains the owned files for reconciliation.
  await fs.unlink(temporary); await syncDirectory(dir);
  await readFile(filename, expected, limit); return expected;
}
export async function readPreparationBlob(projectId: string, sessionId: string, expected: PreparationBlob, limit = PREPARATION_LIMITS.partBytes): Promise<Buffer> {
  policyUuidSchema.parse(expected.payloadRef); policyHashSchema.parse(expected.sha256);
  if (!Number.isSafeInteger(expected.bytes) || expected.bytes <= 0 || expected.bytes > limit) return fail();
  return serialize(async () => readFile(path.join(await directory(projectId, sessionId), expected.payloadRef + '.json'), expected, limit));
}
