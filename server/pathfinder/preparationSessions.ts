import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { canonicalPurposeJson, policyUuidSchema, policyRevisionSchema } from '../../shared/pathfinderPurposePolicy.js';
import { PREPARATION_LIMITS, preparationCreateSchema, preparationSessionSchema, preparationPartSchema, preparationPartReceiptSchema, preparationMutationSchema, preparationResolutionWriteSchema, preparationResolutionSchema, preparationResolutionReceiptSchema, preparationPublicationSchema, preparationAggregateSchema, preparationIndexSchema, preparationCountsSchema, preparationBlobSchema, type PreparationPlan, type PreparationSession, type PreparationPart, type PreparationAggregate } from '../../shared/pathfinderPreparation.js';
import { snapshotSchema, type ComputationalSnapshot } from './contracts.js';
import { principalTransaction } from './auth.js';
import type { JobPrincipal } from './jobContracts.js';
import { PathFinderError } from './errors.js';
import { readPreparationContext, readPreparationState, equalPreparationScope, buildPreparationPlan, preparationDigest } from './preparationPlans.js';
import { storePreparationBlob, readPreparationBlob, encodePreparationPayload } from './preparationStorage.js';

const fail = (code: string, status = 409): never => { throw new PathFinderError(code, status, 'Project preparation requires a refresh or an explicit routing decision.'); };
const terminal = new Set(['published', 'failed', 'cancelled', 'stale']);
const partBlob = (part: PreparationPart) => ({ payloadRef: part.payloadRef, sha256: part.payloadSha256, bytes: part.payloadBytes });
const MAX_REVISION = 9223372036854775807n;
const nextRevision = (value: string) => BigInt(value) < MAX_REVISION ? (BigInt(value) + 1n).toString() : fail('PREPARATION_REVISION_LIMIT');
/** Local bounds include admission/auth locks, not only the operation callback. */
export const PREPARATION_SQL_BOUNDS = Object.freeze({ acquisitionMilliseconds: 5000, lockMilliseconds: 3000, statementMilliseconds: 15000, idleMilliseconds: 30000 });
function preparationAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new PathFinderError('PREPARATION_VALIDATION_CANCELLED', 409, 'Preparation validation stopped before publication. Inspect the retained session before retrying.');
}
export async function preparationTransaction<T>(pool: Pool, projectId: string, who: JobPrincipal, operation: (client: PoolClient) => Promise<T>, signal?: AbortSignal): Promise<T> {
  preparationAborted(signal);
  let commitStarted = false;
  const boundedPool = { connect: async () => {
    let expired = false, timer: ReturnType<typeof setTimeout> | undefined;
    const acquisition = pool.connect().then(client => { if (expired) { client.release(); throw new PathFinderError('PREPARATION_DATABASE_BUSY', 503); } return client; });
    const timeout = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { expired = true; reject(new PathFinderError('PREPARATION_DATABASE_BUSY', 503, 'The preparation database is busy. Keep the same command and reconcile its session.')); }, PREPARATION_SQL_BOUNDS.acquisitionMilliseconds); });
    let client: PoolClient;
    try { client = await Promise.race([acquisition, timeout]); } finally { if (timer) clearTimeout(timer); }
    const wrapper = Object.create(client) as PoolClient;
    wrapper.query = (async (...args: unknown[]) => {
      const sql = typeof args[0] === 'string' ? args[0] : (args[0] as { text?: string } | undefined)?.text;
      if (sql === 'COMMIT') { preparationAborted(signal); commitStarted = true; }
      const result = await Reflect.apply(client.query, client, args) as unknown;
      if (sql === 'BEGIN') {
        await client.query(`SET LOCAL lock_timeout='${PREPARATION_SQL_BOUNDS.lockMilliseconds}ms'`);
        await client.query(`SET LOCAL statement_timeout='${PREPARATION_SQL_BOUNDS.statementMilliseconds}ms'`);
        await client.query(`SET LOCAL idle_in_transaction_session_timeout='${PREPARATION_SQL_BOUNDS.idleMilliseconds}ms'`);
        preparationAborted(signal);
      }
      return result;
    }) as PoolClient['query'];
    wrapper.release = error => client.release(error);
    return wrapper;
  } } as Pool;
  try {
    return await principalTransaction(boundedPool, projectId, who, async client => {
      preparationAborted(signal); const value = await operation(client); preparationAborted(signal); return value;
    });
  } catch (error) {
    if (commitStarted) throw new PathFinderError('PREPARATION_COMMIT_OUTCOME_UNKNOWN', 503, 'The publication commit could not be confirmed. Keep the same command and reconcile its session.');
    if (['55P03', '57014'].includes((error as { code?: string } | null)?.code ?? '')) throw new PathFinderError('PREPARATION_DATABASE_BUSY', 503, 'The preparation database deadline was reached. Keep the same command and reconcile its session.');
    throw error;
  }
}
export const PREPARATION_SQL = `
CREATE TABLE IF NOT EXISTS pf_project_preparations(project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,geometry_revision bigint NOT NULL DEFAULT 0 CHECK(geometry_revision>=0),resolution_revision bigint NOT NULL DEFAULT 0 CHECK(resolution_revision>=0),current_aggregate_id uuid,current_artifact_id uuid);
CREATE TABLE IF NOT EXISTS pf_preparation_sessions(id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,plan jsonb NOT NULL,state text NOT NULL CHECK(state IN('planned','collecting','validating','published','failed','cancelled','stale')),revision bigint NOT NULL DEFAULT 0,actor_id uuid NOT NULL,login_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),failure jsonb,published_aggregate_id uuid,validation_token uuid,validation_key uuid,validation_sha256 text,validation_expires_at timestamptz,UNIQUE(project_id,id));
ALTER TABLE pf_preparation_sessions ADD COLUMN IF NOT EXISTS validation_command jsonb,ADD COLUMN IF NOT EXISTS validation_actor_id uuid,ADD COLUMN IF NOT EXISTS validation_login_id uuid;
CREATE TABLE IF NOT EXISTS pf_preparation_parts(project_id uuid NOT NULL,session_id uuid NOT NULL,part_id uuid NOT NULL,part_index int NOT NULL,receipt jsonb NOT NULL,PRIMARY KEY(session_id,part_id),UNIQUE(session_id,part_index),FOREIGN KEY(project_id,session_id) REFERENCES pf_preparation_sessions(project_id,id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS pf_preparation_events(id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,session_id uuid NOT NULL REFERENCES pf_preparation_sessions(id) ON DELETE CASCADE,actor_id uuid NOT NULL,login_id uuid NOT NULL,revision bigint NOT NULL,before_state text NOT NULL,after_state text NOT NULL,reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(session_id,revision));
CREATE TABLE IF NOT EXISTS pf_preparation_commands(project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,actor_id uuid NOT NULL,idempotency_key uuid NOT NULL,kind text NOT NULL,request_sha256 text NOT NULL,receipt jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(project_id,actor_id,idempotency_key));
CREATE TABLE IF NOT EXISTS pf_preparation_resolutions(project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,project_tray_id uuid NOT NULL,resolution jsonb NOT NULL,PRIMARY KEY(project_id,project_tray_id));
CREATE TABLE IF NOT EXISTS pf_preparation_resolution_events(id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,actor_id uuid NOT NULL,login_id uuid NOT NULL,revision bigint NOT NULL,request jsonb NOT NULL,before_value jsonb,after_value jsonb,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(project_id,revision));
CREATE TABLE IF NOT EXISTS pf_preparation_aggregates(id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,session_id uuid NOT NULL UNIQUE REFERENCES pf_preparation_sessions(id),model_version_id uuid NOT NULL,geometry_revision bigint NOT NULL,artifact_id uuid NOT NULL,registry_revision bigint NOT NULL,manifest jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(project_id,geometry_revision));
CREATE OR REPLACE FUNCTION pf_preparation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) THEN RETURN OLD; END IF; RAISE EXCEPTION 'Preparation proof is immutable'; END $$;
CREATE OR REPLACE FUNCTION pf_preparation_plan_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.plan IS DISTINCT FROM NEW.plan OR OLD.project_id<>NEW.project_id OR OLD.id<>NEW.id OR OLD.actor_id<>NEW.actor_id OR OLD.login_id<>NEW.login_id OR OLD.created_at<>NEW.created_at THEN RAISE EXCEPTION 'Preparation plan is immutable';END IF;RETURN NEW;END $$;
DROP TRIGGER IF EXISTS pf_preparation_plan_immutable ON pf_preparation_sessions;
CREATE TRIGGER pf_preparation_plan_immutable BEFORE UPDATE ON pf_preparation_sessions FOR EACH ROW EXECUTE FUNCTION pf_preparation_plan_immutable();
`;
export async function initializePreparationSchema(pool: Pool) {
  const c = await pool.connect(); try { await c.query('BEGIN'); await c.query("SELECT pg_advisory_xact_lock(hashtext('wfc-purpose-policy-schema-v1'))"); await c.query(PREPARATION_SQL);
    for (const table of ['pf_preparation_parts', 'pf_preparation_events', 'pf_preparation_commands', 'pf_preparation_resolution_events', 'pf_preparation_aggregates']) { await c.query(`DROP TRIGGER IF EXISTS pf_preparation_immutable ON ${table}`); await c.query(`CREATE TRIGGER pf_preparation_immutable BEFORE UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION pf_preparation_immutable()`); }
    await c.query('COMMIT'); } catch (error) { await c.query('ROLLBACK').catch(() => undefined); throw error; } finally { c.release(); }
}
type SessionRow = { id: string; project_id: string; plan: PreparationPlan; state: PreparationSession['state']; revision: string; actor_id: string; login_id: string; created_at: Date; updated_at: Date; failure: unknown; published_aggregate_id: string | null; validation_token: string | null; validation_key: string | null; validation_sha256: string | null; validation_expires_at: Date | null; validation_command: unknown; validation_actor_id: string | null; validation_login_id: string | null };
async function sessionRow(c: PoolClient, projectId: string, id: string): Promise<SessionRow> {
  policyUuidSchema.parse(id);
  const row = (await c.query<SessionRow>('SELECT *,revision::text FROM pf_preparation_sessions WHERE project_id=$1 AND id=$2 FOR UPDATE', [projectId, id])).rows[0]; if (!row) return fail('PREPARATION_SESSION_NOT_FOUND', 404); return row;
}
async function sessionView(c: PoolClient, row: SessionRow): Promise<PreparationSession> {
  const parts = (await c.query<{ receipt: unknown }>('SELECT receipt FROM pf_preparation_parts WHERE project_id=$1 AND session_id=$2 ORDER BY part_index', [row.project_id, row.id])).rows.map(r => preparationPartSchema.parse(r.receipt));
  const missingPartIds = row.plan.partPlan.filter(p => !parts.some(r => r.partId === p.partId)).map(p => p.partId);
  const recovery = row.state === 'validating' ? { command: preparationMutationSchema.parse(row.validation_command), expiresAt: new Date(row.validation_expires_at!).toISOString(), actorId: row.validation_actor_id, loginId: row.validation_login_id } : null;
  if (recovery && (preparationDigest({ id: row.id, command: recovery.command }) !== row.validation_sha256 || recovery.command.idempotencyKey !== row.validation_key)) return fail('PREPARATION_VALIDATION_INTENT_INTEGRITY');
  return preparationSessionSchema.parse({ schemaVersion: 'wfc.pf.preparation-session.v1', id: row.id, projectId: row.project_id, state: row.state, sessionRevision: row.revision, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(), principal: { kind: 'current-login-admin', actorId: row.actor_id, loginId: row.login_id }, plan: row.plan, parts, coverage: { expectedParts: row.plan.partPlan.length, committedParts: parts.length, requestedScopeComplete: missingPartIds.length === 0 && row.plan.partPlan.length > 0 && row.plan.diagnostics.length === 0, missingPartIds }, failure: row.failure ?? null, publishedAggregateId: row.published_aggregate_id, recovery });
}
async function transition(c: PoolClient, row: SessionRow, who: JobPrincipal, state: PreparationSession['state'], reason: string, failure: unknown = null) {
  const revision = nextRevision(row.revision);
  await c.query('UPDATE pf_preparation_sessions SET state=$3,revision=$4,updated_at=now(),failure=$5 WHERE project_id=$1 AND id=$2 AND revision=$6', [row.project_id, row.id, state, revision, failure, row.revision]);
  await c.query('INSERT INTO pf_preparation_events(id,project_id,session_id,actor_id,login_id,revision,before_state,after_state,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [randomUUID(), row.project_id, row.id, who.userId, who.loginId, revision, row.state, state, reason]);
  row.state = state; row.revision = revision; row.updated_at = new Date(); row.failure = failure;
}
async function priorCommand(c: PoolClient, projectId: string, who: JobPrincipal, key: string, kind: string, sha: string) {
  const row = (await c.query<{ kind: string; request_sha256: string; receipt: unknown }>('SELECT kind,request_sha256,receipt FROM pf_preparation_commands WHERE project_id=$1 AND actor_id=$2 AND idempotency_key=$3', [projectId, who.userId, key])).rows[0];
  if (row && (row.kind !== kind || row.request_sha256 !== sha)) return fail('IDEMPOTENCY_CONFLICT'); return row?.receipt;
}
async function commandReceipt(c: PoolClient, projectId: string, who: JobPrincipal, key: string, kind: string, sha: string, receipt: unknown) { await c.query('INSERT INTO pf_preparation_commands(project_id,actor_id,idempotency_key,kind,request_sha256,receipt) VALUES($1,$2,$3,$4,$5,$6)', [projectId, who.userId, key, kind, sha, receipt]); }
async function current(c: PoolClient, row: SessionRow, who: JobPrincipal): Promise<boolean> {
  let context;
  try { context = await readPreparationContext(c, row.project_id); }
  catch (error) { if (error instanceof PathFinderError && ['MODEL_UNAVAILABLE', 'PREPARATION_REGISTRY_REQUIRED'].includes(error.code)) { if (!terminal.has(row.state)) await transition(c, row, who, 'stale', 'active-scope-unavailable'); return false; } throw error; }
  if (!equalPreparationScope(context.scope, row.plan) || canonicalPurposeJson(context.endpointNames) !== canonicalPurposeJson(row.plan.requestedScope.endpointNames) || Date.now() - new Date(row.created_at).getTime() > PREPARATION_LIMITS.sessionMilliseconds) {
    if (!terminal.has(row.state)) await transition(c, row, who, 'stale', 'scope-or-session-deadline'); return false;
  }
  return true;
}
const validationSchema = z.object({ projection: preparationBlobSchema, traceIndex: preparationBlobSchema, counts: preparationCountsSchema, engineVersion: z.string().min(1).max(2048), rulesVersion: z.string().min(1).max(2048), diagnostics: z.array(z.string().max(2048)).max(10000), publicationData: z.unknown() }).strict().refine(v => Object.hasOwn(v, 'publicationData'));
export type PreparationValidation = z.infer<typeof validationSchema>;
export type PreparationAdapters = {
  validatePart?: (plan: PreparationPlan, part: PreparationPlan['partPlan'][number], payload: ComputationalSnapshot) => ComputationalSnapshot;
  validateUnion: (plan: PreparationPlan, parts: { partId: string; payload: ComputationalSnapshot }[], signal: AbortSignal) => Promise<PreparationValidation>;
  publish: (client: PoolClient, input: { session: PreparationSession; plan: PreparationPlan; aggregateId: string; geometryRevision: string; validation: PreparationValidation; principal: JobPrincipal }) => Promise<{ artifactId: string; registryRevision: string }>;
};

export function createPreparationService(pool: Pool, adapters: PreparationAdapters) {
  const running = new Map<string, AbortController>();
  const guarded = async <T>(projectId: string, who: JobPrincipal, id: string, operation: (c: PoolClient, row: SessionRow) => Promise<T>) => {
    const result = await preparationTransaction(pool, projectId, who, async c => { const row = await sessionRow(c, projectId, id); if (!await current(c, row, who)) return { stale: true as const }; return { value: await operation(c, row), stale: false as const }; });
    if (result.stale) return fail('PREPARATION_SCOPE_STALE'); return result.value;
  };
  return {
    context: (projectId: string, who: JobPrincipal) => preparationTransaction(pool, projectId, who, c => readPreparationContext(c, projectId)),
    index: (projectId: string, who: JobPrincipal) => preparationTransaction(pool, projectId, who, async c => preparationIndexSchema.parse({ schemaVersion: 'wfc.pf.preparation-index.v1', sessions: (await c.query(`SELECT s.id,s.state,s.revision::text AS "sessionRevision",s.created_at AS "createdAt",x.idempotency_key AS "idempotencyKey" FROM pf_preparation_sessions s JOIN pf_preparation_commands x ON x.project_id=s.project_id AND x.kind='create' AND x.receipt->>'sessionId'=s.id::text WHERE s.project_id=$1 ORDER BY s.created_at DESC,s.id DESC LIMIT 20`, [projectId])).rows.map(r => ({ ...r, createdAt: new Date(r.createdAt).toISOString() })) })),
    get: (projectId: string, who: JobPrincipal, id: string) => preparationTransaction(pool, projectId, who, async c => sessionView(c, await sessionRow(c, projectId, id))),
    async create(projectId: string, who: JobPrincipal, raw: unknown) {
      const input = preparationCreateSchema.parse(raw), sha = preparationDigest(input);
      return preparationTransaction(pool, projectId, who, async c => {
        const replay = await priorCommand(c, projectId, who, input.idempotencyKey, 'create', sha) as { sessionId: string } | undefined;
        if (replay) return sessionView(c, await sessionRow(c, projectId, replay.sessionId));
        if (Number((await c.query<{ count: string }>('SELECT count(*)::text FROM pf_preparation_sessions WHERE project_id=$1', [projectId])).rows[0].count) >= 128) return fail('PREPARATION_SESSION_RETENTION_LIMIT', 413);
        const context = await readPreparationContext(c, projectId), plan = buildPreparationPlan(context, input);
        await c.query("INSERT INTO pf_preparation_sessions(id,project_id,plan,state,actor_id,login_id) VALUES($1,$2,$3,'planned',$4,$5)", [plan.id, projectId, plan, who.userId, who.loginId]);
        await commandReceipt(c, projectId, who, input.idempotencyKey, 'create', sha, { sessionId: plan.id });
        return sessionView(c, await sessionRow(c, projectId, plan.id));
      });
    },
    async resolve(projectId: string, who: JobPrincipal, raw: unknown) {
      const input = preparationResolutionWriteSchema.parse(raw), sha = preparationDigest(input);
      return preparationTransaction(pool, projectId, who, async c => {
        const replay = await priorCommand(c, projectId, who, input.idempotencyKey, 'resolve', sha); if (replay) return preparationResolutionReceiptSchema.parse({ ...replay as object, duplicate: true });
        const context = await readPreparationContext(c, projectId); if (!equalPreparationScope(context.scope, input.expected)) return fail('PREPARATION_SCOPE_STALE');
        if (!context.trays.some(t => t.projectTrayId === input.projectTrayId)) return fail('PREPARATION_TRAY_NOT_FOUND', 404);
        const before = context.resolutions.find(r => r.projectTrayId === input.projectTrayId) ?? null, revision = nextRevision(context.scope.resolutionRevision);
        const resolution = input.mode === 'reset' ? null : preparationResolutionSchema.parse({ id: randomUUID(), projectTrayId: input.projectTrayId, mode: input.mode, rootObjectIds: input.rootObjectIds, reason: input.reason, actorId: who.userId, createdAt: new Date().toISOString(), scope: input.expected });
        await c.query('DELETE FROM pf_preparation_resolutions WHERE project_id=$1 AND project_tray_id=$2', [projectId, input.projectTrayId]);
        if (resolution) await c.query('INSERT INTO pf_preparation_resolutions(project_id,project_tray_id,resolution) VALUES($1,$2,$3)', [projectId, input.projectTrayId, resolution]);
        await c.query('UPDATE pf_project_preparations SET resolution_revision=$2 WHERE project_id=$1', [projectId, revision]);
        await c.query('INSERT INTO pf_preparation_resolution_events(id,project_id,actor_id,login_id,revision,request,before_value,after_value) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [randomUUID(), projectId, who.userId, who.loginId, revision, input, before, resolution]);
        const receipt = preparationResolutionReceiptSchema.parse({ schemaVersion: 'wfc.pf.preparation-resolution-receipt.v1', resolutionRevision: revision, resolution, duplicate: false }); await commandReceipt(c, projectId, who, input.idempotencyKey, 'resolve', sha, receipt); return receipt;
      });
    },
    async upload(projectId: string, who: JobPrincipal, id: string, partId: string, planSha: string, raw: unknown) {
      policyUuidSchema.parse(partId);
      // Stage outside SQL; immutable orphan files remain owned and can be reconciled after uncertainty.
      const admission = await preparationTransaction(pool, projectId, who, async c => {
        const row = await sessionRow(c, projectId, id);
        const part = row.plan.partPlan.find(p => p.partId === partId); if (!part || row.plan.orderedPlanSha256 !== planSha) return fail('PREPARATION_PART_SCOPE');
        const prior = (await c.query<{ receipt: unknown }>('SELECT receipt FROM pf_preparation_parts WHERE session_id=$1 AND part_id=$2', [id, partId])).rows[0];
        // Historical exact replay proves only this immutable receipt, not currentness.
        // Fresh administrator/login authority is still held through the read commit.
        if (prior) {
          const receipt = preparationPartSchema.parse(prior.receipt), parsed = snapshotSchema.parse(raw), bytes = encodePreparationPayload(parsed);
          if (receipt.payloadBytes !== bytes.length || receipt.payloadSha256 !== preparationDigest(parsed)) return fail('PART_IDENTITY_CONFLICT');
          await readPreparationBlob(projectId, id, partBlob(receipt));
          return { replay: preparationPartReceiptSchema.parse({ schemaVersion: 'wfc.pf.preparation-part-receipt.v1', part: receipt, sessionRevision: row.revision, duplicate: true }) };
        }
        if (!await current(c, row, who)) return { stale: true as const };
        if (!prior && !['planned', 'collecting'].includes(row.state)) return fail('PREPARATION_STATE_CONFLICT');
        if (row.plan.diagnostics.length) return fail('PREPARATION_PLAN_UNRESOLVED');
        const parsed = snapshotSchema.parse(raw);
        const payload = adapters.validatePart ? adapters.validatePart(row.plan, part, parsed) : parsed;
        if (!adapters.validatePart) return fail('PREPARATION_PART_VALIDATOR_REQUIRED', 503);
        if (payload.objects.length > PREPARATION_LIMITS.closurePerPart || payload.model.projectId !== projectId || payload.model.modelVersionId !== row.plan.modelVersionId || payload.model.contentSha256 !== row.plan.contentFingerprint) return fail('PREPARATION_PART_SCOPE');
        const stagedBytes = (await sessionView(c, row)).parts.reduce((sum, part) => sum + part.payloadBytes, 0);
        if (!prior && stagedBytes + encodePreparationPayload(payload).length > PREPARATION_LIMITS.validationInputBytes) return fail('PREPARATION_VALIDATION_INPUT_LIMIT', 413);
        return { admitted: { part, plan: row.plan, payload, revision: row.revision } };
      });
      if ('replay' in admission && admission.replay) return admission.replay;
      if ('stale' in admission || !('admitted' in admission) || !admission.admitted) return fail('PREPARATION_SCOPE_STALE');
      const admitted = admission.admitted;
      const blob = await storePreparationBlob(projectId, id, partId, admitted.payload);
      return guarded(projectId, who, id, async (c, row) => {
        const prior = (await c.query<{ receipt: unknown }>('SELECT receipt FROM pf_preparation_parts WHERE session_id=$1 AND part_id=$2', [id, partId])).rows[0];
        if (prior) { const part = preparationPartSchema.parse(prior.receipt); if (part.payloadSha256 !== blob.sha256 || part.payloadBytes !== blob.bytes) return fail('PART_IDENTITY_CONFLICT'); await readPreparationBlob(projectId, id, partBlob(part)); return preparationPartReceiptSchema.parse({ schemaVersion: 'wfc.pf.preparation-part-receipt.v1', part, sessionRevision: row.revision, duplicate: true }); }
        if (!['planned', 'collecting'].includes(row.state)) return fail('PREPARATION_STATE_CONFLICT');
        if ((await sessionView(c, row)).parts.reduce((sum, part) => sum + part.payloadBytes, 0) + blob.bytes > PREPARATION_LIMITS.validationInputBytes) return fail('PREPARATION_VALIDATION_INPUT_LIMIT', 413);
        const payload = admitted.payload, counts = { objects: payload.objects.length, physicalLeaves: payload.objects.filter(o => o.geometryRole === 'routing-leaf').length, fragments: 0, vertices: 0, triangles: 0 };
        for (const object of payload.objects) for (const fragment of object.fragments) { counts.fragments++; counts.vertices += fragment.vertices.length; counts.triangles += fragment.triangleIndices.length / 3; }
        const part = preparationPartSchema.parse({ schemaVersion: 'wfc.pf.preparation-part.v1', sessionId: id, partId, partIndex: admitted.part.partIndex, sessionPlanSha256: row.plan.orderedPlanSha256, modelVersionId: row.plan.modelVersionId, contentFingerprint: row.plan.contentFingerprint, coordinateFrameId: row.plan.coordinateFrameId, scopeSha256: admitted.part.scopeSha256, payloadEncoding: 'pathfinder.model.snapshot.v1-json-utf8', payloadRef: blob.payloadRef, payloadSha256: blob.sha256, payloadBytes: blob.bytes, counts, coverage: { partScopeComplete: true, missingObjectIds: [], ambiguousObjectIds: [] }, producer: { level: 'A', adapterVersion: payload.capture.adapterVersion, sourceKind: payload.capture.sourceKind }, completedAt: new Date().toISOString() });
        await c.query('INSERT INTO pf_preparation_parts(project_id,session_id,part_id,part_index,receipt) VALUES($1,$2,$3,$4,$5)', [projectId, id, partId, part.partIndex, part]); await transition(c, row, who, 'collecting', 'part-committed');
        return preparationPartReceiptSchema.parse({ schemaVersion: 'wfc.pf.preparation-part-receipt.v1', part, sessionRevision: row.revision, duplicate: false });
      });
    },
    async cancel(projectId: string, who: JobPrincipal, id: string, raw: unknown) {
      const command = preparationMutationSchema.parse(raw), sha = preparationDigest({ id, command });
      const result = await preparationTransaction(pool, projectId, who, async c => { const replay = await priorCommand(c, projectId, who, command.idempotencyKey, 'cancel', sha); if (replay) return preparationSessionSchema.parse(replay); const row = await sessionRow(c, projectId, id); if (terminal.has(row.state) || row.revision !== command.expectedSessionRevision) return fail('PREPARATION_STATE_CONFLICT'); await transition(c, row, who, 'cancelled', command.reason); await c.query('UPDATE pf_preparation_sessions SET validation_token=NULL WHERE id=$1', [id]); const receipt = await sessionView(c, row); await commandReceipt(c, projectId, who, command.idempotencyKey, 'cancel', sha, receipt); return receipt; });
      running.get(id)?.abort(); return result;
    },
    async publish(projectId: string, who: JobPrincipal, id: string, raw: unknown) {
      const command = preparationMutationSchema.parse(raw), sha = preparationDigest({ id, command });
      const admitted = await preparationTransaction(pool, projectId, who, async c => {
        const replay = await priorCommand(c, projectId, who, command.idempotencyKey, 'publish', sha); if (replay) return { replay: preparationPublicationSchema.parse({ ...replay as object, duplicate: true }) };
        const row = await sessionRow(c, projectId, id); if (!await current(c, row, who)) return { stale: true as const };
        const retry = row.validation_key === command.idempotencyKey && row.validation_sha256 === sha;
        if (terminal.has(row.state) || !retry && row.revision !== command.expectedSessionRevision) return fail('PREPARATION_STATE_CONFLICT');
        if (row.state === 'validating' && row.validation_expires_at && new Date(row.validation_expires_at).getTime() > Date.now()) return fail(retry ? 'PREPARATION_VALIDATION_IN_PROGRESS' : 'PREPARATION_VALIDATION_BUSY', retry ? 503 : 409);
        const session = await sessionView(c, row); if (!session.coverage.requestedScopeComplete) return fail('PREPARATION_PARTS_INCOMPLETE');
        if (session.parts.reduce((sum, part) => sum + part.payloadBytes, 0) > PREPARATION_LIMITS.validationInputBytes) return fail('PREPARATION_VALIDATION_INPUT_LIMIT', 413);
        const token = randomUUID(); await transition(c, row, who, 'validating', retry ? 'validation-recovery' : command.reason);
        const expiresAt = new Date(Date.now() + PREPARATION_LIMITS.validationMilliseconds + 10000);
        await c.query('UPDATE pf_preparation_sessions SET validation_token=$2,validation_key=$3,validation_sha256=$4,validation_expires_at=$5,validation_command=$6,validation_actor_id=$7,validation_login_id=$8 WHERE id=$1', [id, token, command.idempotencyKey, sha, expiresAt, command, who.userId, who.loginId]);
        Object.assign(row, { validation_token: token, validation_key: command.idempotencyKey, validation_sha256: sha, validation_expires_at: expiresAt, validation_command: command, validation_actor_id: who.userId, validation_login_id: who.loginId });
        return { session: await sessionView(c, row), token };
      });
      if ('replay' in admitted && admitted.replay) return admitted.replay;
      if ('stale' in admitted) return fail('PREPARATION_SCOPE_STALE');
      if (!('session' in admitted) || !admitted.session || !admitted.token) return fail('PREPARATION_STATE_CONFLICT');
      const { session, token } = admitted, controller = new AbortController(); running.set(id, controller);
      const timeout = setTimeout(() => controller.abort(), PREPARATION_LIMITS.validationMilliseconds);
      let finalPublicationStarted = false;
      try {
        const parts = [];
        for (const part of session.parts) { controller.signal.throwIfAborted(); const bytes = await readPreparationBlob(projectId, id, partBlob(part)); parts.push({ partId: part.partId, payload: snapshotSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))) }); }
        const validation = validationSchema.parse(await adapters.validateUnion(session.plan, parts, controller.signal)); controller.signal.throwIfAborted();
        finalPublicationStarted = true;
        return await preparationTransaction(pool, projectId, who, async c => {
          const replay = await priorCommand(c, projectId, who, command.idempotencyKey, 'publish', sha); if (replay) return preparationPublicationSchema.parse({ ...replay as object, duplicate: true });
          const row = await sessionRow(c, projectId, id); if (row.state !== 'validating' || row.validation_token !== token) return fail('PREPARATION_STATE_CONFLICT'); if (!await current(c, row, who)) return fail('PREPARATION_SCOPE_STALE');
          const frozen = await sessionView(c, row); if (canonicalPurposeJson(frozen.parts) !== canonicalPurposeJson(session.parts)) return fail('PREPARATION_PART_IDENTITY_CONFLICT');
          for (const part of frozen.parts) await readPreparationBlob(projectId, id, partBlob(part));
          const state = await readPreparationState(c, projectId), geometryRevision = nextRevision(state.geometry_revision), aggregateId = randomUUID();
          const publication = await adapters.publish(c, { session: frozen, plan: frozen.plan, aggregateId, geometryRevision, validation, principal: who }); policyUuidSchema.parse(publication.artifactId); policyRevisionSchema.parse(publication.registryRevision);
          const p = frozen.plan;
          const aggregate: PreparationAggregate = preparationAggregateSchema.parse({ modelVersionId: p.modelVersionId, contentFingerprint: p.contentFingerprint, selectionRevision: p.selectionRevision, catalogRevision: p.catalogRevision, routingContentSha256: p.routingContentSha256, routingPolicyRevision: p.routingPolicyRevision, routingPolicySha256: p.routingPolicySha256, resolutionRevision: p.resolutionRevision, schemaVersion: 'wfc.pf.geometry-aggregate.v1', id: aggregateId, projectId, sessionId: id, artifactId: publication.artifactId, geometryRevision, sourceLocationRegistryRevision: p.locationRegistryRevision, locationRegistryRevision: publication.registryRevision, coordinateFrameId: p.coordinateFrameId, orderedPlanSha256: p.orderedPlanSha256, orderedScopeSha256: p.requestedScope.scopeSha256, partReferences: frozen.parts.map(p => ({ partId: p.partId, partIndex: p.partIndex, payloadSha256: p.payloadSha256 })), projection: validation.projection, traceIndex: validation.traceIndex, counts: validation.counts, requestedScopeComplete: true, wholePlantGeometry: false, engineVersion: validation.engineVersion, rulesVersion: validation.rulesVersion, diagnostics: validation.diagnostics, engineeringAccepted: false, nativeParity: 'not-performed', publishedAt: new Date().toISOString() });
          await c.query('INSERT INTO pf_preparation_aggregates(id,project_id,session_id,model_version_id,geometry_revision,artifact_id,registry_revision,manifest) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [aggregateId, projectId, id, frozen.plan.modelVersionId, geometryRevision, publication.artifactId, publication.registryRevision, aggregate]);
          await c.query('UPDATE pf_project_preparations SET geometry_revision=$2,current_aggregate_id=$3,current_artifact_id=$4 WHERE project_id=$1', [projectId, geometryRevision, aggregateId, publication.artifactId]); await transition(c, row, who, 'published', 'aggregate-published'); await c.query('UPDATE pf_preparation_sessions SET published_aggregate_id=$2,validation_token=NULL WHERE id=$1', [id, aggregateId]);
          const receipt = preparationPublicationSchema.parse({ schemaVersion: 'wfc.pf.preparation-publication.v1', sessionId: id, aggregate, duplicate: false }); await commandReceipt(c, projectId, who, command.idempotencyKey, 'publish', sha, receipt); return receipt;
        }, controller.signal);
      } catch (error) {
        // A failed final COMMIT acknowledgement is not evidence of rollback. Reconcile
        // the same durable command under fresh authority and retain every owned blob.
        if (finalPublicationStarted) {
          const receipt = await preparationTransaction(pool, projectId, who, c => priorCommand(c, projectId, who, command.idempotencyKey, 'publish', sha)).catch(() => undefined);
          if (receipt) return preparationPublicationSchema.parse({ ...receipt as object, duplicate: true });
          if (error instanceof PathFinderError && error.code === 'PREPARATION_SCOPE_STALE') {
            await preparationTransaction(pool, projectId, who, async c => { const row = await sessionRow(c, projectId, id); if (row.state === 'validating' && row.validation_token === token) await current(c, row, who); }).catch(() => undefined);
          }
          // No receipt is not proof of rollback while another transaction/outcome is
          // uncertain. The exact validation key/lease stays recoverable, not failed.
        } else {
          await preparationTransaction(pool, projectId, who, async c => { const row = await sessionRow(c, projectId, id); if (row.state === 'validating' && row.validation_token === token) await transition(c, row, who, 'failed', 'validation-failed', { code: error instanceof PathFinderError ? error.code : 'PREPARATION_VALIDATION_FAILED', message: 'The aggregate was not published. Start a new plan or inspect its retained evidence.' }); }).catch(() => undefined);
        }
        throw error;
      } finally { clearTimeout(timeout); if (running.get(id) === controller) running.delete(id); }
    },
  };
}
export type PreparationService = ReturnType<typeof createPreparationService>;
