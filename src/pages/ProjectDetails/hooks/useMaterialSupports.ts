import { useEffect, useState } from 'react';
import { ApiError, MaterialSupport, fetchMaterialSupports } from '@/api/client';

type ShowToast = (props: {
  intent: 'success' | 'error' | 'warning' | 'info';
  title: string;
  body?: string;
}) => void;

type UseMaterialSupportsParams = {
  isAdmin: boolean;
  showToast: ShowToast;
};

export type UseMaterialSupportsReturn = {
  supports: MaterialSupport[];
  supportsLoading: boolean;
  supportsError: string | null;
};

export const useMaterialSupports = ({
  isAdmin,
  showToast
}: UseMaterialSupportsParams): UseMaterialSupportsReturn => {
  const [supports, setSupports] = useState<MaterialSupport[]>([]);
  const [supportsLoading, setSupportsLoading] = useState<boolean>(false);
  const [supportsError, setSupportsError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) {
      setSupports([]);
      setSupportsLoading(false);
      setSupportsError(null);
      return;
    }

    let cancelled = false;

    const loadSupports = async () => {
      setSupportsLoading(true);
      setSupportsError(null);

      try {
        const loaded: MaterialSupport[] = [];
        let page = 1;
        const PAGE_SIZE = 100;

        while (true) {
          const { supports: pageSupports, pagination } =
            await fetchMaterialSupports({ page, pageSize: PAGE_SIZE });

          loaded.push(...pageSupports);

          if (!pagination || pagination.totalPages === 0 || page >= pagination.totalPages) {
            break;
          }

          page += 1;
        }

        if (!cancelled) {
          loaded.sort((a, b) =>
            a.type.localeCompare(b.type, undefined, { sensitivity: 'base' })
          );
          setSupports(loaded);
        }
      } catch (error) {
        console.error('Failed to load supports', error);
        if (!cancelled) {
          const message =
            error instanceof ApiError
              ? error.message
              : 'Failed to load supports.';
          setSupportsError(message);
          showToast({
            intent: 'error',
            title: 'Failed to load supports',
            body: message
          });
        }
      } finally {
        if (!cancelled) {
          setSupportsLoading(false);
        }
      }
    };

    void loadSupports();

    return () => {
      cancelled = true;
    };
  }, [isAdmin, showToast]);

  return {
    supports,
    supportsLoading,
    supportsError
  };
};
