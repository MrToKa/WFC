import { useCallback, useEffect, useRef, useState } from 'react';
import { isCanonicalPoint, type CanonicalPoint, type ViewerSelection } from '../../viewer-runtime/protocol.mjs';
import { endpointPointSchema, type EndpointCurrentScope, type EndpointObjectRef } from '../../shared/pathfinderEndpointBindings';
import { cableEndpointCommandSchema } from '../../shared/pathfinderCableEndpoints';
import { canonicalPurposeJson, policyUuidSchema } from '../../shared/pathfinderPurposePolicy';
import { locationImpactCalculationSchema, type LocationImpactCalculation } from '../../shared/pathfinderLocationImpacts';
import {
  CableEndpointApiError, fetchCableEndpointContext, fetchCableEndpointSelection, saveCableEndpoint, closePendingCableEndpoint,
  type CableEndpointContext, type CableEndpointEnd, type CableEndpointReceipt,
} from '@/api/pathfinderCableEndpoints';
import { pathFinderRequestDeadline } from '@/api/pathfinderRequestDeadline';
import { readPendingCableEndpoint, retainPendingCableEndpoint, verifyPendingCableEndpoint, clearPendingCableEndpoint,
  CABLE_ENDPOINT_PENDING_PREFIX, CableEndpointStorageError, type PendingCableEndpoint } from './cableEndpointPendingStore';

type Model = Pick<EndpointCurrentScope, 'modelVersionId' | 'selectionRevision' | 'contentFingerprint'>;
export type CableEndpointSelectionAccess = {
  projectId: string | null; loadedProjectId: string | null; accountId: string | null; token: string | null;
  isAdmin: boolean; active: boolean; cableId: string | null; end: CableEndpointEnd; model: Model | null; preparationKey: string;
  calculation?: LocationImpactCalculation | null;
  readSelection: () => Promise<ViewerSelection | null>;
  onSaved?: (receipt: CableEndpointReceipt) => void | Promise<void>; onAuthorityLost?: () => void;
};
type Draft = { mode: 'object-derived'; sdkObjectId: number; object: EndpointObjectRef; point: CanonicalPoint }
  | { mode: 'fixed-world'; point: CanonicalPoint; derivation: 'manual-world-point' | 'picked-surface-point'; displaySdkObjectId: number | null };
type DisplaySelection = { sdkObjectId: number; name: string; point: CanonicalPoint };
type State = { identity: string; context: CableEndpointContext | null; draft: Draft | null; displaySelection: DisplaySelection | null;
  pending: PendingCableEndpoint | null; storageReady: boolean; busy: boolean; error: string | null; notice: string | null; receipt: CableEndpointReceipt | null };
const initial = (identity: string): State => ({ identity, context: null, draft: null, displaySelection: null, pending: null, storageReady: false, busy: false, error: null, notice: null, receipt: null });
const storageNotice = 'Endpoint recovery storage is unavailable or invalid. No new save will be sent. Preserve this browser storage for reconciliation.';
const unknownNotice = 'The save outcome is unconfirmed. Its exact command is retained. Reconcile it before saving another endpoint.';
const modelMatches = (scope: EndpointCurrentScope | null, expected: Model | null) => expected === null ? scope === null
  : scope !== null && scope.modelVersionId === expected.modelVersionId && scope.selectionRevision === expected.selectionRevision && scope.contentFingerprint === expected.contentFingerprint;
function selectedObject(value: ViewerSelection | null): DisplaySelection | null {
  if (!value || value.coordinateFrame !== 'world-metres-z-up' || !Number.isFinite(value.metresPerDisplayUnit) || value.metresPerDisplayUnit <= 0
    || !isCanonicalPoint(value.globalOffsetMetres) || !Array.isArray(value.objects) || value.objects.length !== 1) return null;
  const object = value.objects[0];
  if (!Number.isSafeInteger(object.objectId) || object.objectId < 1 || object.objectId > 2147483647 || !isCanonicalPoint(object.bottomCentre)
    || !object.bounds || !isCanonicalPoint(object.bounds.minimum) || !isCanonicalPoint(object.bounds.maximum)
    || object.bounds.minimum.some((number, index) => number > object.bounds!.maximum[index])) return null;
  const bottom: CanonicalPoint = [(object.bounds.minimum[0] + object.bounds.maximum[0]) / 2,
    (object.bounds.minimum[1] + object.bounds.maximum[1]) / 2, object.bounds.minimum[2]];
  if (!isCanonicalPoint(bottom) || bottom.some((number, index) => number !== object.bottomCentre![index])) return null;
  return { sdkObjectId: object.objectId, name: object.name, point: [...object.bottomCentre] };
}

