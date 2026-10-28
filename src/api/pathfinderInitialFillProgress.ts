import { getApiBaseUrl } from './http';
import { parsePurposeJson, policyUuidSchema } from '../../shared/pathfinderPurposePolicy';
import { initialFillProgressQuerySchema, initialFillProgressSchema, INITIAL_FILL_PROGRESS_LIMITS, type InitialFillProgress } from '../../shared/pathfinderInitialFillProgress';
import { discardPathFinderBody, pathFinderRequestDeadline, releasePathFinderReader } from './pathfinderRequestDeadline';
export type { InitialFillProgress };
export const INITIAL_FILL_PROGRESS_READ_MILLISECONDS = 30_000;
export class InitialFillProgressApiError extends Error {
  constructor(public readonly code: string, public readonly status: number | null, message: string) { super(message); }
}
const invalid = (): never => { throw new InitialFillProgressApiError('INVALID_RESPONSE', null, 'Initial-fill progress could not be verified. Refresh its status.'); };
function failure(status: number, value: unknown): never {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>).code : null;
  const code = typeof raw === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/.test(raw) ? raw : 'INITIAL_FILL_PROGRESS_UNAVAILABLE';
  throw new InitialFillProgressApiError(code, status, [401, 403].includes(status) ? 'Current administrator access is required. Sign in again to read initial-fill progress.'
    : status === 404 ? 'This initial-fill impact is unavailable for the current account.' : 'Initial-fill progress is unavailable. Refresh to try again.');
}
/** Bounded observation only. It never starts, retries, renews or applies a write. */
export async function fetchInitialFillProgress(projectId: string, token: string, accountId: string, impactId: string, cableId?: string | null, signal?: AbortSignal): Promise<InitialFillProgress> {
  const query = initialFillProgressQuerySchema.safeParse({ impactId, ...(cableId !== undefined && cableId !== null ? { cableId } : {}) });
  if (!query.success || !policyUuidSchema.safeParse(projectId).success || !policyUuidSchema.safeParse(accountId).success || !token || token.length > 16384)
    throw new InitialFillProgressApiError('INVALID_REQUEST', 400, 'Use the current administrator, project and exact impact identifiers.');
  const deadline = pathFinderRequestDeadline(signal, INITIAL_FILL_PROGRESS_READ_MILLISECONDS, () => new InitialFillProgressApiError('REQUEST_TIMEOUT', null, 'Reading initial-fill progress timed out. Refresh to try again.'));
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const suffix = cableId ? `?${new URLSearchParams({ cableId })}` : '';
    const response = await deadline.wait(() => fetch(`${getApiBaseUrl()}/api/projects/${projectId}/pathfinder/initial-fill-progress/${impactId}${suffix}`, {
      method: 'GET', signal: deadline.signal, credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { Authorization: `Bearer ${token}` },
    }), value => discardPathFinderBody(value.body));
    if ([401, 403].includes(response.status)) { discardPathFinderBody(response.body); return failure(response.status, null); }
    reader = response.body?.getReader(); if (!reader) return response.ok ? invalid() : failure(response.status, null);
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) { const chunk = await deadline.wait(() => reader!.read()); if (chunk.done) break; size += chunk.value.byteLength;
      if (size > INITIAL_FILL_PROGRESS_LIMITS.responseBytes) return response.ok ? invalid() : failure(response.status, null); chunks.push(chunk.value); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let value: unknown; try { value = parsePurposeJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes), { maximumBytes: INITIAL_FILL_PROGRESS_LIMITS.responseBytes }); }
    catch { return response.ok ? invalid() : failure(response.status, null); }
    if (!response.ok) return failure(response.status, value); deadline.check(); const parsed = initialFillProgressSchema.safeParse(value);
    return parsed.success && parsed.data.projectId === projectId && parsed.data.actorId === accountId && parsed.data.impactId === impactId
      && (query.data.cableId ? parsed.data.selected?.cableId === query.data.cableId : parsed.data.selected === null) ? parsed.data : invalid();
  } finally { if (reader) releasePathFinderReader(reader); deadline.dispose(); }
}
