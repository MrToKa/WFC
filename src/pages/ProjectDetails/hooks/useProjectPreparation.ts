import { generateId } from '@/utils/generateId';
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
import { modelCaptureErrorMessage, modelCaptureErrorContext } from '../../../../viewer-runtime/model-capture-errors.mjs';
import type { usePathFinder } from './usePathFinder';
import {saveCaptureEvidence,GeometryTraceApiError,createGeometryTrace,fetchGeometryTraces,fetchGeometryTraceManifest,fetchGeometryTraceRuntime,buildGeometryTraceCommand,
  type GeometryTraceCreate,type GeometryTraceManifest} from '@/api/pathfinderGeometryTrace';
import {GEOMETRY_TRACE_DERIVATION} from '../../../../shared/pathfinderGeometryTrace';
import {bindCompletedCaptureEvidence,type CompletedCaptureEvidence} from '../../../../viewer-runtime/capture-evidence.mjs';
import { formatPreparationDiagnostics } from '../preparationDiagnostics';
import { trayIdentityErrorMessage } from '@/viewer/trayIdentityErrors';
import { validateTrayIdentityRequest, type TrayObjectIdentity, type TrayIdentityMatch } from '../../../../viewer-runtime/tray-identity.mjs';

type PF = ReturnType<typeof usePathFinder>;
type PreparationModel = { modelVersionId: string | null; contentFingerprint: string | null; selectionRevision: string };
type CurrentPreparation = { context: PreparationContext; index: PreparationIndex; session: PreparationSession | null; networkTrace: GeometryTraceManifest | null };
type Pending =
  | { kind: 'create'; body: PreparationCreate }
  | { kind: 'resolution'; body: PreparationResolutionWrite }
  | { kind: 'part'; sessionId: string; partId: string; body: PreparationPartUpload;completedEvidence?:CompletedCaptureEvidence }
  | {kind:'evidence';sessionId:string;partId:string;body:{sessionPlanSha256:string;payloadSha256:string;evidence:CompletedCaptureEvidence}}
  | { kind: 'trace'; body: GeometryTraceCreate; preparation: CurrentPreparation; invalidated?: true }
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
const traceCommandMatches = (context: PreparationContext, command: GeometryTraceCreate) =>
  publishedNetworkMatches(context) && context.currentAggregate!.id === command.aggregateId &&
  context.currentAggregate!.projection.sha256 === command.expectedProjectionSha256 &&
  command.derivationVersion === GEOMETRY_TRACE_DERIVATION;
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
      (error.code === 'CAPTURE_RELOAD_REQUIRED' || error.code === 'MODEL_CAPTURE_GEOMETRY_NOT_RESIDENT'),
  );
class PreparationPartCaptureError extends Error {
  readonly code: string;
  readonly objectId?: number;
  readonly fragmentId?: number;
  constructor(cause: unknown, partIndex: number, partCount: number) {
    const code = cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string' ? cause.code : 'EXTRACTION_FAILED';
    const context = modelCaptureErrorContext(cause);
    const detail = modelCaptureErrorMessage(code) ?? 'The viewer could not read this part completely.';
    super(`Tray geometry capture stopped at part ${partIndex + 1} of ${partCount}. ${detail}` +
      (context.objectId !== undefined ? ` Object: dbid:${context.objectId}.` : '') +
      (context.fragmentId !== undefined ? ` Fragment: ${context.fragmentId}.` : '') +
      ` (${code}). Committed parts are retained. Choose Discover project tray candidates to resume the missing parts.`);
    this.code = code;
    this.objectId = context.objectId;
    this.fragmentId = context.fragmentId;
  }
}
class PreparationDisplayScopeError extends Error {}
const automaticRecoveryDelays = [250, 750] as const;
const recoverableReceipt = (error: unknown) =>
  (error instanceof PreparationApiError || error instanceof GeometryTraceApiError)
    ? error.outcome === 'unknown' && ![401, 403].includes(error.status ?? 0)
    : error instanceof TypeError;
