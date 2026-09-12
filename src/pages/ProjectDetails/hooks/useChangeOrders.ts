import { useCallback, useEffect, useRef, useState } from 'react';
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
  const [collectionMutationRevision, setCollectionMutationRevision] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [details, setDetails] = useState<ChangeOrderDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRequest = useRef(0);
  const detailsRequest = useRef(0);
  const currentSelection = useRef<string | null>(null);

  const loadList = useCallback(async (): Promise<ChangeOrderSummary[]> => {
    const request = ++listRequest.current;
    if (!token) {
      setChangeOrders([]);
      setLoading(false);
      return [];
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetchChangeOrders(token, projectId, collection);
      if (request !== listRequest.current) return [];
      setChangeOrders(response.changeOrders);
      setCollectionMutationRevision(response.mutationRevision ?? 0);
      return response.changeOrders;
    } catch (caught) {
      if (request !== listRequest.current) return [];
      setError(caught instanceof Error ? caught.message : `Failed to load ${pluralLabel}`);
      return [];
    } finally {
      if (request === listRequest.current) setLoading(false);
    }
  }, [collection, pluralLabel, projectId, token]);

  const selectChangeOrder = useCallback(
    async (id: string | null): Promise<void> => {
      const request = ++detailsRequest.current;
      currentSelection.current = id;
      setSelectedId(id);
      setDetails(null);
      if (!id || !token) {
        setDetailsLoading(false);
        return;
      }
      setDetailsLoading(true);
      setError(null);
      try {
        const response = await fetchChangeOrder(token, projectId, id, collection);
        if (request !== detailsRequest.current) return;
        setDetails(response.changeOrder);
      } catch (caught) {
        if (request !== detailsRequest.current) return;
        setError(caught instanceof Error ? caught.message : `Failed to load ${singularLabel}`);
      } finally {
        if (request === detailsRequest.current) setDetailsLoading(false);
      }
    },
    [collection, projectId, singularLabel, token],
  );

  const refreshCurrent = useCallback(async (): Promise<void> => {
    const request = listRequest.current + 1;
    await loadList();
    if (request === listRequest.current && currentSelection.current) {
      await selectChangeOrder(currentSelection.current);
    }
  }, [loadList, selectChangeOrder]);

  useEffect(() => {
    currentSelection.current = null;
    setSelectedId(null);
    setDetails(null);
    setDetailsLoading(false);
    setChangeOrders([]);
    setError(null);
    void loadList();
    return () => {
      listRequest.current += 1;
      detailsRequest.current += 1;
    };
  }, [loadList]);

  return {
    changeOrders,
    collectionMutationRevision,
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
