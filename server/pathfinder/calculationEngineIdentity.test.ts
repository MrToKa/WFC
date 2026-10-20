// @vitest-environment node
import fs from 'node:fs/promises';
import path from 'node:path';
import type { BigIntStats, Stats } from 'node:fs';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { calculationProjectionFiles, createCalculationEngineIdentityReader } from './calculationEngineIdentity.js';
import { verifyEngineIdentity } from '../../shared/pathfinderEngineIdentity.js';

vi.mock('node:fs/promises', () => ({ default: { lstat: vi.fn(), realpath: vi.fn(), readFile: vi.fn() } }));
const sha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
type Entry = { bytes: Buffer; size: bigint; ino: bigint; mtimeNs: bigint; ctimeNs: bigint; nlink: bigint; symlink: boolean };

/** All filesystem facts are mocked. No directory/file is created, followed or removed. */
function fixture() {
  vi.clearAllMocks();
  const root = path.resolve('pathfinder-engine/.scratch/mock-only-r7-engine-identity');
  const files = new Map<string, Entry>(), directories = new Set<string>(), linkedDirectories = new Set<string>();
  const names = ['PathFinder.ModelRunner.dll', 'PathFinder.Model.dll', 'PathFinder.Core.dll', 'PathFinder.Adapter.dll', 'projection.js'];
  names.forEach((name, index) => files.set(path.join(root, name), { bytes: Buffer.from(`synthetic-${index}`), size: 11n, ino: BigInt(index + 1), mtimeNs: 10n, ctimeNs: 20n, nlink: 1n, symlink: false }));
  for (let directory = root; ; directory = path.dirname(directory)) { directories.add(directory); if (path.dirname(directory) === directory) break; }
  const lstat = async (filename: unknown, _options?: unknown) => {
    const key = String(filename), entry = files.get(key);
    if (entry) return { isFile: () => true, isDirectory: () => false, isSymbolicLink: () => entry.symlink, dev: 1n, ino: entry.ino, size: entry.size, mtimeNs: entry.mtimeNs, ctimeNs: entry.ctimeNs, mode: 0o100600n, nlink: entry.nlink } as unknown as BigIntStats;
    if (directories.has(key)) return { isFile: () => false, isDirectory: () => true, isSymbolicLink: () => linkedDirectories.has(key) } as unknown as Stats;
    throw Object.assign(Error('Synthetic missing implementation'), { code: 'ENOENT' });
  };
  vi.mocked(fs.lstat).mockImplementation(lstat as unknown as typeof fs.lstat);
  vi.mocked(fs.realpath).mockImplementation((async (filename: unknown) => String(filename)) as unknown as typeof fs.realpath);
  let onRead: (filename: string) => void | Promise<void> = () => undefined;
  vi.mocked(fs.readFile).mockImplementation((async (filename: unknown) => { const entry = files.get(String(filename)); if (!entry) throw Error('Synthetic missing bytes'); const bytes = Buffer.from(entry.bytes); await onRead(String(filename)); return bytes; }) as unknown as typeof fs.readFile);
  let dll = path.join(root, names[0]);
  let projections = [{ name: './projection.js', filename: path.join(root, 'projection.js') }];
  const reader = createCalculationEngineIdentityReader({ dllPath: () => dll, projectionFiles: () => projections });
  return { root, files, names, reader, linkedDirectories, setDll: (value: string) => { dll = value; }, setProjections: (value: typeof projections) => { projections = value; }, onRead: (value: typeof onRead) => { onRead = value; } };
}
afterEach(() => vi.clearAllMocks());

