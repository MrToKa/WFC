import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { barrierMultipartCanonicalBytes } from '../../shared/pathfinderBarrierMultipart.js';
import { BARRIER_MULTIPART_STORAGE_LIMITS as L, createBarrierMultipartStorage, encodeBarrierMultipartControl,
  type AssertBarrierMultipartReservation, type BarrierMultipartStorageTicket } from './barrierMultipartStorage.js';

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const raw = Buffer.from([0, 255, 1, 128, 65, 0, 127]);
const ticket = (bytes: Buffer = raw, changes: Partial<BarrierMultipartStorageTicket> = {}): BarrierMultipartStorageTicket => ({
  projectId: id(1), sessionId: id(2), allocationId: id(3), blobId: id(4), requestSha256: 'a'.repeat(64),
  sha256: digest(bytes), bytes: bytes.length, kind: 'part', reservedBytes: bytes.length * 2, reservedFiles: 2, ...changes,
});
const authority = (): AssertBarrierMultipartReservation => vi.fn(async (value, entry) => {
  if (entry && (entry.blobId !== value.blobId || entry.kind !== value.kind
    || entry.allocationId !== null && entry.allocationId !== value.allocationId
    || (entry.allocationId === null ? entry.bytes !== value.bytes : entry.bytes > value.bytes)))
    throw Object.assign(Error('fixed'), { code: 'ENTRY_NOT_RESERVED' });
  return { globalReservedBytes: 16 * 1024 ** 2, globalReservedFiles: 100 };
});
const page = () => ({ schemaVersion: 'wfc.pf.barrier-multipart-page.v2', kind: 'nodes', scopeSha256: '1'.repeat(64),
  profileSha256: '2'.repeat(64), index: 0, firstOrdinal: 0, previousPageSha256: null,
  records: [{ dbId: 3, membershipMask: '0'.repeat(31) + '1' }], pageSha256: '3'.repeat(64) });
const namespace = (root: string) => path.join(root, L.namespace);
const finalName = (root: string, value = ticket()) => path.join(namespace(root), value.blobId + '.' + value.kind);
const temporaryName = (root: string, value = ticket()) => path.join(namespace(root), value.blobId + '.' + value.allocationId + '.' + value.kind + '.tmp');
async function fixture(): Promise<string> {
  // Every test owns a fresh bounded child. Retain its files, including failure
  // evidence: these tests never clean any prior fixture or application storage.
  return fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'wfc-barrier-multipart-storage-'));
}
afterEach(() => vi.restoreAllMocks());

