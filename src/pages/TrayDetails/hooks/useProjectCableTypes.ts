import { useState, useEffect } from 'react';
import { CableType, fetchCableTypes } from '../../../api/client';

export const useProjectCableTypes = (projectId: string | undefined) => {
  const [projectCableTypes, setProjectCableTypes] = useState<CableType[]>([]);
  const [projectCableTypesLoading, setProjectCableTypesLoading] = useState<boolean>(false);
  const [projectCableTypesError, setProjectCableTypesError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) {
      setProjectCableTypes([]);
      setProjectCableTypesError(null);
      setProjectCableTypesLoading(false);
      return;
    }

    let cancelled = false;

    const loadCableTypes = async () => {
      setProjectCableTypesLoading(true);
      setProjectCableTypesError(null);

      try {
        const response = await fetchCableTypes(projectId);
        const sorted = [...response.cableTypes].sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
        );

        if (!cancelled) {
          setProjectCableTypes(sorted);
        }
      } catch (err) {
        console.error('Failed to load project cable types', err);
        if (!cancelled) {
          setProjectCableTypes([]);
          setProjectCableTypesError('Failed to load project cable types.');
        }
      } finally {
        if (!cancelled) {
          setProjectCableTypesLoading(false);
        }
      }
    };

    void loadCableTypes();

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return {
    projectCableTypes,
    projectCableTypesLoading,
    projectCableTypesError
  };
};
