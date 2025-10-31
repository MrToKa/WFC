import { request, ApiError, getApiBaseUrl } from './http';
import type { Tray, TrayInput, CableImportSummary } from './types';

export async function fetchTrays(
  projectId: string
): Promise<{ trays: Tray[] }> {
  return request<{ trays: Tray[] }>(`/api/projects/${projectId}/trays`);
}

export async function fetchTray(
  projectId: string,
  trayId: string
): Promise<{ tray: Tray }> {
  return request<{ tray: Tray }>(
    `/api/projects/${projectId}/trays/${trayId}`
  );
}

export async function createTray(
  token: string,
  projectId: string,
  data: TrayInput
): Promise<{ tray: Tray }> {
  return request<{ tray: Tray }>(`/api/projects/${projectId}/trays`, {
    method: 'POST',
    token,
    body: data
  });
}

export async function updateTray(
  token: string,
  projectId: string,
  trayId: string,
  data: Partial<TrayInput>
): Promise<{ tray: Tray }> {
  return request<{ tray: Tray }>(
    `/api/projects/${projectId}/trays/${trayId}`,
    {
      method: 'PATCH',
      token,
      body: data
    }
  );
}

export async function deleteTray(
  token: string,
  projectId: string,
  trayId: string
): Promise<void> {
  await request<void>(`/api/projects/${projectId}/trays/${trayId}`, {
    method: 'DELETE',
    token
  });
}

export async function importTrays(
  token: string,
  projectId: string,
  file: File
): Promise<{ summary: CableImportSummary; trays: Tray[] }> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(
    `${getApiBaseUrl()}/api/projects/${projectId}/trays/import`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`
      },
      body: formData
    }
  );

  let payload: unknown = null;

  try {
    payload = await response.json();
  } catch {
    if (response.ok) {
      throw new Error('Received unexpected response from import endpoint');
    }
  }

  if (!response.ok) {
    const errorPayload =
      payload && typeof payload === 'object' && 'error' in payload
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (payload as any).error
        : 'Failed to import trays';
    throw new ApiError(response.status, errorPayload);
  }

  return payload as { summary: CableImportSummary; trays: Tray[] };
}

export async function exportTrays(
  token: string,
  projectId: string
): Promise<Blob> {
  const response = await fetch(
    `${getApiBaseUrl()}/api/projects/${projectId}/trays/export`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );

  if (!response.ok) {
    let payload: unknown = null;

    try {
      payload = await response.json();
    } catch {
      // ignore parse error
    }

    const errorPayload =
      payload && typeof payload === 'object' && 'error' in payload
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (payload as any).error
        : 'Failed to export trays';

    throw new ApiError(response.status, errorPayload);
  }

  return response.blob();
}
