import { request, ApiError, getApiBaseUrl } from './http';
import type {
  MaterialCableInstallationMaterial,
  MaterialCableInstallationMaterialImportSummary,
  MaterialCableInstallationMaterialInput,
  MaterialCableType,
  MaterialCableTypeImportSummary,
  MaterialCableTypeInput,
  MaterialTray,
  MaterialSupport,
  MaterialLoadCurve,
  MaterialLoadCurveSummary,
  MaterialTrayInput,
  MaterialSupportInput,
  MaterialLoadCurveInput,
  MaterialLoadCurveUpdateInput,
  MaterialImportSummary,
  MaterialLoadCurveImportSummary,
  PaginationMeta,
} from './types';

const extractErrorMessage = (payload: unknown, fallback: string): string => {
  if (
    payload &&
    typeof payload === 'object' &&
    'error' in payload &&
    typeof (payload as { error?: string }).error === 'string'
  ) {
    return (payload as { error: string }).error;
  }

  return fallback;
};

// Material Cable Types
export async function fetchMaterialCableTypes(): Promise<{
  cableTypes: MaterialCableType[];
}> {
  return request<{ cableTypes: MaterialCableType[] }>('/api/materials/cable-types');
}

export async function createMaterialCableType(
  token: string,
  data: MaterialCableTypeInput,
): Promise<{ cableType: MaterialCableType }> {
  return request<{ cableType: MaterialCableType }>('/api/materials/cable-types', {
    method: 'POST',
    token,
    body: data,
  });
}

export async function updateMaterialCableType(
  token: string,
  cableTypeId: string,
  data: Partial<MaterialCableTypeInput>,
): Promise<{ cableType: MaterialCableType }> {
  return request<{ cableType: MaterialCableType }>(`/api/materials/cable-types/${cableTypeId}`, {
    method: 'PATCH',
    token,
    body: data,
  });
}

export async function deleteMaterialCableType(token: string, cableTypeId: string): Promise<void> {
  await request<void>(`/api/materials/cable-types/${cableTypeId}`, {
    method: 'DELETE',
    token,
  });
}

