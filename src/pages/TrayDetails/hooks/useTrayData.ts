import { useState, useEffect } from 'react';
import { Project, Tray, Cable, fetchProject, fetchTray, fetchTrays, fetchCables } from '../../../api/client';
import { ApiError } from '../../../api/client';
import { filterCablesByTray, sortTrays } from '../TrayDetails.utils';

export const useTrayData = (projectId: string | undefined, trayId: string | undefined) => {
  const [project, setProject] = useState<Project | null>(null);
  const [tray, setTray] = useState<Tray | null>(null);
  const [trays, setTrays] = useState<Tray[]>([]);
  const [trayCables, setTrayCables] = useState<Cable[]>([]);
  const [cablesError, setCablesError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!projectId || !trayId) {
        setError('Tray not found.');
        setTrayCables([]);
        setTrays([]);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);
      setTrayCables([]);
      setCablesError(null);

      try {
        const [projectResponse, trayResponse] = await Promise.all([
          fetchProject(projectId),
          fetchTray(projectId, trayId)
        ]);

        setProject(projectResponse.project);
        setTray(trayResponse.tray);

        try {
          const cablesResponse = await fetchCables(projectId);
          setTrayCables(
            filterCablesByTray(cablesResponse.cables, trayResponse.tray.name)
          );
        } catch (cableError) {
          console.error('Failed to load tray cables', cableError);
          setCablesError('Failed to load cables for this tray.');
        }
      } catch (err) {
        console.error('Failed to load tray details', err);
        if (err instanceof ApiError && err.status === 404) {
          setError('Tray not found.');
        } else {
          setError('Failed to load tray details.');
        }
        setTrayCables([]);
        setTrays([]);
        setIsLoading(false);
        return;
      }

      try {
        const traysResponse = await fetchTrays(projectId);
        setTrays(sortTrays(traysResponse.trays));
      } catch (err) {
        console.error('Failed to load trays for navigation', err);
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, [projectId, trayId]);

  return {
    project,
    tray,
    trays,
    trayCables,
    cablesError,
    isLoading,
    error,
    setTray,
    setTrays,
    setTrayCables
  };
};
