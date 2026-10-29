import { getApiBaseUrl } from './http';
import { policyUuidSchema, policyRevisionSchema, policyErrorSchema, parsePurposeJson } from '../../shared/pathfinderPurposePolicy';
import { drawingPurposePolicySchema, drawingPurposeWriteSchema, drawingPolicySaveSchema, drawingPolicyHistorySchema,
  type DrawingPurposePolicy, type DrawingPurposeWrite, type DrawingPolicySaveReceipt, type DrawingPolicyHistory } from '../../shared/pathfinderDrawingPolicy';
import { fetchRoutingPurposeCatalog, PathFinderPolicyApiError, type CatalogEnvelope } from './pathfinderPolicies';
export type { DrawingPurposePolicy, DrawingPurposeWrite, DrawingPolicySaveReceipt, DrawingPolicyHistory };
export { DEFAULT_DRAWING_MODES, DRAWING_CATEGORY_ORDER, isDefaultDrawingModes } from '../../shared/pathfinderDrawingPolicy';
export type { DrawingCategoryModes } from '../../shared/pathfinderDrawingPolicy';
const MAX_RESPONSE = 4 * 1024 * 1024;
export class DrawingPolicyApiError extends Error {
  constructor(public readonly code: string, public readonly status: number | null, message = 'Cable positioning could not be loaded. Try again.', public readonly confirmedRejection = false) { super(message); }
}
export async function fetchDrawingPurposeCatalog(projectId: string, token: string, signal?: AbortSignal): Promise<CatalogEnvelope> {
  try { return await fetchRoutingPurposeCatalog(projectId, token, signal); }
  catch (error) {
    if (error instanceof PathFinderPolicyApiError) throw new DrawingPolicyApiError(error.code, error.status, 'The tray purpose catalog could not be loaded. Refresh cable positioning.', error.confirmedRejection);
    throw error;
  }
}
async function request(projectId: string, token: string, operation: 'read' | 'save' | 'history', body?: DrawingPurposeWrite, beforeRevision?: string, signal?: AbortSignal): Promise<unknown> {
  if (!policyUuidSchema.safeParse(projectId).success || !token || token.length > 16384 || beforeRevision !== undefined && !policyRevisionSchema.safeParse(beforeRevision).success)
    throw new DrawingPolicyApiError('INVALID_REQUEST', 400, 'A current project and administrator login are required.', true);
  const suffix = operation === 'history' ? '/history?limit=50' + (beforeRevision === undefined ? '' : '&beforeRevision=' + beforeRevision) : '';
  const response = await fetch(`${getApiBaseUrl()}/api/projects/${projectId}/pathfinder/drawing-positioning${suffix}`, {
    method: operation === 'save' ? 'PUT' : 'GET', signal, cache: 'no-store', credentials: 'same-origin', redirect: 'error',
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const reader = response.body?.getReader(); if (!reader) throw new DrawingPolicyApiError('INVALID_RESPONSE', response.status);
  const chunks: Uint8Array[] = []; let bytes = 0;
  try { for (;;) { const item = await reader.read(); if (item.done) break; bytes += item.value.byteLength; if (bytes > MAX_RESPONSE) throw new DrawingPolicyApiError('RESPONSE_LIMIT', response.status); chunks.push(item.value); } }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const joined = new Uint8Array(bytes); let offset = 0; for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  let value: unknown;
  try { value = parsePurposeJson(new TextDecoder('utf-8', { fatal: true }).decode(joined), { maximumBytes: MAX_RESPONSE }); }
  catch { throw new DrawingPolicyApiError('INVALID_RESPONSE', response.status); }
  if (!response.ok) { const error = policyErrorSchema.safeParse(value); if (!error.success) throw new DrawingPolicyApiError('INVALID_RESPONSE', response.status);
    throw new DrawingPolicyApiError(error.data.code, response.status, error.data.message, [400,401,403,404,405,409,413,415].includes(response.status)); }
  return value;
}
export async function fetchDrawingPurposePolicy(projectId: string, token: string, signal?: AbortSignal): Promise<DrawingPurposePolicy> {
  const value = drawingPurposePolicySchema.safeParse(await request(projectId, token, 'read', undefined, undefined, signal));
  if (!value.success || value.data.projectId !== projectId) throw new DrawingPolicyApiError('INVALID_RESPONSE', 502);
  return value.data;
}
export async function saveDrawingPurposePolicy(projectId: string, token: string, body: DrawingPurposeWrite, signal?: AbortSignal): Promise<DrawingPolicySaveReceipt> {
  const input = drawingPurposeWriteSchema.safeParse(body);
  if (!input.success) throw new DrawingPolicyApiError('INVALID_REQUEST', 400, 'Review the cable positioning changes.', true);
  const value = drawingPolicySaveSchema.safeParse(await request(projectId, token, 'save', input.data, undefined, signal));
  if (!value.success || value.data.projectId !== projectId || value.data.domain !== 'drawing') throw new DrawingPolicyApiError('INVALID_RESPONSE', 502);
  return value.data;
}
export async function fetchDrawingPurposeHistory(projectId: string, token: string, beforeRevision?: string, signal?: AbortSignal): Promise<DrawingPolicyHistory> {
  const value = drawingPolicyHistorySchema.safeParse(await request(projectId, token, 'history', undefined, beforeRevision, signal));
  if (!value.success || value.data.projectId !== projectId || value.data.domain !== 'drawing') throw new DrawingPolicyApiError('INVALID_RESPONSE', 502);
  return value.data;
}
