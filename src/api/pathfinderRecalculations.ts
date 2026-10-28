import { getApiBaseUrl } from './http';
import { parsePurposeJson, policyUuidSchema } from '../../shared/pathfinderPurposePolicy';
import { recalculationContextSchema, recalculationCommandSchema, recalculationReceiptSchema, recalculationErrorSchema, type RecalculationContext, type RecalculationCommand, type RecalculationReceipt } from '../../shared/pathfinderRecalculation';
export type { RecalculationContext, RecalculationCommand, RecalculationReceipt };

export class RecalculationsApiError extends Error {
  constructor(public readonly code: string, public readonly status: number | null, message: string, public readonly outcome: 'refused' | 'unknown' = 'unknown') { super(message); }
}
const invalid = (): never => { throw new RecalculationsApiError('INVALID_RESPONSE', null, 'The recalculation response could not be verified. Retry the same command before making changes.'); };
async function request(projectId: string, token: string, body: RecalculationCommand | undefined, signal?: AbortSignal): Promise<unknown> {
  if (!policyUuidSchema.safeParse(projectId).success || !token || token.length > 16384) throw new RecalculationsApiError('INVALID_REQUEST', 400, 'Use the current project and account.', 'refused');
  const command = body === undefined ? null : recalculationCommandSchema.safeParse(body);
  if (command && !command.success) throw new RecalculationsApiError('INVALID_REQUEST', 400, 'Review the recalculation command before enabling it.', 'refused');
  const encoded = command?.success ? JSON.stringify(command.data) : undefined;
  if (encoded && new TextEncoder().encode(encoded).byteLength > 65536) throw new RecalculationsApiError('BODY_LIMIT', 413, 'The recalculation command is too large.', 'refused');
  const response = await fetch(`${getApiBaseUrl()}/api/projects/${projectId}/pathfinder/recalculations/${body === undefined ? 'context' : 'commands'}`, {
    method: body === undefined ? 'GET' : 'POST', signal, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
    headers: { Authorization: `Bearer ${token}`, ...(encoded ? { 'Content-Type': 'application/json' } : {}) }, ...(encoded ? { body: encoded } : {}),
  });
  const reader = response.body?.getReader(); if (!reader) return invalid();
  const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > 1024 ** 2) { await reader.cancel(); return invalid(); } chunks.push(next.value); } } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let value: unknown; try { value = parsePurposeJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes), { maximumBytes: 1024 ** 2 }); } catch { return invalid(); }
  if (!response.ok) { const error = recalculationErrorSchema.safeParse(value); if (!error.success) return invalid(); throw new RecalculationsApiError(error.data.code, response.status, error.data.message, error.data.outcome); }
  return value;
}
export async function fetchRecalculationContext(projectId: string, token: string, signal?: AbortSignal): Promise<RecalculationContext> {
  const parsed = recalculationContextSchema.safeParse(await request(projectId, token, undefined, signal));
  return parsed.success && parsed.data.projectId === projectId ? parsed.data : invalid();
}
export async function sendRecalculationCommand(projectId: string, token: string, body: RecalculationCommand, signal?: AbortSignal): Promise<RecalculationReceipt> {
  const parsed = recalculationReceiptSchema.safeParse(await request(projectId, token, body, signal));
  if (!parsed.success || parsed.data.context.projectId !== projectId) return invalid();
  if (body.schemaVersion === 'wfc.pf.recalculation-command.v2'
    && (parsed.data.context.automaticPairPolicy?.schemaVersion !== body.automaticPairPolicy.schemaVersion
      || parsed.data.context.automaticPairPolicy?.mode !== body.automaticPairPolicy.mode)) return invalid();
  return parsed.data;
}
