import { digestSha256 } from '../utils/sha256';
import { getApiBaseUrl } from './http';
import { CableEndpointApiError, verifyCableEndpointReceipt } from './pathfinderCableEndpoints';
import { canonicalPurposeJson, parsePurposeJson, policyUuidSchema } from '../../shared/pathfinderPurposePolicy';
import { CABLE_ENDPOINT_PAIR_LIMITS, cableEndpointPairCommandSchema, cableEndpointPairCommandHashInput,
  cableEndpointPairReceiptSchema, cableEndpointPairRecoverySchema,
  type CableEndpointPairCommand, type CableEndpointPairReceipt, type CableEndpointPairRecovery } from '../../shared/pathfinderCableEndpointPair';
import { cableEndpointErrorSchema } from '../../shared/pathfinderCableEndpoints';
import { discardPathFinderBody, pathFinderRequestDeadline, releasePathFinderReader } from './pathfinderRequestDeadline';

export type { CableEndpointPairCommand, CableEndpointPairReceipt, CableEndpointPairRecovery };
const invalid = (): never => { throw new CableEndpointApiError('INVALID_RESPONSE', null, 'The endpoint Save could not be verified. Retain the pending Save and check it again.'); };
const refuse = (): never => { throw new CableEndpointApiError('INVALID_REQUEST', 400, 'Use the current cable and both endpoint contexts before saving.', 'refused'); };
const equal = (left: unknown, right: unknown) => canonicalPurposeJson(left) === canonicalPurposeJson(right);
async function commandHash(command: CableEndpointPairCommand) {
  const bytes = new TextEncoder().encode(canonicalPurposeJson(cableEndpointPairCommandHashInput(command)));
  return Array.from(new Uint8Array(await digestSha256(bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}
async function verifyReceipt(value: unknown, projectId: string, cableId: string, command: CableEndpointPairCommand, accountId: string): Promise<CableEndpointPairReceipt> {
  const parsed = cableEndpointPairReceiptSchema.safeParse(value); if (!parsed.success) return invalid();
  const receipt = parsed.data;
  if (receipt.projectId !== projectId || receipt.actorId !== accountId || receipt.cableId !== cableId
    || receipt.idempotencyKey !== command.idempotencyKey || receipt.commandSha256 !== await commandHash(command)
    || !equal(receipt.expectedContexts, command.expectedContexts)
    || receipt.expectedCableWriteRevision !== command.endpoints[0].command.expectedCableWriteRevision
    || receipt.receipts.length !== command.endpoints.length) return invalid();
  for (let index = 0; index < command.endpoints.length; index++) {
    const entry = command.endpoints[index];
    await verifyCableEndpointReceipt(receipt.receipts[index], projectId, cableId, entry.end, entry.command, accountId);
  }
  return receipt;
}
async function request(projectId: string, token: string, cableId: string, input: CableEndpointPairCommand,
  accountId: string, close: boolean, signal?: AbortSignal): Promise<CableEndpointPairReceipt | CableEndpointPairRecovery> {
  const parsed = cableEndpointPairCommandSchema.safeParse(input);
  if (!parsed.success || ![projectId, cableId, accountId].every(id => policyUuidSchema.safeParse(id).success) || !token || token.length > 16384) return refuse();
  const command = parsed.data, encoded = JSON.stringify(command);
  if (new TextEncoder().encode(encoded).byteLength > CABLE_ENDPOINT_PAIR_LIMITS.controlBytes) return refuse();
  const deadline = pathFinderRequestDeadline(signal, 30000, () => new CableEndpointApiError('REQUEST_TIMEOUT', null, 'Save timed out. Check the exact pending Save before making another assignment.'));
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await deadline.wait(() => fetch(`${getApiBaseUrl()}/api/projects/${projectId}/pathfinder/cable-endpoint-pairs/${cableId}${close ? '/close-pending' : ''}`, {
      method: close ? 'POST' : 'PUT', signal: deadline.signal, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: encoded,
    }), late => discardPathFinderBody(late.body));
    if ([401, 403].includes(response.status)) {
      discardPathFinderBody(response.body);
      throw new CableEndpointApiError('ACCESS_REQUIRED', response.status, 'Current administrator access is required. The pending Save is retained.');
    }
    reader = response.body?.getReader(); if (!reader) return invalid();
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) {
      const part = await deadline.wait(() => reader!.read()); if (part.done) break;
      size += part.value.byteLength; if (size > CABLE_ENDPOINT_PAIR_LIMITS.responseBytes) return invalid(); chunks.push(part.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let value: unknown;
    try { value = parsePurposeJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes), { maximumBytes: CABLE_ENDPOINT_PAIR_LIMITS.responseBytes }); }
    catch { return invalid(); }
    if (!response.ok) {
      const error = cableEndpointErrorSchema.safeParse(value);
      throw new CableEndpointApiError(error.success ? error.data.code : 'SAVE_UNAVAILABLE', response.status,
        'The endpoint Save was not confirmed. Check its pending status before changing the selection.', error.success ? error.data.outcome : 'unknown');
    }
    if (!close) return await deadline.wait(() => verifyReceipt(value, projectId, cableId, command, accountId));
    const recovery = cableEndpointPairRecoverySchema.safeParse(value); if (!recovery.success) return invalid();
    if (recovery.data.status === 'saved') {
      const receipt = recovery.data.receipt;
      await deadline.wait(() => verifyReceipt(receipt, projectId, cableId, command, accountId)); return recovery.data;
    }
    const closure = recovery.data.closure;
    return closure.projectId === projectId && closure.actorId === accountId && closure.cableId === cableId
      && closure.idempotencyKey === command.idempotencyKey && closure.commandSha256 === await deadline.wait(() => commandHash(command))
      && closure.expectedCableWriteRevision === command.endpoints[0].command.expectedCableWriteRevision
      && equal(closure.expectedContexts, command.expectedContexts) ? recovery.data : invalid();
  } finally { if (reader) releasePathFinderReader(reader); deadline.dispose(); }
}
export function saveCableEndpointPair(projectId: string, token: string, cableId: string, command: CableEndpointPairCommand, accountId: string, signal?: AbortSignal) {
  return request(projectId, token, cableId, command, accountId, false, signal) as Promise<CableEndpointPairReceipt>;
}
export function closePendingCableEndpointPair(projectId: string, token: string, cableId: string, command: CableEndpointPairCommand, accountId: string, signal?: AbortSignal) {
  return request(projectId, token, cableId, command, accountId, true, signal) as Promise<CableEndpointPairRecovery>;
}