const waitForRecovery = (milliseconds: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const aborted = () => { clearTimeout(timer); reject(new DOMException('Project preparation paused.', 'AbortError')); };
  const timer = setTimeout(() => { signal.removeEventListener('abort', aborted); resolve(); }, milliseconds);
  if (signal.aborted) aborted();
  else signal.addEventListener('abort', aborted, { once: true });
});

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
      const pendingTrace = pending.current;
      if (pendingTrace?.kind === 'trace' && !traceCommandMatches(context, pendingTrace.body)) {
        // Invalidate readiness, not reconciliation of the exact saved write.
        // Its immutable historical receipt may still confirm the outcome;
        // an uncommitted stale write is refused by the server's commit fence.
        pendingTrace.invalidated = true;
        update(value => ({ ...value, context, index, networkTrace: null }));
      }
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
      // A verified manifest is the durable result of this aggregate/derivation
      // command. Reconcile only that exact command, never an unrelated write.
      const saved = pending.current;
      const reconciledTrace = saved?.kind === 'trace' && traceCommandMatches(context, saved.body) &&
        networkTraceMatches(context, networkTrace);
      if (reconciledTrace) pending.current = null;
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
        ...(reconciledTrace ? { unknown: false, progress: null, notice: 'Tray network is ready for routing calculations.' } : {}),
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
        const trayIdentityMessage = error instanceof Error && 'code' in error ? trayIdentityErrorMessage(error.code) : null;
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
              'The command outcome is unknown. Retry the same command before making further changes.'
                + (error instanceof GeometryTraceApiError ? ` (${error.code})` : ''),
          }));
        else {
          let refreshedRefusal = false;
          if ((error instanceof PreparationApiError||error instanceof GeometryTraceApiError) && error.outcome === 'refused') {
            pending.current = null;
            // A definite refusal has no unknown write to protect. Refresh its
            // scope so the next selection need not reload a healthy viewer.
            if (automaticRun.current) {
              try { await readCurrent(abort.signal); refreshedRefusal = true; }
              catch { /* Keep the original refusal and any unresolved scope. */ }
            }
          }
          update((value) => ({
            ...value,
            unknown: Boolean(pending.current),
            conflict: !refreshedRefusal && (error instanceof PreparationApiError||error instanceof GeometryTraceApiError) && error.status === 409,
            error:
              error instanceof DOMException && error.name === 'AbortError'
                ? null
                : trayIdentityMessage
                  ? trayIdentityMessage
                : error instanceof PreparationPartCaptureError
                  ? error.message
                : reloadRequired(error)
                  ? 'Reload the protected model, then repeat discovery or Resume the frozen preparation. Committed parts are retained.'
                  : error instanceof PreparationDiscoveryError
                    ? `${error.message} The published network is unchanged. Review this discovery stage before trying again.`
                  : error instanceof Error && 'code' in error && error.code === 'EXTRACTION_FAILED'
                    ? 'Model extraction stopped. The viewer did not report a specific cause. Committed parts are retained.'
                  : error instanceof GeometryTraceApiError
                    ? error.code === 'GEOMETRY_TRACE_DERIVATION_CHANGED' && error.outcome === 'refused'
                      ? 'The geometry trace runtime changed. This command was refused. Choose Discover project tray candidates again to start a new command for the current runtime. (GEOMETRY_TRACE_DERIVATION_CHANGED)'
                      : `${error.message} (${error.code})`
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
    [enabled, identity, readCurrent, update],
  );
  const execute = useCallback(
    async (command: Pending, signal: AbortSignal, automatic = false, expectedPublicationPlan?: string) => {
      assertCurrent(signal);
      const publicationPlan = expectedPublicationPlan ?? (command.kind === 'publish' && stateRef.current.session?.id === command.sessionId
        ? stateRef.current.session.plan.orderedPlanSha256 : null);
      pending.current = command;
      update((value) => ({ ...value, unknown: false }));
      let sessionId: string | undefined;
      let confirmedTrace: CurrentPreparation | null = null;
      const invoke = async (command: Pending) => { switch (command.kind) {
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
          // Replay is restricted to this exact command even if the displayed
          // scope changed. A historical receipt confirms the write, not that
          // its old scope is ready for today's routing calculations.
          const receipt = await createGeometryTrace(access.projectId!, access.token!, command.body, signal);
          if (receipt.trace.projectId !== access.projectId || !traceCommandMatches(command.preparation.context, command.body)
            || !networkTraceMatches(command.preparation.context, receipt.trace))
            throw new GeometryTraceApiError('INVALID_RESPONSE', null, 'The network frame result could not be verified. Check the trays again.', 'unknown');
          // Model changes can abort presentation while an in-flight write still
          // returns its valid receipt. Its outcome is known even when that old
          // model must no longer be displayed as ready.
          assertCurrent();
          if (pending.current === command) {
            pending.current = null;
            update(value => ({ ...value, unknown: false }));
          }
          assertCurrent(signal);
          // The API has already checked the manifest schema and content digest.
          // A new trace is checked against the current scope by the server at
          // commit. Keep its exact receipt without another contended status read.
          // A duplicate may be historical: its write is confirmed, but readiness
          // still requires the fresh context/manifest read below.
          const model = latestPf.current.data?.activeModel;
          if (!receipt.duplicate && !command.invalidated && (!model || sameModel(model, command.preparation.context.scope)))
            confirmedTrace = { ...command.preparation, networkTrace: receipt.trace };
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
      } };
      let attemptCommand = command;
      for (let attempt = 0; ; attempt++) {
        try { await invoke(attemptCommand); break; }
        catch (error) {
          assertCurrent(signal);
          const saved: Pending | null = pending.current;
          // A committed part can advance ownership to its evidence command.
          // Replay that exact evidence, never recapture or upload the part again.
          const ownsSaved = saved === attemptCommand || (attemptCommand.kind === 'part' && saved?.kind === 'evidence'
            && saved.sessionId === attemptCommand.sessionId && saved.partId === attemptCommand.partId);
          if (saved?.kind === 'trace' && ownsSaved && recoverableReceipt(error)) {
            let checked: CurrentPreparation | null = null;
            try { checked = await readCurrent(signal); }
            catch (readError) {
              // Scope/access changes are authoritative. Other read failures do
              // not establish an uncertain command's outcome; keep its binding.
              if (readError instanceof PreparationDisplayScopeError ||
                (readError instanceof PreparationApiError || readError instanceof GeometryTraceApiError) &&
                [401, 403].includes(readError.status ?? 0)) throw readError;
            }
            assertCurrent(signal);
            if (checked && traceCommandMatches(checked.context, saved.body) && networkTraceMatches(checked.context, checked.networkTrace))
              return checked;
          }
          // Publication validation can durably refuse a session before the error
          // response is lost. Check that exact session before replaying a write.
          if (saved?.kind === 'publish' && ownsSaved && publicationPlan && recoverableReceipt(error)) {
            let checked: PreparationSession | null = null;
            try { checked = await fetchPreparationSession(access.projectId!, access.token!, saved.sessionId, signal); }
            catch { /* An unavailable status read cannot resolve an uncertain write. */ }
            assertCurrent(signal);
            if (pending.current === saved && checked && checked.id === saved.sessionId && checked.projectId === access.projectId
              && checked.plan.orderedPlanSha256 === publicationPlan && checked.state === 'failed'
              && checked.publishedAggregateId === null && checked.failure) {
              pending.current = null;
              update(value => ({ ...value, session: checked, unknown: false }));
              throw new PreparationApiError(checked.failure.code, 422,
                `Tray network was not published: ${checked.failure.message} (${checked.failure.code}). Assigned objects are retained. Correct the reported issue, then discover again.`, 'refused');
            }
          }
          if (!automatic || !saved || !ownsSaved || attempt >= automaticRecoveryDelays.length || !recoverableReceipt(error)) throw error;
          attemptCommand = saved;
          const label = saved.kind === 'trace' ? 'Tray network saved. Confirming its final check'
            : saved.kind === 'resolution' ? 'Confirming the saved tray assignment' : 'Confirming the saved tray update';
          update(value => ({ ...value, progress: `${label} (${attempt + 2} of ${automaticRecoveryDelays.length + 1})…`, notice: null }));
          await waitForRecovery(automaticRecoveryDelays[attempt], signal);
          assertCurrent(signal);
        }
      }
      if (confirmedTrace) {
        assertCurrent(signal);
        pending.current = null;
        const verified = confirmedTrace as CurrentPreparation;
        update(value => ({ ...value, ...verified, unknown: false, conflict: false, error: null, progress: null,
          notice: 'Tray network is ready for routing calculations.' }));
        return verified;
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
              idempotencyKey: generateId(),
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
              idempotencyKey: generateId(),
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
                  ).catch(error => {
                    if (error?.name === 'AbortError') throw error;
                    if (!modelCaptureErrorMessage(error?.code) && error?.code !== 'EXTRACTION_FAILED' && error?.code !== 'CAPTURE_RELOAD_REQUIRED') throw error;
                    throw new PreparationPartCaptureError(error, part.partIndex, session!.plan.partPlan.length);
                  });
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
              idempotencyKey: generateId(),
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
            idempotencyKey: generateId(),
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
    const runtime = await fetchGeometryTraceRuntime(access.projectId!, access.token!, signal);
    assertCurrent(signal);
    const aggregate = fresh.context.currentAggregate!, aggregateId = aggregate.id;
    const command = await buildGeometryTraceCommand(fresh.context.projectId, aggregateId, aggregate.projection.sha256, runtime.runtimeFingerprintSha256);
    assertCurrent(signal);
    const verified = await execute({ kind: 'trace', body: command, preparation: fresh }, signal, true);
    if (verified.context.currentAggregate?.id !== aggregateId || !networkTraceMatches(verified.context, verified.networkTrace))
      throw new Error('The model frame could not be confirmed for the current network. Check the trays again.');
    return verified;
  }, [access?.projectId, access?.token, assertCurrent, execute, update]);
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
      // Older releases could replace a stale manual assignment by a name match.
      // Rebuild that plan so unresolved physical assignments are skipped instead.
      if (fresh.context.resolutions.some(resolution => resolution.mode === 'roots' && !sameModel(resolution.scope, fresh.context.scope)
        && fresh.session!.plan.requestedScope.trays.some(tray => tray.projectTrayId === resolution.projectTrayId))) return false;
      if (fresh.session.plan.requestedScope.skippedTrays?.length) await discoverTrays(fresh.context, signal);
      fresh = await ensureNetworkTrace(fresh, signal);
      update(value => ({ ...value, progress: null, notice: 'Tray network is up to date.', unknown: false }));
      latestPf.current.refresh();
      return true;
    };
    // An earlier preparation may have skipped old manual assignments before
    // revision carryover was available. Recognise those before reusing it.
    if (!fresh.context.trayAssignmentCarryover?.length && await reusePublished()) return;

    // Cross-revision dbIds are never reused. Recover the physical assignment by
    // its persisted GUID/external identity, then create a current audited write.
    // The network below still captures geometry from the new model in full.
    const carryover = fresh.context.trayAssignmentCarryover ?? [];
    let restoredAssignments = 0;
    const unresolvedAssignments: string[] = [];
    const expectedModel = fresh.context.scope;
    if (carryover.length) {
      update(value => ({ ...value, progress: 'Recognising assigned tray objects in the new model revision…' }));
      const identities = [...new Map(carryover.flatMap(hint => hint.roots.map(root =>
        [canonicalPurposeJson(root.identity), root.identity] as const))).values()];
      const matches = await latestPf.current.runProjectPreparation(expectedModel, async viewer => {
        const found = new Map<string, TrayIdentityMatch>();
        if (!viewer.resolveTrayIdentities) return found;
        let checked = 0;
        const groups: TrayObjectIdentity[][] = [];
        for (const identity of identities) {
          let group = groups.at(-1);
          if (!group || !validateTrayIdentityRequest({ schemaVersion: 'wfc.pf.tray-identity-request.v1', identities: [...group, identity] })) {
            group = []; groups.push(group);
          }
          if (!validateTrayIdentityRequest({ schemaVersion: 'wfc.pf.tray-identity-request.v1', identities: [identity] })) continue;
          group.push(identity);
        }
        for (const group of groups.filter(group => group.length > 0)) {
          viewer.assertCurrent();
          const response = await viewer.resolveTrayIdentities({ schemaVersion: 'wfc.pf.tray-identity-request.v1', identities: group });
          viewer.assertCurrent();
          for (const match of response.matches) found.set(canonicalPurposeJson(match.identity), match);
          checked += group.length;
          update(value => ({ ...value, progress: `Recognising assigned tray objects (${checked} of ${identities.length})…` }));
        }
        return found;
      }, signal);
      assertCurrent(signal);
      for (const hint of carryover) {
        if (!sameModel(expectedModel, fresh.context.scope)) throw new Error('The active model changed while recognising tray assignments. Check the trays again.');
        const saved = fresh.context.resolutions.find(item => item.projectTrayId === hint.projectTrayId);
        if (!saved || saved.id !== hint.resolutionId || saved.mode !== 'roots' ||
          saved.scope.modelVersionId !== hint.sourceModelVersionId || sameModel(saved.scope, fresh.context.scope) ||
          canonicalPurposeJson(saved.rootObjectIds) !== canonicalPurposeJson(hint.roots.map(root => root.objectId))) continue;
        const matched = hint.roots.map(root => matches.get(canonicalPurposeJson(root.identity)));
        const roots = matched.flatMap(match => match?.status === 'unique' && match.objectIds.length === 1 ? [`dbid:${match.objectIds[0]}`] : []);
        if (roots.length !== hint.roots.length || new Set(roots).size !== roots.length) {
          unresolvedAssignments.push(fresh.context.trays.find(tray => tray.projectTrayId === hint.projectTrayId)?.rawName ?? hint.projectTrayId);
          continue;
        }
        fresh = await execute({ kind: 'resolution', body: {
          schemaVersion: 'wfc.pf.preparation-resolution.write.v1', expected: fresh.context.scope,
          idempotencyKey: generateId(), projectTrayId: hint.projectTrayId, mode: 'roots', rootObjectIds: roots,
          reason: `Restored the saved tray assignment from model ${hint.sourceModelVersionId} by unique persistent object identity. Geometry is captured from the current model.`,
        } }, signal, true);
        restoredAssignments++;
      }
    }

    // Preserve explicit physical assignments when only project routing inputs
    // changed. Each renewal is a fresh audited write with the current full CAS.
    // Only same-model renewals may retain dbIds directly.
    const staleRoots = fresh.context.resolutions.filter(resolution => resolution.mode === 'roots' &&
      fresh.context.trays.some(tray => tray.projectTrayId === resolution.projectTrayId) &&
      sameModel(resolution.scope, fresh.context.scope) && !preparationResolutionMatchesScope(resolution.scope, fresh.context.scope));
    for (const resolution of staleRoots) {
      if (!sameModel(resolution.scope, fresh.context.scope)) throw new Error('The active model changed. Check the trays again.');
      fresh = await execute({ kind: 'resolution', body: {
        schemaVersion: 'wfc.pf.preparation-resolution.write.v1', expected: fresh.context.scope,
        idempotencyKey: generateId(), projectTrayId: resolution.projectTrayId, mode: 'roots',
        rootObjectIds: [...resolution.rootObjectIds], reason: 'Retained the previously assigned roots in the same model after project routing inputs changed.',
      } }, signal, true);
    }
    if (carryover.length && await reusePublished()) {
      if (unresolvedAssignments.length) update(value => ({ ...value,
        notice: `Tray network is up to date. Could not uniquely recognise ${unresolvedAssignments.length} assigned trays: ${unresolvedAssignments.slice(0, 8).join(', ')}${unresolvedAssignments.length > 8 ? '…' : ''}. Review their model selections.` }));
      return;
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
        idempotencyKey: generateId(), discovery: structuredClone(discovery), unresolvedTrayPolicy: 'skip',
      } }, signal, true);
      session = fresh.session;
      if (!session || !sameScope(session.plan, fresh.context.scope)) throw new Error('Project routing inputs changed. Check the trays again.');
    }
    if (session.plan.diagnostics.length > 0)
      throw new Error(formatPreparationDiagnostics(session.plan.diagnostics, fresh.context.trays).map(item => item.message).join(' '));
    try {
      fresh = await collectSession({ ...fresh, session }, signal, true);
    } catch (error) {
      const refusedPart = pending.current;
      if (error instanceof PreparationApiError && error.code === 'PREPARATION_VALIDATION_INPUT_LIMIT'
        && error.status === 413 && error.outcome === 'refused' && refusedPart?.kind === 'part'
        && refusedPart.sessionId === session.id && refusedPart.body.sessionPlanSha256 === session.plan.orderedPlanSha256) {
        // A frozen capacity cannot grow on replay. Retire only the exact,
        // definitively refused collection so the next explicit Discover can
        // obtain a fresh server capacity profile. Never cancel an uncertain write.
        pending.current = null;
        let checked: CurrentPreparation;
        try { checked = await readCurrent(signal, session.id); }
        catch { throw error; }
        const retained = checked.session;
        if (retained?.id === session.id && retained.projectId === session.projectId
          && retained.plan.orderedPlanSha256 === session.plan.orderedPlanSha256
          && ['planned', 'collecting'].includes(retained.state)) {
          await execute({ kind: 'cancel', sessionId: retained.id, body: {
            schemaVersion: 'wfc.pf.preparation-mutation.v1', expectedSessionRevision: retained.sessionRevision,
            idempotencyKey: generateId(), reason: 'Retire this frozen preparation after its geometry capacity was definitively exceeded; retain the published network.',
          } }, signal);
        }
      }
      throw error;
    }
    if (!fresh.session || !fresh.session.coverage.requestedScopeComplete || fresh.session.coverage.missingPartIds.length)
      throw new Error('The tray update is incomplete. Check the trays again to continue.');
    update(value => ({ ...value, progress: 'Finishing the tray update…' }));
    fresh = await execute({ kind: 'publish', sessionId: fresh.session.id, body: {
      schemaVersion: 'wfc.pf.preparation-mutation.v1', expectedSessionRevision: fresh.session.sessionRevision,
      idempotencyKey: generateId(), reason: 'Update the project tray network from the current model.',
    } }, signal, true, fresh.session.plan.orderedPlanSha256);
    if (!publishedNetworkMatches(fresh.context) || fresh.session?.state !== 'published' || fresh.context.currentAggregate!.sessionId !== fresh.session.id)
      throw new Error('The tray update could not be confirmed. Check the trays again.');
    fresh = await ensureNetworkTrace(fresh, signal);
    const restorationNotice = restoredAssignments ? ` ${restoredAssignments} tray assignments were restored from the previous model revision; geometry was read from the current model.` : '';
    const unresolvedNotice = unresolvedAssignments.length ? ` Could not uniquely recognise ${unresolvedAssignments.length} assigned trays: ${unresolvedAssignments.slice(0, 8).join(', ')}${unresolvedAssignments.length > 8 ? '…' : ''}. Review their model selections.` : '';
    update(value => ({ ...value, progress: null, notice: `Tray network updated.${restorationNotice}${unresolvedNotice}`, unknown: false }));
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
          idempotencyKey: generateId(), projectTrayId, mode: 'roots', rootObjectIds: roots,
          reason: 'Assigned from the current model selection.',
        } }, signal, true);
      }
      update(value => ({ ...value, progress: null,
        notice: 'Tray assignment saved. Choose Discover project tray candidates to update the routing network.' }));
    });
  }, [execute, operate, readCurrent, reconcileAutomatic, update]);
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
