import { z } from 'zod';
import { getApiBaseUrl } from './http';
import { BARRIER_LIMITS, barrierCanonicalJson } from '../../shared/pathfinderBarriers';
import { supportedBarrierCaptureCommandSchema as barrierCaptureCommandSchema, supportedBarrierRegistryCommandSchema as barrierRegistryCommandSchema,
  supportedBarrierRegistrySchema as barrierRegistrySchema, supportedBarrierSnapshotReferenceSchema as barrierSnapshotReferenceSchema,
  supportedBarrierSnapshotSchema as barrierSnapshotSchema, supportedBarrierSnapshotHashInput as barrierSnapshotHashInput,
  supportedBarrierSnapshotReference, supportedBarrierPublicationReceiptSchema as publication, supportedBarrierIntentReceiptSchema as intentReceipt,
  supportedBarrierCaptureOutcomeSchema as barrierCaptureOutcomeSchema, type AnyBarrierRegistry as BarrierRegistry, type AnyBarrierSnapshot as BarrierSnapshot } from '../../shared/pathfinderBarrierSupported';
import { parsePurposeJson } from '../../shared/pathfinderPurposePolicy';
import { discardPathFinderBody, pathFinderRequestDeadline, releasePathFinderReader } from './pathfinderRequestDeadline';
import { barrierCaptureOutcomeQuerySchema, type BarrierCaptureOutcomeQuery } from '../../shared/pathfinderBarrierOutcomes';
import { barrierCommandCloseSchema, barrierCommandRecoveryResponseSchema, barrierCommandRecoveryTargetSchema,
  BARRIER_RECOVERY_LIMITS, type BarrierCommandRecoveryTarget } from '../../shared/pathfinderBarrierRecovery';
export const BARRIER_READ_MILLISECONDS = 30_000;
const requestError = (code: string, status?: number) => Object.assign(new Error(code), { code, ...(status === undefined ? {} : { status }) });
async function request(projectId: string, token: string, suffix: string, body?: unknown, signal?: AbortSignal, maximumBytes = BARRIER_LIMITS.manifestBytes): Promise<unknown> {
  z.string().uuid().parse(projectId);
  const deadline = pathFinderRequestDeadline(signal, BARRIER_READ_MILLISECONDS, () => requestError('BARRIER_REQUEST_TIMEOUT'));
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
  const response = await deadline.wait(() => fetch(`${getApiBaseUrl()}/api/projects/${projectId}/pathfinder/barriers${suffix}`, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: deadline.signal,
  }), late => discardPathFinderBody(late.body));
  if (response.status === 401 || response.status === 403) {
    discardPathFinderBody(response.body);
    throw requestError(response.status === 401 ? 'LOGIN_REVOKED' : 'ADMIN_REQUIRED', response.status);
  }
  reader = response.body?.getReader();
  if (!reader) throw requestError('BARRIER_RESPONSE_INVALID', response.ok ? undefined : response.status);
  const chunks: Uint8Array[] = []; let total = 0;
  for (;;) {
    const next = await deadline.wait(() => reader!.read()); if (next.done) break;
    total += next.value.byteLength;
    if (total > maximumBytes) throw requestError('BARRIER_RESPONSE_LIMIT', response.ok ? undefined : response.status);
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let value: unknown;
  try { value = parsePurposeJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes), { maximumBytes }); }
  catch { throw requestError('BARRIER_RESPONSE_INVALID', response.ok ? undefined : response.status); }
  if (!response.ok) {
    const code = value && typeof value === 'object' && 'code' in value && typeof value.code === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/.test(value.code)
      ? value.code : 'BARRIER_REQUEST_FAILED';
    throw requestError(code, response.status);
  }
  deadline.check(); return value;
  } finally { if (reader) releasePathFinderReader(reader); deadline.dispose(); }
}
export async function getBarrierRegistry(projectId: string, token: string, signal?: AbortSignal): Promise<BarrierRegistry> {
  return barrierRegistrySchema.parse(await request(projectId, token, '', undefined, signal));
}
/** Read only an immutable server manifest; no geometry or inferred readiness is accepted here. */
export async function getBarrierSnapshot(projectId: string, token: string, snapshotId: string, signal?: AbortSignal): Promise<BarrierSnapshot> {
  z.string().uuid().parse(snapshotId);
  const snapshot = barrierSnapshotSchema.parse(await request(projectId, token, `/snapshots/${snapshotId}`, undefined, signal));
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(barrierCanonicalJson(barrierSnapshotHashInput(snapshot)))))]
    .map(value => value.toString(16).padStart(2, '0')).join('');
  if (signal?.aborted) throw new DOMException('Barrier manifest read cancelled.', 'AbortError');
  if (snapshot.snapshotId !== snapshotId || snapshot.scope.projectId !== projectId || snapshot.contentSha256 !== digest)
    throw new Error('Barrier manifest identity or digest changed.');
  return snapshot;
}
const latestSnapshotList = z.object({ schemaVersion: z.literal('wfc.pf.barrier-snapshot-list.v1'), projectId: z.string().uuid(),
  offset: z.literal(0), nextOffset: z.literal(1).nullable(), snapshots: z.array(barrierSnapshotReferenceSchema).max(1),
}).strict().refine(value => value.snapshots.length > 0 || value.nextOffset === null);
/** Historical display only: one list page and its exact newest manifest. Never
 * scan older snapshots or infer a current registry from this result. */
