import { useCallback, useEffect, useRef, useState } from 'react';
import { canonicalPurposeJson, policyUuidSchema } from '../../shared/pathfinderPurposePolicy';
import { cableEndpointCommandSchema, type CableEndpointContext } from '../../shared/pathfinderCableEndpoints';
import { cableEndpointPairCommandSchema, type CableEndpointPairCommand, type CableEndpointPairReceipt } from '../../shared/pathfinderCableEndpointPair';
import { locationImpactCalculationSchema } from '../../shared/pathfinderLocationImpacts';
import { initialFillPolicySchema } from '../../shared/pathfinderInitialFill';
import { CableEndpointApiError, type CableEndpointEnd } from '@/api/pathfinderCableEndpoints';
import { saveCableEndpointPair, closePendingCableEndpointPair } from '@/api/pathfinderCableEndpointPairs';
import { endpointDisplayNameHint, useCableEndpointSelection, type CableEndpointSelectionAccess } from './useCableEndpointSelection';
import { CABLE_ENDPOINT_PENDING_PREFIX, readPendingCableEndpoint } from './cableEndpointPendingStore';
import { CABLE_ENDPOINT_PAIR_PENDING_PREFIX, CableEndpointPairStorageError, readPendingCableEndpointPair,
  retainPendingCableEndpointPair, verifyPendingCableEndpointPair, clearPendingCableEndpointPair, type PendingCableEndpointPair } from './cableEndpointPairPendingStore';

export type CableEndpointPairSelectionAccess = Omit<CableEndpointSelectionAccess, 'end'>;
type Child = ReturnType<typeof useCableEndpointSelection>;
type Draft = NonNullable<Child['draft']>;
type State = { identity: string; pending: PendingCableEndpointPair | null; legacyPending: boolean; storageReady: boolean;
  busy: boolean; error: string | null; notice: string | null; receipt: CableEndpointPairReceipt | null;
  retired: boolean; refreshPhase: 'idle' | 'requested' | 'reading' | 'done' };
const initial = (identity: string): State => ({ identity, pending: null, legacyPending: false, storageReady: false, busy: false,
  error: null, notice: null, receipt: null, retired: false, refreshPhase: 'idle' });
const storageNotice = 'Safe Save recovery storage is unavailable. Preserve this browser storage; no replacement Save will be sent.';
const pendingNotice = 'The Save outcome is unconfirmed. Its exact From/To command is retained. Retry or close it before making another Save.';
const legacyNotice = 'An earlier endpoint command is unconfirmed. Use the recovery controls below before saving From/To together.';
const equal = (a: unknown, b: unknown) => canonicalPurposeJson(a) === canonicalPurposeJson(b);
function effectiveDraft(child: Child): { draft: Draft | null; source: 'selected' | 'automatic' | null } {
  if (child.draft) return { draft: child.draft, source: 'selected' };
  const automatic = child.context?.automaticSelection;
  if (automatic && child.context?.canBind && !child.context.head && child.context.current?.traceId === automatic.object.traceId)
    return { draft: { mode: 'object-derived', sdkObjectId: automatic.sdkObjectId, object: automatic.object, point: [...automatic.pointProjectMetres] }, source: 'automatic' };
  return { draft: null, source: null };
}
function sameContexts(from: CableEndpointContext | null, to: CableEndpointContext | null, access: CableEndpointPairSelectionAccess) {
  return Boolean(from && to && from.projectId === access.projectId && to.projectId === access.projectId && from.cableId === access.cableId && to.cableId === access.cableId
    && from.end === 'from' && to.end === 'to' && from.current && to.current && equal(from.current, to.current)
    && from.cableWriteRevision === to.cableWriteRevision && from.registryRevision === to.registryRevision && access.model
    && from.current.modelVersionId === access.model.modelVersionId && from.current.selectionRevision === access.model.selectionRevision
    && from.current.contentFingerprint === access.model.contentFingerprint);
}

/** Read-only assignments compose two existing selection readers. Only Save
 * creates one new durable pair command and one atomic server mutation. */
