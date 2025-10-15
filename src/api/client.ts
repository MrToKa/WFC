export type User = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  createdAt: string;
  updatedAt: string;
};

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
