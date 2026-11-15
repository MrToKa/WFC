import { generateId } from '@/utils/generateId';
import { digestSha256 } from '@/utils/sha256';
import { getApiBaseUrl } from './http';
import { fetchCableEndpointContext } from './pathfinderCableEndpoints';
import { canonicalPurposeJson, parsePurposeJson } from '../../shared/pathfinderPurposePolicy';
import { endpointRequalifySchema as endpointRequalifyCommandSchema, endpointRequalifyReceiptSchema } from '../../shared/pathfinderEndpointBindings';
import { pathFinderRequestDeadline, releasePathFinderReader } from './pathfinderRequestDeadline';

type Model = { modelVersionId: string | null; contentFingerprint: string | null; selectionRevision: string | null };
const hash = async (value: unknown) => [...new Uint8Array(await digestSha256(new TextEncoder().encode(canonicalPurposeJson(value))))].map(v => v.toString(16).padStart(2, '0')).join('');
export class EndpointRequalificationError extends Error {
  constructor(public readonly code: string) { super('Saved endpoint verification was not confirmed. No calculation was submitted. Retry Calculate routing to check the same endpoint verification.'); }
}
const storageKey = async (projectId: string, token: string, cableId: string) => `wfc.pf.endpoint-requalify.v1:${projectId}:${cableId}:${await hash(token)}`;
export async function hasPendingEndpointRequalification(projectId: string, token: string, cableId: string) { return sessionStorage.getItem(await storageKey(projectId, token, cableId)) !== null; }
/** Only explicit Calculate uses this path. Unknown writes keep their exact key. */
export async function requalifyStaleCableEndpoints(projectId: string, token: string, cableId: string, model: Model, signal: AbortSignal) {
  const key = await storageKey(projectId, token, cableId);
  const retained = sessionStorage.getItem(key);
  let command;
  if (retained) command = endpointRequalifyCommandSchema.parse(parsePurposeJson(retained, { maximumBytes: 65536 }));
  else {
    const contexts = await Promise.all((['from', 'to'] as const).map(end => fetchCableEndpointContext(projectId, token, cableId, end, signal)));
    const context = contexts.find(value => value.head?.mode === 'fixed-world' && value.head.status === 'confirmed' && value.current
      && value.head.modelVersionId === model.modelVersionId && value.current.modelVersionId === model.modelVersionId
      && value.current.contentFingerprint === model.contentFingerprint && value.current.selectionRevision === model.selectionRevision);
    if (!context?.current) return false;
    command = endpointRequalifyCommandSchema.parse({ schemaVersion: 'wfc.pf.endpoint-requalify.v1', cableId, idempotencyKey: generateId(), expectedCurrent: context.current });
    sessionStorage.setItem(key, canonicalPurposeJson(command));
    if (sessionStorage.getItem(key) !== canonicalPurposeJson(command)) throw new EndpointRequalificationError('RETENTION_FAILED');
  }
  if (command.expectedCurrent.modelVersionId !== model.modelVersionId || command.expectedCurrent.contentFingerprint !== model.contentFingerprint || command.expectedCurrent.selectionRevision !== model.selectionRevision) throw new EndpointRequalificationError('MODEL_CHANGED');
  const deadline = pathFinderRequestDeadline(signal, 30000, () => new EndpointRequalificationError('REQUEST_TIMEOUT'));
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await deadline.wait(() => fetch(`${getApiBaseUrl()}/api/projects/${projectId}/pathfinder/endpoint-bindings/requalify`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command), signal: deadline.signal, cache: 'no-store', redirect: 'error', credentials: 'same-origin',
    }));
    reader = response.body?.getReader(); if (!reader) throw new EndpointRequalificationError('INVALID_RESPONSE');
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) { const part = await deadline.wait(() => reader!.read()); if (part.done) break; size += part.value.byteLength; if (size > 65536) throw new EndpointRequalificationError('RESPONSE_LIMIT'); chunks.push(part.value); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const value = parsePurposeJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes), { maximumBytes: 65536 });
    if (!response.ok) {
      const failure = value as { code?: string; outcome?: string };
      if (response.status === 409 && failure.outcome === 'refused' && failure.code === 'ENDPOINT_REQUALIFICATION_CONTEXT_CHANGED' && sessionStorage.getItem(key) === canonicalPurposeJson(command)) sessionStorage.removeItem(key);
      throw new EndpointRequalificationError(failure.code ?? 'REQUALIFICATION_REFUSED');
    }
    const receipt = endpointRequalifyReceiptSchema.parse(value);
    if (receipt.projectId !== projectId || receipt.cableId !== cableId || receipt.idempotencyKey !== command.idempotencyKey || receipt.commandSha256 !== await hash(command)) throw new EndpointRequalificationError('INVALID_RECEIPT');
    if (sessionStorage.getItem(key) !== canonicalPurposeJson(command)) throw new EndpointRequalificationError('RETENTION_CHANGED');
    sessionStorage.removeItem(key); return true;
  } finally { if (reader) releasePathFinderReader(reader); deadline.dispose(); }
}
