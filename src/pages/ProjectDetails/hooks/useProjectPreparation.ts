import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchPreparationContext,
  fetchPreparationIndex,
  fetchPreparationSession,
  createPreparation,
  savePreparationResolution,
  uploadPreparationPart,
  mutatePreparation,
  PreparationApiError,
  type PreparationContext,
  type PreparationSession,
  type PreparationIndex,
  type PreparationCreate,
  type PreparationResolutionWrite,
  type PreparationMutation,
  type PreparationPartUpload,
} from '@/api/pathfinderPreparation';
import { canonicalPurposeJson } from '../../../../shared/pathfinderPurposePolicy';
import type {
  PreparationDiscovery,
  PreparationScope,
} from '../../../../shared/pathfinderPreparation';
import { PREPARATION_LIMITS, preparationResolutionMatchesScope } from '../../../../shared/pathfinderPreparation';
import { preparationCaptureRequest } from '../../../../shared/preparationMerge';
import { collectPreparationDiscovery } from './collectPreparationDiscovery';
import { PreparationDiscoveryError } from '../../../../shared/collectPreparationDiscovery';
import type { usePathFinder } from './usePathFinder';
import {saveCaptureEvidence,GeometryTraceApiError,createGeometryTrace,fetchGeometryTraces,fetchGeometryTraceManifest,
  type GeometryTraceCreate,type GeometryTraceManifest} from '@/api/pathfinderGeometryTrace';
import {GEOMETRY_TRACE_DERIVATION} from '../../../../shared/pathfinderGeometryTrace';
import {bindCompletedCaptureEvidence,type CompletedCaptureEvidence} from '../../../../viewer-runtime/capture-evidence.mjs';

type PF = ReturnType<typeof usePathFinder>;
type PreparationModel = { modelVersionId: string | null; contentFingerprint: string | null; selectionRevision: string };
type CurrentPreparation = { context: PreparationContext; index: PreparationIndex; session: PreparationSession | null; networkTrace: GeometryTraceManifest | null };
type Pending =
  | { kind: 'create'; body: PreparationCreate }
  | { kind: 'resolution'; body: PreparationResolutionWrite }
  | { kind: 'part'; sessionId: string; partId: string; body: PreparationPartUpload;completedEvidence?:CompletedCaptureEvidence }
  | {kind:'evidence';sessionId:string;partId:string;body:{sessionPlanSha256:string;payloadSha256:string;evidence:CompletedCaptureEvidence}}
  | { kind: 'trace'; body: GeometryTraceCreate }
  | { kind: 'publish' | 'cancel'; sessionId: string; body: PreparationMutation };
type State = {
  identity: string;
  context: PreparationContext | null;
  index: PreparationIndex | null;
  session: PreparationSession | null;
  discovery: PreparationDiscovery | null;
  networkTrace: GeometryTraceManifest | null;
  busy: boolean;
  loading: boolean;
  unknown: boolean;
  conflict: boolean;
  error: string | null;
  notice: string | null;
  progress: string | null;
};
const initial = (identity: string): State => ({
  identity,
  context: null,
  index: null,
  session: null,
  discovery: null,
  networkTrace: null,
  busy: false,
  loading: false,
  unknown: false,
  conflict: false,
  error: null,
  notice: null,
  progress: null,
});
const sameScope = (left: PreparationScope, right: PreparationScope) =>
  canonicalPurposeJson(
    Object.fromEntries(Object.keys(right).map((key) => [key, left[key as keyof PreparationScope]])),
  ) === canonicalPurposeJson(right);
const sameModel = (left: PreparationModel, right: PreparationModel) =>
  left.modelVersionId === right.modelVersionId && left.contentFingerprint === right.contentFingerprint && left.selectionRevision === right.selectionRevision;
const publishedNetworkMatches = (context: PreparationContext) => Boolean(context.currentAggregate &&
  context.currentAggregate.projectId === context.projectId &&
  (Object.keys(context.scope) as Array<keyof PreparationScope>).every(key =>
    key === 'locationRegistryRevision' || context.currentAggregate![key] === context.scope[key]));
