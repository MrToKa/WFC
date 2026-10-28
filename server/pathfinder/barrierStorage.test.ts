import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ files: new Map<string, Buffer>(), dirs: new Set<string>(), symlinks: new Set<string>(), links: new Map<string, number>(), sizes: new Map<string, number>(), inodes: new Map<string, number>(), devices: new Map<string, number>(), nextInode: 1, syncs: [] as string[], failSync: false }));
vi.mock('./storage.js', () => ({ pathFinderRoot: async () => path.resolve('C:/owned-pf-barrier-storage-test') }));
vi.mock('node:fs/promises', () => ({ default: {
  mkdir: async (p: string) => { if (state.dirs.has(p)) throw Object.assign(Error('exists'), { code: 'EEXIST' }); state.dirs.add(p); }, realpath: async (p: string) => p,
  lstat: async (p: string, options?: { bigint?: boolean }) => {
    if (!state.files.has(p) && !state.dirs.has(p)) throw Object.assign(Error('missing'), { code: 'ENOENT' });
    if (!state.inodes.has(p)) state.inodes.set(p, state.nextInode++);
    const inode = state.inodes.get(p)!, links = state.links.get(p) ?? [...state.files.keys()].filter(name => state.inodes.get(name) === inode && (state.devices.get(name) ?? 1) === (state.devices.get(p) ?? 1)).length;
    const scalar = (v: number) => options?.bigint ? BigInt(v) : v;
    return { isFile: () => state.files.has(p), isDirectory: () => state.dirs.has(p), isSymbolicLink: () => state.symlinks.has(p), nlink: scalar(state.files.has(p) ? links : 1), size: scalar(state.sizes.get(p) ?? state.files.get(p)?.length ?? 0), ino: scalar(inode), dev: scalar(state.devices.get(p) ?? 1) };
  },
  readdir: async (p: string) => [...new Set([...state.dirs, ...state.files.keys()])].filter(value => path.dirname(value) === p).map(value => ({ name: path.basename(value) })),
  readFile: async (p: string) => Buffer.from(state.files.get(p)!),
  link: async (source: string, target: string) => { if (state.files.has(target)) throw Object.assign(Error('exists'), { code: 'EEXIST' }); state.files.set(target, Buffer.from(state.files.get(source)!)); state.inodes.set(target, state.inodes.get(source)!); },
  unlink: async (p: string) => { state.files.delete(p); state.inodes.delete(p); },
  open: async (p: string, mode: string) => ({ writeFile: async (bytes: Buffer) => { if (mode !== 'wx' || state.files.has(p)) throw Error('exclusive'); state.files.set(p, Buffer.from(bytes)); state.inodes.set(p, state.nextInode++); }, sync: async () => { state.syncs.push(p); if (state.failSync && mode === 'wx') throw Error('uncertain fsync'); }, close: async () => undefined }),
} }));
import { BARRIER_STORAGE_LIMITS, encodeBarrierJson, readBarrierBytes, storeBarrierBytes } from './barrierStorage.js';
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));
beforeEach(() => { state.files.clear(); state.dirs.clear(); state.symlinks.clear(); state.links.clear(); state.sizes.clear(); state.inodes.clear(); state.devices.clear(); state.nextInode = 1; state.syncs = []; state.failSync = false; });

