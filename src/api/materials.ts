import { request, ApiError, getApiBaseUrl } from './http';
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
  return request<MaterialDetailsResponse<T>>(standardMaterialOwnerPath(category, ownerId));
}

export async function createStandardMaterial(
  token: string,
  category: StandardMaterialOwnerCategory,
  ownerId: string,
  data: StandardMaterialInput,
): Promise<{ standardMaterial: StandardMaterialAssignment }> {
  return request(`${standardMaterialOwnerPath(category, ownerId)}/standard-materials`, {
    method: 'POST',
    token,
    body: data,
  });
}

export async function updateStandardMaterial(
  token: string,
  category: StandardMaterialOwnerCategory,
  ownerId: string,
  assignmentId: string,
  data: Partial<StandardMaterialInput>,
): Promise<{ standardMaterial: StandardMaterialAssignment }> {
  return request(
    `${standardMaterialOwnerPath(category, ownerId)}/standard-materials/${assignmentId}`,
    { method: 'PATCH', token, body: data },
  );
}

export async function deleteStandardMaterial(
  token: string,
  category: StandardMaterialOwnerCategory,
  ownerId: string,
  assignmentId: string,
): Promise<void> {
  await request(
    `${standardMaterialOwnerPath(category, ownerId)}/standard-materials/${assignmentId}`,
    { method: 'DELETE', token },
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
): Promise<void> {
  await request<void>(`/api/materials/tray-installation-materials/${trayInstallationMaterialId}`, {
    method: 'DELETE',
    token,
  });
}

export async function importMaterialTrayInstallationMaterials(
  token: string,
  file: File,
): Promise<{
  summary: MaterialTrayInstallationMaterialImportSummary;
  trayInstallationMaterials: MaterialTrayInstallationMaterial[];
}> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(
    `${getApiBaseUrl()}/api/materials/tray-installation-materials/import`,
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
        : 'Failed to import tray installation materials';
    throw new ApiError(response.status, errorPayload);
  }

  return payload as {
    summary: MaterialTrayInstallationMaterialImportSummary;
    trayInstallationMaterials: MaterialTrayInstallationMaterial[];
  };
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

export async function deleteMaterialInstrument(token: string, instrumentId: string): Promise<void> {
  await request<void>(`/api/materials/instruments/${instrumentId}`, {
    method: 'DELETE',
    token,
  });
}

export async function importMaterialInstruments(
  token: string,
  file: File,
): Promise<{
  summary: MaterialInstrumentImportSummary;
  instruments: MaterialInstrument[];
}> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${getApiBaseUrl()}/api/materials/instruments/import`, {
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
        : 'Failed to import instruments';
    throw new ApiError(response.status, errorPayload);
  }

  return payload as {
    summary: MaterialInstrumentImportSummary;
    instruments: MaterialInstrument[];
  };
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
): Promise<void> {
  await request<void>(
    `/api/materials/instrument-installation-materials/${instrumentInstallationMaterialId}`,
    {
      method: 'DELETE',
      token,
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
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(
    `${getApiBaseUrl()}/api/materials/instrument-installation-materials/import`,
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
        : 'Failed to import instrument installation materials';
    throw new ApiError(response.status, errorPayload);
  }

  return payload as {
    summary: MaterialInstrumentInstallationMaterialImportSummary;
    instrumentInstallationMaterials: MaterialInstrumentInstallationMaterial[];
  };
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
