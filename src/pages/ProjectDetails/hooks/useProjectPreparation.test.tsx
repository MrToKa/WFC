import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '@/api/pathfinderPreparation';
import { preparationFixture, preparationIds as ids } from '@/test/preparationFixtures';
import { useProjectPreparation } from './useProjectPreparation';
import type { usePathFinder } from './usePathFinder';
import {completedEvidenceFixture} from '@/test/geometryTraceFixtures';
import {saveCaptureEvidence} from '@/api/pathfinderGeometryTrace';
import { bindCompletedCaptureEvidence } from '../../../../viewer-runtime/capture-evidence.mjs';
import type { PathFinderState } from '@/api/pathfinder';
vi.mock('../../../../viewer-runtime/capture-evidence.mjs', async original => {
  const actual = await original<typeof import('../../../../viewer-runtime/capture-evidence.mjs')>();
  return { ...actual, bindCompletedCaptureEvidence: vi.fn(actual.bindCompletedCaptureEvidence) };
});
vi.mock('@/api/pathfinderGeometryTrace',async original=>({...await original<typeof import('@/api/pathfinderGeometryTrace')>(),saveCaptureEvidence:vi.fn()}));
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
        capture: vi.fn().mockResolvedValue({ snapshot: { synthetic: true },summary:{} }),
      }),
    ),
  } as unknown as ReturnType<typeof usePathFinder>;
  return { ...fixture, pf };
}
beforeEach(() => vi.clearAllMocks());
function withModel(pf: ReturnType<typeof usePathFinder>, scope: ReturnType<typeof preparationFixture>['context']['scope']) {
  const data: PathFinderState = { schemaVersion: 1, projectId: ids.project, registryRevision: scope.locationRegistryRevision,
    activeModel: { modelVersionId: scope.modelVersionId, selectionRevision: scope.selectionRevision, contentFingerprint: scope.contentFingerprint },
    settings: { revision: '1', connectionGap: '1', secondaryTrayLength: '7', endConnectionLength: '5', additionalBendingPercent: '10' },
    cables: [], locations: [], artifacts: [], jobs: [], proposals: [] };
  return { ...pf, data };
}
describe('project preparation lifecycle', () => {
  it('defers cold hidden controls until first Routes activation, then retains loaded controls across switches without 3D readiness', async () => {
    const { pf, context } = setup(), cold = { ...pf, viewerPhase: 'error' as const };
    const { result, rerender } = renderHook(({ active }) => useProjectPreparation(cold, active), { initialProps: { active: false } });
    expect(api.fetchPreparationContext).not.toHaveBeenCalled(); expect(api.fetchPreparationIndex).not.toHaveBeenCalled(); expect(api.fetchPreparationSession).not.toHaveBeenCalled();
    rerender({ active: true }); await waitFor(() => expect(result.current.context).toEqual(context));
    expect(api.fetchPreparationContext).toHaveBeenCalledTimes(1); expect(api.fetchPreparationIndex).toHaveBeenCalledTimes(1);
    rerender({ active: false }); expect(result.current.context).toEqual(context); expect(result.current.canMutate).toBe(false);
    rerender({ active: true }); expect(result.current.context).toEqual(context); expect(api.fetchPreparationContext).toHaveBeenCalledTimes(1);
    await act(() => result.current.refresh()); expect(api.fetchPreparationContext).toHaveBeenCalledTimes(2); expect(pf.runProjectPreparation).not.toHaveBeenCalled();
  });
  it('permits explicit hidden refresh and does not repeat its reads on first activation', async () => {
    const { pf } = setup();
    const { result, rerender } = renderHook(({ active }) => useProjectPreparation(pf, active), { initialProps: { active: false } });
    await act(() => result.current.refresh()); expect(result.current.session?.id).toBe(ids.session);
    rerender({ active: true }); expect(api.fetchPreparationContext).toHaveBeenCalledTimes(1); expect(api.fetchPreparationIndex).toHaveBeenCalledTimes(1);
  });
  it('retains the durable exact reconciliation command across tool switches and retries without a ready viewer', async () => {
    const { pf, session } = setup(), command = { schemaVersion: 'wfc.pf.preparation-mutation.v1' as const, expectedSessionRevision: '2', idempotencyKey: ids.login, reason: 'Recover retained validation' };
    vi.mocked(api.fetchPreparationSession).mockResolvedValue({ ...session, state: 'validating', recovery: { command, actorId: ids.actor, loginId: ids.login, expiresAt: '2026-10-21T00:00:00Z' } });
    vi.mocked(api.mutatePreparation).mockRejectedValueOnce(new api.PreparationApiError('PREPARATION_VALIDATION_IN_PROGRESS', 503, 'Validation still running', 'unknown'));
    const cold = { ...pf, viewerPhase: 'error' as const };
    const { result, rerender } = renderHook(({ active }) => useProjectPreparation(cold, active), { initialProps: { active: false } });
    expect(api.fetchPreparationContext).not.toHaveBeenCalled(); rerender({ active: true }); await waitFor(() => expect(result.current.unknown).toBe(true));
    rerender({ active: false }); expect(result.current.publishPending).toBe(true); expect(result.current.unknown).toBe(true);
    await act(() => result.current.retry()); expect(vi.mocked(api.mutatePreparation).mock.calls[0][4]).toBe(command);
    rerender({ active: true }); expect(result.current.unknown).toBe(true); expect(api.fetchPreparationContext).toHaveBeenCalledTimes(1); expect(pf.runProjectPreparation).not.toHaveBeenCalled();
  });
  it('pauses protected collection on leaving Routes while retaining the frozen session for Resume', async () => {
    const { pf } = setup();
    vi.mocked(pf.runProjectPreparation).mockImplementation(async (_scope, operation, signal) => operation({ assertCurrent: () => {}, capture: () => new Promise((_resolve, reject) => {
      signal!.addEventListener('abort', () => reject(new DOMException('Paused', 'AbortError')), { once: true });
    }) } as never));
    const { result, rerender } = renderHook(({ active }) => useProjectPreparation(pf, active), { initialProps: { active: true } });
    await waitFor(() => expect(result.current.session).not.toBeNull()); let collecting!: Promise<void>;
    act(() => { collecting = result.current.collect(); }); await waitFor(() => expect(result.current.progress).toContain('Collecting part'));
    const reads = vi.mocked(api.fetchPreparationContext).mock.calls.length; rerender({ active: false }); await act(async () => { await collecting; });
    expect(result.current.session?.id).toBe(ids.session); expect(result.current.notice).toContain('Collection paused'); expect(result.current.unknown).toBe(false);
    expect(api.uploadPreparationPart).not.toHaveBeenCalled(); rerender({ active: true }); expect(result.current.session?.id).toBe(ids.session); expect(api.fetchPreparationContext).toHaveBeenCalledTimes(reads);
  });
  it('resets lazy initialization for a new login and refuses reads after access loss', async () => {
    const { pf } = setup();
    const { result, rerender } = renderHook(({ current, active }) => useProjectPreparation(current, active), { initialProps: { current: pf, active: false } });
    rerender({ current: { ...pf, preparationAccess: { ...pf.preparationAccess, token: 'next-login' } }, active: false });
    expect(api.fetchPreparationContext).not.toHaveBeenCalled();
    const next = { ...pf, preparationAccess: { ...pf.preparationAccess, token: 'next-login' } };
    rerender({ current: next, active: true }); await waitFor(() => expect(result.current.context).not.toBeNull());
    expect(api.fetchPreparationContext).toHaveBeenCalledWith(ids.project, 'next-login', expect.any(AbortSignal));
    rerender({ current: { ...next, preparationAccess: { ...next.preparationAccess, isAdmin: false } }, active: true });
    expect(result.current.enabled).toBe(false); expect(result.current.context).toBeNull(); await act(() => result.current.refresh()); expect(api.fetchPreparationContext).toHaveBeenCalledTimes(1);
  });
  it.each(['context', 'session'] as const)('fences a changed model after the awaited %s read without accepting old control evidence', async stage => {
    const { pf, context, session } = setup(), original = withModel(pf, context.scope);
    let finish!: () => void;
    if (stage === 'context') vi.mocked(api.fetchPreparationContext).mockReturnValueOnce(new Promise(resolve => { finish = () => resolve(context); }));
    else vi.mocked(api.fetchPreparationSession).mockReturnValueOnce(new Promise(resolve => { finish = () => resolve(session); }));
    const { result, rerender } = renderHook(({ current }) => useProjectPreparation(current, true), { initialProps: { current: original } });
    if (stage === 'session') await waitFor(() => expect(api.fetchPreparationSession).toHaveBeenCalled());
    rerender({ current: withModel(pf, { ...context.scope, modelVersionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', selectionRevision: '99', contentFingerprint: 'f'.repeat(64) }) });
    await act(async () => { finish(); }); await waitFor(() => expect(result.current.conflict).toBe(true));
    expect(result.current.context).toBeNull(); expect(result.current.session).toBeNull(); expect(result.current.error).toContain('active model changed');
    expect(result.current.unknown).toBe(false); expect(result.current.canMutate).toBe(false);
  });
  it('keeps an exact unknown mutation through a locally stale display read until authoritative reconciliation', async () => {
    const { pf, context } = setup(), original = withModel(pf, context.scope);
    vi.mocked(api.savePreparationResolution).mockRejectedValueOnce(new TypeError('Lost acknowledgement'))
      .mockRejectedValueOnce(new api.PreparationApiError('PREPARATION_SCOPE_STALE', 409, 'Authoritative stale command refusal', 'refused'));
    const { result, rerender } = renderHook(({ current, active }) => useProjectPreparation(current, active), { initialProps: { current: original, active: true } });
    await waitFor(() => expect(result.current.context).not.toBeNull()); await act(() => result.current.resolve(ids.tray, 'exclude', [], 'Reviewed routing decision'));
    const command = vi.mocked(api.savePreparationResolution).mock.calls[0][2]; expect(result.current.unknown).toBe(true);
    const changed = withModel(pf, { ...context.scope, selectionRevision: '99' }); rerender({ current: changed, active: false });
    await act(() => result.current.refresh()); expect(result.current.conflict).toBe(true); expect(result.current.unknown).toBe(true);
    await act(() => result.current.retry()); expect(vi.mocked(api.savePreparationResolution).mock.calls[1][2]).toBe(command); expect(result.current.unknown).toBe(false);
    expect(result.current.conflict).toBe(true); expect(api.savePreparationResolution).toHaveBeenCalledTimes(2);
  });
  it('does not install old evidence commands after the login changes during hashing', async () => {
    const { pf, committed } = setup(), evidence = await completedEvidenceFixture();
    let finishHash!: (value: typeof evidence) => void;
    vi.mocked(bindCompletedCaptureEvidence).mockImplementationOnce(() => new Promise(resolve => { finishHash = resolve; }));
    vi.mocked(pf.runProjectPreparation).mockImplementation(async (_scope, operation) => operation({ assertCurrent: () => {}, capture: vi.fn().mockResolvedValue({ snapshot: { synthetic: true }, summary: { completedEvidence: evidence } }) } as never));
    vi.mocked(api.uploadPreparationPart).mockResolvedValue({ schemaVersion: 'wfc.pf.preparation-part-receipt.v1', part: committed, sessionRevision: '2', duplicate: false });
    vi.mocked(api.savePreparationResolution).mockResolvedValue({} as never);
    const { result, rerender } = renderHook(({ current }) => useProjectPreparation(current, true), { initialProps: { current: pf } });
    await waitFor(() => expect(result.current.session).not.toBeNull());
    let collecting!: Promise<void>;
    act(() => { collecting = result.current.collect(); });
    await waitFor(() => expect(finishHash).toBeTypeOf('function'));
    rerender({ current: { ...pf, preparationAccess: { ...pf.preparationAccess, token: 'next-login' } } });
    await waitFor(() => expect(result.current.session).not.toBeNull());
    await act(async () => { finishHash(evidence); await collecting; });
    expect(saveCaptureEvidence).not.toHaveBeenCalled();
    await act(() => result.current.resolve(ids.tray, 'reset', [], 'New login command'));
    expect(api.savePreparationResolution).toHaveBeenCalledOnce();
  });
  it('does not erase the new login exact pending command when an older write finishes late', async () => {
    const { pf } = setup();
    let finishOld!: (value: never) => void;
    vi.mocked(api.savePreparationResolution).mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; })).mockRejectedValueOnce(new TypeError('Lost new login acknowledgement')).mockResolvedValueOnce({} as never);
    const { result, rerender } = renderHook(({ current }) => useProjectPreparation(current, true), { initialProps: { current: pf } });
    await waitFor(() => expect(result.current.session).not.toBeNull());
    let oldWrite!: Promise<void>;
    act(() => { oldWrite = result.current.resolve(ids.tray, 'reset', [], 'Old login command'); });
    await waitFor(() => expect(api.savePreparationResolution).toHaveBeenCalledOnce());
    rerender({ current: { ...pf, preparationAccess: { ...pf.preparationAccess, token: 'next-login' } } });
    await waitFor(() => expect(result.current.session).not.toBeNull());
    await act(() => result.current.resolve(ids.tray, 'reset', [], 'New login command'));
    const pendingBody = vi.mocked(api.savePreparationResolution).mock.calls[1][2];
    expect(result.current.unknown).toBe(true);
    await act(async () => { finishOld({} as never); await oldWrite; });
    await act(() => result.current.retry());
    expect(api.savePreparationResolution).toHaveBeenCalledTimes(3);
    expect(vi.mocked(api.savePreparationResolution).mock.calls[2][2]).toBe(pendingBody);
    expect(result.current.unknown).toBe(false);
  });
  it('distinguishes extraction, part upload and evidence wait without reporting completion early', async () => {
    const { pf, session, committed } = setup(), evidence = await completedEvidenceFixture();
    let finishCapture!: (value: never) => void, finishUpload!: (value: never) => void, finishEvidence!: (value: never) => void;
    const capture = vi.fn(() => new Promise((resolve) => { finishCapture = resolve; }));
    vi.mocked(pf.runProjectPreparation).mockImplementation(async (_scope, operation) => operation({
      assertCurrent: () => {}, readSelection: vi.fn(), discover: vi.fn(), capture,
    } as never));
    vi.mocked(api.uploadPreparationPart).mockImplementation(() => new Promise((resolve) => { finishUpload = resolve; }));
    vi.mocked(saveCaptureEvidence).mockImplementation(() => new Promise((resolve) => { finishEvidence = resolve; }));
    const { result } = renderHook(() => useProjectPreparation(pf, true));
    await waitFor(() => expect(result.current.session).not.toBeNull());
    let collecting!: Promise<void>;
    act(() => { collecting = result.current.collect(); });
    await waitFor(() => expect(result.current.progress).toContain('Collecting part 1 of 1'));
    expect(api.uploadPreparationPart).not.toHaveBeenCalled();
    await act(async () => { finishCapture({ snapshot: { synthetic: true }, summary: { completedEvidence: evidence } } as never); });
    await waitFor(() => expect(result.current.progress).toContain('Uploading part 1 of 1'));
    expect(saveCaptureEvidence).not.toHaveBeenCalled();
    expect(result.current.busy).toBe(true);
    await act(async () => { finishUpload({ schemaVersion: 'wfc.pf.preparation-part-receipt.v1', part: committed, sessionRevision: '2', duplicate: false } as never); });
    await waitFor(() => expect(result.current.progress).toContain('Saving capture evidence for part 1 of 1'));
    expect(result.current.busy).toBe(true);
    expect(capture).toHaveBeenCalledOnce();
    vi.mocked(api.fetchPreparationSession).mockResolvedValue({ ...session, state: 'collecting', parts: [committed], coverage: { expectedParts: 1, committedParts: 1, requestedScopeComplete: true, missingPartIds: [] } });
    await act(async () => { finishEvidence({} as never); await collecting; });
    expect(result.current.busy).toBe(false);
    expect(result.current.notice).toContain('Every planned part');
  });
  it('retains completed evidence after a committed part and retries only its exact unknown evidence upload',async()=>{
    const {pf,session,committed}=setup(),evidence=await completedEvidenceFixture();
    vi.mocked(pf.runProjectPreparation).mockImplementation(async(_scope,operation)=>operation({assertCurrent:()=>{},readSelection:vi.fn(),discover:vi.fn(),capture:vi.fn().mockResolvedValue({snapshot:{synthetic:true},summary:{completedEvidence:evidence}})}));
    vi.mocked(api.uploadPreparationPart).mockImplementation(async()=>{vi.mocked(api.fetchPreparationSession).mockResolvedValue({...session,state:'collecting',parts:[committed],coverage:{expectedParts:1,committedParts:1,requestedScopeComplete:true,missingPartIds:[]}});return {schemaVersion:'wfc.pf.preparation-part-receipt.v1',part:committed,sessionRevision:'2',duplicate:false};});
    vi.mocked(saveCaptureEvidence).mockRejectedValueOnce(new TypeError('Lost evidence receipt')).mockResolvedValueOnce({} as never);
    const {result}=renderHook(()=>useProjectPreparation(pf,true));await waitFor(()=>expect(result.current.session).not.toBeNull());await act(()=>result.current.collect());expect(result.current.unknown).toBe(true);
    const first=vi.mocked(saveCaptureEvidence).mock.calls[0];expect(first[6].binding.partPayloadSha256).toBe(committed.payloadSha256);
    await act(()=>result.current.retry());expect(api.uploadPreparationPart).toHaveBeenCalledOnce();expect(vi.mocked(saveCaptureEvidence).mock.calls[1][6]).toBe(first[6]);expect(result.current.unknown).toBe(false);
  });
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
