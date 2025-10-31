import type { ApiErrorPayload } from './types';

export class ApiError extends Error {
  status: number;
  payload: ApiErrorPayload;
  templateId?: string;
  fileId?: string;

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

export async function request<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
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

export function getApiBaseUrl(): string {
  return API_BASE_URL;
}