/** Reusable editor foundation. Reads and explicit shared binding only; no routing/length writes. */
export function useCableEndpointSelection(access: CableEndpointSelectionAccess) {
  const modelKey = JSON.stringify(access.model);
  const parsedCalculation = locationImpactCalculationSchema.nullable().safeParse(access.calculation ?? null);
  const calculationKey = parsedCalculation.success ? canonicalPurposeJson(parsedCalculation.data) : null;
  const account = JSON.stringify([access.projectId, access.loadedProjectId, access.accountId, access.token, access.isAdmin]);
  const identity = JSON.stringify([account, access.cableId, access.end, access.model, access.preparationKey, calculationKey]);
  const allowed = Boolean(access.isAdmin && access.token && policyUuidSchema.safeParse(access.accountId).success
    && policyUuidSchema.safeParse(access.projectId).success && access.projectId === access.loadedProjectId);
  const [state, setState] = useState<State>(() => initial(identity));
  const current = state.identity === identity && allowed ? state : initial(identity);
  const data = useRef(current); data.current = current;
  const latest = useRef({ identity, allowed, active: access.active }); latest.current = { identity, allowed, active: access.active };
  const callbacks = useRef(access); callbacks.current = access;
  const mounted = useRef(false), request = useRef<AbortController | null>(null), denied = useRef<string | null>(null);
  const live = useCallback(() => mounted.current && latest.current.identity === identity && latest.current.allowed, [identity]);
  const owner = useCallback(() => ({ accountId: access.accountId!, projectId: access.projectId! }), [access.accountId, access.projectId]);
  const canAct = useCallback(() => live() && latest.current.active && denied.current !== account && request.current === null, [live, account]);
  const update = useCallback((value: Partial<State>) => { if (live()) setState(previous => ({ ...previous, ...value })); }, [live]);
  const failure = useCallback((error: unknown) => {
    if (!live()) return;
    let pending: PendingCableEndpoint | null;
    try { pending = readPendingCableEndpoint(owner()); } catch { update({ storageReady: false, error: storageNotice }); return; }
    if (error instanceof CableEndpointApiError && [401, 403].includes(error.status ?? 0)) {
      denied.current = account; update({ context: null, draft: null, displaySelection: null, pending, error: error.message }); callbacks.current.onAuthorityLost?.();
    } else update({ pending, error: pending ? unknownNotice : error instanceof CableEndpointApiError ? error.message : 'Endpoint selection could not be completed. Refresh its current context.' });
  }, [live, owner, update, account]);
  const runRead = useCallback(async (work: (signal: AbortSignal) => Promise<void>) => {
    if (!canAct()) return;
    const abort = new AbortController(); request.current = abort; update({ busy: true, error: null });
    const deadline = pathFinderRequestDeadline(abort.signal, 30_000, () => new CableEndpointApiError('REQUEST_TIMEOUT', null, 'Reading the selected endpoint timed out. Try selecting the current object again.'));
    try { await deadline.wait(() => work(deadline.signal)); }
    catch (error) { if (!abort.signal.aborted) failure(error); }
    finally { deadline.dispose(); if (request.current === abort) { request.current = null; update({ busy: false }); } }
  }, [canAct, update, failure]);
  const loadContext = useCallback(() => runRead(async signal => {
    if (!access.cableId) return;
    const context = await fetchCableEndpointContext(access.projectId!, access.token!, access.cableId, access.end, signal);
    if (!live() || signal.aborted) return;
    if (!modelMatches(context.current, JSON.parse(modelKey))) throw new CableEndpointApiError('MODEL_CHANGED', 409, 'The prepared model changed. Refresh this cable before selecting an endpoint.', 'refused');
    update({ context, draft: null, displaySelection: null, notice: data.current.receipt ? data.current.notice : null });
  }), [runRead, access.cableId, access.projectId, access.token, access.end, modelKey, live, update]);
  useEffect(() => {
    mounted.current = true; request.current?.abort(); request.current = null;
    setState(initial(identity));
    if (allowed) {
      let storageOkay = true;
      try { const pending = readPendingCableEndpoint(owner()); setState({ ...initial(identity), pending, storageReady: true, notice: pending ? unknownNotice : null }); }
      catch { storageOkay = false; setState({ ...initial(identity), error: storageNotice }); }
      if (storageOkay && latest.current.active && access.cableId && denied.current !== account) void loadContext();
    }
    const observe = (event: StorageEvent) => {
      if (event.key !== null && !event.key.startsWith(CABLE_ENDPOINT_PENDING_PREFIX) || !live()) return;
      try { update({ pending: readPendingCableEndpoint(owner()), storageReady: true }); } catch { update({ storageReady: false, error: storageNotice }); }
    };
    window.addEventListener('storage', observe);
    return () => { mounted.current = false; request.current?.abort(); request.current = null; window.removeEventListener('storage', observe); };
  }, [identity, allowed, account, access.cableId, owner, loadContext, live, update]);
  useEffect(() => {
    if (!allowed) return;
    if (!access.active) { request.current?.abort(); request.current = null; update({ busy: false }); return; }
    try { update({ pending: readPendingCableEndpoint(owner()) }); } catch { update({ storageReady: false, error: storageNotice }); return; }
    if (!data.current.context && request.current === null) void loadContext();
  }, [access.active, identity, allowed, owner, update, loadContext]);
  const selectObject = useCallback(() => runRead(async signal => {
    const context = data.current.context; if (!context?.canBind || !context.current || readPendingCableEndpoint(owner())) return;
    const display = selectedObject(await callbacks.current.readSelection()); if (!live() || signal.aborted) return;
    if (!display) { update({ draft: null, displaySelection: null, notice: 'Select exactly one current model object with a finite bounding-box bottom centre.' }); return; }
    update({ draft: null, displaySelection: display, notice: 'Checking retained geometry for the selected model object…' });
    const response = await fetchCableEndpointSelection(access.projectId!, access.token!, context, display.sdkObjectId, signal);
    if (!live() || signal.aborted) return;
    const evidence = response.selection;
    if (evidence.status === 'available' && evidence.object && evidence.pointProjectMetres) update({ draft: { mode: 'object-derived', sdkObjectId: display.sdkObjectId,
      object: evidence.object, point: evidence.pointProjectMetres }, notice: 'Verified retained geometry supplies the approximate bottom-centre anchor. The cable’s logical location name is preserved.' });
    else update({ draft: null, notice: 'The selected object has no usable verified retained geometry. You may explicitly use its displayed point as a fixed-world point; it will not follow model revisions.' });
  }), [runRead, owner, live, update, access.projectId, access.token]);
  const setFixedPoint = useCallback((point: CanonicalPoint, display: DisplaySelection | null = null) => {
    if (!canAct() || !data.current.context?.canBind || data.current.pending) return false;
    const parsed = endpointPointSchema.safeParse(point); if (!parsed.success) { update({ error: 'Enter three finite coordinates in project metres.' }); return false; }
    update({ draft: { mode: 'fixed-world', point: parsed.data, derivation: 'manual-world-point', displaySdkObjectId: display?.sdkObjectId ?? null },
      error: null, notice: 'This is an explicit fixed-world point in project metres. It does not follow an object revision.' }); return true;
  }, [canAct, update]);
  const execute = useCallback(async (intent: PendingCableEndpoint, abort: AbortController, mode: 'save' | 'close' = 'save'): Promise<boolean> => {
    try {
      const verified = await verifyPendingCableEndpoint(owner(), intent); if (!live() || !latest.current.active || abort.signal.aborted) return false;
      const recovery = mode === 'close' ? await closePendingCableEndpoint(access.projectId!, access.token!, verified.cableId, verified.end, verified.command, access.accountId!, abort.signal) : null;
      const receipt = recovery ? recovery.status === 'saved' ? recovery.receipt : null
        : await saveCableEndpoint(access.projectId!, access.token!, verified.cableId, verified.end, verified.command, access.accountId!, abort.signal);
      if (!live()) return false;
      // A verified disposition remains conclusive if the editor pauses while
      // its short storage transition runs. Retire the old head/context before
      // another assignment can be offered, even when no refresh can run yet.
      update({ context: null, receipt, draft: null });
      await clearPendingCableEndpoint(owner(), verified); if (!live()) return true;
      update({ pending: null, receipt, draft: null, notice: receipt ? 'The shared endpoint save is confirmed. Its matching From/To occurrences use the same location.'
        : 'The pending command was closed without saving an endpoint. Its original key can never be used to save later.', error: null });
      if (!latest.current.active || abort.signal.aborted) return true;
      try {
        if (access.cableId) {
          const context = await fetchCableEndpointContext(access.projectId!, access.token!, access.cableId, access.end, abort.signal);
          if (live() && !abort.signal.aborted) {
            if (!modelMatches(context.current, JSON.parse(modelKey))) throw new Error('Current model changed.');
            update({ context, displaySelection: null });
          }
        }
      } catch (error) {
        if (error instanceof CableEndpointApiError && [401, 403].includes(error.status ?? 0)) failure(error);
        else update({ error: receipt ? 'The shared endpoint save is confirmed. Refresh its current context before another assignment.'
          : 'The pending command is closed. Refresh the endpoint context before another assignment.', context: null });
      }
      try { if (receipt) await callbacks.current.onSaved?.(receipt); } catch { if (live()) update({ error: 'The shared endpoint was saved. Refresh the cable diagnostics to see its current state.' }); }
      return true;
    } catch (error) { if (!abort.signal.aborted) failure(error); return false; }
  }, [owner, live, access.projectId, access.token, access.accountId, access.cableId, access.end, modelKey, update, failure]);
  const save = useCallback(async (reason: string): Promise<boolean> => {
    const { context, draft, storageReady } = data.current;
    if (!canAct() || !storageReady || !context?.canBind || !context.logicalName || !context.current || !draft) return false;
    if (calculationKey === null) { update({ error: 'Use valid explicit calculation preferences and timeout before saving.' }); return false; }
    if (!reason.trim() || reason.length > 2048 || /[\u0000-\u001f\u007f-\u009f]/u.test(reason)) { update({ error: 'Enter a nonempty confirmation reason without control characters.' }); return false; }
    const abort = new AbortController(); request.current = abort; update({ busy: true, error: null });
    try {
      const command = cableEndpointCommandSchema.parse({ schemaVersion: 'wfc.pf.cable-endpoint-command.v2', calculation: JSON.parse(calculationKey), idempotencyKey: crypto.randomUUID(),
        expectedContextSha256: context.contextSha256, expectedCableWriteRevision: context.cableWriteRevision, expectedLogicalName: context.logicalName,
        expectedRegistryRevision: context.registryRevision, expectedLocationId: context.location?.id ?? null, expectedLocationRevision: context.location?.revision ?? null,
        expectedHeadId: context.head?.id ?? null, expectedCurrent: context.current, reason,
        selection: draft.mode === 'object-derived' ? { mode: draft.mode, sdkObjectId: draft.sdkObjectId, object: draft.object }
          : { mode: draft.mode, pointProjectMetres: draft.point, derivation: draft.derivation, displaySdkObjectId: draft.displaySdkObjectId } });
      const intent = await retainPendingCableEndpoint(owner(), context.cableId, context.end, command);
      if (!live() || abort.signal.aborted) return false;
      update({ pending: intent }); return await execute(intent, abort);
    } catch (error) { if (live()) { try { update({ pending: readPendingCableEndpoint(owner()), error: error instanceof CableEndpointStorageError ? error.message : storageNotice }); } catch { update({ storageReady: false, error: storageNotice }); } } return false; }
    finally { if (request.current === abort) { request.current = null; update({ busy: false }); } }
  }, [canAct, update, owner, live, execute, calculationKey]);
  const reconcile = useCallback(async (mode: 'save' | 'close'): Promise<boolean> => {
    if (!canAct() || !data.current.storageReady) return false;
    let pending: PendingCableEndpoint | null; try { pending = readPendingCableEndpoint(owner()); } catch { update({ error: storageNotice }); return false; }
    if (!pending) return false;
    const abort = new AbortController(); request.current = abort; update({ busy: true, error: null });
    try { return await execute(pending, abort, mode); }
    finally { if (request.current === abort) { request.current = null; update({ busy: false }); } }
  }, [canAct, owner, update, execute]);
  return { ...current, enabled: allowed && denied.current !== account, selectObject, setFixedPoint,
    chooseDisplayedPoint: () => { const display = data.current.displaySelection; return display ? setFixedPoint(display.point, display) : false; },
    refresh: loadContext, save, retry: () => reconcile('save'), closePending: () => reconcile('close'),
    canSelect: allowed && access.active && !current.busy && !current.pending && Boolean(current.context?.canBind),
    canSave: allowed && calculationKey !== null && access.active && !current.busy && current.storageReady && !current.pending && Boolean(current.context?.canBind && current.draft),
    canRetry: allowed && access.active && !current.busy && current.storageReady && Boolean(current.pending) && denied.current !== account,
  };
}
