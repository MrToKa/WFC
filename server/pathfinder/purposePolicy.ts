import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { routePurposePolicySchema, routePurposeWriteSchema, routingRuleSchema, routingCategoriesSchema, policySaveSchema, policyHistorySchema, policyUuidSchema, policyRevisionSchema, routingCatalogDiagnostics } from '../../shared/pathfinderPurposePolicy.js';
import { projectCablePurposeCatalog } from '../../shared/routingCablePurposes.js';
import { PathFinderError } from './errors.js';
import { assertLoginNotExpired, requireCurrentLogin } from './auth.js';
import type { JobPrincipal } from './jobContracts.js';
import { readCatalog, readRoutingCatalogScope } from './catalog.js';
import { readActivePurposeIncarnations, readPurposePolicyState } from './policySchema.js';

export type RoutingPolicyScope = { catalogRevision: string; routingContentSha256: string; routingPolicyRevision: string; routingPolicySha256: string };
export type PolicyRevisions = { catalogRevision: string; routingPolicyRevision: string; drawingPolicyRevision: string };
type Write = z.infer<typeof routePurposeWriteSchema>;
type Policy = z.infer<typeof routePurposePolicySchema>;
type Rule = Policy['rules'][number];
type Row = Record<string, any>;
const MAX_REVISION = 9223372036854775807n;
const validUuid = (value: unknown): value is string => policyUuidSchema.safeParse(value).success;
const canonical = (value: unknown): string => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])).join(',') + '}';
const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const revisions = (state: PolicyRevisions): PolicyRevisions => ({ catalogRevision: state.catalogRevision, routingPolicyRevision: state.routingPolicyRevision, drawingPolicyRevision: state.drawingPolicyRevision });
export class PurposePolicyError extends PathFinderError {
  constructor(code: string, status = 400, message = 'Routing permissions could not be processed.', public readonly currentRevisions: PolicyRevisions | null = null) { super(code, status, message); }
}

/** Called after initializePurposePolicySchema; original application schemas are not changed here. */
export async function initializeRoutingPolicySchema(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('wfc-purpose-policy-schema-v1'))");
    await client.query(`
    CREATE TABLE IF NOT EXISTS pf_routing_purpose_rules (
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      purpose_key TEXT NOT NULL, purpose_incarnation_id UUID NOT NULL,
      allowed_categories JSONB NOT NULL CHECK(jsonb_typeof(allowed_categories)='array'),
      PRIMARY KEY(project_id,purpose_key,purpose_incarnation_id),
      FOREIGN KEY(project_id,purpose_key,purpose_incarnation_id)
        REFERENCES pf_catalog_purpose_incarnations(project_id,purpose_key,incarnation_id)
    );
    CREATE TABLE IF NOT EXISTS pf_routing_policy_history (
      audit_id UUID PRIMARY KEY, project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      actor_id UUID NOT NULL, login_id UUID NOT NULL, occurred_at TIMESTAMPTZ NOT NULL,
      catalog_revision BIGINT NOT NULL CHECK(catalog_revision>=0), previous_revision BIGINT NOT NULL CHECK(previous_revision>=0),
      revision BIGINT NOT NULL CHECK(revision>previous_revision), idempotency_key UUID NOT NULL,
      request_sha256 TEXT NOT NULL CHECK(request_sha256 ~ '^[0-9a-f]{64}$'), before_rules JSONB NOT NULL, after_rules JSONB NOT NULL,
      UNIQUE(project_id,revision), UNIQUE(project_id,actor_id,idempotency_key)
    );
    CREATE TABLE IF NOT EXISTS pf_routing_policy_receipts (
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE, actor_id UUID NOT NULL, idempotency_key UUID NOT NULL,
      request_sha256 TEXT NOT NULL CHECK(request_sha256 ~ '^[0-9a-f]{64}$'), request_body JSONB NOT NULL,
      receipt JSONB NOT NULL, audit_id UUID NOT NULL REFERENCES pf_routing_policy_history(audit_id),
      PRIMARY KEY(project_id,actor_id,idempotency_key)
    );
    CREATE OR REPLACE FUNCTION protect_pf_routing_policy_record() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) THEN RETURN OLD; END IF;
      RAISE EXCEPTION 'immutable routing policy record'; END $$;
    DROP TRIGGER IF EXISTS pf_routing_policy_history_immutable ON pf_routing_policy_history;
    CREATE TRIGGER pf_routing_policy_history_immutable BEFORE UPDATE OR DELETE ON pf_routing_policy_history FOR EACH ROW EXECUTE FUNCTION protect_pf_routing_policy_record();
    DROP TRIGGER IF EXISTS pf_routing_policy_receipts_immutable ON pf_routing_policy_receipts;
    CREATE TRIGGER pf_routing_policy_receipts_immutable BEFORE UPDATE OR DELETE ON pf_routing_policy_receipts FOR EACH ROW EXECUTE FUNCTION protect_pf_routing_policy_record();
    `);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
  finally { client.release(); }
}

