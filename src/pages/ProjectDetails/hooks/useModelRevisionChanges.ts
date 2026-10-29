import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchGeometryObjectRevision,
  GeometryTraceApiError,
  type GeometryObjectRevision,
} from '@/api/pathfinderGeometryTrace';
import {
  RevisionChangesApiError,
  fetchRevisionComparisonContext,
  fetchRevisionComparisons,
  fetchRevisionComparison,
  createRevisionComparison,
  fetchRevisionChanges,
  saveRevisionDecision,
  fetchRevisionDecisionHistory,
  fetchRevisionDecisionHead,
  type RevisionDecisionHeadQuery,
  type RevisionComparisonDecisionHead,
  type RevisionComparisonContext,
  type RevisionComparisonList,
  type RevisionComparisonManifest,
  type RevisionComparisonChangesPage,
  type RevisionComparisonDecisionHistory,
  type RevisionComparisonCreate,
  type RevisionComparisonDecisionWrite,
} from '@/api/pathfinderRevisionChanges';

export type ModelRevisionChangesAccess = {
  projectId: string | null;
  loadedProjectId: string | null;
  token: string | null;
  isAdmin: boolean;
  active: boolean;
  contextKey: string;
  onDecisionSaved?: () => void | Promise<void>;
  onAuthorityLost?: () => void;
  onRecoveryPendingChange?: (pending: boolean) => void;
};
type Pending =
  | { kind: 'create'; body: RevisionComparisonCreate }
  | { kind: 'decision'; comparisonId: string; body: RevisionComparisonDecisionWrite };
