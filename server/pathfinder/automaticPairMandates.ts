import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { canonicalPurposeJson, policyHashSchema, policyRevisionSchema, policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { AUTOMATIC_PAIR_LIMITS, automaticPairPolicySchema, automaticPairSourceSchema, automaticPairMandateSchema, automaticPairMandateHashInput,
  type AutomaticPairMandate, type AutomaticPairPolicy, type AutomaticPairSource } from '../../shared/pathfinderAutomaticPair.js';
import type { JobPrincipal } from './jobContracts.js';
import { assertLoginNotExpired, requireCurrentLogin } from './auth.js';
import { automaticPairHash } from './automaticPairReceiptProof.js';
import { readAutomaticPairOwnership, type AutomaticPairOwnershipDecision } from './automaticPairOwnership.js';
import { requireEnrollmentAuthority } from './recalculationRepository.js';
import { readLocationImpactJobAuthority } from './locationImpactRepository.js';
import { locationImpactRecordSchema } from '../../shared/pathfinderLocationImpacts.js';
import { cableEndpointCommandSchema, cableEndpointEndSchema } from '../../shared/pathfinderCableEndpoints.js';
import { PathFinderError } from './errors.js';
import { requireAutomaticGenerationOutput } from './automaticGenerationOutput.js';

type Row = Record<string, any>;
const fail = (code: string, status = 409): never => { throw new PathFinderError(code, status, 'Automatic Cable list update is unavailable. Existing cable values are retained.'); };
const same = (a: unknown, b: unknown) => canonicalPurposeJson(a) === canonicalPurposeJson(b);
const commandOwnerSchema = z.object({ schemaVersion: z.literal('wfc.pf.cable-endpoint-command-owner.v1'), cableId: policyUuidSchema,
  end: cableEndpointEndSchema, command: cableEndpointCommandSchema }).strict();
export type AppendAutomaticPairMandatesInput = { projectId: string; jobId: string; principal: JobPrincipal; policy: AutomaticPairPolicy;
  requestSha256: string; source: AutomaticPairSource; items: { cableId: string; cableWriteRevision: string; dependencyHash: string }[] };
export type AutomaticPairMandateAdapters = { ownership?: typeof readAutomaticPairOwnership };
export function verifiedAutomaticPairMandate(row: Row): AutomaticPairMandate {
  const m = automaticPairMandateSchema.parse(row.record);
  if (m.projectId !== row.project_id || m.jobId !== row.job_id || m.cableId !== row.cable_id || m.id !== row.id || m.actorId !== row.actor_id
    || m.loginId !== row.login_id || m.contentSha256 !== row.record_sha256 || automaticPairHash(automaticPairMandateHashInput(m)) !== m.contentSha256)
    return fail('AUTOMATIC_PAIR_MANDATE_INTEGRITY'); return m;
}
export async function readAutomaticPairMandate(client: PoolClient, input: { projectId: string; jobId: string; cableId: string }, lock = false) {
  const rows = (await client.query<Row>(`/* automatic-pair:mandate */ SELECT project_id,job_id,cable_id,id,actor_id,login_id,record_sha256,
    CASE WHEN octet_length(record::text)<=65536 THEN record ELSE NULL END AS record FROM pf_automatic_pair_mandates
    WHERE project_id=$1 AND job_id=$2 AND cable_id=$3${lock ? ' FOR SHARE' : ''}`, [input.projectId, input.jobId, input.cableId])).rows;
  if (rows.length > 1) return fail('AUTOMATIC_PAIR_MANDATE_INTEGRITY'); return rows[0] ? verifiedAutomaticPairMandate(rows[0]) : null;
}
async function originalImpact(client: PoolClient, input: AppendAutomaticPairMandatesInput) {
  if (input.source.kind !== 'location-impact') return null;
  const row = (await client.query<Row>(`/* automatic-pair:original-impact */ SELECT actor_id,login_id,idempotency_key,command_sha256,record_sha256,
    CASE WHEN octet_length(record::text)<=1048576 THEN record ELSE NULL END AS record FROM pf_location_impacts
    WHERE project_id=$1 AND id=$2 FOR SHARE`, [input.projectId, input.source.impactId])).rows[0];
  const parsed = locationImpactRecordSchema.safeParse(row?.record);
  if (!parsed.success || parsed.data.schemaVersion !== 'wfc.pf.location-impact-record.v3') return fail('AUTOMATIC_PAIR_ORIGINAL_IMPACT_REQUIRED');
  const r = parsed.data;
  if (r.projectId !== input.projectId || r.id !== input.source.impactId || r.idempotencyKey !== row.idempotency_key
    || r.actorId !== input.principal.userId || r.loginId !== input.principal.loginId || row.actor_id !== r.actorId || row.login_id !== r.loginId
    || row.record_sha256 !== r.contentSha256 || automaticPairHash(Object.fromEntries(Object.entries(r).filter(([key]) => key !== 'contentSha256'))) !== r.contentSha256
    || r.createdAt !== input.source.createdAt || r.authorityExpiresAt !== input.source.authorityExpiresAt
    || r.loginExpiresAt !== new Date(input.principal.loginExpiresAt).toISOString() || !same(automaticPairPolicySchema.parse(r.automaticPairPolicy), input.policy))
    return fail('AUTOMATIC_PAIR_ORIGINAL_IMPACT_REQUIRED');
  const raw = (await client.query<Row>(`/* automatic-pair:original-command */ SELECT request_sha256,request FROM pf_endpoint_binding_commands
    WHERE project_id=$1 AND actor_id=$2 AND idempotency_key=$3 AND kind='confirm' FOR SHARE`, [input.projectId, input.principal.userId, row.idempotency_key])).rows[0];
  const parsedOwner = commandOwnerSchema.safeParse(raw?.request);
  if (!parsedOwner.success) return fail('AUTOMATIC_PAIR_ORIGINAL_COMMAND_REQUIRED');
  const owner = parsedOwner.data, command = owner.command;
  if (owner.cableId !== r.originCableId || automaticPairHash(owner) !== raw.request_sha256 || command.schemaVersion !== 'wfc.pf.cable-endpoint-command.v4'
    || automaticPairHash(command) !== row.command_sha256 || row.command_sha256 !== r.commandSha256 || row.idempotency_key !== command.idempotencyKey
    || !same(command.automaticPairPolicy, input.policy) || command.initialFill !== null || !same(command.calculation, r.calculation)
    || !same(command.expectedCurrent, r.current)) return fail('AUTOMATIC_PAIR_ORIGINAL_COMMAND_REQUIRED');
  return r;
}
/** Same current-admin transaction as admission. No existing job/policy is upgraded. */
export async function appendAutomaticPairMandatesInTransaction(client: PoolClient, input: AppendAutomaticPairMandatesInput,
  check: () => void = () => undefined, adapters: AutomaticPairMandateAdapters = {}): Promise<number> {
  const { principal: who } = input; policyUuidSchema.parse(input.projectId); policyUuidSchema.parse(input.jobId); policyUuidSchema.parse(who.userId);
  policyUuidSchema.parse(who.loginId); automaticPairPolicySchema.parse(input.policy); automaticPairSourceSchema.parse(input.source); policyHashSchema.parse(input.requestSha256);
  if ('kind' in who || 'grant' in who) return fail('AUTOMATIC_PAIR_HUMAN_AUTHORITY_REQUIRED'); assertLoginNotExpired(who); await requireCurrentLogin(client, who); check();
  if (!input.items.length || input.items.length > AUTOMATIC_PAIR_LIMITS.cables || input.items.some((item, i) => i > 0 && input.items[i - 1].cableId >= item.cableId))
    return fail('AUTOMATIC_PAIR_ITEM_SCOPE');
  const principal = (await client.query<Row>(`/* automatic-pair:principal */ SELECT u.is_admin,u.pf_admin_revision::text AS admin_revision,i.installation_epoch
    FROM users u CROSS JOIN pf_installation_state i WHERE u.id=$1 AND i.singleton=true FOR SHARE OF u,i`, [who.userId])).rows[0];
  if (!principal?.is_admin) return fail('ADMIN_REQUIRED', 403);
  const job = (await client.query<Row>(`/* automatic-pair:admitted-job */ SELECT requested_by,login_id,login_expires_at,authority_kind,cancel_requested,state,request_hash
    FROM pf_jobs WHERE project_id=$1 AND id=$2 FOR SHARE`, [input.projectId, input.jobId])).rows[0];
  if (!job || job.authority_kind !== 'current-login' || job.requested_by !== who.userId || job.login_id !== who.loginId
    || new Date(job.login_expires_at).getTime() !== who.loginExpiresAt || job.request_hash !== input.requestSha256 || job.cancel_requested
    || !['queued', 'running', 'complete'].includes(job.state)) return fail('AUTOMATIC_PAIR_JOB_AUTHORITY_REQUIRED');
  const impact = await originalImpact(client, input), now = new Date();
  const generationOutput = input.source.kind === 'automatic-generation' ? await requireAutomaticGenerationOutput(client,input.source,
    {projectId:input.projectId,actorId:who.userId,loginId:who.loginId,jobId:input.jobId,admission:true}) : null;
  const expiry = Math.min(who.loginExpiresAt, now.getTime() + AUTOMATIC_PAIR_LIMITS.authorityMilliseconds,
    impact ? Date.parse(impact.authorityExpiresAt) : Infinity,generationOutput ? Date.parse(generationOutput.authorityExpiresAt) : Infinity);
  if (impact && (impact.actorAdminRevision !== principal.admin_revision || impact.installationEpoch !== principal.installation_epoch)
    || expiry <= now.getTime()) return fail('AUTOMATIC_PAIR_AUTHORITY_EXPIRED');
  let count = 0;
  for (const item of input.items) {
    check(); policyUuidSchema.parse(item.cableId); policyRevisionSchema.parse(item.cableWriteRevision); policyHashSchema.parse(item.dependencyHash);
    if (await readAutomaticPairMandate(client, { projectId: input.projectId, jobId: input.jobId, cableId: item.cableId })) return fail('AUTOMATIC_PAIR_MANDATE_ALREADY_EXISTS');
    const admitted = (await client.query<Row>(`/* automatic-pair:admitted-item */ SELECT dependencies FROM pf_job_items
      WHERE project_id=$1 AND job_id=$2 AND cable_id=$3 FOR SHARE`, [input.projectId, input.jobId, item.cableId])).rows[0]?.dependencies;
    if (!admitted || admitted.projectId !== input.projectId || admitted.cableId !== item.cableId || admitted.schemaVersion !== 'pathfinder.dependencies.v8'
      || admitted.cableWriteRevision !== item.cableWriteRevision || automaticPairHash(admitted) !== item.dependencyHash
      || impact && !impact.eligibleCableIds.includes(item.cableId)) return fail('AUTOMATIC_PAIR_ITEM_SCOPE');
    if (impact) {
      const target = (await client.query<Row>(`/* automatic-pair:impact-target */ SELECT i.generation::text,i.record_sha256,i.record
        FROM pf_location_impact_items i JOIN pf_location_impact_targets t ON t.project_id=i.project_id AND t.cable_id=i.cable_id
        AND t.impact_id=i.impact_id AND t.generation=i.generation WHERE i.project_id=$1 AND i.impact_id=$2 AND i.cable_id=$3
        AND i.eligible FOR SHARE OF i,t`, [input.projectId, impact.id, item.cableId])).rows[0];
      const r = target?.record;
      if (!r || r.projectId !== input.projectId || r.impactId !== impact.id || r.cableId !== item.cableId || r.generation !== target.generation
        || r.cableWriteRevision !== item.cableWriteRevision || r.eligible !== true || r.contentSha256 !== target.record_sha256
        || automaticPairHash(Object.fromEntries(Object.entries(r).filter(([key]) => key !== 'contentSha256'))) !== target.record_sha256)
        return fail('AUTOMATIC_PAIR_IMPACT_TARGET_SUPERSEDED');
    }
    const before = (await client.query<Row>(`/* automatic-pair:cable-baseline */ SELECT CASE WHEN octet_length(to_jsonb(c)::text)<=65536
      THEN to_jsonb(c)||jsonb_build_object('design_length',c.design_length::text,'install_length',c.install_length::text,'cable_write_revision',c.cable_write_revision::text) ELSE NULL END AS value
      FROM cables c WHERE project_id=$1 AND id=$2 FOR UPDATE`, [input.projectId, item.cableId])).rows[0]?.value;
    if (!before || before.cable_write_revision !== item.cableWriteRevision) return fail('AUTOMATIC_PAIR_BASELINE_CHANGED');
    const ownership: AutomaticPairOwnershipDecision = await (adapters.ownership ?? readAutomaticPairOwnership)(client,
      { projectId: input.projectId, cableId: item.cableId, currentSnapshot: before }, check);
    if (ownership.kind === 'review-required') continue;
    const draft = automaticPairMandateSchema.parse({ schemaVersion: 'wfc.pf.automatic-pair-mandate.v1', id: randomUUID(), projectId: input.projectId,
      jobId: input.jobId, cableId: item.cableId, actorId: who.userId, actorAdminRevision: principal.admin_revision, loginId: who.loginId,
      loginExpiresAt: new Date(who.loginExpiresAt).toISOString(), authorityExpiresAt: new Date(expiry).toISOString(), installationEpoch: principal.installation_epoch,
      createdAt: now.toISOString(), policy: input.policy, source: input.source, requestSha256: input.requestSha256, dependencyHash: item.dependencyHash,
      cableWriteRevision: item.cableWriteRevision, baselineSha256: automaticPairHash(before), ownership, contentSha256: '0'.repeat(64) });
    const record = { ...draft, contentSha256: automaticPairHash(automaticPairMandateHashInput(draft)) };
    if (Buffer.byteLength(canonicalPurposeJson(record)) > AUTOMATIC_PAIR_LIMITS.recordBytes) return fail('AUTOMATIC_PAIR_RECORD_LIMIT', 413);
    await client.query(`INSERT INTO pf_automatic_pair_mandates(project_id,job_id,cable_id,id,actor_id,login_id,record_sha256,record,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [record.projectId, record.jobId, record.cableId, record.id, record.actorId, record.loginId, record.contentSha256, record, record.createdAt]);
    await client.query('INSERT INTO pf_automatic_pair_dispatch(project_id,job_id,cable_id) VALUES($1,$2,$3)', [record.projectId, record.jobId, record.cableId]); count++;
  }
  check(); assertLoginNotExpired(who); return count;
}
/** Current authority only, not a historical proof loader. Call before and after the exact pair write. */
export async function requireCurrentAutomaticPairMandate(client: PoolClient, expected: AutomaticPairMandate): Promise<AutomaticPairMandate> {
  const m = await readAutomaticPairMandate(client, expected, true);
  if (!m || !same(m, expected)) return fail('AUTOMATIC_PAIR_MANDATE_CHANGED');
  const who = { userId: m.actorId, loginId: m.loginId, loginExpiresAt: Date.parse(m.loginExpiresAt) };
  assertLoginNotExpired(who); if (Date.now() >= Date.parse(m.authorityExpiresAt)) return fail('AUTOMATIC_PAIR_AUTHORITY_EXPIRED', 401);
  await requireCurrentLogin(client, who);
  const p = (await client.query<Row>(`/* automatic-pair:current-authority */ SELECT u.is_admin,u.pf_admin_revision::text AS admin_revision,i.installation_epoch,
    j.requested_by,j.login_id,j.login_expires_at,j.authority_kind,j.cancel_requested,j.state,j.request_hash
    FROM users u CROSS JOIN pf_installation_state i JOIN pf_jobs j ON j.project_id=$1 AND j.id=$2
    WHERE u.id=$3 AND i.singleton=true FOR SHARE OF u,i,j`, [m.projectId, m.jobId, m.actorId])).rows[0];
  if (!p?.is_admin || p.admin_revision !== m.actorAdminRevision || p.installation_epoch !== m.installationEpoch || p.requested_by !== m.actorId
    || p.login_id !== m.loginId || new Date(p.login_expires_at).toISOString() !== m.loginExpiresAt || p.authority_kind !== 'current-login'
    || p.cancel_requested || ['failed', 'cancelled'].includes(p.state) || p.request_hash !== m.requestSha256) return fail('AUTOMATIC_PAIR_AUTHORITY_CHANGED');
  if (m.source.kind === 'location-impact') {
    const authority = await readLocationImpactJobAuthority(client, { projectId: m.projectId, jobId: m.jobId, cableId: m.cableId, lock: true });
    if (!authority?.valid || authority.impactId !== m.source.impactId) return fail('AUTOMATIC_PAIR_IMPACT_SUPERSEDED');
  } else {
    await requireEnrollmentAuthority(client, { projectId: m.projectId, jobId: m.jobId, cableId: m.cableId });
    if(m.source.kind==='automatic-generation')await requireAutomaticGenerationOutput(client,m.source,
      {projectId:m.projectId,actorId:m.actorId,loginId:m.loginId,jobId:m.jobId});
  }
  assertLoginNotExpired(who); if (Date.now() >= Date.parse(m.authorityExpiresAt)) return fail('AUTOMATIC_PAIR_AUTHORITY_EXPIRED', 401);
  return m;
}
