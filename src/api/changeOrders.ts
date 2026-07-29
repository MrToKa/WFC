import { ApiError, getApiBaseUrl, request } from './http';
import type {
  ChangeOrderDetails,
  ChangeOrderHeaderInput,
  ChangeOrderItem,
  ChangeOrderItemUpdate,
  ChangeOrderSourceCatalog,
  ChangeOrderSummary,
} from './types';

const basePath = (projectId: string): string => `/api/projects/${projectId}/change-orders`;

export async function fetchChangeOrders(
  token: string,
  projectId: string,
): Promise<{ changeOrders: ChangeOrderSummary[] }> {
  return request(`${basePath(projectId)}`, { token });
}

export async function fetchChangeOrder(
  token: string,
  projectId: string,
  changeOrderId: string,
): Promise<{ changeOrder: ChangeOrderDetails }> {
  return request(`${basePath(projectId)}/${changeOrderId}`, { token });
}

export async function createChangeOrder(
  token: string,
  projectId: string,
  input: ChangeOrderHeaderInput,
): Promise<{ changeOrder: ChangeOrderDetails }> {
  return request(basePath(projectId), { method: 'POST', token, body: input });
}

export async function updateChangeOrder(
  token: string,
  projectId: string,
  changeOrderId: string,
  input: Partial<ChangeOrderHeaderInput>,
): Promise<{ changeOrder: ChangeOrderDetails }> {
  return request(`${basePath(projectId)}/${changeOrderId}`, {
    method: 'PATCH',
    token,
    body: input,
  });
}

export async function deleteChangeOrder(
  token: string,
  projectId: string,
  changeOrderId: string,
): Promise<void> {
  await request(`${basePath(projectId)}/${changeOrderId}`, { method: 'DELETE', token });
}

export async function addChangeOrderItem(
  token: string,
  projectId: string,
  changeOrderId: string,
  input: { sourceCatalog: ChangeOrderSourceCatalog; sourceMaterialId: string },
): Promise<{ item: ChangeOrderItem }> {
  return request(`${basePath(projectId)}/${changeOrderId}/items`, {
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
): Promise<{ item: ChangeOrderItem }> {
  return request(`${basePath(projectId)}/${changeOrderId}/items/${itemId}`, {
    method: 'PATCH',
    token,
    body: input,
  });
}

export async function deleteChangeOrderItem(
  token: string,
  projectId: string,
  changeOrderId: string,
  itemId: string,
): Promise<void> {
  await request(`${basePath(projectId)}/${changeOrderId}/items/${itemId}`, {
    method: 'DELETE',
    token,
  });
}

export async function reorderChangeOrderItems(
  token: string,
  projectId: string,
  changeOrderId: string,
  orderedItemIds: string[],
): Promise<{ items: ChangeOrderItem[] }> {
  return request(`${basePath(projectId)}/${changeOrderId}/items/order`, {
    method: 'PUT',
    token,
    body: { orderedItemIds },
  });
}

const readExportError = async (response: Response): Promise<string> => {
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
  return 'Failed to export Change Order';
};

export async function exportChangeOrder(
  token: string,
  projectId: string,
  changeOrderId: string,
): Promise<{ blob: Blob; fileName: string }> {
  const response = await fetch(`${getApiBaseUrl()}${basePath(projectId)}/${changeOrderId}/export`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new ApiError(response.status, await readExportError(response));
  }
  const disposition = response.headers.get('content-disposition') ?? '';
  const fileNameMatch = disposition.match(/filename="([^"]+)"/i);
  return {
    blob: await response.blob(),
    fileName: fileNameMatch?.[1] ?? 'Change order.xlsx',
  };
}
