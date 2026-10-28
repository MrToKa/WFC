import { getApiBaseUrl } from './http';
import { parsePurposeJson, policyUuidSchema } from '../../shared/pathfinderPurposePolicy';
import {
  REVISION_RESULTS_LIMITS, revisionAdmissionsPageSchema, revisionResultsPageSchema, revisionResultDetailSchema,
  type RevisionAdmissionsPage, type RevisionResultsPage, type RevisionResultDetail,
} from '../../shared/pathfinderRevisionResults';

export type { RevisionAdmissionsPage, RevisionResultsPage, RevisionResultDetail };

export class RevisionResultsApiError extends Error {
  constructor(public readonly code: string, public readonly status: number | null, message: string) { super(message); }
}
const invalid = (): never => { throw new RevisionResultsApiError('INVALID_RESPONSE', null, 'The cable revision results could not be verified. Refresh this calculation scope.'); };
const invalidRequest = (): never => { throw new RevisionResultsApiError('INVALID_REQUEST', 400, 'Use the current project, calculation scope and administrator account.'); };
const uuid = (value: string): string => policyUuidSchema.safeParse(value).success ? value : invalidRequest();
const limit = (value: number | undefined): string => {
  const selected = value ?? REVISION_RESULTS_LIMITS.pageSize;
  return Number.isSafeInteger(selected) && selected >= 1 && selected <= REVISION_RESULTS_LIMITS.pageSize ? String(selected) : invalidRequest();
};
function failure(status: number, value: unknown): never {
  const candidate = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>).code : null;
  const code = typeof candidate === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/.exec(candidate)?.[0] === candidate ? candidate : 'REVISION_RESULTS_UNAVAILABLE';
  throw new RevisionResultsApiError(code, status, status === 401 || status === 403
    ? 'Administrator access is required. Refresh your account before continuing.'
    : status === 404 ? 'This calculation scope is unavailable. Refresh the calculation list.'
      : 'Cable revision results are unavailable. Refresh the same calculation scope.');
}
async function request(projectId: string, token: string, suffix: string, maximumBytes: number, signal?: AbortSignal): Promise<unknown> {
  uuid(projectId); if (!token || token.length > 16384) return invalidRequest();
  const response = await fetch(`${getApiBaseUrl()}/api/projects/${projectId}/pathfinder/revision-results/${suffix}`, {
    method: 'GET', signal, credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { Authorization: `Bearer ${token}` },
  });
  const reader = response.body?.getReader();
  if (!reader) return response.ok ? invalid() : failure(response.status, null);
  const chunks: Uint8Array[] = []; let size = 0;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  try {
    for (;;) {
      signal?.throwIfAborted(); const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > maximumBytes) { await reader.cancel(); return response.ok ? invalid() : failure(response.status, null); }
      chunks.push(next.value);
    }
  } finally { signal?.removeEventListener('abort', cancel); reader.releaseLock(); }
  signal?.throwIfAborted();
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let value: unknown;
  try { value = parsePurposeJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes), { maximumBytes }); }
  catch { return response.ok ? invalid() : failure(response.status, null); }
  if (!response.ok) return failure(response.status, value);
  return value;
}
export async function fetchRevisionAdmissions(projectId: string, token: string, input: { cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<RevisionAdmissionsPage> {
  const query = new URLSearchParams({ limit: limit(input.limit) });
  if (input.cursor !== undefined) {
    if (/^[A-Za-z0-9_-]{1,512}$/.exec(input.cursor)?.[0] !== input.cursor) return invalidRequest();
    query.set('cursor', input.cursor);
  }
  const parsed = revisionAdmissionsPageSchema.safeParse(await request(projectId, token, `admissions?${query}`, REVISION_RESULTS_LIMITS.pageBytes, signal));
  return parsed.success && parsed.data.projectId === projectId && parsed.data.admissions.every(item => item.projectId === projectId) ? parsed.data : invalid();
}
export async function fetchRevisionResultsPage(projectId: string, token: string, admissionId: string, input: { afterCableId?: string; limit?: number } = {}, signal?: AbortSignal): Promise<RevisionResultsPage> {
  uuid(admissionId); const query = new URLSearchParams({ limit: limit(input.limit) });
  if (input.afterCableId !== undefined) query.set('afterCableId', uuid(input.afterCableId));
  const parsed = revisionResultsPageSchema.safeParse(await request(projectId, token, `admissions/${admissionId}/cables?${query}`, REVISION_RESULTS_LIMITS.pageBytes, signal));
  return parsed.success && parsed.data.projectId === projectId && parsed.data.admissionId === admissionId
    && parsed.data.rows.every(row => row.baseline.currentCable.id === row.cableId) ? parsed.data : invalid();
}
export async function fetchRevisionResultDetail(projectId: string, token: string, admissionId: string, cableId: string, signal?: AbortSignal): Promise<RevisionResultDetail> {
  uuid(admissionId); uuid(cableId);
  const parsed = revisionResultDetailSchema.safeParse(await request(projectId, token, `admissions/${admissionId}/cables/${cableId}`, REVISION_RESULTS_LIMITS.detailBytes, signal));
  return parsed.success && parsed.data.projectId === projectId && parsed.data.admissionId === admissionId
    && parsed.data.row.cableId === cableId && parsed.data.row.baseline.currentCable.id === cableId
    && (parsed.data.envelope === null || parsed.data.envelope.engineResultSha256 === parsed.data.row.result?.engineResultSha256
      && parsed.data.envelope.dependencyHash === parsed.data.row.result?.dependencyHash && parsed.data.envelope.ledgerHash === parsed.data.row.result?.ledgerHash) ? parsed.data : invalid();
}
