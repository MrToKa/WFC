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
        : (payload.formErrors?.[0] ??
          Object.values(payload.fieldErrors ?? {}).find((messages) => messages.length)?.[0] ??
          'Request failed');
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  token?: string;
};

const resolveDefaultApiBaseUrl = (): string => {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }

  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
    const hostname = window.location.hostname;
    const apiPort = import.meta.env.VITE_API_PORT ?? '4000';
    const portSegment = apiPort ? `:${apiPort}` : '';
    return `${protocol}//${hostname}${portSegment}`;
  }

  return 'http://localhost:4000';
};

const API_BASE_URL = resolveDefaultApiBaseUrl().replace(/\/+$/, '');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const responseError = (status: number, payload: unknown, fallback: string): ApiError => {
  const error = isRecord(payload) ? payload.error : undefined;
  let errorPayload: ApiErrorPayload = fallback;

  if (typeof error === 'string' && error) {
    errorPayload = error;
  } else if (isRecord(error)) {
    const formErrors = Array.isArray(error.formErrors)
      ? error.formErrors.filter((message): message is string => typeof message === 'string')
      : [];
    const fieldErrors: Record<string, string[]> = {};
    if (isRecord(error.fieldErrors)) {
      for (const [field, messages] of Object.entries(error.fieldErrors)) {
        if (Array.isArray(messages)) {
          fieldErrors[field] = messages.filter(
            (message): message is string => typeof message === 'string',
          );
        }
      }
    }
    if (formErrors.length || Object.values(fieldErrors).some((messages) => messages.length)) {
      errorPayload = { formErrors, fieldErrors };
    }
  }

  const apiError = new ApiError(status, errorPayload);
  if (isRecord(payload)) {
    if (typeof payload.fileId === 'string') apiError.fileId = payload.fileId;
    if (typeof payload.templateId === 'string') apiError.templateId = payload.templateId;
  }
  return apiError;
};

const readJson = async (response: Response): Promise<unknown> => {
  if (response.status === 204 || response.status === 205) {
    return null;
  }
  try {
    return await response.json();
  } catch {
    // Preserve HTTP status for authorization and validation errors, even when a
    // proxy returns an empty or malformed response body.
    if (!response.ok) return null;
    throw new Error('Received invalid JSON response from API');
  }
};

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
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
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const contentType = response.headers.get('content-type') ?? '';
  const isJson = /\bapplication\/(?:[\w.-]+\+)?json\b/i.test(contentType);
  const payload = isJson ? await readJson(response) : null;

  if (!response.ok) {
    throw responseError(response.status, payload, 'Request failed');
  }

  return payload as T;
}

export function getApiBaseUrl(): string {
  return API_BASE_URL;
}

export async function uploadFile<T>(
  path: string,
  token: string,
  file: File,
  fallback: string,
): Promise<T> {
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  const payload = await readJson(response);
  if (!response.ok) throw responseError(response.status, payload, fallback);
  return payload as T;
}

export async function downloadFile(
  path: string,
  token: string,
  fallback: string,
): Promise<{ blob: Blob; contentType: string }> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw responseError(response.status, await readJson(response), fallback);
  }
  return {
    blob: await response.blob(),
    contentType: response.headers.get('content-type') ?? 'application/octet-stream',
  };
}
