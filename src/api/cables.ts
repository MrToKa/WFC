import { request, ApiError, getApiBaseUrl, uploadExcelFile } from './http';
import type {
  CableType,
  Cable,
  CableMtoOption,
  CableReportSummary,
  CableVersion,
  CableDetails,
  CableMaterial,
  CableMaterialInput,
  CableMaterialSyncSummary,
  CableTypeDefaultMaterial,
  CableTypeDefaultMaterialImportSummary,
  CableTypeDefaultMaterialInput,
  CableTypeDetails,
  CableTypeInput,
  CableInput,
  CableImportSummary,
  CableSortColumn,
  CableSortDirection,
} from './types';

export async function fetchCableTypes(
  projectId: string,
): Promise<{ cableTypes: CableType[]; mutationRevision?: number }> {
  return request<{ cableTypes: CableType[] }>(`/api/projects/${projectId}/cable-types`, {
    method: 'GET',
  });
}

export async function createCableType(
  token: string,
  projectId: string,
  data: CableTypeInput,
  expectedRevision?: number,
): Promise<{ cableType: CableType; mutationRevision?: number }> {
  return request<{ cableType: CableType }>(`/api/projects/${projectId}/cable-types`, {
    method: 'POST',
    token,
    expectedRevision,
    body: data,
  });
}

export async function updateCableType(
  token: string,
  projectId: string,
  cableTypeId: string,
  data: Partial<CableTypeInput>,
  expectedRevision?: number,
): Promise<{ cableType: CableType; mutationRevision?: number }> {
  return request<{ cableType: CableType }>(
    `/api/projects/${projectId}/cable-types/${cableTypeId}`,
    {
      method: 'PATCH',
      token,
      expectedRevision,
      body: data,
    },
  );
}

export async function deleteCableType(
  token: string,
  projectId: string,
  cableTypeId: string,
  expectedRevision?: number,
): Promise<{ mutationRevision?: number }> {
  return request<{ mutationRevision?: number }>(
    `/api/projects/${projectId}/cable-types/${cableTypeId}`,
    {
      method: 'DELETE',
      token,
      expectedRevision,
    },
  );
}

