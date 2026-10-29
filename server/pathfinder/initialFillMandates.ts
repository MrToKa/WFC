import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { canonicalPurposeJson, policyHashSchema, policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { INITIAL_FILL_LIMITS, initialFillMandateContentHashInput, initialFillMandateRecordSchema, initialFillMandateReference,
  type InitialFillMandate } from '../../shared/pathfinderInitialFill.js';
import { locationImpactRecordSchema, type LocationImpactRecord } from '../../shared/pathfinderLocationImpacts.js';
import { cableEndpointCommandSchema } from '../../shared/pathfinderCableEndpoints.js';
import type { JobPrincipal } from './jobContracts.js';
import { assertLoginNotExpired } from './auth.js';
import { endpointBindingHash as digest } from './endpointBindingRepository.js';
import { readLocationImpactJobAuthority } from './locationImpactRepository.js';
import { PathFinderError } from './errors.js';

type Client = Pick<PoolClient, 'query'>;
type Row = Record<string, any>;
const fail = (code: string, status = 409): never => { throw new PathFinderError(code, status, 'The explicit initial-fill mandate is unavailable, expired or outside this exact cable scope.'); };
const recordSql = `SELECT project_id,id,impact_id,actor_id,login_id,idempotency_key,command_sha256,record_sha256,
 CASE WHEN octet_length(record::text)<=1048576 THEN record ELSE NULL END AS record FROM pf_initial_fill_mandates`;
function verified(row: Row): InitialFillMandate {
  const parsed = initialFillMandateRecordSchema.safeParse(row.record); if (!parsed.success) return fail('INITIAL_FILL_MANDATE_INTEGRITY'); const record = parsed.data;
  if (record.projectId !== row.project_id || record.id !== row.id || record.impactId !== row.impact_id || record.actorId !== row.actor_id || record.loginId !== row.login_id
    || record.idempotencyKey !== row.idempotency_key || record.commandSha256 !== row.command_sha256 || record.contentSha256 !== row.record_sha256
    || digest(initialFillMandateContentHashInput(record)) !== record.contentSha256) return fail('INITIAL_FILL_MANDATE_INTEGRITY'); return record;
}
async function readImpact(client: Client, projectId: string, impactId: string, lock = false): Promise<LocationImpactRecord> {
  const raw = (await client.query<Row>(`SELECT project_id,id,actor_id,login_id,idempotency_key,command_sha256,record_sha256,
    CASE WHEN octet_length(record::text)<=1048576 THEN record ELSE NULL END AS record FROM pf_location_impacts WHERE project_id=$1 AND id=$2${lock ? ' FOR SHARE' : ''}`, [projectId, impactId])).rows[0];
  if (!raw) return fail('INITIAL_FILL_IMPACT_REQUIRED'); const parsed = locationImpactRecordSchema.safeParse(raw.record);
  if (!parsed.success) return fail('INITIAL_FILL_IMPACT_INTEGRITY'); const value = parsed.data, { contentSha256, ...body } = value;
  if (value.projectId !== projectId || value.id !== impactId || value.actorId !== raw.actor_id || value.loginId !== raw.login_id || value.idempotencyKey !== raw.idempotency_key
    || value.commandSha256 !== raw.command_sha256 || contentSha256 !== raw.record_sha256 || digest(body) !== contentSha256) return fail('INITIAL_FILL_IMPACT_INTEGRITY'); return value;
}
/** Historical loader: immutable ownership/hash proof only. Expired old login does not erase a committed write. */
export async function readInitialFillMandate(client: Client, projectId: string, mandateId: string, lock = false): Promise<InitialFillMandate | null> {
  policyUuidSchema.parse(projectId); policyUuidSchema.parse(mandateId);
  const row = (await client.query<Row>(recordSql + ` WHERE project_id=$1 AND id=$2${lock ? ' FOR SHARE' : ''}`, [projectId, mandateId])).rows[0]; return row ? verified(row) : null;
}
export async function readInitialFillMandateForImpact(client: Client, projectId: string, impactId: string, lock = false): Promise<InitialFillMandate | null> {
  policyUuidSchema.parse(projectId); policyUuidSchema.parse(impactId);
  const row = (await client.query<Row>(recordSql + ` WHERE project_id=$1 AND impact_id=$2${lock ? ' FOR SHARE' : ''}`, [projectId, impactId])).rows[0]; return row ? verified(row) : null;
}
/** Called only for explicit v3 when-both-empty, inside the same authorized binding/impact transaction. */
export async function appendInitialFillMandateInTransaction(client: Client, input: { projectId: string; principal: JobPrincipal; impactId: string;
  commandSha256: string; idempotencyKey: string; command: unknown }, check: () => void) {
  check(); const projectId = policyUuidSchema.parse(input.projectId), impactId = policyUuidSchema.parse(input.impactId); policyUuidSchema.parse(input.idempotencyKey); policyHashSchema.parse(input.commandSha256);
  const command = cableEndpointCommandSchema.parse(input.command);
  if (command.schemaVersion !== 'wfc.pf.cable-endpoint-command.v3' || command.initialFill?.mode !== 'when-both-empty'
    || command.idempotencyKey !== input.idempotencyKey || digest(command) !== input.commandSha256) return fail('INITIAL_FILL_EXPLICIT_MANDATE_REQUIRED');
  assertLoginNotExpired(input.principal); const impact = await readImpact(client, projectId, impactId, true);
  if (impact.actorId !== input.principal.userId || impact.loginId !== input.principal.loginId || Date.parse(impact.loginExpiresAt) !== input.principal.loginExpiresAt
    || impact.idempotencyKey !== input.idempotencyKey || impact.commandSha256 !== input.commandSha256
    || canonicalPurposeJson(command.expectedCurrent) !== canonicalPurposeJson(impact.current)
    || canonicalPurposeJson(command.calculation) !== canonicalPurposeJson(impact.calculation)) return fail('INITIAL_FILL_MANDATE_SCOPE');
  const previous = await readInitialFillMandateForImpact(client, projectId, impactId, true);
  if (previous) { if (previous.commandSha256 !== input.commandSha256 || previous.idempotencyKey !== input.idempotencyKey || previous.actorId !== input.principal.userId) return fail('INITIAL_FILL_MANDATE_CONFLICT'); return initialFillMandateReference(previous); }
  const now = new Date().toISOString(), draft = initialFillMandateRecordSchema.parse({ schemaVersion: 'wfc.pf.initial-fill-mandate.v1', id: randomUUID(), projectId,
    impactId, impactContentSha256: impact.contentSha256, commandSha256: input.commandSha256, idempotencyKey: input.idempotencyKey, mode: 'when-both-empty',
    actorId: impact.actorId, actorAdminRevision: impact.actorAdminRevision, loginId: impact.loginId, loginExpiresAt: impact.loginExpiresAt,
    authorityExpiresAt: impact.authorityExpiresAt, installationEpoch: impact.installationEpoch, current: impact.current,
    eligibleCableIds: impact.eligibleCableIds, createdAt: now, contentSha256: '0'.repeat(64) });
  const record = initialFillMandateRecordSchema.parse({ ...draft, contentSha256: digest(initialFillMandateContentHashInput(draft)) });
  if (Buffer.byteLength(canonicalPurposeJson(record)) > INITIAL_FILL_LIMITS.recordBytes) return fail('INITIAL_FILL_MANDATE_LIMIT', 413);
  check(); await client.query('INSERT INTO pf_initial_fill_mandates(project_id,id,impact_id,actor_id,login_id,idempotency_key,command_sha256,record_sha256,record,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [projectId, record.id, impactId, record.actorId, record.loginId, record.idempotencyKey, record.commandSha256, record.contentSha256, record, record.createdAt]); return initialFillMandateReference(record);
}
/** A live write requires this separate mandate AND the exact current item; calculation authority alone is insufficient. */
export async function requireCurrentInitialFillMandate(client: Client, input: { projectId: string; mandateId: string; impactId: string; jobId: string;
  cableId: string; principal?: JobPrincipal; lock?: boolean }): Promise<InitialFillMandate> {
  const lock = input.lock ?? true, mandate = await readInitialFillMandate(client, input.projectId, input.mandateId, lock);
  if (!mandate || mandate.impactId !== input.impactId || !mandate.eligibleCableIds.includes(input.cableId)) return fail('INITIAL_FILL_MANDATE_SCOPE');
  if (input.principal && (input.principal.userId !== mandate.actorId || input.principal.loginId !== mandate.loginId || input.principal.loginExpiresAt !== Date.parse(mandate.loginExpiresAt))) return fail('INITIAL_FILL_MANDATE_PRINCIPAL');
  const impact = await readImpact(client, input.projectId, input.impactId, lock);
  if (impact.contentSha256 !== mandate.impactContentSha256 || impact.actorId !== mandate.actorId || impact.actorAdminRevision !== mandate.actorAdminRevision
    || impact.loginId !== mandate.loginId || impact.loginExpiresAt !== mandate.loginExpiresAt || impact.authorityExpiresAt !== mandate.authorityExpiresAt
    || impact.installationEpoch !== mandate.installationEpoch || impact.commandSha256 !== mandate.commandSha256 || impact.idempotencyKey !== mandate.idempotencyKey
    || canonicalPurposeJson(impact.current) !== canonicalPurposeJson(mandate.current) || canonicalPurposeJson(impact.eligibleCableIds) !== canonicalPurposeJson(mandate.eligibleCableIds)) return fail('INITIAL_FILL_MANDATE_INTEGRITY');
  if (Math.min(Date.parse(mandate.authorityExpiresAt), Date.parse(mandate.loginExpiresAt)) <= Date.now()) return fail('INITIAL_FILL_MANDATE_EXPIRED', 401);
  const authority = await readLocationImpactJobAuthority(client, { projectId: input.projectId, jobId: input.jobId, cableId: input.cableId, lock });
  if (!authority || authority.impactId !== mandate.impactId || !authority.valid) return fail(authority?.code ?? 'INITIAL_FILL_IMPACT_REQUIRED');
  return mandate;
}
