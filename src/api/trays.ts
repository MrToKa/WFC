import { request, ApiError, getApiBaseUrl, uploadExcelFile } from './http';
import type { Tray, TrayInput, CableImportSummary } from './types';

export async function downloadTrayMaterialImage(
  token: string,
  projectId: string,
  trayId: string,
): Promise<Blob> {
  const response = await fetch(
    `${getApiBaseUrl()}/api/projects/${projectId}/trays/${trayId}/material-image`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!response.ok) throw new ApiError(response.status, 'Captured tray image is unavailable');
  return response.blob();
}

export async function fetchTrays(projectId: string): Promise<{ trays: Tray[] }> {
  return request<{ trays: Tray[] }>(`/api/projects/${projectId}/trays`);
}

export async function fetchTray(projectId: string, trayId: string): Promise<{ tray: Tray }> {
  return request<{ tray: Tray }>(`/api/projects/${projectId}/trays/${trayId}`);
}

export async function createTray(
  token: string,
  projectId: string,
  data: TrayInput,
): Promise<{ tray: Tray }> {
  return request<{ tray: Tray }>(`/api/projects/${projectId}/trays`, {
    method: 'POST',
    token,
    body: data,
  });
}

export async function updateTray(
  token: string,
  projectId: string,
  trayId: string,
  data: Partial<TrayInput>,
): Promise<{ tray: Tray }> {
  return request<{ tray: Tray }>(`/api/projects/${projectId}/trays/${trayId}`, {
    method: 'PATCH',
    token,
    body: data,
  });
}

export async function deleteTray(token: string, projectId: string, trayId: string): Promise<void> {
  await request<void>(`/api/projects/${projectId}/trays/${trayId}`, {
    method: 'DELETE',
    token,
  });
}

export async function importTrays(
  token: string,
  projectId: string,
  file: File,
): Promise<{ summary: CableImportSummary; trays: Tray[] }> {
  return uploadExcelFile(
    `/api/projects/${projectId}/trays/import`,
    token,
    file,
    'Failed to import trays',
  );
}

export async function exportTrays(
  token: string,
  projectId: string,
  options?: { freeSpaceByTrayId?: Record<string, number | null> },
): Promise<Blob> {
  const response = await fetch(`${getApiBaseUrl()}/api/projects/${projectId}/trays/export`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...(options?.freeSpaceByTrayId ? { freeSpaceByTrayId: options.freeSpaceByTrayId } : {}),
    }),
  });

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

export async function getTraysTemplate(token: string, projectId: string): Promise<Blob> {
  const response = await fetch(`${getApiBaseUrl()}/api/projects/${projectId}/trays/template`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

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
        : 'Failed to get trays template';

    throw new ApiError(response.status, errorPayload);
  }

  return response.blob();
}
