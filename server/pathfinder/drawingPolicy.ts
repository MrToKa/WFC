import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { canonicalPurposeJson, policyRevisionSchema, policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { drawingPurposePolicySchema, drawingPurposeWriteSchema, drawingPurposeRuleSchema, drawingPolicySaveSchema, drawingPolicyHistorySchema, drawingPurposeDiagnostics, isDefaultDrawingModes, type DrawingPurposeRule } from '../../shared/pathfinderDrawingPolicy.js';
import { readCatalog } from './catalog.js';
import { readActivePurposeIncarnations, readPurposePolicyState } from './policySchema.js';
import { PurposePolicyError, purposePolicyTransaction, type PolicyRevisions } from './purposePolicy.js';
import type { JobPrincipal } from './jobContracts.js';
import { assertLoginNotExpired, requireCurrentLogin } from './auth.js';

type Row = Record<string, any>;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const revisions = (state: PolicyRevisions): PolicyRevisions => ({ catalogRevision: state.catalogRevision, routingPolicyRevision: state.routingPolicyRevision, drawingPolicyRevision: state.drawingPolicyRevision });
const requestHash = (value: unknown) => createHash('sha256').update(canonicalPurposeJson(value)).digest('hex');
export class DrawingPolicyError extends PurposePolicyError {
  constructor(code: string, status = 400, message = 'Cable positioning could not be processed.', currentRevisions: PolicyRevisions | null = null) { super(code, status, message, currentRevisions); }
}

export async function initializeDrawingPolicySchema(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('wfc-purpose-policy-schema-v1'))");
    await client.query(`
      CREATE TABLE IF NOT EXISTS pf_drawing_purpose_rules(
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        purpose_key TEXT NOT NULL,purpose_incarnation_id UUID NOT NULL,
        category_modes JSONB NOT NULL CHECK(jsonb_typeof(category_modes)='object'),
        PRIMARY KEY(project_id,purpose_key,purpose_incarnation_id),
        FOREIGN KEY(project_id,purpose_key,purpose_incarnation_id)
          REFERENCES pf_catalog_purpose_incarnations(project_id,purpose_key,incarnation_id)
      );
      CREATE TABLE IF NOT EXISTS pf_drawing_policy_history(
        audit_id UUID PRIMARY KEY,project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        actor_id UUID NOT NULL,login_id UUID NOT NULL,occurred_at TIMESTAMPTZ NOT NULL,
        catalog_revision BIGINT NOT NULL CHECK(catalog_revision>=0),previous_revision BIGINT NOT NULL CHECK(previous_revision>=0),
        revision BIGINT NOT NULL CHECK(revision>previous_revision),idempotency_key UUID NOT NULL,
        request_sha256 TEXT NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'),before_rules JSONB NOT NULL,after_rules JSONB NOT NULL,
        UNIQUE(project_id,revision),UNIQUE(project_id,actor_id,idempotency_key)
      );
      CREATE TABLE IF NOT EXISTS pf_drawing_policy_receipts(
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,actor_id UUID NOT NULL,idempotency_key UUID NOT NULL,
        request_sha256 TEXT NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'),request_body JSONB NOT NULL,receipt JSONB NOT NULL,
        audit_id UUID NOT NULL REFERENCES pf_drawing_policy_history(audit_id),PRIMARY KEY(project_id,actor_id,idempotency_key)
      );
      CREATE OR REPLACE FUNCTION protect_pf_drawing_policy_record() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) THEN RETURN OLD;END IF;
        RAISE EXCEPTION 'Drawing policy records are immutable';END $$;
      DROP TRIGGER IF EXISTS pf_drawing_policy_history_immutable ON pf_drawing_policy_history;
      CREATE TRIGGER pf_drawing_policy_history_immutable BEFORE UPDATE OR DELETE ON pf_drawing_policy_history FOR EACH ROW EXECUTE FUNCTION protect_pf_drawing_policy_record();
      DROP TRIGGER IF EXISTS pf_drawing_policy_receipts_immutable ON pf_drawing_policy_receipts;
      CREATE TRIGGER pf_drawing_policy_receipts_immutable BEFORE UPDATE OR DELETE ON pf_drawing_policy_receipts FOR EACH ROW EXECUTE FUNCTION protect_pf_drawing_policy_record();
    `);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
  finally { client.release(); }
}

async function activeRules(client: PoolClient, projectId: string): Promise<DrawingPurposeRule[]> {
  const rows = (await client.query<Row>(`SELECT r.purpose_key,r.category_modes FROM pf_drawing_purpose_rules r
    JOIN pf_catalog_purpose_incarnations i ON i.project_id=r.project_id AND i.purpose_key=r.purpose_key AND i.incarnation_id=r.purpose_incarnation_id
    WHERE r.project_id=$1 AND i.active=TRUE AND i.row_count>0 ORDER BY r.purpose_key COLLATE "C" LIMIT 4097`, [projectId])).rows;
  if (rows.length > 4096) throw new DrawingPolicyError('POLICY_STORAGE_INVALID', 500, 'Cable positioning exceeds its storage limit.');
  return rows.map(row => drawingPurposeRuleSchema.parse({ purposeKey: row.purpose_key, categoryModes: row.category_modes })).sort((a, b) => compare(a.purposeKey, b.purposeKey));
}