export function useCableEndpointPairSelection(access: CableEndpointPairSelectionAccess) {
  const calculation = locationImpactCalculationSchema.nullable().safeParse(access.calculation ?? null);
  const policy = initialFillPolicySchema.nullable().safeParse(access.initialFill);
  const calculationKey = calculation.success ? canonicalPurposeJson(calculation.data) : null;
  const policyKey = policy.success ? canonicalPurposeJson(policy.data) : null;
  const account = JSON.stringify([access.projectId, access.loadedProjectId, access.accountId, access.token, access.isAdmin]);
  const identity = JSON.stringify([account, access.cableId, access.model, access.preparationKey, calculationKey, policyKey]);
  const allowed = Boolean(access.isAdmin && access.token && policyUuidSchema.safeParse(access.accountId).success && policyUuidSchema.safeParse(access.projectId).success
    && access.projectId === access.loadedProjectId && policyUuidSchema.safeParse(access.cableId).success);
  const [state, setState] = useState<State>(() => initial(identity));
  const [legacyGeneration, setLegacyGeneration] = useState(0);
  const current = state.identity === identity && allowed ? state : initial(identity);
  const data = useRef(current); data.current = current;
  const latest = useRef({ identity, allowed, active: access.active }); latest.current = { identity, allowed, active: access.active };
  const callbacks = useRef(access); callbacks.current = access;
  const mounted = useRef(false), request = useRef<AbortController | null>(null), assigning = useRef<object | null>(null), denied = useRef<string | null>(null), refreshSequence = useRef(0);
  const live = useCallback(() => mounted.current && latest.current.identity === identity && latest.current.allowed, [identity]);
  const update = useCallback((value: Partial<State>) => { if (live()) setState(previous => ({ ...previous, ...value })); }, [live]);
  const owner = useCallback(() => ({ accountId: access.accountId!, projectId: access.projectId! }), [access.accountId, access.projectId]);
  const lost = useCallback(() => { if (!live() || denied.current === account) return; denied.current = account; update({ error: 'Current administrator access is required. Any pending Save is retained.' }); callbacks.current.onAuthorityLost?.(); }, [account, live, update]);
  const readerAccess = { ...access, preparationKey: JSON.stringify([access.preparationKey, legacyGeneration]), onSaved: access.onSaved, onAuthorityLost: lost };
  const from = useCableEndpointSelection({ ...readerAccess, end: 'from' });
  const to = useCableEndpointSelection({ ...readerAccess, end: 'to' });
  const children = useRef({ from, to }); children.current = { from, to };
  const readStorage = useCallback(() => {
    try {
      const pending = readPendingCableEndpointPair(owner()), legacyPending = Boolean(readPendingCableEndpoint(owner()));
      update({ pending, legacyPending, storageReady: true }); return { pending, legacyPending };
    } catch { update({ storageReady: false, error: storageNotice }); return null; }
  }, [owner, update]);
  const canAct = useCallback(() => live() && latest.current.active && denied.current !== account && request.current === null && !assigning.current, [live, account]);
  const fail = useCallback((error: unknown) => {
    if (!live()) return;
    const retained = readStorage();
    if (error instanceof CableEndpointApiError && [401, 403].includes(error.status ?? 0)) { lost(); return; }
    update({ error: retained?.pending ? pendingNotice : error instanceof CableEndpointPairStorageError ? error.message
      : error instanceof CableEndpointApiError ? error.message : 'From/To Save could not be completed. Refresh the current contexts after reconciling any pending command.' });
  }, [live, readStorage, lost, update]);
  useEffect(() => {
    mounted.current = true; request.current?.abort(); request.current = null; assigning.current = null; refreshSequence.current++; setState(initial(identity));
    if (allowed) readStorage();
    const observe = (event: StorageEvent) => { if (event.key === null || event.key.startsWith(CABLE_ENDPOINT_PAIR_PENDING_PREFIX) || event.key.startsWith(CABLE_ENDPOINT_PENDING_PREFIX)) readStorage(); };
    window.addEventListener('storage', observe);
    return () => { mounted.current = false; request.current?.abort(); request.current = null; window.removeEventListener('storage', observe); };
  }, [identity, allowed, readStorage]);
  useEffect(() => { if (!access.active) { request.current?.abort(); request.current = null; refreshSequence.current++;
    update({ busy: false, ...(data.current.retired ? { refreshPhase: 'requested' as const } : {}) }); } }, [access.active, update]);
  useEffect(() => {
    if (!allowed || !access.active || denied.current === account || current.busy || request.current || assigning.current) return;
    if (current.refreshPhase === 'requested' && !from.busy && !to.busy) {
      const sequence = ++refreshSequence.current;
      update({ refreshPhase: 'reading' });
      void Promise.all([from.refresh(), to.refresh()]).then(() => { if (live() && refreshSequence.current === sequence) update({ refreshPhase: latest.current.active ? 'done' : 'requested' }); });
    } else if (current.refreshPhase === 'done' && !from.busy && !to.busy) {
      if (sameContexts(from.context, to.context, callbacks.current) && !from.error && !to.error) update({ retired: false, refreshPhase: 'idle' });
      else update({ refreshPhase: 'idle', error: 'The Save disposition is confirmed. Refresh both endpoint contexts before another Save.' });
    }
  }, [allowed, access.active, account, current.busy, current.refreshPhase, from, to, live, update]);
  const canEdit = useCallback(() => {
    if (!canAct() || data.current.retired || children.current.from.busy || children.current.to.busy) return false;
    const retained = readStorage();
    if (!retained || retained.pending || retained.legacyPending) { if (retained?.legacyPending) update({ error: legacyNotice }); return false; }
    return true;
  }, [canAct, readStorage, update]);
  const assign = useCallback(async (end: CableEndpointEnd) => {
    if (!canEdit()) return;
    const operation = {}; assigning.current = operation; update({ busy: true, error: null });
    try { await children.current[end].assignObjectBottomCentre(); }
    finally { if (assigning.current === operation) { assigning.current = null; update({ busy: false }); } }
  }, [canEdit, update]);
  const execute = useCallback(async (intent: PendingCableEndpointPair, abort: AbortController, mode: 'save' | 'close'): Promise<boolean> => {
    try {
      const verified = await verifyPendingCableEndpointPair(owner(), intent);
      if (!live() || !latest.current.active || abort.signal.aborted) return false;
      const recovery = mode === 'close' ? await closePendingCableEndpointPair(access.projectId!, access.token!, verified.cableId, verified.command, access.accountId!, abort.signal) : null;
      const receipt = recovery ? recovery.status === 'saved' ? recovery.receipt : null
        : await saveCableEndpointPair(access.projectId!, access.token!, verified.cableId, verified.command, access.accountId!, abort.signal);
      if (!live()) return false;
      await clearPendingCableEndpointPair(owner(), verified); if (!live()) return true;
      const savedCalculation = verified.command.endpoints[0].command.calculation;
      update({ pending: null, receipt, retired: true, refreshPhase: 'requested', error: null, notice: receipt
        ? savedCalculation === null
          ? 'From/To Save is confirmed. Shared locations are reused. No routing calculation was queued. Configure routing and calculate again.'
          : 'From/To Save is confirmed. Shared locations are reused. Affected cable recalculation was requested using the saved routing settings.'
        : 'The pending From/To command was closed without saving. Its original key cannot save later.' });
      const reported = new Set<string>();
      for (const childReceipt of receipt?.receipts ?? []) {
        if (!live()) break;
        const key = childReceipt.locationImpact?.id ?? childReceipt.locationId;
        if (reported.has(key)) continue; reported.add(key);
        const command = verified.command.endpoints.find(item => item.end === childReceipt.end)?.command;
        if (!command) continue;
        try { await callbacks.current.onSaved?.(childReceipt, command.expectedCurrent, command.calculation); }
        catch { update({ error: 'The Save is confirmed. Refresh cable diagnostics to see the current calculation progress.' }); }
      }
      return true;
    } catch (error) { if (!abort.signal.aborted) fail(error); return false; }
  }, [owner, live, access.projectId, access.token, access.accountId, update, fail]);
  const save = useCallback(async (reason: string): Promise<boolean> => {
    if (!canEdit() || !data.current.storageReady || calculationKey === null || policyKey === null) return false;
    const { from: start, to: end } = children.current;
    if (!sameContexts(start.context, end.context, callbacks.current)) { update({ error: 'Refresh both endpoint contexts for the same current cable, model and registry before saving.' }); return false; }
    if (!reason.trim() || reason.length > 2048 || /[\u0000-\u001f\u007f-\u009f]/u.test(reason)) { update({ error: 'Enter a nonempty confirmation reason without control characters.' }); return false; }
    const endpoints: CableEndpointPairCommand['endpoints'] = [];
    for (const [side, child] of [['from', start], ['to', end]] as const) {
      const context = child.context!, draft = effectiveDraft(child).draft;
      if (!draft) continue;
      if (!context.canBind || !context.logicalName || !context.current) { update({ error: 'Resolve the current logical endpoint before saving its assignment.' }); return false; }
      const command = cableEndpointCommandSchema.parse({ schemaVersion: 'wfc.pf.cable-endpoint-command.v3', idempotencyKey: crypto.randomUUID(),
        calculation: JSON.parse(calculationKey), initialFill: JSON.parse(policyKey), expectedContextSha256: context.contextSha256,
        expectedCableWriteRevision: context.cableWriteRevision, expectedLogicalName: context.logicalName, expectedRegistryRevision: context.registryRevision,
        expectedLocationId: context.location?.id ?? null, expectedLocationRevision: context.location?.revision ?? null, expectedHeadId: context.head?.id ?? null,
        expectedCurrent: context.current, reason, selection: draft.mode === 'object-derived' ? { mode: draft.mode, sdkObjectId: draft.sdkObjectId, object: draft.object }
          : { mode: draft.mode, pointProjectMetres: draft.point, derivation: draft.derivation, displaySdkObjectId: draft.displaySdkObjectId,
            ...endpointDisplayNameHint(draft, child.displaySelection) } });
      if (command.schemaVersion !== 'wfc.pf.cable-endpoint-command.v3') return false;
      endpoints.push({ end: side, command });
    }
    if (!endpoints.length) return false;
    const command = cableEndpointPairCommandSchema.parse({ schemaVersion: 'wfc.pf.cable-endpoint-pair-command.v1', idempotencyKey: crypto.randomUUID(),
      expectedContexts: { from: start.context!.contextSha256, to: end.context!.contextSha256 }, endpoints });
    const abort = new AbortController(); request.current = abort; update({ busy: true, error: null });
    try {
      const intent = await retainPendingCableEndpointPair(owner(), access.cableId!, command);
      if (!live()) return false; update({ pending: intent });
      if (abort.signal.aborted || !latest.current.active) return false;
      return await execute(intent, abort, 'save');
    } catch (error) { fail(error); return false; }
    finally { if (request.current === abort) { request.current = null; update({ busy: false }); } }
  }, [canEdit, calculationKey, policyKey, update, owner, access.cableId, live, execute, fail]);
  const reconcile = useCallback(async (mode: 'save' | 'close') => {
    if (!canAct() || !data.current.storageReady) return false;
    const retained = readStorage(); if (!retained?.pending || retained.legacyPending) return false;
    const abort = new AbortController(); request.current = abort; update({ busy: true, error: null });
    try { return await execute(retained.pending, abort, mode); }
    finally { if (request.current === abort) { request.current = null; update({ busy: false }); } }
  }, [canAct, readStorage, update, execute]);
  const reconcileLegacy = useCallback(async (mode: 'save' | 'close') => {
    if (!canAct() || !data.current.storageReady || !children.current.from.canRetry) return false;
    const retained = readStorage(); if (!retained?.legacyPending || retained.pending) return false;
    const abort = new AbortController(); request.current = abort; update({ busy: true, error: null });
    try {
      // Existing recovery replays the exact stored cable/end/body. It never
      // creates a command using the currently open cable or its draft.
      const confirmed = await (mode === 'save' ? children.current.from.retry() : children.current.from.closePending());
      if (!live()) return confirmed;
      const remaining = readStorage();
      if (confirmed && remaining && !remaining.legacyPending) {
        setLegacyGeneration(value => value + 1);
        update({ retired: true, refreshPhase: 'requested', error: null, notice: 'The earlier endpoint command is reconciled. Refreshing both endpoint contexts.' });
      }
      return confirmed;
    } finally { if (request.current === abort) { request.current = null; update({ busy: false }); } }
  }, [canAct, readStorage, update, live]);
  const expose = (end: CableEndpointEnd, child: Child) => {
    const visible = allowed && denied.current !== account, selection = visible && !current.retired ? effectiveDraft(child) : { draft: null, source: null };
    return { context: visible && !current.retired ? child.context : null, draft: selection.draft, effectiveDraft: selection.draft, draftSource: selection.source,
      displaySelection: visible ? child.displaySelection : null, busy: child.busy, error: visible ? child.error : null, notice: visible ? child.notice : null,
      enabled: visible && child.enabled, canSelect: visible && child.canSelect && !current.busy && !current.pending && !current.legacyPending && !current.retired,
      selectObject: () => assign(end), setFixedPoint: (point: Parameters<Child['setFixedPoint']>[0]) => canEdit() ? child.setFixedPoint(point) : false,
      chooseDisplayedPoint: () => canEdit() ? child.chooseDisplayedPoint() : false,
      refresh: () => { if (canAct()) update({ retired: true, refreshPhase: 'requested', error: null }); } };
  };
  const start = expose('from', from), end = expose('to', to), busy = current.busy || from.busy || to.busy;
  return { from: start, to: end, ...current, busy, enabled: allowed && denied.current !== account,
    legacyRecovery: current.legacyPending ? { cableId: from.pending?.cableId ?? null, end: from.pending?.end ?? null,
      canRetry: allowed && denied.current !== account && access.active && current.storageReady && !busy && !current.pending && from.canRetry,
      retry: () => reconcileLegacy('save'), close: () => reconcileLegacy('close') } : null,
    notice: current.notice ?? (current.legacyPending ? legacyNotice : current.pending ? pendingNotice : null),
    canSave: allowed && denied.current !== account && access.active && current.storageReady && !busy && !current.pending && !current.legacyPending && !current.retired
      && calculationKey !== null && policyKey !== null && sameContexts(from.context, to.context, access) && Boolean(start.draft || end.draft),
    canRetry: allowed && denied.current !== account && access.active && current.storageReady && !busy && Boolean(current.pending) && !current.legacyPending,
    save, retry: () => reconcile('save'), closePending: () => reconcile('close'),
    refresh: () => { if (canAct()) update({ retired: true, refreshPhase: 'requested', error: null }); } };
}
