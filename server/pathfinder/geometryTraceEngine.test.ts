// @vitest-environment node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Stats } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { geometryTraceRuntimeFingerprint } from './geometryTraceEngine.js';

vi.mock('node:fs/promises', () => ({ default: { lstat: vi.fn(), realpath: vi.fn(), readFile: vi.fn() } }));

/** Synthetic filesystem facts only: no implementation file is written or replaced. */
function fixture() {
  vi.clearAllMocks();
  const root = path.resolve('pathfinder-engine/.scratch/mock-only-geometry-trace-identity');
  const files = new Map<string, Buffer>();
  for (const name of ['PathFinder.ModelRunner.dll', 'PathFinder.Model.dll', 'PathFinder.Core.dll', 'PathFinder.Adapter.dll']) files.set(path.join(root, name), Buffer.from('synthetic module ' + name));
  const derivations = ['./geometryTraceEngine.js', './geometryTraceBuilder.js', './geometryTraceRepository.js', './geometryTraceStorage.js', './geometryTraceWorker.js', './geometryTraceThread.js', './preparationStorage.js', './contracts.js', './matching.js', './policyJson.js', '../../shared/pathfinderGeometryTrace.js', '../../shared/pathfinderPreparation.js', '../../shared/pathfinderCapacity.js', '../../shared/preparationMerge.js', '../../shared/pathfinderPurposePolicy.js', '../../viewer-runtime/capture-evidence.mjs'];
  const directories = new Set<string>();
  for (const name of derivations) files.set(fileURLToPath(new URL(name, import.meta.url)), Buffer.from('synthetic derivation ' + name));
  for (const filename of files.keys()) for (let current = path.dirname(filename); ; current = path.dirname(current)) { directories.add(current); if (path.dirname(current) === current) break; }
  vi.mocked(fs.lstat).mockImplementation((async (filename: unknown) => {
    const value = files.get(String(filename));
    return { isFile: () => value !== undefined, isDirectory: () => directories.has(String(filename)), isSymbolicLink: () => false, nlink: 1, size: value?.length ?? 0 } as unknown as Stats;
  }) as unknown as typeof fs.lstat);
  vi.mocked(fs.realpath).mockImplementation((async (filename: unknown) => String(filename)) as unknown as typeof fs.realpath);
  vi.mocked(fs.readFile).mockImplementation((async (filename: unknown) => {
    const bytes = files.get(String(filename)); if (!bytes) throw Error('Missing synthetic implementation'); return Buffer.from(bytes);
  }) as unknown as typeof fs.readFile);
  vi.stubEnv('PF_ENGINE_DLL', path.join(root, 'PathFinder.ModelRunner.dll'));
  const capacity = fileURLToPath(new URL('../../shared/pathfinderCapacity.js', import.meta.url));
  return { files, capacity };
}

afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });

describe('geometry trace fingerprint capacity dependency', () => {
  it('changes derivation identity when only the capacity helper changes under identical engine modules', async () => {
    const f = fixture(), before = await geometryTraceRuntimeFingerprint();
    expect(fs.readFile).toHaveBeenCalledWith(f.capacity);
    f.files.set(f.capacity, Buffer.from('replacement capacity helper with distinct bounded values'));
    const after = await geometryTraceRuntimeFingerprint();
    expect(after.derivationSha256).not.toBe(before.derivationSha256);
    const { derivationSha256: _before, ...beforeModules } = before;
    const { derivationSha256: _after, ...afterModules } = after;
    expect(afterModules).toEqual(beforeModules);
  });

  it('refuses a missing capacity helper rather than hashing an incomplete implementation', async () => {
    const f = fixture(); f.files.delete(f.capacity);
    await expect(geometryTraceRuntimeFingerprint()).rejects.toMatchObject({ code: 'GEOMETRY_TRACE_IMPLEMENTATION_PATH', status: 503 });
  });
});
