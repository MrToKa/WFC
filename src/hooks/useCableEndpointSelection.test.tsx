import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewerSelection } from '../../viewer-runtime/protocol.mjs';
import {
  CableEndpointApiError, fetchCableEndpointContext, fetchCableEndpointSelection, saveCableEndpoint, closePendingCableEndpoint,
  type CableEndpointContext, type CableEndpointCommand, type CableEndpointReceipt,
} from '@/api/pathfinderCableEndpoints';
import { readPendingCableEndpoint } from './cableEndpointPendingStore';
import { useCableEndpointSelection, type CableEndpointSelectionAccess } from './useCableEndpointSelection';

vi.mock('@/api/pathfinderCableEndpoints', async original => ({ ...(await original<typeof import('@/api/pathfinderCableEndpoints')>()),
  fetchCableEndpointContext: vi.fn(), fetchCableEndpointSelection: vi.fn(), saveCableEndpoint: vi.fn(), closePendingCableEndpoint: vi.fn() }));
const id = (n: number) => `80000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const project = id(1), actor = id(2), cable = id(3), hash = 'a'.repeat(64);
const scope = { modelVersionId: id(4), selectionRevision: '6', contentFingerprint: 'b'.repeat(64), aggregateId: id(5), artifactId: id(6), projectionSha256: 'c'.repeat(64), captureFrameId: id(7), geometryRevision: '7', traceId: id(8) };
const object = { traceId: id(8), objectRevisionId: id(20), recordSha256: hash };
function context(selectedCable = cable, end: 'from' | 'to' = 'from'): CableEndpointContext { return {
  schemaVersion: 'wfc.pf.cable-endpoint-context.v1', projectId: project, cableId: selectedCable, end, cableWriteRevision: '4', logicalName: 'LP-001', logicalKey: 'LP-001', mto: 'LV',
  canBind: true, reasonCodes: [], registryRevision: '5', location: null, head: null, current: { ...scope }, contextSha256: hash,
}; }
function viewerSelection(): ViewerSelection { return { coordinateFrame: 'world-metres-z-up', metresPerDisplayUnit: 1, globalOffsetMetres: [0, 0, 0], objects: [{
  objectId: 99999, parentId: null, name: 'Different arbitrary SDK display name', externalId: null, bounds: { minimum: [0, 1, 3], maximum: [2, 3, 5] }, bottomCentre: [1, 2, 3],
  derivation: 'display-aabb-bottom-centre', nativeVisibility: 'unknown', properties: [], propertiesTruncated: false,
}] }; }
function evidence(current = context()) { return { schemaVersion: 'wfc.pf.cable-endpoint-selection-response.v1' as const, projectId: project, cableId: current.cableId, end: current.end, contextSha256: current.contextSha256,
  selection: { schemaVersion: 'wfc.pf.cable-endpoint-selection.v1' as const, projectId: project, current: current.current!, sdkObjectId: 99999, status: 'available' as const,
    reasonCodes: [], object, pointProjectMetres: [4, 5, 6] as [number, number, number], bounds: { minimum: [3, 4, 6] as [number, number, number], maximum: [5, 6, 8] as [number, number, number] }, approximate: true as const, derivation: 'equipment-bottom-aabb.v1' as const } }; }
function receipt(input: CableEndpointCommand, selectedCable = cable, end: 'from' | 'to' = 'from'): CableEndpointReceipt {
  const current = input.expectedCurrent, selection = input.selection;
  return { schemaVersion: 'wfc.pf.cable-endpoint-receipt.v1', projectId: project, actorId: actor, cableId: selectedCable, end, logicalName: input.expectedLogicalName,
    idempotencyKey: input.idempotencyKey, commandSha256: hash, expectedCableWriteRevision: input.expectedCableWriteRevision, expectedContextSha256: input.expectedContextSha256,
    locationId: id(11), duplicate: false, impact: { fromOccurrences: 1, toOccurrences: 1, distinctCables: 1, cableIds: [selectedCable] },
    binding: { schemaVersion: 'wfc.pf.endpoint-binding-receipt.v1', projectId: project, locationId: id(11), registryRevision: '6', locationRevision: '1', duplicate: false,
      binding: { schemaVersion: 'wfc.pf.endpoint-binding.v1', id: id(10), projectId: project, locationId: id(11), locationRevision: '1', bindingRevision: '1', locationRegistryRevision: '6',
        modelVersionId: current.modelVersionId, aggregateId: current.aggregateId, artifactId: current.artifactId, projectionSha256: current.projectionSha256, captureFrameId: current.captureFrameId,
        qualifiedProjectFrameId: null, status: 'confirmed', mode: selection.mode, pointProjectMetres: selection.mode === 'fixed-world' ? selection.pointProjectMetres : [4, 5, 6],
        derivation: selection.mode === 'fixed-world' ? selection.derivation : 'equipment-bottom-aabb.v1', sourceObject: selection.mode === 'fixed-world' ? null : selection.object,
        attachment: null, sourceDecisionId: null, supersedesBindingId: null, legacyObservationId: null, priorPointProjectMetres: null, priorCaptureFrameId: null, displacementBasis: 'none',
        displacementVectorMetres: null, displacementMetres: null, confirmedBy: actor, confirmedAt: '2026-10-20T00:00:00Z', reason: input.reason, contentSha256: hash } } };
}
const access = (): CableEndpointSelectionAccess => ({ projectId: project, loadedProjectId: project, accountId: actor, token: 'private-current-token', isAdmin: true, active: true,
  cableId: cable, end: 'from', model: { modelVersionId: scope.modelVersionId, selectionRevision: scope.selectionRevision, contentFingerprint: scope.contentFingerprint }, preparationKey: 'current-preparation',
  readSelection: vi.fn(async () => viewerSelection()), onSaved: vi.fn(), onAuthorityLost: vi.fn() });
const owner = { accountId: actor, projectId: project }, originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); let queue = Promise.resolve();
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: vi.fn((_name: string, options: LockOptions, work: (lock: Lock) => unknown) => {
    const task = queue.then(() => { options.signal?.throwIfAborted(); return work({} as Lock); }); queue = task.then(() => undefined, () => undefined); return task;
  }) } });
  vi.mocked(fetchCableEndpointContext).mockImplementation(async (_project, _token, selectedCable, end) => context(selectedCable, end));
  vi.mocked(fetchCableEndpointSelection).mockImplementation(async (_project, _token, current) => evidence(current));
  vi.mocked(saveCableEndpoint).mockImplementation(async (_project, _token, selectedCable, end, input) => receipt(input, selectedCable, end));
});
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); if (originalLocks) Object.defineProperty(navigator, 'locks', originalLocks); else Reflect.deleteProperty(navigator, 'locks'); });

describe('persistent owned cable endpoint selection', () => {
  it('never reads, binds or shows another principal’s data without an active administrator scope', async () => {
    const props = access(), view = renderHook(value => useCableEndpointSelection(value), { initialProps: { ...props, isAdmin: false } });
    expect(fetchCableEndpointContext).not.toHaveBeenCalled(); expect(view.result.current.context).toBeNull();
    view.rerender({ ...props, accountId: null }); expect(fetchCableEndpointContext).not.toHaveBeenCalled();
    view.rerender({ ...props, loadedProjectId: id(99) }); expect(fetchCableEndpointContext).not.toHaveBeenCalled();
    view.rerender({ ...props, active: false }); expect(fetchCableEndpointContext).not.toHaveBeenCalled();
    view.rerender(props); await waitFor(() => expect(view.result.current.context?.logicalName).toBe('LP-001')); expect(saveCableEndpoint).not.toHaveBeenCalled();
  });
  it('uses exact retained object evidence and the server anchor while preserving the logical cable name', async () => {
    const props = access(), view = renderHook(() => useCableEndpointSelection(props)); await waitFor(() => expect(view.result.current.canSelect).toBe(true));
    await act(async () => { await view.result.current.selectObject(); });
    expect(fetchCableEndpointSelection).toHaveBeenCalledWith(project, 'private-current-token', expect.objectContaining({ cableId: cable, end: 'from' }), 99999, expect.any(AbortSignal));
    expect(view.result.current.draft).toEqual({ mode: 'object-derived', sdkObjectId: 99999, object, point: [4, 5, 6] });
    expect(view.result.current.context?.logicalName).toBe('LP-001'); expect(view.result.current.context?.logicalName).not.toBe(viewerSelection().objects[0].name);
    vi.mocked(saveCableEndpoint).mockImplementationOnce(async (_project, _token, _cable, _end, input) => {
      expect(readPendingCableEndpoint(owner)?.command).toEqual(input); expect(localStorage.getItem(localStorage.key(0)!)).not.toContain('private-current-token');
      expect(input.selection).toEqual({ mode: 'object-derived', sdkObjectId: 99999, object }); expect(input.selection).not.toHaveProperty('pointProjectMetres'); return receipt(input);
    });
    await act(async () => { expect(await view.result.current.save('Confirmed selected panel')).toBe(true); });
    expect(props.onSaved).toHaveBeenCalledOnce(); expect(readPendingCableEndpoint(owner)).toBeNull(); expect(view.result.current.receipt?.logicalName).toBe('LP-001');
    expect(fetchCableEndpointContext).toHaveBeenCalledTimes(2);
  });
  it('requires explicit fixed-world fallback when the selected object is not retained', async () => {
    vi.mocked(fetchCableEndpointSelection).mockImplementationOnce(async (_project, _token, current) => ({ ...evidence(current), selection: { ...evidence(current).selection,
      status: 'unavailable', reasonCodes: ['OBJECT_NOT_RETAINED'], object: null, pointProjectMetres: null, bounds: null, derivation: null } }));
    const view = renderHook(() => useCableEndpointSelection(access())); await waitFor(() => expect(view.result.current.canSelect).toBe(true));
    await act(async () => { await view.result.current.selectObject(); }); expect(view.result.current.draft).toBeNull(); expect(view.result.current.canSave).toBe(false);
    expect(view.result.current.notice).toContain('will not follow model revisions'); expect(saveCableEndpoint).not.toHaveBeenCalled();
    act(() => { expect(view.result.current.chooseDisplayedPoint()).toBe(true); });
    expect(view.result.current.draft).toEqual({ mode: 'fixed-world', point: [1, 2, 3], derivation: 'manual-world-point', displaySdkObjectId: 99999 });
    await act(async () => { await view.result.current.save('Explicit fixed point'); }); expect(vi.mocked(saveCableEndpoint).mock.calls[0][4].selection).not.toHaveProperty('object');
  });
  it.each(['multiple', 'point', 'bounds', 'units', 'frame'] as const)('rejects malformed protected selection before an object lookup: %s', async kind => {
    const selected = viewerSelection();
    if (kind === 'multiple') selected.objects.push({ ...selected.objects[0], objectId: 44 });
    if (kind === 'point') selected.objects[0].bottomCentre = [1, 2, 4];
    if (kind === 'bounds') selected.objects[0].bounds!.maximum[0] = Number.NaN;
    if (kind === 'units') selected.metresPerDisplayUnit = Number.NaN;
    if (kind === 'frame') selected.coordinateFrame = 'not-canonical' as never;
    const view = renderHook(() => useCableEndpointSelection({ ...access(), readSelection: vi.fn(async () => selected) })); await waitFor(() => expect(view.result.current.canSelect).toBe(true));
    await act(async () => { await view.result.current.selectObject(); }); expect(fetchCableEndpointSelection).not.toHaveBeenCalled(); expect(view.result.current.draft).toBeNull();
    expect(view.result.current.notice).toContain('Select exactly one current model object');
  });
  it('preserves draft and stable model context across equivalent rerenders and inactive collapse/resume', async () => {
    const props = access(), view = renderHook(value => useCableEndpointSelection(value), { initialProps: props }); await waitFor(() => expect(view.result.current.canSelect).toBe(true));
    act(() => { view.result.current.setFixedPoint([7, 8, 9]); }); const draft = view.result.current.draft;
    view.rerender({ ...props, model: { ...props.model! } }); expect(fetchCableEndpointContext).toHaveBeenCalledOnce(); expect(view.result.current.draft).toEqual(draft);
    view.rerender({ ...props, active: false }); expect(view.result.current.draft).toEqual(draft); expect(view.result.current.canSave).toBe(false);
    await act(async () => { expect(await view.result.current.save('Hidden save')).toBe(false); }); expect(saveCableEndpoint).not.toHaveBeenCalled();
    view.rerender(props); expect(view.result.current.draft).toEqual(draft); expect(fetchCableEndpointContext).toHaveBeenCalledOnce(); expect(view.result.current.canSave).toBe(true);
  });
  it.each(['cable', 'end', 'model', 'account'] as const)('discards a late protected selection after its owner changes: %s', async kind => {
    let finish!: (selection: ViewerSelection) => void; const props = { ...access(), readSelection: vi.fn(() => new Promise<ViewerSelection>(resolve => { finish = resolve; })) };
    const view = renderHook(value => useCableEndpointSelection(value), { initialProps: props }); await waitFor(() => expect(view.result.current.canSelect).toBe(true));
    let pending!: Promise<void>; act(() => { pending = view.result.current.selectObject(); });
    const change = kind === 'cable' ? { cableId: id(50) } : kind === 'end' ? { end: 'to' as const } : kind === 'model' ? { model: { ...props.model!, selectionRevision: '99' } } : { accountId: id(51), token: 'other-account' };
    view.rerender({ ...props, ...change }); await act(async () => { finish(viewerSelection()); await pending; });
    expect(view.result.current.draft).toBeNull(); expect(fetchCableEndpointSelection).not.toHaveBeenCalled(); expect(saveCableEndpoint).not.toHaveBeenCalled();
  });
  it('retains the exact unknown command across unmount, model/cable/end changes and replays only explicitly with current credentials', async () => {
    vi.mocked(saveCableEndpoint).mockRejectedValueOnce(new CableEndpointApiError('LOST_RESPONSE', null, 'Lost response', 'unknown'));
    const props = access(), first = renderHook(() => useCableEndpointSelection(props)); await waitFor(() => expect(first.result.current.canSelect).toBe(true));
    act(() => { first.result.current.setFixedPoint([1, 2, 3]); }); await act(async () => { expect(await first.result.current.save('Shared point')).toBe(false); });
    const retained = readPendingCableEndpoint(owner)!; expect(retained).not.toBeNull(); first.unmount();
    const nextModel = { ...scope, modelVersionId: id(90), selectionRevision: '99', contentFingerprint: 'e'.repeat(64) };
    vi.mocked(fetchCableEndpointContext).mockImplementation(async (_project, _token, selectedCable, end) => ({ ...context(selectedCable, end), current: nextModel }));
    const second = renderHook(() => useCableEndpointSelection({ ...props, cableId: id(50), end: 'to', token: 'new-current-login', model: nextModel }));
    await waitFor(() => expect(second.result.current.canRetry).toBe(true)); expect(saveCableEndpoint).toHaveBeenCalledOnce();
    expect(second.result.current.pending).toEqual(retained); expect(second.result.current.canSave).toBe(false);
    await act(async () => { expect(await second.result.current.retry()).toBe(true); });
    const call = vi.mocked(saveCableEndpoint).mock.calls[1]; expect(call.slice(0, 6)).toEqual([project, 'new-current-login', cable, 'from', retained.command, actor]);
    expect(readPendingCableEndpoint(owner)).toBeNull();
  });
  it('preserves a refused command until explicit immutable close, never generic discard', async () => {
    vi.mocked(saveCableEndpoint).mockRejectedValueOnce(new CableEndpointApiError('CONTEXT_CHANGED', 409, 'Changed', 'refused'));
    vi.mocked(closePendingCableEndpoint).mockImplementationOnce(async (_project, _token, selectedCable, end, input) => ({ schemaVersion: 'wfc.pf.cable-endpoint-recovery.v1', status: 'closed', closure: {
      schemaVersion: 'wfc.pf.cable-endpoint-closed.v1', projectId: project, actorId: actor, cableId: selectedCable, end, idempotencyKey: input.idempotencyKey, commandSha256: hash,
      expectedContextSha256: input.expectedContextSha256, expectedCableWriteRevision: input.expectedCableWriteRevision } }));
    const props = access(), view = renderHook(() => useCableEndpointSelection(props)); await waitFor(() => expect(view.result.current.canSelect).toBe(true));
    act(() => { view.result.current.setFixedPoint([1, 2, 3]); }); await act(async () => { await view.result.current.save('Shared point'); });
    const retained = readPendingCableEndpoint(owner)!; expect(retained).not.toBeNull(); expect(closePendingCableEndpoint).not.toHaveBeenCalled();
    await act(async () => { expect(await view.result.current.closePending()).toBe(true); });
    expect(vi.mocked(closePendingCableEndpoint).mock.calls[0][4]).toEqual(retained.command); expect(readPendingCableEndpoint(owner)).toBeNull(); expect(props.onSaved).not.toHaveBeenCalled();
    expect(view.result.current.notice).toContain('closed without saving'); expect(view.result.current.receipt).toBeNull(); expect(saveCableEndpoint).toHaveBeenCalledOnce();
  });
  it('treats an already-saved close as a confirmed save and leaves an unconfirmed close pending', async () => {
    vi.mocked(saveCableEndpoint).mockRejectedValueOnce(new Error('Network lost'));
    vi.mocked(closePendingCableEndpoint).mockRejectedValueOnce(new CableEndpointApiError('INVALID_RESPONSE', null, 'Unverified closure')).mockImplementationOnce(async (_project, _token, selectedCable, end, input) => ({ schemaVersion: 'wfc.pf.cable-endpoint-recovery.v1', status: 'saved', receipt: receipt(input, selectedCable, end) }));
    const props = access(), view = renderHook(() => useCableEndpointSelection(props)); await waitFor(() => expect(view.result.current.canSelect).toBe(true));
    act(() => { view.result.current.setFixedPoint([1, 2, 3]); }); await act(async () => { await view.result.current.save('Shared point'); });
    await act(async () => { expect(await view.result.current.closePending()).toBe(false); }); expect(readPendingCableEndpoint(owner)).not.toBeNull();
    await act(async () => { expect(await view.result.current.closePending()).toBe(true); }); expect(props.onSaved).toHaveBeenCalledOnce(); expect(readPendingCableEndpoint(owner)).toBeNull();
  });
  it('hides data on logout/account change, retains the old principal’s command and requires fresh login after denial', async () => {
    vi.mocked(saveCableEndpoint).mockRejectedValueOnce(new CableEndpointApiError('ADMIN_REQUIRED', 403, 'Current administrator access required.'));
    const props = access(), view = renderHook(value => useCableEndpointSelection(value), { initialProps: props }); await waitFor(() => expect(view.result.current.canSelect).toBe(true));
    act(() => { view.result.current.setFixedPoint([1, 2, 3]); }); await act(async () => { await view.result.current.save('Shared point'); });
    expect(view.result.current.enabled).toBe(false); expect(view.result.current.context).toBeNull(); expect(readPendingCableEndpoint(owner)).not.toBeNull(); expect(props.onAuthorityLost).toHaveBeenCalledOnce();
    view.rerender({ ...props, token: null }); expect(view.result.current.pending).toBeNull(); expect(view.result.current.draft).toBeNull();
    view.rerender({ ...props, token: 'other', accountId: id(99) }); expect(view.result.current.pending).toBeNull(); expect(readPendingCableEndpoint(owner)).not.toBeNull();
    view.rerender({ ...props, token: 'fresh-current-login' }); await waitFor(() => expect(view.result.current.canRetry).toBe(true)); expect(view.result.current.pending?.accountId).toBe(actor);
  });
  it('does not dispatch if durable storage/Web Locks are unavailable or the confirmation reason is empty', async () => {
    const view = renderHook(() => useCableEndpointSelection(access())); await waitFor(() => expect(view.result.current.canSelect).toBe(true));
    act(() => { view.result.current.setFixedPoint([1, 2, 3]); });
    await act(async () => { expect(await view.result.current.save('   ')).toBe(false); }); expect(view.result.current.error).toContain('confirmation reason');
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
    await act(async () => { expect(await view.result.current.save('Explicit point')).toBe(false); }); expect(saveCableEndpoint).not.toHaveBeenCalled(); expect(readPendingCableEndpoint(owner)).toBeNull(); expect(view.result.current.error).toContain('Web Locks');
  });
  it('never labels a confirmed save unknown when its following lightweight refresh fails', async () => {
    vi.mocked(fetchCableEndpointContext).mockResolvedValueOnce(context()).mockRejectedValueOnce(new Error('Read unavailable'));
    const view = renderHook(() => useCableEndpointSelection(access())); await waitFor(() => expect(view.result.current.canSelect).toBe(true));
    act(() => { view.result.current.setFixedPoint([1, 2, 3]); }); await act(async () => { expect(await view.result.current.save('Explicit point')).toBe(true); });
    expect(view.result.current.receipt).not.toBeNull(); expect(view.result.current.pending).toBeNull(); expect(view.result.current.error).toContain('save is confirmed'); expect(view.result.current.error).not.toContain('unconfirmed');
  });
  it('preserves confirmed proof and retires stale context when paused after storage clears but before refresh', async () => {
    const props = access(), view = renderHook(value => useCableEndpointSelection(value), { initialProps: props }); await waitFor(() => expect(view.result.current.canSelect).toBe(true));
    let lockCount = 0, resumeClear!: () => void;
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: vi.fn(async (_name: string, _options: LockOptions, work: (lock: Lock) => unknown) => {
      const result = work({} as Lock); lockCount++;
      if (lockCount === 3) await new Promise<void>(resolve => { resumeClear = resolve; }); return result;
    }) } });
    act(() => { view.result.current.setFixedPoint([1, 2, 3]); }); let saving!: Promise<boolean>;
    act(() => { saving = view.result.current.save('Explicit point'); });
    await waitFor(() => expect(lockCount).toBe(3)); expect(readPendingCableEndpoint(owner)).toBeNull();
    view.rerender({ ...props, active: false }); await act(async () => { resumeClear(); expect(await saving).toBe(true); });
    expect(view.result.current.receipt).not.toBeNull(); expect(view.result.current.context).toBeNull(); expect(view.result.current.pending).toBeNull(); expect(view.result.current.canSave).toBe(false);
    vi.mocked(fetchCableEndpointContext).mockResolvedValueOnce({ ...context(), registryRevision: '6' });
    view.rerender(props); await waitFor(() => expect(view.result.current.context?.registryRevision).toBe('6'));
    expect(view.result.current.error).toBeNull(); expect(view.result.current.draft).toBeNull(); expect(fetchCableEndpointContext).toHaveBeenCalledTimes(2);
  });
  it('serializes two editor instances so only one unresolved PUT can be sent', async () => {
    vi.mocked(saveCableEndpoint).mockRejectedValue(new Error('Lost response'));
    const one = renderHook(() => useCableEndpointSelection(access())), two = renderHook(() => useCableEndpointSelection({ ...access(), cableId: id(50), end: 'to' }));
    await waitFor(() => expect(one.result.current.canSelect && two.result.current.canSelect).toBe(true));
    act(() => { one.result.current.setFixedPoint([1, 2, 3]); two.result.current.setFixedPoint([4, 5, 6]); });
    await act(async () => { await Promise.all([one.result.current.save('One'), two.result.current.save('Two')]); });
    expect(saveCableEndpoint).toHaveBeenCalledOnce(); expect(readPendingCableEndpoint(owner)?.cableId).toBe(cable); expect(two.result.current.pending?.cableId).toBe(cable);
  });
  it('blocks unnamed endpoints and MV instead of assigning an arbitrary model object name', async () => {
    vi.mocked(fetchCableEndpointContext).mockResolvedValueOnce({ ...context(), logicalName: null, logicalKey: null, canBind: false, reasonCodes: ['ENDPOINT_NAME_REQUIRED'] });
    const view = renderHook(() => useCableEndpointSelection(access())); await waitFor(() => expect(view.result.current.context).not.toBeNull());
    expect(view.result.current.canSelect).toBe(false); expect(view.result.current.canSave).toBe(false); await act(async () => { await view.result.current.selectObject(); });
    expect(fetchCableEndpointSelection).not.toHaveBeenCalled(); expect(saveCableEndpoint).not.toHaveBeenCalled();
  });
});
