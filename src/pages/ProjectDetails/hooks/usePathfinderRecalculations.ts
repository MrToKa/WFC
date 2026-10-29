import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchRecalculationContext, sendRecalculationCommand, RecalculationsApiError, type RecalculationContext, type RecalculationCommand } from '@/api/pathfinderRecalculations';
import { z } from 'zod';
import { recalculationCommandSchema } from '../../../../shared/pathfinderRecalculation';
import { parsePurposeJson, policyUuidSchema } from '../../../../shared/pathfinderPurposePolicy';

const STORAGE_KEY = 'wfc.pathfinder.recalculation.pending.v1';
const MAX_INTENT_BYTES = 65536, MAX_INTENT_AGE = 24 * 60 * 60 * 1000;
export const RECALCULATION_BUSY_RECOVERY = Object.freeze({ deadlineMilliseconds: 30000, delaysMilliseconds: [500, 1500] as const });
const recoverableBusy = (error: unknown) => error instanceof RecalculationsApiError && error.status === 503 && error.outcome === 'unknown'
  && ['PREFLIGHT_DATABASE_BUSY', 'RECALCULATION_DATABASE_BUSY'].includes(error.code);
function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  let abort!: () => void;
  const stopped = new Promise<never>((_resolve, reject) => { abort = () => reject(signal.reason); signal.addEventListener('abort', abort, { once: true }); });
  return Promise.race([pending, stopped]).finally(() => signal.removeEventListener('abort', abort));
}
function recoveryDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, milliseconds);
    signal.addEventListener('abort', abort, { once: true });
  });
}
const storedIntentSchema = z.object({ version: z.literal(1), projectId: policyUuidSchema, accountId: policyUuidSchema,
  tokenEpoch: z.string().regex(/^[a-f0-9]{64}(?![\s\S])/), savedAt: z.number().int().nonnegative(), command: recalculationCommandSchema }).strict();
const removeIntent = () => { try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* Recovery remains in memory when browser storage is unavailable. */ } };
async function tokenEpoch(token: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))].map(v => v.toString(16).padStart(2, '0')).join('');
}
function freezeCommand(body: RecalculationCommand): RecalculationCommand {
  const copy = structuredClone(body);
  if ('preferences' in copy) Object.freeze(copy.preferences);
  if ('automaticPairPolicy' in copy) Object.freeze(copy.automaticPairPolicy);
  return Object.freeze(copy);
}

