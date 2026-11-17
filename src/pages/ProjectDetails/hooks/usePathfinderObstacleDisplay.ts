import { useCallback, useEffect, useRef, useState } from 'react';
import type { usePathFinder } from './usePathFinder';
import type { PathfinderObstacleRequest } from '../pathFinderObstacleNavigation';

type Input = {
  request?: PathfinderObstacleRequest | null; enabled: boolean; accessKey: string;
  pf: Pick<ReturnType<typeof usePathFinder>, 'data' | 'viewerPhase' | 'preparationViewerGeneration' | 'busy' | 'showTray' | 'hideTray'>;
  claimViewer: () => () => boolean;
};
type DisplayState = { key: string; message: string; error: string | null; working: boolean; shown: boolean };
type Session = { key: string; closed: boolean; started: boolean; dismissed: boolean; owner: (() => boolean) | null; request: PathfinderObstacleRequest; hide: Input['pf']['hideTray'] };

/** Display-only navigation. A recorded dbId never targets another model revision. */
export function usePathfinderObstacleDisplay(input: Input) {
  const model = input.pf.data?.activeModel;
  const key = JSON.stringify([input.request, input.enabled, input.accessKey, model, input.pf.preparationViewerGeneration]);
  const latest = useRef(input); latest.current = input;
  const latestKey = useRef(key); latestKey.current = key;
  const session = useRef<Session | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const [state, setState] = useState<DisplayState | null>(null);
  useEffect(() => {
    const request = latest.current.request;
    if (!request || !latest.current.enabled) { session.current = null; setState(null); return; }
    const run: Session = { key, request, closed: false, started: false, dismissed: false, owner: null, hide: latest.current.pf.hideTray };
    session.current = run;
    setState({ key, message: `Waiting to show obstacle #${request.dbId} in the model…`, error: null, working: false, shown: false });
    return () => {
      run.closed = true;
      if (run.owner?.()) void run.hide(run.request).catch(() => false);
    };
  }, [key]);
  useEffect(() => {
    const run = session.current, value = latest.current;
    if (!run || run.key !== key || run.closed || run.started || value.pf.viewerPhase !== 'ready' || value.pf.busy) return;
    const currentModel = value.pf.data?.activeModel, expected = run.request;
    run.started = true;
    if (!currentModel || currentModel.modelVersionId !== expected.modelVersionId || currentModel.contentFingerprint !== expected.contentFingerprint
      || currentModel.selectionRevision !== expected.selectionRevision) {
      setState({ key, message: '', error: `Obstacle #${expected.dbId} belongs to a different model revision. The active model was not changed.`, working: false, shown: false });
      return;
    }
    run.owner = value.claimViewer();
    setState({ key, message: `Showing obstacle #${expected.dbId}…`, error: null, working: true, shown: false });
    const owns = () => latestKey.current === run.key && !run.closed && !run.dismissed && run.owner?.() === true;
    queue.current = queue.current.catch(() => {}).then(async () => {
      if (!owns()) return;
      let shown = false;
      try { shown = await value.pf.showTray(expected, [expected.dbId]); }
      catch { /* The display error below preserves a retryable Hide action. */ }
      if (!owns()) {
        if (run.owner?.()) await run.hide(expected).catch(() => false);
        return;
      }
      setState({ key: run.key, message: shown ? `Obstacle #${expected.dbId} shown in the model.` : '',
        error: shown ? null : `Obstacle #${expected.dbId} could not be shown. Check that its model is loaded.`, working: false, shown: true });
    });
  }, [key, input.pf.viewerPhase, input.pf.busy]);
  const hide = useCallback(async () => {
    const run = session.current;
    if (!run || run.closed || run.key !== latestKey.current || !run.owner?.()) return;
    run.dismissed = true;
    setState(previous => previous?.key === run.key ? { ...previous, working: true, error: null } : previous);
    await queue.current.catch(() => {});
    const restored = run.owner() ? await run.hide(run.request).catch(() => false) : true;
    if (run.closed || run.key !== latestKey.current) return;
    setState({ key: run.key, message: restored ? `Obstacle #${run.request.dbId} hidden. Normal model view restored.` : '',
      error: restored ? null : 'The normal model view could not be restored. Try Hide again.', working: false, shown: !restored });
  }, []);
  const visible = state?.key === key && (!session.current?.owner || session.current.owner()) ? state : null;
  return { message: visible?.message ?? null, error: visible?.error ?? null, working: visible?.working ?? false,
    shown: visible?.shown ?? false, hide };
}
