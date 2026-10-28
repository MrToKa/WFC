// @vitest-environment node
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canonicalPurposeJson } from '../../shared/pathfinderPurposePolicy.js';
import type { GrantJobClaimRecovery } from './grantWorkerAuthority.js';
import { pathFinderRoot } from './storage.js';
import { readGrantWorkerRecovery, retainGrantWorkerRecovery, retireGrantWorkerRecovery, GRANT_WORKER_RECOVERY_LIMITS } from './grantWorkerRecovery.js';

const io = vi.hoisted(() => ({ mkdir: vi.fn(), lstat: vi.fn(), realpath: vi.fn(), open: vi.fn(), opendir: vi.fn(), unlink: vi.fn() }));
vi.mock('node:fs/promises', () => ({ default: io }));
vi.mock('./storage.js', () => ({ pathFinderRoot: vi.fn() }));
const id = (n: number) => `c8100000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function intent(): GrantJobClaimRecovery {
  return { jobId: id(1), projectId: id(2), provenance: { kind: 'calculation-grant', projectId: id(2), grantId: id(3),
    grantRevision: '4', grantEpoch: '5', installationEpoch: id(6), issuerId: id(7), issuerAdminRevision: '8' },
  claim: { projectId: id(2), grantId: id(3), grantRevision: '4', grantEpoch: '5', installationEpoch: id(6), operation: 'calculate',
    modelVersionId: id(9), selectionRevision: '10', contentFingerprint: 'a'.repeat(64), leaseId: id(11), ownerToken: 'b'.repeat(64) } };
}
type FileNode = { kind: 'directory' | 'file' | 'symlink'; bytes: Buffer; ino: number; nlink: number; mode: number; uid: number };
function fixture() {
  const root = path.resolve('synthetic-private-grant-recovery-root'), dir = path.join(root, 'grant-claim-recovery');
  const nodes = new Map<string, FileNode>(), events: string[] = [];
  const config = { listing: null as string[] | null, realpath: null as string | null };
  let nextInode = 1;
  const add = (filename: string, kind: FileNode['kind'], bytes = Buffer.alloc(0)) => {
    const node: FileNode = { kind, bytes, ino: nextInode++, nlink: 1, mode: kind === 'directory' ? 0o700 : 0o600,
      uid: typeof process.getuid === 'function' ? process.getuid() : 0 };
    nodes.set(filename, node); return node;
  };
  add(root, 'directory');
  const missing = () => Object.assign(Error('Synthetic missing entry.'), { code: 'ENOENT' });
  const stat = (node: FileNode) => ({ ...node, dev: 1, size: node.bytes.length,
    isDirectory: () => node.kind === 'directory', isFile: () => node.kind === 'file', isSymbolicLink: () => node.kind === 'symlink' });
  vi.mocked(pathFinderRoot).mockResolvedValue(root);
  io.mkdir.mockImplementation(async (filename: string, options: { mode: number }) => {
    events.push('mkdir:' + filename); expect(options.mode).toBe(0o700);
    if (nodes.has(filename)) throw Object.assign(Error('Synthetic existing entry.'), { code: 'EEXIST' });
    add(filename, 'directory');
  });
  io.lstat.mockImplementation(async (filename: string) => { const node = nodes.get(filename); if (!node) throw missing(); return stat(node); });
  io.realpath.mockImplementation(async (filename: string) => config.realpath ?? filename);
  io.opendir.mockImplementation(async (directory: string) => ({
    async *[Symbol.asyncIterator]() {
      for (const name of config.listing ?? [...nodes.keys()].filter(filename => path.dirname(filename) === directory).map(filename => path.basename(filename))) {
        events.push('entry:' + name); yield { name };
      }
    },
  }));
  io.open.mockImplementation(async (filename: string, flags: string | number, mode?: number) => {
    events.push('open:' + filename + ':' + flags);
    let node = nodes.get(filename);
    if (flags === 'wx') {
      expect(mode).toBe(0o600);
      if (node) throw Object.assign(Error('Synthetic existing file.'), { code: 'EEXIST' });
      node = add(filename, 'file');
    }
    if (!node) throw missing();
    const opened = node;
    return {
      writeFile: vi.fn(async (bytes: Buffer) => { events.push('write:' + filename); opened.bytes = Buffer.from(bytes); }),
      readFile: vi.fn(async () => Buffer.from(opened.bytes)), stat: vi.fn(async () => stat(opened)),
      sync: vi.fn(async () => { events.push('sync:' + filename); }), close: vi.fn(async () => { events.push('close:' + filename); }),
    };
  });
  io.unlink.mockImplementation(async (filename: string) => { events.push('unlink:' + filename); if (!nodes.delete(filename)) throw missing(); });
  const value = intent(), filename = path.join(dir, value.projectId + '-' + value.jobId + '.json');
  const bytes = (v: GrantJobClaimRecovery = value) => Buffer.from(canonicalPurposeJson({ schemaVersion: 'wfc.pf.private-grant-claim-recovery.v1', ...v }));
  const seed = (v: GrantJobClaimRecovery = value, name = filename) => { if (!nodes.has(dir)) add(dir, 'directory'); return add(name, 'file', bytes(v)); };
  return { root, dir, nodes, events, config, add, value, filename, bytes, seed };
}

beforeEach(() => vi.resetAllMocks());

describe('bounded private grant worker recovery journal over mocked filesystem', () => {
  it('syncs the restrictive private file and its containing directory before returning durable ownership', async () => {
    const f = fixture(), receipt = await retainGrantWorkerRecovery(f.value);
    expect(receipt).toEqual({ sha256: expect.stringMatching(/^[a-f0-9]{64}$/), leaseId: f.value.claim.leaseId });
    expect(f.nodes.get(f.filename)?.bytes).toEqual(f.bytes());
    expect(f.events.indexOf('write:' + f.filename)).toBeLessThan(f.events.indexOf('sync:' + f.filename));
    expect(f.events.indexOf('sync:' + f.filename)).toBeLessThan(f.events.lastIndexOf('sync:' + f.dir));
    expect(f.events).toContain('sync:' + f.root);
    expect(await readGrantWorkerRecovery(f.value)).toEqual(f.value);
  });

  it('replays only identical owner bytes without replacing the existing file', async () => {
    const f = fixture(); await retainGrantWorkerRecovery(f.value);
    const before = f.nodes.get(f.filename)!.ino;
    await retainGrantWorkerRecovery(f.value);
    expect(f.nodes.get(f.filename)!.ino).toBe(before);
    expect(io.open.mock.calls.filter(([, flags]) => flags === 'wx')).toHaveLength(1);
  });

  it('does not replace or retire another owner for the same project/job', async () => {
    const f = fixture(); f.seed();
    const other = { ...f.value, claim: { ...f.value.claim, leaseId: id(12), ownerToken: 'c'.repeat(64) } };
    await expect(retainGrantWorkerRecovery(other)).rejects.toMatchObject({ code: 'CALCULATION_GRANT_RECOVERY_CONFLICT' });
    await expect(retireGrantWorkerRecovery(other)).rejects.toMatchObject({ code: 'CALCULATION_GRANT_RECOVERY_CONFLICT' });
    expect(io.unlink).not.toHaveBeenCalled(); expect(f.nodes.get(f.filename)!.bytes).toEqual(f.bytes());
  });

  it('retires only the exact confirmed owner and syncs its directory, with idempotent missing replay', async () => {
    const f = fixture(); f.seed();
    await retireGrantWorkerRecovery(f.value); await retireGrantWorkerRecovery(f.value);
    expect(io.unlink).toHaveBeenCalledExactlyOnceWith(f.filename);
    expect(f.events.indexOf('unlink:' + f.filename)).toBeLessThan(f.events.lastIndexOf('sync:' + f.dir));
    expect(await readGrantWorkerRecovery(f.value)).toBeNull();
  });

  it('can read and retire the earlier exact job/lease filename without rewriting it', async () => {
    const f = fixture(), legacy = path.join(f.dir, f.value.jobId + '-' + f.value.claim.leaseId + '.json'); f.seed(f.value, legacy);
    expect(await readGrantWorkerRecovery(f.value)).toEqual(f.value);
    await retainGrantWorkerRecovery(f.value);
    expect(io.open.mock.calls.some(([, flags]) => flags === 'wx')).toBe(false);
    await retireGrantWorkerRecovery(f.value); expect(io.unlink).toHaveBeenCalledExactlyOnceWith(legacy);
  });

  it('refuses multiple owner intents instead of choosing one after a restart', async () => {
    const f = fixture(); f.seed(); f.seed(f.value, path.join(f.dir, f.value.jobId + '-' + f.value.claim.leaseId + '.json'));
    await expect(readGrantWorkerRecovery(f.value)).rejects.toMatchObject({ code: 'CALCULATION_GRANT_RECOVERY_CONFLICT' });
    expect(io.unlink).not.toHaveBeenCalled();
  });

  it.each(['symlink', 'hardlink'] as const)('refuses a %s private owner file before following it', async variant => {
    const f = fixture(), node = f.seed(); if (variant === 'symlink') node.kind = 'symlink'; else node.nlink = 2;
    await expect(readGrantWorkerRecovery(f.value)).rejects.toMatchObject({ code: 'CALCULATION_GRANT_RECOVERY_PATH' });
    expect(io.open.mock.calls.some(([, flags]) => typeof flags === 'number')).toBe(false);
    expect(io.unlink).not.toHaveBeenCalled();
  });

  it.each(['symlink', 'different-realpath'] as const)('refuses a %s recovery directory', async variant => {
    const f = fixture(); f.add(f.dir, variant === 'symlink' ? 'symlink' : 'directory');
    if (variant === 'different-realpath') f.config.realpath = path.resolve('synthetic-foreign-directory');
    await expect(readGrantWorkerRecovery(f.value)).rejects.toMatchObject({ code: 'CALCULATION_GRANT_RECOVERY_PATH' });
    expect(io.opendir).not.toHaveBeenCalled(); expect(io.unlink).not.toHaveBeenCalled();
  });

  it('rejects a file substituted between lstat and open using the opened inode identity', async () => {
    const f = fixture(); f.seed(); const original = io.open.getMockImplementation()!;
    io.open.mockImplementation(async (filename, flags, mode) => {
      if (typeof flags === 'number') f.nodes.get(filename)!.ino += 100;
      return original(filename, flags, mode);
    });
    await expect(readGrantWorkerRecovery(f.value)).rejects.toMatchObject({ code: 'CALCULATION_GRANT_RECOVERY_PATH' });
    expect(io.unlink).not.toHaveBeenCalled();
  });

  it.each(['bad-json', 'invalid-utf8', 'extra-secret-field', 'duplicate-key', 'foreign-project'] as const)
  ('refuses %s bytes rather than normalizing a corrupted owner record', async variant => {
    const f = fixture(), node = f.seed();
    if (variant === 'bad-json') node.bytes = Buffer.from('{');
    if (variant === 'invalid-utf8') node.bytes = Buffer.from([0xff]);
    if (variant === 'extra-secret-field') node.bytes = Buffer.from(canonicalPurposeJson({ schemaVersion: 'wfc.pf.private-grant-claim-recovery.v1', ...f.value, arbitraryPath: '/foreign' }));
    if (variant === 'duplicate-key') node.bytes = Buffer.from('{"jobId":"' + f.value.jobId + '",' + f.bytes().toString().slice(1));
    if (variant === 'foreign-project') node.bytes = Buffer.from(canonicalPurposeJson({ schemaVersion: 'wfc.pf.private-grant-claim-recovery.v1', ...f.value, projectId: id(99) }));
    await expect(readGrantWorkerRecovery(f.value)).rejects.toMatchObject({ code: 'CALCULATION_GRANT_RECOVERY_INVALID' });
    expect(io.unlink).not.toHaveBeenCalled();
  });

  it('bounds directory discovery before reading an oversized entry list', async () => {
    const f = fixture(); f.config.listing = Array.from({ length: GRANT_WORKER_RECOVERY_LIMITS.entries + 2 }, (_, n) => 'unrelated-' + n);
    await expect(readGrantWorkerRecovery(f.value)).rejects.toMatchObject({ code: 'CALCULATION_GRANT_RECOVERY_LIMIT' });
    expect(f.events.filter(e => e.startsWith('entry:'))).toHaveLength(GRANT_WORKER_RECOVERY_LIMITS.entries + 1);
    expect(io.open.mock.calls.some(([, flags]) => typeof flags === 'number')).toBe(false);
  });

  it('can reconcile an existing exact owner at capacity while refusing a new entry', async () => {
    const f = fixture(); f.seed();
    f.config.listing = [path.basename(f.filename), ...Array.from({ length: GRANT_WORKER_RECOVERY_LIMITS.entries - 1 }, (_, n) => 'unrelated-' + n)];
    await expect(retainGrantWorkerRecovery(f.value)).resolves.toMatchObject({ leaseId: f.value.claim.leaseId });
    const other = { ...f.value, jobId: id(98) };
    await expect(retainGrantWorkerRecovery(other)).rejects.toMatchObject({ code: 'CALCULATION_GRANT_RECOVERY_LIMIT' });
  });

  it('refuses owner files over the byte cap without reading their contents', async () => {
    const f = fixture(), node = f.seed(); node.bytes = Buffer.alloc(GRANT_WORKER_RECOVERY_LIMITS.bytes + 1);
    await expect(readGrantWorkerRecovery(f.value)).rejects.toMatchObject({ code: 'CALCULATION_GRANT_RECOVERY_PATH' });
    expect(io.open.mock.calls.some(([, flags]) => typeof flags === 'number')).toBe(false);
  });

  it('validates tenant/grant/operation scope before attempting private persistence', async () => {
    const f = fixture();
    await expect(retainGrantWorkerRecovery({ ...f.value, claim: { ...f.value.claim, projectId: id(99) } })).rejects.toMatchObject({ code: 'CALCULATION_GRANT_RECOVERY_INVALID' });
    await expect(retainGrantWorkerRecovery({ ...f.value, claim: { ...f.value.claim, operation: 'prepare' } })).rejects.toMatchObject({ code: 'CALCULATION_GRANT_RECOVERY_INVALID' });
    expect(pathFinderRoot).not.toHaveBeenCalled(); expect(io.open).not.toHaveBeenCalled();
  });
});
