// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const io = vi.hoisted(() => ({ readdir: vi.fn(), readFile: vi.fn() }));
vi.mock('node:fs/promises', () => ({ default: io }));
import { residentBytes, getEngineRssFailureDetail, preparationEngineObservation, retainPreparationEngineObservation } from './engineResources.js';
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
beforeEach(() => { vi.resetAllMocks(); Object.defineProperty(process, 'platform', { ...platform, value: 'linux' }); });
afterEach(() => Object.defineProperty(process, 'platform', platform));
const stat = (id: number, parent: number) => id + ' (dotnet) S ' + parent + ' 0 0 0';
async function refused(promise: Promise<unknown>) {
  let error: unknown;
  try { await promise; } catch (cause) { error = cause; }
  expect(error).toBeDefined(); return error;
}
describe('preparation process-tree soft RSS observations', () => {
  it('counts only the owned process and descendants across multiple generations', async () => {
    io.readdir.mockResolvedValue(['1', '20', '21', '22', '99', 'self']);
    io.readFile.mockImplementation(async (name: string) => {
      const id = Number(name.split('/')[2]);
      if (name.endsWith('/stat')) return stat(id, id === 21 ? 20 : id === 22 ? 21 : 1);
      return 'Name: dotnet\nVmRSS: ' + ({ 20: 100, 21: 50, 22: 25 } as Record<number, number>)[id] + ' kB\n';
    });
    await expect(residentBytes(20)).resolves.toBe(175 * 1024);
    expect(io.readFile.mock.calls.some(([name]) => name === '/proc/99/status')).toBe(false);
  });
  it('tolerates disappearing unrelated processes but refuses an unavailable root sample', async () => {
    io.readdir.mockResolvedValue(['20', '99']);
    io.readFile.mockImplementation(async (name: string) => {
      if (name === '/proc/20/stat') return stat(20, 1);
      throw Object.assign(Error('gone'), { code: 'ENOENT' });
    });
    await expect(residentBytes(20)).rejects.toMatchObject({ code: 'ENGINE_RSS_UNAVAILABLE' });
  });
  it('refuses permission failures and unsupported platforms', async () => {
    io.readdir.mockResolvedValue(['20']); io.readFile.mockRejectedValue(Object.assign(Error('denied'), { code: 'EACCES' }));
    await expect(residentBytes(20)).rejects.toMatchObject({ code: 'ENGINE_RSS_UNAVAILABLE' });
    Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
    await expect(residentBytes(20)).rejects.toMatchObject({ code: 'ENGINE_RSS_UNAVAILABLE' });
  });
  it('records unsupported platform without attempting proc reads or changing its refusal', async () => {
    Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
    const error = await refused(residentBytes(20));
    expect(error).toMatchObject({ code: 'ENGINE_RSS_UNAVAILABLE', status: 502 });
    expect(getEngineRssFailureDetail(error)).toEqual({ stage: 'platform', errno: null, role: null, rootStatusPresent: false, rootState: null, enumeratedCount: 0, retainedCount: 0, statusReadCount: 0 });
    expect(io.readdir).not.toHaveBeenCalled(); expect(io.readFile).not.toHaveBeenCalled();
  });
  it('annotates proc-list failure internally while preserving the exact original rejection', async () => {
    const original = Object.assign(Error('private source path and environment must not enter metadata'), { code: 'EACCES', path: '/private/input' });
    io.readdir.mockRejectedValue(original);
    const error = await refused(residentBytes(20)), detail = getEngineRssFailureDetail(error);
    expect(error).toBe(original); expect(detail).toEqual({ stage: 'proc-list', errno: 'EACCES', role: null, rootStatusPresent: false, rootState: null, enumeratedCount: 0, retainedCount: 0, statusReadCount: 0 });
    expect(Object.isFrozen(detail)).toBe(true); expect(Object.hasOwn(original, 'rssFailure')).toBe(false);
    expect(JSON.stringify(detail)).not.toMatch(/private|input|environment|path|pid/i);
  });
  it.each([true, false])('records proc-stat refusal with root relation known=%s and sanitizes errno', async root => {
    io.readdir.mockResolvedValue(root ? ['20'] : ['99', '20']);
    io.readFile.mockRejectedValue(Object.assign(Error('private command and filename'), { code: root ? 'EPERM' : 'private-code' }));
    const error = await refused(residentBytes(20)), detail = getEngineRssFailureDetail(error);
    expect(error).toMatchObject({ code: 'ENGINE_RSS_UNAVAILABLE', status: 502 });
    expect(detail).toEqual({ stage: 'proc-stat', errno: root ? 'EPERM' : 'OTHER', role: root ? 'root' : null, rootStatusPresent: false, rootState: null, enumeratedCount: 1, retainedCount: 0, statusReadCount: 0 });
    expect(JSON.stringify(detail)).not.toMatch(/private|command|filename|20|99/);
  });
  it.each([true, false])('records proc-status refusal for root=%s after the proven subtree is built', async root => {
    io.readdir.mockResolvedValue(['20', '21']);
    io.readFile.mockImplementation(async (name: string) => {
      const id = Number(name.split('/')[2]);
      if (name.endsWith('/stat')) return stat(id, id === 21 ? 20 : 1);
      if (id === (root ? 20 : 21)) throw Object.assign(Error('private status content'), { code: 'EIO' });
      return 'Name: private\nState:\tS (sleeping)\nVmRSS: 100 kB\n';
    });
    const error = await refused(residentBytes(20));
    expect(error).toMatchObject({ code: 'ENGINE_RSS_UNAVAILABLE', status: 502 });
    expect(getEngineRssFailureDetail(error)).toEqual({ stage: 'proc-status', errno: 'EIO', role: root ? 'root' : 'descendant', rootStatusPresent: !root, rootState: root ? null : 'S', enumeratedCount: 2, retainedCount: 2, statusReadCount: root ? 0 : 1 });
  });
  it.each(['gone', 'zombie', 'unknown-state'] as const)('retains unavailable-root refusal and records %s observation without inventing RSS', async kind => {
    io.readdir.mockResolvedValue(['20']);
    io.readFile.mockImplementation(async (name: string) => {
      if (name.endsWith('/stat')) return stat(20, 1);
      if (kind === 'gone') throw Object.assign(Error('gone'), { code: 'ENOENT' });
      return 'Name: private\nState:\t' + (kind === 'zombie' ? 'Z (zombie)' : 'Q (private state)') + '\n';
    });
    const error = await refused(residentBytes(20));
    expect(error).toMatchObject({ code: 'ENGINE_RSS_UNAVAILABLE', status: 502 });
    expect(getEngineRssFailureDetail(error)).toEqual({ stage: 'root-rss', errno: kind === 'gone' ? 'ENOENT' : null, role: 'root', rootStatusPresent: kind !== 'gone', rootState: kind === 'zombie' ? 'Z' : null, enumeratedCount: 1, retainedCount: 1, statusReadCount: kind === 'gone' ? 0 : 1 });
  });
  it('preserves unsafe-total refusal and the successful descendant disappearance tolerance', async () => {
    io.readdir.mockResolvedValue(['20', '21']);
    io.readFile.mockImplementation(async (name: string) => {
      const id = Number(name.split('/')[2]);
      if (name.endsWith('/stat')) return stat(id, id === 21 ? 20 : 1);
      if (id === 21) throw Object.assign(Error('gone'), { code: 'ESRCH' });
      return 'State:\tR (running)\nVmRSS: 9007199254740992 kB\n';
    });
    const error = await refused(residentBytes(20));
    expect(error).toMatchObject({ code: 'ENGINE_RSS_UNAVAILABLE', status: 502 });
    expect(getEngineRssFailureDetail(error)).toEqual({ stage: 'unsafe-total', errno: null, role: 'root', rootStatusPresent: true, rootState: 'R', enumeratedCount: 2, retainedCount: 2, statusReadCount: 1 });
    io.readFile.mockImplementation(async (name: string) => {
      const id = Number(name.split('/')[2]);
      if (name.endsWith('/stat')) return stat(id, id === 21 ? 20 : 1);
      if (id === 21) throw Object.assign(Error('gone'), { code: 'ESRCH' });
      return 'State:\tR (running)\nVmRSS: 100 kB\n';
    });
    await expect(residentBytes(20)).resolves.toBe(100 * 1024);
  });
  it('does not trust copied diagnostics or allow metadata extraction to replace a proc-list rejection', async () => {
    expect(getEngineRssFailureDetail(Object.assign(Error('foreign'), { rssFailure: { stage: 'root-rss' } }))).toBeNull();
    expect(getEngineRssFailureDetail(null)).toBeNull(); expect(getEngineRssFailureDetail('secret')).toBeNull();
    const original = Object.defineProperty(Error('original'), 'code', { get() { throw Error('observer getter failed'); } });
    io.readdir.mockRejectedValue(original);
    expect(await refused(residentBytes(20))).toBe(original); expect(getEngineRssFailureDetail(original)?.errno).toBe('OTHER');
  });
  it('retains only sixteen immutable non-exact observations without business data', () => {
    const value = { mode: 'oneshot' as const, thresholdBytes: 2 * 1024 ** 3, intervalMilliseconds: 100,
      observedMaximumBytes: 100, samples: 3, wallMilliseconds: 200, exactPeak: false as const, outcome: 'completed' as const };
    for (let i = 0; i < 17; i++) retainPreparationEngineObservation('resource-test-' + i, value);
    value.observedMaximumBytes = 999;
    expect(preparationEngineObservation('resource-test-0')).toBeNull();
    expect(preparationEngineObservation('resource-test-16')?.observedMaximumBytes).toBe(100);
    expect(Object.isFrozen(preparationEngineObservation('resource-test-16'))).toBe(true);
  });
  it('detaches and freezes optional refusal and lifecycle metadata without changing legacy observations', async () => {
    io.readdir.mockResolvedValue(['20']); io.readFile.mockRejectedValue(Object.assign(Error('private'), { code: 'EACCES' }));
    const error = await refused(residentBytes(20)), detail = getEngineRssFailureDetail(error)!;
    const value = { mode: 'oneshot' as const, thresholdBytes: 2 * 1024 ** 3, intervalMilliseconds: 100,
      observedMaximumBytes: 100, samples: 3, wallMilliseconds: 200, exactPeak: false as const, outcome: 'refused' as const,
      rssFailure: { ...detail }, lifecycle: { refusal: { elapsedMilliseconds: 190, exitCode: null as number | null, signalCode: null as string | null }, exit: null, close: { elapsedMilliseconds: 200, exitCode: 1, signalCode: null } } };
    retainPreparationEngineObservation('resource-optional-metadata', value);
    value.rssFailure.enumeratedCount = 999; value.lifecycle.refusal.exitCode = 99; value.lifecycle.close.elapsedMilliseconds = 999;
    const saved = preparationEngineObservation('resource-optional-metadata')!;
    expect(saved.rssFailure?.enumeratedCount).toBe(1); expect(saved.lifecycle?.refusal?.exitCode).toBeNull(); expect(saved.lifecycle?.close.elapsedMilliseconds).toBe(200);
    expect(Object.isFrozen(saved.rssFailure)).toBe(true); expect(Object.isFrozen(saved.lifecycle)).toBe(true); expect(Object.isFrozen(saved.lifecycle?.refusal)).toBe(true); expect(Object.isFrozen(saved.lifecycle?.close)).toBe(true);
    expect(JSON.stringify(saved)).not.toMatch(/private|command|filename|environment/);
  });
});