function frozenCommand<T>(input: T): T {
  const copy = structuredClone(input);
  const freeze = (value: unknown): void => {
    if (value && typeof value === 'object') {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
  };
  freeze(copy);
  return copy;
}
type State = {
  identity: string;
  context: RevisionComparisonContext | null;
  list: RevisionComparisonList | null;
  manifest: RevisionComparisonManifest | null;
  page: RevisionComparisonChangesPage | null;
  history: RevisionComparisonDecisionHistory | null;
  head: RevisionComparisonDecisionHead | null;
  headQueryKey: string | null;
  objectDetail: { side: 'source' | 'target'; record: GeometryObjectRevision } | null;
  busy: boolean;
  unknown: boolean;
  recoveryPending: boolean;
  conflict: boolean;
  error: string | null;
};
const empty = (identity: string): State => ({
  identity,
  context: null,
  list: null,
  manifest: null,
  page: null,
  history: null,
  head: null,
  headQueryKey: null,
  objectDetail: null,
  busy: false,
  unknown: false,
  recoveryPending: false,
  conflict: false,
  error: null,
});
export function useModelRevisionChanges(access: ModelRevisionChangesAccess) {
  const { projectId, loadedProjectId, token, isAdmin, active, contextKey } = access;
  const account = JSON.stringify([projectId, loadedProjectId, token, isAdmin]);
  const identity = JSON.stringify([account, contextKey]);
  const enabled = Boolean(projectId && projectId === loadedProjectId && token && isAdmin);
  const latest = useRef(identity);
  latest.current = identity;
  const callbacks = useRef(access);
  callbacks.current = access;
  const mounted = useRef(true),
    controller = useRef<AbortController | null>(null),
    busy = useRef(false),
    pending = useRef<Pending | null>(null),
    pendingAccount = useRef(account);
  const [state, setState] = useState<State>(() => empty(identity));
  const current = useCallback(
    (signal: AbortSignal) => {
      if (!mounted.current || latest.current !== identity || signal.aborted)
        throw new DOMException('The comparison context changed.', 'AbortError');
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
          (error instanceof RevisionChangesApiError || error instanceof GeometryTraceApiError) &&
          [401, 403].includes(error.status ?? 0)
        ) {
          pending.current = null;
          setState({ ...empty(identity), error: error.message });
          callbacks.current.onAuthorityLost?.();
        } else {
          const unknown =
            Boolean(pending.current) &&
            (!(error instanceof RevisionChangesApiError) || error.outcome === 'unknown');
          if (!unknown) pending.current = null;
          update({
            unknown,
            recoveryPending: unknown,
            conflict: !unknown && error instanceof RevisionChangesApiError && error.status === 409,
            error:
              error instanceof DOMException && error.name === 'AbortError'
                ? null
                : unknown
                  ? 'The comparison command outcome is unknown. Reconcile the same command and frozen pair before making changes.'
                  : error instanceof Error
                    ? error.message
                    : 'Model revision changes could not be read.',
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
    [enabled, current, identity, update],
  );
  const read = useCallback(
    async (signal: AbortSignal) => {
      const context = await fetchRevisionComparisonContext(projectId!, token!, signal);
      current(signal);
      update({ context });
      const list = await fetchRevisionComparisons(projectId!, token!, 0, signal);
      current(signal);
      update({ list });
    },
    [projectId, token, current, update],
  );
  const readComparison = useCallback(
    async (id: string, signal: AbortSignal) => {
      const manifest = await fetchRevisionComparison(projectId!, token!, id, signal);
      current(signal);
      update({
        manifest,
        page: null,
        history: null,
        head: null,
        headQueryKey: null,
        objectDetail: null,
      });
      const page = await fetchRevisionChanges(projectId!, token!, id, 0, signal);
      current(signal);
      if (page.contentSha256 !== manifest.contentSha256)
        throw new RevisionChangesApiError('COMPARISON_PAGE_CHANGED', null);
      update({ page });
      const history = await fetchRevisionDecisionHistory(projectId!, token!, id, null, signal);
      current(signal);
      update({ history });
    },
    [projectId, token, current, update],
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
    if (enabled && active) void run(read);
    else controller.current?.abort();
  }, [enabled, active, identity, run, read]);
  useEffect(() => {
    callbacks.current.onRecoveryPendingChange?.(state.recoveryPending);
  }, [state.recoveryPending]);
  useEffect(() => () => callbacks.current.onRecoveryPendingChange?.(false), []);
  const execute = useCallback(
    async (signal: AbortSignal) => {
      const command = pending.current;
      if (!command) return;
      let comparisonId: string;
      if (command.kind === 'create') {
        const receipt = await createRevisionComparison(projectId!, token!, command.body, signal);
        current(signal);
        comparisonId = receipt.comparison.id;
      } else {
        await saveRevisionDecision(projectId!, token!, command.comparisonId, command.body, signal);
        current(signal);
        comparisonId = command.comparisonId;
      }
      // Confirmed immutable receipt precedes refresh/callback. Their failure is never an unknown write.
      pending.current = null;
      update({ unknown: false, recoveryPending: false, conflict: false });
      if (command.kind === 'decision') {
        try {
          await callbacks.current.onDecisionSaved?.();
        } catch {
          current(signal);
          update({ error: 'The decision was saved. Refresh project readiness.' });
        }
      }
      current(signal);
      await read(signal);
      await readComparison(comparisonId, signal);
    },
    [projectId, token, current, update, read, readComparison],
  );
  const create = useCallback(
    (body: RevisionComparisonCreate) =>
      run(async (signal) => {
        if (pending.current || state.conflict) return;
        pending.current = { kind: 'create', body: frozenCommand(body) };
        update({ recoveryPending: true });
        await execute(signal);
      }),
    [run, state.conflict, update, execute],
  );
  const decide = useCallback(
    (comparisonId: string, body: RevisionComparisonDecisionWrite) =>
      run(async (signal) => {
        if (pending.current || state.conflict) return;
        pending.current = { kind: 'decision', comparisonId, body: frozenCommand(body) };
        update({ recoveryPending: true });
        await execute(signal);
      }),
    [run, state.conflict, update, execute],
  );
  const retry = useCallback(() => run(execute), [run, execute]);
  const open = useCallback(
    (id: string) =>
      run(async (signal) => {
        if (pending.current) return;
        await readComparison(id, signal);
      }),
    [run, readComparison],
  );
  const refresh = useCallback(
    () =>
      run(async (signal) => {
        if (pending.current) return;
        update({ conflict: false, manifest: null, page: null, history: null });
        await read(signal);
      }),
    [run, update, read],
  );
  const changesPage = useCallback(
    (offset: number) =>
      run(async (signal) => {
        if (pending.current || !state.manifest) return;
        const page = await fetchRevisionChanges(
          projectId!,
          token!,
          state.manifest.id,
          offset,
          signal,
        );
        current(signal);
        if (page.contentSha256 !== state.manifest.contentSha256)
          throw new RevisionChangesApiError('COMPARISON_PAGE_CHANGED', null);
        update({ page });
      }),
    [run, state.manifest, projectId, token, current, update],
  );
  const historyPage = useCallback(
    (beforeRevision: string | null) =>
      run(async (signal) => {
        if (pending.current || !state.manifest) return;
        const history = await fetchRevisionDecisionHistory(
          projectId!,
          token!,
          state.manifest.id,
          beforeRevision,
          signal,
        );
        current(signal);
        update({ history });
      }),
    [run, state.manifest, projectId, token, current, update],
  );
  const listPage = useCallback(
    (offset: number) =>
      run(async (signal) => {
        if (pending.current) return;
        const list = await fetchRevisionComparisons(projectId!, token!, offset, signal);
        current(signal);
        update({ list });
      }),
    [run, projectId, token, current, update],
  );
  const loadHead = useCallback(
    (query: RevisionDecisionHeadQuery) =>
      run(async (signal) => {
        if (pending.current || !state.manifest) return;
        const head = await fetchRevisionDecisionHead(
          projectId!,
          token!,
          state.manifest.id,
          query,
          signal,
        );
        current(signal);
        update({ head, headQueryKey: JSON.stringify(query) });
      }),
    [run, state.manifest, projectId, token, current, update],
  );
  const inspectObject = useCallback(
    (side: 'source' | 'target', objectRevisionId: string) =>
      run(async (signal) => {
        if (pending.current || !state.manifest || !state.page) return;
        const known = state.page.changes.some((change) =>
          (side === 'source'
            ? change.sourceObjectRevisionIds
            : [
                ...change.targetObjectRevisionIds,
                ...change.candidates.map((candidate) => candidate.objectRevisionId),
              ]
          ).includes(objectRevisionId),
        );
        if (!known) return;
        const scope = state.manifest[side],
          record = await fetchGeometryObjectRevision(
            projectId!,
            token!,
            scope.traceId,
            objectRevisionId,
            signal,
          );
        current(signal);
        if (
          record.aggregateId !== scope.aggregateId ||
          record.modelVersionId !== scope.modelVersionId ||
          record.provenance.projectionSha256 !== scope.projectionSha256
        )
          throw new RevisionChangesApiError('OBJECT_SCOPE_CHANGED', null);
        update({ objectDetail: { side, record } });
      }),
    [run, state.manifest, state.page, projectId, token, current, update],
  );
  return {
    ...(state.identity === identity
      ? state
      : {
          ...empty(identity),
          unknown: pendingAccount.current === account && Boolean(pending.current),
          recoveryPending: pendingAccount.current === account && Boolean(pending.current),
        }),
    enabled,
    pending: pendingAccount.current === account ? pending.current : null,
    create,
    decide,
    retry,
    open,
    refresh,
    changesPage,
    historyPage,
    listPage,
    loadHead,
    inspectObject,
  };
}
