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
  description: string | null;
  createdAt: string;
  updatedAt: string;
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
  createdAt: string;
  updatedAt: string;
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
};

export type TrayInput = {
  name: string;
  type?: string | null;
  purpose?: string | null;
  widthMm?: number | null;
  heightMm?: number | null;
  lengthMm?: number | null;
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
    description?: string;
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
    description?: string;
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
