import { useCallback, useEffect, useRef, useState } from 'react';
import { isCanonicalPoint, type CanonicalPoint, type ViewerSelection } from '../../viewer-runtime/protocol.mjs';
import { endpointPointSchema, type EndpointCurrentScope, type EndpointObjectRef } from '../../shared/pathfinderEndpointBindings';
import { cableEndpointCommandSchema, cableEndpointDisplayObjectNameSchema } from '../../shared/pathfinderCableEndpoints';
import { canonicalPurposeJson, policyUuidSchema } from '../../shared/pathfinderPurposePolicy';
import { locationImpactCalculationSchema, type LocationImpactCalculation } from '../../shared/pathfinderLocationImpacts';
import { initialFillPolicySchema, type InitialFillPolicy } from '../../shared/pathfinderInitialFill';
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
  /** Omission preserves calculation-only v2. Only explicit policy input creates v3. */
  initialFill?: InitialFillPolicy | null;
  readSelection: () => Promise<ViewerSelection | null>;
  onSaved?: (receipt: CableEndpointReceipt, current?: EndpointCurrentScope, calculation?: LocationImpactCalculation | null) => void | Promise<void>; onAuthorityLost?: () => void;
};
type Draft = { mode: 'object-derived'; sdkObjectId: number; object: EndpointObjectRef; point: CanonicalPoint }
  | { mode: 'fixed-world'; point: CanonicalPoint; derivation: 'manual-world-point' | 'picked-surface-point'; displaySdkObjectId: number | null };
type DisplaySelection = { sdkObjectId: number; name: string; point: CanonicalPoint };
export type CableEndpointContextReadResult = { status: 'complete'; context: CableEndpointContext }
  | { status: 'transient-failure' | 'refused' | 'cancelled' };
type ReadOptions = { signal?: AbortSignal; timeoutMilliseconds?: number; onOutcome?: (status: CableEndpointContextReadResult['status']) => void };
/** Preserve a selected label only alongside the same display object and anchor. */
export function endpointDisplayNameHint(draft: Draft, display: DisplaySelection | null) {
  if (draft.mode !== 'fixed-world' || draft.displaySdkObjectId === null || !display
    || display.sdkObjectId !== draft.displaySdkObjectId || draft.point.some((coordinate, index) => coordinate !== display.point[index])) return {};
  const name = cableEndpointDisplayObjectNameSchema.safeParse(display.name);
  return name.success ? { displayObjectName: name.data } : {};
}
type State = { identity: string; context: CableEndpointContext | null; draft: Draft | null; displaySelection: DisplaySelection | null;
  pending: PendingCableEndpoint | null; storageReady: boolean; busy: boolean; error: string | null; notice: string | null; receipt: CableEndpointReceipt | null };
const initial = (identity: string): State => ({ identity, context: null, draft: null, displaySelection: null, pending: null, storageReady: false, busy: false, error: null, notice: null, receipt: null });
const storageNotice = 'Endpoint recovery storage is unavailable or invalid. No new save will be sent. Preserve this browser storage for reconciliation.';
const unknownNotice = 'The save outcome is unconfirmed. Its exact command is retained. Reconcile it before saving another endpoint.';
const modelMatches = (scope: EndpointCurrentScope | null, expected: Model | null) => expected === null ? scope === null
  : scope !== null && scope.modelVersionId === expected.modelVersionId && scope.selectionRevision === expected.selectionRevision && scope.contentFingerprint === expected.contentFingerprint;
