// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const io = vi.hoisted(() => ({ readdir: vi.fn(), readFile: vi.fn() }));
vi.mock('node:fs/promises', () => ({ default: io }));
import { residentBytes, preparationEngineObservation, retainPreparationEngineObservation } from './engineResources.js';
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
beforeEach(() => { vi.resetAllMocks(); Object.defineProperty(process, 'platform', { ...platform, value: 'linux' }); });
afterEach(() => Object.defineProperty(process, 'platform', platform));
const stat = (id: number, parent: number) => id + ' (dotnet) S ' + parent + ' 0 0 0';
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
  it('retains only sixteen immutable non-exact observations without business data', () => {
    const value = { mode: 'oneshot' as const, thresholdBytes: 2 * 1024 ** 3, intervalMilliseconds: 100,
      observedMaximumBytes: 100, samples: 3, wallMilliseconds: 200, exactPeak: false as const, outcome: 'completed' as const };
    for (let i = 0; i < 17; i++) retainPreparationEngineObservation('resource-test-' + i, value);
    value.observedMaximumBytes = 999;
    expect(preparationEngineObservation('resource-test-0')).toBeNull();
    expect(preparationEngineObservation('resource-test-16')?.observedMaximumBytes).toBe(100);
    expect(Object.isFrozen(preparationEngineObservation('resource-test-16'))).toBe(true);
  });
});
