import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import {
  BARRIER_LIMITS, BARRIER_SNAPSHOT_VERSION, barrierCanonicalJson, barrierCaptureCommandSchema, barrierCaptureSchema,
  barrierModelScopeSchema, barrierRegistryCommandSchema, barrierRegistrySchema,
  barrierSnapshotReferenceSchema, barrierSnapshotSchema, verifyBarrierSnapshot,
  type BarrierCapture, type BarrierModelScope, type BarrierRegistry, type BarrierSnapshot,
} from '../../shared/pathfinderBarriers.js';
import { policyHashSchema, policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { assertLoginNotExpired, requireCurrentLogin } from './auth.js';
import type { JobPrincipal } from './jobContracts.js';
import { PathFinderError } from './errors.js';
import { parsePolicyJson } from './policyJson.js';
import { barrierBytesHash, barrierValueHash, encodeBarrierJson, readBarrierBytes, storeBarrierBytes, type BarrierBlob } from './barrierStorage.js';

export type BarrierCaptureCommand = z.infer<typeof barrierCaptureCommandSchema>;
export type BarrierCaptureIntent = {
  id: string; snapshotId: string; captureBlobId: string; manifestBlobId: string;
  command: BarrierCaptureCommand; createdBy: string; loginId: string;
};
export type BarrierQualification = {
  producerVersion: 'wfc.pf.barrier-verifier.v1'; computationalMeshes: number; verificationSha256: string;
};
export type BarrierRegistryAdapters = {
  /** Must read AND lock authoritative current model, prepared capture frame and selection. No client/default frame. */
  currentScope: (client: PoolClient, projectId: string) => Promise<BarrierModelScope>;
  /** Trusted server adapter: establish protected capture intent/SDK closure separately, then run B1 qualification.
   * The pure C# producer alone cannot establish SDK coverage. This callback is never supplied by an HTTP body. */
  qualifyCapture: (input: { intent: Readonly<BarrierCaptureIntent>; capture: Readonly<BarrierCapture>; captureBytes: Buffer; captureSha256: string }, signal: AbortSignal) => Promise<BarrierQualification>;
  /** Internal synchronous expiry fence after all transaction awaits; never a request-body callback. */
  assertBeforeCommit?: () => void;
};
export const BARRIER_REGISTRY_SQL_BOUNDS = Object.freeze({ acquisitionMilliseconds: 5000, lockMilliseconds: 3000, statementMilliseconds: 15000, idleMilliseconds: 30000, leaseMilliseconds: 180000 });
const fail = (code: string, status = 409): never => { throw new PathFinderError(code, status, 'Barrier data is unavailable or changed. Retain the exact command to reconcile an uncertain operation.'); };
const equal = (a: unknown, b: unknown): boolean => barrierCanonicalJson(a) === barrierCanonicalJson(b);
const blobSchema = z.object({ blobId: policyUuidSchema, sha256: policyHashSchema, bytes: z.number().int().positive().max(BARRIER_LIMITS.captureBytes) }).strict();
const intentSchema = z.object({ id: policyUuidSchema, snapshotId: policyUuidSchema, captureBlobId: policyUuidSchema, manifestBlobId: policyUuidSchema,
  command: barrierCaptureCommandSchema, createdBy: policyUuidSchema, loginId: policyUuidSchema }).strict();
const allocationSchema = z.array(z.object({ fragmentId: z.number().int().nonnegative().max(2147483647), blobId: policyUuidSchema }).strict()).max(BARRIER_LIMITS.fragments)
  .refine(values => new Set(values.map(value => value.fragmentId)).size === values.length && new Set(values.map(value => value.blobId)).size === values.length);
const qualificationSchema = z.object({ producerVersion: z.literal('wfc.pf.barrier-verifier.v1'), computationalMeshes: z.number().int().positive().max(BARRIER_LIMITS.computationalMeshes), verificationSha256: policyHashSchema }).strict();
export const barrierPublicationReceiptSchema = z.object({ schemaVersion: z.literal('wfc.pf.barrier-publication-receipt.v1'), snapshot: barrierSnapshotReferenceSchema, duplicate: z.boolean() }).strict();
export const barrierIntentReceiptSchema = z.object({ schemaVersion: z.literal('wfc.pf.barrier-intent-receipt.v1'), intent: intentSchema, state: z.enum(['pending', 'complete']), duplicate: z.boolean() }).strict();
type IntentRow = { id: string; actor_id: string; login_id: string; request_sha256: string; request: unknown; frozen: unknown; state: 'pending' | 'complete'; capture_sha256: string | null; allocation: unknown; lease_token: string | null; lease_expires_at: Date | null };
type SnapshotRow = { id: string; storage_intent_id: string; manifest_blob: unknown; manifest: unknown };
type Receipt = z.infer<typeof barrierPublicationReceiptSchema>;
const reference = (manifest: BarrierSnapshot) => barrierSnapshotReferenceSchema.parse({ snapshotId: manifest.snapshotId, scope: manifest.scope,
  registryRevision: manifest.registryRevision, contentSha256: manifest.contentSha256, mode: manifest.geometry.mode });

async function connectBounded(pool: Pool): Promise<PoolClient> {
  let expired = false, timer: ReturnType<typeof setTimeout> | undefined;
  const pending = pool.connect().then(client => { if (expired) { client.release(); return fail('BARRIER_DATABASE_BUSY', 503); } return client; });
  try { return await Promise.race([pending, new Promise<never>((_, reject) => { timer = setTimeout(() => { expired = true; reject(new PathFinderError('BARRIER_DATABASE_BUSY', 503)); }, BARRIER_REGISTRY_SQL_BOUNDS.acquisitionMilliseconds); })]); }
  finally { if (timer) clearTimeout(timer); }
}
/** Lock project first, then current role/login. These locks and final expiry/cancellation remain through commit. */
export async function barrierRegistryTransaction<T>(pool: Pool, projectId: string, who: JobPrincipal, operation: (client: PoolClient) => Promise<T>, signal?: AbortSignal, assertBeforeCommit?: () => void): Promise<T> {
  policyUuidSchema.parse(projectId); policyUuidSchema.parse(who.userId); policyUuidSchema.parse(who.loginId); assertLoginNotExpired(who); signal?.throwIfAborted();
  const client = await connectBounded(pool); let commitStarted = false, discardConnection = false;
  try {
    await client.query('BEGIN'); await client.query("SET LOCAL lock_timeout='3000ms';SET LOCAL statement_timeout='15000ms';SET LOCAL idle_in_transaction_session_timeout='30000ms'");
    const exists = (await client.query('SELECT id FROM projects WHERE id=$1 FOR NO KEY UPDATE', [projectId])).rows.length === 1;
    const user = (await client.query<{ is_admin: boolean }>('SELECT is_admin FROM users WHERE id=$1 FOR SHARE', [who.userId])).rows[0];
    if (!user) return fail('LOGIN_REVOKED', 401); if (user.is_admin !== true) return fail('ADMIN_REQUIRED', 403);
    await requireCurrentLogin(client, who); if (!exists) return fail('PROJECT_NOT_FOUND', 404);
    signal?.throwIfAborted(); const result = await operation(client); signal?.throwIfAborted(); assertLoginNotExpired(who); assertBeforeCommit?.();
    commitStarted = true; await client.query('COMMIT'); return result;
  } catch (error) {
    discardConnection = commitStarted; try { await client.query('ROLLBACK'); } catch { discardConnection = true; }
    if (commitStarted) return fail('BARRIER_COMMIT_OUTCOME_UNKNOWN', 503);
    if (['55P03', '57014'].includes((error as { code?: string })?.code ?? '')) return fail('BARRIER_DATABASE_BUSY', 503);
    throw error;
  } finally { client.release(discardConnection ? true : undefined); }
}
async function readIntent(client: PoolClient, projectId: string, id: string): Promise<IntentRow> {
  const row = (await client.query<IntentRow>('SELECT id,actor_id,login_id,request_sha256,request,frozen,state,capture_sha256,allocation,lease_token,lease_expires_at FROM pf_barrier_capture_intents WHERE project_id=$1 AND id=$2 FOR UPDATE', [projectId, policyUuidSchema.parse(id)])).rows[0];
  if (!row) return fail('BARRIER_INTENT_NOT_FOUND', 404); return row;
}
function checkedIntent(row: IntentRow, projectId: string, who: JobPrincipal): BarrierCaptureIntent {
  const intent = intentSchema.parse(row.frozen);
  if (intent.id !== row.id || intent.command.scope.projectId !== projectId || intent.createdBy !== row.actor_id || intent.loginId !== row.login_id
    || !equal(row.request, intent.command) || row.request_sha256 !== barrierValueHash(intent.command)) return fail('BARRIER_INTENT_INTEGRITY');
  // A later login cannot take over an admitted SDK capture session.
  if (intent.createdBy !== who.userId || intent.loginId !== who.loginId) return fail('BARRIER_INTENT_AUTHORITY_CHANGED', 403);
  return intent;
}
async function prior(client: PoolClient, projectId: string, who: JobPrincipal, key: string, request: unknown): Promise<Receipt | null> {
  const row = (await client.query<{ request_sha256: string; request: unknown; receipt: unknown }>('SELECT request_sha256,request,receipt FROM pf_barrier_receipts WHERE project_id=$1 AND actor_id=$2 AND idempotency_key=$3', [projectId, who.userId, key])).rows[0];
  if (!row) return null;
  if (row.request_sha256 !== barrierValueHash(request) || !equal(row.request, request)) return fail('BARRIER_IDEMPOTENCY_CONFLICT');
  const receipt = barrierPublicationReceiptSchema.parse({ ...(row.receipt as object), duplicate: true });
  if (receipt.snapshot.scope.projectId !== projectId) return fail('BARRIER_RECEIPT_INTEGRITY');
  const manifest = await checkedSnapshot(projectId, await snapshotRow(client, projectId, receipt.snapshot.snapshotId));
  if (!equal(reference(manifest), receipt.snapshot)) return fail('BARRIER_RECEIPT_INTEGRITY'); return receipt;
}
async function saveReceipt(client: PoolClient, projectId: string, who: JobPrincipal, command: { idempotencyKey: string }, receipt: Receipt): Promise<void> {
  await client.query('INSERT INTO pf_barrier_receipts(project_id,actor_id,idempotency_key,request_sha256,request,receipt) VALUES($1,$2,$3,$4,$5,$6)', [projectId, who.userId, command.idempotencyKey, barrierValueHash(command), command, receipt]);
}
async function head(client: PoolClient, projectId: string): Promise<{ revision: string; snapshot_id: string | null }> {
  const row = (await client.query<{ revision: string; snapshot_id: string | null }>('SELECT revision::text,snapshot_id FROM pf_barrier_heads WHERE project_id=$1 FOR UPDATE', [projectId])).rows[0];
  return row ?? { revision: '0', snapshot_id: null };
}
async function snapshotRow(client: PoolClient, projectId: string, id: string): Promise<SnapshotRow> {
  const row = (await client.query<SnapshotRow>('SELECT id,storage_intent_id,manifest_blob,manifest FROM pf_barrier_snapshots WHERE project_id=$1 AND id=$2', [projectId, policyUuidSchema.parse(id)])).rows[0];
  if (!row) return fail('BARRIER_SNAPSHOT_NOT_FOUND', 404); return row;
}
async function checkedSnapshot(projectId: string, row: SnapshotRow): Promise<BarrierSnapshot> {
  const value = barrierSnapshotSchema.parse(row.manifest), blob = blobSchema.parse(row.manifest_blob);
  if (value.snapshotId !== row.id || value.scope.projectId !== projectId || !verifyBarrierSnapshot(value, text => barrierBytesHash(Buffer.from(text)))) return fail('BARRIER_SNAPSHOT_INTEGRITY');
  const bytes = await readBarrierBytes(projectId, row.storage_intent_id, blob, BARRIER_LIMITS.manifestBytes);
  if (!bytes.equals(encodeBarrierJson(value, BARRIER_LIMITS.manifestBytes))) return fail('BARRIER_SNAPSHOT_INTEGRITY'); return value;
}
function nextRevision(value: string): string {
  const revision = BigInt(value) + 1n; if (revision > 9223372036854775807n) return fail('BARRIER_REVISION_LIMIT', 413); return revision.toString();
}

export function createBarrierRegistryRepository(pool: Pool, adapters: BarrierRegistryAdapters) {
  if (typeof adapters.currentScope !== 'function' || typeof adapters.qualifyCapture !== 'function') throw new TypeError('Trusted barrier scope and qualification adapters are required.');
  const tx = <T>(projectId: string, who: JobPrincipal, operation: (client: PoolClient) => Promise<T>, signal?: AbortSignal, finalAssertion?: () => void) =>
    barrierRegistryTransaction(pool, projectId, who, operation, signal, () => { adapters.assertBeforeCommit?.(); finalAssertion?.(); });
  const authorize = (projectId: string, who: JobPrincipal) => tx(projectId, who, async () => undefined);
  async function current(client: PoolClient, projectId: string, expected?: BarrierModelScope): Promise<BarrierModelScope> {
    const scope = barrierModelScopeSchema.parse(await adapters.currentScope(client, projectId));
    if (scope.projectId !== projectId || expected && !equal(scope, expected)) return fail('BARRIER_MODEL_SCOPE_CHANGED'); return scope;
  }
  const get = (projectId: string, who: JobPrincipal) => tx(projectId, who, async client => {
    const scope = await current(client, projectId), state = await head(client, projectId);
    if (!state.snapshot_id) return barrierRegistrySchema.parse({ schemaVersion: 'wfc.pf.barrier-registry.v1', scope, registryRevision: state.revision, state: 'unconfigured', selectedParents: [], snapshot: null, reasonCodes: ['NO_BARRIER_SCOPE_CONFIGURED'] });
    const manifest = await checkedSnapshot(projectId, await snapshotRow(client, projectId, state.snapshot_id)), matches = equal(scope, manifest.scope) && manifest.registryRevision === state.revision;
    return barrierRegistrySchema.parse({ schemaVersion: 'wfc.pf.barrier-registry.v1', scope, registryRevision: state.revision, state: matches ? 'ready' : 'stale',
      selectedParents: manifest.selectedParents, snapshot: reference(manifest), reasonCodes: matches ? [] : ['BARRIER_MODEL_SCOPE_CHANGED'] });
  });
  const getSnapshot = (projectId: string, who: JobPrincipal, snapshotId: string) => tx(projectId, who, async client => checkedSnapshot(projectId, await snapshotRow(client, projectId, snapshotId)));
  const list = (projectId: string, who: JobPrincipal, options: { offset?: number; limit?: number } = {}) => tx(projectId, who, async client => {
    const { offset, limit } = z.object({ offset: z.number().int().nonnegative().max(1_000_000).default(0), limit: z.number().int().min(1).max(100).default(25) }).strict().parse(options);
    const rows = (await client.query<SnapshotRow>('SELECT id,storage_intent_id,manifest_blob,manifest FROM pf_barrier_snapshots WHERE project_id=$1 ORDER BY registry_revision DESC LIMIT $2 OFFSET $3', [projectId, limit + 1, offset])).rows;
    const snapshots = [];
    for (const row of rows.slice(0, limit)) snapshots.push(reference(await checkedSnapshot(projectId, row)));
    return { schemaVersion: 'wfc.pf.barrier-snapshot-list.v1' as const, projectId, offset, nextOffset: rows.length > limit ? offset + limit : null, snapshots };
  });
  async function begin(projectId: string, who: JobPrincipal, raw: unknown, signal?: AbortSignal) {
    const command = barrierCaptureCommandSchema.parse(raw);
    return tx(projectId, who, async client => {
      await current(client, projectId, command.scope);
      const previous = (await client.query<IntentRow>('SELECT id,actor_id,login_id,request_sha256,request,frozen,state,capture_sha256,allocation,lease_token,lease_expires_at FROM pf_barrier_capture_intents WHERE project_id=$1 AND actor_id=$2 AND idempotency_key=$3 FOR UPDATE', [projectId, who.userId, command.idempotencyKey])).rows[0];
      if (previous) {
        if (previous.request_sha256 !== barrierValueHash(command) || !equal(previous.request, command)) return fail('BARRIER_IDEMPOTENCY_CONFLICT');
        return barrierIntentReceiptSchema.parse({ schemaVersion: 'wfc.pf.barrier-intent-receipt.v1', intent: checkedIntent(previous, projectId, who), state: previous.state, duplicate: true });
      }
      if (await prior(client, projectId, who, command.idempotencyKey, command)) return fail('BARRIER_IDEMPOTENCY_CONFLICT');
      if ((await head(client, projectId)).revision !== command.expectedRegistryRevision) return fail('BARRIER_REGISTRY_REVISION_CHANGED');
      const intent: BarrierCaptureIntent = { id: randomUUID(), snapshotId: randomUUID(), captureBlobId: randomUUID(), manifestBlobId: randomUUID(), command, createdBy: who.userId, loginId: who.loginId };
      await client.query("INSERT INTO pf_barrier_capture_intents(id,project_id,actor_id,login_id,idempotency_key,request_sha256,request,frozen,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'pending')", [intent.id, projectId, who.userId, who.loginId, command.idempotencyKey, barrierValueHash(command), command, intent]);
      return barrierIntentReceiptSchema.parse({ schemaVersion: 'wfc.pf.barrier-intent-receipt.v1', intent, state: 'pending', duplicate: false });
    }, signal);
  }
  async function publish(projectId: string, who: JobPrincipal, intentId: string, rawBytes: Buffer, signal?: AbortSignal): Promise<Receipt> {
    if (!Buffer.isBuffer(rawBytes) || !rawBytes.length || rawBytes.length > BARRIER_LIMITS.captureBytes) return fail('BARRIER_CAPTURE_LIMIT', 413);
    const bytes = Buffer.from(rawBytes), captureSha256 = barrierBytesHash(bytes);
    const capture = barrierCaptureSchema.parse(parsePolicyJson(bytes, { maxBytes: BARRIER_LIMITS.captureBytes }));
    if (capture.observation.state !== 'reported-complete') return fail('BARRIER_CAPTURE_INCOMPLETE');
    const admitted = await tx(projectId, who, async client => {
      const row = await readIntent(client, projectId, intentId), intent = checkedIntent(row, projectId, who), command = intent.command;
      // A viewer-bound replay must refresh its current session/frame deadline too.
      // Historical inspection uses getSnapshot/list; publish never revives a stale capture scope.
      await current(client, projectId, command.scope);
      if (capture.captureId !== intent.id || !equal(capture.scope, command.scope) || !equal(capture.selectedParents, command.selectedParents)) return fail('BARRIER_CAPTURE_SCOPE_CHANGED');
      if (row.capture_sha256 !== null && row.capture_sha256 !== captureSha256) return fail('BARRIER_CAPTURE_CHANGED');
      const replay = await prior(client, projectId, who, command.idempotencyKey, command);
      if (replay) { if (replay.snapshot.snapshotId !== intent.snapshotId) return fail('BARRIER_RECEIPT_INTEGRITY'); return { replay }; }
      if ((await head(client, projectId)).revision !== command.expectedRegistryRevision) return fail('BARRIER_REGISTRY_REVISION_CHANGED');
      if (row.state !== 'pending') return fail('BARRIER_INTENT_INTEGRITY');
      if (row.lease_token && row.lease_expires_at && new Date(row.lease_expires_at).getTime() > Date.now()) return fail('BARRIER_CAPTURE_IN_PROGRESS', 503);
      const allocation = row.allocation === null ? capture.fragments.map(fragment => ({ fragmentId: fragment.source.fragmentId, blobId: randomUUID() })) : allocationSchema.parse(row.allocation);
      if (allocation.length !== capture.fragments.length || allocation.some((item, index) => item.fragmentId !== capture.fragments[index].source.fragmentId)) return fail('BARRIER_CAPTURE_ALLOCATION_INTEGRITY');
      const token = randomUUID();
      // node-postgres serializes JavaScript arrays as PostgreSQL arrays. This is
      // one JSON document, so send explicit JSON text rather than an SQL array.
      await client.query('UPDATE pf_barrier_capture_intents SET capture_sha256=$3,allocation=$4::jsonb,lease_token=$5,lease_expires_at=$6 WHERE project_id=$1 AND id=$2', [projectId, intentId, captureSha256, JSON.stringify(allocation), token, new Date(Date.now() + BARRIER_REGISTRY_SQL_BOUNDS.leaseMilliseconds)]);
      return { intent, allocation, token };
    }, signal);
    if ('replay' in admitted) return barrierPublicationReceiptSchema.parse(admitted.replay);
    const { intent, allocation, token } = admitted, controller = new AbortController(), abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    const timer = setTimeout(abort, BARRIER_REGISTRY_SQL_BOUNDS.leaseMilliseconds - 10000);
    try {
      const captureBlob = await storeBarrierBytes(projectId, intent.id, intent.captureBlobId, bytes, BARRIER_LIMITS.captureBytes); controller.signal.throwIfAborted();
      const qualification = qualificationSchema.parse(await adapters.qualifyCapture({ intent: intentSchema.parse(intent), capture: barrierCaptureSchema.parse(capture), captureBytes: Buffer.from(bytes), captureSha256 }, controller.signal));
      // Copy original geometry from the parsed observation. A verifier never substitutes or repairs triangles here.
      const fragments: Extract<BarrierSnapshot['geometry'], { mode: 'mesh-set' }>['fragments'] = [];
      for (let index = 0; index < capture.fragments.length; index++) {
        controller.signal.throwIfAborted(); const fragment = capture.fragments[index];
        const mesh = await storeBarrierBytes(projectId, intent.id, allocation[index].blobId, encodeBarrierJson({ verticesMetres: fragment.verticesMetres, triangleIndices: fragment.triangleIndices }));
        fragments.push({ source: fragment.source, bounds: fragment.bounds, mesh, vertices: fragment.verticesMetres.length, triangles: fragment.triangleIndices.length / 3 });
      }
      const body = { schemaVersion: BARRIER_SNAPSHOT_VERSION, snapshotId: intent.snapshotId, scope: capture.scope, registryRevision: nextRevision(intent.command.expectedRegistryRevision), selectedParents: capture.selectedParents,
        capture: { captureId: capture.captureId, payloadSha256: captureSha256 }, geometry: { mode: 'mesh-set' as const, fragments,
          verification: { ...qualification, selectionClosure: 'complete-selected-scope', topology: 'qualified-closed-consistent-two-manifold', selfIntersection: 'bounded-verification-passed', verifiedCaptureSha256: captureSha256 } },
        coverage: 'registered-selected-objects-only', engineeringAccepted: false };
      const manifest = barrierSnapshotSchema.parse({ ...body, contentSha256: barrierValueHash(body) });
      const manifestBlob = await storeBarrierBytes(projectId, intent.id, intent.manifestBlobId, encodeBarrierJson(manifest, BARRIER_LIMITS.manifestBytes), BARRIER_LIMITS.manifestBytes);
      let finalLeaseDeadline: number | null = null;
      return await tx(projectId, who, async client => {
        const row = await readIntent(client, projectId, intentId); checkedIntent(row, projectId, who);
        await current(client, projectId, intent.command.scope);
        const replay = await prior(client, projectId, who, intent.command.idempotencyKey, intent.command); if (replay) return replay;
        const leaseDeadline = row.lease_expires_at ? new Date(row.lease_expires_at).getTime() : NaN;
        if (row.state !== 'pending' || row.lease_token !== token || !Number.isFinite(leaseDeadline) || leaseDeadline <= Date.now()
          || row.capture_sha256 !== captureSha256 || !equal(row.allocation, allocation)) return fail('BARRIER_CAPTURE_LEASE_CHANGED');
        if ((await head(client, projectId)).revision !== intent.command.expectedRegistryRevision) return fail('BARRIER_REGISTRY_REVISION_CHANGED');
        await readBarrierBytes(projectId, intent.id, captureBlob, BARRIER_LIMITS.captureBytes);
        for (const fragment of fragments) { controller.signal.throwIfAborted(); await readBarrierBytes(projectId, intent.id, fragment.mesh); }
        await readBarrierBytes(projectId, intent.id, manifestBlob, BARRIER_LIMITS.manifestBytes);
        if (leaseDeadline <= Date.now()) return fail('BARRIER_CAPTURE_LEASE_CHANGED');
        finalLeaseDeadline = leaseDeadline;
        await publishManifest(client, projectId, who, intent.id, manifest, manifestBlob);
        await client.query("UPDATE pf_barrier_capture_intents SET state='complete' WHERE project_id=$1 AND id=$2 AND lease_token=$3", [projectId, intentId, token]);
        const receipt: Receipt = { schemaVersion: 'wfc.pf.barrier-publication-receipt.v1', snapshot: reference(manifest), duplicate: false };
        await saveReceipt(client, projectId, who, intent.command, receipt); return receipt;
      }, controller.signal, () => { if (finalLeaseDeadline !== null && finalLeaseDeadline <= Date.now()) return fail('BARRIER_CAPTURE_LEASE_CHANGED'); });
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  async function publishManifest(client: PoolClient, projectId: string, who: JobPrincipal, storageIntentId: string, manifest: BarrierSnapshot, manifestBlob: BarrierBlob): Promise<void> {
    await client.query('INSERT INTO pf_barrier_snapshots(id,project_id,model_version_id,registry_revision,storage_intent_id,manifest_blob,manifest,created_by,login_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [manifest.snapshotId, projectId, manifest.scope.modelVersionId, manifest.registryRevision, storageIntentId, manifestBlob, manifest, who.userId, who.loginId]);
    await client.query('INSERT INTO pf_barrier_heads(project_id,revision,snapshot_id) VALUES($1,$2,$3) ON CONFLICT(project_id) DO UPDATE SET revision=EXCLUDED.revision,snapshot_id=EXCLUDED.snapshot_id,updated_at=now()', [projectId, manifest.registryRevision, manifest.snapshotId]);
  }
  async function command(projectId: string, who: JobPrincipal, raw: unknown, signal?: AbortSignal): Promise<Receipt> {
    const request = barrierRegistryCommandSchema.parse(raw);
    return tx(projectId, who, async client => {
      const replay = await prior(client, projectId, who, request.idempotencyKey, request); if (replay) return replay;
      await current(client, projectId, request.scope);
      if ((await head(client, projectId)).revision !== request.expectedRegistryRevision) return fail('BARRIER_REGISTRY_REVISION_CHANGED');
      const pending = (await client.query('SELECT id FROM pf_barrier_capture_intents WHERE project_id=$1 AND actor_id=$2 AND idempotency_key=$3', [projectId, who.userId, request.idempotencyKey])).rows;
      if (pending.length) return fail('BARRIER_IDEMPOTENCY_CONFLICT');
      // Mesh-set manifests contain exact parent memberships. Removing one needs a new protected capture and qualification.
      if (request.action === 'remove') return fail('BARRIER_RECAPTURE_REQUIRED');
      const storageIntentId = randomUUID(), manifestId = randomUUID(), manifestBlobId = randomUUID();
      const body = { schemaVersion: BARRIER_SNAPSHOT_VERSION, snapshotId: manifestId, scope: request.scope, registryRevision: nextRevision(request.expectedRegistryRevision), selectedParents: [], capture: null,
        geometry: { mode: 'explicit-empty', declarationId: randomUUID(), declaration: 'administrator-declared-no-selected-barriers', reason: request.reason }, coverage: 'registered-selected-objects-only', engineeringAccepted: false };
      const manifest = barrierSnapshotSchema.parse({ ...body, contentSha256: barrierValueHash(body) });
      const blob = await storeBarrierBytes(projectId, storageIntentId, manifestBlobId, encodeBarrierJson(manifest, BARRIER_LIMITS.manifestBytes), BARRIER_LIMITS.manifestBytes);
      // The async write has not released the row/authority locks. Recheck the authoritative model/frame before publication.
      await current(client, projectId, request.scope); signal?.throwIfAborted(); assertLoginNotExpired(who);
      await publishManifest(client, projectId, who, storageIntentId, manifest, blob);
      const receipt: Receipt = { schemaVersion: 'wfc.pf.barrier-publication-receipt.v1', snapshot: reference(manifest), duplicate: false };
      await saveReceipt(client, projectId, who, request, receipt); return receipt;
    }, signal);
  }
  return { authorize, get, list, getSnapshot, begin, publish, command };
}
export type BarrierRegistryRepository = ReturnType<typeof createBarrierRegistryRepository>;
export type { BarrierRegistry };