export async function importCableTypes(
  token: string,
  projectId: string,
  file: File,
  expectedRevision?: number,
): Promise<{ summary: CableImportSummary; cableTypes: CableType[]; mutationRevision?: number }> {
  return uploadExcelFile(
    `/api/projects/${projectId}/cable-types/import`,
    token,
    file,
    'Failed to import cable types',
    { expectedRevision },
  );
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
  expectedRevision?: number,
): Promise<{ defaultMaterial: CableTypeDefaultMaterial; mutationRevision?: number }> {
  return request<{ defaultMaterial: CableTypeDefaultMaterial }>(
    `/api/projects/${projectId}/cable-types/${cableTypeId}/default-materials`,
    {
      method: 'POST',
      token,
      expectedRevision,
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
  expectedRevision?: number,
): Promise<{ defaultMaterial: CableTypeDefaultMaterial; mutationRevision?: number }> {
  return request<{ defaultMaterial: CableTypeDefaultMaterial }>(
    `/api/projects/${projectId}/cable-types/${cableTypeId}/default-materials/${defaultMaterialId}`,
    {
      method: 'PATCH',
      token,
      expectedRevision,
      body: data,
    },
  );
}

export async function deleteCableTypeDefaultMaterial(
  token: string,
  projectId: string,
  cableTypeId: string,
  defaultMaterialId: string,
  expectedRevision?: number,
): Promise<{ mutationRevision?: number }> {
  return request<{ mutationRevision?: number }>(
    `/api/projects/${projectId}/cable-types/${cableTypeId}/default-materials/${defaultMaterialId}`,
    {
      method: 'DELETE',
      token,
      expectedRevision,
    },
  );
}

export async function importCableTypeDefaultMaterials(
  token: string,
  projectId: string,
  cableTypeId: string,
  file: File,
  expectedRevision?: number,
): Promise<{
  summary: CableTypeDefaultMaterialImportSummary;
  defaultMaterials: CableTypeDefaultMaterial[];
  mutationRevision?: number;
}> {
  return uploadExcelFile(
    `/api/projects/${projectId}/cable-types/${cableTypeId}/default-materials/import`,
    token,
    file,
    'Failed to import default materials',
    { expectedRevision },
  );
}

export async function exportCableTypeDefaultMaterials(
  token: string,
  projectId: string,
  cableTypeId: string,
): Promise<Blob> {
  const response = await fetch(
    `${getApiBaseUrl()}/api/projects/${projectId}/cable-types/${cableTypeId}/default-materials/export`,
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
        : 'Failed to export default materials';

    throw new ApiError(response.status, errorPayload);
  }

  return response.blob();
}

export async function fetchCables(
  projectId: string,
): Promise<{ cables: Cable[]; mutationRevision?: number }> {
  return request<{ cables: Cable[] }>(`/api/projects/${projectId}/cables`);
}

export async function fetchCableReportSummary(
  projectId: string,
  options?: {
    filterText?: string;
    criteria?: 'all' | 'tag' | 'typeName' | 'fromLocation' | 'toLocation' | 'routing' | 'delivery';
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

export async function fetchCableVersions(
  projectId: string,
  cableId: string,
): Promise<{ versions: CableVersion[] }> {
  return request<{ versions: CableVersion[] }>(
    `/api/projects/${projectId}/cables/${cableId}/versions`,
    {
      method: 'GET',
    },
  );
}

export async function createCable(
  token: string,
  projectId: string,
  data: CableInput,
  expectedRevision?: number,
): Promise<{ cable: Cable; mutationRevision?: number }> {
  return request<{ cable: Cable }>(`/api/projects/${projectId}/cables`, {
    method: 'POST',
    token,
    expectedRevision,
    body: data,
  });
}

export async function updateCable(
  token: string,
  projectId: string,
  cableId: string,
  data: Partial<CableInput>,
  expectedRevision?: number,
): Promise<{ cable: Cable; mutationRevision?: number }> {
  return request<{ cable: Cable }>(`/api/projects/${projectId}/cables/${cableId}`, {
    method: 'PATCH',
    token,
    expectedRevision,
    body: data,
  });
}

export async function deleteCable(
  token: string,
  projectId: string,
  cableId: string,
  expectedRevision?: number,
): Promise<{ mutationRevision?: number }> {
  return request<{ mutationRevision?: number }>(`/api/projects/${projectId}/cables/${cableId}`, {
    method: 'DELETE',
    token,
    expectedRevision,
  });
}

export async function createCableMaterial(
  token: string,
  projectId: string,
  cableId: string,
  data: CableMaterialInput,
  expectedRevision?: number,
): Promise<{ cableMaterial: CableMaterial; mutationRevision?: number }> {
  return request<{ cableMaterial: CableMaterial }>(
    `/api/projects/${projectId}/cables/${cableId}/materials`,
    {
      method: 'POST',
      token,
      expectedRevision,
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
  expectedRevision?: number,
): Promise<{ cableMaterial: CableMaterial; mutationRevision?: number }> {
  return request<{ cableMaterial: CableMaterial }>(
    `/api/projects/${projectId}/cables/${cableId}/materials/${materialId}`,
    {
      method: 'PATCH',
      token,
      expectedRevision,
      body: data,
    },
  );
}

export async function deleteCableMaterial(
  token: string,
  projectId: string,
  cableId: string,
  materialId: string,
  expectedRevision?: number,
): Promise<{ mutationRevision?: number }> {
  return request<{ mutationRevision?: number }>(
    `/api/projects/${projectId}/cables/${cableId}/materials/${materialId}`,
    {
      method: 'DELETE',
      token,
      expectedRevision,
    },
  );
}

export async function syncCableBaseMaterials(
  token: string,
  projectId: string,
  cableId: string,
  expectedRevision?: number,
): Promise<{
  cableMaterials: CableMaterial[];
  cableTypeDefaultMaterials: CableTypeDefaultMaterial[];
  summary: CableMaterialSyncSummary;
  mutationRevision?: number;
}> {
  return request<{
    cableMaterials: CableMaterial[];
    cableTypeDefaultMaterials: CableTypeDefaultMaterial[];
    summary: CableMaterialSyncSummary;
    mutationRevision?: number;
  }>(`/api/projects/${projectId}/cables/${cableId}/materials/sync-defaults`, {
    method: 'POST',
    token,
    expectedRevision,
  });
}

export async function importCables(
  token: string,
  projectId: string,
  file: File,
  expectedRevision?: number,
): Promise<{ summary: CableImportSummary; cables: Cable[]; mutationRevision?: number }> {
  return uploadExcelFile(
    `/api/projects/${projectId}/cables/import`,
    token,
    file,
    'Failed to import cables',
    { expectedRevision },
  );
}

export async function exportCables(
  token: string,
  projectId: string,
  options?: {
    filterText?: string;
    cableTypeId?: string;
    criteria?: 'all' | 'tag' | 'typeName' | 'fromLocation' | 'toLocation' | 'routing' | 'delivery';
    mto?: CableMtoOption | null;
    sortColumn?: CableSortColumn;
    sortDirection?: CableSortDirection;
    view?: 'list' | 'report' | 'change-tracker';
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