describe('calculation engine identity against synthetic filesystem facts, not actual DLL execution', () => {
  it.each(['./lengthLedger.js','../../shared/pathfinderLengthLedger.js','./directSecondaryStrategy.js','../../shared/pathfinderDirectSecondary.js','./automaticEndpointCandidates.js','./matching.js','./policyJson.js','../../shared/pathfinderPurposePolicy.js','../../shared/pathfinderPreparation.js','../../shared/pathfinderCapacity.js','../../shared/pathfinderGeometryTrace.js','../../shared/pathfinderEndpointBindings.js','../../viewer-runtime/equipment-names.mjs','../../viewer-runtime/display-visibility.mjs','../../viewer-runtime/preparation-input.mjs','./contracts.js','./preparationUnionTask.js','../../shared/preparationMerge.js','../../viewer-runtime/pathfinder.mjs','../../viewer-runtime/model-capture.mjs'])('pins the actual %s validator and changes identity for its sole replacement', async name=>{
    expect(calculationProjectionFiles().map(file=>file.name)).toContain(name);
    const f=fixture(),filename=path.join(f.root,'ledger-validator.js');
    f.files.set(filename,{bytes:Buffer.from('ledger-validator-original'),size:25n,ino:50n,mtimeNs:10n,ctimeNs:20n,nlink:1n,symlink:false});
    const entry=f.files.get(filename)!;entry.size=BigInt(entry.bytes.length);
    f.setProjections([{name,filename}]);const before=await f.reader.read();
    entry.bytes=Buffer.from('ledger-validator-replaced');entry.size=BigInt(entry.bytes.length);entry.ino++;
    const after=await f.reader.read({force:true});
    expect(after.derivationSha256).not.toBe(before.derivationSha256);expect(after.contentSha256).not.toBe(before.contentSha256);
    expect(after.runnerSha256).toBe(before.runnerSha256);expect(after.coreModuleSha256).toBe(before.coreModuleSha256);
  });
  it('hashes exactly four module byte sequences and the named projection group', async () => {
    const f = fixture(), value = await f.reader.read();
    expect(value.runnerSha256).toBe(sha(f.files.get(path.join(f.root, f.names[0]))!.bytes));
    expect(value.modelModuleSha256).toBe(sha(f.files.get(path.join(f.root, f.names[1]))!.bytes));
    expect(value.coreModuleSha256).toBe(sha(f.files.get(path.join(f.root, f.names[2]))!.bytes));
    expect(value.adapterModuleSha256).toBe(sha(f.files.get(path.join(f.root, f.names[3]))!.bytes));
    const projected = f.files.get(path.join(f.root, 'projection.js'))!.bytes;
    expect(value.derivationSha256).toBe(sha(Buffer.concat([Buffer.from('./projection.js\n' + projected.length + '\n'), projected, Buffer.from('\n')])));
    expect(verifyEngineIdentity(value, sha)).toBe(true);
    expect(value.policyVersions.directSecondary).toBe('nearest-eligible-tray-or.v1');
    expect(calculationProjectionFiles().length).toBeLessThanOrEqual(32);
    expect(fs.readFile).toHaveBeenCalledTimes(5);
  });
  it.each(['PathFinder.ModelRunner.dll', 'PathFinder.Model.dll', 'PathFinder.Core.dll', 'PathFinder.Adapter.dll', 'projection.js'])('changes the exact identity when %s bytes change under the same version label', async name => {
    const f = fixture(), first = await f.reader.read(), entry = f.files.get(path.join(f.root, name))!;
    entry.bytes = Buffer.from('replacement'); entry.size = BigInt(entry.bytes.length); entry.ino += 10n;
    const next = await f.reader.read();
    expect(next.version).toBe(first.version);
    expect(next.contentSha256).not.toBe(first.contentSha256);
    expect(verifyEngineIdentity(next, sha)).toBe(true);
  });
  it('reuses only a matching metadata signature and force rehashes an otherwise invisible same-size change', async () => {
    const f = fixture(), first = await f.reader.read();
    await f.reader.read(); expect(fs.readFile).toHaveBeenCalledTimes(5);
    const entry = f.files.get(path.join(f.root, 'PathFinder.Core.dll'))!;
    entry.bytes = Buffer.from('changed-002');
    expect(entry.bytes.length).toBe(Number(entry.size));
    expect((await f.reader.read()).contentSha256).toBe(first.contentSha256);
    const forced = await f.reader.read({ force: true });
    expect(fs.readFile).toHaveBeenCalledTimes(10);
    expect(forced.coreModuleSha256).not.toBe(first.coreModuleSha256);
    expect(forced.contentSha256).not.toBe(first.contentSha256);
  });
  it('does not allow a consumer to poison cached top-level or nested identity fields', async () => {
    const f = fixture(), first = await f.reader.read(), original = structuredClone(first);
    try { first.runnerSha256 = 'f'.repeat(64); } catch { /* A frozen return is also acceptable. */ }
    try { (first.policyVersions as Record<string, string>).numeric = 'tampered.v9'; } catch { /* A frozen nested return is also acceptable. */ }
    const next = await f.reader.read(); expect(next).toEqual(original); expect(verifyEngineIdentity(next, sha)).toBe(true);
  });
  it('forced admission cannot inherit a weaker in-flight nonforced lookup', async () => {
    const f = fixture(); let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
    let once = false; f.onRead(async () => { if (!once) { once = true; entered(); await gate; } });
    const ordinary = f.reader.read(); await started;
    const forced = f.reader.read({ force: true }); release();
    const [a, b] = await Promise.all([ordinary, forced]); expect(a).toEqual(b); expect(fs.readFile).toHaveBeenCalledTimes(10);
  });
  it.each(['file-symlink', 'hardlink', 'parent-symlink', 'noncanonical-parent'] as const)('refuses %s instead of redefining implementation ownership', async kind => {
    const f = fixture(), filename = path.join(f.root, f.names[0]);
    if (kind === 'file-symlink') f.files.get(filename)!.symlink = true;
    if (kind === 'hardlink') f.files.get(filename)!.nlink = 2n;
    if (kind === 'parent-symlink') f.linkedDirectories.add(f.root);
    if (kind === 'noncanonical-parent') vi.mocked(fs.realpath).mockImplementation((async (value: unknown) => String(value) === f.root ? path.join(f.root, 'different') : String(value)) as unknown as typeof fs.realpath);
    await expect(f.reader.read()).rejects.toMatchObject({ code: 'CALCULATION_ENGINE_PATH' }); expect(fs.readFile).not.toHaveBeenCalled();
  });
  it.each([0n, 64n * 1024n ** 2n + 1n])('rejects unsupported module size %s before a byte read', async size => {
    const f = fixture(); f.files.get(path.join(f.root, f.names[0]))!.size = size;
    await expect(f.reader.read()).rejects.toMatchObject({ code: 'CALCULATION_ENGINE_PATH' }); expect(fs.readFile).not.toHaveBeenCalled();
  });
  it('bounds projection bytes separately from module bytes', async () => {
    const f = fixture(); f.files.get(path.join(f.root, 'projection.js'))!.size = 4n * 1024n ** 2n + 1n;
    await expect(f.reader.read()).rejects.toMatchObject({ code: 'CALCULATION_ENGINE_PATH' }); expect(fs.readFile).not.toHaveBeenCalled();
  });
  it('refuses a changed size or inode across its before/read/after fence', async () => {
    const f = fixture(); f.onRead(filename => { if (filename.endsWith('PathFinder.Core.dll')) f.files.get(filename)!.ino += 1n; });
    await expect(f.reader.read()).rejects.toMatchObject({ code: 'CALCULATION_ENGINE_CHANGED' });
    const g = fixture(); g.files.get(path.join(g.root, 'PathFinder.Core.dll'))!.bytes = Buffer.from('short');
    await expect(g.reader.read()).rejects.toMatchObject({ code: 'CALCULATION_ENGINE_CHANGED' });
  });
  it('rejects relative paths, wrong runner basenames and an empty projection allowlist', async () => {
    const f = fixture(); f.setDll('PathFinder.ModelRunner.dll'); await expect(f.reader.read()).rejects.toMatchObject({ code: 'CALCULATION_ENGINE_UNAVAILABLE' });
    f.setDll(path.join(f.root, 'Different.dll')); await expect(f.reader.read()).rejects.toMatchObject({ code: 'CALCULATION_ENGINE_UNAVAILABLE' });
    f.setDll(path.join(f.root, f.names[0])); f.setProjections([]); await expect(f.reader.read()).rejects.toMatchObject({ code: 'CALCULATION_ENGINE_PROJECTION' });
  });
  it('does not accept duplicate or trailing-newline projection identity labels', async () => {
    const f = fixture(), projection = { name: './projection.js', filename: path.join(f.root, 'projection.js') };
    f.setProjections([projection, projection]); await expect(f.reader.read()).rejects.toMatchObject({ code: 'CALCULATION_ENGINE_PROJECTION' });
    f.setProjections([{ ...projection, name: './projection.js\n' }]); await expect(f.reader.read()).rejects.toMatchObject({ code: 'CALCULATION_ENGINE_PROJECTION' });
  });
});
