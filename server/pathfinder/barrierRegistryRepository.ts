import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import {
  BARRIER_LIMITS, BARRIER_SNAPSHOT_VERSION, barrierCanonicalJson, barrierCaptureCommandSchema, barrierCaptureSchema,
  barrierModelScopeSchema, type BarrierCapture, type BarrierModelScope,
} from '../../shared/pathfinderBarriers.js';
import { MIXED_BARRIER_POLICY, MIXED_BARRIER_VERIFIER_VERSION, mixedBarrierCaptureCommandSchema,
  mixedBarrierComponentMembershipSchema } from '../../shared/pathfinderBarrierMixed.js';
import { supportedBarrierCaptureCommandSchema, supportedBarrierRegistryCommandSchema, supportedBarrierRegistrySchema,
  supportedBarrierSnapshotSchema, supportedBarrierSnapshotReference, verifySupportedBarrierSnapshot,
  supportedBarrierPublicationReceiptSchema, supportedBarrierPublicationOutcomeSchema, mixedBarrierPublishedOutcomeSchema,
  type AnyBarrierRegistry as BarrierRegistry, type AnyBarrierSnapshot as BarrierSnapshot,
  type AnyBarrierPublicationOutcome as BarrierPublicationOutcome, type AnyBarrierCaptureOutcome as BarrierCaptureOutcome,
} from '../../shared/pathfinderBarrierSupported.js';
import { policyHashSchema, policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { BARRIER_RECOVERY_LIMITS, barrierCommandRecoveryTargetSchema, barrierCommandCloseSchema,
  barrierCommandClosureSchema, barrierCommandClosureHashInput, verifyBarrierCommandClosure,
  barrierRecordedCommandSchema, barrierCommandRecoveryResponseSchema, barrierCommandRecoveryTargetHashInput,
  matchBarrierCommandRecovery, type BarrierCommandRecoveryTarget, type BarrierCommandRecoveryResponse,
  type BarrierCommandClosure, type BarrierRecordedCommand } from '../../shared/pathfinderBarrierRecovery.js';
import { assertLoginNotExpired, requireCurrentLogin } from './auth.js';
import type { JobPrincipal } from './jobContracts.js';
import { PathFinderError } from './errors.js';
import { parsePolicyJson } from './policyJson.js';
import { barrierBytesHash, barrierValueHash, encodeBarrierJson, readBarrierBytes, storeBarrierBytes, type BarrierBlob } from './barrierStorage.js';
import { barrierPublicationRefusalReceiptSchema,
  barrierCaptureOutcomeQuerySchema, barrierPublishedOutcomeSchema,
} from '../../shared/pathfinderBarrierOutcomes.js';
export { barrierPublicationReceiptSchema, barrierPublicationRefusalReceiptSchema, barrierPublicationOutcomeSchema,
  barrierCaptureOutcomeQuerySchema, barrierPublishedOutcomeSchema, barrierCaptureOutcomeSchema } from '../../shared/pathfinderBarrierOutcomes.js';
export type { BarrierPublicationRefusalReceipt } from '../../shared/pathfinderBarrierOutcomes.js';
export type { AnyBarrierPublicationOutcome as BarrierPublicationOutcome, AnyBarrierCaptureOutcome as BarrierCaptureOutcome } from '../../shared/pathfinderBarrierSupported.js';

export type BarrierCaptureCommand = z.infer<typeof supportedBarrierCaptureCommandSchema>;
export type BarrierCaptureIntent = {
  id: string; snapshotId: string; captureBlobId: string; manifestBlobId: string;
  command: BarrierCaptureCommand; createdBy: string; loginId: string;
};
export type BarrierQualification = z.infer<typeof qualificationSchema>;
/** Constructed only by the trusted protected-frame qualification adapter. */
export class BarrierCaptureQualificationRefusal extends Error {
  readonly captureSha256: string;
  readonly frameSha256: string;
  readonly implementationSha256: string;
  constructor(captureSha256: string, frameSha256: string, implementationSha256: string) {
    super('The exact protected barrier capture did not qualify as supported barrier geometry.');
    this.captureSha256 = policyHashSchema.parse(captureSha256); this.frameSha256 = policyHashSchema.parse(frameSha256);
    this.implementationSha256 = policyHashSchema.parse(implementationSha256);
  }
}
export type BarrierRegistryAdapters = {
  /** Must read AND lock authoritative current model, prepared capture frame and selection. No client/default frame. */
  currentScope: (client: PoolClient, projectId: string) => Promise<BarrierModelScope>;
  /** Full protected frame observation digest; read only after currentScope locks it. */
  publicationFrameSha256?: () => string;
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
const intentIdentity = { id: policyUuidSchema, snapshotId: policyUuidSchema, captureBlobId: policyUuidSchema, manifestBlobId: policyUuidSchema,
  createdBy: policyUuidSchema, loginId: policyUuidSchema };
// Keep the server's original strict identity syntax independently of client parsers.
const legacyIntentSchema = z.object({ ...intentIdentity, command: barrierCaptureCommandSchema }).strict();
const mixedIntentSchema = z.object({ ...intentIdentity, command: mixedBarrierCaptureCommandSchema }).strict();
const intentSchema = z.union([legacyIntentSchema, mixedIntentSchema]);
const allocationSchema = z.array(z.object({ fragmentId: z.number().int().nonnegative().max(2147483647), blobId: policyUuidSchema }).strict()).max(BARRIER_LIMITS.fragments)
  .refine(values => new Set(values.map(value => value.fragmentId)).size === values.length && new Set(values.map(value => value.blobId)).size === values.length);
const legacyQualificationSchema = z.object({ producerVersion: z.literal('wfc.pf.barrier-verifier.v1'), computationalMeshes: z.number().int().positive().max(BARRIER_LIMITS.computationalMeshes), verificationSha256: policyHashSchema }).strict();
const mixedQualificationSchema = z.object({ producerVersion: z.literal(MIXED_BARRIER_VERIFIER_VERSION), geometryPolicy: z.literal(MIXED_BARRIER_POLICY),
  originalGeometrySha256: policyHashSchema, verificationSha256: policyHashSchema,
  componentMemberships: z.array(mixedBarrierComponentMembershipSchema).min(1).max(BARRIER_LIMITS.computationalMeshes),
  engineeringAccepted: z.literal(false), ownTerminalExemptionsSupported: z.literal(false), authority: z.literal('none') }).strict();
const qualificationSchema = z.union([legacyQualificationSchema, mixedQualificationSchema]);
const intentReceiptState = { state: z.enum(['pending', 'complete']), duplicate: z.boolean() };
export const barrierIntentReceiptSchema = z.union([
  z.object({ schemaVersion: z.literal('wfc.pf.barrier-intent-receipt.v1'), intent: legacyIntentSchema, ...intentReceiptState }).strict(),
  z.object({ schemaVersion: z.literal('wfc.pf.barrier-intent-receipt.v2'), intent: mixedIntentSchema, ...intentReceiptState }).strict(),
]);
type IntentRow = { id: string; actor_id: string; login_id: string; request_sha256: string; request: unknown; frozen: unknown; state: 'pending' | 'complete'; capture_sha256: string | null; allocation: unknown; lease_token: string | null; lease_expires_at: Date | null };
type SnapshotRow = { id: string; storage_intent_id: string; manifest_blob: unknown; manifest: unknown };
type Receipt = z.infer<typeof supportedBarrierPublicationReceiptSchema>;
const reference = supportedBarrierSnapshotReference;
const intentReceipt = (intent: BarrierCaptureIntent, state: 'pending' | 'complete', duplicate: boolean) => barrierIntentReceiptSchema.parse({
  schemaVersion: intent.command.schemaVersion === 'wfc.pf.barrier-capture-command.v2' ? 'wfc.pf.barrier-intent-receipt.v2' : 'wfc.pf.barrier-intent-receipt.v1', intent, state, duplicate });
const publicationReceipt = (manifest: BarrierSnapshot): Receipt => supportedBarrierPublicationReceiptSchema.parse({
  schemaVersion: manifest.schemaVersion === 'wfc.pf.barrier-snapshot.v2' ? 'wfc.pf.barrier-publication-receipt.v2' : 'wfc.pf.barrier-publication-receipt.v1', snapshot: reference(manifest), duplicate: false });

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
function retainedIntent(row: IntentRow, projectId: string): BarrierCaptureIntent {
  const intent = intentSchema.parse(row.frozen);
  if (intent.id !== row.id || intent.command.scope.projectId !== projectId || intent.createdBy !== row.actor_id || intent.loginId !== row.login_id
    || !equal(row.request, intent.command) || row.request_sha256 !== barrierValueHash(intent.command)) return fail('BARRIER_INTENT_INTEGRITY');
  return intent;
}
function checkedIntent(row: IntentRow, projectId: string, who: JobPrincipal): BarrierCaptureIntent {
  const intent = retainedIntent(row, projectId);
  // A later login cannot take over an admitted SDK capture session.
  if (intent.createdBy !== who.userId || intent.loginId !== who.loginId) return fail('BARRIER_INTENT_AUTHORITY_CHANGED', 403);
  return intent;
}
type ClosureRow = { project_id: string; command_sha256: string; id: string; record_sha256: string; record: unknown;
  closed_by: string; login_id: string; closed_at: Date };
function checkedClosure(row: ClosureRow, projectId: string, commandSha256: string): BarrierCommandClosure {
  const parsed = barrierCommandClosureSchema.safeParse(row.record); if (!parsed.success) return fail('BARRIER_RECOVERY_INTEGRITY');
  const value = parsed.data;
  if (!verifyBarrierCommandClosure(value, text => barrierBytesHash(Buffer.from(text))) || row.project_id !== projectId
    || row.command_sha256 !== commandSha256 || value.projectId !== projectId || value.commandSha256 !== commandSha256
    || row.id !== value.closureId || row.record_sha256 !== value.contentSha256 || row.closed_by !== value.closedBy.actorId
    || row.login_id !== value.closedBy.loginId || !Number.isFinite(new Date(row.closed_at).getTime())
    || new Date(row.closed_at).toISOString() !== value.closedAt) return fail('BARRIER_RECOVERY_INTEGRITY');
  return value;
}
function requireRecoveryMatch(target: BarrierCommandRecoveryTarget, response: BarrierCommandRecoveryResponse): void {
  try { matchBarrierCommandRecovery(target, response, text => barrierBytesHash(Buffer.from(text))); }
  catch { return fail('BARRIER_RECOVERY_TARGET_CHANGED'); }
}
async function readClosure(client: PoolClient, projectId: string, commandSha256: string): Promise<BarrierCommandClosure | null> {
  const rows = (await client.query<ClosureRow>(`/* barrier:command-fence */ SELECT project_id,command_sha256,id,record_sha256,closed_by,login_id,closed_at,
    CASE WHEN octet_length(record::text)<=$3 THEN record ELSE NULL END AS record
    FROM pf_barrier_command_closures WHERE project_id=$1 AND command_sha256=$2 LIMIT 2`, [projectId, commandSha256, BARRIER_RECOVERY_LIMITS.responseBytes])).rows;
  if (rows.length > 1) return fail('BARRIER_RECOVERY_INTEGRITY');
  return rows.length ? checkedClosure(rows[0], projectId, commandSha256) : null;
}
/** Denial deliberately ignores lane/kind/owner metadata. A stale worker cannot
 * evade the project+actual-command hash fence by taking a different branch. */
async function requireOpenCommand(client: PoolClient, projectId: string, command: unknown): Promise<void> {
  if (await readClosure(client, projectId, barrierValueHash(command))) return fail('BARRIER_COMMAND_CLOSED');
}
async function prior(client: PoolClient, projectId: string, who: JobPrincipal, key: string, request: unknown): Promise<BarrierPublicationOutcome | null> {
  const row = (await client.query<{ request_sha256: string; request: unknown; receipt: unknown }>('SELECT request_sha256,request,receipt FROM pf_barrier_receipts WHERE project_id=$1 AND actor_id=$2 AND idempotency_key=$3', [projectId, who.userId, key])).rows[0];
  if (!row) return null;
  if (row.request_sha256 !== barrierValueHash(request) || !equal(row.request, request)) return fail('BARRIER_IDEMPOTENCY_CONFLICT');
  if ((row.receipt as { schemaVersion?: unknown } | null)?.schemaVersion === 'wfc.pf.barrier-publication-refusal.v1') {
    const receipt = barrierPublicationRefusalReceiptSchema.parse(row.receipt), command = supportedBarrierCaptureCommandSchema.parse(request);
    const intentRow = await readIntent(client, projectId, receipt.intentId), intent = checkedIntent(intentRow, projectId, who);
    if (!equal(intent.command, command) || receipt.commandSha256 !== row.request_sha256 || intentRow.capture_sha256 !== receipt.captureSha256
      || intentRow.state !== 'pending' || intentRow.lease_token !== null || intentRow.lease_expires_at !== null) return fail('BARRIER_RECEIPT_INTEGRITY');
    return { ...receipt, duplicate: true };
  }
  const storedReceipt = supportedBarrierPublicationReceiptSchema.parse(row.receipt);
  const receipt = { ...storedReceipt, duplicate: true };
  const requestVersion = (request as { schemaVersion?: unknown } | null)?.schemaVersion;
  if ((receipt.schemaVersion === 'wfc.pf.barrier-publication-receipt.v2') !== (requestVersion === 'wfc.pf.barrier-capture-command.v2' || requestVersion === 'wfc.pf.barrier-registry-command.v2')) return fail('BARRIER_RECEIPT_INTEGRITY');
  if (receipt.snapshot.scope.projectId !== projectId) return fail('BARRIER_RECEIPT_INTEGRITY');
  const manifest = await checkedSnapshot(projectId, await snapshotRow(client, projectId, receipt.snapshot.snapshotId));
  if (!equal(reference(manifest), receipt.snapshot)) return fail('BARRIER_RECEIPT_INTEGRITY'); return receipt;
}
async function saveReceipt(client: PoolClient, projectId: string, who: JobPrincipal, command: { idempotencyKey: string }, receipt: BarrierPublicationOutcome): Promise<void> {
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
  const value = supportedBarrierSnapshotSchema.parse(row.manifest), blob = blobSchema.parse(row.manifest_blob);
  if (value.snapshotId !== row.id || value.scope.projectId !== projectId || !verifySupportedBarrierSnapshot(value, text => barrierBytesHash(Buffer.from(text)))) return fail('BARRIER_SNAPSHOT_INTEGRITY');
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
    if (!state.snapshot_id) return supportedBarrierRegistrySchema.parse({ schemaVersion: 'wfc.pf.barrier-registry.v1', scope, registryRevision: state.revision, state: 'unconfigured', selectedParents: [], snapshot: null, reasonCodes: ['NO_BARRIER_SCOPE_CONFIGURED'] });
    const manifest = await checkedSnapshot(projectId, await snapshotRow(client, projectId, state.snapshot_id)), matches = equal(scope, manifest.scope) && manifest.registryRevision === state.revision;
    return supportedBarrierRegistrySchema.parse({ ...(manifest.schemaVersion === 'wfc.pf.barrier-snapshot.v2' ? { schemaVersion: 'wfc.pf.barrier-registry.v2', geometryPolicy: MIXED_BARRIER_POLICY } : { schemaVersion: 'wfc.pf.barrier-registry.v1' }), scope, registryRevision: state.revision, state: matches ? 'ready' : 'stale',
      selectedParents: manifest.selectedParents, snapshot: reference(manifest), reasonCodes: matches ? [] : ['BARRIER_MODEL_SCOPE_CHANGED'] });
  });
  const getSnapshot = (projectId: string, who: JobPrincipal, snapshotId: string) => tx(projectId, who, async client => checkedSnapshot(projectId, await snapshotRow(client, projectId, snapshotId)));
  type RecoveryIntentRow = IntentRow & { idempotency_key: string; allocation_is_null: boolean };
  type RecoveryReceiptRow = { actor_id: string; idempotency_key: string; request_sha256: string; request: unknown; receipt: unknown };
  async function recoveryFacts(client: PoolClient, projectId: string, target: BarrierCommandRecoveryTarget): Promise<{
    original: BarrierRecordedCommand | null; terminal: BarrierCommandRecoveryResponse | null; intentRow: RecoveryIntentRow | null }> {
    const digest = target.commandSha256;
    const receipts = (await client.query<RecoveryReceiptRow>(`/* barrier:recovery-receipts */ SELECT actor_id,idempotency_key,request_sha256,
      CASE WHEN octet_length(request::text)<=$3 THEN request ELSE NULL END AS request,
      CASE WHEN octet_length(receipt::text)<=$3 THEN receipt ELSE NULL END AS receipt
      FROM pf_barrier_receipts WHERE project_id=$1 AND request_sha256=$2 ORDER BY actor_id,idempotency_key LIMIT 2`, [projectId, digest, BARRIER_LIMITS.controlBytes])).rows;
    const intents = (await client.query<RecoveryIntentRow>(`/* barrier:recovery-intents */ SELECT id,actor_id,login_id,idempotency_key,request_sha256,state,capture_sha256,lease_token,lease_expires_at,
      allocation IS NULL AS allocation_is_null,
      CASE WHEN octet_length(allocation::text)<=$4 THEN allocation ELSE NULL END AS allocation,
      CASE WHEN octet_length(request::text)<=$3 THEN request ELSE NULL END AS request,
      CASE WHEN octet_length(frozen::text)<=$3+1024 THEN frozen ELSE NULL END AS frozen
      FROM pf_barrier_capture_intents WHERE project_id=$1 AND request_sha256=$2 ORDER BY id LIMIT 2`, [projectId, digest, BARRIER_LIMITS.controlBytes, BARRIER_LIMITS.fragments * 128])).rows;
    if (receipts.length > 1 || intents.length > 1) return fail('BARRIER_RECOVERY_AMBIGUOUS');
    const closure = await readClosure(client, projectId, digest);
    const common = { schemaVersion: 'wfc.pf.barrier-command-recovery.v1', pendingRecordSha256: target.pendingRecordSha256,
      targetSha256: barrierValueHash(barrierCommandRecoveryTargetHashInput(target)) } as const;
    let original: BarrierRecordedCommand | null = null, storedIntent: BarrierCaptureIntent | null = null;
    const intentRow = intents[0] ?? null, receiptRow = receipts[0] ?? null;
    if (intentRow) {
      storedIntent = retainedIntent(intentRow, projectId);
      if (intentRow.request_sha256 !== digest || intentRow.idempotency_key !== storedIntent.command.idempotencyKey
        || !['pending', 'complete'].includes(intentRow.state) || typeof intentRow.allocation_is_null !== 'boolean'
        || intentRow.allocation_is_null !== (intentRow.allocation === null) || (intentRow.capture_sha256 === null) !== (intentRow.allocation === null)
        || (intentRow.lease_token === null) !== (intentRow.lease_expires_at === null)) return fail('BARRIER_RECOVERY_INTEGRITY');
      if (intentRow.capture_sha256 !== null) { policyHashSchema.parse(intentRow.capture_sha256); if (!allocationSchema.parse(intentRow.allocation).length) return fail('BARRIER_RECOVERY_INTEGRITY'); }
      if (intentRow.lease_token !== null) { policyUuidSchema.parse(intentRow.lease_token); if (!Number.isFinite(new Date(intentRow.lease_expires_at!).getTime())) return fail('BARRIER_RECOVERY_INTEGRITY'); }
      original = barrierRecordedCommandSchema.parse({ commandSha256: digest, scope: storedIntent.command.scope, actorId: storedIntent.createdBy,
        loginId: storedIntent.loginId, expectedRegistryRevision: storedIntent.command.expectedRegistryRevision, kind: 'capture',
        intentId: storedIntent.id, snapshotId: storedIntent.snapshotId, captureSha256: intentRow.capture_sha256,
        commandSchemaVersion: storedIntent.command.schemaVersion,
        ...(storedIntent.command.schemaVersion === 'wfc.pf.barrier-capture-command.v2' ? { geometryPolicy: MIXED_BARRIER_POLICY } : {}) });
    }
    let terminal: BarrierCommandRecoveryResponse | null = null;
    if (receiptRow) {
      policyUuidSchema.parse(receiptRow.actor_id); policyUuidSchema.parse(receiptRow.idempotency_key);
      const request = z.union([supportedBarrierCaptureCommandSchema, supportedBarrierRegistryCommandSchema]).parse(receiptRow.request);
      if (receiptRow.request_sha256 !== digest || barrierValueHash(request) !== digest || request.scope.projectId !== projectId
        || request.idempotencyKey !== receiptRow.idempotency_key) return fail('BARRIER_RECOVERY_INTEGRITY');
      const outcome = supportedBarrierPublicationOutcomeSchema.parse(receiptRow.receipt);
      const captureRequest = request.schemaVersion === 'wfc.pf.barrier-capture-command.v1' || request.schemaVersion === 'wfc.pf.barrier-capture-command.v2';
      if (captureRequest) {
        if (!intentRow || !storedIntent || !original || !equal(request, storedIntent.command) || receiptRow.actor_id !== original.actorId)
          return fail('BARRIER_RECOVERY_INTEGRITY');
        if ('outcome' in outcome) {
          if (outcome.commandSha256 !== digest || outcome.intentId !== storedIntent.id || outcome.captureSha256 !== intentRow.capture_sha256
            || intentRow.state !== 'pending' || intentRow.lease_token !== null || intentRow.lease_expires_at !== null) return fail('BARRIER_RECOVERY_INTEGRITY');
          terminal = barrierCommandRecoveryResponseSchema.parse({ ...common, outcome: 'geometry-refused', original, refusal: { ...outcome, duplicate: true } });
        } else {
          const snapshot = (await client.query<SnapshotRow & { created_by: string; login_id: string }>(`/* barrier:recovery-snapshot */
            SELECT id,storage_intent_id,manifest_blob,created_by,login_id,
            CASE WHEN octet_length(manifest::text)<=$3 THEN manifest ELSE NULL END AS manifest
            FROM pf_barrier_snapshots WHERE project_id=$1 AND id=$2 LIMIT 2`, [projectId, outcome.snapshot.snapshotId, BARRIER_LIMITS.manifestBytes])).rows;
          if (snapshot.length !== 1) return fail('BARRIER_RECOVERY_INTEGRITY');
          const row = snapshot[0], manifest = await checkedSnapshot(projectId, row);
          if (intentRow.state !== 'complete' || row.created_by !== storedIntent.createdBy || row.login_id !== storedIntent.loginId
            || row.storage_intent_id !== storedIntent.id || manifest.snapshotId !== storedIntent.snapshotId
            || !equal(manifest.scope, request.scope) || !equal(manifest.selectedParents, request.selectedParents)
            || manifest.capture?.captureId !== storedIntent.id || manifest.capture.payloadSha256 !== intentRow.capture_sha256
            || !equal(reference(manifest), outcome.snapshot)) return fail('BARRIER_RECOVERY_INTEGRITY');
          terminal = barrierCommandRecoveryResponseSchema.parse({ ...common, outcome: 'published', original,
            publication: { ...outcome, duplicate: true }, frameBinding: 'not-recorded', frameSha256: null });
        }
      } else {
        if (request.action !== 'declare-empty' || intentRow || 'outcome' in outcome) return fail('BARRIER_RECOVERY_INTEGRITY');
        const snapshots = (await client.query<SnapshotRow & { created_by: string; login_id: string }>(`/* barrier:recovery-snapshot */
          SELECT id,storage_intent_id,manifest_blob,created_by,login_id,
          CASE WHEN octet_length(manifest::text)<=$3 THEN manifest ELSE NULL END AS manifest
          FROM pf_barrier_snapshots WHERE project_id=$1 AND id=$2 LIMIT 2`, [projectId, outcome.snapshot.snapshotId, BARRIER_LIMITS.manifestBytes])).rows;
        if (snapshots.length !== 1) return fail('BARRIER_RECOVERY_INTEGRITY');
        const row = snapshots[0], manifest = await checkedSnapshot(projectId, row); policyUuidSchema.parse(row.created_by); policyUuidSchema.parse(row.login_id);
        if (row.created_by !== receiptRow.actor_id || !equal(reference(manifest), outcome.snapshot) || !equal(manifest.scope, request.scope)
          || manifest.geometry.mode !== 'explicit-empty' || manifest.geometry.reason !== request.reason) return fail('BARRIER_RECOVERY_INTEGRITY');
        original = barrierRecordedCommandSchema.parse({ commandSha256: digest, scope: request.scope, actorId: row.created_by, loginId: row.login_id,
          expectedRegistryRevision: request.expectedRegistryRevision, kind: 'declare-empty', snapshotId: manifest.snapshotId,
          commandSchemaVersion: request.schemaVersion, ...(request.schemaVersion === 'wfc.pf.barrier-registry-command.v2' ? { geometryPolicy: MIXED_BARRIER_POLICY } : {}) });
        terminal = barrierCommandRecoveryResponseSchema.parse({ ...common, outcome: 'published', original,
          publication: { ...outcome, duplicate: true }, frameBinding: 'not-recorded', frameSha256: null });
      }
    } else if (intentRow?.state === 'complete') return fail('BARRIER_RECOVERY_INTEGRITY');
    if (closure) {
      if (terminal || (closure.original.state === 'recorded' ? !original || !equal(closure.original.command, original) : original !== null))
        return fail('BARRIER_RECOVERY_CONFLICT');
      terminal = barrierCommandRecoveryResponseSchema.parse({ ...common, outcome: 'closed', closure });
    }
    const response = terminal ?? barrierCommandRecoveryResponseSchema.parse(original ? { ...common, outcome: 'pending', original } : { ...common, outcome: 'not-recorded' });
    // Known owner/intent/capture and original lane constraints are immutable;
    // a current administrator can close, never take over their continuation.
    requireRecoveryMatch(target, response);
    return { original, terminal, intentRow };
  }
  async function readCommandRecovery(projectId: string, who: JobPrincipal, raw: unknown, signal?: AbortSignal): Promise<BarrierCommandRecoveryResponse> {
    const target = barrierCommandRecoveryTargetSchema.parse(raw); if (target.projectId !== projectId) return fail('BARRIER_RECOVERY_PROJECT_CHANGED');
    return barrierRegistryTransaction(pool, projectId, who, async client => {
      const facts = await recoveryFacts(client, projectId, target);
      return facts.terminal ?? barrierCommandRecoveryResponseSchema.parse({ schemaVersion: 'wfc.pf.barrier-command-recovery.v1',
        pendingRecordSha256: target.pendingRecordSha256, targetSha256: barrierValueHash(barrierCommandRecoveryTargetHashInput(target)),
        ...(facts.original ? { outcome: 'pending', original: facts.original } : { outcome: 'not-recorded' }) });
    }, signal);
  }
  async function closeCommand(projectId: string, who: JobPrincipal, raw: unknown, signal?: AbortSignal): Promise<BarrierCommandRecoveryResponse> {
    const { target } = barrierCommandCloseSchema.parse(raw); if (target.projectId !== projectId) return fail('BARRIER_RECOVERY_PROJECT_CHANGED');
    return barrierRegistryTransaction(pool, projectId, who, async client => {
      const facts = await recoveryFacts(client, projectId, target); if (facts.terminal) return facts.terminal;
      if (!facts.original && target.kind !== 'empty' && target.knownIntent !== null) return fail('BARRIER_RECOVERY_ORIGINAL_UNAVAILABLE');
      const body = { schemaVersion: 'wfc.pf.barrier-command-closure.v1', closureId: randomUUID(), projectId, commandSha256: target.commandSha256,
        requestedCommand: { lane: target.pendingRecordVersion === 'wfc.pf.barrier-pending-command.v2' ? 'mixed-v2' : 'legacy-v1',
          kind: target.kind === 'empty' ? 'declare-empty' : 'capture', scope: target.scope },
        original: facts.original ? { state: 'recorded', command: facts.original } : { state: 'not-recorded' }, outcome: 'closed-not-published',
        fence: 'all-command-kinds-and-policy-lanes-by-project-and-command-sha256',
        closedBy: { authority: 'current-project-administrator-close-only', actorId: who.userId, loginId: who.loginId },
        closedAt: new Date().toISOString(), mayResumeCapture: false, mayPublish: false, establishesCurrentFrame: false, grantsCalculation: false };
      const provisional = barrierCommandClosureSchema.parse({ ...body, contentSha256: '0'.repeat(64) });
      const closure = barrierCommandClosureSchema.parse({ ...body, contentSha256: barrierValueHash(barrierCommandClosureHashInput(provisional)) });
      if (facts.intentRow) {
        const cleared = await client.query(`/* barrier:recovery-clear-lease */ UPDATE pf_barrier_capture_intents SET lease_token=NULL,lease_expires_at=NULL
          WHERE project_id=$1 AND id=$2 AND state='pending' RETURNING id`, [projectId, facts.intentRow.id]);
        if (cleared.rows.length !== 1 || cleared.rows[0].id !== facts.intentRow.id) return fail('BARRIER_RECOVERY_INTEGRITY');
      }
      await client.query(`INSERT INTO pf_barrier_command_closures(project_id,command_sha256,id,record_sha256,record,closed_by,login_id,closed_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [projectId, target.commandSha256, closure.closureId, closure.contentSha256, closure, who.userId, who.loginId, closure.closedAt]);
      const response = barrierCommandRecoveryResponseSchema.parse({ schemaVersion: 'wfc.pf.barrier-command-recovery.v1',
        pendingRecordSha256: target.pendingRecordSha256, targetSha256: barrierValueHash(barrierCommandRecoveryTargetHashInput(target)), outcome: 'closed', closure });
      requireRecoveryMatch(target, response); return response;
    }, signal);
  }
  /** Historical exact-command read only. It neither admits capture work nor
   * requires a live Viewer/current model frame. Null cannot settle a lost ACK. */
  async function readCaptureOutcome(projectId: string, who: JobPrincipal, intentId: string, rawQuery: unknown, signal?: AbortSignal): Promise<BarrierCaptureOutcome | null> {
    const expected = barrierCaptureOutcomeQuerySchema.parse(rawQuery);
    return barrierRegistryTransaction(pool, projectId, who, async client => {
      const row = await readIntent(client, projectId, intentId), intent = checkedIntent(row, projectId, who);
      if (barrierValueHash(intent.command) !== expected.commandSha256
        || row.capture_sha256 !== null && row.capture_sha256 !== expected.captureSha256) return fail('BARRIER_CAPTURE_CHANGED');
      const outcome = await prior(client, projectId, who, intent.command.idempotencyKey, intent.command);
      if (!outcome) return null;
      if ('outcome' in outcome) {
        if (outcome.intentId !== intent.id || outcome.captureSha256 !== expected.captureSha256 || outcome.frameSha256 !== expected.frameSha256) return fail('BARRIER_CAPTURE_CHANGED');
        return outcome;
      }
      const manifest = await checkedSnapshot(projectId, await snapshotRow(client, projectId, outcome.snapshot.snapshotId));
      if (row.state !== 'complete' || outcome.snapshot.snapshotId !== intent.snapshotId || !equal(manifest.scope, intent.command.scope)
        || !equal(manifest.selectedParents, intent.command.selectedParents) || manifest.capture?.captureId !== intent.id
        || manifest.capture.payloadSha256 !== expected.captureSha256 || row.capture_sha256 !== expected.captureSha256) return fail('BARRIER_RECEIPT_INTEGRITY');
      const body = { outcome: 'published', intentId: intent.id,
        commandSha256: expected.commandSha256, captureSha256: expected.captureSha256, frameBinding: 'not-recorded', frameSha256: null, publication: outcome };
      return outcome.schemaVersion === 'wfc.pf.barrier-publication-receipt.v2'
        ? mixedBarrierPublishedOutcomeSchema.parse({ ...body, schemaVersion: 'wfc.pf.barrier-capture-outcome.v2' })
        : barrierPublishedOutcomeSchema.parse({ ...body, schemaVersion: 'wfc.pf.barrier-capture-outcome.v1' });
    }, signal);
  }
  const list = (projectId: string, who: JobPrincipal, options: { offset?: number; limit?: number } = {}) => tx(projectId, who, async client => {
    const { offset, limit } = z.object({ offset: z.number().int().nonnegative().max(1_000_000).default(0), limit: z.number().int().min(1).max(100).default(25) }).strict().parse(options);
    const rows = (await client.query<SnapshotRow>('SELECT id,storage_intent_id,manifest_blob,manifest FROM pf_barrier_snapshots WHERE project_id=$1 ORDER BY registry_revision DESC LIMIT $2 OFFSET $3', [projectId, limit + 1, offset])).rows;
    const snapshots = [];
    for (const row of rows.slice(0, limit)) snapshots.push(reference(await checkedSnapshot(projectId, row)));
    return { schemaVersion: 'wfc.pf.barrier-snapshot-list.v1' as const, projectId, offset, nextOffset: rows.length > limit ? offset + limit : null, snapshots };
  });
  async function begin(projectId: string, who: JobPrincipal, raw: unknown, signal?: AbortSignal) {
    const command = supportedBarrierCaptureCommandSchema.parse(raw);
    return tx(projectId, who, async client => {
      await requireOpenCommand(client, projectId, command);
      await current(client, projectId, command.scope);
      const previous = (await client.query<IntentRow>('SELECT id,actor_id,login_id,request_sha256,request,frozen,state,capture_sha256,allocation,lease_token,lease_expires_at FROM pf_barrier_capture_intents WHERE project_id=$1 AND actor_id=$2 AND idempotency_key=$3 FOR UPDATE', [projectId, who.userId, command.idempotencyKey])).rows[0];
      if (previous) {
        if (previous.request_sha256 !== barrierValueHash(command) || !equal(previous.request, command)) return fail('BARRIER_IDEMPOTENCY_CONFLICT');
        return intentReceipt(checkedIntent(previous, projectId, who), previous.state, true);
      }
      if (await prior(client, projectId, who, command.idempotencyKey, command)) return fail('BARRIER_IDEMPOTENCY_CONFLICT');
      if ((await head(client, projectId)).revision !== command.expectedRegistryRevision) return fail('BARRIER_REGISTRY_REVISION_CHANGED');
      const intent: BarrierCaptureIntent = { id: randomUUID(), snapshotId: randomUUID(), captureBlobId: randomUUID(), manifestBlobId: randomUUID(), command, createdBy: who.userId, loginId: who.loginId };
      await client.query("INSERT INTO pf_barrier_capture_intents(id,project_id,actor_id,login_id,idempotency_key,request_sha256,request,frozen,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'pending')", [intent.id, projectId, who.userId, who.loginId, command.idempotencyKey, barrierValueHash(command), command, intent]);
      return intentReceipt(intent, 'pending', false);
    }, signal);
  }
  async function publish(projectId: string, who: JobPrincipal, intentId: string, rawBytes: Buffer, signal?: AbortSignal): Promise<BarrierPublicationOutcome> {
    if (!Buffer.isBuffer(rawBytes) || !rawBytes.length || rawBytes.length > BARRIER_LIMITS.captureBytes) return fail('BARRIER_CAPTURE_LIMIT', 413);
    const bytes = Buffer.from(rawBytes), captureSha256 = barrierBytesHash(bytes);
    const capture = barrierCaptureSchema.parse(parsePolicyJson(bytes, { maxBytes: BARRIER_LIMITS.captureBytes }));
    if (capture.observation.state !== 'reported-complete') return fail('BARRIER_CAPTURE_INCOMPLETE');
    const admitted = await tx(projectId, who, async client => {
      const row = await readIntent(client, projectId, intentId), intent = checkedIntent(row, projectId, who), command = intent.command;
      await requireOpenCommand(client, projectId, command);
      // A viewer-bound replay must refresh its current session/frame deadline too.
      // Historical inspection uses getSnapshot/list; publish never revives a stale capture scope.
      await current(client, projectId, command.scope);
      const frameSha256 = adapters.publicationFrameSha256 ? policyHashSchema.parse(adapters.publicationFrameSha256()) : null;
      if (capture.captureId !== intent.id || !equal(capture.scope, command.scope) || !equal(capture.selectedParents, command.selectedParents)) return fail('BARRIER_CAPTURE_SCOPE_CHANGED');
      if (row.capture_sha256 !== null && row.capture_sha256 !== captureSha256) return fail('BARRIER_CAPTURE_CHANGED');
      const replay = await prior(client, projectId, who, command.idempotencyKey, command);
      if (replay) {
        if ('outcome' in replay) { if (replay.intentId !== intent.id || replay.captureSha256 !== captureSha256 || replay.frameSha256 !== frameSha256) return fail('BARRIER_CAPTURE_CHANGED'); }
        else if (replay.snapshot.snapshotId !== intent.snapshotId) return fail('BARRIER_RECEIPT_INTEGRITY');
        return { replay };
      }
      if ((await head(client, projectId)).revision !== command.expectedRegistryRevision) return fail('BARRIER_REGISTRY_REVISION_CHANGED');
      if (row.state !== 'pending') return fail('BARRIER_INTENT_INTEGRITY');
      if (row.lease_token && row.lease_expires_at && new Date(row.lease_expires_at).getTime() > Date.now()) return fail('BARRIER_CAPTURE_IN_PROGRESS', 503);
      const allocation = row.allocation === null ? capture.fragments.map(fragment => ({ fragmentId: fragment.source.fragmentId, blobId: randomUUID() })) : allocationSchema.parse(row.allocation);
      if (allocation.length !== capture.fragments.length || allocation.some((item, index) => item.fragmentId !== capture.fragments[index].source.fragmentId)) return fail('BARRIER_CAPTURE_ALLOCATION_INTEGRITY');
      const token = randomUUID();
      // node-postgres serializes JavaScript arrays as PostgreSQL arrays. This is
      // one JSON document, so send explicit JSON text rather than an SQL array.
      await client.query('UPDATE pf_barrier_capture_intents SET capture_sha256=$3,allocation=$4::jsonb,lease_token=$5,lease_expires_at=$6 WHERE project_id=$1 AND id=$2', [projectId, intentId, captureSha256, JSON.stringify(allocation), token, new Date(Date.now() + BARRIER_REGISTRY_SQL_BOUNDS.leaseMilliseconds)]);
      return { intent, allocation, token, frameSha256 };
    }, signal);
    if ('replay' in admitted) return supportedBarrierPublicationOutcomeSchema.parse(admitted.replay);
    const { intent, allocation, token, frameSha256 } = admitted, controller = new AbortController(), abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    const timer = setTimeout(abort, BARRIER_REGISTRY_SQL_BOUNDS.leaseMilliseconds - 10000);
    try {
      const captureBlob = await storeBarrierBytes(projectId, intent.id, intent.captureBlobId, bytes, BARRIER_LIMITS.captureBytes); controller.signal.throwIfAborted();
      let qualification: BarrierQualification;
      try { qualification = qualificationSchema.parse(await adapters.qualifyCapture({ intent: intentSchema.parse(intent), capture: barrierCaptureSchema.parse(capture), captureBytes: Buffer.from(bytes), captureSha256 }, controller.signal)); }
      catch (error) {
        if (!(error instanceof BarrierCaptureQualificationRefusal)) throw error;
        controller.signal.throwIfAborted();
        if (error.captureSha256 !== captureSha256 || error.frameSha256 !== frameSha256) return fail('BARRIER_VERIFIER_CAPTURE_MISMATCH');
        let refusalLeaseDeadline: number | null = null;
        return await tx(projectId, who, async client => {
          const row = await readIntent(client, projectId, intentId); checkedIntent(row, projectId, who);
          await requireOpenCommand(client, projectId, intent.command);
          // A previously committed publication always wins, even if its COMMIT
          // acknowledgement was lost or this worker's lease later expired.
          const replay = await prior(client, projectId, who, intent.command.idempotencyKey, intent.command);
          if (replay) {
            if ('outcome' in replay && (replay.captureSha256 !== captureSha256 || replay.frameSha256 !== frameSha256)) return fail('BARRIER_CAPTURE_CHANGED');
            if (!('outcome' in replay) && replay.snapshot.snapshotId !== intent.snapshotId) return fail('BARRIER_RECEIPT_INTEGRITY');
            return replay;
          }
          await current(client, projectId, intent.command.scope);
          const deadline = row.lease_expires_at ? new Date(row.lease_expires_at).getTime() : NaN;
          if (row.state !== 'pending' || row.lease_token !== token || row.capture_sha256 !== captureSha256
            || !equal(row.allocation, allocation) || !Number.isFinite(deadline) || deadline <= Date.now()
            || !adapters.publicationFrameSha256 || adapters.publicationFrameSha256() !== frameSha256) return fail('BARRIER_CAPTURE_LEASE_CHANGED');
          await readBarrierBytes(projectId, intent.id, captureBlob, BARRIER_LIMITS.captureBytes);
          if (deadline <= Date.now()) return fail('BARRIER_CAPTURE_LEASE_CHANGED');
          refusalLeaseDeadline = deadline;
          const refusal = barrierPublicationRefusalReceiptSchema.parse({ schemaVersion: 'wfc.pf.barrier-publication-refusal.v1', outcome: 'not-published',
            intentId: intent.id, commandSha256: barrierValueHash(intent.command), captureSha256, frameSha256,
            implementationSha256: error.implementationSha256, reasonCode: 'BARRIER_GEOMETRY_REFUSED', duplicate: false });
          await saveReceipt(client, projectId, who, intent.command, refusal);
          const cleared = await client.query('UPDATE pf_barrier_capture_intents SET lease_token=NULL,lease_expires_at=NULL WHERE project_id=$1 AND id=$2 AND lease_token=$3 RETURNING id', [projectId, intentId, token]);
          if (cleared.rows.length !== 1 || cleared.rows[0].id !== intentId) return fail('BARRIER_CAPTURE_LEASE_CHANGED');
          return refusal;
        }, controller.signal, () => { if (refusalLeaseDeadline !== null && refusalLeaseDeadline <= Date.now()) return fail('BARRIER_CAPTURE_LEASE_CHANGED'); });
      }
      const mixed = intent.command.schemaVersion === 'wfc.pf.barrier-capture-command.v2';
      if (mixed !== (qualification.producerVersion === MIXED_BARRIER_VERIFIER_VERSION)) return fail('BARRIER_VERIFIER_CAPTURE_MISMATCH');
      // Copy original geometry from the parsed observation. A verifier never substitutes or repairs triangles here.
      const fragments: Extract<BarrierSnapshot['geometry'], { mode: 'mesh-set' }>['fragments'] = [];
      for (let index = 0; index < capture.fragments.length; index++) {
        controller.signal.throwIfAborted(); const fragment = capture.fragments[index];
        const mesh = await storeBarrierBytes(projectId, intent.id, allocation[index].blobId, encodeBarrierJson({ verticesMetres: fragment.verticesMetres, triangleIndices: fragment.triangleIndices }));
        fragments.push({ source: fragment.source, bounds: fragment.bounds, mesh, vertices: fragment.verticesMetres.length, triangles: fragment.triangleIndices.length / 3 });
      }
      const common = { snapshotId: intent.snapshotId, scope: capture.scope, registryRevision: nextRevision(intent.command.expectedRegistryRevision), selectedParents: capture.selectedParents,
        capture: { captureId: capture.captureId, payloadSha256: captureSha256 }, coverage: 'registered-selected-objects-only', engineeringAccepted: false };
      const body = mixed ? { ...common, schemaVersion: 'wfc.pf.barrier-snapshot.v2', geometryPolicy: MIXED_BARRIER_POLICY,
        ownTerminalExemptionsSupported: false, authority: 'none', geometry: { mode: 'mixed-mesh-set', fragments,
          verification: { ...mixedQualificationSchema.parse(qualification), selectionClosure: 'complete-selected-scope', verifiedCaptureSha256: captureSha256 } } }
        : { schemaVersion: BARRIER_SNAPSHOT_VERSION, snapshotId: intent.snapshotId, scope: capture.scope, registryRevision: nextRevision(intent.command.expectedRegistryRevision), selectedParents: capture.selectedParents,
        capture: { captureId: capture.captureId, payloadSha256: captureSha256 }, geometry: { mode: 'mesh-set' as const, fragments,
          verification: { ...legacyQualificationSchema.parse(qualification), selectionClosure: 'complete-selected-scope', topology: 'qualified-closed-consistent-two-manifold', selfIntersection: 'bounded-verification-passed', verifiedCaptureSha256: captureSha256 } },
        coverage: 'registered-selected-objects-only', engineeringAccepted: false };
      const manifest = supportedBarrierSnapshotSchema.parse({ ...body, contentSha256: barrierValueHash(body) });
      const manifestBlob = await storeBarrierBytes(projectId, intent.id, intent.manifestBlobId, encodeBarrierJson(manifest, BARRIER_LIMITS.manifestBytes), BARRIER_LIMITS.manifestBytes);
      let finalLeaseDeadline: number | null = null;
      return await tx(projectId, who, async client => {
        const row = await readIntent(client, projectId, intentId); checkedIntent(row, projectId, who);
        await requireOpenCommand(client, projectId, intent.command);
        await current(client, projectId, intent.command.scope);
        const replay = await prior(client, projectId, who, intent.command.idempotencyKey, intent.command); if (replay) {
          if ('outcome' in replay && (replay.captureSha256 !== captureSha256 || replay.frameSha256 !== frameSha256)) return fail('BARRIER_CAPTURE_CHANGED');
          if (!('outcome' in replay) && replay.snapshot.snapshotId !== intent.snapshotId) return fail('BARRIER_RECEIPT_INTEGRITY');
          return replay;
        }
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
        const receipt = publicationReceipt(manifest);
        await saveReceipt(client, projectId, who, intent.command, receipt); return receipt;
      }, controller.signal, () => { if (finalLeaseDeadline !== null && finalLeaseDeadline <= Date.now()) return fail('BARRIER_CAPTURE_LEASE_CHANGED'); });
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  async function publishManifest(client: PoolClient, projectId: string, who: JobPrincipal, storageIntentId: string, manifest: BarrierSnapshot, manifestBlob: BarrierBlob): Promise<void> {
    await client.query('INSERT INTO pf_barrier_snapshots(id,project_id,model_version_id,registry_revision,storage_intent_id,manifest_blob,manifest,created_by,login_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [manifest.snapshotId, projectId, manifest.scope.modelVersionId, manifest.registryRevision, storageIntentId, manifestBlob, manifest, who.userId, who.loginId]);
    await client.query('INSERT INTO pf_barrier_heads(project_id,revision,snapshot_id) VALUES($1,$2,$3) ON CONFLICT(project_id) DO UPDATE SET revision=EXCLUDED.revision,snapshot_id=EXCLUDED.snapshot_id,updated_at=now()', [projectId, manifest.registryRevision, manifest.snapshotId]);
  }
  async function command(projectId: string, who: JobPrincipal, raw: unknown, signal?: AbortSignal): Promise<Receipt> {
    const request = supportedBarrierRegistryCommandSchema.parse(raw);
    return tx(projectId, who, async client => {
      await requireOpenCommand(client, projectId, request);
      const replay = await prior(client, projectId, who, request.idempotencyKey, request); if (replay) {
        if ('outcome' in replay) return fail('BARRIER_IDEMPOTENCY_CONFLICT'); return replay;
      }
      await current(client, projectId, request.scope);
      if ((await head(client, projectId)).revision !== request.expectedRegistryRevision) return fail('BARRIER_REGISTRY_REVISION_CHANGED');
      const pending = (await client.query('SELECT id FROM pf_barrier_capture_intents WHERE project_id=$1 AND actor_id=$2 AND idempotency_key=$3', [projectId, who.userId, request.idempotencyKey])).rows;
      if (pending.length) return fail('BARRIER_IDEMPOTENCY_CONFLICT');
      // Mesh-set manifests contain exact parent memberships. Removing one needs a new protected capture and qualification.
      if (request.action === 'remove') return fail('BARRIER_RECAPTURE_REQUIRED');
      const storageIntentId = randomUUID(), manifestId = randomUUID(), manifestBlobId = randomUUID();
      const common = { snapshotId: manifestId, scope: request.scope, registryRevision: nextRevision(request.expectedRegistryRevision), selectedParents: [], capture: null,
        geometry: { mode: 'explicit-empty', declarationId: randomUUID(), declaration: 'administrator-declared-no-selected-barriers', reason: request.reason }, coverage: 'registered-selected-objects-only', engineeringAccepted: false };
      const body = request.schemaVersion === 'wfc.pf.barrier-registry-command.v2'
        ? { ...common, schemaVersion: 'wfc.pf.barrier-snapshot.v2', geometryPolicy: MIXED_BARRIER_POLICY, ownTerminalExemptionsSupported: false, authority: 'none' }
        : { ...common, schemaVersion: BARRIER_SNAPSHOT_VERSION };
      const manifest = supportedBarrierSnapshotSchema.parse({ ...body, contentSha256: barrierValueHash(body) });
      const blob = await storeBarrierBytes(projectId, storageIntentId, manifestBlobId, encodeBarrierJson(manifest, BARRIER_LIMITS.manifestBytes), BARRIER_LIMITS.manifestBytes);
      // The async write has not released the row/authority locks. Recheck the authoritative model/frame before publication.
      await current(client, projectId, request.scope); signal?.throwIfAborted(); assertLoginNotExpired(who);
      await requireOpenCommand(client, projectId, request);
      await publishManifest(client, projectId, who, storageIntentId, manifest, blob);
      const receipt = publicationReceipt(manifest);
      await saveReceipt(client, projectId, who, request, receipt); return receipt;
    }, signal);
  }
  return { authorize, get, list, getSnapshot, readCaptureOutcome, readCommandRecovery, closeCommand, begin, publish, command };
}
export type BarrierRegistryRepository = ReturnType<typeof createBarrierRegistryRepository>;
export type { BarrierRegistry };
