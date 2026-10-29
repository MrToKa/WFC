import { digestSha256 } from '../utils/sha256';
import { getApiBaseUrl } from './http';
import { canonicalPurposeJson, parsePurposeJson, policyUuidSchema } from '../../shared/pathfinderPurposePolicy';
import { cableWorkflowPageSchema, classifyCableWorkflow, type CableWorkflowPage, type CableWorkflowRow } from '../../shared/pathfinderCableWorkflow';
import {
  cableWorkflowQuerySchema, cableWorkflowDetailQuerySchema, cableWorkflowDetailSchema,
  cableWorkflowQueryHashInput, cableWorkflowDetailQueryHashInput,
  parseCableWorkflowHttpQuery, parseCableWorkflowDetailHttpQuery, cableWorkflowRowMatchesSearch, CABLE_WORKFLOW_READ_LIMITS,
  type CableWorkflowQuery, type CableWorkflowDetailQuery, type CableWorkflowDetail,
} from '../../shared/pathfinderCableWorkflowQueries';
import { discardPathFinderBody, pathFinderRequestDeadline, releasePathFinderReader } from './pathfinderRequestDeadline';

export type { CableWorkflowPage, CableWorkflowRow, CableWorkflowQuery, CableWorkflowDetailQuery, CableWorkflowDetail };
export const CABLE_WORKFLOW_RESPONSE_BYTES = CABLE_WORKFLOW_READ_LIMITS.responseBytes;
export const CABLE_WORKFLOW_REQUEST_MILLISECONDS = 30_000;
export class PathFinderCableWorkflowApiError extends Error {
  constructor(public readonly code: string, public readonly status: number | null, message: string) { super(message); }
}
const invalid = (): never => { throw new PathFinderCableWorkflowApiError('INVALID_RESPONSE', null, 'Cable diagnostics could not be verified. Refresh the list.'); };
const invalidRequest = (): never => { throw new PathFinderCableWorkflowApiError('INVALID_REQUEST', 400, 'Use the current project, administrator account and supported cable filters.'); };
function refusal(status: number, value: unknown): never {
  const candidate = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>).code : null;
  const code = typeof candidate === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/.exec(candidate)?.[0] === candidate ? candidate : 'CABLE_WORKFLOW_UNAVAILABLE';
  throw new PathFinderCableWorkflowApiError(code, status, status === 401 || status === 403
    ? 'Administrator access is required. Sign in again before continuing.'
    : status === 409 ? 'The project changed. Refresh the cable list before continuing.'
      : status === 404 ? 'This cable or project is unavailable. Refresh the cable list.'
        : 'Cable diagnostics are unavailable. Try refreshing the list.');
}
async function sha256(value: unknown): Promise<string> {
  const digest = await digestSha256(new TextEncoder().encode(canonicalPurposeJson(value)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
async function read<T>(projectId: string, token: string, suffix: string, hashInput: unknown, verify: (value: unknown, queryHash: string) => T, signal?: AbortSignal): Promise<T> {
  if (!policyUuidSchema.safeParse(projectId).success || !token || token.length > 16384) return invalidRequest();
  const deadline = pathFinderRequestDeadline(signal, CABLE_WORKFLOW_REQUEST_MILLISECONDS, () =>
    new PathFinderCableWorkflowApiError('REQUEST_TIMEOUT', null, 'Reading cable diagnostics timed out. Refresh the list to try again.'));
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await deadline.wait(() => fetch(`${getApiBaseUrl()}/api/projects/${projectId}/pathfinder/cable-workflow${suffix}`, {
      method: 'GET', signal: deadline.signal, credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { Authorization: `Bearer ${token}` },
    }), late => discardPathFinderBody(late.body));
    if (response.status === 401 || response.status === 403) { discardPathFinderBody(response.body); return refusal(response.status, null); }
    reader = response.body?.getReader();
    if (!reader) return response.ok ? invalid() : refusal(response.status, null);
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) {
      const next = await deadline.wait(() => reader!.read()); if (next.done) break;
      size += next.value.byteLength;
      if (size > CABLE_WORKFLOW_RESPONSE_BYTES) return response.ok ? invalid() : refusal(response.status, null);
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let value: unknown;
    try { value = parsePurposeJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes), { maximumBytes: CABLE_WORKFLOW_RESPONSE_BYTES }); }
    catch { return response.ok ? invalid() : refusal(response.status, null); }
    if (!response.ok) return refusal(response.status, value);
    const queryHash = await deadline.wait(() => sha256(hashInput));
    deadline.check(); return verify(value, queryHash);
  } finally { if (reader) releasePathFinderReader(reader); deadline.dispose(); }
}
function decimal(value: number): string {
  const text = String(value); if (!text.includes('e')) return text;
  const [mantissa, exponent] = text.split('e'), digits = mantissa.replace('.', ''), point = (mantissa.indexOf('.') < 0 ? mantissa.length : mantissa.indexOf('.')) + Number(exponent);
  return point <= 0 ? `0.${'0'.repeat(-point)}${digits}` : point >= digits.length ? digits + '0'.repeat(point - digits.length) : `${digits.slice(0, point)}.${digits.slice(point)}`;
}
export async function fetchPathFinderCableWorkflowPage(projectId: string, token: string, input: Partial<CableWorkflowQuery> = {}, signal?: AbortSignal): Promise<CableWorkflowPage> {
  const parsed = cableWorkflowQuerySchema.safeParse(input); if (!parsed.success) return invalidRequest();
  if (parsed.data.barrierRouting && parsed.data.barrierRouting.scope.projectId !== projectId) return invalidRequest();
  const query = parsed.data, params = new URLSearchParams({ filter: query.filter, search: query.search, limit: String(query.limit),
    secondaryDistanceMeters: decimal(query.secondaryDistanceMeters), preferVerticalApproach: String(query.preferVerticalApproach) });
  if (query.cursor !== undefined) params.set('cursor', query.cursor);
  if (query.barrierRouting !== undefined) params.set('barrierRouting', canonicalPurposeJson(query.barrierRouting));
  try { parseCableWorkflowHttpQuery(Object.fromEntries(params)); } catch { return invalidRequest(); }
  return read(projectId, token, `?${params}`, cableWorkflowQueryHashInput(query), (value, queryHash) => {
    const page = cableWorkflowPageSchema.safeParse(value);
    if (!page.success || page.data.projectId !== projectId || page.data.querySha256 !== queryHash || page.data.rows.length > query.limit
      || page.data.rows.length === query.limit && page.data.scannedThroughCableId !== page.data.rows.at(-1)?.cable.id
      || page.data.nextCursor !== null && page.data.nextCursor === query.cursor
      || page.data.rows.some(row => row.mto === 'MV' || !cableWorkflowRowMatchesSearch(row, query.search) || (query.filter !== 'all' && !(query.filter === 'needs-routing'
        ? ['needs-routing', 'blocked'].includes(classifyCableWorkflow(row).status) : classifyCableWorkflow(row).status === query.filter)))) return invalid();
    return page.data;
  }, signal);
}
export async function fetchPathFinderCableWorkflowDetail(projectId: string, token: string, cableId: string, input: Partial<CableWorkflowDetailQuery> = {}, signal?: AbortSignal): Promise<CableWorkflowDetail> {
  if (!policyUuidSchema.safeParse(cableId).success) return invalidRequest();
  const parsed = cableWorkflowDetailQuerySchema.safeParse(input); if (!parsed.success) return invalidRequest();
  if (parsed.data.barrierRouting && parsed.data.barrierRouting.scope.projectId !== projectId) return invalidRequest();
  const query = parsed.data, params = new URLSearchParams({ secondaryDistanceMeters: decimal(query.secondaryDistanceMeters), preferVerticalApproach: String(query.preferVerticalApproach) });
  if (query.barrierRouting !== undefined) params.set('barrierRouting', canonicalPurposeJson(query.barrierRouting));
  try { parseCableWorkflowDetailHttpQuery(Object.fromEntries(params)); } catch { return invalidRequest(); }
  return read(projectId, token, `/${cableId}?${params}`, cableWorkflowDetailQueryHashInput(query), (value, queryHash) => {
    const detail = cableWorkflowDetailSchema.safeParse(value);
    return detail.success && detail.data.projectId === projectId && detail.data.cableId === cableId && detail.data.row.cable.id === cableId
      && detail.data.row.projectId === projectId && detail.data.querySha256 === queryHash && detail.data.row.mto !== 'MV' ? detail.data : invalid();
  }, signal);
}
