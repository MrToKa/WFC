import { getApiBaseUrl } from './http';

/** Full project-name snapshot for manual routing; independent of the Trays UI. */
export interface RoutingTray { id: string; projectId: string; name: string }
export type RoutingTrayErrorCode = 'AUTH_REQUIRED' | 'ACCESS_DENIED' | 'PROJECT_NOT_FOUND' |
  'INVALID_REQUEST' | 'INVALID_RESPONSE' | 'NETWORK_ERROR' | 'TIMEOUT' | 'TRAY_SERVICE_FAILED';
const messages: Record<RoutingTrayErrorCode, string> = {
  AUTH_REQUIRED: 'Sign in again to check this project.',
  ACCESS_DENIED: 'You no longer have access to this project.',
  PROJECT_NOT_FOUND: 'This project is no longer available.',
  INVALID_REQUEST: 'The project tray check could not be started.',
  INVALID_RESPONSE: 'The project tray service returned invalid data.',
  NETWORK_ERROR: 'The project tray check is unavailable. Try again.',
  TIMEOUT: 'The project tray check timed out. Try again.',
  TRAY_SERVICE_FAILED: 'The project tray check is unavailable. Try again.',
};
export class RoutingTrayApiError extends Error {
  readonly accessFailure: boolean;
  constructor(public readonly code: RoutingTrayErrorCode, public readonly status: number | null = null) {
    super(messages[code]); this.name = 'RoutingTrayApiError';
    this.accessFailure = status === 401 || status === 403 || status === 404;
  }
}
export const ROUTING_TRAY_TIMEOUT_MS = 10_000;
const MAX_METADATA_BYTES = 16 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const invalid = (): never => { throw new RoutingTrayApiError('INVALID_RESPONSE'); };
const cancelled = (signal: AbortSignal): unknown => signal.reason ?? new DOMException('The request was cancelled.', 'AbortError');

async function readSnapshot(response: Response, projectId: string): Promise<RoutingTray[]> {
  if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return invalid();
  const reader = response.body?.getReader(); if (!reader) return invalid();
  let size = 0; const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength; if (size > MAX_METADATA_BYTES) return invalid();
      chunks.push(chunk.value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return invalid(); }
  if (!record(value) || !Array.isArray(value.trays)) return invalid();
  const ids = new Set<string>();
  return value.trays.map((row: unknown) => {
    if (!record(row) || typeof row.id !== 'string' || !UUID.test(row.id) || ids.has(row.id) || row.projectId !== projectId || typeof row.name !== 'string') return invalid();
    ids.add(row.id);
    // Names remain data: normalized collisions must reach the independent index.
    return { id: row.id, projectId, name: row.name };
  });
}

export async function fetchRoutingTrays(
  projectId: string,
  token: string,
  { signal, timeoutMs = ROUTING_TRAY_TIMEOUT_MS }: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<RoutingTray[]> {
  if (!UUID.test(projectId) || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) throw new RoutingTrayApiError('INVALID_REQUEST');
  if (typeof token !== 'string' || !token.trim()) throw new RoutingTrayApiError('AUTH_REQUIRED', 401);
  if (signal?.aborted) throw cancelled(signal);
  const abort = new AbortController(); let timedOut = false;
  const onAbort = () => abort.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  const deadline = setTimeout(() => { timedOut = true; abort.abort(); }, timeoutMs);
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/projects/${projectId}/trays`, {
      method: 'GET', headers: { Authorization: `Bearer ${token}` }, signal: abort.signal,
      cache: 'no-store', credentials: 'same-origin', redirect: 'error',
    });
    if (signal?.aborted) throw cancelled(signal);
    if (timedOut) throw new RoutingTrayApiError('TIMEOUT');
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      const code: RoutingTrayErrorCode = response.status === 401 ? 'AUTH_REQUIRED' : response.status === 403 ? 'ACCESS_DENIED' : response.status === 404 ? 'PROJECT_NOT_FOUND' : 'TRAY_SERVICE_FAILED';
      throw new RoutingTrayApiError(code, response.status);
    }
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => {});
      throw new RoutingTrayApiError('INVALID_RESPONSE', response.status);
    }
    const trays = await readSnapshot(response, projectId);
    if (signal?.aborted) throw cancelled(signal);
    if (timedOut) throw new RoutingTrayApiError('TIMEOUT');
    return trays;
  } catch (error) {
    if (signal?.aborted) throw cancelled(signal);
    if (timedOut) throw new RoutingTrayApiError('TIMEOUT');
    if (error instanceof RoutingTrayApiError) throw error;
    throw new RoutingTrayApiError('NETWORK_ERROR');
  } finally { clearTimeout(deadline); signal?.removeEventListener('abort', onAbort); }
}
