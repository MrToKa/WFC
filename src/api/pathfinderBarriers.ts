import { z } from 'zod';
import { getApiBaseUrl } from './http';
import { BARRIER_LIMITS, barrierCaptureCommandSchema, barrierRegistryCommandSchema, barrierRegistrySchema,
  barrierSnapshotReferenceSchema, barrierSnapshotSchema, barrierSnapshotHashInput, barrierCanonicalJson,
  type BarrierRegistry, type BarrierSnapshot } from '../../shared/pathfinderBarriers';
import { parsePurposeJson } from '../../shared/pathfinderPurposePolicy';
import { discardPathFinderBody, pathFinderRequestDeadline, releasePathFinderReader } from './pathfinderRequestDeadline';
import { barrierCaptureOutcomeQuerySchema, barrierCaptureOutcomeSchema, type BarrierCaptureOutcomeQuery } from '../../shared/pathfinderBarrierOutcomes';

const publication = z.object({ schemaVersion: z.literal('wfc.pf.barrier-publication-receipt.v1'), snapshot: barrierSnapshotReferenceSchema, duplicate: z.boolean() }).strict();
const intent = z.object({ id: z.string().uuid(), snapshotId: z.string().uuid(), captureBlobId: z.string().uuid(), manifestBlobId: z.string().uuid(),
  command: barrierCaptureCommandSchema, createdBy: z.string().uuid(), loginId: z.string().uuid() }).strict();
const intentReceipt = z.object({ schemaVersion: z.literal('wfc.pf.barrier-intent-receipt.v1'), intent, state: z.enum(['pending', 'complete']), duplicate: z.boolean() }).strict();
export const BARRIER_READ_MILLISECONDS = 30_000;
const requestError = (code: string, status?: number) => Object.assign(new Error(code), { code, ...(status === undefined ? {} : { status }) });
async function request(projectId: string, token: string, suffix: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
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
    if (total > BARRIER_LIMITS.manifestBytes) throw requestError('BARRIER_RESPONSE_LIMIT', response.ok ? undefined : response.status);
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let value: unknown;
  try { value = parsePurposeJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes), { maximumBytes: BARRIER_LIMITS.manifestBytes }); }
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
    if (snapshot.registryRevision !== ref.registryRevision || snapshot.contentSha256 !== ref.contentSha256
      || snapshot.geometry.mode !== ref.mode || barrierCanonicalJson(snapshot.scope) !== barrierCanonicalJson(ref.scope))
      throw requestError('BARRIER_HISTORY_REFERENCE_CHANGED');
    deadline.check(); return snapshot;
  } finally { deadline.dispose(); }
}
export async function beginBarrierCapture(projectId: string, token: string, command: z.input<typeof barrierCaptureCommandSchema>, signal?: AbortSignal) {
  return intentReceipt.parse(await request(projectId, token, '/intents', barrierCaptureCommandSchema.parse(command), signal));
}
export async function changeBarrierRegistry(projectId: string, token: string, command: z.input<typeof barrierRegistryCommandSchema>, signal?: AbortSignal) {
  return publication.parse(await request(projectId, token, '/commands', barrierRegistryCommandSchema.parse(command), signal));
}
/** Exact historical settlement only. No current Viewer/model or publication
 * endpoint is used, and null never means that a command was refused. */
export async function getBarrierCaptureOutcome(projectId: string, token: string, intentId: string, expected: BarrierCaptureOutcomeQuery, signal?: AbortSignal) {
  z.string().uuid().parse(intentId);
  const query = barrierCaptureOutcomeQuerySchema.parse(expected);
  const search = new URLSearchParams(query).toString();
  return barrierCaptureOutcomeSchema.parse(await request(projectId, token, `/intents/${intentId}/outcome?${search}`, undefined, signal));
}
