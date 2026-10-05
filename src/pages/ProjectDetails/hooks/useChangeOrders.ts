import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
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
  const [details, setDetailsState] = useState<ChangeOrderDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRequest = useRef(0);
  const detailsRequest = useRef(0);
  const currentSelection = useRef<string | null>(null);
  const currentDetails = useRef<ChangeOrderDetails | null>(null);
  const currentRevision = useRef<string | undefined>(undefined);
  const currentContext = useRef({ collection, projectId, token });
  currentContext.current = { collection, projectId, token };

  const isCurrentContext = useCallback(
    (): boolean =>
      currentContext.current.collection === collection &&
      currentContext.current.projectId === projectId &&
      currentContext.current.token === token,
    [collection, projectId, token],
  );

  const setDetails = useCallback((next: SetStateAction<ChangeOrderDetails | null>): void => {
    const value = typeof next === 'function' ? next(currentDetails.current) : next;
    currentDetails.current = value;
    currentRevision.current =
      value?.latestRevision !== undefined && value.revision !== value.latestRevision
        ? value.revision
        : undefined;
    setDetailsState(value);
  }, []);

  const loadList = useCallback(async (): Promise<ChangeOrderSummary[]> => {
    if (!isCurrentContext()) return [];
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
      if (request !== listRequest.current || !isCurrentContext()) return [];
      setChangeOrders(response.changeOrders);
      return response.changeOrders;
    } catch (caught) {
      if (request !== listRequest.current || !isCurrentContext()) return [];
      setError(caught instanceof Error ? caught.message : `Failed to load ${pluralLabel}`);
      return [];
    } finally {
      if (request === listRequest.current && isCurrentContext()) setLoading(false);
    }
  }, [collection, isCurrentContext, pluralLabel, projectId, token]);

  const loadDetails = useCallback(
    async (id: string | null, revision?: string, keepDetails = false): Promise<void> => {
      if (!isCurrentContext()) return;
      const request = ++detailsRequest.current;
      currentSelection.current = id;
      setSelectedId(id);
      if (!keepDetails) setDetails(null);
      currentRevision.current = revision;
      if (!id || !token) {
        setDetailsLoading(false);
        return;
      }
      setDetailsLoading(true);
      setError(null);
      try {
        const response =
          revision === undefined
            ? await fetchChangeOrder(token, projectId, id, collection)
            : await fetchChangeOrder(token, projectId, id, collection, revision);
        if (request !== detailsRequest.current || !isCurrentContext()) return;
        setDetails(response.changeOrder);
      } catch (caught) {
        if (request !== detailsRequest.current || !isCurrentContext()) return;
        setDetails(currentDetails.current);
        setError(caught instanceof Error ? caught.message : `Failed to load ${singularLabel}`);
      } finally {
        if (request === detailsRequest.current && isCurrentContext()) setDetailsLoading(false);
      }
    },
    [collection, isCurrentContext, projectId, setDetails, singularLabel, token],
  );

  const selectChangeOrder = useCallback(
    (id: string | null): Promise<void> => loadDetails(id),
    [loadDetails],
  );

  const selectRevision = useCallback(
    async (revision: string): Promise<void> => {
      if (!currentSelection.current || !token) return;
      await loadDetails(currentSelection.current, revision, true);
    },
    [loadDetails, token],
  );

  const refreshCurrent = useCallback(async (): Promise<void> => {
    const request = listRequest.current + 1;
    await loadList();
    if (request === listRequest.current && isCurrentContext() && currentSelection.current) {
      await loadDetails(
        currentSelection.current,
        currentRevision.current,
        currentRevision.current !== undefined,
      );
    }
  }, [isCurrentContext, loadDetails, loadList]);

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
    selectedId,
    details,
    loading,
    detailsLoading,
    error,
    setDetails,
    loadList,
    selectChangeOrder,
    selectRevision,
    refreshCurrent,
  };
};
