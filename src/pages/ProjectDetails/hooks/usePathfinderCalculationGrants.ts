import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { fetchCalculationGrantContext, sendCalculationGrantCommand, CalculationGrantsApiError, type CalculationGrantContext, type CalculationGrantCommand } from '@/api/pathfinderCalculationGrants';
import { calculationGrantCommandSchema } from '../../../../shared/pathfinderCalculationGrant';
import { parsePurposeJson, policyUuidSchema } from '../../../../shared/pathfinderPurposePolicy';

const STORAGE_KEY = 'wfc.pathfinder.calculation-grant.pending.v1';
const MAX_BYTES = 65536, MAX_AGE = 24 * 60 * 60 * 1000;
const storedSchema = z.object({ version: z.literal(1), projectId: policyUuidSchema, accountId: policyUuidSchema,
  tokenEpoch: z.string().regex(/^[a-f0-9]{64}(?![\s\S])/), savedAt: z.number().int().nonnegative(), command: calculationGrantCommandSchema }).strict();
const clearSaved = () => { try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* Pending recovery remains in memory. */ } };
async function tokenEpoch(token: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))].map(b => b.toString(16).padStart(2, '0')).join('');
}
function freezeCommand(command: CalculationGrantCommand): CalculationGrantCommand {
  const copy = structuredClone(command); if ('preferences' in copy) Object.freeze(copy.preferences); return Object.freeze(copy);
}
export type CalculationGrantAccess = {
  projectId: string | null; loadedProjectId: string | null; token: string | null; accountId: string | null; isAdmin: boolean;
  active: boolean; contextKey: string; onChanged?: () => void; onAuthorityLost?: () => void;
};
type State = { identity: string; context: CalculationGrantContext | null; busy: boolean; error: string | null; conflict: boolean };

