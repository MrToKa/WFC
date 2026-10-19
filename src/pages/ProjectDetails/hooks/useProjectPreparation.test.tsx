import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '@/api/pathfinderPreparation';
import { preparationFixture, preparationIds as ids } from '@/test/preparationFixtures';
import { useProjectPreparation } from './useProjectPreparation';
import type { usePathFinder } from './usePathFinder';
vi.mock('@/api/pathfinderPreparation', async (original) => ({
  ...(await original<typeof api>()),
  fetchPreparationContext: vi.fn(),
  fetchPreparationIndex: vi.fn(),
  fetchPreparationSession: vi.fn(),
  createPreparation: vi.fn(),
  savePreparationResolution: vi.fn(),
  uploadPreparationPart: vi.fn(),
  mutatePreparation: vi.fn(),
}));
function setup() {
  const fixture = preparationFixture();
  vi.mocked(api.fetchPreparationContext).mockResolvedValue(fixture.context);
  vi.mocked(api.fetchPreparationIndex).mockResolvedValue({
    schemaVersion: 'wfc.pf.preparation-index.v1',
    sessions: [
      {
        id: ids.session,
        state: 'planned',
        sessionRevision: '1',
        createdAt: fixture.session.createdAt,
        idempotencyKey: ids.login,
      },
    ],
  });
  vi.mocked(api.fetchPreparationSession).mockResolvedValue(fixture.session);
  const pf = {
    preparationAccess: {
      projectId: ids.project,
      loadedProjectId: ids.project,
      token: 'login',
      isAdmin: true,
    },
    preparationViewerGeneration: 1,
    viewerPhase: 'ready',
    cancelOperation: vi.fn(),
    refresh: vi.fn(),
    reloadViewer: vi.fn(),
    runProjectPreparation: vi.fn(async (_expected, operation) =>
      operation({
        assertCurrent: () => {},
        capture: vi.fn().mockResolvedValue({ snapshot: { synthetic: true } }),
      }),
    ),
  } as unknown as ReturnType<typeof usePathFinder>;
  return { ...fixture, pf };
}
beforeEach(() => vi.clearAllMocks());
describe('project preparation lifecycle', () => {
  it('recovers the durable exact publish command after browser restart', async () => {
    const { pf, session } = setup();
    const command = {
      schemaVersion: 'wfc.pf.preparation-mutation.v1' as const,
      expectedSessionRevision: '2',
      idempotencyKey: ids.login,
      reason: 'Original durable validation',
    };
    vi.mocked(api.fetchPreparationSession).mockResolvedValue({
      ...session,
      state: 'validating',
      recovery: {
        command,
        actorId: ids.actor,
        loginId: ids.login,
        expiresAt: '2026-10-19T23:59:00Z',
      },
    });
    vi.mocked(api.mutatePreparation).mockRejectedValue(
      new api.PreparationApiError(
        'PREPARATION_VALIDATION_IN_PROGRESS',
        503,
        'Still validating',
        'unknown',
      ),
    );
    const { result } = renderHook(() => useProjectPreparation(pf, true));
    await waitFor(() => expect(result.current.unknown).toBe(true));
    await act(() => result.current.retry());
    expect(vi.mocked(api.mutatePreparation).mock.calls[0][4]).toEqual(command);
    expect(result.current.unknown).toBe(true);
  });
  it('can cancel on the server with fresh CAS while publication is awaiting acknowledgement', async () => {
    const { pf, session } = setup();
    let finish!: (value: never) => void;
    vi.mocked(api.mutatePreparation).mockImplementation(async (_project, _token, _id, kind) =>
      kind === 'publish'
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : { ...session, state: 'cancelled', sessionRevision: '4' },
    );
    const { result } = renderHook(() => useProjectPreparation(pf, true));
    await waitFor(() => expect(result.current.session).not.toBeNull());
    let publishing!: Promise<void>;
    act(() => {
      publishing = result.current.publish('Publish original');
    });
    await waitFor(() => expect(result.current.publishing).toBe(true));
    vi.mocked(api.fetchPreparationSession).mockResolvedValue({
      ...session,
      state: 'validating',
      sessionRevision: '3',
    });
    await act(() => result.current.cancelActive('Stop validation'));
    expect(vi.mocked(api.mutatePreparation).mock.calls[1][4].expectedSessionRevision).toBe('3');
    expect(result.current.session?.state).toBe('cancelled');
    await act(async () => {
      finish({} as never);
      await publishing;
    });
  });
  it('retains exact uncertain command and key while refusing new mutations until explicit retry', async () => {
    const { pf } = setup();
    vi.mocked(api.savePreparationResolution)
      .mockRejectedValueOnce(new TypeError('lost acknowledgement'))
      .mockResolvedValueOnce({} as never);
    const { result } = renderHook(() => useProjectPreparation(pf, true));
    await waitFor(() => expect(result.current.context).not.toBeNull());
    await act(() => result.current.resolve(ids.tray, 'exclude', [], 'Confirmed empty scope'));
    expect(result.current.unknown).toBe(true);
    expect(result.current.canMutate).toBe(false);
    const first = vi.mocked(api.savePreparationResolution).mock.calls[0][2];
    await act(() => result.current.resolve(ids.tray, 'reset', [], 'Different command'));
    expect(api.savePreparationResolution).toHaveBeenCalledTimes(1);
    await act(() => result.current.retry());
    expect(vi.mocked(api.savePreparationResolution).mock.calls[1][2]).toBe(first);
    expect(result.current.unknown).toBe(false);
  });
  it('keeps a confirmed write confirmed when its subsequent status refresh fails', async () => {
    const { pf } = setup();
    vi.mocked(api.savePreparationResolution).mockResolvedValue({} as never);
    const { result } = renderHook(() => useProjectPreparation(pf, true));
    await waitFor(() => expect(result.current.context).not.toBeNull());
    vi.mocked(api.fetchPreparationContext).mockRejectedValueOnce(
      new api.PreparationApiError('READ_FAILED', 503, 'Read unavailable', 'refused'),
    );
    await act(() => result.current.resolve(ids.tray, 'exclude', [], 'Confirmed empty scope'));
    expect(result.current.unknown).toBe(false);
    await act(() => result.current.retry());
    expect(api.savePreparationResolution).toHaveBeenCalledTimes(1);
  });
  it('resumes only missing parts and does not capture already committed geometry', async () => {
    const { pf, session, committed } = setup();
    const complete = {
      ...session,
      state: 'collecting' as const,
      parts: [committed],
      coverage: {
        expectedParts: 1,
        committedParts: 1,
        requestedScopeComplete: true,
        missingPartIds: [],
      },
    };
    vi.mocked(api.fetchPreparationSession).mockResolvedValue(complete);
    const { result } = renderHook(() => useProjectPreparation(pf, true));
    await waitFor(() => expect(result.current.session).not.toBeNull());
    await act(() => result.current.collect());
    expect(api.uploadPreparationPart).not.toHaveBeenCalled();
    expect(result.current.notice).toContain('Every planned part');
  });
  it('discards late reads when the current login identity changes', async () => {
    const { pf, context } = setup();
    let finish!: (value: typeof context) => void;
    vi.mocked(api.fetchPreparationContext).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { result, rerender } = renderHook(({ current }) => useProjectPreparation(current, true), {
      initialProps: { current: pf },
    });
    rerender({
      current: {
        ...pf,
        preparationAccess: { ...pf.preparationAccess, token: null, isAdmin: false },
      },
    });
    await act(async () => {
      finish(context);
    });
    expect(result.current.context).toBeNull();
    expect(result.current.enabled).toBe(false);
  });
  it('renews a depleted frame once and resumes the exact missing part', async () => {
    const { pf, session, committed } = setup();
    vi.mocked(pf.runProjectPreparation).mockRejectedValueOnce(
      Object.assign(new Error('Request budget depleted'), { code: 'CAPTURE_RELOAD_REQUIRED' }),
    );
    vi.mocked(pf.reloadViewer).mockImplementation(() => {
      pf.preparationViewerGeneration++;
    });
    vi.mocked(api.uploadPreparationPart).mockImplementation(async () => {
      vi.mocked(api.fetchPreparationSession).mockResolvedValue({
        ...session,
        state: 'collecting',
        parts: [committed],
        coverage: {
          expectedParts: 1,
          committedParts: 1,
          requestedScopeComplete: true,
          missingPartIds: [],
        },
      });
      return {} as never;
    });
    const { result } = renderHook(() => useProjectPreparation(pf, true));
    await waitFor(() => expect(result.current.session).not.toBeNull());
    await act(() => result.current.collect());
    expect(result.current.error).toBeNull();
    expect(pf.reloadViewer).toHaveBeenCalledTimes(1);
    expect(api.uploadPreparationPart).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.uploadPreparationPart).mock.calls[0].slice(2, 4)).toEqual([
      ids.session,
      ids.part,
    ]);
    expect(result.current.error).toBeNull();
  });
});
