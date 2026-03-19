import { request, ApiError, getApiBaseUrl } from './http';
import type {
  CableType,
  Cable,
  CableMtoOption,
  CableReportSummary,
  CableDetails,
  CableMaterial,
  CableMaterialInput,
  CableMaterialSyncSummary,
  CableTypeDefaultMaterial,
  CableTypeDefaultMaterialInput,
  CableTypeDetails,
  CableTypeInput,
  CableInput,
  CableImportSummary,
  CableSortColumn,
  CableSortDirection,
} from './types';

export async function fetchCableTypes(projectId: string): Promise<{ cableTypes: CableType[] }> {
  return request<{ cableTypes: CableType[] }>(`/api/projects/${projectId}/cable-types`, {
    method: 'GET',
  });
}

export async function createCableType(
  token: string,
  projectId: string,
  data: CableTypeInput,
): Promise<{ cableType: CableType }> {
  return request<{ cableType: CableType }>(`/api/projects/${projectId}/cable-types`, {
    method: 'POST',
    token,
    body: data,
  });
}

export async function updateCableType(
  token: string,
  projectId: string,
  cableTypeId: string,
  data: Partial<CableTypeInput>,
): Promise<{ cableType: CableType }> {
  return request<{ cableType: CableType }>(
    `/api/projects/${projectId}/cable-types/${cableTypeId}`,
    {
      method: 'PATCH',
      token,
      body: data,
    },
  );
}

export async function deleteCableType(
  token: string,
  projectId: string,
  cableTypeId: string,
): Promise<void> {
  await request<void>(`/api/projects/${projectId}/cable-types/${cableTypeId}`, {
    method: 'DELETE',
    token,
  });
}

export async function importCableTypes(
  token: string,
  projectId: string,
  file: File,
): Promise<{ summary: CableImportSummary; cableTypes: CableType[] }> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${getApiBaseUrl()}/api/projects/${projectId}/cable-types/import`, {
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

  return payload as { summary: CableImportSummary; cableTypes: CableType[] };
}

export async function exportCableTypes(token: string, projectId: string): Promise<Blob> {
  const response = await fetch(`${getApiBaseUrl()}/api/projects/${projectId}/cable-types/export`, {
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

export async function getCableTypesTemplate(token: string, projectId: string): Promise<Blob> {
  const response = await fetch(
    `${getApiBaseUrl()}/api/projects/${projectId}/cable-types/template`,
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
        : 'Failed to get cable types template';

    throw new ApiError(response.status, errorPayload);
  }

  return response.blob();
}

export async function fetchCableTypeDetails(
  projectId: string,
  cableTypeId: string,
): Promise<CableTypeDetails> {
  return request<CableTypeDetails>(
    `/api/projects/${projectId}/cable-types/${cableTypeId}/details`,
    { method: 'GET' },
  );
}

export async function createCableTypeDefaultMaterial(
  token: string,
  projectId: string,
  cableTypeId: string,
  data: CableTypeDefaultMaterialInput,
): Promise<{ defaultMaterial: CableTypeDefaultMaterial }> {
  return request<{ defaultMaterial: CableTypeDefaultMaterial }>(
    `/api/projects/${projectId}/cable-types/${cableTypeId}/default-materials`,
    {
      method: 'POST',
      token,
      body: data,
    },
  );
}

export async function updateCableTypeDefaultMaterial(
  token: string,
  projectId: string,
  cableTypeId: string,
  defaultMaterialId: string,
  data: Partial<CableTypeDefaultMaterialInput>,
): Promise<{ defaultMaterial: CableTypeDefaultMaterial }> {
  return request<{ defaultMaterial: CableTypeDefaultMaterial }>(
    `/api/projects/${projectId}/cable-types/${cableTypeId}/default-materials/${defaultMaterialId}`,
    {
      method: 'PATCH',
      token,
      body: data,
    },
  );
}

export async function deleteCableTypeDefaultMaterial(
  token: string,
  projectId: string,
  cableTypeId: string,
  defaultMaterialId: string,
): Promise<void> {
  await request<void>(
    `/api/projects/${projectId}/cable-types/${cableTypeId}/default-materials/${defaultMaterialId}`,
    {
      method: 'DELETE',
      token,
    },
  );
}

export async function fetchCables(projectId: string): Promise<{ cables: Cable[] }> {
  return request<{ cables: Cable[] }>(`/api/projects/${projectId}/cables`);
}

export async function fetchCableReportSummary(
  projectId: string,
  options?: {
    filterText?: string;
    criteria?: 'all' | 'tag' | 'typeName' | 'fromLocation' | 'toLocation' | 'routing';
    mto?: CableMtoOption | null;
  },
): Promise<{ summary: CableReportSummary }> {
  const params = new URLSearchParams();
  const trimmedFilter = options?.filterText?.trim();

  if (trimmedFilter) {
    params.set('filter', trimmedFilter);
  }

  if (options?.criteria) {
    params.set('criteria', options.criteria);
  }

  if (options?.mto) {
    params.set('mto', options.mto);
  }

  const query = params.toString();

  return request<{ summary: CableReportSummary }>(
    `/api/projects/${projectId}/cables/report-summary${query ? `?${query}` : ''}`,
    {
      method: 'GET',
    },
  );
}

export async function fetchCableDetails(projectId: string, cableId: string): Promise<CableDetails> {
  return request<CableDetails>(`/api/projects/${projectId}/cables/${cableId}/details`, {
    method: 'GET',
  });
}

export async function createCable(
  token: string,
  projectId: string,
  data: CableInput,
): Promise<{ cable: Cable }> {
  return request<{ cable: Cable }>(`/api/projects/${projectId}/cables`, {
    method: 'POST',
    token,
    body: data,
  });
}

export async function updateCable(
  token: string,
  projectId: string,
  cableId: string,
  data: Partial<CableInput>,
): Promise<{ cable: Cable }> {
  return request<{ cable: Cable }>(`/api/projects/${projectId}/cables/${cableId}`, {
    method: 'PATCH',
    token,
    body: data,
  });
}

export async function deleteCable(
  token: string,
  projectId: string,
  cableId: string,
): Promise<void> {
  await request<void>(`/api/projects/${projectId}/cables/${cableId}`, {
    method: 'DELETE',
    token,
  });
}

export async function createCableMaterial(
  token: string,
  projectId: string,
  cableId: string,
  data: CableMaterialInput,
): Promise<{ cableMaterial: CableMaterial }> {
  return request<{ cableMaterial: CableMaterial }>(
    `/api/projects/${projectId}/cables/${cableId}/materials`,
    {
      method: 'POST',
      token,
      body: data,
    },
  );
}

export async function updateCableMaterial(
  token: string,
  projectId: string,
  cableId: string,
  materialId: string,
  data: Partial<CableMaterialInput>,
): Promise<{ cableMaterial: CableMaterial }> {
  return request<{ cableMaterial: CableMaterial }>(
    `/api/projects/${projectId}/cables/${cableId}/materials/${materialId}`,
    {
      method: 'PATCH',
      token,
      body: data,
    },
  );
}

export async function deleteCableMaterial(
  token: string,
  projectId: string,
  cableId: string,
  materialId: string,
): Promise<void> {
  await request<void>(`/api/projects/${projectId}/cables/${cableId}/materials/${materialId}`, {
    method: 'DELETE',
    token,
  });
}

export async function syncCableBaseMaterials(
  token: string,
  projectId: string,
  cableId: string,
): Promise<{
  cableMaterials: CableMaterial[];
  cableTypeDefaultMaterials: CableTypeDefaultMaterial[];
  summary: CableMaterialSyncSummary;
}> {
  return request<{
    cableMaterials: CableMaterial[];
    cableTypeDefaultMaterials: CableTypeDefaultMaterial[];
    summary: CableMaterialSyncSummary;
  }>(`/api/projects/${projectId}/cables/${cableId}/materials/sync-defaults`, {
    method: 'POST',
    token,
  });
}

export async function importCables(
  token: string,
  projectId: string,
  file: File,
): Promise<{ summary: CableImportSummary; cables: Cable[] }> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${getApiBaseUrl()}/api/projects/${projectId}/cables/import`, {
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
        : 'Failed to import cables';
    throw new ApiError(response.status, errorPayload);
  }

  return payload as { summary: CableImportSummary; cables: Cable[] };
}

