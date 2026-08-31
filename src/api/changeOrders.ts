import { ApiError, getApiBaseUrl, request } from './http';
import type {
  ChangeOrderDetails,
  ChangeOrderHeaderInput,
  ChangeOrderItem,
  ChangeOrderItemUpdate,
  ChangeOrderSourceCatalog,
  ChangeOrderSummary,
} from './types';

export const CHANGE_ORDER_COLLECTIONS = ['change-orders', 'internal-ncrs'] as const;
export type ChangeOrderCollection = (typeof CHANGE_ORDER_COLLECTIONS)[number];

const basePath = (projectId: string, collection: ChangeOrderCollection = 'change-orders'): string =>
  `/api/projects/${projectId}/${collection}`;

export async function fetchChangeOrders(
  token: string,
  projectId: string,
  collection: ChangeOrderCollection = 'change-orders',
): Promise<{ changeOrders: ChangeOrderSummary[] }> {
  return request(`${basePath(projectId, collection)}`, { token });
}

export async function fetchChangeOrder(
  token: string,
  projectId: string,
  changeOrderId: string,
  collection: ChangeOrderCollection = 'change-orders',
): Promise<{ changeOrder: ChangeOrderDetails }> {
  return request(`${basePath(projectId, collection)}/${changeOrderId}`, { token });
}

export async function createChangeOrder(
  token: string,
  projectId: string,
  input: ChangeOrderHeaderInput,
  collection: ChangeOrderCollection = 'change-orders',
): Promise<{ changeOrder: ChangeOrderDetails }> {
  return request(basePath(projectId, collection), { method: 'POST', token, body: input });
}

export async function updateChangeOrder(
  token: string,
  projectId: string,
  changeOrderId: string,
  input: Partial<ChangeOrderHeaderInput>,
  collection: ChangeOrderCollection = 'change-orders',
): Promise<{ changeOrder: ChangeOrderDetails }> {
  return request(`${basePath(projectId, collection)}/${changeOrderId}`, {
    method: 'PATCH',
    token,
    body: input,
  });
}

export async function deleteChangeOrder(
  token: string,
  projectId: string,
  changeOrderId: string,
  collection: ChangeOrderCollection = 'change-orders',
): Promise<void> {
  await request(`${basePath(projectId, collection)}/${changeOrderId}`, {
    method: 'DELETE',
    token,
  });
}

export async function addChangeOrderItem(
  token: string,
  projectId: string,
  changeOrderId: string,
  input: { sourceCatalog: ChangeOrderSourceCatalog; sourceMaterialId: string },
  collection: ChangeOrderCollection = 'change-orders',
): Promise<{ item: ChangeOrderItem; changeOrder: ChangeOrderDetails }> {
  return request(`${basePath(projectId, collection)}/${changeOrderId}/items`, {
    method: 'POST',
    token,
    body: input,
  });
}

export async function updateChangeOrderItem(
  token: string,
  projectId: string,
  changeOrderId: string,
  itemId: string,
  input: ChangeOrderItemUpdate,
  collection: ChangeOrderCollection = 'change-orders',
): Promise<{ item: ChangeOrderItem }> {
  return request(`${basePath(projectId, collection)}/${changeOrderId}/items/${itemId}`, {
    method: 'PATCH',
    token,
    body: input,
  });
}

export async function duplicateChangeOrderItem(
  token: string,
  projectId: string,
  changeOrderId: string,
  itemId: string,
  collection: ChangeOrderCollection = 'change-orders',
): Promise<{ item: ChangeOrderItem; changeOrder: ChangeOrderDetails }> {
  return request(`${basePath(projectId, collection)}/${changeOrderId}/items/${itemId}/duplicate`, {
    method: 'POST',
    token,
  });
}

export async function deleteChangeOrderItem(
  token: string,
  projectId: string,
  changeOrderId: string,
  itemId: string,
  collection: ChangeOrderCollection = 'change-orders',
): Promise<void> {
  await request(`${basePath(projectId, collection)}/${changeOrderId}/items/${itemId}`, {
    method: 'DELETE',
    token,
  });
}

export async function reorderChangeOrderItems(
  token: string,
  projectId: string,
  changeOrderId: string,
  orderedItemIds: string[],
  collection: ChangeOrderCollection = 'change-orders',
): Promise<{ items: ChangeOrderItem[] }> {
  return request(`${basePath(projectId, collection)}/${changeOrderId}/items/order`, {
    method: 'PUT',
    token,
    body: { orderedItemIds },
  });
}

const readExportError = async (response: Response, documentName: string): Promise<string> => {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      const payload: unknown = await response.json();
      if (
        payload &&
        typeof payload === 'object' &&
        'error' in payload &&
        typeof (payload as { error?: unknown }).error === 'string'
      ) {
        return (payload as { error: string }).error;
      }
    } catch {
      // Fall through to the safe message below.
    }
  }
  return `Failed to export ${documentName}`;
};

export const buildChangeOrderExportFileName = (
  title: string,
  documentName = 'Change order',
): string => {
  const safeTitle = title
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  return `${documentName} - ${safeTitle || 'report'}.xlsx`;
};

export async function exportChangeOrder(
  token: string,
  projectId: string,
  changeOrderId: string,
  changeOrderTitle: string,
  collection: ChangeOrderCollection = 'change-orders',
): Promise<{ blob: Blob; fileName: string }> {
  const documentName = collection === 'internal-ncrs' ? 'Internal NCR' : 'Change Order';
  const response = await fetch(
    `${getApiBaseUrl()}${basePath(projectId, collection)}/${changeOrderId}/export`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!response.ok) {
    throw new ApiError(response.status, await readExportError(response, documentName));
  }
  const disposition = response.headers.get('content-disposition') ?? '';
  const fileNameMatch = disposition.match(/filename="([^"]+)"/i);
  return {
    blob: await response.blob(),
    fileName:
      fileNameMatch?.[1] ??
      buildChangeOrderExportFileName(
        changeOrderTitle,
        collection === 'internal-ncrs' ? 'Internal NCR' : 'Change order',
      ),
  };
}
