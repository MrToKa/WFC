export type User = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  isAdmin: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Project = {
  id: string;
  projectNumber: string;
  name: string;
  customer: string;
  manager: string | null;
  description: string | null;
  secondaryTrayLength: number | null;
  supportDistance: number | null;
  supportWeight: number | null;
  trayLoadSafetyFactor: number | null;
  supportDistanceOverrides: Record<string, ProjectSupportOverride>;
  createdAt: string;
  updatedAt: string;
};

export type ProjectSupportOverride = {
  distance: number | null;
  supportId: string | null;
  supportType: string | null;
};

export type ProjectSupportOverridePayload = {
  distance: number | null;
  supportId: string | null;
};

export type CableType = {
  id: string;
  projectId: string;
  name: string;
  tag: string | null;
  purpose: string | null;
  diameterMm: number | null;
  weightKgPerM: number | null;
  fromLocation: string | null;
  toLocation: string | null;
  routing: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Cable = {
  id: string;
  projectId: string;
  cableId: string;
  tag: string | null;
  cableTypeId: string;
  typeName: string;
  purpose: string | null;
  diameterMm: number | null;
  weightKgPerM: number | null;
  fromLocation: string | null;
  toLocation: string | null;
  routing: string | null;
  designLength: number | null;
  installLength: number | null;
  pullDate: string | null;
  connectedFrom: string | null;
  connectedTo: string | null;
  tested: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Tray = {
  id: string;
  projectId: string;
  name: string;
  type: string | null;
  purpose: string | null;
  widthMm: number | null;
  heightMm: number | null;
  lengthMm: number | null;
  includeGroundingCable: boolean;
  groundingCableTypeId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MaterialTray = {
  id: string;
  type: string;
  heightMm: number | null;
  widthMm: number | null;
  weightKgPerM: number | null;
  loadCurveId: string | null;
  loadCurveName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MaterialSupport = {
  id: string;
  type: string;
  heightMm: number | null;
  widthMm: number | null;
  lengthMm: number | null;
  weightKg: number | null;
  createdAt: string;
  updatedAt: string;
};

export type MaterialLoadCurvePoint = {
  id: string;
  order: number;
  spanM: number;
  loadKnPerM: number;
  createdAt: string;
  updatedAt: string;
};

export type MaterialLoadCurve = {
  id: string;
  name: string;
  description: string | null;
  trayId: string | null;
  trayType: string | null;
  assignedTrayCount: number;
  assignedTrayTypes: string[];
  createdAt: string;
  updatedAt: string;
  points: MaterialLoadCurvePoint[];
};

export type MaterialLoadCurvePointInput = {
  spanM: number;
  loadKnPerM: number;
};

export type MaterialLoadCurveInput = {
  name: string;
  description?: string | null;
  trayId?: string | null;
  points?: MaterialLoadCurvePointInput[];
};

export type MaterialLoadCurveUpdateInput = {
  name?: string;
  description?: string | null;
  trayId?: string | null;
  points?: MaterialLoadCurvePointInput[];
};

export type MaterialLoadCurveSummary = {
  id: string;
  name: string;
  trayId: string | null;
  trayType: string | null;
  assignedTrayCount: number;
  assignedTrayTypes: string[];
};

export type MaterialImportSummary = {
  totalRows: number;
  created: number;
  updated: number;
  skipped: number;
};

export type MaterialLoadCurveImportSummary = {
  importedPoints: number;
};

export type PaginationMeta = {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

export type CableSortColumn =
  | 'tag'
  | 'typeName'
  | 'fromLocation'
  | 'toLocation'
  | 'routing';

export type CableSortDirection = 'asc' | 'desc';
export type AuthSuccess = {
  user: User;
  token: string;
  expiresInSeconds: number;
};

export type ApiErrorPayload =
  | string
  | {
      formErrors?: string[];
      fieldErrors?: Record<string, string[]>;
    };

export class ApiError extends Error {
  status: number;
  payload: ApiErrorPayload;

  constructor(status: number, payload: ApiErrorPayload) {
    const message =
      typeof payload === 'string'
        ? payload
        : payload.formErrors?.[0] ??
          Object.values(payload.fieldErrors ?? {})[0]?.[0] ??
          'Request failed';
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  token?: string;
};

export type CableTypeInput = {
  name: string;
  tag?: string | null;
  purpose?: string | null;
  diameterMm?: number | null;
  weightKgPerM?: number | null;
  fromLocation?: string | null;
  toLocation?: string | null;
  routing?: string | null;
};

export type CableInput = {
  cableId: string;
  tag?: string | null;
  cableTypeId: string;
  fromLocation?: string | null;
  toLocation?: string | null;
  routing?: string | null;
  designLength?: number | null;
  installLength?: number | null;
  pullDate?: string | null;
  connectedFrom?: string | null;
  connectedTo?: string | null;
  tested?: string | null;
};

export type TrayInput = {
  name: string;
  type?: string | null;
  purpose?: string | null;
  widthMm?: number | null;
  heightMm?: number | null;
  lengthMm?: number | null;
  includeGroundingCable?: boolean;
  groundingCableTypeId?: string | null;
};

export type MaterialTrayInput = {
  type: string;
  heightMm?: number | null;
  widthMm?: number | null;
  weightKgPerM?: number | null;
  loadCurveId?: string | null;
};

export type MaterialSupportInput = {
  type: string;
  heightMm?: number | null;
  widthMm?: number | null;
  lengthMm?: number | null;
  weightKg?: number | null;
};

const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const contentType = response.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');
  const payload = isJson ? await response.json() : null;

  if (!response.ok) {
    throw new ApiError(response.status, payload?.error ?? 'Request failed');
  }

  return payload as T;
}

export async function registerUser(data: {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
}): Promise<AuthSuccess> {
  return request<AuthSuccess>('/api/auth/register', {
    method: 'POST',
    body: data
  });
}

export async function loginUser(data: {
  email: string;
  password: string;
}): Promise<AuthSuccess> {
  return request<AuthSuccess>('/api/auth/login', {
    method: 'POST',
    body: data
  });
}

export async function fetchCurrentUser(token: string): Promise<{ user: User }> {
  return request<{ user: User }>('/api/users/me', {
    method: 'GET',
    token
  });
}

export async function updateCurrentUser(
  token: string,
  data: {
    email?: string;
    firstName?: string;
    lastName?: string;
    password?: string;
  }
): Promise<{ user: User }> {
  return request<{ user: User }>('/api/users/me', {
    method: 'PATCH',
    token,
    body: data
  });
}

export async function deleteCurrentUser(token: string): Promise<void> {
  await request<void>('/api/users/me', { method: 'DELETE', token });
}

export async function fetchAllUsers(token: string): Promise<{ users: User[] }> {
  return request<{ users: User[] }>('/api/admin/users', {
    method: 'GET',
    token
  });
}

export async function updateUserAsAdmin(
  token: string,
  userId: string,
  data: {
    email?: string;
    firstName?: string;
    lastName?: string;
    password?: string;
  }
): Promise<{ user: User }> {
  return request<{ user: User }>(`/api/admin/users/${userId}`, {
    method: 'PATCH',
    token,
    body: data
  });
}

export async function deleteUserAsAdmin(token: string, userId: string): Promise<void> {
  await request<void>(`/api/admin/users/${userId}`, {
    method: 'DELETE',
    token
  });
}

export async function promoteUserAsAdmin(
  token: string,
  userId: string
): Promise<{ user: User }> {
  return request<{ user: User }>(`/api/admin/users/${userId}/promote`, {
    method: 'POST',
    token
  });
}

export async function fetchProjects(): Promise<{ projects: Project[] }> {
  return request<{ projects: Project[] }>('/api/projects', { method: 'GET' });
}

export async function fetchProject(
  projectId: string
): Promise<{ project: Project }> {
  return request<{ project: Project }>(`/api/projects/${projectId}`, {
    method: 'GET'
  });
}

export async function createProject(
  token: string,
  data: {
    projectNumber: string;
    name: string;
    customer: string;
    manager?: string | null;
    description?: string;
    secondaryTrayLength?: number | null;
    supportDistance?: number | null;
    supportWeight?: number | null;
    trayLoadSafetyFactor?: number | null;
    supportDistances?: Record<string, ProjectSupportOverridePayload>;
  }
): Promise<{ project: Project }> {
  return request<{ project: Project }>('/api/projects', {
    method: 'POST',
    token,
    body: data
  });
}

export async function updateProject(
  token: string,
  projectId: string,
  data: {
    projectNumber?: string;
    name?: string;
    customer?: string;
    manager?: string | null;
    description?: string;
    secondaryTrayLength?: number | null;
    supportDistance?: number | null;
    supportWeight?: number | null;
    trayLoadSafetyFactor?: number | null;
    supportDistances?: Record<string, ProjectSupportOverridePayload>;
  }
): Promise<{ project: Project }> {
  return request<{ project: Project }>(`/api/projects/${projectId}`, {
    method: 'PATCH',
    token,
    body: data
  });
}

export async function deleteProject(token: string, projectId: string): Promise<void> {
  await request<void>(`/api/projects/${projectId}`, {
    method: 'DELETE',
    token
  });
}

export async function fetchCableTypes(
  projectId: string
): Promise<{ cableTypes: CableType[] }> {
  return request<{ cableTypes: CableType[] }>(
    `/api/projects/${projectId}/cable-types`,
    { method: 'GET' }
  );
}

export async function createCableType(
  token: string,
  projectId: string,
  data: CableTypeInput
): Promise<{ cableType: CableType }> {
  return request<{ cableType: CableType }>(
    `/api/projects/${projectId}/cable-types`,
    {
      method: 'POST',
      token,
      body: data
    }
  );
}

export async function updateCableType(
  token: string,
  projectId: string,
  cableTypeId: string,
  data: Partial<CableTypeInput>
): Promise<{ cableType: CableType }> {
  return request<{ cableType: CableType }>(
    `/api/projects/${projectId}/cable-types/${cableTypeId}`,
    {
      method: 'PATCH',
      token,
      body: data
    }
  );
}

export async function deleteCableType(
  token: string,
  projectId: string,
  cableTypeId: string
): Promise<void> {
  await request<void>(
    `/api/projects/${projectId}/cable-types/${cableTypeId}`,
    {
      method: 'DELETE',
      token
    }
  );
}

export type CableImportSummary = {
  inserted: number;
  updated: number;
  skipped: number;
};

export async function importCableTypes(
  token: string,
  projectId: string,
  file: File
): Promise<{ summary: CableImportSummary; cableTypes: CableType[] }> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(
    `${API_BASE_URL}/api/projects/${projectId}/cable-types/import`,
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
        : 'Failed to import cable types';
    throw new ApiError(response.status, errorPayload);
  }

  return payload as { summary: CableImportSummary; cableTypes: CableType[] };
}

export async function exportCableTypes(
  token: string,
  projectId: string
): Promise<Blob> {
  const response = await fetch(
    `${API_BASE_URL}/api/projects/${projectId}/cable-types/export`,
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
        : 'Failed to export cable types';

    throw new ApiError(response.status, errorPayload);
  }

  return response.blob();
}

export async function fetchCables(
  projectId: string
): Promise<{ cables: Cable[] }> {
  return request<{ cables: Cable[] }>(`/api/projects/${projectId}/cables`);
}

export async function createCable(
  token: string,
  projectId: string,
  data: CableInput
): Promise<{ cable: Cable }> {
  return request<{ cable: Cable }>(`/api/projects/${projectId}/cables`, {
    method: 'POST',
    token,
    body: data
  });
}

export async function updateCable(
  token: string,
  projectId: string,
  cableId: string,
  data: Partial<CableInput>
): Promise<{ cable: Cable }> {
  return request<{ cable: Cable }>(
    `/api/projects/${projectId}/cables/${cableId}`,
    {
      method: 'PATCH',
      token,
      body: data
    }
  );
}

export async function deleteCable(
  token: string,
  projectId: string,
  cableId: string
): Promise<void> {
  await request<void>(`/api/projects/${projectId}/cables/${cableId}`, {
    method: 'DELETE',
    token
  });
}

export async function importCables(
  token: string,
  projectId: string,
  file: File
): Promise<{ summary: CableImportSummary; cables: Cable[] }> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(
    `${API_BASE_URL}/api/projects/${projectId}/cables/import`,
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
    sortColumn?: CableSortColumn;
    sortDirection?: CableSortDirection;
    view?: 'list' | 'report';
  }
): Promise<Blob> {
  const params = new URLSearchParams();

  const trimmedFilter = options?.filterText?.trim();

  if (trimmedFilter) {
    params.set('filter', trimmedFilter);
  }

  if (options?.cableTypeId) {
    params.set('cableTypeId', options.cableTypeId);
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
  const url = `${API_BASE_URL}/api/projects/${projectId}/cables/export${
    query ? `?${query}` : ''
  }`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`
    }
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
    `${API_BASE_URL}/api/projects/${projectId}/trays/import`,
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
    `${API_BASE_URL}/api/projects/${projectId}/trays/export`,
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
    `/api/materials/trays${query ? `?${query}` : ''}`
  );
}

export async function fetchAllMaterialTrays(): Promise<{
  trays: MaterialTray[];
}> {
  return request<{ trays: MaterialTray[] }>('/api/materials/trays/all');
}

export async function createMaterialTray(
  token: string,
  data: MaterialTrayInput
): Promise<{ tray: MaterialTray }> {
  return request<{ tray: MaterialTray }>('/api/materials/trays', {
    method: 'POST',
    token,
    body: data
  });
}

export async function updateMaterialTray(
  token: string,
  trayId: string,
  data: Partial<MaterialTrayInput>
): Promise<{ tray: MaterialTray }> {
  return request<{ tray: MaterialTray }>(
    `/api/materials/trays/${trayId}`,
    {
      method: 'PATCH',
      token,
      body: data
    }
  );
}

export async function deleteMaterialTray(
  token: string,
  trayId: string
): Promise<void> {
  await request<null>(`/api/materials/trays/${trayId}`, {
    method: 'DELETE',
    token
  });
}

export async function importMaterialTrays(
  token: string,
  file: File
): Promise<{ summary: MaterialImportSummary; trays: MaterialTray[] }> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_BASE_URL}/api/materials/trays/import`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: formData
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

  const response = await fetch(`${API_BASE_URL}/api/materials/trays/export`, {
    method: 'GET',
    headers
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
    `/api/materials/supports${query ? `?${query}` : ''}`
  );
}

export async function createMaterialSupport(
  token: string,
  data: MaterialSupportInput
): Promise<{ support: MaterialSupport }> {
  return request<{ support: MaterialSupport }>('/api/materials/supports', {
    method: 'POST',
    token,
    body: data
  });
}

export async function updateMaterialSupport(
  token: string,
  supportId: string,
  data: Partial<MaterialSupportInput>
): Promise<{ support: MaterialSupport }> {
  return request<{ support: MaterialSupport }>(
    `/api/materials/supports/${supportId}`,
    {
      method: 'PATCH',
      token,
      body: data
    }
  );
}

export async function deleteMaterialSupport(
  token: string,
  supportId: string
): Promise<void> {
  await request<null>(`/api/materials/supports/${supportId}`, {
    method: 'DELETE',
    token
  });
}

export async function importMaterialSupports(
  token: string,
  file: File
): Promise<{ summary: MaterialImportSummary; supports: MaterialSupport[] }> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_BASE_URL}/api/materials/supports/import`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: formData
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

  const response = await fetch(
    `${API_BASE_URL}/api/materials/supports/export`,
    {
      method: 'GET',
      headers
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
        : 'Failed to export supports';

    throw new ApiError(response.status, errorPayload);
  }

  return response.blob();
}

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
  return request<{ loadCurves: MaterialLoadCurveSummary[] }>(
    '/api/materials/load-curves/summary'
  );
}

export async function fetchMaterialLoadCurve(
  loadCurveId: string
): Promise<{ loadCurve: MaterialLoadCurve }> {
  return request<{ loadCurve: MaterialLoadCurve }>(
    `/api/materials/load-curves/${loadCurveId}`
  );
}

export async function createMaterialLoadCurve(
  token: string,
  data: MaterialLoadCurveInput
): Promise<{ loadCurve: MaterialLoadCurve }> {
  return request<{ loadCurve: MaterialLoadCurve }>('/api/materials/load-curves', {
    method: 'POST',
    token,
    body: data
  });
}

export async function updateMaterialLoadCurve(
  token: string,
  loadCurveId: string,
  data: MaterialLoadCurveUpdateInput
): Promise<{ loadCurve: MaterialLoadCurve }> {
  return request<{ loadCurve: MaterialLoadCurve }>(
    `/api/materials/load-curves/${loadCurveId}`,
    {
      method: 'PATCH',
      token,
      body: data
    }
  );
}

export async function deleteMaterialLoadCurve(
  token: string,
  loadCurveId: string
): Promise<void> {
  await request<null>(`/api/materials/load-curves/${loadCurveId}`, {
    method: 'DELETE',
    token
  });
}

export async function importMaterialLoadCurvePoints(
  token: string,
  loadCurveId: string,
  file: File
): Promise<{
  loadCurve: MaterialLoadCurve;
  summary: MaterialLoadCurveImportSummary;
}> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(
    `${API_BASE_URL}/api/materials/load-curves/${loadCurveId}/import`,
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
        : 'Failed to import load curve points';
    throw new ApiError(response.status, errorPayload);
  }

  return payload as {
    loadCurve: MaterialLoadCurve;
    summary: MaterialLoadCurveImportSummary;
  };
}
