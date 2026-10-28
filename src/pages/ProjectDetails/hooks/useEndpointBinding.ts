import { useCallback, useEffect, useRef, useState } from 'react';
import {
  EndpointBindingApiError,
  fetchEndpointBinding,
  fetchEndpointBindingHistory,
  saveEndpointBinding,
  type EndpointBindingContext,
  type EndpointBindingHistory,
  type EndpointBindingWrite,
  type EndpointBindingReceipt,
  evaluateEndpointMigration,
  confirmEndpointMigration,
  type EndpointMigrationWrite,
  type EndpointMigrationConfirm,
  type EndpointMigrationDecision,
} from '@/api/pathfinderEndpointBindings';
import {
  fetchGeometryTraceObjects,
  GeometryTraceApiError,
  type GeometryObjectPage,
} from '@/api/pathfinderGeometryTrace';

export type EndpointBindingAccess = {
  projectId: string | null;
  loadedProjectId: string | null;
  token: string | null;
  isAdmin: boolean;
  locationId: string;
  contextKey: string;
  onSaved?: (receipt: EndpointBindingReceipt) => void | Promise<void>;
  onAuthorityLost?: () => void;
};
type State = {
  identity: string;
  context: EndpointBindingContext | null;
  history: EndpointBindingHistory | null;
  objects: GeometryObjectPage | null;
  migration: EndpointMigrationDecision | null;
  busy: boolean;
  unknown: boolean;
  recoveryPending: boolean;
  conflict: boolean;
  error: string | null;
};
const empty = (identity: string): State => ({
  identity,
  context: null,
  history: null,
  objects: null,
  migration: null,
  busy: false,
  unknown: false,
  recoveryPending: false,
  conflict: false,
  error: null,
});
export function useEndpointBinding(access: EndpointBindingAccess) {
  const { projectId, loadedProjectId, token, isAdmin, locationId, contextKey } = access;
  const account = JSON.stringify([projectId, loadedProjectId, token, isAdmin, locationId]);
  const identity = JSON.stringify([account, contextKey]);
  const enabled = Boolean(isAdmin && token && projectId && projectId === loadedProjectId);
  const latest = useRef(identity);
  latest.current = identity;
  const callbacks = useRef(access);
  callbacks.current = access;
  const mounted = useRef(true),
    controller = useRef<AbortController | null>(null),
    busy = useRef(false);
  const pending = useRef<
      | { kind: 'save'; body: EndpointBindingWrite }
      | { kind: 'migration'; body: EndpointMigrationWrite }
      | { kind: 'confirm'; decisionId: string; body: EndpointMigrationConfirm }
      | null
    >(null),
    pendingAccount = useRef(account);
  const [state, setState] = useState<State>(() => empty(identity));
  const current = useCallback(
    (signal: AbortSignal) => {
      if (!mounted.current || latest.current !== identity || signal.aborted)
        throw new DOMException('The endpoint context changed.', 'AbortError');
    },
    [identity],
  );
  const update = useCallback(
    (value: Partial<State>) => {
      if (mounted.current && latest.current === identity)
        setState((previous) => ({ ...previous, ...value }));
    },
    [identity],
  );
  const run = useCallback(
    async (operation: (signal: AbortSignal) => Promise<void>) => {
      if (!enabled || busy.current) return;
      const abort = new AbortController();
      controller.current = abort;
      busy.current = true;
      update({ busy: true, error: null });
      try {
        await operation(abort.signal);
        current(abort.signal);
      } catch (error) {
        if (!mounted.current || latest.current !== identity) return;
        if (
          (error instanceof EndpointBindingApiError || error instanceof GeometryTraceApiError) &&
          [401, 403].includes(error.status ?? 0)
        ) {
          pending.current = null;
          setState({ ...empty(identity), error: error.message });
          callbacks.current.onAuthorityLost?.();
        } else {
          const unknown =
            Boolean(pending.current) &&
            (!(
              error instanceof EndpointBindingApiError || error instanceof GeometryTraceApiError
            ) ||
              error.outcome === 'unknown');
          if (!unknown) pending.current = null;
          update({
            unknown,
            recoveryPending: unknown,
            conflict:
              !unknown &&
              (error instanceof EndpointBindingApiError ||
                error instanceof GeometryTraceApiError) &&
              error.status === 409,
            error:
              error instanceof DOMException && error.name === 'AbortError'
                ? null
                : unknown
                  ? 'The save outcome is unknown. Reconcile the same saved command before making changes.'
                  : error instanceof Error
                    ? error.message
                    : 'The shared endpoint could not be read.',
          });
        }
      } finally {
        if (controller.current === abort) {
          busy.current = false;
          controller.current = null;
        }
        update({ busy: false });
      }
    },
    [current, enabled, identity, update],
  );
  const read = useCallback(
    async (signal: AbortSignal) => {
      const context = await fetchEndpointBinding(projectId!, token!, locationId, signal);
      current(signal);
      update({ context });
      if (context.location) {
        const history = await fetchEndpointBindingHistory(
          projectId!,
          token!,
          locationId,
          null,
          signal,
        );
        current(signal);
        update({ history });
      } else update({ history: null });
    },
    [projectId, token, locationId, current, update],
  );
  useEffect(() => {
    mounted.current = true;
    controller.current?.abort();
    busy.current = false;
    if (pendingAccount.current !== account) {
      pending.current = null;
      pendingAccount.current = account;
    }
    setState({
      ...empty(identity),
      unknown: Boolean(pending.current),
      recoveryPending: Boolean(pending.current),
    });
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, [account, identity]);
  useEffect(() => {
    if (enabled) void run(read);
  }, [enabled, identity, run, read]);
  const executeSave = useCallback(
    async (signal: AbortSignal) => {
      const command = pending.current;
      if (!command) return;
      if (command.kind === 'migration') {
        const migration = await evaluateEndpointMigration(
          projectId!,
          token!,
          locationId,
          command.body,
          signal,
        );
        current(signal);
        pending.current = null;
        update({ migration, unknown: false, conflict: false, recoveryPending: false });
        return;
      }
      const receipt =
        command.kind === 'save'
          ? await saveEndpointBinding(projectId!, token!, locationId, command.body, signal)
          : await confirmEndpointMigration(
              projectId!,
              token!,
              locationId,
              command.decisionId,
              command.body,
              signal,
            );
      current(signal);
      // The write is confirmed. A later read/callback failure cannot make its outcome unknown.
      pending.current = null;
      update({ unknown: false, conflict: false, migration: null, recoveryPending: false });
      try {
        await callbacks.current.onSaved?.(receipt);
      } catch {
        current(signal);
        update({
          error: 'The endpoint was saved. Refresh the cable list to see its current readiness.',
        });
      }
      current(signal);
      await read(signal);
    },
    [projectId, token, locationId, current, update, read],
  );
  const save = useCallback(
    (command: EndpointBindingWrite) =>
      run(async (signal) => {
        if (pending.current || state.conflict) return;
        pending.current = { kind: 'save', body: structuredClone(command) };
        update({ recoveryPending: true });
        await executeSave(signal);
      }),
    [run, state.conflict, executeSave, update],
  );
  const retry = useCallback(() => run(executeSave), [run, executeSave]);
  const discardRefresh = useCallback(
    () =>
      run(async (signal) => {
        if (pending.current) return;
        update({ conflict: false, migration: null, objects: null });
        await read(signal);
      }),
    [run, update, read],
  );
  const historyPage = useCallback(
    (beforeRevision: string | null) =>
      run(async (signal) => {
        if (pending.current) return;
        const history = await fetchEndpointBindingHistory(
          projectId!,
          token!,
          locationId,
          beforeRevision,
          signal,
        );
        current(signal);
        update({ history });
      }),
    [run, projectId, token, locationId, current, update],
  );
  const loadObjects = useCallback(
    (offset = 0) =>
      run(async (signal) => {
        const scope = state.context?.current;
        if (pending.current || !scope?.traceId) return;
        const objects = await fetchGeometryTraceObjects(
          projectId!,
          token!,
          scope.traceId,
          offset,
          signal,
        );
        current(signal);
        update({ objects });
      }),
    [run, state.context, projectId, token, current, update],
  );
  const evaluateMigration = useCallback(
    (command: EndpointMigrationWrite) =>
      run(async (signal) => {
        if (pending.current || state.conflict) return;
        pending.current = { kind: 'migration', body: structuredClone(command) };
        update({ recoveryPending: true });
        await executeSave(signal);
      }),
    [run, state.conflict, executeSave, update],
  );
  const confirmMigration = useCallback(
    (decisionId: string, command: EndpointMigrationConfirm) =>
      run(async (signal) => {
        if (pending.current || state.conflict) return;
        pending.current = { kind: 'confirm', decisionId, body: structuredClone(command) };
        update({ recoveryPending: true });
        await executeSave(signal);
      }),
    [run, state.conflict, executeSave, update],
  );
  return {
    ...(state.identity === identity ? state : empty(identity)),
    enabled,
    save,
    retry,
    discardRefresh,
    historyPage,
    loadObjects,
    evaluateMigration,
    confirmMigration,
  };
}
