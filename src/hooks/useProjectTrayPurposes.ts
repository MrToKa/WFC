import { useCallback, useEffect, useRef, useState } from 'react';
import { projectTrayPurposesRequest, type ProjectTrayPurpose } from '@/api/projectTrayPurposes';

export function useProjectTrayPurposes(projectId: string | undefined, token: string | null, enabled = true) {
  const scope = JSON.stringify([projectId, token, enabled]);
  const current = useRef(scope); current.current = scope;
  const sequence = useRef(0);
  const [data, setData] = useState<{ scope: string; purposes: ProjectTrayPurpose[] }>({ scope, purposes: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    const ticket = ++sequence.current;
    if (!projectId || !token || !enabled) return;
    setLoading(true); setError(null);
    try {
      const purposes = await projectTrayPurposesRequest(projectId, token);
      if (current.current === scope && ticket === sequence.current) setData({ scope, purposes });
    } catch (error) {
      if (current.current === scope && ticket === sequence.current) setError(error instanceof Error ? error.message : 'Tray purposes could not be loaded.');
    } finally {
      if (current.current === scope && ticket === sequence.current) setLoading(false);
    }
  }, [projectId, token, enabled, scope]);
  useEffect(() => { setError(null); setLoading(false); void refresh(); return () => { sequence.current++; }; }, [refresh]);
  return { purposes: data.scope === scope ? data.purposes : [], loading, error, refresh };
}
