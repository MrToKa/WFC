import {
  policyUuidSchema, policyRevisionSchema, catalogSchema, catalogManifestSchema, catalogPageSchema, routePurposePolicySchema,
  routePurposeWriteSchema, policySaveSchema, policyHistorySchema, policyErrorSchema,
  canonicalPurposeJson, catalogContentHashInput, catalogManifestHashInput, parsePurposeJson,
  type CatalogEnvelope, type RoutingPurposePolicy, type RoutingPurposeWrite,
  type PolicySaveReceipt, type PolicyHistory,
} from '../../shared/pathfinderPurposePolicy';
import { getApiBaseUrl } from './http';

export type { CatalogEnvelope, RoutingPurposePolicy, RoutingPurposeWrite, PolicySaveReceipt, PolicyHistory };
/** Exact Purpose values from the project's Cable types catalog. */
export type RoutingCategory = string;
const MAX_RESPONSE = 4 * 1024 * 1024;
const MAX_CATALOG = 64 * 1024 * 1024;

export class PathFinderPolicyApiError extends Error {
  constructor(public readonly code: string, public readonly status: number | null, message?: string, public readonly confirmedRejection = false) {
    super(message ?? (status === 401 ? 'Sign in again to manage routing permissions.'
      : status === 403 ? 'Routing permissions require current administrator access.'
        : status === 409 ? 'The project changed. Discard these changes and refresh before saving.'
          : 'Routing permissions could not be loaded. Try again.'));
  }
}

function scope(projectId: string, token: string): void {
  if (!policyUuidSchema.safeParse(projectId).success || !token || token.length > 16384) throw new PathFinderPolicyApiError('INVALID_REQUEST', 400, 'A current project and administrator login are required.', true);
}
async function read(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new PathFinderPolicyApiError('INVALID_RESPONSE', response.status);
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      const item = await reader.read(); if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > MAX_RESPONSE) throw new PathFinderPolicyApiError('RESPONSE_LIMIT', response.status);
      chunks.push(item.value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const joined = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  try { return parsePurposeJson(new TextDecoder('utf-8', { fatal: true }).decode(joined), { maximumBytes: MAX_RESPONSE }); }
  catch { throw new PathFinderPolicyApiError('INVALID_RESPONSE', response.status); }
}
async function request(projectId: string, token: string, suffix: string, method: 'GET' | 'PUT', body: unknown, signal?: AbortSignal): Promise<unknown> {
  scope(projectId, token);
  const response = await fetch(`${getApiBaseUrl()}/api/projects/${projectId}/pathfinder${suffix}`, {
    method, signal, cache: 'no-store', credentials: 'same-origin', redirect: 'error',
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = await read(response);
  if (!response.ok) {
    const error = policyErrorSchema.safeParse(value);
    if (!error.success) throw new PathFinderPolicyApiError('INVALID_RESPONSE', response.status);
    throw new PathFinderPolicyApiError(error.data.code, response.status, error.data.message, [400, 401, 403, 404, 409, 413].includes(response.status));
  }
  return value;
}
async function sha256(value: unknown): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new PathFinderPolicyApiError('HASH_UNAVAILABLE', 502, 'Catalog verification is unavailable. Refresh in a secure local browser.');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalPurposeJson(value)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function invalid(): never { throw new PathFinderPolicyApiError('INVALID_RESPONSE', 502); }

/** Complete immutable snapshots only; a partial or mixed-page catalog never reaches the card. */
export async function fetchRoutingPurposeCatalog(projectId: string, token: string, signal?: AbortSignal): Promise<CatalogEnvelope> {
  const first = catalogManifestSchema.safeParse(await request(projectId, token, '/catalog', 'GET', undefined, signal));
  if (!first.success || first.data.catalog.projectId !== projectId) return invalid();
  const manifest = first.data;
  if (await sha256(catalogManifestHashInput(manifest)) !== manifest.manifestSha256) return invalid();
  const rows: CatalogEnvelope['rows'] = []; const ids = new Set<string>(); let totalBytes = 0;
  for (let index = 0; index < manifest.pageCount; index++) {
    const result = catalogPageSchema.safeParse(await request(projectId, token, `/catalog/${manifest.catalog.snapshotId}/pages/${index}`, 'GET', undefined, signal));
    if (!result.success) return invalid();
    const page = result.data;
    if (page.projectId !== projectId || page.snapshotId !== manifest.catalog.snapshotId || page.contentSha256 !== manifest.catalog.contentSha256 || page.pageIndex !== index ||
      page.rowCount !== manifest.catalog.rowCount || page.complete !== (index === manifest.pageCount - 1) || page.rows.length > manifest.pageSize ||
      index < manifest.pageCount - 1 && page.rows.length !== manifest.pageSize) return invalid();
    totalBytes += new TextEncoder().encode(JSON.stringify(page.rows)).byteLength;
    if (totalBytes > MAX_CATALOG || rows.length + page.rows.length > manifest.catalog.rowCount) return invalid();
    for (const row of page.rows) { if (ids.has(row.projectTrayId)) return invalid(); ids.add(row.projectTrayId); rows.push(row); }
  }
  const complete = catalogSchema.safeParse({ ...manifest.catalog, rows });
  if (!complete.success || rows.length !== manifest.catalog.rowCount || await sha256(catalogContentHashInput(complete.data)) !== complete.data.contentSha256) return invalid();
  return complete.data;
}
export async function fetchRoutingPurposePolicy(projectId: string, token: string, signal?: AbortSignal): Promise<RoutingPurposePolicy> {
  const value = routePurposePolicySchema.safeParse(await request(projectId, token, '/routing-permissions', 'GET', undefined, signal));
  if (!value.success || value.data.projectId !== projectId) return invalid();
  return value.data;
}
export async function saveRoutingPurposePolicy(projectId: string, token: string, body: RoutingPurposeWrite, signal?: AbortSignal): Promise<PolicySaveReceipt> {
  const input = routePurposeWriteSchema.safeParse(body);
  if (!input.success) throw new PathFinderPolicyApiError('INVALID_REQUEST', 400, 'Review the routing permission changes.', true);
  const result = policySaveSchema.safeParse(await request(projectId, token, '/routing-permissions', 'PUT', input.data, signal));
  if (!result.success || result.data.projectId !== projectId || result.data.domain !== 'routing') return invalid();
  return result.data;
}
export async function fetchRoutingPurposeHistory(projectId: string, token: string, beforeRevision?: string, signal?: AbortSignal): Promise<PolicyHistory> {
  if (beforeRevision !== undefined && !policyRevisionSchema.safeParse(beforeRevision).success) throw new PathFinderPolicyApiError('INVALID_REQUEST', 400, 'Refresh permission history.', true);
  const suffix = '/routing-permissions/history?limit=50' + (beforeRevision === undefined ? '' : '&beforeRevision=' + beforeRevision);
  const result = policyHistorySchema.safeParse(await request(projectId, token, suffix, 'GET', undefined, signal));
  if (!result.success || result.data.projectId !== projectId || result.data.domain !== 'routing') return invalid();
  return result.data;
}
