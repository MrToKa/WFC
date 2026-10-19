import { getApiBaseUrl } from './http';
import { parsePurposeJson, policyUuidSchema } from '../../shared/pathfinderPurposePolicy';
import { calculationGrantContextSchema, calculationGrantCommandSchema, calculationGrantReceiptSchema, calculationGrantErrorSchema, type CalculationGrantContext, type CalculationGrantCommand, type CalculationGrantReceipt } from '../../shared/pathfinderCalculationGrant';
export type { CalculationGrantContext, CalculationGrantCommand, CalculationGrantReceipt };

export class CalculationGrantsApiError extends Error {
  constructor(public readonly code: string, public readonly status: number | null, message: string, public readonly outcome: 'refused' | 'unknown' = 'unknown') { super(message); }
}
const invalid = (): never => { throw new CalculationGrantsApiError('INVALID_RESPONSE', null, 'The background calculation response could not be verified. Reconcile the same saved command before making changes.'); };
async function request(projectId: string, token: string, input: CalculationGrantCommand | undefined, signal?: AbortSignal): Promise<unknown> {
  if (!policyUuidSchema.safeParse(projectId).success || !token || token.length > 16384) throw new CalculationGrantsApiError('INVALID_REQUEST', 400, 'Use the current project and administrator account.', 'refused');
  const command = input === undefined ? null : calculationGrantCommandSchema.safeParse(input);
  if (command && !command.success) throw new CalculationGrantsApiError('INVALID_REQUEST', 400, 'Review the background calculation settings before saving.', 'refused');
  const encoded = command?.success ? JSON.stringify(command.data) : undefined;
  if (encoded && new TextEncoder().encode(encoded).byteLength > 65536) throw new CalculationGrantsApiError('BODY_LIMIT', 413, 'The background calculation command is too large.', 'refused');
  const response = await fetch(`${getApiBaseUrl()}/api/projects/${projectId}/pathfinder/calculation-grants/${input === undefined ? 'context' : 'commands'}`, {
    method: input === undefined ? 'GET' : 'POST', signal, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
    headers: { Authorization: `Bearer ${token}`, ...(encoded ? { 'Content-Type': 'application/json' } : {}) }, ...(encoded ? { body: encoded } : {}),
  });
  const reader = response.body?.getReader(); if (!reader) return invalid();
  const chunks: Uint8Array[] = []; let bytes = 0;
  try { for (;;) { const item = await reader.read(); if (item.done) break; bytes += item.value.byteLength; if (bytes > 1024 ** 2) { await reader.cancel(); return invalid(); } chunks.push(item.value); } } finally { reader.releaseLock(); }
  const joined = new Uint8Array(bytes); let offset = 0; for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  let value: unknown; try { value = parsePurposeJson(new TextDecoder('utf-8', { fatal: true }).decode(joined), { maximumBytes: 1024 ** 2 }); } catch { return invalid(); }
  if (!response.ok) { const error = calculationGrantErrorSchema.safeParse(value); if (!error.success) return invalid(); throw new CalculationGrantsApiError(error.data.code, response.status, error.data.message, error.data.outcome); }
  return value;
}
export async function fetchCalculationGrantContext(projectId: string, token: string, signal?: AbortSignal): Promise<CalculationGrantContext> {
  const parsed = calculationGrantContextSchema.safeParse(await request(projectId, token, undefined, signal));
  return parsed.success && parsed.data.projectId === projectId ? parsed.data : invalid();
}
export async function sendCalculationGrantCommand(projectId: string, token: string, input: CalculationGrantCommand, signal?: AbortSignal): Promise<CalculationGrantReceipt> {
  const parsed = calculationGrantReceiptSchema.safeParse(await request(projectId, token, input, signal));
  return parsed.success && parsed.data.context.projectId === projectId ? parsed.data : invalid();
}
