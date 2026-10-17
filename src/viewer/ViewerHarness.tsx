import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { ViewerController, type ViewerEvent } from './ViewerController';
import { viewerRequest, type ModelSelection } from './sessionApi';

/** Explicit build-time diagnostic harness; no project mutation or final Viewer UI. */
export function ViewerHarness() {
  const { projectId } = useParams();
  const { token } = useAuth();
  const container = useRef<HTMLDivElement>(null);
  const controller = useRef<ViewerController | null>(null);
  const [mounted, setMounted] = useState(false);
  const [event, setEvent] = useState<ViewerEvent>({ type: 'IDLE', payload: {} });
  const [routing, setRouting] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!mounted || !container.current || !projectId || !token) return;
    let live = true;
    const active = new ViewerController({ container: container.current, projectId, token, onEvent: (next) => {
      if (!live) return;
      setEvent(next);
      if (next.type === 'MODEL_LOADED') setLoaded(true);
      if (next.type === 'ERROR') setLoaded(false);
      if (next.type === 'RUNTIME_READY') {
        void viewerRequest<{ selection: ModelSelection }>(`/api/projects/${projectId}/model-versions`, token)
          .then(({ selection }) => {
            if (!live) return;
            if (!selection.activeModelVersionId) throw new Error('No model is selected for this project.');
            return active.load(selection.activeModelVersionId);
          }).catch(() => {
            if (!live) return;
            setEvent({ type: 'ERROR', payload: { code: 'NO_ACTIVE_MODEL', message: 'No active model is available.' } });
            active.dispose('reload');
          });
      }
    } });
    controller.current = active;
    return () => { live = false; controller.current = null; active.dispose(); };
  }, [mounted, projectId, token]);

  const unmount = () => { setMounted(false); setLoaded(false); setEvent({ type: 'DISPOSED', payload: {} }); };
  return <main style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, minHeight: 600 }}>
    <h2>3D viewer — test preview</h2>
    <p>Preview of the active project model. Access follows your project permissions.</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <button disabled={mounted} onClick={() => { setEvent({ type: 'STARTING', payload: {} }); setMounted(true); }}>Load active model</button>
      <button disabled={!mounted} onClick={unmount}>Close viewer</button>
      <input aria-label="Test route" value={routing} onChange={(e) => setRouting(e.target.value)} style={{ flex: 1, minWidth: 240 }} />
      <button disabled={!loaded} onClick={() => void controller.current?.showRoute(routing).catch(() => setEvent({ type: 'ERROR', payload: { code: 'ROUTE_INVALID' } }))}>Show</button>
      <button disabled={!loaded} onClick={() => controller.current?.clear()}>Clear</button>
      <button disabled={!loaded} onClick={() => { try { controller.current?.zoom(); } catch { setEvent({ type: 'ERROR', payload: { code: 'NO_DRAWABLE_ROUTE' } }); } }}>Zoom</button>
    </div>
    <output data-testid="viewer-event" data-event-type={event.type} aria-live="polite">{JSON.stringify(event)}</output>
    <div ref={container} data-testid="viewer-host" style={{ height: '70vh', minHeight: 450, width: '100%' }} />
  </main>;
}
