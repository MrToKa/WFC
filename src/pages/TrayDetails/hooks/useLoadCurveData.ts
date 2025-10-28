import { useState, useEffect, useMemo } from 'react';
import { MaterialLoadCurve, fetchMaterialLoadCurve } from '../../../api/client';

export const useLoadCurveData = (selectedLoadCurveId: string | null) => {
  const [loadCurvesById, setLoadCurvesById] = useState<Record<string, MaterialLoadCurve>>({});
  const [loadCurveLoadingId, setLoadCurveLoadingId] = useState<string | null>(null);
  const [loadCurveError, setLoadCurveError] = useState<string | null>(null);

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
        const response = await fetchMaterialLoadCurve(selectedLoadCurveId);
        if (!cancelled) {
          setLoadCurvesById((previous) => ({
            ...previous,
            [selectedLoadCurveId]: response.loadCurve
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
  }, [selectedLoadCurveId, loadCurvesById]);

  const selectedLoadCurve = useMemo(() =>
    selectedLoadCurveId && loadCurvesById[selectedLoadCurveId]
      ? loadCurvesById[selectedLoadCurveId]
      : null,
    [selectedLoadCurveId, loadCurvesById]
  );

  return {
    selectedLoadCurve,
    loadCurveLoadingId,
    loadCurveError
  };
};
