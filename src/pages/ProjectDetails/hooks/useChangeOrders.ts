import { useCallback, useEffect, useState } from 'react';
import {
  fetchChangeOrder,
  fetchChangeOrders,
  type ChangeOrderCollection,
  type ChangeOrderDetails,
  type ChangeOrderSummary,
} from '@/api/client';

type UseChangeOrdersOptions = {
  collection?: ChangeOrderCollection;
  singularLabel?: string;
  pluralLabel?: string;
};

export const useChangeOrders = (
  projectId: string,
  token: string | null,
  {
    collection = 'change-orders',
    singularLabel = 'Change Order',
    pluralLabel = 'Change Orders',
  }: UseChangeOrdersOptions = {},
) => {
  const [changeOrders, setChangeOrders] = useState<ChangeOrderSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [details, setDetails] = useState<ChangeOrderDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadList = useCallback(async (): Promise<ChangeOrderSummary[]> => {
    if (!token) {
      setChangeOrders([]);
      return [];
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetchChangeOrders(token, projectId, collection);
      setChangeOrders(response.changeOrders);
      return response.changeOrders;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `Failed to load ${pluralLabel}`);
      return [];
    } finally {
      setLoading(false);
    }
  }, [collection, pluralLabel, projectId, token]);

  const selectChangeOrder = useCallback(
    async (id: string | null): Promise<void> => {
      setSelectedId(id);
      setDetails(null);
      if (!id || !token) return;
      setDetailsLoading(true);
      setError(null);
      try {
        const response = await fetchChangeOrder(token, projectId, id, collection);
        setDetails(response.changeOrder);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : `Failed to load ${singularLabel}`);
      } finally {
        setDetailsLoading(false);
      }
    },
    [collection, projectId, singularLabel, token],
  );

  const refreshCurrent = useCallback(async (): Promise<void> => {
    await loadList();
    if (selectedId) {
      await selectChangeOrder(selectedId);
    }
  }, [loadList, selectChangeOrder, selectedId]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  return {
    changeOrders,
    selectedId,
    details,
    loading,
    detailsLoading,
    error,
    setDetails,
    loadList,
    selectChangeOrder,
    refreshCurrent,
  };
};
