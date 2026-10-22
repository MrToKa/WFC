import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewerSelection } from '../../viewer-runtime/protocol.mjs';
import { CableEndpointApiError, fetchCableEndpointContext, fetchCableEndpointSelection, saveCableEndpoint, closePendingCableEndpoint,
  type CableEndpointContext, type CableEndpointCommand } from '@/api/pathfinderCableEndpoints';
import { saveCableEndpointPair, closePendingCableEndpointPair, type CableEndpointPairCommand, type CableEndpointPairReceipt } from '@/api/pathfinderCableEndpointPairs';
import { readPendingCableEndpointPair } from './cableEndpointPairPendingStore';
import { retainPendingCableEndpoint, readPendingCableEndpoint } from './cableEndpointPendingStore';
import { useCableEndpointPairSelection, type CableEndpointPairSelectionAccess } from './useCableEndpointPairSelection';

vi.mock('@/api/pathfinderCableEndpoints', async original => ({ ...(await original<typeof import('@/api/pathfinderCableEndpoints')>()),
  fetchCableEndpointContext: vi.fn(), fetchCableEndpointSelection: vi.fn(), saveCableEndpoint: vi.fn(), closePendingCableEndpoint: vi.fn() }));
vi.mock('@/api/pathfinderCableEndpointPairs', () => ({ saveCableEndpointPair: vi.fn(), closePendingCableEndpointPair: vi.fn() }));
const id = (n: number) => `94000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const project = id(1), actor = id(2), cable = id(3), owner = { accountId: actor, projectId: project };
const scope = { modelVersionId: id(4), selectionRevision: '6', contentFingerprint: 'b'.repeat(64), aggregateId: id(5), artifactId: id(6), projectionSha256: 'c'.repeat(64), captureFrameId: id(7), geometryRevision: '7', traceId: id(8) };
const object = (sdk: number) => ({ traceId: scope.traceId, objectRevisionId: id(sdk), recordSha256: 'd'.repeat(64) });
const calculation = { preferences: { secondaryDistanceMeters: 2, preferVerticalApproach: true }, timeoutMilliseconds: 60000 };
let automatic = false, saved = false;
function context(selected = cable, end: 'from' | 'to' = 'from'): CableEndpointContext {
  const sdkObjectId = end === 'from' ? 20 : 21;
  return { schemaVersion: 'wfc.pf.cable-endpoint-context.v1', projectId: project, cableId: selected, end, cableWriteRevision: '4', logicalName: end === 'from' ? 'LP-001' : 'LP-002', logicalKey: end === 'from' ? 'LP-001' : 'LP-002', mto: 'LV',
    canBind: true, reasonCodes: [], registryRevision: saved ? '6' : '5', location: null, head: null, current: { ...scope }, contextSha256: (end === 'from' ? saved ? 'e' : 'a' : saved ? 'f' : 'b').repeat(64),
    automaticSelection: automatic && !saved ? { source: 'automatic-unconfirmed', sdkObjectId, name: 'Automatic ' + sdkObjectId, object: object(sdkObjectId), pointProjectMetres: [sdkObjectId, 2, 3], approximate: true, confirmed: false } : null };
}
function savedToContext(value: CableEndpointContext): CableEndpointContext {
  return { ...value, location: { id: id(81), name: 'LP-002', revision: '2', aliases: [] }, automaticSelection: null,
    head: { schemaVersion: 'wfc.pf.endpoint-binding.v1', id: id(82), projectId: project, locationId: id(81), locationRevision: '2', bindingRevision: '3',
      locationRegistryRevision: value.registryRevision, modelVersionId: scope.modelVersionId, aggregateId: scope.aggregateId, artifactId: scope.artifactId,
      projectionSha256: scope.projectionSha256, captureFrameId: scope.captureFrameId, qualifiedProjectFrameId: null, status: 'confirmed', mode: 'fixed-world',
      pointProjectMetres: [21, 2, 3], derivation: 'manual-world-point', sourceObject: null, attachment: null, sourceDecisionId: null, supersedesBindingId: null,
      legacyObservationId: null, priorPointProjectMetres: null, priorCaptureFrameId: null, displacementBasis: 'none', displacementVectorMetres: null,
      displacementMetres: null, confirmedBy: actor, confirmedAt: '2026-10-20T00:00:00Z', reason: 'Existing saved To location', contentSha256: 'd'.repeat(64) } };
}
function selection(sdkObjectId = 55): ViewerSelection { return { coordinateFrame: 'world-metres-z-up', metresPerDisplayUnit: 1, globalOffsetMetres: [0, 0, 0], objects: [{ objectId: sdkObjectId,
  parentId: null, name: 'Selected equipment ' + sdkObjectId, externalId: null, bounds: { minimum: [0, 1, 3], maximum: [2, 3, 5] }, bottomCentre: [1, 2, 3], derivation: 'display-aabb-bottom-centre', nativeVisibility: 'unknown', properties: [], propertiesTruncated: false }] }; }
function receipt(command: CableEndpointPairCommand, deduplicate = false): CableEndpointPairReceipt {
  // This hook trusts the independently verified API boundary. These minimal
  // typed API stubs exercise only orchestration/callback/recovery ownership.
  return { schemaVersion: 'wfc.pf.cable-endpoint-pair-receipt.v1', projectId: project, actorId: actor, cableId: cable,
    idempotencyKey: command.idempotencyKey, commandSha256: 'c'.repeat(64), expectedCableWriteRevision: '4', expectedContexts: command.expectedContexts, finalRegistryRevision: '6', duplicate: false,
    receipts: command.endpoints.map((item, index) => ({ end: item.end, projectId: project, cableId: cable, actorId: actor,
      locationId: id(deduplicate ? 70 : 70 + index), locationImpact: { id: id(deduplicate ? 80 : 80 + index), status: item.command.calculation === null ? 'blocked' : 'pending' }, idempotencyKey: item.command.idempotencyKey })) } as unknown as CableEndpointPairReceipt;
}
const access = (): CableEndpointPairSelectionAccess => ({ projectId: project, loadedProjectId: project, accountId: actor, token: 'current-private-token', isAdmin: true, active: true,
  cableId: cable, model: { modelVersionId: scope.modelVersionId, selectionRevision: scope.selectionRevision, contentFingerprint: scope.contentFingerprint }, preparationKey: 'current-preparation',
  calculation, initialFill: { mode: 'when-both-empty' }, readSelection: vi.fn(async () => selection()), onSaved: vi.fn(), onAuthorityLost: vi.fn() });
function legacyCommand(): CableEndpointCommand {
  const current = context(); return { schemaVersion: 'wfc.pf.cable-endpoint-command.v3', idempotencyKey: id(90), initialFill: { mode: 'when-both-empty' }, calculation,
    expectedContextSha256: current.contextSha256, expectedCableWriteRevision: '4', expectedLogicalName: 'LP-001', expectedRegistryRevision: '5', expectedLocationId: null,
    expectedLocationRevision: null, expectedHeadId: null, expectedCurrent: scope, reason: 'Synthetic prior unknown command', selection: { mode: 'fixed-world', pointProjectMetres: [1, 2, 3], derivation: 'manual-world-point', displaySdkObjectId: null } };
}
const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); automatic = saved = false;
  const queues = new Map<string, Promise<unknown>>();
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: vi.fn((name: string, options: LockOptions, work: (lock: Lock) => unknown) => {
    const previous = queues.get(name) ?? Promise.resolve(), task = previous.then(() => { options.signal?.throwIfAborted(); return work({} as Lock); }); queues.set(name, task.catch(() => undefined)); return task;
  }) } });
  vi.mocked(fetchCableEndpointContext).mockImplementation(async (_project, _token, selected, end) => context(selected, end));
  vi.mocked(fetchCableEndpointSelection).mockImplementation(async (_project, _token, current, sdk) => ({ schemaVersion: 'wfc.pf.cable-endpoint-selection-response.v1', projectId: project, cableId: current.cableId, end: current.end,
    contextSha256: current.contextSha256, selection: { schemaVersion: 'wfc.pf.cable-endpoint-selection.v1', projectId: project, current: current.current!, sdkObjectId: sdk,
      status: 'available', reasonCodes: [], object: object(sdk), pointProjectMetres: [sdk, 2, 3], bounds: { minimum: [sdk - 1, 1, 3], maximum: [sdk + 1, 3, 5] }, approximate: true, derivation: 'equipment-bottom-aabb.v1' } }));
  vi.mocked(saveCableEndpointPair).mockImplementation(async (_project, _token, _cable, command) => { saved = true; return receipt(command); });
});
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); if (originalLocks) Object.defineProperty(navigator, 'locks', originalLocks); else Reflect.deleteProperty(navigator, 'locks'); });
async function ready(view: { result: { current: ReturnType<typeof useCableEndpointPairSelection> } }) { await waitFor(() => expect(view.result.current.from.context && view.result.current.to.context && view.result.current.storageReady && !view.result.current.busy).toBeTruthy()); }

describe('one explicit From/To Save', () => {
  it('saves changed From with an untouched saved To and explicit null routing policy in one exact pair command', async () => {
    const originalTo = savedToContext(context(cable, 'to'));
    vi.mocked(fetchCableEndpointContext).mockImplementation(async (_project, _token, selected, end) => end === 'to' ? savedToContext(context(selected, end)) : context(selected, end));
    const props = { ...access(), calculation: null, initialFill: null }, view = renderHook(() => useCableEndpointPairSelection(props)); await ready(view);
    expect(view.result.current.to.context?.head?.id).toBe(originalTo.head!.id); expect(view.result.current.to.draft).toBeNull();
    await act(async () => { await view.result.current.from.selectObject(); }); expect(view.result.current.canSave).toBe(true);
    await act(async () => { expect(await view.result.current.save('Save the changed From location before routing')).toBe(true); });
    expect(saveCableEndpointPair).toHaveBeenCalledOnce(); expect(saveCableEndpoint).not.toHaveBeenCalled();
    const command = vi.mocked(saveCableEndpointPair).mock.calls[0][3];
    expect(command.expectedContexts).toEqual({ from: 'a'.repeat(64), to: 'b'.repeat(64) }); expect(command.endpoints).toHaveLength(1);
    expect(command.endpoints[0]).toMatchObject({ end: 'from', command: { calculation: null, initialFill: null, expectedContextSha256: 'a'.repeat(64),
      expectedLogicalName: 'LP-001', expectedCableWriteRevision: '4', expectedRegistryRevision: '5', selection: { mode: 'object-derived', sdkObjectId: 55 } } });
    expect(view.result.current.receipt?.receipts[0].locationImpact?.status).toBe('blocked');
    expect(props.onSaved).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ end: 'from' }), scope, null);
    expect(view.result.current.notice).toContain('No routing calculation was queued'); expect(view.result.current.notice).toContain('Configure routing and calculate again');
    expect(view.result.current.notice).not.toContain('calculations are queued'); expect(readPendingCableEndpointPair(owner)).toBeNull();
    await waitFor(() => expect(view.result.current.retired).toBe(false)); expect(view.result.current.to.context?.head?.id).toBe(originalTo.head!.id);
    expect(view.result.current.to.context?.head?.pointProjectMetres).toEqual(originalTo.head!.pointProjectMetres);
  });
  it.each([true, false])('recovery reports its original endpoint-only=%s command after live routing preferences change', async endpointOnly => {
    automatic = true; vi.mocked(saveCableEndpointPair).mockRejectedValueOnce(new CableEndpointApiError('REQUEST_TIMEOUT', null, 'Unknown original Save'));
    const props: CableEndpointPairSelectionAccess = { ...access(), ...(endpointOnly ? { calculation: null, initialFill: null } : {}) };
    const view = renderHook(value => useCableEndpointPairSelection(value), { initialProps: props }); await ready(view);
    await act(async () => { expect(await view.result.current.save('Retain the original explicit policy')).toBe(false); });
    const pending = readPendingCableEndpointPair(owner)!; expect(pending.command.endpoints[0].command.calculation).toEqual(endpointOnly ? null : calculation);
    view.rerender({ ...props, calculation: endpointOnly ? calculation : null, initialFill: endpointOnly ? { mode: 'when-both-empty' } : null });
    await ready(view); await waitFor(() => expect(view.result.current.canRetry).toBe(true));
    await act(async () => { expect(await view.result.current.retry()).toBe(true); });
    expect(vi.mocked(saveCableEndpointPair).mock.calls[1][3]).toEqual(pending.command);
    expect(props.onSaved).toHaveBeenCalledWith(expect.anything(), scope, endpointOnly ? null : calculation);
    if (endpointOnly) {
      expect(view.result.current.notice).toContain('No routing calculation was queued'); expect(view.result.current.notice).not.toContain('recalculation was requested');
    } else {
      expect(view.result.current.notice).toContain('recalculation was requested using the saved routing settings'); expect(view.result.current.notice).not.toContain('No routing calculation was queued');
    }
    expect(readPendingCableEndpointPair(owner)).toBeNull(); expect(saveCableEndpoint).not.toHaveBeenCalled();
  });
  it('Assign only reads selections; one Save retains both original contexts and drafts before its single PUT', async () => {
    const props = access(), view = renderHook(() => useCableEndpointPairSelection(props)); await ready(view);
    await act(async () => { await view.result.current.from.selectObject(); await view.result.current.to.selectObject(); });
    expect(saveCableEndpoint).not.toHaveBeenCalled(); expect(saveCableEndpointPair).not.toHaveBeenCalled();
    expect(view.result.current.from).not.toHaveProperty('save'); expect(view.result.current.to).not.toHaveProperty('applySelectedObject');
    expect(view.result.current.from.draftSource).toBe('selected'); expect(view.result.current.canSave).toBe(true);
    vi.mocked(saveCableEndpointPair).mockImplementationOnce(async (_project, _token, _cable, command) => {
      expect(readPendingCableEndpointPair(owner)?.command).toEqual(command); expect(command.endpoints.map(item => item.end)).toEqual(['from', 'to']);
      expect(command.expectedContexts).toEqual({ from: 'a'.repeat(64), to: 'b'.repeat(64) });
      expect(new Set([command.idempotencyKey, ...command.endpoints.map(item => item.command.idempotencyKey)]).size).toBe(3);
      expect(command.endpoints[0].command).toMatchObject({ schemaVersion: 'wfc.pf.cable-endpoint-command.v3', calculation, initialFill: { mode: 'when-both-empty' }, selection: { mode: 'object-derived', sdkObjectId: 55 } });
      saved = true; return receipt(command);
    });
    await act(async () => { expect(await view.result.current.save('Confirm both endpoint assignments')).toBe(true); });
    expect(saveCableEndpointPair).toHaveBeenCalledOnce(); expect(props.onSaved).toHaveBeenCalledTimes(2); expect(readPendingCableEndpointPair(owner)).toBeNull();
    await waitFor(() => expect(view.result.current.retired).toBe(false)); expect(view.result.current.from.draft).toBeNull(); expect(view.result.current.to.draft).toBeNull();
  });
  it('offers automatic unconfirmed objects as Save drafts without any Assign or write', async () => {
    automatic = true; const props = access(), view = renderHook(() => useCableEndpointPairSelection(props)); await ready(view);
    expect(view.result.current.from.draftSource).toBe('automatic'); expect(view.result.current.to.draftSource).toBe('automatic'); expect(view.result.current.canSave).toBe(true);
    expect(props.readSelection).not.toHaveBeenCalled(); expect(saveCableEndpointPair).not.toHaveBeenCalled();
    await act(async () => { expect(await view.result.current.save('Confirm available automatic points')).toBe(true); });
    expect(vi.mocked(saveCableEndpointPair).mock.calls[0][3].endpoints.map(item => item.command.selection)).toEqual([
      { mode: 'object-derived', sdkObjectId: 20, object: object(20) }, { mode: 'object-derived', sdkObjectId: 21, object: object(21) }]);
  });
  it('an explicit Assign overrides only its automatic endpoint and duplicate impacts notify once', async () => {
    automatic = true; const props = access(), view = renderHook(() => useCableEndpointPairSelection(props)); await ready(view);
    await act(async () => { await view.result.current.from.selectObject(); }); expect(view.result.current.from.draftSource).toBe('selected'); expect(view.result.current.to.draftSource).toBe('automatic');
    vi.mocked(saveCableEndpointPair).mockImplementationOnce(async (_p, _t, _c, command) => { saved = true; return receipt(command, true); });
    await act(async () => { expect(await view.result.current.save('Confirm shared location once')).toBe(true); });
    expect(vi.mocked(saveCableEndpointPair).mock.calls[0][3].endpoints.map(item => item.command.selection.mode === 'object-derived' && item.command.selection.sdkObjectId)).toEqual([55, 21]); expect(props.onSaved).toHaveBeenCalledOnce();
  });
  it('preserves both drafts and exact pending body after failure; Retry never creates new keys or a replacement body', async () => {
    automatic = true; vi.mocked(saveCableEndpointPair).mockRejectedValueOnce(new CableEndpointApiError('REQUEST_TIMEOUT', null, 'Unknown pair outcome'));
    const props = access(), view = renderHook(() => useCableEndpointPairSelection(props)); await ready(view);
    await act(async () => { expect(await view.result.current.save('Keep the exact command')).toBe(false); });
    const pending = readPendingCableEndpointPair(owner); expect(pending).not.toBeNull(); expect(view.result.current.from.draftSource).toBe('automatic'); expect(view.result.current.to.draftSource).toBe('automatic'); expect(view.result.current.canRetry).toBe(true);
    await act(async () => { expect(await view.result.current.save('Do not replace')).toBe(false); await view.result.current.from.selectObject(); });
    expect(props.readSelection).not.toHaveBeenCalled(); expect(readPendingCableEndpointPair(owner)).toEqual(pending);
    await act(async () => { expect(await view.result.current.retry()).toBe(true); });
    expect(vi.mocked(saveCableEndpointPair).mock.calls[1][3]).toEqual(pending!.command); expect(saveCableEndpoint).not.toHaveBeenCalled();
  });
  it('Close sends the exact retained pair and never reports a closed tombstone as a save', async () => {
    automatic = true; vi.mocked(saveCableEndpointPair).mockRejectedValueOnce(new CableEndpointApiError('REQUEST_TIMEOUT', null, 'Unknown'));
    const props = access(), view = renderHook(() => useCableEndpointPairSelection(props)); await ready(view);
    await act(async () => { await view.result.current.save('Retain for close'); }); const pending = readPendingCableEndpointPair(owner)!;
    vi.mocked(closePendingCableEndpointPair).mockResolvedValueOnce({ schemaVersion: 'wfc.pf.cable-endpoint-pair-recovery.v1', status: 'closed', closure: {
      schemaVersion: 'wfc.pf.cable-endpoint-pair-closed.v1', projectId: project, actorId: actor, cableId: cable, idempotencyKey: pending.command.idempotencyKey,
      commandSha256: 'a'.repeat(64), expectedCableWriteRevision: '4', expectedContexts: pending.command.expectedContexts } });
    await act(async () => { expect(await view.result.current.closePending()).toBe(true); });
    expect(vi.mocked(closePendingCableEndpointPair).mock.calls[0][3]).toEqual(pending.command); expect(props.onSaved).not.toHaveBeenCalled(); expect(readPendingCableEndpointPair(owner)).toBeNull();
  });
  it('keeps a legacy unknown command untouched and refuses pair retention or assignment', async () => {
    const old = await retainPendingCableEndpoint(owner, cable, 'from', legacyCommand()); automatic = true;
    const props = access(), view = renderHook(() => useCableEndpointPairSelection(props)); await ready(view); expect(view.result.current.canSave).toBe(false);
    await act(async () => { expect(await view.result.current.save('Blocked by legacy recovery')).toBe(false); await view.result.current.from.selectObject(); });
    expect(props.readSelection).not.toHaveBeenCalled(); expect(saveCableEndpointPair).not.toHaveBeenCalled(); expect(readPendingCableEndpoint(owner)).toEqual(old); expect(readPendingCableEndpointPair(owner)).toBeNull();
  });
  it('reconciles the exact earlier endpoint from another cable and refreshes both readers before a pair Save', async () => {
    const original = await retainPendingCableEndpoint(owner, id(777), 'to', legacyCommand()); automatic = true;
    vi.mocked(closePendingCableEndpoint).mockResolvedValueOnce({ schemaVersion: 'wfc.pf.cable-endpoint-recovery.v1', status: 'closed', closure: {
      schemaVersion: 'wfc.pf.cable-endpoint-closed.v1', projectId: project, actorId: actor, cableId: original.cableId, end: original.end,
      idempotencyKey: original.command.idempotencyKey, commandSha256: 'a'.repeat(64), expectedCableWriteRevision: '4', expectedContextSha256: 'a'.repeat(64) } });
    const props = access(), view = renderHook(() => useCableEndpointPairSelection(props)); await ready(view);
    expect(view.result.current.legacyRecovery).toMatchObject({ cableId: id(777), end: 'to', canRetry: true });
    await act(async () => { expect(await view.result.current.legacyRecovery!.close()).toBe(true); });
    expect(closePendingCableEndpoint).toHaveBeenCalledExactlyOnceWith(project, props.token, original.cableId, 'to', original.command, actor, expect.any(AbortSignal));
    expect(readPendingCableEndpoint(owner)).toBeNull(); expect(saveCableEndpointPair).not.toHaveBeenCalled(); expect(props.onSaved).not.toHaveBeenCalled();
    await waitFor(() => { expect(view.result.current.legacyRecovery).toBeNull(); expect(view.result.current.retired).toBe(false); expect(view.result.current.canSave).toBe(true); });
    expect(view.result.current.from.canSelect).toBe(true); expect(view.result.current.to.canSelect).toBe(true);
  });
  it('keeps earlier recovery available after an unknown retry without creating a pair command', async () => {
    const original = await retainPendingCableEndpoint(owner, cable, 'from', legacyCommand()); automatic = true;
    vi.mocked(saveCableEndpoint).mockRejectedValueOnce(new CableEndpointApiError('REQUEST_TIMEOUT', null, 'Unknown earlier save'));
    const props = access(), view = renderHook(() => useCableEndpointPairSelection(props)); await ready(view);
    await act(async () => { expect(await view.result.current.legacyRecovery!.retry()).toBe(false); });
    expect(vi.mocked(saveCableEndpoint).mock.calls[0].slice(2, 5)).toEqual([cable, 'from', original.command]);
    expect(readPendingCableEndpoint(owner)).toEqual(original); expect(view.result.current.canSave).toBe(false); expect(view.result.current.legacyRecovery?.canRetry).toBe(true);
    expect(saveCableEndpointPair).not.toHaveBeenCalled(); expect(props.onSaved).not.toHaveBeenCalled();
  });
  it.each(['account', 'model', 'cable', 'preparation'] as const)('does not clear or report a late save after %s ownership changes', async kind => {
    automatic = true; let finish!: (value: CableEndpointPairReceipt) => void;
    vi.mocked(saveCableEndpointPair).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const props = access(), view = renderHook(value => useCableEndpointPairSelection(value), { initialProps: props }); await ready(view);
    let operation!: Promise<boolean>; act(() => { operation = view.result.current.save('Owned pending pair'); }); await waitFor(() => expect(saveCableEndpointPair).toHaveBeenCalledOnce());
    const retained = readPendingCableEndpointPair(owner)!;
    view.rerender({ ...props, ...(kind === 'account' ? { accountId: id(100), token: 'different-private-token' } : kind === 'model' ? { model: { ...props.model!, selectionRevision: '99' } }
      : kind === 'cable' ? { cableId: id(101) } : { preparationKey: 'new-preparation' }) });
    await act(async () => { finish(receipt(retained.command)); expect(await operation).toBe(false); });
    expect(readPendingCableEndpointPair(owner)).toEqual(retained); expect(props.onSaved).not.toHaveBeenCalled();
  });
  it('denies current-role failures without clearing pending recovery or revealing contexts', async () => {
    automatic = true; vi.mocked(saveCableEndpointPair).mockRejectedValueOnce(new CableEndpointApiError('DENIED', 403, 'Denied'));
    const props = access(), view = renderHook(() => useCableEndpointPairSelection(props)); await ready(view);
    await act(async () => { expect(await view.result.current.save('Current admin only')).toBe(false); });
    expect(props.onAuthorityLost).toHaveBeenCalledOnce(); expect(view.result.current.from.context).toBeNull(); expect(view.result.current.to.context).toBeNull(); expect(view.result.current.canRetry).toBe(false); expect(readPendingCableEndpointPair(owner)).not.toBeNull();
  });
  it('requires an explicit v3 policy and coherent original contexts; empty selections cannot write', async () => {
    const props = access(), view = renderHook(() => useCableEndpointPairSelection(props)); await ready(view);
    expect(view.result.current.canSave).toBe(false); await act(async () => { expect(await view.result.current.save('No drafts')).toBe(false); }); expect(saveCableEndpointPair).not.toHaveBeenCalled();
    automatic = true; const disabled = renderHook(() => useCableEndpointPairSelection({ ...access(), initialFill: undefined })); await ready(disabled); expect(disabled.result.current.canSave).toBe(false);
    await act(async () => { expect(await disabled.result.current.save('No implicit policy')).toBe(false); }); expect(saveCableEndpointPair).not.toHaveBeenCalled();
  });
  it('serializes concurrent Assign actions without performing a Save', async () => {
    let selected!: (value: ViewerSelection) => void;
    const props = { ...access(), readSelection: vi.fn(() => new Promise<ViewerSelection>(resolve => { selected = resolve; })) };
    const view = renderHook(() => useCableEndpointPairSelection(props)); await ready(view);
    let first!: Promise<void>, second!: Promise<void>;
    act(() => { first = view.result.current.from.selectObject(); second = view.result.current.to.selectObject(); });
    await waitFor(() => expect(props.readSelection).toHaveBeenCalledOnce());
    await act(async () => { selected(selection()); await Promise.all([first, second]); });
    expect(view.result.current.from.draftSource).toBe('selected'); expect(view.result.current.to.draft).toBeNull();
    expect(saveCableEndpointPair).not.toHaveBeenCalled();
  });
  it('retains confirmed Save retirement across pause and ignores obsolete refresh completions', async () => {
    automatic = true;
    const waiting: { end: 'from' | 'to'; resolve: (value: CableEndpointContext) => void }[] = [];
    vi.mocked(fetchCableEndpointContext).mockImplementation(async (_project, _token, selected, end) => saved
      ? new Promise<CableEndpointContext>(resolve => { waiting.push({ end, resolve }); }) : context(selected, end));
    const props = access(), view = renderHook(value => useCableEndpointPairSelection(value), { initialProps: props }); await ready(view);
    await act(async () => { expect(await view.result.current.save('Confirm and refresh both endpoints')).toBe(true); });
    await waitFor(() => expect(waiting).toHaveLength(2));
    expect(view.result.current.retired).toBe(true); expect(view.result.current.from.context).toBeNull();
    view.rerender({ ...props, active: false });
    await act(async () => { await Promise.resolve(); });
    view.rerender(props);
    await waitFor(() => expect(waiting).toHaveLength(4));
    await act(async () => { for (const item of waiting.slice(0, 2)) item.resolve(context(cable, item.end)); });
    expect(view.result.current.retired).toBe(true); expect(view.result.current.canSave).toBe(false); expect(view.result.current.from.context).toBeNull();
    await act(async () => { for (const item of waiting.slice(2)) item.resolve(context(cable, item.end)); });
    await waitFor(() => expect(view.result.current.retired).toBe(false));
    expect(view.result.current.from.context?.registryRevision).toBe('6'); expect(saveCableEndpointPair).toHaveBeenCalledOnce();
  });
  it('keeps contexts retired after a failed post-Save read until an explicit successful refresh', async () => {
    automatic = true;
    const props = access(), view = renderHook(() => useCableEndpointPairSelection(props)); await ready(view);
    vi.mocked(fetchCableEndpointContext).mockRejectedValue(new CableEndpointApiError('REQUEST_TIMEOUT', null, 'Read unavailable'));
    await act(async () => { expect(await view.result.current.save('Preserve confirmed disposition')).toBe(true); });
    await waitFor(() => expect(view.result.current.error).toContain('Refresh both endpoint contexts'));
    expect(view.result.current.retired).toBe(true); expect(view.result.current.canSave).toBe(false); expect(readPendingCableEndpointPair(owner)).toBeNull();
    vi.mocked(fetchCableEndpointContext).mockImplementation(async (_project, _token, selected, end) => context(selected, end));
    act(() => { view.result.current.refresh(); });
    await waitFor(() => expect(view.result.current.retired).toBe(false)); expect(props.onSaved).toHaveBeenCalledTimes(2);
  });
  it('reports simultaneous current-role denials only once and never exposes either old context', async () => {
    vi.mocked(fetchCableEndpointContext).mockRejectedValue(new CableEndpointApiError('DENIED', 403, 'Denied'));
    const props = access(), view = renderHook(() => useCableEndpointPairSelection(props));
    await waitFor(() => expect(props.onAuthorityLost).toHaveBeenCalledOnce());
    expect(view.result.current.from.context).toBeNull(); expect(view.result.current.to.context).toBeNull(); expect(view.result.current.canSave).toBe(false);
  });
});

describe('explicit selected-object bottom-centre pair assignment', () => {
  it.each(['SDK_OBJECT_NOT_RETAINED', 'SDK_OBJECT_GEOMETRY_NOT_RETAINED', 'SDK_OBJECT_EQUIPMENT_GEOMETRY_REQUIRED'])('stages both unprepared selected objects for %s and sends their lower-face points in one explicit Save', async reason => {
    vi.mocked(fetchCableEndpointSelection).mockImplementation(async (_project, _token, current, sdk) => ({
      schemaVersion: 'wfc.pf.cable-endpoint-selection-response.v1', projectId: project, cableId: current.cableId, end: current.end,
      contextSha256: current.contextSha256, selection: { schemaVersion: 'wfc.pf.cable-endpoint-selection.v1', projectId: project,
        current: current.current!, sdkObjectId: sdk, status: reason === 'SDK_OBJECT_EQUIPMENT_GEOMETRY_REQUIRED' ? 'unsupported' : 'unavailable',
        reasonCodes: [reason], object: null, pointProjectMetres: null, bounds: null, approximate: true, derivation: null } }));
    const props = access(), view = renderHook(() => useCableEndpointPairSelection(props)); await ready(view);
    await act(async () => { await view.result.current.from.selectObject(); await view.result.current.to.selectObject(); });
    expect(view.result.current.from.draft).toEqual({ mode: 'fixed-world', point: [1, 2, 3], derivation: 'manual-world-point', displaySdkObjectId: 55 });
    expect(view.result.current.to.draft?.point).toEqual([1, 2, 3]);
    expect(view.result.current.from.context?.logicalName).toBe('LP-001'); expect(view.result.current.to.context?.logicalName).toBe('LP-002');
    expect(view.result.current.from.displaySelection?.name).toBe('Selected equipment 55');
    expect(saveCableEndpointPair).not.toHaveBeenCalled(); expect(saveCableEndpoint).not.toHaveBeenCalled();
    expect(readPendingCableEndpointPair(owner)).toBeNull(); expect(view.result.current.canSave).toBe(true);
    await act(async () => { expect(await view.result.current.save('Confirm selected lower-face centres')).toBe(true); });
    expect(saveCableEndpointPair).toHaveBeenCalledOnce();
    const command = vi.mocked(saveCableEndpointPair).mock.calls[0][3];
    expect(command.endpoints.map(item => [item.end, item.command.expectedLogicalName, item.command.selection])).toEqual([
      ['from', 'LP-001', { mode: 'fixed-world', pointProjectMetres: [1, 2, 3], derivation: 'manual-world-point', displaySdkObjectId: 55, displayObjectName: 'Selected equipment 55' }],
      ['to', 'LP-002', { mode: 'fixed-world', pointProjectMetres: [1, 2, 3], derivation: 'manual-world-point', displaySdkObjectId: 55, displayObjectName: 'Selected equipment 55' }],
    ]);
    expect(readPendingCableEndpointPair(owner)).toBeNull(); expect(props.onSaved).toHaveBeenCalledTimes(2);
  });
});
