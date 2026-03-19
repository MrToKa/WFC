import { useCallback, useEffect, useState } from 'react';

import {
  ApiError,
  fetchCableReportSummary,
  type CableMtoOption,
  type CableReportSummary
} from '@/api/client';

import type { CableSearchCriteria } from './useCableListSection';

type UseCableReportSummaryParams = {
  projectId?: string;
  filterText: string;
  filterCriteria: CableSearchCriteria;
  mto: CableMtoOption | null;
  enabled: boolean;
};

type UseCableReportSummaryResult = {
  summary: CableReportSummary | null;
  isLoading: boolean;
  error: string | null;
  reload: () => void;
};

export const useCableReportSummary = ({
  projectId,
  filterText,
  filterCriteria,
  mto,
  enabled
}: UseCableReportSummaryParams): UseCableReportSummaryResult => {
  const [summary, setSummary] = useState<CableReportSummary | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState<number>(0);

  const reload = useCallback(() => {
    setReloadToken((previous) => previous + 1);
  }, []);

  useEffect(() => {
    if (!enabled || !projectId) {
      setSummary(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    let active = true;

    const loadSummary = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetchCableReportSummary(projectId, {
          filterText,
          criteria: filterCriteria,
          mto
        });

        if (!active) {
          return;
        }

        setSummary(response.summary);
      } catch (err) {
        console.error('Failed to load cable report summary', err);

        if (!active) {
          return;
        }

        setSummary(null);
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError('Failed to load cable report summary.');
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    void loadSummary();

    return () => {
      active = false;
    };
  }, [enabled, filterCriteria, filterText, mto, projectId, reloadToken]);

  return {
    summary,
    isLoading,
    error,
    reload
  };
};