const contextReadRetryDelays = [500, 1500] as const;
function transientContextRead(error: unknown) {
  if (error instanceof CableEndpointApiError)
    return [408, 429, 500, 502, 503, 504].includes(error.status ?? 0) || error.status === null && error.code === 'REQUEST_TIMEOUT';
  return error instanceof TypeError;
}
function waitForContextRetry(signal: AbortSignal, milliseconds: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new DOMException('Endpoint read cancelled.', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, milliseconds);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
function canRetainContextDraft(previous: CableEndpointContext | null, next: CableEndpointContext) {
  return Boolean(previous?.current && next.current && next.canBind && previous.projectId === next.projectId && previous.cableId === next.cableId
    && previous.end === next.end && previous.logicalName === next.logicalName && previous.logicalKey === next.logicalKey
    && canonicalPurposeJson(previous.current) === canonicalPurposeJson(next.current));
}
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

/** Shared endpoint editor with explicit versioned policy and exact durable recovery. */
export function useCableEndpointSelection(access: CableEndpointSelectionAccess) {
  const modelKey = JSON.stringify(access.model);
  const parsedCalculation = locationImpactCalculationSchema.nullable().safeParse(access.calculation ?? null);
  const calculationKey = parsedCalculation.success ? canonicalPurposeJson(parsedCalculation.data) : null;
  const parsedInitialFill = initialFillPolicySchema.nullable().safeParse(access.initialFill);
  const initialFillKey = access.initialFill === undefined ? 'unspecified' : parsedInitialFill.success ? canonicalPurposeJson(parsedInitialFill.data) : null;
  const account = JSON.stringify([access.projectId, access.loadedProjectId, access.accountId, access.token, access.isAdmin]);
  const identity = JSON.stringify([account, access.cableId, access.end, access.model, access.preparationKey, calculationKey, initialFillKey]);
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
  const runRead = useCallback(async (work: (signal: AbortSignal) => Promise<void>, options: ReadOptions = {}) => {
    if (!canAct() || options.signal?.aborted) { options.onOutcome?.('cancelled'); return; }
    const abort = new AbortController(); request.current = abort; update({ busy: true, error: null });
    const cancel = () => abort.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', cancel, { once: true });
    const deadline = pathFinderRequestDeadline(abort.signal, options.timeoutMilliseconds ?? 30_000, () => new CableEndpointApiError('REQUEST_TIMEOUT', null, 'Reading the selected endpoint timed out. Try selecting the current object again.'));
    try { await deadline.wait(() => work(deadline.signal)); options.onOutcome?.(live() && latest.current.active ? 'complete' : 'cancelled'); }
    catch (error) {
      const cancelled = abort.signal.aborted || !live() || !latest.current.active;
      options.onOutcome?.(cancelled ? 'cancelled' : transientContextRead(error) ? 'transient-failure' : 'refused');
      if (!cancelled) failure(error);
    }
    finally { deadline.dispose(); options.signal?.removeEventListener('abort', cancel); if (request.current === abort) { request.current = null; update({ busy: false }); } }
  }, [canAct, update, failure, live]);
  const loadContext = useCallback(async (options: { preserveDraft?: boolean; signal?: AbortSignal; timeoutMilliseconds?: number } = {}): Promise<CableEndpointContextReadResult> => {
    let read: CableEndpointContextReadResult = { status: 'cancelled' };
    await runRead(async signal => {
      if (!access.cableId) return;
      let context: CableEndpointContext;
      // Only this GET is retried. All attempts share runRead's original deadline;
      // a failed or unknown Save is never replayed by context recovery.
      for (let attempt = 0; ; attempt++) {
        if (!live() || !latest.current.active || signal.aborted) return;
        try { context = await fetchCableEndpointContext(access.projectId!, access.token!, access.cableId, access.end, signal); break; }
        catch (error) {
          if (!live() || !latest.current.active || signal.aborted || attempt >= contextReadRetryDelays.length || !transientContextRead(error)) throw error;
          await waitForContextRetry(signal, contextReadRetryDelays[attempt]);
        }
      }
      if (!live() || !latest.current.active || signal.aborted) return;
      if (!modelMatches(context.current, JSON.parse(modelKey))) throw new CableEndpointApiError('MODEL_CHANGED', 409, 'The prepared model changed. Refresh this cable before selecting an endpoint.', 'refused');
      const retain = options.preserveDraft === true && canRetainContextDraft(data.current.context, context);
      update({ context, ...(retain ? {} : { draft: null, displaySelection: null }), notice: retain || data.current.receipt ? data.current.notice : null });
      read = { status: 'complete', context };
    }, { signal: options.signal, timeoutMilliseconds: options.timeoutMilliseconds,
      onOutcome: status => { if (status !== 'complete') read = { status }; } });
    return read;
  }, [runRead, access.cableId, access.projectId, access.token, access.end, modelKey, live, update]);
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
  // This separate popup action explicitly stages a displayed fixed point when
  // only the retained equipment observation is absent. It never saves a binding.
  const assignObjectBottomCentre = useCallback(() => runRead(async signal => {
    const context = data.current.context;
    const canStage = () => live() && latest.current.active && !signal.aborted && !readPendingCableEndpoint(owner());
    if (!context?.canBind || !context.current || !canStage()) return;
    const display = selectedObject(await callbacks.current.readSelection());
    if (!canStage()) return;
    if (!display) {
      update({ draft: null, displaySelection: null, notice: 'Select exactly one current model object with a finite bounding-box bottom centre.' }); return;
    }
    update({ draft: null, displaySelection: display, notice: 'Checking the selected bottom-centre point against the current retained equipment…' });
    const response = await fetchCableEndpointSelection(access.projectId!, access.token!, context, display.sdkObjectId, signal);
    if (!canStage()) return;
    const evidence = response.selection;
    if (evidence.status === 'available' && evidence.object && evidence.pointProjectMetres) {
      update({ draft: { mode: 'object-derived', sdkObjectId: display.sdkObjectId, object: evidence.object, point: evidence.pointProjectMetres },
        notice: 'Verified retained equipment supplies the approximate bottom-centre anchor. Save confirms it for the unchanged logical location name.' }); return;
    }
    const absentEvidence = new Set(['SDK_OBJECT_NOT_RETAINED', 'SDK_OBJECT_GEOMETRY_NOT_RETAINED', 'SDK_OBJECT_EQUIPMENT_GEOMETRY_REQUIRED']);
    if ((evidence.status === 'unavailable' || evidence.status === 'unsupported') && evidence.reasonCodes.length > 0
      && evidence.reasonCodes.every(reason => absentEvidence.has(reason))) {
      update({ draft: { mode: 'fixed-world', point: [...display.point], derivation: 'manual-world-point', displaySdkObjectId: display.sdkObjectId },
        notice: 'The selected bounding-box bottom centre is staged as a fixed-world point in project metres. Save confirms it for the unchanged logical location name. It will not follow later model revisions.' }); return;
    }
    update({ draft: null, notice: 'The selected bottom-centre point cannot be assigned from this preparation ('
      + (evidence.reasonCodes.length ? evidence.reasonCodes.join(', ') : evidence.status) + '). No endpoint was saved.' });
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
      // Pausing only suspends reads. A conclusive save must still reach its
      // live owner's progress tracker after the durable command is retired.
      try { if (receipt) await callbacks.current.onSaved?.(receipt, verified.command.expectedCurrent,
        'calculation' in verified.command ? verified.command.calculation : null); } catch { if (live()) update({ error: 'The shared endpoint was saved. Refresh the cable diagnostics to see its current state.' }); }
      if (!live() || !latest.current.active || abort.signal.aborted) return true;
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
      return true;
    } catch (error) { if (!abort.signal.aborted) failure(error); return false; }
  }, [owner, live, access.projectId, access.token, access.accountId, access.cableId, access.end, modelKey, update, failure]);
  const persistDraft = useCallback(async (context: CableEndpointContext, draft: Draft, reason: string, abort: AbortController) => {
    if (!live() || !latest.current.active || abort.signal.aborted || calculationKey === null || initialFillKey === null) return false;
    const command = cableEndpointCommandSchema.parse({ ...(initialFillKey === 'unspecified' ? { schemaVersion: 'wfc.pf.cable-endpoint-command.v2' }
      : { schemaVersion: 'wfc.pf.cable-endpoint-command.v3', initialFill: JSON.parse(initialFillKey) }), calculation: JSON.parse(calculationKey), idempotencyKey: crypto.randomUUID(),
      expectedContextSha256: context.contextSha256, expectedCableWriteRevision: context.cableWriteRevision, expectedLogicalName: context.logicalName,
      expectedRegistryRevision: context.registryRevision, expectedLocationId: context.location?.id ?? null, expectedLocationRevision: context.location?.revision ?? null,
      expectedHeadId: context.head?.id ?? null, expectedCurrent: context.current, reason,
      selection: draft.mode === 'object-derived' ? { mode: draft.mode, sdkObjectId: draft.sdkObjectId, object: draft.object }
        : { mode: draft.mode, pointProjectMetres: draft.point, derivation: draft.derivation, displaySdkObjectId: draft.displaySdkObjectId,
          ...endpointDisplayNameHint(draft, data.current.displaySelection) } });
    const intent = await retainPendingCableEndpoint(owner(), context.cableId, context.end, command);
    if (!live() || abort.signal.aborted) return false;
    update({ pending: intent }); return execute(intent, abort);
  }, [live, calculationKey, initialFillKey, owner, update, execute]);
  const save = useCallback(async (reason: string): Promise<boolean> => {
    const { context, draft, storageReady } = data.current;
    if (!canAct() || !storageReady || !context?.canBind || !context.logicalName || !context.current || !draft) return false;
    if (calculationKey === null) { update({ error: 'Use valid explicit calculation preferences and timeout before saving.' }); return false; }
    if (initialFillKey === null) { update({ error: 'Review the explicit initial-fill policy before saving. No mandate was requested.' }); return false; }
    if (!reason.trim() || reason.length > 2048 || /[\u0000-\u001f\u007f-\u009f]/u.test(reason)) { update({ error: 'Enter a nonempty confirmation reason without control characters.' }); return false; }
    const abort = new AbortController(); request.current = abort; update({ busy: true, error: null });
    try {
      return await persistDraft(context, draft, reason, abort);
    } catch (error) { if (live()) { try { update({ pending: readPendingCableEndpoint(owner()), error: error instanceof CableEndpointStorageError ? error.message : storageNotice }); } catch { update({ storageReady: false, error: storageNotice }); } } return false; }
    finally { if (request.current === abort) { request.current = null; update({ busy: false }); } }
  }, [canAct, update, owner, live, persistDraft, calculationKey, initialFillKey]);
  const applySelectedObject = useCallback(async (reason: string): Promise<boolean> => {
    if (!canAct() || !data.current.storageReady || !access.cableId) return false;
    if (calculationKey === null || calculationKey === 'null' || initialFillKey !== canonicalPurposeJson({ mode: 'when-both-empty' })) {
      update({ error: 'Use explicit calculation settings and the both-empty initial-fill policy for this action.' }); return false;
    }
    if (!reason.trim() || reason.length > 2048 || /[\u0000-\u001f\u007f-\u009f]/u.test(reason)) { update({ error: 'Enter a nonempty confirmation reason without control characters.' }); return false; }
    const abort = new AbortController(); request.current = abort; update({ busy: true, error: null, notice: 'Reading the current endpoint and selected model object…' });
    const deadline = pathFinderRequestDeadline(abort.signal, 30_000, () => new CableEndpointApiError('REQUEST_TIMEOUT', null, 'Checking the selected endpoint timed out. No replacement save was created.'));
    try {
      const pending = readPendingCableEndpoint(owner()); if (pending) { update({ pending, notice: unknownNotice }); return false; }
      const context = await deadline.wait(() => fetchCableEndpointContext(access.projectId!, access.token!, access.cableId!, access.end, deadline.signal));
      if (!live() || !latest.current.active || deadline.signal.aborted) return false;
      if (!modelMatches(context.current, JSON.parse(modelKey))) throw new CableEndpointApiError('MODEL_CHANGED', 409, 'The prepared model changed. Refresh this cable before selecting an endpoint.', 'refused');
      if (!context.canBind || !context.logicalName || !context.current) { update({ context, draft: null, notice: 'Set a named, eligible endpoint and prepare the current model before assigning an object.' }); return false; }
      const display = selectedObject(await deadline.wait(() => callbacks.current.readSelection()));
      if (!live() || !latest.current.active || deadline.signal.aborted) return false;
      if (!display) { update({ context, draft: null, displaySelection: null, notice: 'Select exactly one current model object with a finite bounding-box bottom centre.' }); return false; }
      update({ context, draft: null, displaySelection: display, notice: 'Checking retained geometry for the selected model object…' });
      const response = await deadline.wait(() => fetchCableEndpointSelection(access.projectId!, access.token!, context, display.sdkObjectId, deadline.signal));
      if (!live() || !latest.current.active || deadline.signal.aborted) return false;
      const evidence = response.selection;
      if (evidence.status !== 'available' || !evidence.object || !evidence.pointProjectMetres) {
        update({ draft: null, notice: 'The selected object has no usable verified retained geometry. No endpoint was saved. A fixed-world point requires a separate explicit choice and will not follow model revisions.' }); return false;
      }
      const draft: Draft = { mode: 'object-derived', sdkObjectId: display.sdkObjectId, object: evidence.object, point: evidence.pointProjectMetres };
      update({ draft, notice: 'Saving the verified approximate bottom-centre anchor for the unchanged logical location name…' });
      deadline.dispose(); return await persistDraft(context, draft, reason, abort);
    } catch (error) { if (!abort.signal.aborted) failure(error); return false; }
    finally { deadline.dispose(); if (request.current === abort) { request.current = null; update({ busy: false }); } }
  }, [canAct, access.cableId, access.projectId, access.token, access.end, calculationKey, initialFillKey, update, owner, live, modelKey, persistDraft, failure]);
  const reconcile = useCallback(async (mode: 'save' | 'close'): Promise<boolean> => {
    if (!canAct() || !data.current.storageReady) return false;
    let pending: PendingCableEndpoint | null; try { pending = readPendingCableEndpoint(owner()); } catch { update({ error: storageNotice }); return false; }
    if (!pending) return false;
    const abort = new AbortController(); request.current = abort; update({ busy: true, error: null });
    try { return await execute(pending, abort, mode); }
    finally { if (request.current === abort) { request.current = null; update({ busy: false }); } }
  }, [canAct, owner, update, execute]);
  return { ...current, enabled: allowed && denied.current !== account, selectObject, assignObjectBottomCentre, setFixedPoint, applySelectedObject,
    chooseDisplayedPoint: () => { const display = data.current.displaySelection; return display ? setFixedPoint(display.point, display) : false; },
    refresh: loadContext, save, retry: () => reconcile('save'), closePending: () => reconcile('close'),
    canSelect: allowed && access.active && !current.busy && !current.pending && Boolean(current.context?.canBind),
    canSave: allowed && calculationKey !== null && initialFillKey !== null && access.active && !current.busy && current.storageReady && !current.pending && Boolean(current.context?.canBind && current.draft),
    canApplySelectedObject: allowed && calculationKey !== null && calculationKey !== 'null' && initialFillKey === canonicalPurposeJson({ mode: 'when-both-empty' })
      && access.active && !current.busy && current.storageReady && !current.pending && Boolean(current.context?.canBind && current.context.current && current.context.logicalName),
    canRetry: allowed && access.active && !current.busy && current.storageReady && Boolean(current.pending) && denied.current !== account,
  };
}
