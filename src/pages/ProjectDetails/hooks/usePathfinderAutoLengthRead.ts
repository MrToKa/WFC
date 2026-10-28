import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchCableDetails } from '@/api/cables';
import { autoLengthViewSchema, emptyAutoLengthView, type AutoLengthView } from '../../../../shared/pathfinderAutoLength';

export type PathFinderCalculatedItemIdentity = {
  projectId: string; cableId: string; jobId: string; proposalId: string; proposalHash: string;
  revisionResultHash: string; dependencyHash: string;
};
type Input = {
  projectId: string | null; loadedProjectId: string | null; accountId: string | null; token: string | null;
  isAdmin: boolean; active: boolean; selectedCableId: string | null; item: PathFinderCalculatedItemIdentity | null;
  writeRefreshKey?: number;
};
type ReadState = { key: string; view: AutoLengthView | null; loading: boolean; error: string | null };
export const AUTO_LENGTH_READ_TIMEOUT_MS = 15000;
const unavailable = (previous: AutoLengthView | null): AutoLengthView => ({
  ...(previous ?? emptyAutoLengthView()), autoLengthStatus: 'unavailable', autoLengthMatchesLatestRequest: false,
});

/** Read the public Cable projection once per exact selected successful item.
 * Never refresh PF state, derive a length from a proposal, or submit a write. */
export function usePathfinderAutoLengthRead(input: Input) {
  const base = JSON.stringify([input.projectId, input.loadedProjectId, input.accountId, input.token, input.isAdmin, input.selectedCableId]);
  const enabled = Boolean(input.active && input.isAdmin && input.accountId && input.token && input.projectId
    && input.projectId === input.loadedProjectId && input.selectedCableId && input.item?.projectId === input.projectId
    && input.item?.cableId === input.selectedCableId);
  const key = JSON.stringify([base, enabled, input.item?.projectId, input.item?.cableId, input.item?.jobId, input.item?.proposalId,
    input.item?.proposalHash, input.item?.revisionResultHash, input.item?.dependencyHash, input.writeRefreshKey ?? 0]);
  const latest = useRef(key); latest.current = key;
  const latestInput = useRef(input); latestInput.current = input;
  const lastRead = useRef<{ base: string; view: AutoLengthView } | null>(null);
  const [state, setState] = useState<ReadState | null>(null), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (lastRead.current?.base !== base) lastRead.current = null;
    const currentInput = latestInput.current;
    if (!enabled || !currentInput.projectId || !currentInput.selectedCableId) { setState(null); return; }
    let closed = false;
    const previous = lastRead.current?.view ?? null;
    setState({ key, view: previous ? { ...previous, autoLengthStatus: 'pending', autoLengthMatchesLatestRequest: false } : null, loading: true, error: null });
    const fail = () => {
      if (closed || latest.current !== key) return;
      closed = true;
      setState({ key, view: unavailable(previous), loading: false, error: 'Automatic length could not be refreshed. Refresh automatic length to check its latest status.' });
    };
    const timeout = setTimeout(fail, AUTO_LENGTH_READ_TIMEOUT_MS);
    void fetchCableDetails(currentInput.projectId, currentInput.selectedCableId).then(response => {
      if (closed || latest.current !== key) return;
      const cable = response.cable;
      if (cable.id !== currentInput.selectedCableId || cable.projectId !== currentInput.projectId) throw new Error('AUTO_LENGTH_READ_SCOPE_CHANGED');
      const view = autoLengthViewSchema.parse({ autoCalculatedLength: cable.autoCalculatedLength, autoLengthStatus: cable.autoLengthStatus,
        autoLengthCalculatedAt: cable.autoLengthCalculatedAt, autoLengthBarrierStatus: cable.autoLengthBarrierStatus,
        autoLengthMatchesLatestRequest: cable.autoLengthMatchesLatestRequest });
      closed = true; lastRead.current = { base, view }; setState({ key, view, loading: false, error: null });
    }).catch(fail).finally(() => clearTimeout(timeout));
    return () => { closed = true; clearTimeout(timeout); };
    // Primitive identity keys intentionally deduplicate fresh polling objects.
  }, [base, key, enabled, attempt]);
  const refresh = useCallback(() => { if (enabled && latest.current === key) setAttempt(value => value + 1); }, [enabled, key]);
  return { view: state?.key === key ? state.view : null, loading: enabled && (state?.key !== key || state.loading),
    error: state?.key === key ? state.error : null, refresh };
}
