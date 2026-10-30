import { randomUUID } from 'node:crypto';
import { isPathFinderCableEligible } from '../../shared/pathfinderCableEligibility.js';
import type { Pool, PoolClient } from 'pg';
import { canonicalPurposeJson, policyHashSchema, policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { LOCATION_IMPACT_LIMITS, locationImpactCalculationSchema, locationImpactItemSchema, locationImpactPageQuerySchema,
  locationImpactPageSchema, locationImpactProgressSchema, locationImpactRecordSchema, locationImpactReferenceSchema, locationImpactSummarySchema,
  type LocationImpactCalculation, type LocationImpactRecord, type LocationImpactPageQuery } from '../../shared/pathfinderLocationImpacts.js';
import type { EndpointBindingReceipt, EndpointCurrentScope } from '../../shared/pathfinderEndpointBindings.js';
import type { JobPrincipal } from './jobContracts.js';
import { assertLoginNotExpired } from './auth.js';
import { endpointBindingHash as digest, endpointBindingTransaction } from './endpointBindingRepository.js';
import { cableWorkflowReadTransaction } from './cableWorkflowRead.js';
import { schedulerTransaction } from './schedulerTransaction.js';
import { normalizeLocation } from './matching.js';
import { PathFinderError } from './errors.js';
import { automaticPairPolicySchema, type AutomaticPairPolicy } from '../../shared/pathfinderAutomaticPair.js';

type Row = Record<string, any>;
const fail = (code: string, status = 409): never => { throw new PathFinderError(code, status, 'The affected cable calculation cannot proceed under its original current scope.'); };
const iso = (value: string | Date) => new Date(value).toISOString();
const body = <T extends { contentSha256: string }>(value: T) => { const { contentSha256: _hash, ...rest } = value; return rest; };
function verifiedRecord(row: Row): LocationImpactRecord {
  const parsed = locationImpactRecordSchema.safeParse(row.record); if (!parsed.success) return fail('LOCATION_IMPACT_INTEGRITY');
  const value = parsed.data;
  if (digest(body(value)) !== value.contentSha256 || row.record_sha256 !== value.contentSha256 || row.project_id !== value.projectId || row.id !== value.id
    || row.actor_id !== value.actorId || row.login_id !== value.loginId || row.idempotency_key !== value.idempotencyKey || row.command_sha256 !== value.commandSha256) return fail('LOCATION_IMPACT_INTEGRITY');
  return value;
}
const recordSql = `SELECT i.project_id,i.id,i.actor_id,i.login_id,i.idempotency_key,i.command_sha256,i.record_sha256,
 CASE WHEN octet_length(i.record::text)<=1048576 THEN i.record ELSE NULL END AS record FROM pf_location_impacts i`;

/** Append only inside the exact successful endpoint save transaction. It performs no engine work or cable writes. */
export async function appendLocationImpactInTransaction(client: PoolClient, input: { projectId: string; principal: JobPrincipal;
  idempotencyKey: string; commandSha256: string; binding: EndpointBindingReceipt; current: EndpointCurrentScope;
  affectedCableIds: string[]; originCableId?: string; calculation: LocationImpactCalculation | null;
  automaticPairPolicy?: AutomaticPairPolicy | null }, check: () => void) {
  check(); const projectId = policyUuidSchema.parse(input.projectId), who = input.principal;
  policyUuidSchema.parse(input.idempotencyKey); policyHashSchema.parse(input.commandSha256); assertLoginNotExpired(who);
  const selected = [...new Set(input.affectedCableIds.map(value => policyUuidSchema.parse(value)))].sort();
  const originCableId = input.originCableId === undefined ? undefined : policyUuidSchema.parse(input.originCableId);
  const automaticPairPolicy = input.automaticPairPolicy === undefined || input.automaticPairPolicy === null
    ? input.automaticPairPolicy : automaticPairPolicySchema.parse(input.automaticPairPolicy);
  if (automaticPairPolicy !== undefined && originCableId === undefined) return fail('LOCATION_IMPACT_ORIGIN_SCOPE');
  if (selected.length !== input.affectedCableIds.length || selected.length > LOCATION_IMPACT_LIMITS.cables) return fail('LOCATION_IMPACT_CABLE_LIMIT', 413);
  if (originCableId !== undefined && !selected.includes(originCableId)) return fail('LOCATION_IMPACT_ORIGIN_SCOPE');
  if (input.binding.projectId !== projectId || input.binding.binding.modelVersionId !== input.current.modelVersionId || input.binding.binding.aggregateId !== input.current.aggregateId) return fail('LOCATION_IMPACT_BINDING_SCOPE');
  const prior = (await client.query<Row>(recordSql + ' WHERE i.project_id=$1 AND i.actor_id=$2 AND i.idempotency_key=$3', [projectId, who.userId, input.idempotencyKey])).rows[0];
  if (prior) {
    const record = verifiedRecord(prior); if (record.commandSha256 !== input.commandSha256
      || record.schemaVersion !== 'wfc.pf.location-impact-record.v1' && record.originCableId !== originCableId
      || record.schemaVersion === 'wfc.pf.location-impact-record.v3' && (automaticPairPolicy === undefined || digest(record.automaticPairPolicy) !== digest(automaticPairPolicy))
      || record.schemaVersion !== 'wfc.pf.location-impact-record.v3' && automaticPairPolicy !== undefined) return fail('LOCATION_IMPACT_IDEMPOTENCY_CONFLICT');
    return locationImpactReferenceSchema.parse({ id: record.id, status: record.calculation && record.eligibleCableIds.length ? 'pending' : 'blocked',
      eligibleCables: record.eligibleCableIds.length, excludedMvCables: record.excludedMvCableIds.length, blockedCategoryCables: record.blockedCategoryCableIds.length });
  }
  const history = (await client.query<{ count: number }>('SELECT count(*)::int AS count FROM (SELECT id FROM pf_location_impacts WHERE project_id=$1 LIMIT 10001) bounded', [projectId])).rows[0];
  if (!history || history.count >= LOCATION_IMPACT_LIMITS.history) return fail('LOCATION_IMPACT_HISTORY_LIMIT', 413);
  const admin = (await client.query<{ is_admin: boolean; revision: string }>('SELECT is_admin,pf_admin_revision::text AS revision FROM users WHERE id=$1 FOR SHARE', [who.userId])).rows[0];
  const installation = (await client.query<{ installation_epoch: string }>('SELECT installation_epoch FROM pf_installation_state WHERE singleton=true FOR SHARE')).rows[0];
  if (!admin?.is_admin) return fail('ADMIN_REQUIRED', 403); if (!installation) return fail('LOCATION_IMPACT_INSTALLATION_REQUIRED', 503);
  const cables: Row[] = []; let bytes = 0;
  for (let at = 0; at < selected.length; at += LOCATION_IMPACT_LIMITS.chunk) {
    check(); const ids = selected.slice(at, at + LOCATION_IMPACT_LIMITS.chunk);
    const rows = (await client.query<Row>(`/* location-impact:cables */ SELECT id,cable_write_revision::text,
      CASE WHEN octet_length(mto)<=96 THEN mto ELSE NULL END AS mto,
      CASE WHEN octet_length(from_location)<=4096 THEN from_location ELSE NULL END AS from_location,
      CASE WHEN octet_length(to_location)<=4096 THEN to_location ELSE NULL END AS to_location,
      (coalesce(octet_length(mto),0)>96 OR coalesce(octet_length(from_location),0)>4096 OR coalesce(octet_length(to_location),0)>4096) AS oversized
      FROM cables WHERE project_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR SHARE`, [projectId, ids])).rows;
    if (rows.length !== ids.length || rows.some((row, index) => row.id !== ids[index] || row.oversized)) return fail('LOCATION_IMPACT_CABLE_SCOPE');
    for (const row of rows) { bytes += Buffer.byteLength(canonicalPurposeJson(row)); if (bytes > LOCATION_IMPACT_LIMITS.collectionBytes) return fail('LOCATION_IMPACT_INPUT_LIMIT', 413); cables.push(row); }
  }
  const eligible = cables.filter(row => isPathFinderCableEligible(row.mto)), eligibleIds = new Set(eligible.map(row => row.id)), mv = cables.filter(row => row.mto === 'MV'), unknown = cables.filter(row => row.mto !== 'MV' && !eligibleIds.has(row.id));
  if (originCableId !== undefined && !eligibleIds.has(originCableId)) return fail('LOCATION_IMPACT_ORIGIN_SCOPE');
  const now = new Date(), id = randomUUID(), draft = locationImpactRecordSchema.parse({
    ...(automaticPairPolicy !== undefined ? {schemaVersion:'wfc.pf.location-impact-record.v3',originCableId,automaticPairPolicy}
      : originCableId === undefined ? {schemaVersion:'wfc.pf.location-impact-record.v1'} : {schemaVersion:'wfc.pf.location-impact-record.v2',originCableId}), id, projectId,
    actorId: who.userId, actorAdminRevision: admin.revision, loginId: who.loginId, loginExpiresAt: new Date(who.loginExpiresAt).toISOString(),
    authorityExpiresAt: new Date(Math.min(who.loginExpiresAt, now.getTime() + LOCATION_IMPACT_LIMITS.authorityMilliseconds)).toISOString(), installationEpoch: installation.installation_epoch,
    idempotencyKey: input.idempotencyKey, commandSha256: input.commandSha256, locationId: input.binding.locationId, bindingId: input.binding.binding.id,
    bindingContentSha256: input.binding.binding.contentSha256, observedRegistryRevision: input.binding.registryRevision,
    current: input.current, calculation: input.calculation === null ? null : locationImpactCalculationSchema.parse(input.calculation),
    eligibleCableIds: eligible.map(row => row.id), excludedMvCableIds: mv.map(row => row.id), blockedCategoryCableIds: unknown.map(row => row.id),
    createdAt: now.toISOString(), contentSha256: '0'.repeat(64) });
  const record = locationImpactRecordSchema.parse({ ...draft, contentSha256: digest(body(draft)) });
  if (Buffer.byteLength(canonicalPurposeJson(record)) > LOCATION_IMPACT_LIMITS.recordBytes) return fail('LOCATION_IMPACT_RECORD_LIMIT', 413);
  await client.query('INSERT INTO pf_location_impacts(project_id,id,actor_id,login_id,idempotency_key,command_sha256,record_sha256,record,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [projectId, id, who.userId, who.loginId, input.idempotencyKey, input.commandSha256, record.contentSha256, record, now]);
  const members = cables.filter(row => row.mto !== 'MV');
  for (let at = 0; at < members.length; at += LOCATION_IMPACT_LIMITS.chunk) {
    check(); const chunk = members.slice(at, at + LOCATION_IMPACT_LIMITS.chunk), ids = chunk.map(row => row.id);
    const targets = (await client.query<{ cable_id: string; generation: string }>(`INSERT INTO pf_location_impact_targets(project_id,cable_id,generation,impact_id)
      SELECT $1,x,1,$2 FROM unnest($3::uuid[]) x ORDER BY x ON CONFLICT(project_id,cable_id) DO UPDATE
      SET generation=pf_location_impact_targets.generation+1,impact_id=EXCLUDED.impact_id RETURNING cable_id,generation::text`, [projectId, id, ids])).rows;
    const revisions = new Map(targets.map(row => [row.cable_id, row.generation])); if (revisions.size !== ids.length) return fail('LOCATION_IMPACT_TARGET_INTEGRITY');
    const items = chunk.map(row => {
      const draft = locationImpactItemSchema.parse({ schemaVersion: 'wfc.pf.location-impact-item.v1', projectId, impactId: id, cableId: row.id,
        generation: revisions.get(row.id), cableWriteRevision: row.cable_write_revision, fromLogicalKey: row.from_location ? normalizeLocation(row.from_location) || null : null,
        toLogicalKey: row.to_location ? normalizeLocation(row.to_location) || null : null, category: row.mto, eligible: eligibleIds.has(row.id), contentSha256: '0'.repeat(64) });
      const value = { ...draft, contentSha256: digest(body(draft)) }; if (Buffer.byteLength(canonicalPurposeJson(value)) > LOCATION_IMPACT_LIMITS.itemBytes) return fail('LOCATION_IMPACT_ITEM_LIMIT', 413);
      return { cable_id: row.id, generation: value.generation, eligible: value.eligible, record_sha256: value.contentSha256, record: value };
    });
    await client.query(`INSERT INTO pf_location_impact_items(project_id,impact_id,cable_id,generation,eligible,record_sha256,record)
      SELECT $1,$2,x.cable_id,x.generation,x.eligible,x.record_sha256,x.record FROM jsonb_to_recordset($3::jsonb)
      AS x(cable_id uuid,generation bigint,eligible boolean,record_sha256 text,record jsonb)`, [projectId, id, JSON.stringify(items)]);
  }
  const status = record.calculation && eligible.length ? 'pending' : 'blocked', reasons = !record.calculation ? ['LOCATION_IMPACT_PREFERENCES_REQUIRED'] : !eligible.length ? ['LOCATION_IMPACT_NO_ELIGIBLE_CABLES'] : [];
  check(); await client.query(`INSERT INTO pf_location_impact_dispatch(project_id,impact_id,status,reason_codes,due_at)
    VALUES($1,$2,$3,$4::jsonb,CASE WHEN $3='pending' THEN clock_timestamp()+interval '500 milliseconds' ELSE NULL END)`, [projectId, id, status, JSON.stringify(reasons)]);
  return locationImpactReferenceSchema.parse({ id, status, eligibleCables: eligible.length, excludedMvCables: mv.length, blockedCategoryCables: unknown.length });
}

/** This model fence is metadata only; the normal collector still proves every exact calculation input. */
async function scopeCurrent(client: Pick<PoolClient, 'query'>, record: LocationImpactRecord): Promise<boolean> {
  const value = (await client.query<Row>(`/* location-impact:scope */ SELECT s.active_model_version_id,s.selection_revision::text,m.state,m.health,m.content_fingerprint,
    p.current_aggregate_id,p.current_artifact_id,p.geometry_revision::text,a.manifest->>'coordinateFrameId' AS capture_frame_id,f.snapshot_sha256,
    (SELECT id FROM pf_geometry_trace_sets WHERE project_id=$1 AND aggregate_id=p.current_aggregate_id ORDER BY created_at DESC,id DESC LIMIT 1) AS trace_id
    FROM project_model_selections s JOIN model_versions m ON m.project_id=s.project_id AND m.id=s.active_model_version_id
    JOIN pf_project_preparations p ON p.project_id=s.project_id JOIN pf_preparation_aggregates a ON a.project_id=p.project_id AND a.id=p.current_aggregate_id
    JOIN pf_artifacts f ON f.project_id=p.project_id AND f.id=p.current_artifact_id WHERE s.project_id=$1`, [record.projectId])).rows[0], c = record.current;
  return !!value && value.active_model_version_id === c.modelVersionId && value.selection_revision === c.selectionRevision && value.state === 'ready' && value.health === 'healthy'
    && value.content_fingerprint === c.contentFingerprint && value.current_aggregate_id === c.aggregateId && value.current_artifact_id === c.artifactId
    && value.geometry_revision === c.geometryRevision && value.capture_frame_id === c.captureFrameId && value.snapshot_sha256 === c.projectionSha256 && value.trace_id === c.traceId;
}
async function authority(client: Pick<PoolClient, 'query'>, record: LocationImpactRecord, lock = false): Promise<string | null> {
  const user = (await client.query<Row>(`SELECT is_admin,pf_admin_revision::text AS revision FROM users WHERE id=$1${lock ? ' FOR SHARE' : ''}`, [record.actorId])).rows[0];
  const login = (await client.query<Row>(`SELECT user_id,expires_at,revoked_at FROM viewer_login_bindings WHERE login_id=$1${lock ? ' FOR SHARE' : ''}`, [record.loginId])).rows[0];
  const installation = (await client.query<Row>(`SELECT installation_epoch FROM pf_installation_state WHERE singleton=true${lock ? ' FOR SHARE' : ''}`)).rows[0];
  if (!installation || installation.installation_epoch !== record.installationEpoch) return 'LOCATION_IMPACT_RESTORE_FENCED';
  if (!user?.is_admin || user.revision !== record.actorAdminRevision || !login || login.user_id !== record.actorId || login.revoked_at !== null
    || iso(login.expires_at) !== record.loginExpiresAt || Math.min(Date.parse(record.loginExpiresAt), Date.parse(record.authorityExpiresAt)) <= Date.now()) return 'LOCATION_IMPACT_AUTHORITY_EXPIRED';
  if (!await scopeCurrent(client, record)) return 'LOCATION_IMPACT_MODEL_CHANGED'; return null;
}
export type LocationImpactJobAuthority = { enrolled: true; scope: 'location-impact'; valid: boolean; code: string; generation: string; authorityEpoch: string; impactId: string };
/** null means not a scoped job. A known scoped job never falls back to a less restricted legacy authority. */
export async function readLocationImpactJobAuthority(client: Pick<PoolClient, 'query'>, input: { projectId: string; jobId: string; cableId?: string; lock?: boolean }): Promise<LocationImpactJobAuthority | null> {
  const linked = (await client.query<Row>(`SELECT impact_id FROM pf_location_impact_enrollments WHERE project_id=$1 AND job_id=$2`, [input.projectId, input.jobId])).rows[0];
  if (!linked) return null;
  const raw = (await client.query<Row>(recordSql + ' WHERE i.project_id=$1 AND i.id=$2', [input.projectId, linked.impact_id])).rows[0];
  if (!raw) return fail('LOCATION_IMPACT_INTEGRITY'); const record = verifiedRecord(raw), issue = await authority(client, record, input.lock);
  const base = { enrolled: true as const, scope: 'location-impact' as const, generation: record.observedRegistryRevision, authorityEpoch: record.actorAdminRevision, impactId: record.id };
  if (issue) return { ...base, valid: false, code: issue };
  const job = (await client.query<Row>(`SELECT requested_by,login_id,login_expires_at,authority_kind,state,cancel_requested FROM pf_jobs WHERE project_id=$1 AND id=$2${input.lock ? ' FOR SHARE' : ''}`, [input.projectId, input.jobId])).rows[0];
  if (!job || job.authority_kind !== 'current-login' || job.requested_by !== record.actorId || job.login_id !== record.loginId || iso(job.login_expires_at) !== record.loginExpiresAt
    || job.cancel_requested || ['cancelled', 'failed'].includes(job.state)) return { ...base, valid: false, code: 'LOCATION_IMPACT_JOB_REVOKED' };
  const item = (await client.query<Row>(`SELECT i.cable_id,i.generation::text,i.record_sha256,CASE WHEN octet_length(i.record::text)<=32768 THEN i.record ELSE NULL END AS record
    FROM pf_location_impact_items i JOIN pf_location_impact_targets t ON t.project_id=i.project_id AND t.cable_id=i.cable_id AND t.impact_id=i.impact_id AND t.generation=i.generation
    JOIN pf_job_items j ON j.project_id=i.project_id AND j.job_id=$2 AND j.cable_id=i.cable_id
    JOIN cables c ON c.project_id=i.project_id AND c.id=i.cable_id
    WHERE i.project_id=$1 AND i.impact_id=$3 AND i.eligible AND c.mto IS DISTINCT FROM 'MV' AND ($4::uuid IS NULL OR i.cable_id=$4) ORDER BY i.cable_id LIMIT 1${input.lock ? ' FOR SHARE OF i,t,j,c' : ''}`,
    [input.projectId, input.jobId, record.id, input.cableId ?? null])).rows[0];
  if (!item) return { ...base, valid: false, code: 'LOCATION_IMPACT_TARGET_SUPERSEDED' };
  const parsed = locationImpactItemSchema.safeParse(item.record);
  if (!parsed.success || parsed.data.projectId !== input.projectId || parsed.data.impactId !== record.id || parsed.data.cableId !== item.cable_id
    || parsed.data.generation !== item.generation || digest(body(parsed.data)) !== item.record_sha256 || parsed.data.contentSha256 !== item.record_sha256) return fail('LOCATION_IMPACT_ITEM_INTEGRITY');
  return { ...base, valid: true, code: 'LOCATION_IMPACT_AUTHORITY_CURRENT' };
}
export async function requireLocationImpactAuthority(client: Pick<PoolClient, 'query'>, input: { projectId: string; jobId: string; cableId?: string; lock?: boolean }): Promise<boolean> {
  const result = await readLocationImpactJobAuthority(client, { ...input, lock: input.lock ?? true }); if (!result) return false; if (!result.valid) return fail(result.code); return true;
}
export async function cancelLocationImpactForJob(client: Pick<PoolClient, 'query'>, input: { projectId: string; jobId: string }): Promise<boolean> {
  const result = await client.query(`UPDATE pf_location_impact_dispatch d SET status='cancelled',reason_codes='["LOCATION_IMPACT_CANCELLED"]',owner_token=NULL,lease_until=NULL,due_at=NULL,updated_at=clock_timestamp()
    FROM pf_location_impact_enrollments e WHERE e.project_id=d.project_id AND e.impact_id=d.impact_id AND e.project_id=$1 AND e.job_id=$2 RETURNING d.impact_id`, [input.projectId, input.jobId]);
  return result.rows.length > 0;
}

/** Ordering only, called after the normal worker/project/authority fences.
 * A paired save can supersede its origin into another impact while retaining
 * current siblings here. Those siblings wait for that exact latest origin item.
 * This reader grants no calculation or cable-write authority. */
export async function readLocationImpactPriority(client: Pick<PoolClient, 'query'>, input: {projectId:string;jobId:string}): Promise<{originCableId:string;waitForOrigin:boolean}|null> {
  const linked=(await client.query<{impact_id:string}>('SELECT impact_id FROM pf_location_impact_enrollments WHERE project_id=$1 AND job_id=$2',[input.projectId,input.jobId])).rows[0];
  if(!linked)return null;
  const raw=(await client.query<Row>(recordSql+' WHERE i.project_id=$1 AND i.id=$2',[input.projectId,linked.impact_id])).rows[0];
  if(!raw)return fail('LOCATION_IMPACT_INTEGRITY');const record=verifiedRecord(raw);
  if(record.projectId!==input.projectId||record.id!==linked.impact_id)return fail('LOCATION_IMPACT_INTEGRITY');
  if(record.schemaVersion==='wfc.pf.location-impact-record.v1')return null;
  const current=(await client.query<Row>(`/* location-impact:origin-progress */ SELECT c.mto,t.impact_id,d.status AS dispatch_status,
    e.job_id,j.state AS job_state,j.cancel_requested,i.state AS item_state
    FROM cables c LEFT JOIN pf_location_impact_targets t ON t.project_id=c.project_id AND t.cable_id=c.id
    LEFT JOIN pf_location_impact_dispatch d ON d.project_id=t.project_id AND d.impact_id=t.impact_id
    LEFT JOIN pf_location_impact_enrollments e ON e.project_id=t.project_id AND e.impact_id=t.impact_id
    LEFT JOIN pf_jobs j ON j.project_id=e.project_id AND j.id=e.job_id
    LEFT JOIN pf_job_items i ON i.project_id=j.project_id AND i.job_id=j.id AND i.cable_id=c.id
    WHERE c.project_id=$1 AND c.id=$2`,[input.projectId,record.originCableId])).rows[0];
  const priority={originCableId:record.originCableId,waitForOrigin:false};
  // A deleted or newly ineligible origin has no remaining calculation to wait for.
  if(!current||!isPathFinderCableEligible(current.mto))return priority;
  if(!current.impact_id||!current.dispatch_status)return fail('LOCATION_IMPACT_ORIGIN_INTEGRITY');
  if(current.item_state==='complete'||current.item_state==='blocked')return priority;
  if(['failed','cancelled'].includes(current.job_state))return priority;
  if(current.job_id){
    // A cancellation request or revoked dispatch is not a joined terminal job.
    // Keep siblings queued until the actual item/job has finished.
    if(!['queued','running'].includes(current.job_state)||!['waiting','running'].includes(current.item_state))return fail('LOCATION_IMPACT_ORIGIN_INTEGRITY');
  }else if(['blocked','superseded','cancelled','failed','awaiting-authority','restore-fenced'].includes(current.dispatch_status))return priority;
  else if(!['pending','collecting'].includes(current.dispatch_status))return fail('LOCATION_IMPACT_ORIGIN_INTEGRITY');
  return {...priority,waitForOrigin:true};
}

export type LocationImpactClaim = { projectId: string; impactId: string; ownerToken: string; leaseExpiresAt: string; principal: JobPrincipal };
export type LocationImpactAdmission = { jobId: string | null; inputSha256: string; admissionId?: string | null; total: number; readyCables: number; blockedCables: number; reasonCodes?: string[] };
export type LocationImpactAdmissionInput = { projectId: string; impactId: string; principal: JobPrincipal; cableIds: string[];
  preferences: LocationImpactCalculation['preferences']; timeoutMilliseconds: number; signal: AbortSignal; beforeInsert(): Promise<void>;
  automaticPair?: { policy: AutomaticPairPolicy; createdAt: string; authorityExpiresAt: string } };
export type LocationImpactAdapter = { admitInTransaction(client: PoolClient, input: LocationImpactAdmissionInput): Promise<LocationImpactAdmission> };

export function createLocationImpactRepository(pool: Pool, adapter: LocationImpactAdapter) {
  async function claimNext(signal?: AbortSignal): Promise<LocationImpactClaim | null> {
    return schedulerTransaction(pool, async client => {
      const row = (await client.query<Row>(`SELECT d.project_id,d.impact_id,d.attempts,i.actor_id,i.login_id,i.record->>'loginExpiresAt' AS login_expires_at
        FROM pf_location_impact_dispatch d JOIN pf_location_impacts i ON i.project_id=d.project_id AND i.id=d.impact_id
        WHERE d.status IN('pending','collecting') AND d.due_at<=clock_timestamp() AND (d.lease_until IS NULL OR d.lease_until<=clock_timestamp())
        ORDER BY d.due_at,d.project_id,d.impact_id LIMIT 1 FOR UPDATE OF d SKIP LOCKED`)).rows[0];
      if (!row) return null;
      if (row.attempts >= LOCATION_IMPACT_LIMITS.attempts) { await client.query("UPDATE pf_location_impact_dispatch SET status='failed',reason_codes='[\"LOCATION_IMPACT_RECOVERY_LIMIT\"]',due_at=NULL,owner_token=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE project_id=$1 AND impact_id=$2", [row.project_id, row.impact_id]); return null; }
      const token = randomUUID(), lease = new Date(Date.now() + LOCATION_IMPACT_LIMITS.leaseMilliseconds);
      await client.query("UPDATE pf_location_impact_dispatch SET status='collecting',attempts=attempts+1,owner_token=$3,lease_until=$4,updated_at=clock_timestamp() WHERE project_id=$1 AND impact_id=$2", [row.project_id, row.impact_id, token, lease]);
      return { projectId: row.project_id, impactId: row.impact_id, ownerToken: token, leaseExpiresAt: lease.toISOString(), principal: { userId: row.actor_id, loginId: row.login_id, loginExpiresAt: Date.parse(row.login_expires_at) } };
    }, signal);
  }
  async function enrollClaim(claim: LocationImpactClaim, externalSignal?: AbortSignal): Promise<{ status: string; jobId: string | null }> {
    const deadline = new AbortController(), timer = setTimeout(() => deadline.abort(new PathFinderError('LOCATION_IMPACT_COLLECTION_DEADLINE', 503)), 30000);
    const signal = externalSignal ? AbortSignal.any([externalSignal, deadline.signal]) : deadline.signal;
    try { return await endpointBindingTransaction(pool, claim.projectId, claim.principal, async client => {
      const raw = (await client.query<Row>(recordSql + ' WHERE i.project_id=$1 AND i.id=$2', [claim.projectId, claim.impactId])).rows[0]; if (!raw) return fail('LOCATION_IMPACT_NOT_FOUND', 404);
      const record = verifiedRecord(raw), issue = await authority(client, record, true); if (issue) return fail(issue);
      if (record.actorId !== claim.principal.userId || record.loginId !== claim.principal.loginId || Date.parse(record.loginExpiresAt) !== claim.principal.loginExpiresAt) return fail('LOCATION_IMPACT_CLAIM_FENCED');
      const existing = (await client.query<Row>('SELECT job_id FROM pf_location_impact_enrollments WHERE project_id=$1 AND impact_id=$2', [claim.projectId, claim.impactId])).rows[0];
      if (existing) return { status: 'duplicate', jobId: existing.job_id };
      if (!record.calculation) return fail('LOCATION_IMPACT_PREFERENCES_REQUIRED');
      const targets = (await client.query<{ cable_id: string }>(`SELECT i.cable_id FROM pf_location_impact_items i JOIN pf_location_impact_targets t
        ON t.project_id=i.project_id AND t.cable_id=i.cable_id AND t.impact_id=i.impact_id AND t.generation=i.generation
        JOIN cables c ON c.project_id=i.project_id AND c.id=i.cable_id
        WHERE i.project_id=$1 AND i.impact_id=$2 AND i.eligible AND c.mto IS DISTINCT FROM 'MV' ORDER BY i.cable_id LIMIT 10001`, [claim.projectId, claim.impactId])).rows.map(row => row.cable_id);
      const eligibleIds = new Set(record.eligibleCableIds);
      if (targets.length > LOCATION_IMPACT_LIMITS.cables || !targets.every(id => eligibleIds.has(id))) return fail('LOCATION_IMPACT_TARGET_INTEGRITY');
      let guarded = false;
      const beforeInsert = async () => {
        signal.throwIfAborted(); const issue = await authority(client, record, true); if (issue) return fail(issue);
        const dispatch = (await client.query<Row>('SELECT status,owner_token,lease_until FROM pf_location_impact_dispatch WHERE project_id=$1 AND impact_id=$2 FOR UPDATE', [claim.projectId, claim.impactId])).rows[0];
        if (guarded || !dispatch || dispatch.status !== 'collecting' || dispatch.owner_token !== claim.ownerToken || iso(dispatch.lease_until) !== claim.leaseExpiresAt || Date.parse(claim.leaseExpiresAt) <= Date.now()) return fail('LOCATION_IMPACT_CLAIM_FENCED'); guarded = true;
      };
      if (!targets.length) { await beforeInsert(); await client.query("UPDATE pf_location_impact_dispatch SET status='superseded',reason_codes='[\"LOCATION_IMPACT_TARGET_SUPERSEDED\"]',owner_token=NULL,lease_until=NULL,due_at=NULL,updated_at=clock_timestamp() WHERE project_id=$1 AND impact_id=$2", [claim.projectId, claim.impactId]); return { status: 'superseded', jobId: null }; }
      const admission = await adapter.admitInTransaction(client, { projectId: claim.projectId, impactId: claim.impactId, principal: claim.principal, cableIds: targets,
        preferences: record.calculation.preferences, timeoutMilliseconds: record.calculation.timeoutMilliseconds, signal, beforeInsert,
        ...(record.schemaVersion === 'wfc.pf.location-impact-record.v3' && record.automaticPairPolicy ? {automaticPair:{policy:record.automaticPairPolicy,
          createdAt:record.createdAt,authorityExpiresAt:record.authorityExpiresAt}} : {}) });
      if (!guarded || admission.total !== targets.length || !Number.isSafeInteger(admission.readyCables) || !Number.isSafeInteger(admission.blockedCables)
        || admission.readyCables < 0 || admission.blockedCables < 0 || admission.readyCables + admission.blockedCables !== admission.total
        || admission.jobId === null && admission.total > 0) return fail('LOCATION_IMPACT_ADAPTER_INVALID', 500);
      policyHashSchema.parse(admission.inputSha256); if (admission.jobId !== null) policyUuidSchema.parse(admission.jobId); if (admission.admissionId) policyUuidSchema.parse(admission.admissionId);
      signal.throwIfAborted(); if (Date.parse(record.authorityExpiresAt) <= Date.now()) return fail('LOCATION_IMPACT_AUTHORITY_EXPIRED');
      await client.query(`INSERT INTO pf_location_impact_enrollments(project_id,impact_id,job_id,input_sha256,admission_id,total,ready_cables,blocked_cables)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [claim.projectId, claim.impactId, admission.jobId, admission.inputSha256, admission.admissionId ?? null, admission.total, admission.readyCables, admission.blockedCables]);
      const reasons = [...new Set(admission.reasonCodes ?? [])].slice(0, 64);
      await client.query(`UPDATE pf_location_impact_dispatch SET status=$3,reason_codes=$4::jsonb,admitted_at=clock_timestamp(),owner_token=NULL,lease_until=NULL,due_at=NULL,updated_at=clock_timestamp()
        WHERE project_id=$1 AND impact_id=$2`, [claim.projectId, claim.impactId, admission.readyCables > 0 ? 'enrolled' : 'blocked', JSON.stringify(reasons)]);
      return { status: admission.readyCables > 0 ? 'enrolled' : 'blocked', jobId: admission.jobId };
    }, signal); } catch (error) {
      if (!externalSignal?.aborted && !(error instanceof PathFinderError && error.code === 'ENDPOINT_COMMIT_OUTCOME_UNKNOWN')) await recordFailure(claim, error).catch(() => undefined);
      throw error;
    } finally { clearTimeout(timer); }
  }
  async function recordFailure(claim: LocationImpactClaim, error: unknown) {
    const code = error instanceof PathFinderError ? error.code : 'LOCATION_IMPACT_ADMISSION_FAILED';
    const transient = ['ENDPOINT_DATABASE_BUSY', 'SCHEDULER_DATABASE_BUSY', 'RECALCULATION_COLLECTION_DEADLINE', 'LOCATION_IMPACT_COLLECTION_DEADLINE'].includes(code);
    const status = code === 'LOCATION_IMPACT_RESTORE_FENCED' ? 'restore-fenced' : ['LOCATION_IMPACT_AUTHORITY_EXPIRED', 'LOGIN_EXPIRED', 'LOGIN_REVOKED', 'ADMIN_REQUIRED'].includes(code) ? 'awaiting-authority' : 'blocked';
    return schedulerTransaction(pool, client => client.query(`UPDATE pf_location_impact_dispatch SET status=CASE WHEN $5 AND attempts<3 THEN 'pending' WHEN $5 THEN 'failed' ELSE $4 END,
      reason_codes=$3::jsonb,owner_token=NULL,lease_until=NULL,due_at=CASE WHEN $5 AND attempts<3 THEN clock_timestamp()+interval '5 seconds' ELSE NULL END,updated_at=clock_timestamp()
      WHERE project_id=$1 AND impact_id=$2 AND owner_token=$6`, [claim.projectId, claim.impactId, JSON.stringify([code]), status, transient, claim.ownerToken]));
  }

  async function summary(client: PoolClient, raw: Row, check: () => void) {
    const record = verifiedRecord(raw); check(); const issue = await authority(client, record), state = (await client.query<Row>(`SELECT d.status,d.reason_codes,d.admitted_at,d.updated_at,e.job_id,e.total,e.ready_cables,e.blocked_cables,
      j.state AS job_state,j.cancel_requested,j.completed,(SELECT count(*)::int FROM pf_location_impact_items i JOIN pf_location_impact_targets t ON t.project_id=i.project_id AND t.cable_id=i.cable_id AND t.impact_id=i.impact_id AND t.generation=i.generation JOIN cables c ON c.project_id=i.project_id AND c.id=i.cable_id WHERE i.project_id=d.project_id AND i.impact_id=d.impact_id AND i.eligible AND c.mto IS DISTINCT FROM 'MV') AS current_targets
      FROM pf_location_impact_dispatch d LEFT JOIN pf_location_impact_enrollments e ON e.project_id=d.project_id AND e.impact_id=d.impact_id
      LEFT JOIN pf_jobs j ON j.project_id=e.project_id AND j.id=e.job_id WHERE d.project_id=$1 AND d.impact_id=$2`, [record.projectId, record.id])).rows[0];
    if (!state) return fail('LOCATION_IMPACT_INTEGRITY'); let status = state.status;
    if (issue) status = issue === 'LOCATION_IMPACT_RESTORE_FENCED' ? 'restore-fenced' : issue === 'LOCATION_IMPACT_AUTHORITY_EXPIRED' ? 'awaiting-authority' : 'superseded';
    else if (state.cancel_requested || state.job_state === 'cancelled') status = 'cancelled';
    else if (!state.current_targets && record.eligibleCableIds.length && ['pending', 'collecting', 'enrolled'].includes(status)) status = 'superseded';
    else if (state.job_state) status = state.job_state === 'queued' ? 'queued' : state.job_state;
    const created = Date.parse(record.createdAt), now = Date.now(); check();
    return locationImpactSummarySchema.parse({ id: record.id, projectId: record.projectId, actorId: record.actorId,
      modelVersionId: record.current.modelVersionId, selectionRevision: record.current.selectionRevision, contentFingerprint: record.current.contentFingerprint,
      current: record.current, calculation: record.calculation, status, reasonCodes: [...new Set([...(state.reason_codes ?? []), ...(issue ? [issue] : [])])].slice(0, 64),
      eligibleCables: record.eligibleCableIds.length, excludedMvCables: record.excludedMvCableIds.length, blockedCategoryCables: record.blockedCategoryCableIds.length,
      currentTargetCables: state.current_targets, completed: state.completed ?? state.blocked_cables ?? 0,
      total: state.total ?? record.eligibleCableIds.length, readyCables: state.ready_cables ?? 0, blockedCables: state.blocked_cables ?? 0,
      jobId: state.job_id ?? null, createdAt: record.createdAt, updatedAt: iso(state.updated_at), admittedAt: state.admitted_at ? iso(state.admitted_at) : null,
      authorityExpiresAt: record.authorityExpiresAt, currentAuthority: issue === null, elapsedMilliseconds: Math.max(0, now - created),
      admissionElapsedMilliseconds: state.admitted_at ? Math.max(0, Date.parse(iso(state.admitted_at)) - created) : null });
  }
  const progress = (projectId: string, who: JobPrincipal, impactId: string, signal?: AbortSignal) => cableWorkflowReadTransaction(pool, projectId, who, async (client, check) => {
    policyUuidSchema.parse(impactId); const raw = (await client.query<Row>(recordSql + ' WHERE i.project_id=$1 AND i.actor_id=$2 AND i.id=$3', [projectId, who.userId, impactId])).rows[0];
    if (!raw) return fail('LOCATION_IMPACT_NOT_FOUND', 404); return locationImpactProgressSchema.parse({ schemaVersion: 'wfc.pf.location-impact-progress.v1', projectId, impact: await summary(client, raw, check) });
  }, signal);
  const list = (projectId: string, who: JobPrincipal, query: LocationImpactPageQuery = {}, signal?: AbortSignal) => cableWorkflowReadTransaction(pool, projectId, who, async (client, check) => {
    const options = locationImpactPageQuerySchema.parse(query); let before: Row | undefined;
    if (options.beforeId) { before = (await client.query<Row>('SELECT created_at,id FROM pf_location_impacts WHERE project_id=$1 AND actor_id=$2 AND id=$3', [projectId, who.userId, options.beforeId])).rows[0]; if (!before) return fail('LOCATION_IMPACT_CURSOR_INVALID'); }
    const values = (await client.query<Row>(`SELECT i.id FROM pf_location_impacts i WHERE i.project_id=$1 AND i.actor_id=$2 AND ($3::timestamptz IS NULL OR (i.created_at,i.id)<($3::timestamptz,$4::uuid)) ORDER BY i.created_at DESC,i.id DESC LIMIT $5`,
      [projectId, who.userId, before?.created_at ?? null, before?.id ?? null, options.limit + 1])).rows;
    const impacts = []; for (const item of values.slice(0, options.limit)) { check();
      const row = (await client.query<Row>(recordSql + ' WHERE i.project_id=$1 AND i.actor_id=$2 AND i.id=$3', [projectId, who.userId, item.id])).rows[0];
      if (!row) return fail('LOCATION_IMPACT_INTEGRITY'); impacts.push(await summary(client, row, check)); }
    return locationImpactPageSchema.parse({ schemaVersion: 'wfc.pf.location-impact-page.v1', projectId, impacts, nextBeforeId: values.length > options.limit ? impacts.at(-1)?.id ?? null : null });
  }, signal);
  return { claimNext, enrollClaim, recordFailure, progress, list };
}
export type LocationImpactRepository = ReturnType<typeof createLocationImpactRepository>;