export type RecalculationAccess = {
  projectId: string | null; loadedProjectId: string | null; token: string | null; isAdmin: boolean; accountId?: string | null;
  active: boolean; contextKey: string; onChanged?: () => void; onAuthorityLost?: () => void;
};
type State = { identity: string; context: RecalculationContext | null; busy: boolean; error: string | null; conflict: boolean };
export function usePathfinderRecalculations(access: RecalculationAccess) {
  const account = JSON.stringify([access.projectId, access.loadedProjectId, access.token, access.isAdmin, access.accountId]);
  const identity = JSON.stringify([account, access.contextKey, access.active]);
  const enabled = Boolean(access.isAdmin && access.token && access.projectId && access.projectId === access.loadedProjectId);
  const [state, setState] = useState<State>({ identity, context: null, busy: false, error: null, conflict: false });
  const [pendingVersion, bumpPending] = useState(0);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const priorAccount = useRef(account);
  const pending = useRef<{ account: string; body: RecalculationCommand } | null>(null);
  const latest = useRef(identity); latest.current = identity;
  const latestAccount = useRef(account); latestAccount.current = account;
  const callbacks = useRef(access); callbacks.current = access;
  const operation = useRef<AbortController | null>(null), busy = useRef(false), previous = useRef<string | null>(null);
  const executionOwner = useRef<object | null>(null);
  const deniedAccount = useRef<string | null>(null);
  const mountedGeneration = useRef(0);
  const current = state.identity === identity ? state : { identity, context: null, busy: false, error: null, conflict: false };
  const authorityFailure = useCallback((error: unknown) => {
    if (!(error instanceof RecalculationsApiError) || ![401, 403].includes(error.status ?? 0)) return false;
    deniedAccount.current = account;
    removeIntent();
    pending.current = null; bumpPending(v => v + 1); previous.current = null;
    setState({ identity: latest.current, context: null, busy: false, error: 'Administrator access is required. Refresh your account before continuing.', conflict: false });
    callbacks.current.onAuthorityLost?.(); return true;
  }, [account]);
  const refresh = useCallback(async () => {
    if (!enabled || !access.active || busy.current || deniedAccount.current === account) return;
    const started = identity, abort = new AbortController(); operation.current?.abort(); operation.current = abort;
    try {
      const context = await fetchRecalculationContext(access.projectId!, access.token!, abort.signal);
      if (latest.current !== started || abort.signal.aborted) return;
      // Restore only after a fresh, authorized project GET. Model/tool/options changes
      // never retarget the command; another account, project or token discards it.
      if (access.accountId && !pending.current) {
        try {
          const raw = sessionStorage.getItem(STORAGE_KEY);
          if (raw) {
            if (new TextEncoder().encode(raw).byteLength > MAX_INTENT_BYTES) throw new Error('Intent exceeds limit');
            const saved = storedIntentSchema.parse(parsePurposeJson(raw, { maximumBytes: MAX_INTENT_BYTES }));
            const epoch = await tokenEpoch(access.token!);
            if (latest.current !== started || abort.signal.aborted) return;
            if (saved.projectId !== access.projectId || saved.accountId !== access.accountId || saved.tokenEpoch !== epoch || saved.savedAt > Date.now() || Date.now() - saved.savedAt > MAX_INTENT_AGE) removeIntent();
            else { pending.current = { account, body: freezeCommand(saved.command) }; bumpPending(v => v + 1); }
          }
        } catch { if (latest.current === started && !abort.signal.aborted) { removeIntent(); setStorageWarning('Saved command recovery is unavailable. Current server status has been refreshed.'); } }
      }
      const key = JSON.stringify([context.controlRevision, context.desiredGeneration, context.enrolledGeneration, context.status, context.jobId, context.completed, context.total, context.readyCables, context.blockedCables, context.reasonCodes, context.automaticPairPolicy, context.progress]);
      const changed = previous.current !== null && previous.current !== key; previous.current = key;
      setState(s => ({ ...s, identity: started, context, error: pending.current?.account === account ? s.error : null }));
      if (changed) callbacks.current.onChanged?.();
    } catch (error) {
      if (latest.current !== started || abort.signal.aborted) return;
      if (!authorityFailure(error)) setState(s => ({ ...s, identity: started,
        context: pending.current?.account === account ? s.context : null,
        error: pending.current?.account === account && s.error ? s.error : error instanceof Error ? error.message : 'Recalculation status could not be read.' }));
    }
  }, [enabled, access.active, access.projectId, access.token, access.accountId, identity, account, authorityFailure]);
  useEffect(() => {
    mountedGeneration.current++;
    executionOwner.current = null; operation.current?.abort(); busy.current = false; previous.current = null;
    if (priorAccount.current !== account || !enabled || !access.accountId) { removeIntent(); setStorageWarning(null); }
    priorAccount.current = account;
    if (pending.current?.account !== account) { pending.current = null; bumpPending(v => v + 1); }
    setState(s => ({ identity, context: null, busy: false, error: pending.current?.account === account ? s.error : null, conflict: false }));
    void refresh();
    const timer = enabled && access.active ? setInterval(() => void refresh(), 10000) : null;
    return () => { mountedGeneration.current++; executionOwner.current = null; operation.current?.abort(); if (timer !== null) clearInterval(timer); };
  }, [identity, account, enabled, access.active, refresh]);
  const execute = useCallback(async (body: RecalculationCommand) => {
    if (!enabled || !access.active || busy.current || deniedAccount.current === account) return;
    const started = identity, generation = mountedGeneration.current, abort = new AbortController(); operation.current?.abort(); operation.current = abort; busy.current = true;
    const owner = {}; executionOwner.current = owner;
    let recoveryExpired = false;
    const recoveryTimer = setTimeout(() => { recoveryExpired = true; abort.abort(new Error('The saved command could not be confirmed within 30 seconds. Retry the same saved command.')); }, RECALCULATION_BUSY_RECOVERY.deadlineMilliseconds);
    setState(s => ({ ...s, busy: true, error: null, conflict: false }));
    try {
      for (let attempt = 0; ; attempt++) {
        try { await abortable(sendRecalculationCommand(access.projectId!, access.token!, body, abort.signal), abort.signal); break; }
        catch (error) {
          if (!recoverableBusy(error) || attempt >= RECALCULATION_BUSY_RECOVERY.delaysMilliseconds.length || abort.signal.aborted
            || latest.current !== started || mountedGeneration.current !== generation) throw error;
          setState(s => ({ ...s, error: 'The service is busy. Retrying the same saved command; no replacement is submitted.' }));
          await recoveryDelay(RECALCULATION_BUSY_RECOVERY.delaysMilliseconds[attempt], abort.signal);
        }
      }
      clearTimeout(recoveryTimer);
      if (mountedGeneration.current !== generation || executionOwner.current !== owner) return;
      // A receipt confirms the command, even when refreshing current status later fails.
      if (pending.current?.body === body) { pending.current = null; removeIntent(); bumpPending(v => v + 1); }
      if (latest.current !== started || abort.signal.aborted) return;
      busy.current = false; setState(s => ({ ...s, busy: false }));
      previous.current = null; callbacks.current.onChanged?.(); await refresh();
    } catch (error) {
      if (latest.current !== started || executionOwner.current !== owner || abort.signal.aborted && !recoveryExpired) return;
      if (authorityFailure(error)) return;
      const refused = error instanceof RecalculationsApiError && error.outcome === 'refused';
      if (refused) { pending.current = null; removeIntent(); bumpPending(v => v + 1); }
      setState(s => ({ ...s, error: recoveryExpired ? 'The saved command could not be confirmed within 30 seconds. Retry the same saved command.'
        : error instanceof Error ? error.message : 'The command outcome is unknown. Retry the same command.', conflict: refused && !(error instanceof RecalculationsApiError && error.code === 'AUTOMATIC_OUTPUT_ENABLE_REQUIRED') }));
      if (refused && error instanceof RecalculationsApiError && error.code === 'AUTOMATIC_OUTPUT_ENABLE_REQUIRED') {
        busy.current = false; setState(s => ({ ...s, busy: false })); await refresh();
        if (latest.current === started && executionOwner.current === owner) setState(s => ({ ...s, error: error.message }));
      }
    } finally { clearTimeout(recoveryTimer); if (latest.current === started && mountedGeneration.current === generation && executionOwner.current === owner) {
      executionOwner.current = null; busy.current = false; setState(s => ({ ...s, busy: false }));
    } }
  }, [enabled, access.active, access.projectId, access.token, identity, account, authorityFailure, refresh]);
  const persistAndExecute = useCallback(async (body: RecalculationCommand) => {
    const started = identity, generation = mountedGeneration.current;
    if (access.accountId) {
      try {
        const epoch = await tokenEpoch(access.token!);
        if (mountedGeneration.current !== generation || latestAccount.current !== account || pending.current?.body !== body) return;
        const raw = JSON.stringify(storedIntentSchema.parse({ version: 1, projectId: access.projectId, accountId: access.accountId, tokenEpoch: epoch, savedAt: Date.now(), command: body }));
        if (new TextEncoder().encode(raw).byteLength > MAX_INTENT_BYTES) throw new Error('Intent exceeds limit');
        sessionStorage.setItem(STORAGE_KEY, raw);
      } catch { if (mountedGeneration.current === generation && latest.current === started) setStorageWarning('Browser recovery storage is unavailable. Keep this page open to retry the same command if its outcome is unknown.'); }
    }
    if (mountedGeneration.current === generation && latest.current === started && pending.current?.body === body) await execute(body);
  }, [access.accountId, access.token, access.projectId, account, identity, execute]);
  const command = useCallback((body: RecalculationCommand) => {
    if (!enabled || !access.active || deniedAccount.current === account || pending.current || busy.current || !current.context || current.conflict || body.expectedControlRevision !== current.context.controlRevision) return;
    const parsed = recalculationCommandSchema.safeParse(body); if (!parsed.success) return;
    const frozen = freezeCommand(parsed.data);
    pending.current = { account, body: frozen }; bumpPending(v => v + 1);
    void persistAndExecute(frozen);
  }, [enabled, access.active, current.context, current.conflict, account, persistAndExecute]);
  const retained = pending.current?.account === account ? pending.current.body : null;
  void pendingVersion;
  return { ...current, error: current.error ?? storageWarning, enabled, pending: retained, unknown: Boolean(retained && !current.busy), command,
    retry: () => { if (retained && current.context && access.active && !busy.current) void persistAndExecute(retained); }, refresh,
    discardConflict: () => { if (!pending.current && !busy.current) { setState(s => ({ ...s, conflict: false })); void refresh(); } },
  };
}