/** Project-first locking matches existing PF operations; defer project 404 until current authority is established. */
export async function purposePolicyTransaction<T>(pool: Pool, projectId: string, who: JobPrincipal, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  if (!validUuid(projectId)) throw new PurposePolicyError('INVALID_POLICY_PROJECT', 400, 'Use a valid project identifier.');
  if (!validUuid(who.userId) || !validUuid(who.loginId)) throw new PurposePolicyError('LOGIN_REFRESH_REQUIRED', 401, 'Sign in again.');
  assertLoginNotExpired(who);
  const client = await pool.connect(); let began = false, authority = false, current: PolicyRevisions | null = null;
  try {
    await client.query('BEGIN'); began = true;
    const exists = (await client.query('SELECT id FROM projects WHERE id=$1 FOR NO KEY UPDATE', [projectId])).rows.length === 1;
    const account = (await client.query<{ is_admin: boolean }>('SELECT is_admin FROM users WHERE id=$1 FOR SHARE', [who.userId])).rows[0];
    if (!account) throw new PurposePolicyError('LOGIN_REVOKED', 401, 'Sign in again.');
    if (account.is_admin !== true) throw new PurposePolicyError('ADMIN_REQUIRED', 403, 'Administrator access is required.');
    await requireCurrentLogin(client, who); authority = true;
    if (!exists) throw new PurposePolicyError('PROJECT_NOT_FOUND', 404, 'The project is unavailable.');
    current = revisions(await readPurposePolicyState(client, projectId, { lock: true }));
    const result = await operation(client); assertLoginNotExpired(who);
    await client.query('COMMIT'); began = false; return result;
  } catch (error) {
    if (began) await client.query('ROLLBACK').catch(() => undefined);
    if (error instanceof PurposePolicyError) throw new PurposePolicyError(error.code, error.status, error.message, [401, 403].includes(error.status) ? null : error.currentRevisions ?? current);
    if (error instanceof PathFinderError) throw new PurposePolicyError(error.code, error.status, error.message, authority && ![401, 403].includes(error.status) ? current : null);
    if (error instanceof z.ZodError) throw new PurposePolicyError('INVALID_POLICY_REQUEST', 400, 'The routing permission request is invalid.', current);
    throw new PurposePolicyError('POLICY_FAILURE', 500, 'Routing permissions could not be processed. Refresh before retrying the same save.', current);
  } finally { client.release(); }
}