/** Poll status only. Creating/revoking authority always requires an explicit user command. */
export function usePathfinderCalculationGrants(access: CalculationGrantAccess) {
  const account = JSON.stringify([access.projectId, access.loadedProjectId, access.accountId, access.token, access.isAdmin]);
  const identity = JSON.stringify([account, access.active, access.contextKey]);
  const enabled = Boolean(access.isAdmin && access.token && access.accountId && access.projectId && access.projectId === access.loadedProjectId);
  const [state, setState] = useState<State>({ identity, context: null, busy: false, error: null, conflict: false });
  const [version, bump] = useState(0), [warning, setWarning] = useState<string | null>(null);
  const latest = useRef(identity); latest.current = identity;
  const latestAccount = useRef(account); latestAccount.current = account;
  const previousAccount = useRef(account), pending = useRef<{ account: string; body: CalculationGrantCommand } | null>(null);
  const callbacks = useRef(access); callbacks.current = access;
  const controller = useRef<AbortController | null>(null), busy = useRef(false), denied = useRef<string | null>(null);
  const generation = useRef(0), previousContext = useRef<string | null>(null);
  const current = state.identity === identity ? state : { identity, context: null, busy: false, error: null, conflict: false };
  const authorityFailure = useCallback((error: unknown) => {
    if (!(error instanceof CalculationGrantsApiError) || ![401, 403].includes(error.status ?? 0)) return false;
    denied.current = account; clearSaved(); pending.current = null; bump(v => v + 1); previousContext.current = null;
    setState({ identity: latest.current, context: null, busy: false, conflict: false, error: 'Administrator access is required. Refresh your account before continuing.' });
    callbacks.current.onAuthorityLost?.(); return true;
  }, [account]);
  const refresh = useCallback(async () => {
    if (!enabled || !access.active || busy.current || denied.current === account) return;
    const started = identity, abort = new AbortController(); controller.current?.abort(); controller.current = abort;
    try {
      const context = await fetchCalculationGrantContext(access.projectId!, access.token!, abort.signal);
      if (latest.current !== started || abort.signal.aborted) return;
      if (!pending.current) {
        try {
          const raw = sessionStorage.getItem(STORAGE_KEY);
          if (raw) {
            if (new TextEncoder().encode(raw).byteLength > MAX_BYTES) throw new Error('Saved command exceeds limit');
            const saved = storedSchema.parse(parsePurposeJson(raw, { maximumBytes: MAX_BYTES })), epoch = await tokenEpoch(access.token!);
            if (latest.current !== started || abort.signal.aborted) return;
            if (saved.projectId !== access.projectId || saved.accountId !== access.accountId || saved.tokenEpoch !== epoch || saved.savedAt > Date.now() || Date.now() - saved.savedAt > MAX_AGE) clearSaved();
            else { pending.current = { account, body: freezeCommand(saved.command) }; bump(v => v + 1); }
          }
        } catch { if (latest.current === started && !abort.signal.aborted) { clearSaved(); setWarning('Saved command recovery is unavailable. Current server status has been refreshed.'); } }
      }
      const key = JSON.stringify(context), changed = previousContext.current !== null && previousContext.current !== key;
      previousContext.current = key; setState(s => ({ ...s, identity: started, context, error: null }));
      if (changed) callbacks.current.onChanged?.();
    } catch (error) {
      if (latest.current !== started || abort.signal.aborted) return;
      if (!authorityFailure(error)) setState(s => ({ ...s, identity: started, context: null, error: error instanceof Error ? error.message : 'Background calculation status could not be read.' }));
    }
  }, [enabled, access.active, access.projectId, access.token, access.accountId, identity, account, authorityFailure]);
  useEffect(() => {
    generation.current++; controller.current?.abort(); busy.current = false; previousContext.current = null;
    if (previousAccount.current !== account || !enabled) { clearSaved(); setWarning(null); }
    if (previousAccount.current !== account) denied.current = null;
    previousAccount.current = account;
    if (pending.current?.account !== account) { pending.current = null; bump(v => v + 1); }
    setState({ identity, context: null, busy: false, error: null, conflict: false }); void refresh();
    const timer = enabled && access.active ? setInterval(() => void refresh(), 10000) : null;
    return () => { generation.current++; controller.current?.abort(); if (timer !== null) clearInterval(timer); };
  }, [identity, account, enabled, access.active, refresh]);
  const execute = useCallback(async (body: CalculationGrantCommand) => {
    if (!enabled || !access.active || busy.current || denied.current === account) return;
    const started = identity, atGeneration = generation.current, abort = new AbortController(); controller.current?.abort(); controller.current = abort; busy.current = true;
    setState(s => ({ ...s, busy: true, error: null, conflict: false }));
    try {
      await sendCalculationGrantCommand(access.projectId!, access.token!, body, abort.signal);
      if (generation.current !== atGeneration) return;
      // A confirmed receipt is not made uncertain by a subsequent failed status GET.
      if (pending.current?.body === body) { pending.current = null; clearSaved(); bump(v => v + 1); }
      if (latest.current !== started || abort.signal.aborted) return;
      busy.current = false; setState(s => ({ ...s, busy: false })); previousContext.current = null;
      callbacks.current.onChanged?.(); await refresh();
    } catch (error) {
      if (latest.current !== started || abort.signal.aborted) return;
      if (authorityFailure(error)) return;
      const refused = error instanceof CalculationGrantsApiError && error.outcome === 'refused';
      if (refused) { pending.current = null; clearSaved(); bump(v => v + 1); }
      setState(s => ({ ...s, error: error instanceof Error ? error.message : 'The command outcome is unknown. Retry the same saved command.', conflict: refused }));
    } finally { if (latest.current === started && generation.current === atGeneration) { busy.current = false; setState(s => ({ ...s, busy: false })); } }
  }, [enabled, access.active, access.projectId, access.token, identity, account, authorityFailure, refresh]);
  const persistAndExecute = useCallback(async (body: CalculationGrantCommand) => {
    const started = identity, atGeneration = generation.current;
    try {
      const epoch = await tokenEpoch(access.token!);
      if (generation.current !== atGeneration || latestAccount.current !== account || pending.current?.body !== body) return;
      const raw = JSON.stringify(storedSchema.parse({ version: 1, projectId: access.projectId, accountId: access.accountId, tokenEpoch: epoch, savedAt: Date.now(), command: body }));
      if (new TextEncoder().encode(raw).byteLength > MAX_BYTES) throw new Error('Saved command exceeds limit');
      sessionStorage.setItem(STORAGE_KEY, raw);
      setWarning(null);
    } catch { if (generation.current === atGeneration && latest.current === started) setWarning('Browser recovery storage is unavailable. Keep this page open to reconcile an uncertain command.'); }
    if (generation.current === atGeneration && latest.current === started && pending.current?.body === body) await execute(body);
  }, [access.token, access.projectId, access.accountId, account, identity, execute]);
  const command = useCallback((body: CalculationGrantCommand) => {
    if (!enabled || !access.active || denied.current === account || pending.current || busy.current || !current.context || current.conflict || body.expectedControlRevision !== current.context.controlRevision) return;
    const parsed = calculationGrantCommandSchema.safeParse(body); if (!parsed.success) return;
    const frozen = freezeCommand(parsed.data); pending.current = { account, body: frozen }; bump(v => v + 1); void persistAndExecute(frozen);
  }, [enabled, access.active, current.context, current.conflict, account, persistAndExecute]);
  const retained = pending.current?.account === account ? pending.current.body : null;
  void version;
  return { ...current, enabled, error: current.error ?? warning, pending: retained, unknown: Boolean(retained && !current.busy), command, refresh,
    retry: () => { if (retained && current.context && access.active && !busy.current) void persistAndExecute(retained); },
    discardConflict: () => { if (!pending.current && !busy.current) { setState(s => ({ ...s, conflict: false })); void refresh(); } },
  };
}