/** Internal read: caller holds its authorized project transaction. It grants no admin API access. */
export async function readDrawingPolicy(client: PoolClient, projectId: string) {
  const state = await readPurposePolicyState(client, projectId, { lock: true });
  return drawingPurposePolicySchema.parse({ schemaVersion: 'pathfinder.drawing-purpose-policy.v1', projectId, catalogRevision: state.catalogRevision, drawingPolicyRevision: state.drawingPolicyRevision, rules: await activeRules(client, projectId) });
}

/** Caller owns a project-first transaction; authoring additionally rechecks true admin here. */
export async function saveDrawingPolicy(client: PoolClient, projectId: string, who: JobPrincipal, input: unknown) {
  if (!policyUuidSchema.safeParse(who.userId).success || !policyUuidSchema.safeParse(who.loginId).success) throw new DrawingPolicyError('LOGIN_REFRESH_REQUIRED', 401, 'Sign in again.');
  assertLoginNotExpired(who);
  const account = (await client.query<{ is_admin: boolean }>('SELECT is_admin FROM users WHERE id=$1 FOR SHARE', [who.userId])).rows[0];
  if (!account) throw new DrawingPolicyError('LOGIN_REVOKED', 401, 'Sign in again.');
  if (account.is_admin !== true) throw new DrawingPolicyError('ADMIN_REQUIRED', 403, 'Administrator access is required.');
  await requireCurrentLogin(client, who);
  if (input && typeof input === 'object' && (input as Record<string, unknown>).schemaVersion !== 'pathfinder.drawing-purpose-policy.write.v1') throw new DrawingPolicyError('UNSUPPORTED_CONTRACT_VERSION', 400, 'The cable positioning contract version is unsupported.');
  const command = drawingPurposeWriteSchema.parse(input), sha256 = requestHash(command);
  const state = await readPurposePolicyState(client, projectId, { lock: true }), current = revisions(state);
  const historical = (await client.query<Row>('SELECT request_sha256,request_body,receipt FROM pf_drawing_policy_receipts WHERE project_id=$1 AND actor_id=$2 AND idempotency_key=$3', [projectId, who.userId, command.idempotencyKey])).rows[0];
  if (historical) {
    if (historical.request_sha256 !== sha256 || canonicalPurposeJson(historical.request_body) !== canonicalPurposeJson(command)) throw new DrawingPolicyError('IDEMPOTENCY_CONFLICT', 409, 'This save key already belongs to another request.', current);
    return drawingPolicySaveSchema.parse({ ...historical.receipt, duplicate: true });
  }
  if (command.expectedCatalogRevision !== state.catalogRevision) throw new DrawingPolicyError('CATALOG_REVISION_CONFLICT', 409, 'The tray catalog changed. Refresh before saving.', current);
  if (command.expectedRevision !== state.drawingPolicyRevision) throw new DrawingPolicyError('POLICY_REVISION_CONFLICT', 409, 'Cable positioning changed. Refresh before saving.', current);
  if (state.drawingPolicyRevision === '9223372036854775807') throw new DrawingPolicyError('POLICY_REVISION_EXHAUSTED', 409, 'Cable positioning revision capacity is exhausted.', current);
  const catalog = await readCatalog(client, projectId), incarnations = await readActivePurposeIncarnations(client, projectId);
  if (catalog.catalogRevision !== state.catalogRevision) throw new DrawingPolicyError('CATALOG_REVISION_CONFLICT', 409, 'The tray catalog changed. Refresh before saving.', current);
  const blocked = new Set(drawingPurposeDiagnostics(catalog.diagnostics).flatMap(diagnostic => diagnostic.projectTrayIds));
  for (const change of command.changes) {
    const rows = catalog.rows.filter(row => row.purposeKey === change.purposeKey);
    if (!rows.length || rows.some(row => blocked.has(row.projectTrayId)) || new Set(rows.map(row => row.rawPurpose)).size !== 1 || !incarnations.some(row => row.purposeKey === change.purposeKey && row.rowCount > 0)) throw new DrawingPolicyError('PURPOSE_UNAVAILABLE', 409, 'A purpose is missing, detached or ambiguous. Resolve the catalog and refresh.', current);
  }
  const beforeRules = await activeRules(client, projectId);
  for (const change of command.changes) {
    const incarnation = incarnations.find(row => row.purposeKey === change.purposeKey)!;
    if (isDefaultDrawingModes(change.categoryModes)) await client.query('DELETE FROM pf_drawing_purpose_rules WHERE project_id=$1 AND purpose_key=$2 AND purpose_incarnation_id=$3', [projectId, change.purposeKey, incarnation.incarnationId]);
    else await client.query(`INSERT INTO pf_drawing_purpose_rules(project_id,purpose_key,purpose_incarnation_id,category_modes) VALUES($1,$2,$3,$4::jsonb)
      ON CONFLICT(project_id,purpose_key,purpose_incarnation_id) DO UPDATE SET category_modes=EXCLUDED.category_modes`, [projectId, change.purposeKey, incarnation.incarnationId, JSON.stringify(change.categoryModes)]);
  }
  const afterRules = await activeRules(client, projectId);
  const changed = (await client.query<{ revision: string }>(`UPDATE pf_purpose_project_state SET drawing_policy_revision=drawing_policy_revision+1,updated_at=NOW()
    WHERE project_id=$1 AND catalog_revision=$2::bigint AND drawing_policy_revision=$3::bigint RETURNING drawing_policy_revision::text AS revision`, [projectId, state.catalogRevision, state.drawingPolicyRevision])).rows[0];
  if (!changed) throw new DrawingPolicyError('POLICY_REVISION_CONFLICT', 409, 'Cable positioning changed. Refresh before saving.', current);
  const auditId = randomUUID(), receipt = drawingPolicySaveSchema.parse({ schemaVersion: 'pathfinder.policy-save.v1', projectId, domain: 'drawing', catalogRevision: state.catalogRevision, previousRevision: state.drawingPolicyRevision, revision: changed.revision, auditId, duplicate: false });
  await client.query(`INSERT INTO pf_drawing_policy_history(audit_id,project_id,actor_id,login_id,occurred_at,catalog_revision,previous_revision,revision,idempotency_key,request_sha256,before_rules,after_rules)
    VALUES($1,$2,$3,$4,$5::timestamptz,$6::bigint,$7::bigint,$8::bigint,$9,$10,$11::jsonb,$12::jsonb)`, [auditId, projectId, who.userId, who.loginId, new Date().toISOString(), state.catalogRevision, state.drawingPolicyRevision, changed.revision, command.idempotencyKey, sha256, JSON.stringify(beforeRules), JSON.stringify(afterRules)]);
  await client.query('INSERT INTO pf_drawing_policy_receipts(project_id,actor_id,idempotency_key,request_sha256,request_body,receipt,audit_id) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)', [projectId, who.userId, command.idempotencyKey, sha256, JSON.stringify(command), JSON.stringify(receipt), auditId]);
  assertLoginNotExpired(who); return receipt;
}

