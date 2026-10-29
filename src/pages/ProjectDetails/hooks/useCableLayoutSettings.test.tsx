import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { updateProject, type Project } from '@/api/client';
import { useCableLayoutSettings } from './useCableLayoutSettings';

vi.mock('@/api/client', async importOriginal => ({ ...await importOriginal<typeof import('@/api/client')>(), updateProject: vi.fn() }));
const project: Project = { id: '11111111-1111-4111-8111-111111111111', projectNumber: 'CAP', name: 'Capacity project', customer: 'Fixture', manager: null, description: null,
  connectionGap: 1, secondaryTrayLength: 7, endConnectionLength: 5, additionalBendingPercent: 10, supportDistance: null, supportWeight: null, trayLoadSafetyFactor: null,
  supportDistanceOverrides: {}, trayPurposeTemplates: {}, cableLayout: { cableSpacing: 2, considerBundleSpacingAsFree: true, minFreeSpacePercent: 42,
    maxFreeSpacePercent: 80, mv: null, power: null, vfd: null, control: null, customBundleRanges: null },
  createdAt: '2026-10-24T00:00:00Z', updatedAt: '2026-10-24T00:00:00Z' };
const reloadProject = vi.fn(async () => {}), showToast = vi.fn();
const settings = (value = project, isAdmin = true, token: string | null = 'token') => ({ project: value, isAdmin, token, reloadProject, showToast });
beforeEach(() => { vi.clearAllMocks(); vi.mocked(updateProject).mockResolvedValue({ project }); });

describe('project automatic free-space rerouting checkbox', () => {
  it('defaults old projects to disabled and persists only its flag, preserving other settings', async () => {
    const { result, rerender } = renderHook(({ value }) => useCableLayoutSettings(settings(value)), { initialProps: { value: project } });
    expect(result.current.cableSpacingField.autoRerouteForFreeSpace).toBe(false);
    await act(() => result.current.cableSpacingField.onToggleAutoRerouteForFreeSpace(true));
    expect(updateProject).toHaveBeenCalledExactlyOnceWith('token', project.id, { cableLayout: { autoRerouteForFreeSpace: true } });
    expect(reloadProject).toHaveBeenCalledOnce(); expect(result.current.cableSpacingField.autoRerouteForFreeSpace).toBe(true);
    rerender({ value: { ...project, cableLayout: { ...project.cableLayout!, autoRerouteForFreeSpace: true } } });
    expect(result.current.cableSpacingField.autoRerouteForFreeSpace).toBe(true);
    expect(result.current.cableSpacingField.minFreeSpaceCurrent).toBe(42);
    expect(project.cableLayout).toMatchObject({ cableSpacing: 2, minFreeSpacePercent: 42, maxFreeSpacePercent: 80, considerBundleSpacingAsFree: true });
  });
  it('requires a saved minimum before enabling but allows disabling invalid old settings', async () => {
    const missing = { ...project, cableLayout: { ...project.cableLayout!, minFreeSpacePercent: null } };
    const { result, rerender } = renderHook(({ value }) => useCableLayoutSettings(settings(value)), { initialProps: { value: missing } });
    await act(() => result.current.cableSpacingField.onToggleAutoRerouteForFreeSpace(true));
    expect(updateProject).not.toHaveBeenCalled(); expect(result.current.cableSpacingField.error).toMatch(/Set and save the minimum/);
    rerender({ value: { ...missing, cableLayout: { ...missing.cableLayout, autoRerouteForFreeSpace: true } } });
    await act(() => result.current.cableSpacingField.onToggleAutoRerouteForFreeSpace(false));
    expect(updateProject).toHaveBeenCalledExactlyOnceWith('token', project.id, { cableLayout: { autoRerouteForFreeSpace: false } });
  });
  it.each([{ admin: false, token: 'token' }, { admin: true, token: null }])('enforces edit access: %j', async ({ admin, token }) => {
    const { result } = renderHook(() => useCableLayoutSettings(settings(project, admin, token)));
    await act(() => result.current.cableSpacingField.onToggleAutoRerouteForFreeSpace(true));
    expect(updateProject).not.toHaveBeenCalled(); expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ intent: 'error' }));
  });
  it('retains the prior checkbox value and reports a failed save', async () => {
    vi.mocked(updateProject).mockRejectedValue(new Error('Synthetic refusal'));
    const { result } = renderHook(() => useCableLayoutSettings(settings()));
    await act(() => result.current.cableSpacingField.onToggleAutoRerouteForFreeSpace(true));
    expect(result.current.cableSpacingField.autoRerouteForFreeSpace).toBe(false);
    expect(result.current.cableSpacingField.saving).toBe(false);
    expect(result.current.cableSpacingField.error).toBe('Failed to update automatic rerouting.');
    expect(reloadProject).not.toHaveBeenCalled();
  });
  it('shows a pending save immediately and does not submit duplicate toggles', async () => {
    let complete!: (value: { project: Project }) => void;
    vi.mocked(updateProject).mockReturnValue(new Promise(resolve => { complete = resolve; }));
    const { result } = renderHook(() => useCableLayoutSettings(settings()));
    let pending!: Promise<void>;
    act(() => { pending = result.current.cableSpacingField.onToggleAutoRerouteForFreeSpace(true); });
    expect(result.current.cableSpacingField.saving).toBe(true);
    await act(() => result.current.cableSpacingField.onToggleAutoRerouteForFreeSpace(true));
    expect(updateProject).toHaveBeenCalledOnce();
    await act(async () => { complete({ project }); await pending; });
    expect(result.current.cableSpacingField.saving).toBe(false);
  });
  it('does not overwrite a different project when an earlier save fails late', async () => {
    let reject!: (reason: Error) => void;
    vi.mocked(updateProject).mockReturnValue(new Promise((_resolve, fail) => { reject = fail; }));
    const { result, rerender } = renderHook(({ value }) => useCableLayoutSettings(settings(value)), { initialProps: { value: project } });
    let pending!: Promise<void>;
    act(() => { pending = result.current.cableSpacingField.onToggleAutoRerouteForFreeSpace(true); });
    rerender({ value: { ...project, id: '22222222-2222-4222-8222-222222222222' } });
    expect(result.current.cableSpacingField.autoRerouteForFreeSpace).toBe(false);
    await act(async () => { reject(new Error('Old project request')); await pending; });
    expect(result.current.cableSpacingField.error).toBeNull(); expect(result.current.cableSpacingField.saving).toBe(false);
    expect(showToast).not.toHaveBeenCalled(); expect(reloadProject).not.toHaveBeenCalled();
  });
  it('requires disabling automatic rerouting before removing its minimum', async () => {
    const enabled = { ...project, cableLayout: { ...project.cableLayout!, autoRerouteForFreeSpace: true } };
    const { result } = renderHook(() => useCableLayoutSettings(settings(enabled)));
    act(() => result.current.cableSpacingField.onMinFreeSpaceChange(''));
    await act(() => result.current.cableSpacingField.onSave());
    expect(updateProject).not.toHaveBeenCalled(); expect(result.current.cableSpacingField.minFreeSpaceError).toMatch(/turn off automatic rerouting/);
  });
});
