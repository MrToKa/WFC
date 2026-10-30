import { request, ApiError, getApiBaseUrl, uploadExcelFile } from './http';
import type { Tray, TrayInput, CableImportSummary } from './types';
import { projectDrawingMetricsSchema } from '../../shared/trayDrawingSnapshot';
import { trayAutoLengthResponseSchema, trayAutoLengthCaptureContextSchema, type TrayAutoLengthMeasurement, type TrayAutoLengthCaptureContext } from '../../shared/trayAutoLength';

async function trayLengthCaptureRequest(token: string, projectId: string, trayId: string, phase: 'capture-context' | 'capture', signal: AbortSignal, body?: unknown): Promise<unknown> {
  const response = await fetch(`${getApiBaseUrl()}/api/projects/${projectId}/trays/${trayId}/auto-length/${phase}`, {
    method: body === undefined ? 'GET' : 'POST', signal, cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value: unknown = await response.json();
  if (!response.ok) throw new ApiError(response.status, typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'string'
    ? value.error : 'The assigned tray geometry could not be measured. Try Auto-length again.');
  return value;
}

export async function fetchTrayAutoLengthCaptureContext(token: string, projectId: string, trayId: string, signal: AbortSignal): Promise<TrayAutoLengthCaptureContext> {
  const value = await trayLengthCaptureRequest(token, projectId, trayId, 'capture-context', signal);
  const parsed = trayAutoLengthCaptureContextSchema.safeParse(typeof value === 'object' && value !== null && 'context' in value ? value.context : null);
  if (!parsed.success || parsed.data.projectId !== projectId || parsed.data.trayId !== trayId) throw new ApiError(502, 'The assigned tray objects could not be verified. Refresh the tray.');
  return parsed.data;
}

export async function measureCapturedTrayAutoLength(token: string, context: TrayAutoLengthCaptureContext, snapshot: unknown, signal: AbortSignal): Promise<TrayAutoLengthMeasurement> {
  const value = await trayLengthCaptureRequest(token, context.projectId, context.trayId, 'capture', signal, { context, snapshot });
  const parsed = trayAutoLengthResponseSchema.safeParse(value);
  if (!parsed.success || !('source' in parsed.data.autoLength) || parsed.data.autoLength.source !== 'tray-capture'
    || parsed.data.autoLength.modelVersionId !== context.modelVersionId || parsed.data.autoLength.selectionRevision !== context.selectionRevision
    || parsed.data.autoLength.assignmentSha256 !== context.assignmentSha256) throw new ApiError(502, 'The tray centerline measurement could not be verified. Try Auto-length again.');
  return parsed.data.autoLength;
}

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