export async function importMaterialCableTypes(
  token: string,
  file: File,
): Promise<{
  summary: MaterialCableTypeImportSummary;
  cableTypes: MaterialCableType[];
}> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${getApiBaseUrl()}/api/materials/cable-types/import`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

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
        : 'Failed to import cable types';
    throw new ApiError(response.status, errorPayload);
  }

  return payload as {
    summary: MaterialCableTypeImportSummary;
    cableTypes: MaterialCableType[];
  };
}

export async function exportMaterialCableTypes(token: string): Promise<Blob> {
  const response = await fetch(`${getApiBaseUrl()}/api/materials/cable-types/export`, {
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
        : 'Failed to export cable types';

    throw new ApiError(response.status, errorPayload);
  }

  return response.blob();
}

export async function getMaterialCableTypesTemplate(token: string): Promise<Blob> {
  const response = await fetch(`${getApiBaseUrl()}/api/materials/cable-types/template`, {
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
      // ignore parse errors to rethrow generic message
    }

    throw new ApiError(
      response.status,
      extractErrorMessage(payload, 'Failed to generate template'),
    );
  }

  return response.blob();
}

// Material Cable Installation Materials
export async function fetchMaterialCableInstallationMaterials(): Promise<{
  cableInstallationMaterials: MaterialCableInstallationMaterial[];
}> {
  return request<{
    cableInstallationMaterials: MaterialCableInstallationMaterial[];
  }>('/api/materials/cable-installation-materials');
}

export async function createMaterialCableInstallationMaterial(
  token: string,
  data: MaterialCableInstallationMaterialInput,
): Promise<{ cableInstallationMaterial: MaterialCableInstallationMaterial }> {
  return request<{ cableInstallationMaterial: MaterialCableInstallationMaterial }>(
    '/api/materials/cable-installation-materials',
    {
      method: 'POST',
      token,
      body: data,
    },
  );
}

export async function updateMaterialCableInstallationMaterial(
  token: string,
  cableInstallationMaterialId: string,
  data: Partial<MaterialCableInstallationMaterialInput>,
): Promise<{ cableInstallationMaterial: MaterialCableInstallationMaterial }> {
  return request<{ cableInstallationMaterial: MaterialCableInstallationMaterial }>(
    `/api/materials/cable-installation-materials/${cableInstallationMaterialId}`,
    {
      method: 'PATCH',
      token,
      body: data,
    },
  );
}

export async function deleteMaterialCableInstallationMaterial(
  token: string,
  cableInstallationMaterialId: string,
): Promise<void> {
  await request<void>(
    `/api/materials/cable-installation-materials/${cableInstallationMaterialId}`,
    {
      method: 'DELETE',
      token,
    },
  );
}

export async function importMaterialCableInstallationMaterials(
  token: string,
  file: File,
): Promise<{
  summary: MaterialCableInstallationMaterialImportSummary;
  cableInstallationMaterials: MaterialCableInstallationMaterial[];
}> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(
    `${getApiBaseUrl()}/api/materials/cable-installation-materials/import`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    },
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
        : 'Failed to import cable installation materials';
    throw new ApiError(response.status, errorPayload);
  }

  return payload as {
    summary: MaterialCableInstallationMaterialImportSummary;
    cableInstallationMaterials: MaterialCableInstallationMaterial[];
  };
}

export async function exportMaterialCableInstallationMaterials(token: string): Promise<Blob> {
  const response = await fetch(
    `${getApiBaseUrl()}/api/materials/cable-installation-materials/export`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
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
        : 'Failed to export cable installation materials';

    throw new ApiError(response.status, errorPayload);
  }

  return response.blob();
}

export async function getMaterialCableInstallationMaterialsTemplate(token: string): Promise<Blob> {
  const response = await fetch(
    `${getApiBaseUrl()}/api/materials/cable-installation-materials/template`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (!response.ok) {
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      // ignore parse errors to rethrow generic message
    }

    throw new ApiError(
      response.status,
      extractErrorMessage(payload, 'Failed to generate template'),
    );
  }

  return response.blob();
}

// Material Trays
export async function fetchMaterialTrays(options?: {
  page?: number;
  pageSize?: number;
}): Promise<{ trays: MaterialTray[]; pagination: PaginationMeta }> {
  const params = new URLSearchParams();

  if (options?.page !== undefined) {
    params.set('page', String(options.page));
  }

  if (options?.pageSize !== undefined) {
    params.set('pageSize', String(options.pageSize));
  }

  const query = params.toString();

  return request<{ trays: MaterialTray[]; pagination: PaginationMeta }>(
    `/api/materials/trays${query ? `?${query}` : ''}`,
  );
}

export async function fetchAllMaterialTrays(): Promise<{
  trays: MaterialTray[];
}> {
  return request<{ trays: MaterialTray[] }>('/api/materials/trays/all');
}

export async function createMaterialTray(
  token: string,
  data: MaterialTrayInput,
): Promise<{ tray: MaterialTray }> {
  return request<{ tray: MaterialTray }>('/api/materials/trays', {
    method: 'POST',
    token,
    body: data,
  });
}

export async function updateMaterialTray(
  token: string,
  trayId: string,
  data: Partial<MaterialTrayInput>,
): Promise<{ tray: MaterialTray }> {
  return request<{ tray: MaterialTray }>(`/api/materials/trays/${trayId}`, {
    method: 'PATCH',
    token,
    body: data,
  });
}

export async function deleteMaterialTray(token: string, trayId: string): Promise<void> {
  await request<null>(`/api/materials/trays/${trayId}`, {
    method: 'DELETE',
    token,
  });
}

export async function importMaterialTrays(
  token: string,
  file: File,
): Promise<{ summary: MaterialImportSummary; trays: MaterialTray[] }> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${getApiBaseUrl()}/api/materials/trays/import`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

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

  return payload as { summary: MaterialImportSummary; trays: MaterialTray[] };
}

