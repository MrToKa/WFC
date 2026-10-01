import { useEffect, useState } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tray } from '@/api/client';
import { useTrefoilClampSettings } from './useTrefoilClampSettings';

const mocks = vi.hoisted(() => ({ updateTray: vi.fn() }));
vi.mock('@/api/client', () => ({ updateTray: mocks.updateTray }));

const tray = (id: string, settings: Partial<Tray> = {}): Tray => ({
  id,
  projectId: 'project',
  name: id,
  type: null,
  purpose: null,
  widthMm: null,
  heightMm: null,
  lengthMm: 3000,
  includeGroundingCable: false,
  groundingCableTypeId: null,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  ...settings,
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

type SettingsProps = {
  selectedTray: Tray | null;
  projectId: string | undefined;
  token: string | null;
};

const renderSettings = (selectedTray: Tray | null, props: Partial<SettingsProps> = {}) => {
  const showToast = vi.fn();
  const otherTray = tray('other');
  const initialTrays = selectedTray ? [selectedTray, otherTray] : [otherTray];
  const hook = renderHook(
    ({ selectedTray, projectId, token }: SettingsProps) => {
      const [activeTray, setTray] = useState(selectedTray);
      const [trays, setTrays] = useState(initialTrays);
      useEffect(() => setTray(selectedTray), [selectedTray]);
      const settings = useTrefoilClampSettings(
        projectId,
        activeTray,
        token,
        showToast,
        setTray,
        setTrays,
      );
      return { ...settings, tray: activeTray, trays };
    },
    { initialProps: { selectedTray, projectId: 'project', token: 'token', ...props } },
  );
  return { ...hook, showToast, otherTray, initialTrays };
};

beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('trefoil clamp settings', () => {
  it('defaults existing trays to disabled and 600 mm, and restores saved settings after navigation', () => {
    const { result, rerender } = renderSettings(tray('legacy'));
    expect(result.current.useTrefoilClamps).toBe(false);
    expect(result.current.trefoilClampSpacingMm).toBe(600);
    expect(result.current.trefoilClampSettingsSaving).toBe(false);
    rerender({
      selectedTray: tray('saved', { useTrefoilClamps: true, trefoilClampSpacingMm: 450 }),
      projectId: 'project',
      token: 'token',
    });
    expect(result.current.useTrefoilClamps).toBe(true);
    expect(result.current.trefoilClampSpacingMm).toBe(450);
    expect(mocks.updateTray).not.toHaveBeenCalled();
  });

  it('optimistically toggles clamps, PATCHes only the checkbox, and replaces saved tray data', async () => {
    const previous = tray('first', { useTrefoilClamps: false, trefoilClampSpacingMm: 600 });
    const saved = { ...previous, useTrefoilClamps: true, updatedAt: '2026-10-01' };
    const pending = deferred<{ tray: Tray }>();
    mocks.updateTray.mockReturnValueOnce(pending.promise);
    const { result, otherTray } = renderSettings(previous);
    let save!: Promise<void>;
    act(() => {
      save = result.current.saveTrefoilClampSettings({ useTrefoilClamps: true });
    });
    expect(result.current.useTrefoilClamps).toBe(true);
    expect(result.current.trefoilClampSettingsSaving).toBe(true);
    expect(mocks.updateTray).toHaveBeenCalledExactlyOnceWith('token', 'project', 'first', {
      useTrefoilClamps: true,
    });
    await act(async () => {
      pending.resolve({ tray: saved });
      await save;
    });
    expect(result.current.tray).toEqual(saved);
    expect(result.current.trays).toEqual([saved, otherTray]);
    expect(result.current.trefoilClampSettingsSaving).toBe(false);
  });

  it('PATCHes only spacing and preserves an enabled checkbox throughout the save', async () => {
    const previous = tray('first', { useTrefoilClamps: true, trefoilClampSpacingMm: 600 });
    const saved = { ...previous, trefoilClampSpacingMm: 850 };
    const pending = deferred<{ tray: Tray }>();
    mocks.updateTray.mockReturnValueOnce(pending.promise);
    const { result } = renderSettings(previous);
    let save!: Promise<void>;
    act(() => {
      save = result.current.saveTrefoilClampSettings({ trefoilClampSpacingMm: 850 });
    });
    expect(result.current.useTrefoilClamps).toBe(true);
    expect(result.current.trefoilClampSpacingMm).toBe(850);
    expect(mocks.updateTray).toHaveBeenCalledExactlyOnceWith('token', 'project', 'first', {
      trefoilClampSpacingMm: 850,
    });
    await act(async () => {
      pending.resolve({ tray: saved });
      await save;
    });
    expect(result.current.useTrefoilClamps).toBe(true);
    expect(result.current.trefoilClampSpacingMm).toBe(850);
  });

  it('reverts optimistic settings and reports failure, then permits a retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const previous = tray('first', { useTrefoilClamps: false, trefoilClampSpacingMm: 600 });
    const pending = deferred<{ tray: Tray }>();
    mocks.updateTray.mockReturnValueOnce(pending.promise);
    const { result, initialTrays, showToast } = renderSettings(previous);
    let save!: Promise<void>;
    act(() => {
      save = result.current.saveTrefoilClampSettings({ useTrefoilClamps: true });
    });
    expect(result.current.useTrefoilClamps).toBe(true);
    await act(async () => {
      pending.reject(new Error('Network unavailable'));
      await save;
    });
    expect(result.current.tray).toEqual(previous);
    expect(result.current.trays).toEqual(initialTrays);
    expect(result.current.useTrefoilClamps).toBe(false);
    expect(result.current.trefoilClampSettingsSaving).toBe(false);
    expect(showToast).toHaveBeenCalledExactlyOnceWith({
      intent: 'error',
      title: 'Failed to save trefoil clamp settings',
      body: 'Please try again.',
    });
    mocks.updateTray.mockResolvedValueOnce({ tray: { ...previous, useTrefoilClamps: true } });
    await act(async () => result.current.saveTrefoilClampSettings({ useTrefoilClamps: true }));
    expect(mocks.updateTray).toHaveBeenCalledTimes(2);
    expect(result.current.useTrefoilClamps).toBe(true);
  });

  it('prevents overlapping submissions before React renders the saving state', async () => {
    const previous = tray('first', { useTrefoilClamps: false, trefoilClampSpacingMm: 600 });
    const saved = { ...previous, useTrefoilClamps: true };
    const pending = deferred<{ tray: Tray }>();
    mocks.updateTray.mockReturnValueOnce(pending.promise);
    const { result } = renderSettings(previous);
    let firstSave!: Promise<void>;
    let duplicateSave!: Promise<void>;
    act(() => {
      firstSave = result.current.saveTrefoilClampSettings({ useTrefoilClamps: true });
      duplicateSave = result.current.saveTrefoilClampSettings({ trefoilClampSpacingMm: 900 });
    });
    expect(mocks.updateTray).toHaveBeenCalledTimes(1);
    expect(result.current.trefoilClampSpacingMm).toBe(600);
    await act(async () => {
      pending.resolve({ tray: saved });
      await Promise.all([firstSave, duplicateSave]);
    });
    expect(result.current.tray).toEqual(saved);
    expect(result.current.trefoilClampSettingsSaving).toBe(false);
  });

  it.each([
    { name: 'token', props: { token: null } },
    { name: 'project', props: { projectId: undefined } },
    { name: 'tray', props: { selectedTray: null } },
  ])('does not mutate state or request a save without a $name', async ({ props }) => {
    const { result, showToast, initialTrays } = renderSettings(tray('first'), props);
    const before = result.current.tray;
    await act(async () => result.current.saveTrefoilClampSettings({ useTrefoilClamps: true }));
    expect(mocks.updateTray).not.toHaveBeenCalled();
    expect(result.current.tray).toEqual(before);
    expect(result.current.trays).toEqual(initialTrays);
    expect(result.current.trefoilClampSettingsSaving).toBe(false);
    expect(showToast).not.toHaveBeenCalled();
  });

  it('updates the list after a save finishes but never restores a tray selected before navigation', async () => {
    const previous = tray('first', { useTrefoilClamps: false, trefoilClampSpacingMm: 600 });
    const saved = { ...previous, useTrefoilClamps: true };
    const next = tray('other', { useTrefoilClamps: false, trefoilClampSpacingMm: 900 });
    const pending = deferred<{ tray: Tray }>();
    mocks.updateTray.mockReturnValueOnce(pending.promise);
    const { result, rerender, otherTray } = renderSettings(previous);
    let save!: Promise<void>;
    act(() => {
      save = result.current.saveTrefoilClampSettings({ useTrefoilClamps: true });
    });
    rerender({ selectedTray: next, projectId: 'project', token: 'token' });
    expect(result.current.tray).toEqual(next);
    await act(async () => {
      pending.resolve({ tray: saved });
      await save;
    });
    expect(result.current.tray).toEqual(next);
    expect(result.current.useTrefoilClamps).toBe(false);
    expect(result.current.trefoilClampSpacingMm).toBe(900);
    expect(result.current.trays).toEqual([saved, otherTray]);
    expect(result.current.trefoilClampSettingsSaving).toBe(false);
  });

  it('does not revert the new tray when a previous tray save fails after navigation', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const previous = tray('first', { useTrefoilClamps: false, trefoilClampSpacingMm: 600 });
    const next = tray('other', { useTrefoilClamps: true, trefoilClampSpacingMm: 900 });
    const pending = deferred<{ tray: Tray }>();
    mocks.updateTray.mockReturnValueOnce(pending.promise);
    const { result, rerender, showToast } = renderSettings(previous);
    let save!: Promise<void>;
    act(() => {
      save = result.current.saveTrefoilClampSettings({ useTrefoilClamps: true });
    });
    rerender({ selectedTray: next, projectId: 'project', token: 'token' });
    await act(async () => {
      pending.reject(new Error('Network unavailable'));
      await save;
    });
    expect(result.current.tray).toEqual(next);
    expect(result.current.useTrefoilClamps).toBe(true);
    expect(result.current.trefoilClampSpacingMm).toBe(900);
    expect(result.current.trefoilClampSettingsSaving).toBe(false);
    expect(showToast).toHaveBeenCalledOnce();
  });
});
