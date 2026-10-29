import { digestSha256 } from '../utils/sha256';
import { getApiBaseUrl } from './http';
import { pathFinderRequestDeadline, discardPathFinderBody, releasePathFinderReader } from './pathfinderRequestDeadline';
import { canonicalPurposeJson, parsePurposeJson, policyUuidSchema } from '../../shared/pathfinderPurposePolicy';
import { endpointBindingErrorSchema, normalizeEndpointLocation } from '../../shared/pathfinderEndpointBindings';
import {
  MODEL_LOCATION_MATCH_LIMITS, modelLocationMatchContextSchema, modelLocationMatchAssignSchema,
  modelLocationMatchReceiptSchema, modelLocationMatchNamesHashInput,
  type ModelLocationMatchContext, type ModelLocationMatchAssign, type ModelLocationMatchReceipt,
} from '../../shared/pathfinderModelLocationMatch';
export type { ModelLocationMatchContext, ModelLocationMatchAssign, ModelLocationMatchReceipt, ModelLocationMatchResult } from '../../shared/pathfinderModelLocationMatch';

export class ModelLocationMatchApiError extends Error {
  constructor(public readonly code: string, public readonly status: number | null,
    public readonly outcome: 'refused' | 'unknown', message: string) { super(message); }
}
const busyCodes = new Set(['PREFLIGHT_DATABASE_BUSY', 'ENDPOINT_DATABASE_BUSY', 'WORKFLOW_DATABASE_BUSY']);
export function isModelLocationMatchBusy(error: unknown): error is ModelLocationMatchApiError {
  return error instanceof ModelLocationMatchApiError && error.status === 503 && busyCodes.has(error.code);
}
export async function modelLocationMatchHash(value: unknown): Promise<string> {
  const bytes = await digestSha256(new TextEncoder().encode(canonicalPurposeJson(value)));
  return Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('');
}
const invalid = (): never => { throw new ModelLocationMatchApiError('INVALID_RESPONSE', null, 'unknown', 'The location matching response could not be verified. Retain any pending assignment and check its status.'); };
async function request(projectId: string, token: string, command?: ModelLocationMatchAssign, signal?: AbortSignal): Promise<unknown> {
  if (!policyUuidSchema.safeParse(projectId).success || !token || token.length > 16384)
    throw new ModelLocationMatchApiError('INVALID_REQUEST', 400, 'refused', 'Use the current administrator project.');
  const encoded = command === undefined ? undefined : JSON.stringify(modelLocationMatchAssignSchema.parse(command));
  if (encoded && new TextEncoder().encode(encoded).byteLength > MODEL_LOCATION_MATCH_LIMITS.bodyBytes)
    throw new ModelLocationMatchApiError('MATCH_BODY_LIMIT', 413, 'refused', 'The location matching page is too large. No assignment was submitted.');
  const deadline = pathFinderRequestDeadline(signal, 30_000, () => new ModelLocationMatchApiError('REQUEST_TIMEOUT', null, 'unknown', 'The location matching request timed out. Retry the same pending assignment before starting again.'));
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await deadline.wait(() => fetch(`${getApiBaseUrl()}/api/projects/${projectId}/pathfinder/locations/model-match/${command ? 'assign' : 'context'}`, {
      method: command ? 'POST' : 'GET', signal: deadline.signal, cache: 'no-store', redirect: 'error', credentials: 'same-origin',
      headers: { Authorization: `Bearer ${token}`, ...(encoded === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(encoded === undefined ? {} : { body: encoded }),
    }), late => discardPathFinderBody(late.body));
    reader = response.body?.getReader(); if (!reader) return invalid();
    const chunks: Uint8Array[] = []; let length = 0;
    for (;;) { const item = await deadline.wait(() => reader!.read()); if (item.done) break; length += item.value.byteLength;
      if (length > MODEL_LOCATION_MATCH_LIMITS.responseBytes) return invalid(); chunks.push(item.value); }
    const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let value: unknown;
    try { value = parsePurposeJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes), { maximumBytes: MODEL_LOCATION_MATCH_LIMITS.responseBytes }); }
    catch { return invalid(); }
    if (!response.ok) {
      const failure = endpointBindingErrorSchema.safeParse(value);
      const code = failure.success ? failure.data.code : 'MODEL_LOCATION_MATCH_UNAVAILABLE';
      const outcome = failure.success && response.status < 500 && failure.data.outcome === 'refused' ? 'refused' : 'unknown';
      throw new ModelLocationMatchApiError(code, response.status, outcome,
        response.status === 503 && busyCodes.has(code) ? 'The project is temporarily busy. The same saved location assignment is retained.'
          : response.status === 401 || response.status === 403 ? 'Current administrator access is required. Any pending assignment is retained.'
          : response.status === 409 && code === 'ENDPOINT_PREPARATION_REQUIRED'
            ? 'The active model has no valid published routing preparation. In Routes, choose Discover project tray candidates or Retry tray update, then retry Find and assign From/To. '
              + (command ? 'Existing locations are kept. Preserve and reconcile any pending assignment before starting again.' : 'No location assignment was submitted.')
          : response.status === 409 ? 'The project, model or locations changed. Reconcile any pending assignment before finding locations again.'
            : 'Location matching could not be completed. Any pending assignment is retained.');
    }
    return value;
  } finally { if (reader) releasePathFinderReader(reader); deadline.dispose(); }
}
export async function fetchModelLocationMatchContext(projectId: string, token: string, signal?: AbortSignal): Promise<ModelLocationMatchContext> {
  const parsed = modelLocationMatchContextSchema.safeParse(await request(projectId, token, undefined, signal));
  if (!parsed.success || parsed.data.projectId !== projectId
    || await modelLocationMatchHash(modelLocationMatchNamesHashInput(parsed.data.names)) !== parsed.data.namesSha256) return invalid();
  return parsed.data;
}
export async function assignModelLocations(projectId: string, token: string, command: ModelLocationMatchAssign, signal?: AbortSignal): Promise<ModelLocationMatchReceipt> {
  const body = modelLocationMatchAssignSchema.parse(command);
  const parsed = modelLocationMatchReceiptSchema.safeParse(await request(projectId, token, body, signal));
  if (!parsed.success || parsed.data.projectId !== projectId || parsed.data.idempotencyKey !== body.idempotencyKey
    || parsed.data.commandSha256 !== await modelLocationMatchHash(body)
    || BigInt(parsed.data.registryRevision) < BigInt(body.expectedRegistryRevision)
    || canonicalPurposeJson(parsed.data.results.map(item => normalizeEndpointLocation(item.name)).sort()) !== canonicalPurposeJson(body.names.map(normalizeEndpointLocation).sort())) return invalid();
  return parsed.data;
}
