import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchPathFinderProposal } from '@/api/pathfinder';
import type { AnyBarrierExecution } from '../../../shared/pathfinderBarrierSupported';

type Identity = { jobId: string | null; proposalId: string | null };
type Input = {
  active: boolean; projectId: string | null; accountId: string | null; token: string | null;
  cableId: string; current: Identity; pending: boolean; stopped: boolean;
  diagnostics?: { cableId: string; jobId: string; proposalId?: string | null } | null;
  saved?: Identity | null; useSaved: boolean;
  review?: { cableId: string; proposalId: string | null; barriers?: AnyBarrierExecution | null } | null;
};
type State = { key: string; execution: AnyBarrierExecution | null; error: string | null };
type ReportView = { execution: AnyBarrierExecution | null; loading: boolean; error: string | null; retry: () => void };

/** Read the report for the displayed result. A newer failed calculation must
 * never borrow an older successful route's obstacle evidence. */
export function useCableObstacleReport(input: Input): ReportView {
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  const diagnostics = input.diagnostics?.cableId === input.cableId && input.diagnostics.jobId === input.current.jobId ? input.diagnostics : null;
  const target = input.stopped
    ? { jobId: input.current.jobId, proposalId: diagnostics?.proposalId ?? null }
    : input.useSaved ? input.saved ?? { jobId: null, proposalId: null } : input.current;
  const key = JSON.stringify([input.active, input.projectId, input.accountId, input.token, input.cableId, target.jobId, target.proposalId, input.pending, input.stopped, attempt]);
  const latest = useRef(key); latest.current = key;
  const [state, setState] = useState<State | null>(null);
  const known = !input.stopped && Boolean(target.proposalId) && input.review?.cableId === input.cableId && input.review.proposalId === target.proposalId
    ? input.review : null;
  useEffect(() => {
    if (!input.active || input.pending || !input.projectId || !input.token || !target.proposalId || known) return;
    const controller = new AbortController(); let live = true;
    void fetchPathFinderProposal(input.projectId, input.token, target.proposalId, controller.signal).then(proposal => {
      if (!live || controller.signal.aborted || latest.current !== key) return;
      if (proposal.projectId !== input.projectId || proposal.id !== target.proposalId || proposal.cableId !== input.cableId
        || target.jobId !== null && proposal.jobId !== target.jobId) throw new Error('Mismatched obstacle report');
      setState({ key, execution: proposal.barriers ?? null, error: null });
    }).catch(() => {
      if (live && !controller.signal.aborted && latest.current === key)
        setState({ key, execution: null, error: 'The obstacle list could not be read for this calculation. Refresh the cable and try again.' });
    });
    return () => { live = false; controller.abort(); };
  }, [key, input.active, input.pending, input.projectId, input.token, input.cableId, target.jobId, target.proposalId, known]);
  if (!input.active) return { execution: null, loading: false, error: null, retry };
  if (input.pending) return { execution: null, loading: true, error: null, retry };
  if (known) return { execution: known.barriers ?? null, loading: false, error: null, retry };
  if (!target.proposalId) return { execution: null, loading: input.stopped && !diagnostics, error: null, retry };
  return state?.key === key ? { execution: state.execution, loading: false, error: state.error, retry }
    : { execution: null, loading: true, error: null, retry };
}
