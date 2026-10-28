import { useEffect, useMemo, useState } from 'react';
import { fetchRoutingPurposePolicy } from '@/api/pathfinderPolicies';

type Scope = { projectId: string | null; loadedProjectId: string | null; token: string | null; isAdmin: boolean };
export function useProjectCablePurposes(input: Scope) {
  const { projectId, loadedProjectId, token, isAdmin } = input;
  const scope = useMemo(() => ({ projectId, loadedProjectId, token, isAdmin }), [projectId, loadedProjectId, token, isAdmin]);
  const [state, setState] = useState<{ scope: Scope; values: string[]; invalidCount: number; error: string | null }>({ scope, values: [], invalidCount: 0, error: null });
  useEffect(() => {
    const abort = new AbortController();
    setState({ scope, values: [], invalidCount: 0, error: null });
    if (scope.isAdmin && scope.projectId && scope.projectId === scope.loadedProjectId && scope.token) {
      void fetchRoutingPurposePolicy(scope.projectId, scope.token, abort.signal).then(policy => {
        if (!abort.signal.aborted) setState({ scope, values: policy.cablePurposes ?? [], invalidCount: policy.invalidCablePurposeCount ?? 0, error: null });
      }, () => {
        if (!abort.signal.aborted) setState({ scope, values: [], invalidCount: 0, error: 'Cable purposes could not be loaded. Refresh Path Finder to try again.' });
      });
    }
    return () => abort.abort();
  }, [scope]);
  return state.scope === scope ? { cablePurposes: state.values, invalidCablePurposeCount: state.invalidCount, cablePurposesError: state.error } : { cablePurposes: [], invalidCablePurposeCount: 0, cablePurposesError: null };
}
