import { request, ApiError, getApiBaseUrl, uploadExcelFile } from './http';
import type { Tray, TrayInput, CableImportSummary } from './types';
import { projectDrawingMetricsSchema } from '../../shared/trayDrawingSnapshot';
import { trayAutoLengthResponseSchema, type TrayAutoLengthMeasurement } from '../../shared/trayAutoLength';

export async function fetchTrays(projectId: string, options: { drawingMetrics?: true; token?: string } = {}): Promise<{ trays: Tray[]; freeSpaceByTrayId?: Record<string, number | null> }> {
  const response = await request<{ trays: Tray[]; freeSpaceByTrayId?: Record<string, number | null> }>(`/api/projects/${projectId}/trays${options.drawingMetrics ? '?drawingMetrics=1' : ''}`, { token: options.token });
  if (options.drawingMetrics) {
    const parsed = projectDrawingMetricsSchema.safeParse(response);
    if (!parsed.success || parsed.data.project.id !== projectId) throw new ApiError(502, 'Shared drawing metrics are unavailable. Refresh the trays.');
    return { trays: parsed.data.trays as unknown as Tray[], freeSpaceByTrayId: parsed.data.freeSpaceByTrayId };
  }
  return response;
}
export async function fetchTray(
  projectId: string,
  trayId: string
): Promise<{ tray: Tray }> {
  return request<{ tray: Tray }>(
    `/api/projects/${projectId}/trays/${trayId}`
  );
}

export async function fetchTrayAutoLength(
  token: string,
  projectId: string,
  trayId: string,
): Promise<TrayAutoLengthMeasurement> {
  const response = await request<unknown>(
    `/api/projects/${projectId}/trays/${trayId}/auto-length`,
    { token },
  );
  const parsed = trayAutoLengthResponseSchema.safeParse(response);
  if (!parsed.success) throw new ApiError(502, 'The tray centerline length could not be read. Try Auto-length again.');
  return parsed.data.autoLength;
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
  return uploadExcelFile(
    `/api/projects/${projectId}/trays/import`,
    token,
    file,
    'Failed to import trays',
  );
}

export async function exportTrays(
  token: string,
  projectId: string
): Promise<Blob> {
  const response = await fetch(
    `${getApiBaseUrl()}/api/projects/${projectId}/trays/export`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
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

export async function getTraysTemplate(
  token: string,
  projectId: string
): Promise<Blob> {
  const response = await fetch(
    `${getApiBaseUrl()}/api/projects/${projectId}/trays/template`,
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
        : 'Failed to get trays template';

    throw new ApiError(response.status, errorPayload);
  }

  return response.blob();
}
