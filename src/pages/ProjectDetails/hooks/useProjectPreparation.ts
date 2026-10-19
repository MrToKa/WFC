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
import { preparationCaptureRequest } from '../../../../shared/preparationMerge';
import { collectPreparationDiscovery } from './collectPreparationDiscovery';
import type { usePathFinder } from './usePathFinder';
import {saveCaptureEvidence,GeometryTraceApiError} from '@/api/pathfinderGeometryTrace';
import {bindCompletedCaptureEvidence,type CompletedCaptureEvidence} from '../../../../viewer-runtime/capture-evidence.mjs';

type PF = ReturnType<typeof usePathFinder>;
type Pending =
  | { kind: 'create'; body: PreparationCreate }
  | { kind: 'resolution'; body: PreparationResolutionWrite }
  | { kind: 'part'; sessionId: string; partId: string; body: PreparationPartUpload;completedEvidence?:CompletedCaptureEvidence }
  | {kind:'evidence';sessionId:string;partId:string;body:{sessionPlanSha256:string;payloadSha256:string;evidence:CompletedCaptureEvidence}}
  | { kind: 'publish' | 'cancel'; sessionId: string; body: PreparationMutation };
type State = {
  identity: string;
  context: PreparationContext | null;
  index: PreparationIndex | null;
  session: PreparationSession | null;
  discovery: PreparationDiscovery | null;
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
const reloadRequired = (error: unknown) =>
  Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'CAPTURE_RELOAD_REQUIRED',
  );

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
  const mounted = useRef(true),
    currentAbort = useRef<AbortController | null>(null),
    busyRef = useRef(false),
    pending = useRef<Pending | null>(null);
  const protectedRun = useRef(false);
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
      if (!mounted.current || latest.current !== identity || !enabled || signal?.aborted)
        throw new DOMException('Project preparation paused.', 'AbortError');
    },
    [enabled, identity],
  );
  const readCurrent = useCallback(
    async (signal?: AbortSignal, sessionId?: string) => {
      assertCurrent(signal);
      const [context, index] = await Promise.all([
        fetchPreparationContext(access.projectId!, access.token!, signal),
        fetchPreparationIndex(access.projectId!, access.token!, signal),
      ]);
      assertCurrent(signal);
      const id = sessionId ?? stateRef.current.session?.id ?? index.sessions[0]?.id;
      const session = id
        ? await fetchPreparationSession(access.projectId!, access.token!, id, signal)
        : null;
      assertCurrent(signal);
      if (session?.state === 'validating' && session.recovery && !pending.current) {
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
        loading: false,
        conflict: false,
        error: null,
      }));
      return { context, index, session };
    },
    [access?.projectId, access?.token, assertCurrent, update],
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
        protectedRun.current = false;
        if (currentAbort.current === abort) {
          currentAbort.current = null;
          busyRef.current = false;
        }
        update((value) => ({ ...value, busy: false, loading: false }));
      }
    },
    [enabled, identity, update],
  );
  const execute = useCallback(
    async (command: Pending, signal: AbortSignal) => {
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
          const receipt=await uploadPreparationPart(
            access.projectId!,
            access.token!,
            command.sessionId,
            command.partId,
            command.body,
            signal,
          );
          if(command.completedEvidence){
            const evidence=await bindCompletedCaptureEvidence(command.completedEvidence,{selectionRevision:command.completedEvidence.binding.selectionRevision,partPayloadSha256:receipt.part.payloadSha256});
            pending.current={kind:'evidence',sessionId:command.sessionId,partId:command.partId,body:{sessionPlanSha256:command.body.sessionPlanSha256,payloadSha256:receipt.part.payloadSha256,evidence}};
            await saveCaptureEvidence(access.projectId!,access.token!,command.sessionId,command.partId,command.body.sessionPlanSha256,receipt.part.payloadSha256,evidence,signal);
          }
          sessionId = command.sessionId;
          break;}
        case 'evidence':
          await saveCaptureEvidence(access.projectId!,access.token!,command.sessionId,command.partId,command.body.sessionPlanSha256,command.body.payloadSha256,command.body.evidence,signal);sessionId=command.sessionId;break;
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
      pending.current = null;
      assertCurrent();
      update((value) => ({
        ...value,
        unknown: false,
        notice: 'Command confirmed. Refreshing current preparation status.',
      }));
      const fresh = await readCurrent(signal, sessionId);
      if (command.kind === 'resolution')
        update((value) => ({
          ...value,
          session: null,
          discovery: null,
          notice: 'Resolution saved with its reason. Discover again to freeze a new plan.',
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
    busyRef.current = false;
    currentAbort.current?.abort();
    setState(initial(identity));
    if (enabled)
      void operate(async (signal) => {
        update((value) => ({ ...value, loading: true }));
        await readCurrent(signal);
      });
    return () => {
      mounted.current = false;
      currentAbort.current?.abort();
    };
  }, [identity, enabled, operate, readCurrent, update]);
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
        const { context } = await readCurrent(signal);
        protectedRun.current = true;
        const result = await latestPf.current.runProjectPreparation(
          context.scope,
          (viewer) =>
            collectPreparationDiscovery(context, viewer, (text) =>
              update((value) => ({ ...value, progress: text })),
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
            ? 'Exact discovery finished. Review every missing or ambiguous tray before freezing the plan.'
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
  const collect = useCallback(
    () =>
      operate(async (signal) => {
        if (pending.current || stateRef.current.conflict || !stateRef.current.session) return;
        const original = stateRef.current.session;
        let fresh = await readCurrent(signal, original.id);
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
                    progress: `Collecting part ${part.partIndex + 1} of ${session!.plan.partPlan.length}. Committed parts are retained.`,
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
                  );
                  if (!fresh.session || !sameScope(frozenScope, fresh.context.scope))
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
              progress: `Reloading the protected model to renew its bounded request budget (${renewals} of 16).`,
            }));
            const until = Date.now() + 300000;
            while (
              latestPf.current.preparationViewerGeneration <= generation ||
              latestPf.current.viewerPhase !== 'ready'
            ) {
              assertCurrent(signal);
              if (Date.now() > until)
                throw new Error(
                  'Reload the model, then Resume the same preparation. Its committed parts are retained.',
                );
              await new Promise((done) => setTimeout(done, 100));
            }
            fresh = await readCurrent(signal, session.id);
            if (!fresh.session || !sameScope(frozenScope, fresh.context.scope))
              throw new Error('The project changed during model reload. Create a new frozen plan.');
            session = fresh.session;
          }
        }
        update((value) => ({
          ...value,
          progress: null,
          notice:
            'Every planned part is committed. Validate and publish the complete network when ready.',
        }));
      }),
    [operate, readCurrent, execute, assertCurrent, update],
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
  const view = state.identity === identity && enabled ? state : initial(identity);
  const canMutate = enabled && active && !view.busy && !view.unknown && !view.conflict;
  return {
    ...view,
    enabled,
    canMutate,
    refresh,
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