describe('server-owned immutable barrier storage', () => {
  it('preserves exact source UTF-8 and freezes the caller buffer before the first await', async () => {
    const raw = Buffer.from(' {"z":1.000,"a":2}\n'), copy = Buffer.from(raw), pending = storeBarrierBytes(id(1), id(2), id(3), raw); raw.fill(0);
    const ref = await pending; expect(await readBarrierBytes(id(1), id(2), ref)).toEqual(copy); expect(ref.bytes).toBe(copy.length);
  });
  it('fsyncs new ancestors, bytes and leaf before acknowledgement and never overwrites an exact replay', async () => {
    const ref = await storeBarrierBytes(id(1), id(2), id(3), bytes({ a: 1 }));
    expect(state.syncs.slice(0, 3)).toEqual([path.resolve('C:/owned-pf-barrier-storage-test'), path.join(path.resolve('C:/owned-pf-barrier-storage-test'), 'barriers'), path.join(path.resolve('C:/owned-pf-barrier-storage-test'), 'barriers', id(1))]);
    expect(state.syncs).toHaveLength(6); const first = [...state.files.entries()];
    expect(await storeBarrierBytes(id(1), id(2), id(3), bytes({ a: 1 }))).toEqual(ref); expect([...state.files.entries()]).toEqual(first);
  });
  it('refuses changed bytes under an existing opaque identity, preserving the original', async () => {
    const ref = await storeBarrierBytes(id(1), id(2), id(3), bytes({ a: 1 }));
    await expect(storeBarrierBytes(id(1), id(2), id(3), bytes({ a: 2 }))).rejects.toMatchObject({ code: 'BARRIER_BLOB_INTEGRITY' });
    expect((await readBarrierBytes(id(1), id(2), ref)).toString()).toBe('{"a":1}');
  });
  it.each(['../foreign', id(3) + '\n', '10000000-0000-4000-8000-00000000000A', 'https://foreign.test/blob'])('rejects a caller path or noncanonical blob identity %s', async blobId => {
    await expect(storeBarrierBytes(id(1), id(2), blobId, bytes({}))).rejects.toBeDefined(); expect(state.files.size).toBe(0);
  });
  it('rejects symlink ancestors before any byte is written', async () => {
    state.symlinks.add(path.join(path.resolve('C:/owned-pf-barrier-storage-test'), 'barriers', id(1)));
    await expect(storeBarrierBytes(id(1), id(2), id(3), bytes({}))).rejects.toMatchObject({ code: 'BARRIER_BLOB_INTEGRITY' }); expect(state.files.size).toBe(0);
  });
  it('detects hashes, wrong byte counts, symlinks and unproved hard links', async () => {
    const ref = await storeBarrierBytes(id(1), id(2), id(3), bytes({ a: 1 })), filename = [...state.files.keys()][0];
    await expect(readBarrierBytes(id(1), id(2), { ...ref, bytes: ref.bytes + 1 })).rejects.toMatchObject({ code: 'BARRIER_BLOB_INTEGRITY' });
    state.links.set(filename, 3); await expect(readBarrierBytes(id(1), id(2), ref)).rejects.toMatchObject({ code: 'BARRIER_BLOB_INTEGRITY' }); state.links.clear();
    state.symlinks.add(filename); await expect(readBarrierBytes(id(1), id(2), ref)).rejects.toMatchObject({ code: 'BARRIER_BLOB_INTEGRITY' }); state.symlinks.clear();
    state.files.set(filename, bytes({ a: 2 })); await expect(readBarrierBytes(id(1), id(2), ref)).rejects.toMatchObject({ code: 'BARRIER_BLOB_INTEGRITY' });
  });
  it('retains its recoverable private temporary file after uncertain fsync instead of acknowledging it', async () => {
    state.failSync = true; await expect(storeBarrierBytes(id(1), id(2), id(3), bytes({}))).rejects.toThrow('uncertain fsync');
    expect([...state.files.keys()].every(p => p.endsWith('.tmp'))).toBe(true); expect(state.files.size).toBe(1);
  });
  it('bounds actual bytes, supplied limit and finite JSON before any file IO', async () => {
    await expect(storeBarrierBytes(id(1), id(2), id(3), Buffer.alloc(0))).rejects.toMatchObject({ code: 'BARRIER_BLOB_LIMIT' });
    await expect(storeBarrierBytes(id(1), id(2), id(3), bytes({}), 1)).rejects.toMatchObject({ code: 'BARRIER_BLOB_LIMIT' });
    await expect(storeBarrierBytes(id(1), id(2), id(3), bytes({}), Infinity)).rejects.toMatchObject({ code: 'BARRIER_BLOB_LIMIT' });
    expect(() => encodeBarrierJson({ n: NaN })).toThrow(); expect(state.files.size).toBe(0);
  });
  it('refuses an exhausted intent quota before allocating another file', async () => {
    await storeBarrierBytes(id(1), id(2), id(3), bytes({})); const first = [...state.files.keys()][0]; state.sizes.set(first, BARRIER_STORAGE_LIMITS.intentBytes);
    await expect(storeBarrierBytes(id(1), id(2), id(4), bytes({}))).rejects.toMatchObject({ code: 'BARRIER_STORAGE_QUOTA' }); expect(state.files.size).toBe(1);
  });
  it('counts other project/intent trees toward the global quota without deleting evidence', async () => {
    await storeBarrierBytes(id(1), id(2), id(3), bytes({})); state.sizes.set([...state.files.keys()][0], BARRIER_STORAGE_LIMITS.totalBytes);
    await expect(storeBarrierBytes(id(5), id(6), id(7), bytes({}))).rejects.toMatchObject({ code: 'BARRIER_STORAGE_QUOTA' }); expect(state.files.size).toBe(1);
  });
  it('rejects unknown files in its owned tree without cleaning or modifying them', async () => {
    await storeBarrierBytes(id(1), id(2), id(3), bytes({})); const foreign = path.join(path.dirname([...state.files.keys()][0]), 'business.txt'); state.files.set(foreign, Buffer.from('retain'));
    await expect(storeBarrierBytes(id(1), id(2), id(4), bytes({}))).rejects.toMatchObject({ code: 'BARRIER_BLOB_INTEGRITY' }); expect(state.files.get(foreign)?.toString()).toBe('retain');
  });
  it('serializes concurrent same-ID allocation and refuses only the conflicting bytes', async () => {
    const results = await Promise.allSettled([storeBarrierBytes(id(1), id(2), id(3), bytes({ a: 1 })), storeBarrierBytes(id(1), id(2), id(3), bytes({ a: 2 }))]);
    expect(results.filter(value => value.status === 'fulfilled')).toHaveLength(1); expect(results.filter(value => value.status === 'rejected')).toHaveLength(1); expect(state.files.size).toBe(1);
  });
  it('recovers only the exact owned link/unlink crash pair on read and exact retry', async () => {
    const ref = await storeBarrierBytes(id(1), id(2), id(3), bytes({ a: 1 })), target = [...state.files.keys()][0], temporary = path.join(path.dirname(target), id(9) + '.tmp');
    state.files.set(temporary, Buffer.from(state.files.get(target)!)); state.inodes.set(temporary, state.inodes.get(target)!);
    expect((await readBarrierBytes(id(1), id(2), ref)).toString()).toBe('{"a":1}'); expect(state.files.has(temporary)).toBe(false);
    expect(await storeBarrierBytes(id(1), id(2), id(3), bytes({ a: 1 }))).toEqual(ref);
  });
  it.each(['different-inode', 'different-device', 'tampered-content', 'foreign-name', 'multiple-aliases', 'symlink'] as const)('refuses %s publication aliases without removing anything', async kind => {
    const ref = await storeBarrierBytes(id(1), id(2), id(3), bytes({ a: 1 })), target = [...state.files.keys()][0], temporary = path.join(path.dirname(target), kind === 'foreign-name' ? 'foreign.tmp' : id(9) + '.tmp');
    state.files.set(temporary, Buffer.from(kind === 'tampered-content' ? '{"a":2}' : state.files.get(target)!)); state.inodes.set(temporary, kind === 'different-inode' ? 999 : state.inodes.get(target)!);
    if (kind === 'different-inode' || kind === 'different-device') state.links.set(target, 2); if (kind === 'different-device') state.devices.set(temporary, 9); if (kind === 'symlink') state.symlinks.add(temporary);
    if (kind === 'multiple-aliases') { const other = path.join(path.dirname(target), id(8) + '.tmp'); state.files.set(other, Buffer.from(state.files.get(target)!)); state.inodes.set(other, state.inodes.get(target)!); }
    const before = [...state.files.keys()]; await expect(readBarrierBytes(id(1), id(2), ref)).rejects.toMatchObject({ code: 'BARRIER_BLOB_INTEGRITY' }); expect([...state.files.keys()]).toEqual(before);
  });
});
