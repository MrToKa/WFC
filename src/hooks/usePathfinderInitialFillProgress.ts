import { useCallback, useEffect, useRef, useState } from 'react';
import { canonicalPurposeJson, policyUuidSchema } from '../../shared/pathfinderPurposePolicy';
import { INITIAL_FILL_PROGRESS_LIMITS } from '../../shared/pathfinderInitialFillProgress';
import { fetchInitialFillProgress, InitialFillProgressApiError, type InitialFillProgress } from '@/api/pathfinderInitialFillProgress';
export type InitialFillProgressAccess = { projectId: string | null; loadedProjectId: string | null; accountId: string | null; token: string | null;
  isAdmin: boolean; active: boolean; impactId: string | null; cableId?: string | null; onChanged?: (progress: InitialFillProgress) => void; onAuthorityLost?: () => void };
type State = { identity: string; progress: InitialFillProgress | null; loading: boolean; error: string | null };
const initial = (identity: string): State => ({ identity, progress: null, loading: false, error: null });
/** One exact-impact GET at a time. No automatic mutation or authority renewal. */
export function usePathfinderInitialFillProgress(access: InitialFillProgressAccess) {
  const identity = JSON.stringify([access.projectId, access.loadedProjectId, access.accountId, access.token, access.isAdmin, access.impactId, access.cableId ?? null]);
  const allowed = Boolean(access.isAdmin && access.token && access.projectId === access.loadedProjectId && [access.projectId, access.accountId, access.impactId].every(value => policyUuidSchema.safeParse(value).success)
    && (access.cableId === undefined || access.cableId === null || policyUuidSchema.safeParse(access.cableId).success));
  const [state, setState] = useState<State>(() => initial(identity)), [hidden, setHidden] = useState(() => document.visibilityState === 'hidden');
  const latest = useRef({ identity, allowed, active: access.active, hidden }); latest.current = { identity, allowed, active: access.active, hidden };
  const callbacks = useRef(access); callbacks.current = access;
  const mounted = useRef(false), denied = useRef<string | null>(null), last = useRef<{ identity: string; value: InitialFillProgress | null; changeKey: string | null }>({ identity, value: null, changeKey: null });
  const request = useRef<{ identity: string; abort: AbortController; promise: Promise<void> } | null>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readAgain = useRef<() => Promise<void>>(async () => {});
  const clearTimer = useCallback(() => { if (timer.current !== null) clearTimeout(timer.current); timer.current = null; }, []);
  const canRead = useCallback(() => mounted.current && latest.current.identity === identity && latest.current.allowed && latest.current.active
    && !latest.current.hidden && document.visibilityState !== 'hidden' && denied.current !== identity, [identity]);
  const refresh = useCallback((): Promise<void> => {
    if (!canRead()) return Promise.resolve(); if (request.current?.identity === identity) return request.current.promise;
    clearTimer(); const ticket = { identity, abort: new AbortController(), promise: Promise.resolve() }; request.current = ticket;
    setState(previous => ({ ...(previous.identity === identity ? previous : initial(identity)), loading: true, error: null }));
    ticket.promise = (async () => {
      let succeeded = false;
      try {
        const value = await fetchInitialFillProgress(access.projectId!, access.token!, access.accountId!, access.impactId!, access.cableId, ticket.abort.signal);
        if (!canRead() || request.current !== ticket || ticket.abort.signal.aborted) return;
        const key = canonicalPurposeJson(value), oldKey = last.current.identity === identity ? last.current.changeKey : null;
        last.current = { identity, value, changeKey: key }; setState({ identity, progress: value, loading: false, error: null }); succeeded = true;
        if (oldKey !== null && oldKey !== key) { try { callbacks.current.onChanged?.(value); } catch { setState(previous => ({ ...previous, error: 'Progress was verified. Refresh the cable diagnostics to update their display.' })); } }
      } catch (error) {
        if (latest.current.identity !== identity || request.current !== ticket || ticket.abort.signal.aborted) return;
        const auth = error instanceof InitialFillProgressApiError && [401, 403].includes(error.status ?? 0);
        if (auth) { denied.current = identity; last.current = { identity, value: null, changeKey: null }; callbacks.current.onAuthorityLost?.(); }
        setState(previous => ({ ...previous, progress: null, loading: false, error: error instanceof InitialFillProgressApiError ? error.message : 'Initial-fill progress could not be read. Refresh to try again.' }));
      } finally {
        if (request.current === ticket) {
          request.current = null;
          if (latest.current.identity === identity) setState(previous => ({ ...previous, loading: false }));
          if (succeeded && canRead() && last.current.identity === identity && (last.current.value?.outstanding ?? 0) > 0)
            timer.current = setTimeout(() => { timer.current = null; void readAgain.current(); }, INITIAL_FILL_PROGRESS_LIMITS.pollMilliseconds);
        }
      }
    })(); return ticket.promise;
  }, [identity, canRead, clearTimer, access.projectId, access.token, access.accountId, access.impactId, access.cableId]);
  readAgain.current = refresh;
  useEffect(() => { const observe = () => setHidden(document.visibilityState === 'hidden'); document.addEventListener('visibilitychange', observe); return () => document.removeEventListener('visibilitychange', observe); }, []);
  useEffect(() => {
    mounted.current = true; clearTimer(); request.current?.abort.abort(); request.current = null;
    if (last.current.identity !== identity) { last.current = { identity, value: null, changeKey: null }; setState(initial(identity)); }
    if (access.active && !hidden) void refresh(); else setState(previous => previous.identity === identity ? { ...previous, loading: false } : initial(identity));
    return () => { mounted.current = false; clearTimer(); request.current?.abort.abort(); request.current = null; };
  }, [identity, access.active, hidden, clearTimer, refresh]);
  const current = state.identity === identity && allowed ? state : initial(identity);
  return { ...current, enabled: allowed && denied.current !== identity, paused: !access.active || hidden, refresh };
}