/** Internal admin history read: caller retains current authorization through commit. */
export async function readDrawingPolicyHistory(client: PoolClient, projectId: string, { limit = 50, beforeRevision }: { limit?: number; beforeRevision?: string } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || beforeRevision !== undefined && !policyRevisionSchema.safeParse(beforeRevision).success) throw new DrawingPolicyError('INVALID_POLICY_HISTORY', 400, 'Use a valid history cursor and limit.');
  const rows = (await client.query<Row>(`SELECT audit_id,project_id,actor_id,login_id,occurred_at,catalog_revision::text,previous_revision::text,revision::text,idempotency_key,request_sha256,before_rules,after_rules
    FROM pf_drawing_policy_history WHERE project_id=$1 AND ($2::bigint IS NULL OR revision<$2::bigint) ORDER BY revision DESC LIMIT $3`, [projectId, beforeRevision ?? null, limit + 1])).rows;
  return drawingPolicyHistorySchema.parse({ schemaVersion: 'pathfinder.policy-history.v1', projectId, domain: 'drawing', events: rows.slice(0, limit).map(row => ({ auditId: row.audit_id, projectId: row.project_id, domain: 'drawing', actorId: row.actor_id, loginId: row.login_id, occurredAt: new Date(row.occurred_at).toISOString(), catalogRevision: row.catalog_revision, previousRevision: row.previous_revision, revision: row.revision, idempotencyKey: row.idempotency_key, requestSha256: row.request_sha256, beforeRules: row.before_rules, afterRules: row.after_rules })), nextBeforeRevision: rows.length > limit ? rows[limit - 1].revision : null });
}

export function createDrawingPolicyRepository(pool: Pool) {
  return {
    authorize: (projectId: string, who: JobPrincipal) => purposePolicyTransaction(pool, projectId, who, async client => revisions(await readPurposePolicyState(client, projectId, { lock: true }))),
    get: (projectId: string, who: JobPrincipal) => purposePolicyTransaction(pool, projectId, who, client => readDrawingPolicy(client, projectId)),
    save: (projectId: string, who: JobPrincipal, input: unknown) => purposePolicyTransaction(pool, projectId, who, client => saveDrawingPolicy(client, projectId, who, input)),
    history: (projectId: string, who: JobPrincipal, options: { limit?: number; beforeRevision?: string }) => purposePolicyTransaction(pool, projectId, who, client => readDrawingPolicyHistory(client, projectId, options)),
  };
}