const networkTraceMatches = (context: PreparationContext, trace: GeometryTraceManifest | null) => {
  const aggregate = context.currentAggregate;
  return Boolean(aggregate && trace && publishedNetworkMatches(context) && trace.projectId === context.projectId
    && trace.aggregateId === aggregate.id && trace.modelVersionId === aggregate.modelVersionId
    && trace.sessionId === aggregate.sessionId && trace.geometryRevision === aggregate.geometryRevision
    && trace.captureFrameId === aggregate.coordinateFrameId && trace.derivationVersion === GEOMETRY_TRACE_DERIVATION
    && trace.projection.payloadRef === aggregate.projection.payloadRef && trace.projection.sha256 === aggregate.projection.sha256
    && trace.projection.bytes === aggregate.projection.bytes && trace.counts.objects === aggregate.counts.objects
    && trace.counts.segments === aggregate.counts.physicalLeaves);
};
// The same explicit derivation command survives an interrupted tab or server
// restart. Server-side aggregate/derivation uniqueness still owns its result.
async function networkTraceCommand(context: PreparationContext): Promise<GeometryTraceCreate> {
  const aggregate = context.currentAggregate!;
  const bytes = new TextEncoder().encode(canonicalPurposeJson({ schemaVersion: 'wfc.pf.automatic-network-trace-key.v1',
    projectId: context.projectId, aggregateId: aggregate.id, projectionSha256: aggregate.projection.sha256, derivationVersion: GEOMETRY_TRACE_DERIVATION }));
  const hex = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
  return { schemaVersion: 'wfc.pf.geometry-trace-create.v1', aggregateId: aggregate.id,
    expectedProjectionSha256: aggregate.projection.sha256, derivationVersion: GEOMETRY_TRACE_DERIVATION,
    idempotencyKey: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}` };
}
const resumableTraySession = (session: PreparationSession, context: PreparationContext) =>
  session.schemaVersion === 'wfc.pf.preparation-session.v1' && ['planned', 'collecting'].includes(session.state) &&
  session.projectId === context.projectId && sameScope(session.plan, context.scope) && session.plan.diagnostics.length === 0 &&
  session.plan.requestedScope.unresolvedTrayPolicy === 'skip' && session.plan.requestedScope.endpointScope?.mode === 'not-requested' &&
  canonicalPurposeJson(session.plan.requestedScope.endpointNames) === canonicalPurposeJson(context.endpointNames) &&
  Number.isFinite(Date.parse(session.createdAt)) && Date.now() >= Date.parse(session.createdAt) && Date.now() - Date.parse(session.createdAt) < PREPARATION_LIMITS.sessionMilliseconds;
const reloadRequired = (error: unknown) =>
  Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'CAPTURE_RELOAD_REQUIRED',
  );
class PreparationDisplayScopeError extends Error {}

export function useProjectPreparation(pf: PF, active: boolean) {
  const access = pf.preparationAccess;
  const identity = JSON.stringify([
    access?.projectId,
    access?.loadedProjectId,
    access?.token,
    access?.isAdmin,
  ]);
  const enabled = Boolean(
    access?.isAdmin &&
      access.projectId &&
      access.token &&
      access.projectId === access.loadedProjectId,
  );
  const latest = useRef(identity);
  latest.current = identity;
  const latestPf = useRef(pf);
  latestPf.current = pf;
  const latestActive = useRef(active); latestActive.current = active;
  const model = pf.data?.activeModel;
  const reportedModelKey = JSON.stringify([model?.modelVersionId, model?.contentFingerprint, model?.selectionRevision]);
  const completeModelKey = useRef<{ identity: string; key: string } | null>(null);
  if (model?.modelVersionId && model.contentFingerprint && model.selectionRevision !== undefined)
    completeModelKey.current = { identity, key: reportedModelKey };
  // A budget renewal recreates the viewer and temporarily clears PF data.
  // Preserve its known model identity while loading; an explicit new triple,
  // access change or terminal/no-model state still retires the old operation.
  const modelKey = pf.viewerPhase === 'loading' && !model?.modelVersionId && completeModelKey.current?.identity === identity
    ? completeModelKey.current.key : reportedModelKey;
  const latestModelKey = useRef(modelKey); latestModelKey.current = modelKey;
  const displayModelKey = useRef(modelKey);
  const mounted = useRef(true),
    currentAbort = useRef<AbortController | null>(null),
    busyRef = useRef(false),
    pending = useRef<Pending | null>(null);
  const protectedRun = useRef(false);
  const automaticRun = useRef(false), automaticModelKey = useRef<string | null>(null);
  const initialReadIdentity = useRef<string | null>(null);
  const cancelPending = useRef<Extract<Pending, { kind: 'publish' | 'cancel' }> | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const cancelInFlight = useRef(false);
  const [state, setState] = useState<State>(() => initial(identity));
  const stateRef = useRef(state);
  stateRef.current = state;
  const update = useCallback(
    (change: (value: State) => State) => {
      if (mounted.current && latest.current === identity)
        setState((previous) =>
          change(previous.identity === identity ? previous : initial(identity)),
        );
    },
    [identity],
  );
  const assertCurrent = useCallback(
    (signal?: AbortSignal) => {
      if (!mounted.current || latest.current !== identity || !enabled || signal?.aborted ||
        signal && automaticRun.current && (!latestActive.current || automaticModelKey.current !== latestModelKey.current))
        throw new DOMException('Project preparation paused.', 'AbortError');
    },
    [enabled, identity],
  );
  const readNetworkTrace = useCallback(async (context: PreparationContext, signal?: AbortSignal): Promise<GeometryTraceManifest | null> => {
    if (!publishedNetworkMatches(context)) return null;
    const aggregate = context.currentAggregate!;
    let offset = 0;
    const visited = new Set<number>();
    for (let pages = 0; pages < 128; pages++) {
      assertCurrent(signal);
      if (visited.has(offset)) throw new Error('The network frame evidence could not be verified. Check the trays again.');
      visited.add(offset);
      const list = await fetchGeometryTraces(access.projectId!, access.token!, offset, signal);
      assertCurrent(signal);
      if (list.projectId !== context.projectId || list.offset !== offset) throw new Error('The network frame evidence belongs to a different project.');
      const matches = list.traces.filter(trace => trace.aggregateId === aggregate.id);
      if (matches.length > 1) throw new Error('The network has conflicting frame evidence. Check the trays again.');
      if (matches.length) {
        const summary = matches[0], trace = await fetchGeometryTraceManifest(access.projectId!, access.token!, summary.id, signal);
        assertCurrent(signal);
        if (trace.id !== summary.id || trace.contentSha256 !== summary.contentSha256 || !networkTraceMatches(context, trace))
          throw new Error('The network frame evidence does not match the current prepared model. Check the trays again.');
        return trace;
      }
      if (list.nextOffset === null) return null;
      if (list.nextOffset <= offset) throw new Error('The network frame evidence list did not advance. Check the trays again.');
      offset = list.nextOffset;
    }
    throw new Error('The network frame evidence exceeded its supported read limit.');
  }, [access?.projectId, access?.token, assertCurrent]);
  const readCurrent = useCallback(
    async (signal?: AbortSignal, sessionId?: string | null) => {
      assertCurrent(signal);
      // Explicit refresh/recovery can initialize controls before Routes is shown.
      initialReadIdentity.current = identity;
      const [context, index] = await Promise.all([
        fetchPreparationContext(access.projectId!, access.token!, signal),
        fetchPreparationIndex(access.projectId!, access.token!, signal),
      ]);
      assertCurrent(signal);
      const assertModelScope = () => {
        const model = latestPf.current.data?.activeModel;
        if (model && (model.modelVersionId !== context.scope.modelVersionId ||
            model.selectionRevision !== context.scope.selectionRevision ||
            model.contentFingerprint !== context.scope.contentFingerprint))
          throw new PreparationDisplayScopeError(
            'The active model changed. Refresh Path Finder and preparation before continuing.');
      };
      assertModelScope();
      const displayed = stateRef.current.session;
      const displayedCurrent = displayed && sameModel(displayed.plan, context.scope) ? displayed.id : undefined;
      const id = sessionId === null ? undefined : sessionId ?? context.currentAggregate?.sessionId ?? displayedCurrent ?? index.sessions[0]?.id;
      const session = id
        ? await fetchPreparationSession(access.projectId!, access.token!, id, signal)
        : null;
      assertCurrent(signal);
      assertModelScope();
      let networkTrace: GeometryTraceManifest | null;
      try { networkTrace = await readNetworkTrace(context, signal); }
      catch (error) { update(value => ({ ...value, context, index, session, networkTrace: null })); throw error; }
      assertCurrent(signal);
      assertModelScope();
      if (session?.schemaVersion === 'wfc.pf.preparation-session.v1' && session.state === 'validating' && session.recovery &&
        sameScope(session.plan, context.scope) && !pending.current) {
        pending.current = {
          kind: 'publish',
          sessionId: session.id,
          body: session.recovery.command,
        };
        update((value) => ({
          ...value,
          unknown: true,
          notice:
            'Validation is in progress. Its exact saved command is available for reconciliation after a restart.',
        }));
      }
      update((value) => ({
        ...value,
        context,
        index,
        session,
        networkTrace,
        loading: false,
        conflict: false,
        error: null,
      }));
      return { context, index, session, networkTrace };
    },
    [access?.projectId, access?.token, assertCurrent, identity, readNetworkTrace, update],
  );
  const operate = useCallback(
    async (operation: (signal: AbortSignal) => Promise<void>) => {
      if (!enabled || busyRef.current || latest.current !== identity) return;
      const abort = new AbortController();
      currentAbort.current = abort;
      busyRef.current = true;
      update((value) => ({ ...value, busy: true, error: null, notice: null }));
      try {
        await operation(abort.signal);
      } catch (error) {
        if (latest.current !== identity || !mounted.current) return;
        if ((error instanceof PreparationApiError||error instanceof GeometryTraceApiError) && [401, 403].includes(error.status ?? 0)) {
          pending.current = null;
          latestPf.current.cancelOperation();
          latestPf.current.refresh();
          update(() => ({ ...initial(identity), error: error.message, conflict: true }));
        } else if (error instanceof PreparationDisplayScopeError) {
          // A display read cannot establish the commit outcome of an earlier
          // mutation. Retain its exact command for protected reconciliation.
          update((value) => ({ ...value, conflict: true,
            unknown: Boolean(pending.current) || value.unknown, error: error.message }));
        } else if (
          pending.current &&
          (!((error instanceof PreparationApiError||error instanceof GeometryTraceApiError)) || error.outcome === 'unknown')
        )
          update((value) => ({
            ...value,
            unknown: true,
            error:
              'The command outcome is unknown. Retry the same command before making further changes.',
          }));
        else {
          if ((error instanceof PreparationApiError||error instanceof GeometryTraceApiError) && error.outcome === 'refused')
            pending.current = null;
          update((value) => ({
            ...value,
            unknown: false,
            conflict: (error instanceof PreparationApiError||error instanceof GeometryTraceApiError) && error.status === 409,
            error:
              error instanceof DOMException && error.name === 'AbortError'
                ? null
                : reloadRequired(error)
                  ? 'Reload the protected model, then repeat discovery or Resume the frozen preparation. Committed parts are retained.'
                  : error instanceof PreparationDiscoveryError
                    ? `${error.message} The published network is unchanged. Review this discovery stage before trying again.`
                  : error instanceof Error && 'code' in error && error.code === 'EXTRACTION_FAILED'
                    ? 'Model extraction stopped. The viewer did not report a specific cause. Committed parts are retained.'
                  : error instanceof Error
                    ? error.message
                    : 'Project preparation could not be completed.',
            notice:
              error instanceof DOMException && error.name === 'AbortError'
                ? 'Collection paused. Committed parts are retained for Resume.'
                : null,
          }));
        }
      } finally {
        if (currentAbort.current === abort) {
          protectedRun.current = false;
          automaticRun.current = false;
          automaticModelKey.current = null;
          currentAbort.current = null;
          busyRef.current = false;
        }
        update((value) => ({ ...value, busy: false, loading: false }));
      }
    },
    [enabled, identity, update],
  );
  const execute = useCallback(
    async (command: Pending, signal: AbortSignal, automatic = false) => {
      assertCurrent(signal);
      pending.current = command;
      update((value) => ({ ...value, unknown: false }));
      let sessionId: string | undefined;
      switch (command.kind) {
        case 'create': {
          const session = await createPreparation(
            access.projectId!,
            access.token!,
            command.body,
            signal,
          );
          sessionId = session.id;
          update((value) => ({ ...value, session }));
          break;
        }
        case 'resolution':
          await savePreparationResolution(access.projectId!, access.token!, command.body, signal);
          break;
        case 'part':{
          const part = stateRef.current.session?.plan.partPlan.find((value) => value.partId === command.partId);
          const label = part ? `part ${part.partIndex + 1} of ${stateRef.current.session!.plan.partPlan.length}` : 'the captured part';
          update((value) => ({ ...value, progress: automatic ? 'Updating the tray network…' : `Uploading ${label}. Committed parts are retained.` }));
          const receipt=await uploadPreparationPart(
            access.projectId!,
            access.token!,
            command.sessionId,
            command.partId,
            command.body,
            signal,
          );
          assertCurrent(signal);
          if(command.completedEvidence){
            update((value) => ({ ...value, progress: automatic ? 'Updating the tray network…' : `Saving capture evidence for ${label}.` }));
            const evidence=await bindCompletedCaptureEvidence(command.completedEvidence,{selectionRevision:command.completedEvidence.binding.selectionRevision,partPayloadSha256:receipt.part.payloadSha256});
            assertCurrent(signal);
            pending.current={kind:'evidence',sessionId:command.sessionId,partId:command.partId,body:{sessionPlanSha256:command.body.sessionPlanSha256,payloadSha256:receipt.part.payloadSha256,evidence}};
            await saveCaptureEvidence(access.projectId!,access.token!,command.sessionId,command.partId,command.body.sessionPlanSha256,receipt.part.payloadSha256,evidence,signal);
          }
          sessionId = command.sessionId;
          break;}
        case 'evidence':
          update((value) => ({ ...value, progress: automatic ? 'Continuing the tray update…' : 'Saving the exact pending capture evidence. Committed geometry is retained.' }));
          await saveCaptureEvidence(access.projectId!,access.token!,command.sessionId,command.partId,command.body.sessionPlanSha256,command.body.payloadSha256,command.body.evidence,signal);sessionId=command.sessionId;break;
        case 'trace': {
          const receipt = await createGeometryTrace(access.projectId!, access.token!, command.body, signal);
          assertCurrent(signal);
          if (receipt.trace.projectId !== access.projectId || receipt.trace.aggregateId !== command.body.aggregateId
            || receipt.trace.projection.sha256 !== command.body.expectedProjectionSha256)
            throw new GeometryTraceApiError('INVALID_RESPONSE', null, 'The network frame result could not be verified. Check the trays again.', 'unknown');
          break;
        }
        case 'publish':
        case 'cancel':
          await mutatePreparation(
            access.projectId!,
            access.token!,
            command.sessionId,
            command.kind,
            command.body,
            signal,
          );
          sessionId = command.sessionId;
          break;
      }
      // A confirmed mutation remains confirmed even if the subsequent status read fails.
      assertCurrent();
      pending.current = null;
      update((value) => ({
        ...value,
        unknown: false,
        progress: automatic ? 'Checking the tray update…' : 'Refreshing preparation status after the confirmed command.',
        notice: automatic ? null : 'Command confirmed. Refreshing current preparation status.',
      }));
      const fresh = await readCurrent(signal, sessionId);
      if (command.kind === 'resolution')
        update((value) => ({
          ...value,
          session: null,
          discovery: null,
          notice: automatic ? null : 'Resolution saved with its reason. Discover again to freeze a new plan.',
        }));
      if (command.kind === 'publish') latestPf.current.refresh();
      return fresh;
    },
    [access?.projectId, access?.token, assertCurrent, readCurrent, update],
  );
  useEffect(() => {
    mounted.current = true;
    cancelPending.current = null;
    cancelInFlight.current = false;
    setCancelBusy(false);
    pending.current = null;
    automaticRun.current = false;
    automaticModelKey.current = null;
    busyRef.current = false;
    currentAbort.current?.abort();
    initialReadIdentity.current = null;
    setState(initial(identity));
    return () => {
      mounted.current = false;
      currentAbort.current?.abort();
    };
  }, [identity, enabled, operate, readCurrent, update]);
  useEffect(() => {
    if (displayModelKey.current === modelKey) return;
    displayModelKey.current = modelKey;
    if (protectedRun.current) currentAbort.current?.abort();
    initialReadIdentity.current = null;
    // Retire presentation evidence, retaining any exact uncertain write for the
    // next explicit reconciliation. A new model never inherits cached roots.
    update(value => ({ ...value, context: null, session: null, discovery: null, networkTrace: null, notice: null, progress: null,
      unknown: Boolean(pending.current) || value.unknown, conflict: false, error: null }));
  }, [modelKey, update]);
  useEffect(() => {
    if (!enabled || !active || busyRef.current || initialReadIdentity.current === identity) return;
    initialReadIdentity.current = identity;
    void operate(async (signal) => {
      update((value) => ({ ...value, loading: true }));
      await readCurrent(signal);
    });
  }, [active, enabled, identity, modelKey, operate, readCurrent, state.busy, update]);
  useEffect(() => {
    if (!active && protectedRun.current) currentAbort.current?.abort();
  }, [active]);
  const refresh = useCallback(
    () =>
      operate(async (signal) => {
        await readCurrent(signal);
      }),
    [operate, readCurrent],
  );
  const discover = useCallback(
    () =>
      operate(async (signal) => {
        if (pending.current || stateRef.current.conflict) return;
        // A failed new read must not leave an earlier report available for a
        // replacement Freeze. The saved session and published network remain.
        update(value => ({ ...value, discovery: null, progress: 'Reading the current project tray and endpoint scope…' }));
        const { context } = await readCurrent(signal);
        protectedRun.current = true;
        const result = await latestPf.current.runProjectPreparation(
          context.scope,
          (viewer) =>
            collectPreparationDiscovery(context, viewer, (text) =>
              update((value) => ({ ...value, progress: text })),
              { skipEquipment: true },
            ),
          signal,
        );
        assertCurrent(signal);
        update((value) => ({
          ...value,
          context,
          discovery: result,
          progress: null,
          notice: result.complete
            ? 'Tray discovery finished. Review every missing or ambiguous tray before freezing the plan. From/To locations are searched separately with Find and assign From/To.'
            : 'Endpoint property coverage is incomplete. No complete plan can be published from this discovery.',
        }));
      }),
    [operate, readCurrent, assertCurrent, update],
  );
  const freezePlan = useCallback(
    () =>
      operate(async (signal) => {
        const value = stateRef.current;
        if (pending.current || value.conflict || !value.context || !value.discovery?.complete)
          return;
        await execute(
          {
            kind: 'create',
            body: {
              schemaVersion: 'wfc.pf.preparation-create.v1',
              expected: value.context.scope,
              idempotencyKey: crypto.randomUUID(),
              discovery: structuredClone(value.discovery),
            },
          },
          signal,
        );
      }),
    [operate, execute],
  );
  const resolve = useCallback(
    (
      projectTrayId: string,
      mode: 'roots' | 'exclude' | 'reset',
      rootObjectIds: string[],
      reason: string,
    ) =>
      operate(async (signal) => {
        const value = stateRef.current;
        if (pending.current || value.conflict || !value.context) return;
        await execute(
          {
            kind: 'resolution',
            body: {
              schemaVersion: 'wfc.pf.preparation-resolution.write.v1',
              expected: value.context.scope,
              idempotencyKey: crypto.randomUUID(),
              projectTrayId,
              mode,
              rootObjectIds: [...rootObjectIds],
              reason,
            },
          },
          signal,
        );
      }),
    [operate, execute],
  );
  const loadSession = useCallback(
    (id: string) =>
      operate(async (signal) => {
        if (pending.current) return;
        await readCurrent(signal, id);
      }),
    [operate, readCurrent],
  );
  const collectSession = useCallback(
      async (current: CurrentPreparation, signal: AbortSignal, automatic = false): Promise<CurrentPreparation> => {
        let fresh = current;
        let session = fresh.session;
        if (
          !session ||
          !['planned', 'collecting'].includes(session.state) ||
          !sameScope(session.plan, fresh.context.scope)
        )
          throw new Error(
            'This frozen plan is stale or cannot collect parts. Refresh and create a new plan.',
          );
        protectedRun.current = true;
        const frozenScope = fresh.context.scope;
        const planSha256 = session.plan.orderedPlanSha256;
        let renewals = 0;
        const renewedParts = new Set<string>();
        for (;;) {
          try {
            await latestPf.current.runProjectPreparation(
              frozenScope,
              async (viewer) => {
                for (const part of session!.plan.partPlan) {
                  if (session!.parts.some((item) => item.partId === part.partId)) continue;
                  assertCurrent(signal);
                  viewer.assertCurrent();
                  update((value) => ({
                    ...value,
                    progress: automatic ? `Updating trays (${part.partIndex + 1} of ${session!.plan.partPlan.length})…` : `Collecting part ${part.partIndex + 1} of ${session!.plan.partPlan.length}. Committed parts are retained.`,
                  }));
                  const capture = await viewer.capture(
                    preparationCaptureRequest(session!.plan, part.partId),
                  );
                  viewer.assertCurrent();
                  assertCurrent(signal);
                  fresh = await execute(
                    {
                      kind: 'part',
                      sessionId: session!.id,
                      partId: part.partId,
                      completedEvidence:capture.summary.completedEvidence,
                      body: {
                        schemaVersion: 'wfc.pf.preparation-part.upload.v1',
                        sessionPlanSha256: session!.plan.orderedPlanSha256,
                        payload: capture.snapshot,
                      },
                    },
                    signal,
                    automatic,
                  );
                  if (!fresh.session || fresh.session.plan.orderedPlanSha256 !== planSha256 || !sameScope(frozenScope, fresh.context.scope))
                    throw new Error(
                      'Project routing inputs changed. The current plan cannot continue.',
                    );
                  session = fresh.session;
                }
              },
              signal,
            );
            break;
          } catch (error) {
            const next = session.plan.partPlan.find(
              (part) => !session!.parts.some((value) => value.partId === part.partId),
            );
            if (
              !reloadRequired(error) ||
              pending.current ||
              !next ||
              renewals >= 16 ||
              renewedParts.has(next.partId)
            )
              throw error;
            renewedParts.add(next.partId);
            renewals++;
            const generation = latestPf.current.preparationViewerGeneration;
            latestPf.current.reloadViewer();
            update((value) => ({
              ...value,
              progress: automatic ? 'Reloading the model to continue the tray update…' : `Reloading the protected model to renew its bounded request budget (${renewals} of 16).`,
            }));
            const until = Date.now() + 300000;
            while (
              latestPf.current.preparationViewerGeneration <= generation ||
              latestPf.current.viewerPhase !== 'ready'
            ) {
              assertCurrent(signal);
              if (latestPf.current.viewerPhase === 'error' || latestPf.current.viewerPhase === 'no-model')
                throw new Error('The model could not be reloaded. Check the model and try the tray update again. Committed parts are retained.');
              if (Date.now() > until)
                throw new Error(
                  'Reload the model, then Resume the same preparation. Its committed parts are retained.',
                );
              await new Promise((done) => setTimeout(done, 100));
            }
            fresh = await readCurrent(signal, session.id);
            if (!fresh.session || fresh.session.plan.orderedPlanSha256 !== planSha256 || !sameScope(frozenScope, fresh.context.scope))
              throw new Error('The project changed during model reload. Create a new frozen plan.');
            session = fresh.session;
          }
        }
        if (!session.coverage.requestedScopeComplete || session.coverage.missingPartIds.length > 0 ||
          session.plan.partPlan.some(part => !session!.parts.some(committed => committed.partId === part.partId)))
          throw new Error('The tray update is incomplete. Check the trays again to continue.');
        update((value) => ({
          ...value,
          progress: null,
          notice:
            automatic ? null : 'Every planned part is committed. Validate and publish the complete network when ready.',
        }));
        return fresh;
      },
    [readCurrent, execute, assertCurrent, update],
  );
  const collect = useCallback(
    () => operate(async signal => {
      if (pending.current || stateRef.current.conflict || !stateRef.current.session) return;
      await collectSession(await readCurrent(signal, stateRef.current.session.id), signal);
    }),
    [operate, collectSession, readCurrent],
  );
  const mutate = useCallback(
    (kind: 'publish' | 'cancel', reason: string) =>
      operate(async (signal) => {
        const value = stateRef.current;
        if (pending.current || value.conflict || !value.session) return;
        await execute(
          {
            kind,
            sessionId: value.session.id,
            body: {
              schemaVersion: 'wfc.pf.preparation-mutation.v1',
              expectedSessionRevision: value.session.sessionRevision,
              idempotencyKey: crypto.randomUUID(),
              reason,
            },
          },
          signal,
        );
      }),
    [operate, execute],
  );
  const retry = useCallback(
    () =>
      operate(async (signal) => {
        const command = pending.current;
        if (command) await execute(command, signal);
      }),
    [operate, execute],
  );
  const pause = useCallback(() => {
    currentAbort.current?.abort();
    latestPf.current.cancelOperation();
  }, []);
  const cancelActive = useCallback(
    async (reason: string) => {
      if (
        !enabled ||
        cancelInFlight.current ||
        latest.current !== identity ||
        !stateRef.current.session
      )
        return;
      const sessionId = stateRef.current.session.id;
      cancelInFlight.current = true;
      setCancelBusy(true);
      try {
        const current = await fetchPreparationSession(access.projectId!, access.token!, sessionId);
        assertCurrent();
        const command: Extract<Pending, { kind: 'publish' | 'cancel' }> = cancelPending.current ?? {
          kind: 'cancel',
          sessionId,
          body: {
            schemaVersion: 'wfc.pf.preparation-mutation.v1',
            expectedSessionRevision: current.sessionRevision,
            idempotencyKey: crypto.randomUUID(),
            reason,
          },
        };
        cancelPending.current = command;
        const cancelled = await mutatePreparation(
          access.projectId!,
          access.token!,
          sessionId,
          'cancel',
          command.body,
        );
        assertCurrent();
        cancelPending.current = null;
        pending.current = null;
        currentAbort.current?.abort();
        latestPf.current.cancelOperation();
        update((value) => ({
          ...value,
          session: cancelled as PreparationSession,
          unknown: false,
          error: null,
          notice: 'Preparation cancelled on the server. The previous whole network is retained.',
        }));
      } catch (error) {
        if (latest.current !== identity || !mounted.current) return;
        if ((error instanceof PreparationApiError||error instanceof GeometryTraceApiError) && [401, 403].includes(error.status ?? 0)) {
          pending.current = null;
          cancelPending.current = null;
          currentAbort.current?.abort();
          latestPf.current.cancelOperation();
          latestPf.current.refresh();
          update(() => ({ ...initial(identity), error: error.message, conflict: true }));
          return;
        }
        if ((error instanceof PreparationApiError||error instanceof GeometryTraceApiError) && error.outcome === 'refused')
          cancelPending.current = null;
        update((value) => ({
          ...value,
          unknown: Boolean(cancelPending.current) || value.unknown,
          error: cancelPending.current
            ? 'The cancellation outcome is unknown. Retry the same cancellation command.'
            : error instanceof Error
              ? error.message
              : 'Cancellation could not be confirmed.',
        }));
      } finally {
        if (latest.current === identity && mounted.current) {
          cancelInFlight.current = false;
          setCancelBusy(false);
        }
      }
    },
    [access?.projectId, access?.token, assertCurrent, enabled, identity, update],
  );
  const reconcileAutomatic = useCallback(async (signal: AbortSignal, explicit?: Pending): Promise<CurrentPreparation | undefined> => {
    const command = explicit ?? cancelPending.current ?? pending.current;
    if (!command) return undefined;
    update(value => ({ ...value, progress: 'Continuing the previous tray update…' }));
    try {
      const fresh = await execute(command, signal, true);
      if (cancelPending.current === command) cancelPending.current = null;
      return fresh;
    } catch (error) {
      // An authoritative stale-session refusal establishes that the old command
      // cannot publish. It is safe to build for the newly current scope now.
      // Unknown outcomes, authority failures and an unsaved assignment still stop.
      if (!(error instanceof PreparationApiError) || error.status !== 409 || error.code !== 'PREPARATION_SCOPE_STALE' ||
        error.outcome !== 'refused' || command.kind === 'resolution') throw error;
      if (pending.current === command) pending.current = null;
      if (cancelPending.current === command) cancelPending.current = null;
      update(value => ({ ...value, unknown: false, conflict: false }));
      return readCurrent(signal, null);
    }
  }, [execute, readCurrent, update]);
  const discoverTrays = useCallback(async (context: PreparationContext, signal: AbortSignal) => {
    update(value => ({ ...value, discovery: null, progress: 'Checking project trays…', notice: null }));
    protectedRun.current = true;
    const discovery = await latestPf.current.runProjectPreparation(context.scope,
      viewer => collectPreparationDiscovery(context, viewer, text => {
        assertCurrent(signal);
        const names = /^Searching (\d+) project trays: (\d+) of (\d+)/.exec(text);
        const roots = /^Reading tray-root coverage: (\d+) of (\d+)/.exec(text);
        const progress = names ? `Checking tray names (${Math.round(Number(names[1]) * Number(names[2]) / Math.max(1, Number(names[3])))} of ${names[1]})…`
          : roots ? `Checking tray objects (${roots[1]} of ${roots[2]})…` : 'Checking project trays…';
        update(value => ({ ...value, progress }));
      }, { skipEquipment: true }), signal);
    assertCurrent(signal);
    if (!discovery.complete) throw new Error('The tray check did not finish. Check the trays again to continue.');
    if (!sameModel(discovery, context.scope)) throw new Error('The active model changed. Check the trays again.');
    update(value => ({ ...value, context, discovery }));
    return discovery;
  }, [assertCurrent, update]);
  const ensureNetworkTrace = useCallback(async (fresh: CurrentPreparation, signal: AbortSignal): Promise<CurrentPreparation> => {
    if (!publishedNetworkMatches(fresh.context)) throw new Error('The project network changed. Check the trays again.');
    if (networkTraceMatches(fresh.context, fresh.networkTrace)) return fresh;
    update(value => ({ ...value, progress: 'Finishing the tray network…', networkTrace: null }));
    const aggregateId = fresh.context.currentAggregate!.id, command = await networkTraceCommand(fresh.context);
    assertCurrent(signal);
    const verified = await execute({ kind: 'trace', body: command }, signal, true);
    if (verified.context.currentAggregate?.id !== aggregateId || !networkTraceMatches(verified.context, verified.networkTrace))
      throw new Error('The model frame could not be confirmed for the current network. Check the trays again.');
    return verified;
  }, [assertCurrent, execute, update]);
  const prepareTrays = useCallback(async (signal: AbortSignal, starting?: CurrentPreparation) => {
    let fresh = starting ?? await readCurrent(signal, null);
    assertCurrent(signal);
    // A current older network does not establish the outcome of a later saved
    // validation command. Reconcile its exact human command before reusing it.
    for (const id of fresh.index.sessions.filter(candidate => candidate.state === 'validating').map(candidate => candidate.id)) {
      fresh = await readCurrent(signal, id);
      if (fresh.session?.schemaVersion === 'wfc.pf.preparation-session.v1' && fresh.session.state === 'validating' &&
        sameScope(fresh.session.plan, fresh.context.scope) && pending.current?.kind === 'publish')
        fresh = (await reconcileAutomatic(signal, pending.current))!;
    }
    const reusePublished = async (): Promise<boolean> => {
      if (!publishedNetworkMatches(fresh.context)) return false;
      fresh = await readCurrent(signal, fresh.context.currentAggregate!.sessionId);
      if (!publishedNetworkMatches(fresh.context) || fresh.context.currentAggregate!.sessionId !== fresh.session?.id ||
        fresh.session.state !== 'published' || fresh.context.currentAggregate!.orderedPlanSha256 !== fresh.session.plan.orderedPlanSha256)
        throw new Error('The project trays changed while checking the network. Check them again.');
      if (fresh.session.plan.requestedScope.skippedTrays?.length) await discoverTrays(fresh.context, signal);
      fresh = await ensureNetworkTrace(fresh, signal);
      update(value => ({ ...value, progress: null, notice: 'Tray network is up to date.', unknown: false }));
      latestPf.current.refresh();
      return true;
    };
    if (await reusePublished()) return;

    // Preserve explicit physical assignments when only project routing inputs
    // changed. Each renewal is a fresh audited write with the current full CAS.
    // A model/selection/fingerprint change never carries roots into another load.
    const staleRoots = fresh.context.resolutions.filter(resolution => resolution.mode === 'roots' &&
      fresh.context.trays.some(tray => tray.projectTrayId === resolution.projectTrayId) &&
      sameModel(resolution.scope, fresh.context.scope) && !preparationResolutionMatchesScope(resolution.scope, fresh.context.scope));
    for (const resolution of staleRoots) {
      if (!sameModel(resolution.scope, fresh.context.scope)) throw new Error('The active model changed. Check the trays again.');
      fresh = await execute({ kind: 'resolution', body: {
        schemaVersion: 'wfc.pf.preparation-resolution.write.v1', expected: fresh.context.scope,
        idempotencyKey: crypto.randomUUID(), projectTrayId: resolution.projectTrayId, mode: 'roots',
        rootObjectIds: [...resolution.rootObjectIds], reason: 'Retained the previously assigned roots in the same model after project routing inputs changed.',
      } }, signal, true);
    }

    let session: PreparationSession | null = null;
    const candidateIds = [...new Set([
      ...(fresh.session ? [fresh.session.id] : []),
      ...fresh.index.sessions.filter(candidate => ['planned', 'collecting', 'validating'].includes(candidate.state)).map(candidate => candidate.id),
    ])];
    const expected = fresh.context.scope;
    for (const id of candidateIds) {
      fresh = await readCurrent(signal, id);
      if (!sameScope(expected, fresh.context.scope)) throw new Error('Project routing inputs changed. Check the trays again.');
      if (fresh.session?.schemaVersion === 'wfc.pf.preparation-session.v1' && fresh.session.state === 'validating' &&
        sameScope(fresh.session.plan, fresh.context.scope) && pending.current?.kind === 'publish') {
        fresh = (await reconcileAutomatic(signal, pending.current))!;
        if (await reusePublished()) return;
      }
      if (fresh.session && resumableTraySession(fresh.session, fresh.context)) { session = fresh.session; break; }
    }
    if (!session) {
      const context = fresh.context;
      const discovery = await discoverTrays(context, signal);
      fresh = await execute({ kind: 'create', body: {
        schemaVersion: 'wfc.pf.preparation-create.v1', expected: context.scope,
        idempotencyKey: crypto.randomUUID(), discovery: structuredClone(discovery), unresolvedTrayPolicy: 'skip',
      } }, signal, true);
      session = fresh.session;
      if (!session || !sameScope(session.plan, fresh.context.scope)) throw new Error('Project routing inputs changed. Check the trays again.');
    }
    if (session.plan.diagnostics.length > 0) throw new Error(session.plan.diagnostics[0].message);
    fresh = await collectSession({ ...fresh, session }, signal, true);
    if (!fresh.session || !fresh.session.coverage.requestedScopeComplete || fresh.session.coverage.missingPartIds.length)
      throw new Error('The tray update is incomplete. Check the trays again to continue.');
    update(value => ({ ...value, progress: 'Finishing the tray update…' }));
    fresh = await execute({ kind: 'publish', sessionId: fresh.session.id, body: {
      schemaVersion: 'wfc.pf.preparation-mutation.v1', expectedSessionRevision: fresh.session.sessionRevision,
      idempotencyKey: crypto.randomUUID(), reason: 'Update the project tray network from the current model.',
    } }, signal, true);
    if (!publishedNetworkMatches(fresh.context) || fresh.session?.state !== 'published' || fresh.context.currentAggregate!.sessionId !== fresh.session.id)
      throw new Error('The tray update could not be confirmed. Check the trays again.');
    fresh = await ensureNetworkTrace(fresh, signal);
    update(value => ({ ...value, progress: null, notice: 'Tray network updated.', unknown: false }));
  }, [assertCurrent, collectSession, discoverTrays, ensureNetworkTrace, execute, readCurrent, reconcileAutomatic, update]);
  const checkTrays = useCallback(() => {
    if (!latestActive.current) return Promise.resolve();
    return operate(async signal => {
      protectedRun.current = automaticRun.current = true;
      automaticModelKey.current = latestModelKey.current;
      update(value => ({ ...value, discovery: null, progress: 'Checking project trays…', notice: null }));
      await prepareTrays(signal, await reconcileAutomatic(signal));
    });
  }, [operate, prepareTrays, reconcileAutomatic, update]);
  const assignTray = useCallback((projectTrayId: string, rootObjectIds: string[]) => {
    if (!latestActive.current) return Promise.resolve();
    const origin = stateRef.current.context?.scope;
    const roots = Array.isArray(rootObjectIds) && rootObjectIds.length <= 512 ? [...rootObjectIds] : [];
    return operate(async signal => {
      protectedRun.current = automaticRun.current = true;
      automaticModelKey.current = latestModelKey.current;
      if (!origin) throw new Error('Check the project trays before assigning a model selection.');
      if (!roots.length || roots.length > 512 || new Set(roots).size !== roots.length ||
        !roots.every(root => /^dbid:[1-9][0-9]*$/.test(root) && Number(root.slice(5)) <= 2147483647))
        throw new Error('Select the intended tray objects in the model, then try again.');
      let fresh = await reconcileAutomatic(signal) ?? await readCurrent(signal, null);
      if (!sameModel(origin, fresh.context.scope)) throw new Error('The active model changed. Select the tray again in the current model.');
      if (!fresh.context.trays.some(tray => tray.projectTrayId === projectTrayId)) throw new Error('This tray is no longer in the project. Check the trays again.');
      const saved = fresh.context.resolutions.find(resolution => resolution.projectTrayId === projectTrayId);
      if (!saved || saved.mode !== 'roots' || !preparationResolutionMatchesScope(saved.scope, fresh.context.scope) ||
        saved.rootObjectIds.length !== roots.length || !roots.every(root => saved.rootObjectIds.includes(root))) {
        update(value => ({ ...value, progress: 'Assigning the selected model tray…' }));
        fresh = await execute({ kind: 'resolution', body: {
          schemaVersion: 'wfc.pf.preparation-resolution.write.v1', expected: fresh.context.scope,
          idempotencyKey: crypto.randomUUID(), projectTrayId, mode: 'roots', rootObjectIds: roots,
          reason: 'Assigned from the current model selection.',
        } }, signal, true);
      }
      await prepareTrays(signal, fresh);
    });
  }, [execute, operate, prepareTrays, readCurrent, reconcileAutomatic, update]);
  const currentModel = pf.data?.activeModel;
  const staleModelDisplay = Boolean(currentModel && state.context && !sameModel(state.context.scope, currentModel));
  const view = state.identity === identity && enabled
    ? staleModelDisplay ? { ...state, context: null, session: null, discovery: null, notice: null, progress: null } : state
    : initial(identity);
  const canMutate = enabled && active && !view.busy && !view.unknown && !view.conflict;
  const networkReady = Boolean(!view.unknown && !view.conflict && view.context && networkTraceMatches(view.context, view.networkTrace));
  const networkReadinessKey = networkReady ? canonicalPurposeJson({ projectId: view.context!.projectId,
    aggregateId: view.context!.currentAggregate!.id, artifactId: view.context!.currentAggregate!.artifactId,
    geometryRevision: view.context!.currentAggregate!.geometryRevision, projection: view.context!.currentAggregate!.projection,
    traceId: view.networkTrace!.id, traceSha256: view.networkTrace!.contentSha256, captureFrameId: view.networkTrace!.captureFrameId }) : null;
  return {
    ...view,
    networkReady,
    networkReadinessKey,
    enabled,
    canMutate,
    refresh,
    checkTrays,
    assignTray,
    discover,
    freezePlan,
    resolve,
    loadSession,
    collect,
    publish: (reason: string) => mutate('publish', reason),
    cancel: (reason: string) => mutate('cancel', reason),
    retry: cancelPending.current ? () => cancelActive('') : retry,
    pause,
    cancelBusy,
    publishing: pending.current?.kind === 'publish' && view.busy,
    publishPending: pending.current?.kind === 'publish',
    cancellationPending: Boolean(cancelPending.current),
    cancelActive,
  };
}