async function activeRules(client: PoolClient, projectId: string): Promise<(Rule & { incarnationId: string })[]> {
  const rows = (await client.query<Row>(`SELECT r.purpose_key,r.purpose_incarnation_id,r.allowed_categories
    FROM pf_routing_purpose_rules r JOIN pf_catalog_purpose_incarnations i
      ON i.project_id=r.project_id AND i.purpose_key=r.purpose_key AND i.incarnation_id=r.purpose_incarnation_id
    WHERE r.project_id=$1 AND i.active=TRUE AND i.row_count>0 ORDER BY r.purpose_key COLLATE "C" LIMIT 4097`, [projectId])).rows;
  if (rows.length > 4096) throw new PurposePolicyError('POLICY_STORAGE_INVALID', 500, 'The routing permission state exceeds its limit.');
  return rows.map(row => {
    const rule = routingRuleSchema.parse({ purposeKey: row.purpose_key, allowedCategories: row.allowed_categories });
    if (!validUuid(row.purpose_incarnation_id)) throw new PurposePolicyError('POLICY_STORAGE_INVALID', 500);
    return { ...rule, incarnationId: row.purpose_incarnation_id };
  }).sort((a, b) => compare(a.purposeKey, b.purposeKey));
}
const publicRules = (rules: (Rule & { incarnationId: string })[]): Rule[] => rules.map(({ purposeKey, allowedCategories }) => ({ purposeKey, allowedCategories }));

/** Cable type names and physical properties are outside routing permission identity. */
export async function readProjectCablePurposes(client: PoolClient, projectId: string): Promise<{cablePurposes:string[];cablePurposesSha256:string;invalidCablePurposeCount:number}> {
  const rows = (await client.query<{purpose:string|null}>('SELECT DISTINCT purpose COLLATE "C" AS purpose FROM cable_types WHERE project_id=$1 ORDER BY purpose COLLATE "C" LIMIT 4097', [projectId])).rows;
  if (rows.length > 4096) throw new PurposePolicyError('CABLE_PURPOSE_LIMIT', 413, 'The project has too many distinct cable purposes.');
  const {cablePurposes,invalidCablePurposeCount} = projectCablePurposeCatalog(rows.map(row => row.purpose));
  return { cablePurposes, invalidCablePurposeCount, cablePurposesSha256: digest({schemaVersion:'pathfinder.cable-purpose-catalog.v1',projectId,cablePurposes}) };
}

/** Caller holds its project mutex; the catalog state lock fences direct SQL changes until commit. */
export async function readRoutingPolicyScope(client: PoolClient, projectId: string): Promise<RoutingPolicyScope> {
  const state = await readPurposePolicyState(client, projectId, { lock: true });
  const catalog = await readRoutingCatalogScope(client, projectId), rules = await activeRules(client, projectId), purposes = await readProjectCablePurposes(client, projectId);
  if (state.catalogRevision !== catalog.catalogRevision) throw new PurposePolicyError('CATALOG_REVISION_CONFLICT', 409, 'The tray catalog changed. Refresh and prepare it again.', revisions(state));
  return { catalogRevision: state.catalogRevision, routingContentSha256: catalog.routingContentSha256, routingPolicyRevision: state.routingPolicyRevision,
    routingPolicySha256: digest({ schemaVersion: 'pathfinder.routing-purpose-policy-content.v2', projectId, rules, cablePurposes:purposes.cablePurposes }) };
}

