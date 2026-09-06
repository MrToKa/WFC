import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project, Tray } from '@/api/client';
import { useProjectDetailsData } from './useProjectDetailsData';
import { useTraysSection } from './useTraysSection';
import { useProjectFilesSection } from './useProjectFilesSection';
import { useTrayData } from '../../TrayDetails/hooks/useTrayData';
import { TRAYS_PER_PAGE } from '../../ProjectDetails.forms';

const mocks = vi.hoisted(() => ({
  project: vi.fn(),
  tray: vi.fn(),
  trays: vi.fn(),
  cables: vi.fn(),
  files: vi.fn(),
  materials: vi.fn(),
  deleteTray: vi.fn(),
}));
vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  fetchProject: mocks.project,
  fetchTray: mocks.tray,
  fetchTrays: mocks.trays,
  fetchCables: mocks.cables,
  fetchProjectFiles: mocks.files,
  fetchAllMaterialTrays: mocks.materials,
  deleteTray: mocks.deleteTray,
}));
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};
const project = (id: string): Project => ({
  id,
  projectNumber: id,
  name: id,
  customer: 'Customer',
  manager: null,
  description: null,
  secondaryTrayLength: null,
  supportDistance: null,
  supportWeight: null,
  trayLoadSafetyFactor: null,
  supportDistanceOverrides: {},
  trayPurposeTemplates: {},
  cableLayout: {
    cableSpacing: null,
    considerBundleSpacingAsFree: null,
    minFreeSpacePercent: null,
    maxFreeSpacePercent: null,
    mv: null,
    power: null,
    vfd: null,
    control: null,
    customBundleRanges: null,
  },
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
});

afterEach(() => vi.restoreAllMocks());
const tray = (id: string, projectId = 'project-1'): Tray => ({
  id,
  projectId,
  name: id,
  type: null,
  purpose: null,
  widthMm: null,
  heightMm: null,
  lengthMm: null,
  includeGroundingCable: false,
  groundingCableTypeId: null,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.project.mockImplementation((id) => Promise.resolve({ project: project(id) }));
  mocks.tray.mockImplementation((projectId, id) => Promise.resolve({ tray: tray(id, projectId) }));
  mocks.trays.mockResolvedValue({ trays: [] });
  mocks.cables.mockResolvedValue({ cables: [] });
  mocks.files.mockResolvedValue({ files: [] });
  mocks.materials.mockResolvedValue({ trays: [] });
});

describe('project data loading', () => {
  it('keeps the current project when an older route request completes later', async () => {
    const pending = deferred<{ project: Project }>();
    mocks.project.mockReturnValueOnce(pending.promise);
    const { result, rerender } = renderHook(({ id }) => useProjectDetailsData({ projectId: id }), {
      initialProps: { id: 'old' },
    });
    rerender({ id: 'new' });
    await waitFor(() => expect(result.current.project?.id).toBe('new'));
    await act(async () => pending.resolve({ project: project('old') }));
    expect(result.current.project?.id).toBe('new');
    expect(result.current.projectLoading).toBe(false);
  });

  it('keeps current trays when an older list request completes later', async () => {
    const pending = deferred<{ trays: Tray[] }>();
    mocks.trays
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue({ trays: [tray('new', 'new')] });
    const { result, rerender } = renderHook(
      ({ id }) =>
        useTraysSection({
          projectId: id,
          project: project(id),
          token: null,
          showToast: vi.fn(),
        }),
      { initialProps: { id: 'old' } },
    );
    rerender({ id: 'new' });
    await waitFor(() => expect(result.current.traysLoading).toBe(false));
    await act(async () => pending.resolve({ trays: [tray('old', 'old')] }));
    expect(result.current.trays.map((item) => item.id)).toEqual(['new']);
  });

  it('keeps a filtered tray page valid after deleting its last matching item', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mocks.deleteTray.mockResolvedValue(undefined);
    const matching = Array.from({ length: TRAYS_PER_PAGE + 1 }, (_, index) =>
      tray(`match-${index}`),
    );
    mocks.trays.mockResolvedValue({
      trays: [
        ...matching,
        ...matching.map((item, index) => ({
          ...item,
          id: `other-${index}`,
          name: `other-${index}`,
        })),
      ],
    });
    const { result } = renderHook(() =>
      useTraysSection({
        projectId: 'project-1',
        project: project('project-1'),
        token: 'token',
        showToast: vi.fn(),
      }),
    );
    await waitFor(() => expect(result.current.traysLoading).toBe(false));
    act(() => result.current.setSearchText('match-'));
    act(() => result.current.goToPage(2));
    const lastMatch = result.current.pagedTrays[0];
    await act(async () => result.current.handleDeleteTray(lastMatch));
    expect(result.current.traysPage).toBe(1);
    expect(result.current.pagedTrays.length).toBeGreaterThan(0);
  });

  it('does not restore private files after sign-out', async () => {
    const pending = deferred<{ files: unknown[] }>();
    mocks.files.mockReturnValueOnce(pending.promise);
    const { result, rerender } = renderHook(
      ({ token }) =>
        useProjectFilesSection({
          projectId: 'project-1',
          token,
          isAdmin: false,
          showToast: vi.fn(),
        }),
      { initialProps: { token: 'token' as string | null } },
    );
    rerender({ token: null });
    await act(async () => pending.resolve({ files: [{ id: 'private-file' }] }));
    expect(result.current.files).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it('ignores an older tray detail request after navigation', async () => {
    const pending = deferred<{ tray: Tray }>();
    mocks.tray.mockReturnValueOnce(pending.promise);
    const { result, rerender } = renderHook(({ id }) => useTrayData('project-1', id), {
      initialProps: { id: 'old' },
    });
    rerender({ id: 'new' });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => pending.resolve({ tray: tray('old') }));
    expect(result.current.tray?.id).toBe('new');
    expect(mocks.cables).toHaveBeenCalledTimes(1);
  });
});