export async function exportMaterialTrays(token?: string): Promise<Blob> {
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${getApiBaseUrl()}/api/materials/trays/export`, {
    method: 'GET',
    headers,
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

export async function getMaterialTrayTemplate(token: string): Promise<Blob> {
  const response = await fetch(`${getApiBaseUrl()}/api/materials/trays/template`, {
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
      // ignore parse errors to rethrow generic message
    }

    throw new ApiError(
      response.status,
      extractErrorMessage(payload, 'Failed to generate template'),
    );
  }

  return response.blob();
}

export async function getMaterialSupportTemplate(token: string): Promise<Blob> {
  const response = await fetch(`${getApiBaseUrl()}/api/materials/supports/template`, {
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
      // ignore parse errors and surface generic error
    }

    throw new ApiError(
      response.status,
      extractErrorMessage(payload, 'Failed to generate template'),
    );
  }

  return response.blob();
}

// Material Supports
export async function fetchMaterialSupports(options?: {
  page?: number;
  pageSize?: number;
}): Promise<{ supports: MaterialSupport[]; pagination: PaginationMeta }> {
  const params = new URLSearchParams();

  if (options?.page !== undefined) {
    params.set('page', String(options.page));
  }

  if (options?.pageSize !== undefined) {
    params.set('pageSize', String(options.pageSize));
  }

  const query = params.toString();

  return request<{ supports: MaterialSupport[]; pagination: PaginationMeta }>(
    `/api/materials/supports${query ? `?${query}` : ''}`,
  );
}

export async function createMaterialSupport(
  token: string,
  data: MaterialSupportInput,
): Promise<{ support: MaterialSupport }> {
  return request<{ support: MaterialSupport }>('/api/materials/supports', {
    method: 'POST',
    token,
    body: data,
  });
}

export async function updateMaterialSupport(
  token: string,
  supportId: string,
  data: Partial<MaterialSupportInput>,
): Promise<{ support: MaterialSupport }> {
  return request<{ support: MaterialSupport }>(`/api/materials/supports/${supportId}`, {
    method: 'PATCH',
    token,
    body: data,
  });
}

export async function deleteMaterialSupport(token: string, supportId: string): Promise<void> {
  await request<null>(`/api/materials/supports/${supportId}`, {
    method: 'DELETE',
    token,
  });
}

export async function importMaterialSupports(
  token: string,
  file: File,
): Promise<{ summary: MaterialImportSummary; supports: MaterialSupport[] }> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${getApiBaseUrl()}/api/materials/supports/import`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

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
        : 'Failed to import supports';
    throw new ApiError(response.status, errorPayload);
  }

  return payload as {
    summary: MaterialImportSummary;
    supports: MaterialSupport[];
  };
}

export async function exportMaterialSupports(token?: string): Promise<Blob> {
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${getApiBaseUrl()}/api/materials/supports/export`, {
    method: 'GET',
    headers,
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
        : 'Failed to export supports';

    throw new ApiError(response.status, errorPayload);
  }

  return response.blob();
}

// Material Load Curves
export async function fetchMaterialLoadCurves(options?: {
  page?: number;
  pageSize?: number;
}): Promise<{ loadCurves: MaterialLoadCurve[]; pagination: PaginationMeta }> {
  const params = new URLSearchParams();

  if (options?.page !== undefined) {
    params.set('page', String(options.page));
  }

  if (options?.pageSize !== undefined) {
    params.set('pageSize', String(options.pageSize));
  }

  const query = params.toString();

  return request<{
    loadCurves: MaterialLoadCurve[];
    pagination: PaginationMeta;
  }>(`/api/materials/load-curves${query ? `?${query}` : ''}`);
}

export async function fetchMaterialLoadCurveSummaries(): Promise<{
  loadCurves: MaterialLoadCurveSummary[];
}> {
  return request<{ loadCurves: MaterialLoadCurveSummary[] }>('/api/materials/load-curves/summary');
}

export async function fetchMaterialLoadCurve(
  loadCurveId: string,
): Promise<{ loadCurve: MaterialLoadCurve }> {
  return request<{ loadCurve: MaterialLoadCurve }>(`/api/materials/load-curves/${loadCurveId}`);
}

export async function createMaterialLoadCurve(
  token: string,
  data: MaterialLoadCurveInput,
): Promise<{ loadCurve: MaterialLoadCurve }> {
  return request<{ loadCurve: MaterialLoadCurve }>('/api/materials/load-curves', {
    method: 'POST',
    token,
    body: data,
  });
}

export async function updateMaterialLoadCurve(
  token: string,
  loadCurveId: string,
  data: MaterialLoadCurveUpdateInput,
): Promise<{ loadCurve: MaterialLoadCurve }> {
  return request<{ loadCurve: MaterialLoadCurve }>(`/api/materials/load-curves/${loadCurveId}`, {
    method: 'PATCH',
    token,
    body: data,
  });
}

export async function deleteMaterialLoadCurve(token: string, loadCurveId: string): Promise<void> {
  await request<null>(`/api/materials/load-curves/${loadCurveId}`, {
    method: 'DELETE',
    token,
  });
}

export async function importMaterialLoadCurvePoints(
  token: string,
  loadCurveId: string,
  file: File,
): Promise<{
  loadCurve: MaterialLoadCurve;
  summary: MaterialLoadCurveImportSummary;
}> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(
    `${getApiBaseUrl()}/api/materials/load-curves/${loadCurveId}/import`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    },
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
        : 'Failed to import load curve points';
    throw new ApiError(response.status, errorPayload);
  }

  return payload as {
    loadCurve: MaterialLoadCurve;
    summary: MaterialLoadCurveImportSummary;
  };
}
