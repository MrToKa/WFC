import { digestSha256 } from '../utils/sha256';
import { getApiBaseUrl } from './http';
import { canonicalPurposeJson, parsePurposeJson, policyHashSchema, policyUuidSchema } from '../../shared/pathfinderPurposePolicy';
import { endpointBindingContentHashInput } from '../../shared/pathfinderEndpointBindings';
import {
  CABLE_ENDPOINT_LIMITS, cableEndpointEndSchema, cableEndpointSdkObjectIdSchema, cableEndpointCommandSchema,
  cableEndpointContextSchema, cableEndpointContextHashInput, cableEndpointSelectionResponseSchema, cableEndpointReceiptSchema, cableEndpointErrorSchema, cableEndpointRecoverySchema,
  type CableEndpointContext, type CableEndpointCommand, type CableEndpointSelectionResponse, type CableEndpointReceipt, type CableEndpointRecovery,
} from '../../shared/pathfinderCableEndpoints';
import { discardPathFinderBody, pathFinderRequestDeadline, releasePathFinderReader } from './pathfinderRequestDeadline';

export type { CableEndpointContext, CableEndpointCommand, CableEndpointSelectionResponse, CableEndpointReceipt, CableEndpointRecovery };
export type CableEndpointEnd = 'from' | 'to';
export const CABLE_ENDPOINT_REQUEST_MILLISECONDS = 30_000;
export class CableEndpointApiError extends Error {
  constructor(public readonly code: string, public readonly status: number | null,
    message: string, public readonly outcome: 'refused' | 'unknown' = 'unknown') { super(message); }
}
const invalid = (): never => { throw new CableEndpointApiError('INVALID_RESPONSE', null, 'Endpoint evidence could not be verified. Retain any pending save and refresh its status.'); };
const invalidRequest = (): never => { throw new CableEndpointApiError('INVALID_REQUEST', 400, 'Use the current cable, endpoint, model and administrator account.', 'refused'); };
const equal = (a: unknown, b: unknown) => canonicalPurposeJson(a) === canonicalPurposeJson(b);
async function sha256(value: unknown): Promise<string> {
  return Array.from(new Uint8Array(await digestSha256(new TextEncoder().encode(canonicalPurposeJson(value)))), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function cableEndpointCommandSha256(value: CableEndpointCommand): Promise<string> { return sha256(cableEndpointCommandSchema.parse(value)); }
function failure(status: number, value: unknown): never {
  const parsed = cableEndpointErrorSchema.safeParse(value), code = parsed.success ? parsed.data.code : 'ENDPOINT_UNAVAILABLE';
  throw new CableEndpointApiError(code, status, status === 401 || status === 403
    ? 'Current administrator access is required. Sign in again; any pending save is retained.'
    : status === 409 ? 'The cable or model changed, or the saved request conflicts. Refresh the endpoint after reconciling any pending save.'
      : status === 404 ? 'This cable endpoint is unavailable. Refresh the current project.'
        : 'The shared endpoint request could not be completed. Retain any pending save and review its status.',
  parsed.success && status !== 401 && status !== 403 ? parsed.data.outcome : 'unknown');
}
async function request<T>(projectId: string, token: string, cableId: string, end: CableEndpointEnd,
  suffix: string, command: CableEndpointCommand | undefined, verify: (value: unknown) => Promise<T>, signal?: AbortSignal, mutationMethod: 'PUT' | 'POST' = 'PUT'): Promise<T> {
  if (!policyUuidSchema.safeParse(projectId).success || !policyUuidSchema.safeParse(cableId).success || !cableEndpointEndSchema.safeParse(end).success || !token || token.length > 16384) return invalidRequest();
  const encoded = command === undefined ? undefined : JSON.stringify(command);
  if (encoded !== undefined && new TextEncoder().encode(encoded).byteLength > CABLE_ENDPOINT_LIMITS.controlBytes) return invalidRequest();
  const deadline = pathFinderRequestDeadline(signal, CABLE_ENDPOINT_REQUEST_MILLISECONDS, () =>
    new CableEndpointApiError('REQUEST_TIMEOUT', null, 'The endpoint request timed out. Reconcile the exact pending save before making changes.'));
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await deadline.wait(() => fetch(`${getApiBaseUrl()}/api/projects/${projectId}/pathfinder/cable-endpoints/${cableId}/${end}${suffix}`, {
      method: command === undefined ? 'GET' : mutationMethod, signal: deadline.signal, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, ...(encoded === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(encoded === undefined ? {} : { body: encoded }),
    }), late => discardPathFinderBody(late.body));
    if ([401, 403].includes(response.status)) { discardPathFinderBody(response.body); return failure(response.status, null); }
    reader = response.body?.getReader(); if (!reader) return response.ok ? invalid() : failure(response.status, null);
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) { const part = await deadline.wait(() => reader!.read()); if (part.done) break; size += part.value.byteLength;
      if (size > CABLE_ENDPOINT_LIMITS.responseBytes) return response.ok ? invalid() : failure(response.status, null); chunks.push(part.value); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let value: unknown; try { value = parsePurposeJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes), { maximumBytes: CABLE_ENDPOINT_LIMITS.responseBytes }); }
    catch { return response.ok ? invalid() : failure(response.status, null); }
    if (!response.ok) return failure(response.status, value);
    return await deadline.wait(() => verify(value));
  } finally { if (reader) releasePathFinderReader(reader); deadline.dispose(); }
}
export function fetchCableEndpointContext(projectId: string, token: string, cableId: string, end: CableEndpointEnd, signal?: AbortSignal): Promise<CableEndpointContext> {
  return request(projectId, token, cableId, end, '', undefined, async value => {
    const parsed = cableEndpointContextSchema.safeParse(value);
    if (!parsed.success || parsed.data.projectId !== projectId || parsed.data.cableId !== cableId || parsed.data.end !== end
      || await sha256(cableEndpointContextHashInput(parsed.data)) !== parsed.data.contextSha256) return invalid();
    if (parsed.data.head && await sha256(endpointBindingContentHashInput(parsed.data.head)) !== parsed.data.head.contentSha256) return invalid();
    return parsed.data;
  }, signal);
}
export function fetchCableEndpointSelection(projectId: string, token: string, context: CableEndpointContext, sdkObjectId: number, signal?: AbortSignal): Promise<CableEndpointSelectionResponse> {
  if (!cableEndpointContextSchema.safeParse(context).success || context.projectId !== projectId || !context.canBind || !context.current
    || !cableEndpointSdkObjectIdSchema.safeParse(sdkObjectId).success || !policyHashSchema.safeParse(context.contextSha256).success) return Promise.reject(new CableEndpointApiError('INVALID_REQUEST', 400, 'Select one object from the current prepared model.', 'refused'));
  return request(projectId, token, context.cableId, context.end, `/selection?${new URLSearchParams({ sdkObjectId: String(sdkObjectId), contextSha256: context.contextSha256 })}`, undefined, async value => {
    const parsed = cableEndpointSelectionResponseSchema.safeParse(value);
    return parsed.success && parsed.data.projectId === projectId && parsed.data.cableId === context.cableId && parsed.data.end === context.end
      && parsed.data.contextSha256 === context.contextSha256 && parsed.data.selection.sdkObjectId === sdkObjectId && equal(parsed.data.selection.current, context.current) ? parsed.data : invalid();
  }, signal);
}
async function verifyReceipt(value: unknown, projectId: string, cableId: string, end: CableEndpointEnd, command: CableEndpointCommand, accountId: string): Promise<CableEndpointReceipt> {
    const receipt = cableEndpointReceiptSchema.safeParse(value); if (!receipt.success) return invalid();
    const result = receipt.data, binding = result.binding.binding, current = command.expectedCurrent;
    if (result.projectId !== projectId || result.cableId !== cableId || result.end !== end || result.logicalName !== command.expectedLogicalName
      || result.idempotencyKey !== command.idempotencyKey || result.commandSha256 !== await cableEndpointCommandSha256(command)
      || result.expectedCableWriteRevision !== command.expectedCableWriteRevision || result.expectedContextSha256 !== command.expectedContextSha256
      || command.expectedLocationId !== null && result.locationId !== command.expectedLocationId || !result.impact.cableIds.includes(cableId)
      || result.actorId !== accountId || binding.status !== 'confirmed'
      || binding.modelVersionId !== current.modelVersionId || binding.aggregateId !== current.aggregateId || binding.artifactId !== current.artifactId
      || binding.projectionSha256 !== current.projectionSha256 || binding.captureFrameId !== current.captureFrameId
      || binding.mode !== command.selection.mode || binding.contentSha256 !== await sha256(endpointBindingContentHashInput(binding))) return invalid();
    if (command.selection.mode === 'object-derived' ? !equal(binding.sourceObject, command.selection.object) || binding.derivation !== 'equipment-bottom-aabb.v1'
      : !equal(binding.pointProjectMetres, command.selection.pointProjectMetres) || binding.derivation !== command.selection.derivation || binding.sourceObject !== null) return invalid();
    if (command.schemaVersion !== 'wfc.pf.cable-endpoint-command.v1'
      ? !result.locationImpact || result.locationImpact.eligibleCables + result.locationImpact.excludedMvCables + result.locationImpact.blockedCategoryCables !== result.impact.distinctCables
        || command.calculation === null && result.locationImpact.status !== 'blocked'
      : result.locationImpact !== undefined) return invalid();
    // The parent receipt binds actor, project and exact command hash above.
    // The minimal mandate reference is a server commitment, not a client grant.
    if (command.schemaVersion === 'wfc.pf.cable-endpoint-command.v3' && command.initialFill !== null
      ? !result.initialFillMandate || result.initialFillMandate.impactId !== result.locationImpact?.id || result.initialFillMandate.mode !== command.initialFill.mode
      : result.initialFillMandate !== undefined) return invalid();
    return result;
}
// Pair receipts retain the identical strict per-endpoint proof.
export { verifyReceipt as verifyCableEndpointReceipt };
export function saveCableEndpoint(projectId: string, token: string, cableId: string, end: CableEndpointEnd, input: CableEndpointCommand, accountId: string, signal?: AbortSignal): Promise<CableEndpointReceipt> {
  const parsed = cableEndpointCommandSchema.safeParse(input);
  if (!parsed.success || !policyUuidSchema.safeParse(accountId).success) return Promise.reject(new CableEndpointApiError('INVALID_REQUEST', 400, 'Review the exact endpoint command before saving.', 'refused'));
  return request(projectId, token, cableId, end, '', parsed.data, value => verifyReceipt(value, projectId, cableId, end, parsed.data, accountId), signal);
}
export function closePendingCableEndpoint(projectId: string, token: string, cableId: string, end: CableEndpointEnd, input: CableEndpointCommand, accountId: string, signal?: AbortSignal): Promise<CableEndpointRecovery> {
  const parsed = cableEndpointCommandSchema.safeParse(input);
  if (!parsed.success || !policyUuidSchema.safeParse(accountId).success) return Promise.reject(new CableEndpointApiError('INVALID_REQUEST', 400, 'Use the exact retained endpoint command for recovery.', 'refused'));
  const command = parsed.data;
  return request(projectId, token, cableId, end, '/close-pending', command, async value => {
    const recovery = cableEndpointRecoverySchema.safeParse(value); if (!recovery.success) return invalid();
    if (recovery.data.status === 'saved') {
      await verifyReceipt(recovery.data.receipt, projectId, cableId, end, command, accountId); return recovery.data;
    }
    const closure = recovery.data.closure;
    return closure.projectId === projectId && closure.cableId === cableId && closure.end === end && closure.actorId === accountId
      && closure.idempotencyKey === command.idempotencyKey && closure.commandSha256 === await cableEndpointCommandSha256(command)
      && closure.expectedContextSha256 === command.expectedContextSha256 && closure.expectedCableWriteRevision === command.expectedCableWriteRevision ? recovery.data : invalid();
  }, signal, 'POST');
}
