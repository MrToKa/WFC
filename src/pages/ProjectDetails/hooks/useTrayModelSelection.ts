import { useCallback, useEffect, useRef, useState } from 'react';
import type { ViewerTrayRootSelection } from '../../../../viewer-runtime/protocol.mjs';
import type { usePathFinder } from './usePathFinder';

type SelectionSource = Pick<ReturnType<typeof usePathFinder>, 'busy' | 'viewerPhase'> & {
  readTrayRootSelection?: () => Promise<ViewerTrayRootSelection | null>;
  preparationAccess?: unknown;
  preparationViewerGeneration?: number;
};
type Options = { pf: SelectionSource; active: boolean; scopeKey: string; paused: boolean };
export type TrayModelSelectionStatus = 'loading' | 'ready' | 'paused' | 'unavailable' | 'error';
type Mode = 'read' | 'loading' | 'paused' | 'unavailable';
type Snapshot = { owner: string; mode: Mode; status: TrayModelSelectionStatus; objectIds: number[]; error: string | null };
type Run = { closed: boolean; timer?: ReturnType<typeof setTimeout>; pending?: Promise<void>; failures: number; read: () => Promise<void> };
const initial = (owner: string, mode: Mode): Snapshot => ({ owner, mode, status: mode === 'read' ? 'loading' : mode, objectIds: [], error: null });
const failureMessage = (error: unknown) => {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  return code === 'TRAY_ROOT_SELECTION_TOO_LARGE' ? 'Select no more than 512 model objects.'
    : code === 'TRAY_ROOT_SELECTION_CHANGED' ? 'The model selection changed while it was being read. Trying again.'
      : 'The current model selection could not be read. Select the intended tray and try again.';
};

/** Display-only snapshot. Assignment commands must independently read a fresh selection. */
export function useTrayModelSelection({ pf, active, scopeKey, paused }: Options) {
  const reader = pf.readTrayRootSelection;
  const owner = JSON.stringify([scopeKey, pf.preparationViewerGeneration, pf.preparationAccess]);
  const mode: Mode = !active || paused || pf.busy ? 'paused' : pf.viewerPhase === 'loading' ? 'loading'
    : pf.viewerPhase !== 'ready' || typeof reader !== 'function' ? 'unavailable' : 'read';
  const [snapshot, setSnapshot] = useState<Snapshot>(() => initial(owner, mode));
  const runRef = useRef<Run | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);

  useEffect(() => {
    setSnapshot(initial(owner, mode));
    if (mode !== 'read' || !reader) { runRef.current = null; return; }
    const run: Run = { closed: false, failures: 0, read: async () => {} };
    runRef.current = run;
    const current = () => !run.closed && runRef.current === run;
    const update = (status: TrayModelSelectionStatus, objectIds: number[], error: string | null) => {
      if (!current()) return;
      setSnapshot(previous => previous.owner === owner && previous.mode === mode && previous.status === status
        && previous.error === error && previous.objectIds.length === objectIds.length
        && previous.objectIds.every((id, index) => id === objectIds[index]) ? previous : { owner, mode, status, objectIds, error });
    };
    run.read = async () => {
      if (!current()) return;
      clearTimeout(run.timer);
      if (run.pending) return run.pending;
      // A scope change cannot overlap the previous protected selection read.
      if (inFlight.current) { await inFlight.current; if (current()) await run.read(); return; }
      const pending = Promise.resolve().then(async () => {
        if (!current()) return;
        try {
          const value = await reader();
          if (!current()) return;
          if (value === null) {
            run.failures++;
            update('unavailable', [], 'Current selection is temporarily unavailable. Trying again.');
          } else {
            run.failures = 0;
            update('ready', value.objects.map(object => object.objectId), null);
          }
        } catch (error) {
          if (!current()) return;
          run.failures++;
          update('error', [], failureMessage(error));
        }
      }).finally(() => {
        if (inFlight.current === pending) inFlight.current = null;
        if (run.pending === pending) run.pending = undefined;
        if (current()) run.timer = setTimeout(() => void run.read(), Math.min(16000, 2000 * 2 ** Math.min(run.failures, 3)));
      });
      run.pending = pending;
      inFlight.current = pending;
      await pending;
    };
    void run.read();
    return () => { run.closed = true; clearTimeout(run.timer); if (runRef.current === run) runRef.current = null; };
  }, [owner, mode, reader]);

  const refresh = useCallback(async () => { await runRef.current?.read(); }, []);
  const view = snapshot.owner === owner && snapshot.mode === mode ? snapshot : initial(owner, mode);
  return { status: view.status, objectIds: view.objectIds, error: view.error, refresh };
}