export function createPurposePolicyRepository(pool: Pool) {
  const authorize = (projectId: string, who: JobPrincipal) => purposePolicyTransaction(pool, projectId, who, async client => revisions(await readPurposePolicyState(client, projectId, { lock: true })));
  const get = (projectId: string, who: JobPrincipal) => purposePolicyTransaction(pool, projectId, who, async client => {
    const state = await readPurposePolicyState(client, projectId, { lock: true });
    return routePurposePolicySchema.parse({ schemaVersion: 'pathfinder.routing-purpose-policy.v1', projectId, catalogRevision: state.catalogRevision, routingPolicyRevision: state.routingPolicyRevision, rules: publicRules(await activeRules(client, projectId)), ...await readProjectCablePurposes(client, projectId) });
  });
  const save = (projectId: string, who: JobPrincipal, input: unknown) => purposePolicyTransaction(pool, projectId, who, async client => {
    if (input && typeof input === 'object' && (input as Record<string, unknown>).schemaVersion !== 'pathfinder.routing-purpose-policy.write.v1') throw new PurposePolicyError('UNSUPPORTED_CONTRACT_VERSION', 400, 'The routing permission contract version is unsupported.');
    const command: Write = routePurposeWriteSchema.parse(input), requestSha256 = digest(command);
    const state = await readPurposePolicyState(client, projectId, { lock: true }), current = revisions(state);
    const historical = (await client.query<Row>('SELECT request_sha256,request_body,receipt FROM pf_routing_policy_receipts WHERE project_id=$1 AND actor_id=$2 AND idempotency_key=$3', [projectId, who.userId, command.idempotencyKey])).rows[0];
    if (historical) {
      if (historical.request_sha256 !== requestSha256 || canonical(historical.request_body) !== canonical(command)) throw new PurposePolicyError('IDEMPOTENCY_CONFLICT', 409, 'This save key already belongs to another request.', current);
      return policySaveSchema.parse({ ...historical.receipt, duplicate: true });
    }
    if (command.expectedCatalogRevision !== state.catalogRevision) throw new PurposePolicyError('CATALOG_REVISION_CONFLICT', 409, 'The tray catalog changed. Refresh before saving.', current);
    if (command.expectedRevision !== state.routingPolicyRevision) throw new PurposePolicyError('POLICY_REVISION_CONFLICT', 409, 'Routing permissions changed. Refresh before saving.', current);
    if (command.expectedCablePurposesSha256 !== undefined) {
      const purposes = await readProjectCablePurposes(client, projectId);
      if (command.expectedCablePurposesSha256 !== purposes.cablePurposesSha256) throw new PurposePolicyError('CABLE_PURPOSES_CONFLICT', 409, 'The project cable purposes changed. Refresh before saving.', current);
      if (command.changes.some(change => change.operation === 'set' && change.allowedCategories.some(value => !purposes.cablePurposes.includes(value))))
        throw new PurposePolicyError('CABLE_PURPOSE_UNAVAILABLE', 409, 'A selected cable purpose is no longer in the project. Refresh before saving.', current);
    } else {
      // Old clients retain their original fixed-category write contract.
      for (const change of command.changes) if (change.operation === 'set') routingCategoriesSchema.parse(change.allowedCategories);
    }
    if (BigInt(state.routingPolicyRevision) === MAX_REVISION) throw new PurposePolicyError('POLICY_REVISION_EXHAUSTED', 409, 'Routing permission revision capacity is exhausted.', current);
    const catalog = await readCatalog(client, projectId), incarnations = await readActivePurposeIncarnations(client, projectId);
    if (catalog.catalogRevision !== state.catalogRevision) throw new PurposePolicyError('CATALOG_REVISION_CONFLICT', 409, 'The tray catalog changed.', current);
    const blockedIds = new Set(routingCatalogDiagnostics(catalog.diagnostics).flatMap(diagnostic => diagnostic.projectTrayIds));
    const authorable = new Set(catalog.rows.filter(row => row.purposeKey !== null && !blockedIds.has(row.projectTrayId)).map(row => row.purposeKey));
    for (const change of command.changes) {
      const rows = catalog.rows.filter(row => row.purposeKey === change.purposeKey);
      if (!authorable.has(change.purposeKey) || rows.some(row => blockedIds.has(row.projectTrayId)) || new Set(rows.map(row => row.rawPurpose)).size !== 1 || !incarnations.some(row => row.purposeKey === change.purposeKey && row.rowCount > 0)) throw new PurposePolicyError('PURPOSE_UNAVAILABLE', 409, 'A purpose is missing, detached or ambiguous. Resolve the catalog and refresh.', current);
    }
    const beforeRules = publicRules(await activeRules(client, projectId));
    for (const change of command.changes) {
      const incarnation = incarnations.find(row => row.purposeKey === change.purposeKey)!;
      if (change.operation === 'reset') await client.query('DELETE FROM pf_routing_purpose_rules WHERE project_id=$1 AND purpose_key=$2 AND purpose_incarnation_id=$3', [projectId, change.purposeKey, incarnation.incarnationId]);
      else await client.query(`INSERT INTO pf_routing_purpose_rules(project_id,purpose_key,purpose_incarnation_id,allowed_categories) VALUES($1,$2,$3,$4::jsonb)
        ON CONFLICT(project_id,purpose_key,purpose_incarnation_id) DO UPDATE SET allowed_categories=EXCLUDED.allowed_categories`, [projectId, change.purposeKey, incarnation.incarnationId, JSON.stringify(change.allowedCategories)]);
    }
    const afterRules = publicRules(await activeRules(client, projectId));
    const changed = (await client.query<Row>(`UPDATE pf_purpose_project_state SET routing_policy_revision=routing_policy_revision+1,updated_at=NOW()
      WHERE project_id=$1 AND catalog_revision=$2::bigint AND routing_policy_revision=$3::bigint RETURNING routing_policy_revision::text AS revision`, [projectId, state.catalogRevision, state.routingPolicyRevision])).rows[0];
    if (!changed) throw new PurposePolicyError('POLICY_REVISION_CONFLICT', 409, 'Routing permissions changed.', current);
    const auditId = randomUUID(), occurredAt = new Date().toISOString();
    const receipt = policySaveSchema.parse({ schemaVersion: 'pathfinder.policy-save.v1', projectId, domain: 'routing', catalogRevision: state.catalogRevision, previousRevision: state.routingPolicyRevision, revision: changed.revision, auditId, duplicate: false });
    await client.query(`INSERT INTO pf_routing_policy_history(audit_id,project_id,actor_id,login_id,occurred_at,catalog_revision,previous_revision,revision,idempotency_key,request_sha256,before_rules,after_rules)
      VALUES($1,$2,$3,$4,$5::timestamptz,$6::bigint,$7::bigint,$8::bigint,$9,$10,$11::jsonb,$12::jsonb)`, [auditId, projectId, who.userId, who.loginId, occurredAt, state.catalogRevision, state.routingPolicyRevision, changed.revision, command.idempotencyKey, requestSha256, JSON.stringify(beforeRules), JSON.stringify(afterRules)]);
    await client.query('INSERT INTO pf_routing_policy_receipts(project_id,actor_id,idempotency_key,request_sha256,request_body,receipt,audit_id) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)', [projectId, who.userId, command.idempotencyKey, requestSha256, JSON.stringify(command), JSON.stringify(receipt), auditId]);
    return receipt;
  });
  const history = (projectId: string, who: JobPrincipal, options: { beforeRevision?: string; limit?: number }) => purposePolicyTransaction(pool, projectId, who, async client => {
    const limit = options.limit ?? 50, before = options.beforeRevision ?? null;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || before !== null && !policyRevisionSchema.safeParse(before).success) throw new PurposePolicyError('INVALID_POLICY_HISTORY', 400, 'Use a valid history cursor and limit.');
    const rows = (await client.query<Row>(`SELECT audit_id,project_id,actor_id,login_id,occurred_at,catalog_revision::text,previous_revision::text,revision::text,idempotency_key,request_sha256,before_rules,after_rules
      FROM pf_routing_policy_history WHERE project_id=$1 AND ($2::bigint IS NULL OR revision<$2::bigint) ORDER BY revision DESC LIMIT $3`, [projectId, before, limit + 1])).rows;
    return policyHistorySchema.parse({ schemaVersion: 'pathfinder.policy-history.v1', projectId, domain: 'routing', events: rows.slice(0, limit).map(row => ({ auditId: row.audit_id, projectId: row.project_id, domain: 'routing', actorId: row.actor_id, loginId: row.login_id, occurredAt: new Date(row.occurred_at).toISOString(), catalogRevision: row.catalog_revision, previousRevision: row.previous_revision, revision: row.revision, idempotencyKey: row.idempotency_key, requestSha256: row.request_sha256, beforeRules: row.before_rules, afterRules: row.after_rules })), nextBeforeRevision: rows.length > limit ? rows[limit - 1].revision : null });
  });
  return { authorize, get, save, history };
}