describe('multipart storage control and admission boundaries', () => {
  it('encodes only a strict canonical bounded v2 page or seal without claiming its semantic hash is verified', () => {
    expect(encodeBarrierMultipartControl(page())).toEqual(Buffer.from(barrierMultipartCanonicalBytes(page())));
    expect(() => encodeBarrierMultipartControl({ ...page(), ready: true })).toThrow();
    expect(() => encodeBarrierMultipartControl({ ...page(), records: Array.from({ length: 513 }, (_, dbId) => ({ dbId, membershipMask: '0'.repeat(31) + '1' })) })).toThrow();
    expect(() => encodeBarrierMultipartControl({ ...page(), records: [{ dbId: -0, membershipMask: '0'.repeat(31) + '1' }] })).toThrow();
  });
  it('refuses caller path material, under-reservation and oversize tickets before authority or file I/O', async () => {
    const root = await fixture(), storage = createBarrierMultipartStorage(root), assertion = authority();
    for (const value of [ticket(raw, { blobId: '../foreign' }), ticket(raw, { allocationId: id(3) + '\n' }),
      ticket(raw, { reservedFiles: 1 }), ticket(raw, { reservedBytes: raw.length }),
      ticket(raw, { bytes: L.partBytes + 1, reservedBytes: (L.partBytes + 1) * 2 })])
      await expect(storage.store(value, raw, assertion)).rejects.toBeDefined();
    expect(assertion).not.toHaveBeenCalled(); expect(await fs.readdir(root)).toEqual([]);
    expect(() => createBarrierMultipartStorage(path.join(root, '..') + path.sep)).toThrow();
  });
  it('requires authoritative counters including the namespace and cannot turn a process-local allowance into permission', async () => {
    const root = await fixture(), storage = createBarrierMultipartStorage(root);
    await expect(storage.store(ticket(), raw, undefined as unknown as AssertBarrierMultipartReservation)).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_RESERVATION_REQUIRED' });
    for (const totals of [{ globalReservedBytes: raw.length, globalReservedFiles: 3 },
      { globalReservedBytes: raw.length * 2, globalReservedFiles: 2 },
      { globalReservedBytes: L.totalBytes + 1, globalReservedFiles: 3 },
      { globalReservedBytes: raw.length * 2, globalReservedFiles: L.totalFiles + 1 }])
      await expect(storage.store(ticket(), raw, async () => totals)).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_STORAGE_QUOTA' });
    expect(await fs.readdir(root)).toEqual([]);
  });
  it('refuses noncanonical, duplicate-member and malformed UTF-8 control bytes before allocation', async () => {
    const root = await fixture(), storage = createBarrierMultipartStorage(root), assertion = authority();
    for (const bytes of [Buffer.from(JSON.stringify(page()) + '\n'), Buffer.from('{"x":1,"x":2}'), Buffer.from([0xff])])
      await expect(storage.store(ticket(bytes, { kind: 'control' }), bytes, assertion)).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_CONTROL_INVALID' });
    expect(assertion).not.toHaveBeenCalled(); expect(await fs.readdir(root)).toEqual([]);
  });
  it('refuses a revoked/foreign owner or cancelled exact allocation before creating the namespace', async () => {
    const root = await fixture(), storage = createBarrierMultipartStorage(root), cancelled = new AbortController(); cancelled.abort();
    await expect(storage.store(ticket(), raw, async () => { throw Object.assign(Error('fixed'), { code: 'OWNER_CHANGED' }); })).rejects.toMatchObject({ code: 'OWNER_CHANGED' });
    await expect(storage.store(ticket(), raw, authority(), { signal: cancelled.signal })).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_STORAGE_CANCELLED' });
    expect(await fs.readdir(root)).toEqual([]);
  });
  it.skipIf(process.platform !== 'win32')('reports unsupported Windows directory durability explicitly instead of acknowledging staged bytes', async () => {
    const root = await fixture(), storage = createBarrierMultipartStorage(root);
    await expect(storage.store(ticket(), raw, authority())).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_DIRECTORY_DURABILITY_UNSUPPORTED' });
    expect(await fs.readdir(namespace(root))).toEqual([]);
  });
});

