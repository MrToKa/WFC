import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { Project, Tray, Cable } from '../../../api/client';
import { fetchTrays } from '../../../api/client';
import { fetchTrayDrawingSnapshot, type TrayDrawingResponse } from '@/api/trayDrawing';
import { sortTrays } from '../TrayDetails.utils';

type State = { identity: string; response: TrayDrawingResponse | null; isLoading: boolean; error: string | null };
export const useTrayData = (projectId: string | undefined, trayId: string | undefined, token: string | null = null) => {
  const identity = JSON.stringify([projectId, trayId, token]);
  const latest = useRef(identity); latest.current = identity;
  const active = useRef<AbortController | null>(null);
  const [state, setState] = useState<State>({ identity, response: null, isLoading: true, error: null });
  const [trays, setTrays] = useState<Tray[]>([]);
  const applyDrawingSnapshot = useCallback((response: TrayDrawingResponse) => {
    if (response.snapshot.projectId !== projectId || response.snapshot.projectTrayId !== trayId || latest.current !== identity) return;
    setState({ identity, response, isLoading: false, error: null });
  }, [identity, projectId, trayId]);
  const refreshDrawing = useCallback(async () => {
    active.current?.abort(); const abort = new AbortController(); active.current = abort;
    setState({ identity, response: null, isLoading: true, error: null });
    if (!projectId || !trayId || !token) { setState({ identity, response: null, isLoading: false, error: 'Sign in and select a tray to load its shared drawing.' }); return; }
    try {
      const response = await fetchTrayDrawingSnapshot(projectId, trayId, token, abort.signal);
      if (abort.signal.aborted || latest.current !== identity) return;
      applyDrawingSnapshot(response);
    } catch (error) {
      if (abort.signal.aborted || latest.current !== identity) return;
      setState({ identity, response: null, isLoading: false, error: error instanceof Error ? error.message : 'The shared tray drawing could not be loaded. Refresh to try again.' });
    }
  }, [identity, projectId, trayId, token, applyDrawingSnapshot]);
  useEffect(() => { void refreshDrawing(); return () => active.current?.abort(); }, [refreshDrawing]);
  useEffect(() => {
    let closed = false; setTrays([]);
    if (projectId && token) void fetchTrays(projectId).then(value => { if (!closed && latest.current === identity) setTrays(sortTrays(value.trays)); }).catch(() => {});
    return () => { closed = true; };
  }, [identity, projectId, token]);
  const view = state.identity === identity ? state : { identity, response: null, isLoading: true, error: null };
  const response = view.response;
  const project = useMemo(() => response ? { ...response.data.project, canEdit: response.permissions.canEdit } as unknown as Project : null, [response]);
  // Existing tray mutation hooks request a refresh; they cannot replace frozen drawing inputs piecemeal.
  const setTray: Dispatch<SetStateAction<Tray | null>> = useCallback(() => { void refreshDrawing(); }, [refreshDrawing]);
  const setTrayCables: Dispatch<SetStateAction<Cable[]>> = useCallback(() => { void refreshDrawing(); }, [refreshDrawing]);
  return {
    project,
    tray: response?.data.tray as unknown as Tray | null ?? null,
    trays, trayCables: response?.data.trayCables as unknown as Cable[] ?? [], projectCables: response?.data.cables as unknown as Cable[] ?? [],
    cablesError: null, isLoading: view.isLoading, error: view.error, setTray, setTrays, setTrayCables,
    drawingResponse: response, refreshDrawing, applyDrawingSnapshot,
  };
};