export async function exportCables(
  token: string,
  projectId: string,
  options?: {
    filterText?: string;
    cableTypeId?: string;
    criteria?: 'all' | 'tag' | 'typeName' | 'fromLocation' | 'toLocation' | 'routing';
    mto?: CableMtoOption | null;
    sortColumn?: CableSortColumn;
    sortDirection?: CableSortDirection;
    view?: 'list' | 'report';
  },
): Promise<Blob> {
  const params = new URLSearchParams();

  const trimmedFilter = options?.filterText?.trim();

  if (trimmedFilter) {
    params.set('filter', trimmedFilter);
  }

  if (options?.cableTypeId) {
    params.set('cableTypeId', options.cableTypeId);
  }

  if (options?.mto) {
    params.set('mto', options.mto);
  }

  if (options?.criteria) {
    params.set('criteria', options.criteria);
  }

  if (options?.sortColumn) {
    params.set('sortColumn', options.sortColumn);
  }

  if (options?.sortDirection) {
    params.set('sortDirection', options.sortDirection);
  }

  if (options?.view) {
    params.set('view', options.view);
  }

  const query = params.toString();
  const url = `${getApiBaseUrl()}/api/projects/${projectId}/cables/export${
    query ? `?${query}` : ''
  }`;

  const response = await fetch(url, {
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
        : 'Failed to export cables';

    throw new ApiError(response.status, errorPayload);
  }

  return response.blob();
}

export async function getCablesTemplate(
  token: string,
  projectId: string,
  view?: 'list' | 'report',
): Promise<Blob> {
  const params = new URLSearchParams();

  if (view) {
    params.set('view', view);
  }

  const query = params.toString();
  const url = `${getApiBaseUrl()}/api/projects/${projectId}/cables/template${
    query ? `?${query}` : ''
  }`;

  const response = await fetch(url, {
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
        : 'Failed to get cables template';

    throw new ApiError(response.status, errorPayload);
  }

  return response.blob();
}
