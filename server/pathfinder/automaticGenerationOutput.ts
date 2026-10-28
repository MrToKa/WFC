import type { PoolClient } from 'pg';
import { automaticGenerationAuthorizationSchema, automaticPairSourceSchema, type AutomaticGenerationAuthorization, type AutomaticPairSource } from '../../shared/pathfinderAutomaticPair.js';
import { automaticOutputEnableCommandSchema, recalculationReceiptSchema } from '../../shared/pathfinderRecalculation.js';
import { canonicalPurposeJson } from '../../shared/pathfinderPurposePolicy.js';
import { createHash } from 'node:crypto';
import { PathFinderError } from './errors.js';
type Row = Record<string, any>;
const same = (a: unknown, b: unknown) => canonicalPurposeJson(a) === canonicalPurposeJson(b);
const hash = (v: unknown) => createHash('sha256').update(canonicalPurposeJson(v)).digest('hex');
const fail = (code: string): never => { throw new PathFinderError(code, 409, 'Automatic project output permission changed or expired. Existing Cable list values are retained.'); };
export function activeAutomaticGenerationAuthorization(state: Row): AutomaticGenerationAuthorization | null {
  const parsed = automaticGenerationAuthorizationSchema.safeParse(state.automatic_pair_authority);
  if (!parsed.success) return null;
  const a = parsed.data;
  return a.projectId === state.project_id && a.actorId === state.actor_id && a.loginId === state.login_id
    && Date.parse(a.loginExpiresAt) === new Date(state.login_expires_at).getTime()
    && Date.parse(a.authorityExpiresAt) > Date.now() ? a : null;
}
/** A current source cannot be inferred from a calculated proposal or old enable.
 * Admission runs before its enrollment insert; writes additionally require that exact immutable enrollment. */
export async function requireAutomaticGenerationOutput(client: PoolClient, raw: AutomaticPairSource,
  input: { projectId: string; actorId: string; loginId: string; jobId: string; admission?: boolean }): Promise<AutomaticGenerationAuthorization> {
  const source = automaticPairSourceSchema.parse(raw); if (source.kind !== 'automatic-generation') return fail('AUTOMATIC_OUTPUT_SOURCE_REQUIRED');
  const a = source.authorization;
  if (a.projectId !== input.projectId || a.actorId !== input.actorId || a.loginId !== input.loginId || Date.now() >= Date.parse(a.authorityExpiresAt))
    return fail('AUTOMATIC_OUTPUT_AUTHORITY_EXPIRED');
  const state = (await client.query<Row>('/* automatic-generation:state */ SELECT s.project_id,s.desired_generation::text,s.control_revision::text,s.authority_epoch::text,s.enabled,s.paused,s.actor_id,s.login_id,s.login_expires_at,s.authority_expires_at,s.automatic_pair_authority,u.is_admin,u.pf_admin_revision::text AS admin_revision,i.installation_epoch FROM pf_recalculation_state s JOIN users u ON u.id=s.actor_id CROSS JOIN pf_installation_state i WHERE s.project_id=$1 AND i.singleton=true FOR SHARE OF s,u,i', [input.projectId])).rows[0];
  if (!state || !state.enabled || state.paused || state.desired_generation !== source.generation || state.control_revision !== source.controlRevision
    || state.authority_epoch !== source.authorityEpoch || !state.is_admin || state.admin_revision !== a.actorAdminRevision
    || state.installation_epoch !== a.installationEpoch || Date.now() >= new Date(state.authority_expires_at).getTime()
    || !same(activeAutomaticGenerationAuthorization(state), a)) return fail('AUTOMATIC_OUTPUT_GENERATION_CHANGED');
  const stored = (await client.query<Row>('/* automatic-generation:enable-command */ SELECT request_sha256,CASE WHEN octet_length(request::text)<=65536 THEN request ELSE NULL END AS request,CASE WHEN octet_length(receipt::text)<=1048576 THEN receipt ELSE NULL END AS receipt FROM pf_recalculation_commands WHERE project_id=$1 AND actor_id=$2 AND idempotency_key=$3 FOR SHARE', [input.projectId, a.actorId, a.commandKey])).rows[0];
  const command = automaticOutputEnableCommandSchema.safeParse(stored?.request), receipt = recalculationReceiptSchema.safeParse(stored?.receipt);
  if (!command.success || !receipt.success || stored?.request_sha256 !== a.commandSha256 || hash(command.data) !== a.commandSha256
    || command.data.idempotencyKey !== a.commandKey || BigInt(command.data.expectedControlRevision) + 1n !== BigInt(a.controlRevision)
    || !same(command.data.automaticPairPolicy, a.policy) || !same(receipt.data.automaticPairAuthorization, a)
    || receipt.data.context.projectId !== input.projectId || receipt.data.context.controlRevision !== a.controlRevision
    || receipt.data.context.authority?.actorId !== a.actorId || receipt.data.context.authority.expiresAt !== a.authorityExpiresAt
    || !same(receipt.data.context.automaticPairPolicy, a.policy)) return fail('AUTOMATIC_OUTPUT_ORIGINAL_ENABLE_REQUIRED');
  if (!input.admission) {
    const enrolled = (await client.query<Row>('/* automatic-generation:enrollment */ SELECT generation::text,control_revision::text,authority_epoch::text,actor_id,login_id,automatic_pair_authority FROM pf_recalculation_enrollments WHERE project_id=$1 AND job_id=$2 FOR SHARE', [input.projectId, input.jobId])).rows[0];
    if (!enrolled || enrolled.generation !== source.generation || enrolled.control_revision !== source.controlRevision
      || enrolled.authority_epoch !== source.authorityEpoch || enrolled.actor_id !== a.actorId || enrolled.login_id !== a.loginId
      || !same(enrolled.automatic_pair_authority, a)) return fail('AUTOMATIC_OUTPUT_ENROLLMENT_CHANGED');
  }
  return a;
}
