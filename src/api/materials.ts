import { request, ApiError, getApiBaseUrl, uploadExcelFile } from './http';
import type {
  MaterialCableInstallationMaterial,
  MaterialCableInstallationMaterialImportSummary,
  MaterialCableInstallationMaterialInput,
  MaterialTrayInstallationMaterial,
  MaterialTrayInstallationMaterialImportSummary,
  MaterialTrayInstallationMaterialInput,
  MaterialInstrument,
  MaterialInstrumentInput,
  MaterialInstrumentImportSummary,
  MaterialInstrumentInstallationMaterial,
  MaterialInstrumentInstallationMaterialInput,
  MaterialInstrumentInstallationMaterialImportSummary,
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
  MaterialDetailsResponse,
  StandardMaterialAssignment,
  StandardMaterialInput,
  StandardMaterialOwner,
  StandardMaterialOwnerCategory,
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

const standardMaterialOwnerPath = (
  category: StandardMaterialOwnerCategory,
  ownerId: string,
): string => {
  switch (category) {
    case 'cable-type':
      return `/api/materials/cable-types/${ownerId}`;
    case 'cable-installation-material':
      return `/api/materials/cable-installation-materials/${ownerId}`;
    case 'tray-installation-material':
      return `/api/materials/tray-installation-materials/${ownerId}`;
    case 'instrument':
      return `/api/materials/instruments/${ownerId}`;
    case 'instrument-installation-material':
      return `/api/materials/instrument-installation-materials/${ownerId}`;
    case 'tray':
      return `/api/materials/trays/${ownerId}`;
    case 'support':
      return `/api/materials/supports/${ownerId}`;
  }
};

export async function fetchMaterialDetails<T extends StandardMaterialOwner>(
  category: StandardMaterialOwnerCategory,
  ownerId: string,
): Promise<MaterialDetailsResponse<T>> {
  const path = standardMaterialOwnerPath(category, ownerId);
  const [details, composition] = await Promise.all([
    request<MaterialDetailsResponse<T>>(path),
    request<{ standardMaterials: StandardMaterialAssignment[]; mutationRevision: number; obsoleteAt?: string | null }>(`${path}/standard-materials`),
  ]);
  return { ...details, ...composition };
}

export async function createStandardMaterial(
  token: string,
  category: StandardMaterialOwnerCategory,
  ownerId: string,
  data: StandardMaterialInput,
  expectedRevision?: number,
): Promise<{ standardMaterial: StandardMaterialAssignment }> {
  return request(`${standardMaterialOwnerPath(category, ownerId)}/standard-materials`, {
    method: 'POST',
    token,
    body: data,
    expectedRevision,
  });
}

export async function updateStandardMaterial(
  token: string,
  category: StandardMaterialOwnerCategory,
  ownerId: string,
  assignmentId: string,
  data: Partial<StandardMaterialInput>,
  expectedRevision?: number,
): Promise<{ standardMaterial: StandardMaterialAssignment }> {
  return request(
    `${standardMaterialOwnerPath(category, ownerId)}/standard-materials/${assignmentId}`,
    { method: 'PATCH', token, body: data, expectedRevision },
  );
}

export async function deleteStandardMaterial(
  token: string,
  category: StandardMaterialOwnerCategory,
  ownerId: string,
  assignmentId: string,
  expectedRevision?: number,
): Promise<void> {
  await request(
    `${standardMaterialOwnerPath(category, ownerId)}/standard-materials/${assignmentId}`,
    { method: 'DELETE', token, expectedRevision },
  );
}

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

export async function deleteMaterialCableType(token: string, cableTypeId: string, expectedRevision?: number): Promise<{ mutationRevision: number }> {
  return request<{ mutationRevision: number }>(`/api/materials/cable-types/${cableTypeId}`, {
    method: 'DELETE',
    token,
    expectedRevision,
  });
}

export async function importMaterialCableTypes(
  token: string,
  file: File,
): Promise<{
  summary: MaterialCableTypeImportSummary;
  cableTypes: MaterialCableType[];
}> {
  return uploadExcelFile(
    `/api/materials/cable-types/import`,
    token,
    file,
    'Failed to import cable types',
  );
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
  expectedRevision?: number,
): Promise<{ mutationRevision: number }> {
  return request<{ mutationRevision: number }>(
    `/api/materials/cable-installation-materials/${cableInstallationMaterialId}`,
    {
      method: 'DELETE',
      token,
      expectedRevision,
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
  return uploadExcelFile(
    `/api/materials/cable-installation-materials/import`,
    token,
    file,
    'Failed to import cable installation materials',
  );
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

// Material Tray Installation Materials
export async function fetchMaterialTrayInstallationMaterials(): Promise<{
  trayInstallationMaterials: MaterialTrayInstallationMaterial[];
}> {
  return request<{
    trayInstallationMaterials: MaterialTrayInstallationMaterial[];
  }>('/api/materials/tray-installation-materials');
}

export async function createMaterialTrayInstallationMaterial(
  token: string,
  data: MaterialTrayInstallationMaterialInput,
): Promise<{ trayInstallationMaterial: MaterialTrayInstallationMaterial }> {
  return request<{ trayInstallationMaterial: MaterialTrayInstallationMaterial }>(
    '/api/materials/tray-installation-materials',
    {
      method: 'POST',
      token,
      body: data,
    },
  );
}

export async function updateMaterialTrayInstallationMaterial(
  token: string,
  trayInstallationMaterialId: string,
  data: Partial<MaterialTrayInstallationMaterialInput>,
): Promise<{ trayInstallationMaterial: MaterialTrayInstallationMaterial }> {
  return request<{ trayInstallationMaterial: MaterialTrayInstallationMaterial }>(
    `/api/materials/tray-installation-materials/${trayInstallationMaterialId}`,
    {
      method: 'PATCH',
      token,
      body: data,
    },
  );
}

export async function deleteMaterialTrayInstallationMaterial(
  token: string,
  trayInstallationMaterialId: string,
  expectedRevision?: number,
): Promise<{ mutationRevision: number }> {
  return request<{ mutationRevision: number }>(`/api/materials/tray-installation-materials/${trayInstallationMaterialId}`, {
    method: 'DELETE',
    token,
    expectedRevision,
  });
}

export async function importMaterialTrayInstallationMaterials(
  token: string,
  file: File,
): Promise<{
  summary: MaterialTrayInstallationMaterialImportSummary;
  trayInstallationMaterials: MaterialTrayInstallationMaterial[];
}> {
  return uploadExcelFile(
    `/api/materials/tray-installation-materials/import`,
    token,
    file,
    'Failed to import tray installation materials',
  );
}

export async function exportMaterialTrayInstallationMaterials(token: string): Promise<Blob> {
  const response = await fetch(
    `${getApiBaseUrl()}/api/materials/tray-installation-materials/export`,
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
        : 'Failed to export tray installation materials';

    throw new ApiError(response.status, errorPayload);
  }

  return response.blob();
}

export async function getMaterialTrayInstallationMaterialsTemplate(token: string): Promise<Blob> {
  const response = await fetch(
    `${getApiBaseUrl()}/api/materials/tray-installation-materials/template`,
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

// Material Instruments
export async function fetchMaterialInstruments(): Promise<{
  instruments: MaterialInstrument[];
}> {
  return request<{
    instruments: MaterialInstrument[];
  }>('/api/materials/instruments');
}

export async function createMaterialInstrument(
  token: string,
  data: MaterialInstrumentInput,
): Promise<{ instrument: MaterialInstrument }> {
  return request<{ instrument: MaterialInstrument }>('/api/materials/instruments', {
    method: 'POST',
    token,
    body: data,
  });
}

export async function updateMaterialInstrument(
  token: string,
  instrumentId: string,
  data: Partial<MaterialInstrumentInput>,
): Promise<{ instrument: MaterialInstrument }> {
  return request<{ instrument: MaterialInstrument }>(`/api/materials/instruments/${instrumentId}`, {
    method: 'PATCH',
    token,
    body: data,
  });
}

export async function deleteMaterialInstrument(token: string, instrumentId: string, expectedRevision?: number): Promise<{ mutationRevision: number }> {
  return request<{ mutationRevision: number }>(`/api/materials/instruments/${instrumentId}`, {
    method: 'DELETE',
    token,
    expectedRevision,
  });
}

export async function importMaterialInstruments(
  token: string,
  file: File,
): Promise<{
  summary: MaterialInstrumentImportSummary;
  instruments: MaterialInstrument[];
}> {
  return uploadExcelFile(
    `/api/materials/instruments/import`,
    token,
    file,
    'Failed to import instruments',
  );
}

export async function exportMaterialInstruments(token: string): Promise<Blob> {
  const response = await fetch(`${getApiBaseUrl()}/api/materials/instruments/export`, {
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
        : 'Failed to export instruments';

    throw new ApiError(response.status, errorPayload);
  }

  return response.blob();
}

export async function getMaterialInstrumentsTemplate(token: string): Promise<Blob> {
  const response = await fetch(`${getApiBaseUrl()}/api/materials/instruments/template`, {
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

// Material Instrument Installation Materials
export async function fetchMaterialInstrumentInstallationMaterials(): Promise<{
  instrumentInstallationMaterials: MaterialInstrumentInstallationMaterial[];
}> {
  return request<{
    instrumentInstallationMaterials: MaterialInstrumentInstallationMaterial[];
  }>('/api/materials/instrument-installation-materials');
}

export async function createMaterialInstrumentInstallationMaterial(
  token: string,
  data: MaterialInstrumentInstallationMaterialInput,
): Promise<{ instrumentInstallationMaterial: MaterialInstrumentInstallationMaterial }> {
  return request<{ instrumentInstallationMaterial: MaterialInstrumentInstallationMaterial }>(
    '/api/materials/instrument-installation-materials',
    {
      method: 'POST',
      token,
      body: data,
    },
  );
}

export async function updateMaterialInstrumentInstallationMaterial(
  token: string,
  instrumentInstallationMaterialId: string,
  data: Partial<MaterialInstrumentInstallationMaterialInput>,
): Promise<{ instrumentInstallationMaterial: MaterialInstrumentInstallationMaterial }> {
  return request<{ instrumentInstallationMaterial: MaterialInstrumentInstallationMaterial }>(
    `/api/materials/instrument-installation-materials/${instrumentInstallationMaterialId}`,
    {
      method: 'PATCH',
      token,
      body: data,
    },
  );
}

export async function deleteMaterialInstrumentInstallationMaterial(
  token: string,
  instrumentInstallationMaterialId: string,
  expectedRevision?: number,
): Promise<{ mutationRevision: number }> {
  return request<{ mutationRevision: number }>(
    `/api/materials/instrument-installation-materials/${instrumentInstallationMaterialId}`,
    {
      method: 'DELETE',
      token,
      expectedRevision,
    },
  );
}

export async function importMaterialInstrumentInstallationMaterials(
  token: string,
  file: File,
): Promise<{
  summary: MaterialInstrumentInstallationMaterialImportSummary;
  instrumentInstallationMaterials: MaterialInstrumentInstallationMaterial[];
}> {
  return uploadExcelFile(
    `/api/materials/instrument-installation-materials/import`,
    token,
    file,
    'Failed to import instrument installation materials',
  );
}

export async function exportMaterialInstrumentInstallationMaterials(token: string): Promise<Blob> {
  const response = await fetch(
    `${getApiBaseUrl()}/api/materials/instrument-installation-materials/export`,
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
        : 'Failed to export instrument installation materials';

    throw new ApiError(response.status, errorPayload);
  }

  return response.blob();
}

export async function getMaterialInstrumentInstallationMaterialsTemplate(
  token: string,
): Promise<Blob> {
  const response = await fetch(
    `${getApiBaseUrl()}/api/materials/instrument-installation-materials/template`,
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

export async function deleteMaterialTray(token: string, trayId: string, expectedRevision?: number): Promise<{ mutationRevision: number }> {
  return request<{ mutationRevision: number }>(`/api/materials/trays/${trayId}`, {
    method: 'DELETE',
    token,
    expectedRevision,
  });
}

export async function importMaterialTrays(
  token: string,
  file: File,
): Promise<{ summary: MaterialImportSummary; trays: MaterialTray[] }> {
  return uploadExcelFile(
    `/api/materials/trays/import`,
    token,
    file,
    'Failed to import trays',
  );
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

export async function fetchAllMaterialSupports(): Promise<{
  supports: MaterialSupport[];
}> {
  return request<{ supports: MaterialSupport[] }>('/api/materials/supports/all');
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

export async function deleteMaterialSupport(token: string, supportId: string, expectedRevision?: number): Promise<{ mutationRevision: number }> {
  return request<{ mutationRevision: number }>(`/api/materials/supports/${supportId}`, {
    method: 'DELETE',
    token,
    expectedRevision,
  });
}

export async function importMaterialSupports(
  token: string,
  file: File,
): Promise<{ summary: MaterialImportSummary; supports: MaterialSupport[] }> {
  return uploadExcelFile(
    `/api/materials/supports/import`,
    token,
    file,
    'Failed to import supports',
  );
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
  return uploadExcelFile(
    `/api/materials/load-curves/${loadCurveId}/import`,
    token,
    file,
    'Failed to import load curve points',
  );
}
