import type { ApiErrorPayload, ExcelImportIssue, ExcelImportSummary } from './types';

export class ApiError extends Error {
  status: number;
  payload: ApiErrorPayload;
  templateId?: string;
  fileId?: string;
  issues?: ExcelImportIssue[];
  totalIssues?: number;
  summary?: ExcelImportSummary;
  code?: string;

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

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  token?: string;
  expectedRevision?: number;
  idempotencyKey?: string;
};

export const createOperationKey = (): string => {
  if (typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
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
    if (typeof payload.code === 'string') apiError.code = payload.code;
    if (typeof payload.fileId === 'string') apiError.fileId = payload.fileId;
    if (typeof payload.templateId === 'string') apiError.templateId = payload.templateId;
    if (Array.isArray(payload.issues)) {
      apiError.issues = payload.issues.filter(
        (issue): issue is ExcelImportIssue =>
          isRecord(issue) &&
          typeof issue.row === 'number' &&
          Number.isInteger(issue.row) &&
          issue.row >= 1 &&
          typeof issue.column === 'string' &&
          typeof issue.message === 'string',
      );
    }
    if (typeof payload.totalIssues === 'number' && Number.isInteger(payload.totalIssues)) {
      apiError.totalIssues = Math.max(payload.totalIssues, apiError.issues?.length ?? 0);
    }
    if (isRecord(payload.summary)) {
      const summary: ExcelImportSummary = {};
      for (const field of [
        'inserted',
        'created',
        'updated',
        'skipped',
        'imported',
        'importedPoints',
      ] as const) {
        const count = payload.summary[field];
        if (typeof count === 'number' && Number.isInteger(count) && count >= 0)
          summary[field] = count;
      }
      if (Object.keys(summary).length) apiError.summary = summary;
    }
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

// Keep an uncertain operation's key across an explicit user retry as well as
// the immediate transport retry. A successful save ends the logical operation.
const pendingOperations = new Map<string, string>();
const pendingUploads = new WeakMap<File, Map<string, string>>();

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  const mutating = options.method !== undefined && options.method !== 'GET';
  const operationFingerprint = mutating && options.expectedRevision !== undefined && !options.idempotencyKey
    ? JSON.stringify([options.token, path, options.method, options.expectedRevision, options.body]) : undefined;
  if (mutating) {
    const key = options.idempotencyKey ?? (operationFingerprint ? pendingOperations.get(operationFingerprint) : undefined)
      ?? createOperationKey();
    headers['Idempotency-Key'] = key;
    if (operationFingerprint) {
      pendingOperations.set(operationFingerprint, key);
      if (pendingOperations.size > 256) pendingOperations.delete(pendingOperations.keys().next().value!);
    }
  }
  if (options.expectedRevision !== undefined) headers['If-Match'] = `"${options.expectedRevision}"`;

  const requestInit: RequestInit = {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  };
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, requestInit);
  } catch (error) {
    // Retry an uncertain transport failure only for revision-protected endpoints.
    // The same operation key must reach the server; HTTP conflicts are never retried.
    if (!mutating || options.expectedRevision === undefined) throw error;
    response = await fetch(`${API_BASE_URL}${path}`, requestInit);
  }

  const contentType = response.headers.get('content-type') ?? '';
  const isJson = /\bapplication\/(?:[\w.-]+\+)?json\b/i.test(contentType);
  const payload = isJson ? await readJson(response) : null;

  if (!response.ok) {
    if (operationFingerprint && response.status >= 400 && response.status < 500 && response.status !== 408)
      pendingOperations.delete(operationFingerprint);
    throw responseError(response.status, payload, 'Request failed');
  }

  if (operationFingerprint) pendingOperations.delete(operationFingerprint);
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
  options: Pick<RequestOptions, 'expectedRevision' | 'idempotencyKey'> = {},
): Promise<T> {
  const formData = new FormData();
  formData.append('file', file);
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  const scope = JSON.stringify([token, path, options.expectedRevision]);
  const protectedOperation = options.expectedRevision !== undefined;
  let operations = pendingUploads.get(file);
  if (protectedOperation) {
    if (!operations) { operations = new Map(); pendingUploads.set(file, operations); }
    const key = options.idempotencyKey ?? operations.get(scope) ?? createOperationKey();
    operations.set(scope, key);
    headers['If-Match'] = `"${options.expectedRevision}"`;
    headers['Idempotency-Key'] = key;
  }
  const init: RequestInit = {
    method: 'POST',
    headers,
    body: formData,
  };
  let response: Response;
  try { response = await fetch(`${API_BASE_URL}${path}`, init); }
  catch (error) {
    if (!protectedOperation) throw error;
    response = await fetch(`${API_BASE_URL}${path}`, init);
  }
  const payload = await readJson(response);
  if (!response.ok) {
    if (response.status >= 400 && response.status < 500 && response.status !== 408) operations?.delete(scope);
    throw responseError(response.status, payload, fallback);
  }
  operations?.delete(scope);
  return payload as T;
}

export async function uploadExcelFile<T>(
  path: string,
  token: string,
  file: File,
  fallback: string,
  options: Pick<RequestOptions, 'expectedRevision' | 'idempotencyKey'> = {},
): Promise<T> {
  if (!/\.xlsx$/i.test(file.name)) {
    throw new ApiError(400, 'Select an Excel workbook saved as .xlsx.');
  }
  if (file.size === 0) {
    throw new ApiError(400, 'The selected file is empty. Save a workbook containing data.');
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new ApiError(413, 'The Excel workbook exceeds the 5 MB upload limit.');
  }
  return uploadFile<T>(path, token, file, fallback, options);
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
