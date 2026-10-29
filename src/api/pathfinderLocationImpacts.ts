import { getApiBaseUrl } from './http';
import { parsePurposeJson, policyUuidSchema } from '../../shared/pathfinderPurposePolicy';
import { locationImpactPageQuerySchema, locationImpactPageSchema, locationImpactProgressSchema, LOCATION_IMPACT_LIMITS,
  type LocationImpactPage, type LocationImpactPageQuery, type LocationImpactProgress, type LocationImpactSummary, type LocationImpactCalculation } from '../../shared/pathfinderLocationImpacts';
import { discardPathFinderBody, pathFinderRequestDeadline, releasePathFinderReader } from './pathfinderRequestDeadline';

export type { LocationImpactPage, LocationImpactPageQuery, LocationImpactProgress, LocationImpactSummary, LocationImpactCalculation };
export const LOCATION_IMPACT_READ_MILLISECONDS = 30_000;
export class LocationImpactApiError extends Error {
  constructor(public readonly code: string, public readonly status: number | null, message: string) { super(message); }
}
const invalid = (): never => { throw new LocationImpactApiError('INVALID_RESPONSE', null, 'Location recalculation progress could not be verified. Refresh its history.'); };
const invalidRequest = (): never => { throw new LocationImpactApiError('INVALID_REQUEST', 400, 'Use the current administrator, project and bounded impact identifiers.'); };
function failure(status: number, value: unknown): never {
  const candidate = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>).code : null;
  const code = typeof candidate === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/.exec(candidate)?.[0] === candidate ? candidate : 'LOCATION_IMPACT_UNAVAILABLE';
  throw new LocationImpactApiError(code, status, [401, 403].includes(status) ? 'Current administrator access is required. Sign in again to read recalculation progress.'
    : status === 404 ? 'This location impact is unavailable for the current account. Refresh its history.'
      : status === 409 ? 'The impact history changed. Refresh its first page before continuing.' : 'Location recalculation progress is unavailable. Refresh to try again.');
}
async function request<T>(projectId: string, token: string, accountId: string, suffix: string, verify: (value: unknown) => T, signal?: AbortSignal): Promise<T> {
  if (!policyUuidSchema.safeParse(projectId).success || !policyUuidSchema.safeParse(accountId).success || !token || token.length > 16384) return invalidRequest();
  const deadline = pathFinderRequestDeadline(signal, LOCATION_IMPACT_READ_MILLISECONDS, () => new LocationImpactApiError('REQUEST_TIMEOUT', null, 'Reading location recalculation progress timed out. Refresh to try again.'));
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await deadline.wait(() => fetch(`${getApiBaseUrl()}/api/projects/${projectId}/pathfinder/location-impacts${suffix}`, {
      method: 'GET', signal: deadline.signal, credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { Authorization: `Bearer ${token}` },
    }), late => discardPathFinderBody(late.body));
    if ([401, 403].includes(response.status)) { discardPathFinderBody(response.body); return failure(response.status, null); }
    reader = response.body?.getReader(); if (!reader) return response.ok ? invalid() : failure(response.status, null);
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) { const chunk = await deadline.wait(() => reader!.read()); if (chunk.done) break; size += chunk.value.byteLength;
      if (size > LOCATION_IMPACT_LIMITS.recordBytes) return response.ok ? invalid() : failure(response.status, null); chunks.push(chunk.value); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let value: unknown; try { value = parsePurposeJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes), { maximumBytes: LOCATION_IMPACT_LIMITS.recordBytes }); }
    catch { return response.ok ? invalid() : failure(response.status, null); }
    if (!response.ok) return failure(response.status, value);
    deadline.check(); return verify(value);
  } finally { if (reader) releasePathFinderReader(reader); deadline.dispose(); }
}
export function fetchLocationImpacts(projectId: string, token: string, accountId: string, input: LocationImpactPageQuery = {}, signal?: AbortSignal): Promise<LocationImpactPage> {
  const parsed = locationImpactPageQuerySchema.safeParse(input); if (!parsed.success) return Promise.reject(new LocationImpactApiError('INVALID_REQUEST', 400, 'Use a supported impact history cursor and page size.'));
  const query = new URLSearchParams({ limit: String(parsed.data.limit) }); if (parsed.data.beforeId) query.set('beforeId', parsed.data.beforeId);
  return request(projectId, token, accountId, `?${query}`, value => {
    const page = locationImpactPageSchema.safeParse(value);
    return page.success && page.data.projectId === projectId && page.data.impacts.length <= parsed.data.limit
      && page.data.nextBeforeId !== parsed.data.beforeId && page.data.impacts.every((impact, index) => impact.actorId === accountId && impact.id !== parsed.data.beforeId
        && (index === 0 || Date.parse(page.data.impacts[index - 1].createdAt) > Date.parse(impact.createdAt)
          || page.data.impacts[index - 1].createdAt === impact.createdAt && page.data.impacts[index - 1].id > impact.id)) ? page.data : invalid();
  }, signal);
}
export function fetchLocationImpactProgress(projectId: string, token: string, accountId: string, impactId: string, signal?: AbortSignal): Promise<LocationImpactProgress> {
  if (!policyUuidSchema.safeParse(impactId).success) return Promise.reject(new LocationImpactApiError('INVALID_REQUEST', 400, 'Choose an exact location impact identifier.'));
  return request(projectId, token, accountId, `/${impactId}`, value => {
    const progress = locationImpactProgressSchema.safeParse(value);
    return progress.success && progress.data.projectId === projectId && progress.data.impact.id === impactId && progress.data.impact.actorId === accountId ? progress.data : invalid();
  }, signal);
}
