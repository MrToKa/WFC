import { useState, useEffect } from 'react';
import { MaterialSupport, fetchMaterialSupports } from '../../../api/client';

export const useMaterialSupports = () => {
  const [materialSupportsById, setMaterialSupportsById] = useState<Record<string, MaterialSupport>>({});
  const [materialSupportsLoading, setMaterialSupportsLoading] = useState<boolean>(false);
  const [materialSupportsError, setMaterialSupportsError] = useState<string | null>(null);
  const [materialSupportsLoaded, setMaterialSupportsLoaded] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;

    const loadSupports = async () => {
      setMaterialSupportsLoading(true);
      setMaterialSupportsError(null);

      try {
        const loaded: MaterialSupport[] = [];
        let page = 1;
        const PAGE_SIZE = 100;

        while (true) {
          const { supports: pageSupports, pagination } = await fetchMaterialSupports({
            page,
            pageSize: PAGE_SIZE
          });

          loaded.push(...pageSupports);

          if (!pagination || pagination.totalPages === 0 || page >= pagination.totalPages) {
            break;
          }

          page += 1;
        }

        if (!cancelled) {
          setMaterialSupportsById((previous) => {
            const next = { ...previous };
            loaded.forEach((support) => {
              next[support.id] = support;
            });
            return next;
          });
          setMaterialSupportsLoaded(true);
        }
      } catch (error) {
        console.error('Failed to load supports', error);
        if (!cancelled) {
          setMaterialSupportsError('Failed to load support details.');
          setMaterialSupportsLoaded(true);
        }
      } finally {
        if (!cancelled) {
          setMaterialSupportsLoading(false);
        }
      }
    };

    void loadSupports();

    return () => {
      cancelled = true;
    };
  }, []);

  return {
    materialSupportsById,
    materialSupportsLoading,
    materialSupportsError,
    materialSupportsLoaded
  };
};
