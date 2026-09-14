import { useState, useEffect, useMemo } from 'react';
import {
  MaterialLoadCurve,
  fetchMaterialLoadCurve,
  fetchProjectTrayData,
} from '../../../api/client';

export const useLoadCurveData = (
  selectedLoadCurveId: string | null,
  projectId: string | undefined,
  isAdmin: boolean,
) => {
  const [loadCurvesById, setLoadCurvesById] = useState<Record<string, MaterialLoadCurve>>({});
  const [loadCurveLoadingId, setLoadCurveLoadingId] = useState<string | null>(null);
  const [loadCurveError, setLoadCurveError] = useState<string | null>(null);

  useEffect(() => {
    setLoadCurvesById({});
  }, [projectId, isAdmin]);

  useEffect(() => {
    if (!selectedLoadCurveId) {
      setLoadCurveLoadingId(null);
      setLoadCurveError(null);
      return;
    }

    if (loadCurvesById[selectedLoadCurveId]) {
      setLoadCurveLoadingId(null);
      return;
    }

    let cancelled = false;
    setLoadCurveLoadingId(selectedLoadCurveId);
    setLoadCurveError(null);

    const load = async () => {
      try {
        const response = isAdmin
          ? await fetchMaterialLoadCurve(selectedLoadCurveId)
          : {
              loadCurve: projectId
                ? (await fetchProjectTrayData(projectId)).loadCurves.find(
                    (curve) => curve.id === selectedLoadCurveId,
                  )
                : undefined,
            };
        if (!response.loadCurve) throw new Error('Load curve not available in this project');
        const loadCurve = response.loadCurve;
        if (!cancelled) {
          setLoadCurvesById((previous) => ({
            ...previous,
            [selectedLoadCurveId]: loadCurve,
          }));
        }
      } catch (err) {
        console.error('Failed to load material load curve', err);
        if (!cancelled) {
          setLoadCurveError('Failed to load tray load curve.');
        }
      } finally {
        if (!cancelled) {
          setLoadCurveLoadingId(null);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [selectedLoadCurveId, loadCurvesById, projectId, isAdmin]);

  const selectedLoadCurve = useMemo(
    () =>
      selectedLoadCurveId && loadCurvesById[selectedLoadCurveId]
        ? loadCurvesById[selectedLoadCurveId]
        : null,
    [selectedLoadCurveId, loadCurvesById],
  );

  return {
    selectedLoadCurve,
    loadCurveLoadingId,
    loadCurveError,
  };
};