export async function getLatestBarrierSnapshot(projectId: string, token: string, signal?: AbortSignal): Promise<BarrierSnapshot | null> {
  const deadline = pathFinderRequestDeadline(signal, BARRIER_READ_MILLISECONDS, () => requestError('BARRIER_REQUEST_TIMEOUT'));
  try {
    const page = latestSnapshotList.parse(await deadline.wait(() => request(projectId, token, '/snapshots?limit=1', undefined, deadline.signal)));
    if (page.projectId !== projectId || page.snapshots.some(ref => ref.scope.projectId !== projectId)) throw requestError('BARRIER_HISTORY_SCOPE_CHANGED');
    const ref = page.snapshots[0]; if (!ref) return null;
    const snapshot = await deadline.wait(() => getBarrierSnapshot(projectId, token, ref.snapshotId, deadline.signal));
    if (barrierCanonicalJson(supportedBarrierSnapshotReference(snapshot)) !== barrierCanonicalJson(ref))
      throw requestError('BARRIER_HISTORY_REFERENCE_CHANGED');
    deadline.check(); return snapshot;
  } finally { deadline.dispose(); }
}
export async function beginBarrierCapture(projectId: string, token: string, command: z.input<typeof barrierCaptureCommandSchema>, signal?: AbortSignal) {
  const original = barrierCaptureCommandSchema.parse(command);
  const receipt = intentReceipt.parse(await request(projectId, token, '/intents', original, signal));
  if (barrierCanonicalJson(receipt.intent.command) !== barrierCanonicalJson(original)) throw requestError('BARRIER_INTENT_COMMAND_CHANGED');
  return receipt;
}
export async function changeBarrierRegistry(projectId: string, token: string, command: z.input<typeof barrierRegistryCommandSchema>, signal?: AbortSignal) {
  const original = barrierRegistryCommandSchema.parse(command);
  const receipt = publication.parse(await request(projectId, token, '/commands', original, signal));
  if ((original.schemaVersion === 'wfc.pf.barrier-registry-command.v2') !== (receipt.schemaVersion === 'wfc.pf.barrier-publication-receipt.v2')
    || barrierCanonicalJson(receipt.snapshot.scope) !== barrierCanonicalJson(original.scope)
    || original.action === 'declare-empty' && receipt.snapshot.mode !== 'explicit-empty') throw requestError('BARRIER_PUBLICATION_COMMAND_CHANGED');
  return receipt;
}
/** Exact historical settlement only. No current Viewer/model or publication
 * endpoint is used, and null never means that a command was refused. */
export async function getBarrierCaptureOutcome(projectId: string, token: string, intentId: string, expected: BarrierCaptureOutcomeQuery, signal?: AbortSignal) {
  z.string().uuid().parse(intentId);
  const query = barrierCaptureOutcomeQuerySchema.parse(expected);
  const search = new URLSearchParams(query).toString();
  return barrierCaptureOutcomeSchema.parse(await request(projectId, token, `/intents/${intentId}/outcome?${search}`, undefined, signal));
}

function recoveryTarget(projectId: string, value: BarrierCommandRecoveryTarget) {
  const target = barrierCommandRecoveryTargetSchema.parse(value);
  if (target.projectId !== projectId) throw requestError('BARRIER_RECOVERY_PROJECT_CHANGED');
  return target;
}
/** Historical inspection is authorized by the current project administrator.
 * It never prepares a Viewer, resumes a capture or submits an empty set. */
export async function getBarrierCommandRecovery(projectId: string, token: string, value: BarrierCommandRecoveryTarget, signal?: AbortSignal) {
  const target = recoveryTarget(projectId, value);
  const search = new URLSearchParams({ target: barrierCanonicalJson(target) }).toString();
  // A null transport result is conservative and cannot settle a saved command.
  return barrierCommandRecoveryResponseSchema.nullable().parse(await request(projectId, token, `/recovery/outcome?${search}`, undefined, signal, BARRIER_RECOVERY_LIMITS.responseBytes));
}
/** Close only the exact original command hash. The caller durably retains its
 * original record before this POST and reconciles a lost ACK by inspection. */
export async function closeBarrierCommand(projectId: string, token: string, value: BarrierCommandRecoveryTarget, signal?: AbortSignal) {
  const target = recoveryTarget(projectId, value);
  const command = barrierCommandCloseSchema.parse({ schemaVersion: 'wfc.pf.barrier-command-close.v1', target });
  return barrierCommandRecoveryResponseSchema.parse(await request(projectId, token, '/recovery/close', command, signal, BARRIER_RECOVERY_LIMITS.responseBytes));
}
