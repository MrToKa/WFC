import { getApiBaseUrl } from './http';

/** Independent full-project snapshot; nullable source values are never rewritten. */
export interface RoutingCable {
  id: string; projectId: string; tag: string | null; routing: string | null;
  fromLocation: string | null; toLocation: string | null;
}
export type RoutingCableErrorCode = 'AUTH_REQUIRED' | 'ACCESS_DENIED' | 'PROJECT_NOT_FOUND' |
  'INVALID_REQUEST' | 'INVALID_RESPONSE' | 'NETWORK_ERROR' | 'TIMEOUT' | 'CABLE_SERVICE_FAILED';
const messages: Record<RoutingCableErrorCode, string> = {
  AUTH_REQUIRED: 'Sign in again to read this project’s cables.',
  ACCESS_DENIED: 'You no longer have access to this project.',
  PROJECT_NOT_FOUND: 'This project is no longer available.',
  INVALID_REQUEST: 'The project cable list could not be requested.',
  INVALID_RESPONSE: 'The project cable service returned invalid or incomplete data.',
  NETWORK_ERROR: 'The project cable list is unavailable. Try again.',
  TIMEOUT: 'The project cable list timed out. Try again.',
  CABLE_SERVICE_FAILED: 'The project cable list is unavailable. Try again.',
};
export class RoutingCableApiError extends Error {
  readonly accessFailure: boolean;
  constructor(public readonly code: RoutingCableErrorCode, public readonly status: number | null = null) {
    super(messages[code]); this.name = 'RoutingCableApiError';
    this.accessFailure = status === 401 || status === 403 || status === 404;
  }
}
export const ROUTING_CABLE_TIMEOUT_MS = 10_000;
const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const invalid = (): never => { throw new RoutingCableApiError('INVALID_RESPONSE'); };
const cancelled = (signal: AbortSignal): unknown => signal.reason ?? new DOMException('The request was cancelled.', 'AbortError');

function boundedWait<T>(pending: Promise<T>, signal: AbortSignal, onLate?: (value: T) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(cancelled(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    pending.then(value => {
      signal.removeEventListener('abort', onAbort);
      if (signal.aborted) { onLate?.(value); reject(cancelled(signal)); } else resolve(value);
    }, error => { signal.removeEventListener('abort', onAbort); reject(error); });
  });
}

async function readSnapshot(response: Response, projectId: string, signal: AbortSignal): Promise<RoutingCable[]> {
  if (response.headers.has('content-range') || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    void response.body?.cancel().catch(() => {}); return invalid();
  }
  const reader = response.body?.getReader(); if (!reader) return invalid();
  const onAbort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', onAbort, { once: true });
  let size = 0; const chunks: Uint8Array[] = [];
  try {
    if (signal.aborted) throw cancelled(signal);
    for (;;) {
      const chunk = await reader.read();
      if (signal.aborted) throw cancelled(signal);
      if (chunk.done) break;
      size += chunk.value.byteLength; if (size > MAX_SNAPSHOT_BYTES) return invalid();
      chunks.push(chunk.value);
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
    await reader.cancel().catch(() => {}); reader.releaseLock();
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return invalid(); }
  // The existing endpoint returns exactly {cables}, without pagination metadata.
  if (!record(value) || Object.keys(value).length !== 1 || !Array.isArray(value.cables)) return invalid();
  const ids = new Set<string>();
  return value.cables.map((row: unknown) => {
    if (!record(row) || typeof row.id !== 'string' || !UUID.test(row.id) || ids.has(row.id) || row.projectId !== projectId ||
      !(row.tag === null || typeof row.tag === 'string') || !(row.routing === null || typeof row.routing === 'string') ||
      !(row.fromLocation === null || typeof row.fromLocation === 'string') || !(row.toLocation === null || typeof row.toLocation === 'string')) return invalid();
    ids.add(row.id);
    return { id: row.id, projectId, tag: row.tag, routing: row.routing, fromLocation: row.fromLocation, toLocation: row.toLocation };
  });
}

export async function fetchRoutingCables(
  projectId: string,
  token: string,
  { signal, timeoutMs = ROUTING_CABLE_TIMEOUT_MS }: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<RoutingCable[]> {
  if (!UUID.test(projectId) || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) throw new RoutingCableApiError('INVALID_REQUEST');
  if (typeof token !== 'string' || !token.trim()) throw new RoutingCableApiError('AUTH_REQUIRED', 401);
  if (signal?.aborted) throw cancelled(signal);
  const abort = new AbortController(); let timedOut = false;
  const onAbort = () => abort.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  const deadline = setTimeout(() => { timedOut = true; abort.abort(); }, timeoutMs);
  try {
    const response = await boundedWait(fetch(`${getApiBaseUrl()}/api/projects/${projectId}/cables`, {
      method: 'GET', headers: { Authorization: `Bearer ${token}` }, signal: abort.signal,
      cache: 'no-store', credentials: 'same-origin', redirect: 'error',
    }), abort.signal, late => { void late.body?.cancel().catch(() => {}); });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      const code: RoutingCableErrorCode = response.status === 401 ? 'AUTH_REQUIRED' : response.status === 403 ? 'ACCESS_DENIED' : response.status === 404 ? 'PROJECT_NOT_FOUND' : 'CABLE_SERVICE_FAILED';
      throw new RoutingCableApiError(code, response.status);
    }
    if (response.status !== 200) { void response.body?.cancel().catch(() => {}); throw new RoutingCableApiError('INVALID_RESPONSE', response.status); }
    const cables = await boundedWait(readSnapshot(response, projectId, abort.signal), abort.signal);
    if (signal?.aborted) throw cancelled(signal);
    if (timedOut) throw new RoutingCableApiError('TIMEOUT');
    return cables;
  } catch (error) {
    if (signal?.aborted) throw cancelled(signal);
    if (timedOut) throw new RoutingCableApiError('TIMEOUT');
    if (error instanceof RoutingCableApiError) throw error;
    throw new RoutingCableApiError('NETWORK_ERROR');
  } finally { clearTimeout(deadline); signal?.removeEventListener('abort', onAbort); }
}