// Actual file/directory fsync acceptance is Linux-only. Windows must run its
// explicit unsupported case above; skipping these cannot be reported durable PASS.
describe.skipIf(process.platform !== 'linux')('actual Linux owned multipart filesystem', () => {
  it('preserves exact opaque bytes, inode and same-content replay without additional files', async () => {
    const root = await fixture(), storage = createBarrierMultipartStorage(root), assertion = authority();
    const ref = await storage.store(ticket(), raw, assertion), before = await fs.lstat(finalName(root), { bigint: true });
    expect(ref).toEqual({ blobId: id(4), sha256: digest(raw), bytes: raw.length, durability: 'file-and-directory-fsynced' });
    expect(await storage.read(ticket(), assertion)).toEqual(raw);
    expect(await storage.store(ticket(), raw, assertion)).toEqual(ref);
    expect((await fs.lstat(finalName(root), { bigint: true })).ino).toBe(before.ino);
    expect(before.nlink).toBe(1n); expect(await fs.readdir(namespace(root))).toEqual([id(4) + '.part']);
  });
  it('detaches caller bytes and ticket before the first asynchronous authority check', async () => {
    const root = await fixture(), storage = createBarrierMultipartStorage(root), input = Buffer.from(raw), value = { ...ticket() };
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let calls = 0;
    const assertion: AssertBarrierMultipartReservation = async received => {
      expect(Object.isFrozen(received)).toBe(true); expect(received.blobId).toBe(id(4));
      if (++calls === 1) await gate;
      return { globalReservedBytes: 1024, globalReservedFiles: 3 };
    };
    const pending = storage.store(value, input, assertion); input.fill(9); value.blobId = id(99); release();
    await pending; expect(await storage.read(ticket(), authority())).toEqual(raw);
  });
  it('stores canonical control pages with separate raw hashes and refuses a conflicting final identity', async () => {
    const root = await fixture(), storage = createBarrierMultipartStorage(root), bytes = encodeBarrierMultipartControl(page()), value = ticket(bytes, { kind: 'control' });
    const ref = await storage.store(value, bytes, authority()); expect(ref.sha256).toBe(digest(bytes));
    expect(ref.sha256).not.toBe(page().pageSha256); expect(await storage.read(value, authority())).toEqual(bytes);
    const changed = encodeBarrierMultipartControl({ ...page(), records: [{ dbId: 4, membershipMask: '0'.repeat(31) + '1' }] });
    await expect(storage.store(ticket(changed, { kind: 'control' }), changed, authority())).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_STORAGE_INTEGRITY' });
    expect(await storage.read(value, authority())).toEqual(bytes);
  });
  it('checks real disk availability against every outstanding reservation before creating a temporary file', async () => {
    const root = await fixture(), storage = createBarrierMultipartStorage(root), statfs = fs.statfs.bind(fs);
    vi.spyOn(fs, 'statfs').mockImplementation(async (...args) => ({ ...await statfs(args[0], { bigint: true }), bavail: 0n }) as never);
    await expect(storage.store(ticket(), raw, authority())).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_STORAGE_DISK_HEADROOM' });
    expect(await fs.readdir(namespace(root))).toEqual([]);
  });
  it('counts retained other-session temporaries and refuses usage not covered by authoritative global bytes or entries', async () => {
    const root = await fixture(), storage = createBarrierMultipartStorage(root);
    await fs.mkdir(namespace(root), { mode: 0o700 }); const foreignPending = path.join(namespace(root), id(50) + '.' + id(51) + '.part.tmp');
    await fs.writeFile(foreignPending, Buffer.alloc(30));
    await expect(storage.store(ticket(), raw, async () => ({ globalReservedBytes: raw.length * 2, globalReservedFiles: 3 }))).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_STORAGE_QUOTA' });
    expect((await fs.readFile(foreignPending)).length).toBe(30);
    await fs.writeFile(path.join(namespace(root), id(52) + '.' + id(53) + '.part.tmp'), Buffer.alloc(1));
    await fs.writeFile(path.join(namespace(root), id(54) + '.' + id(55) + '.part.tmp'), Buffer.alloc(1));
    await expect(storage.store(ticket(), raw, async () => ({ globalReservedBytes: 1024, globalReservedFiles: 3 }))).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_STORAGE_QUOTA' });
    expect(await fs.readdir(namespace(root))).toHaveLength(3);
  });
  it('reserves physical room for both new paths before I/O, including retained files that individually fit the global counters', async () => {
    const root = await fixture(), storage = createBarrierMultipartStorage(root); await fs.mkdir(namespace(root), { mode: 0o700 });
    const retained = path.join(namespace(root), id(60) + '.' + id(61) + '.part.tmp'); await fs.writeFile(retained, Buffer.alloc(1));
    await expect(storage.store(ticket(), raw, async () => ({ globalReservedBytes: raw.length * 2, globalReservedFiles: 3 }))).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_STORAGE_QUOTA' });
    expect(await fs.readdir(namespace(root))).toEqual([path.basename(retained)]);
    await expect(storage.store(ticket(), raw, async () => ({ globalReservedBytes: raw.length * 2, globalReservedFiles: 4 }))).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_STORAGE_QUOTA' });
    expect(await fs.readdir(namespace(root))).toEqual([path.basename(retained)]);
  });
  it.each(['unknown-blob', 'wrong-allocation', 'wrong-kind', 'wrong-final-size'] as const)('requires authoritative DB allocation proof for every well-formed retained %s entry', async kind => {
    const root = await fixture(), storage = createBarrierMultipartStorage(root); await fs.mkdir(namespace(root), { mode: 0o700 });
    const name = kind === 'unknown-blob' ? id(70) + '.' + id(71) + '.part.tmp'
      : kind === 'wrong-allocation' ? id(4) + '.' + id(72) + '.part.tmp'
        : kind === 'wrong-kind' ? id(4) + '.' + id(3) + '.control.tmp' : id(4) + '.part';
    const retained = path.join(namespace(root), name); await fs.writeFile(retained, raw.subarray(0, 2));
    await expect(storage.store(ticket(), raw, authority())).rejects.toMatchObject({ code: 'ENTRY_NOT_RESERVED' });
    expect(await fs.readFile(retained)).toEqual(raw.subarray(0, 2)); expect(await fs.readdir(namespace(root))).toEqual([name]);
  });
  it.each([1, 2, 3, 4, 5])('cannot acknowledge authority loss at awaited stage %s; retained bytes are never uncharged or deleted', async deniedAt => {
    const root = await fixture(), storage = createBarrierMultipartStorage(root); let calls = 0;
    const assertion: AssertBarrierMultipartReservation = async () => {
      if (++calls === deniedAt) throw Object.assign(Error('fixed'), { code: 'AUTHORITY_LOST' });
      return { globalReservedBytes: 1024, globalReservedFiles: 3 };
    };
    await expect(storage.store(ticket(), raw, assertion)).rejects.toMatchObject({ code: 'AUTHORITY_LOST' });
    expect(calls).toBe(deniedAt);
    if (deniedAt >= 3) expect(await fs.readdir(namespace(root))).toHaveLength(deniedAt === 4 ? 2 : 1);
    if (deniedAt === 4) {
      expect((await fs.lstat(finalName(root))).nlink).toBe(2);
      await expect(storage.store(ticket(), raw, authority())).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_STORAGE_INTEGRITY' });
      expect(await fs.readdir(namespace(root))).toHaveLength(2);
    }
  });
  it('retains partial ENOSPC output and refuses to overwrite it or allocate a new temporary identity on retry', async () => {
    const root = await fixture(), storage = createBarrierMultipartStorage(root), open = fs.open.bind(fs); let writes = 0;
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args); if (String(args[0]) !== temporaryName(root)) return handle;
      return new Proxy(handle, { get(target, key) {
        if (key === 'write') return async (bytes: Buffer, offset: number, length: number, position: number) => {
          if (++writes === 1) return target.write(bytes, offset, Math.min(length, 2), position);
          throw Object.assign(Error('fixed'), { code: 'ENOSPC' });
        };
        const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
      } });
    });
    await expect(storage.store(ticket(), raw, authority())).rejects.toMatchObject({ code: 'ENOSPC' }); vi.restoreAllMocks();
    expect((await fs.stat(temporaryName(root))).size).toBe(2);
    await expect(storage.store(ticket(), raw, authority())).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_STORAGE_INTEGRITY' });
    expect(await fs.readdir(namespace(root))).toEqual([path.basename(temporaryName(root))]);
  });
  it('replays one exact complete retained temporary allocation while preserving deterministic file identity', async () => {
    const root = await fixture(), storage = createBarrierMultipartStorage(root); await fs.mkdir(namespace(root), { mode: 0o700 });
    await fs.writeFile(temporaryName(root), raw); const before = await fs.stat(temporaryName(root), { bigint: true });
    await storage.store(ticket(), raw, authority()); expect((await fs.stat(finalName(root), { bigint: true })).ino).toBe(before.ino);
    expect(await fs.readdir(namespace(root))).toEqual([path.basename(finalName(root))]);
  });
  it('refuses symlink ancestors, final symlinks and foreign files without altering their contents', async () => {
    const root = await fixture(), storage = createBarrierMultipartStorage(root); await fs.mkdir(namespace(root), { mode: 0o700 });
    const foreign = path.join(namespace(root), 'foreign.txt'); await fs.writeFile(foreign, 'keep');
    await expect(storage.store(ticket(), raw, authority())).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_STORAGE_INTEGRITY' });
    expect(await fs.readFile(foreign, 'utf8')).toBe('keep');
    const otherRoot = await fixture(), other = createBarrierMultipartStorage(otherRoot), original = path.join(otherRoot, 'original'); await fs.mkdir(original);
    await fs.symlink(original, namespace(otherRoot));
    await expect(other.store(ticket(), raw, authority())).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_STORAGE_INTEGRITY' });
    expect(await fs.readdir(original)).toEqual([]);
    const third = await fixture(), thirdStorage = createBarrierMultipartStorage(third); await fs.mkdir(namespace(third), { mode: 0o700 });
    const retained = path.join(third, 'retained'); await fs.writeFile(retained, raw); await fs.symlink(retained, finalName(third));
    await expect(thirdStorage.read(ticket(), authority())).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_STORAGE_INTEGRITY' });
    expect(await fs.readFile(retained)).toEqual(raw);
  });
  it('refuses a public or foreign-owned new namespace while preserving the configured root conventions', async () => {
    const root = await fixture(), storage = createBarrierMultipartStorage(root); await fs.mkdir(namespace(root), { mode: 0o700 });
    const rootMode = (await fs.stat(root)).mode; await fs.chmod(namespace(root), 0o750);
    await expect(storage.store(ticket(), raw, authority())).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_STORAGE_INTEGRITY' });
    expect((await fs.stat(root)).mode).toBe(rootMode); expect(await fs.readdir(namespace(root))).toEqual([]);
    await fs.chmod(namespace(root), 0o700); const uid = process.getuid!(); vi.spyOn(process as { getuid: () => number }, 'getuid').mockReturnValue(uid + 1);
    await expect(storage.store(ticket(), raw, authority())).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_STORAGE_INTEGRITY' });
    expect(await fs.readdir(namespace(root))).toEqual([]);
  });
  it('detects unproved hard links, truncation, changed bytes and inode replacement during an open read', async () => {
    const root = await fixture(), storage = createBarrierMultipartStorage(root); await storage.store(ticket(), raw, authority());
    const alias = path.join(namespace(root), id(90) + '.part'); await fs.link(finalName(root), alias);
    await expect(storage.read(ticket(), authority())).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_STORAGE_INTEGRITY' });
    // This test owns this exact alias; its removal is part of the corruption
    // fixture only. Production storage never removes an ambiguous alias.
    await fs.unlink(alias); await fs.writeFile(finalName(root), raw.subarray(1));
    await expect(storage.read(ticket(), authority())).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_STORAGE_INTEGRITY' });
    await fs.writeFile(finalName(root), Buffer.alloc(raw.length));
    await expect(storage.read(ticket(), authority())).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_STORAGE_INTEGRITY' });
    await fs.writeFile(finalName(root), raw); const open = fs.open.bind(fs); let replaced = false;
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args);
      if (!replaced && String(args[0]) === finalName(root)) {
        replaced = true; await fs.rename(finalName(root), path.join(namespace(root), id(91) + '.part')); await fs.writeFile(finalName(root), raw);
      }
      return handle;
    });
    await expect(storage.read(ticket(), authority())).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_STORAGE_INTEGRITY' });
    expect(await fs.readdir(namespace(root))).toHaveLength(2);
  });
  it('retains bytes after uncertain file fsync and never turns a directory sync error into a durability receipt', async () => {
    const root = await fixture(), storage = createBarrierMultipartStorage(root), open = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args); if (String(args[0]) !== temporaryName(root)) return handle;
      return new Proxy(handle, { get(target, key) {
        if (key === 'sync') return async () => { throw Object.assign(Error('fixed'), { code: 'EIO' }); };
        const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
      } });
    });
    await expect(storage.store(ticket(), raw, authority())).rejects.toMatchObject({ code: 'EIO' });
    expect(await fs.readFile(temporaryName(root))).toEqual(raw); vi.restoreAllMocks();
    const secondRoot = await fixture(), second = createBarrierMultipartStorage(secondRoot), nativeOpen = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      if (String(args[0]) === secondRoot) throw Object.assign(Error('fixed'), { code: 'EIO' });
      return nativeOpen(...args);
    });
    await expect(second.store(ticket(), raw, authority())).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_STORAGE_DURABILITY' });
    expect(await fs.readdir(namespace(secondRoot))).toEqual([]);
  });
});
