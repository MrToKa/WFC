import type { Pool } from 'pg';
import { z } from 'zod';
import { calculationGrantProvenanceSchema, type CalculationGrantProvenance } from '../../shared/pathfinderCalculationGrant.js';
import { canonicalPurposeJson, policyHashSchema, policyRevisionSchema, policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { assertLoginNotExpired } from './auth.js';
import { calculationGrantAuthoritySchema, calculationAuthorityOwnerHash, requireCalculationGrantRevision, type CalculationGrantAuthority } from './calculationAuthority.js';
import { createCalculationGrantRepository, newCalculationGrantLeaseOwner, type CalculationGrantLeaseClaim } from './calculationGrantRepository.js';
import { PathFinderError } from './errors.js';
import type { JobPrincipal } from './jobContracts.js';
import { grantOperationPrincipal, type OperationPrincipal } from './operationAuthority.js';
import { schedulerTransaction } from './schedulerTransaction.js';
import { grantWorkerRecoveryAdapter, type GrantWorkerRecoveryAdapter } from './grantWorkerRecovery.js';

/** Database inputs remain untrusted until their explicit authority discriminator is checked. */
export type GrantJobExecutionRow = {
  id: string; project_id: string; requested_by: string; authority_kind: unknown;
  grant_provenance?: unknown; kind?: unknown; login_id?: unknown; login_expires_at?: unknown;
};
export type GrantJobExecution = { principal: OperationPrincipal; finish(joinConfirmed: boolean): Promise<void> };
export type GrantJobClaimRecovery = Readonly<{
  jobId: string; projectId: string; provenance: CalculationGrantProvenance; claim: CalculationGrantLeaseClaim;
}>;
export type GrantJobExecutionOptions = {
  recovery?: GrantWorkerRecoveryAdapter;
  /** This must be an independently confirmed old process/container join, never mere lease expiry. */
  confirmRecoveredJoin?: (intent: GrantJobClaimRecovery) => Promise<boolean>;
};

/** Only a private recovery recorder may read privateRecovery. Ordinary logging/JSON omits its owner secret. */
export class GrantJobClaimOutcomeUnknownError extends PathFinderError {
  declare readonly privateRecovery: GrantJobClaimRecovery;
  constructor(recovery: GrantJobClaimRecovery) {
    super('CALCULATION_GRANT_COMMIT_OUTCOME_UNKNOWN', 503, 'The calculation lease claim outcome is unknown. Reconcile its original private owner intent before scheduling replacement work.');
    this.name = 'GrantJobClaimOutcomeUnknownError';
    Object.defineProperty(this, 'privateRecovery', { value: Object.freeze({ ...recovery,
      provenance: Object.freeze({ ...recovery.provenance }), claim: Object.freeze({ ...recovery.claim }) }), enumerable: false });
  }
  toJSON() { return { name: this.name, code: this.code, status: this.status, message: this.message }; }
  [Symbol.for('nodejs.util.inspect.custom')]() { return this.toJSON(); }
}

const modelSchema = z.object({ id: policyUuidSchema, selectionRevision: policyRevisionSchema, contentFingerprint: policyHashSchema }).strict();
const itemDependenciesSchema = z.object({ projectId: policyUuidSchema, cableId: policyUuidSchema, model: modelSchema }).passthrough();
const fail = (code: string, status = 409): never => { throw new PathFinderError(code, status); };

/** Serialized with claim admission, so a missing row is a positive no-claim result rather than an in-flight ACK race. */
async function reconcileIntent(pool: Pool, intent: GrantJobClaimRecovery): Promise<{ state: string; authority: CalculationGrantAuthority } | null> {
  return schedulerTransaction(pool, async c => {
    await c.query("SELECT pg_advisory_xact_lock(hashtext('wfc-pathfinder-calculation-grant-lease-v1'))");
    const row = (await c.query<Record<string, unknown>>(`SELECT id,project_id,grant_id,grant_revision::text,grant_epoch::text,installation_epoch,
      issuer_id,issuer_admin_revision::text,operation,model_version_id,selection_revision::text,content_fingerprint,owner_sha256,state,expires_at
      FROM pf_calculation_grant_leases WHERE id=$1 FOR UPDATE`, [intent.claim.leaseId])).rows[0];
    if (!row) return null;
    const { claim, provenance: p } = intent;
    if (row.id !== claim.leaseId || row.project_id !== intent.projectId || row.grant_id !== claim.grantId ||
      row.grant_revision !== claim.grantRevision || row.grant_epoch !== claim.grantEpoch || row.installation_epoch !== claim.installationEpoch ||
      row.issuer_id !== p.issuerId || row.issuer_admin_revision !== p.issuerAdminRevision || row.operation !== claim.operation ||
      row.model_version_id !== claim.modelVersionId || row.selection_revision !== claim.selectionRevision ||
      row.content_fingerprint !== claim.contentFingerprint || row.owner_sha256 !== calculationAuthorityOwnerHash(claim.ownerToken) ||
      !['active', 'quarantined', 'released'].includes(String(row.state))) return fail('CALCULATION_GRANT_RECOVERY_CONFLICT');
    const expiresAt = new Date(row.expires_at as string | number | Date);
    if (!Number.isFinite(expiresAt.getTime())) return fail('CALCULATION_GRANT_RECOVERY_CONFLICT');
    const authority = calculationGrantAuthoritySchema.parse({ ...claim, kind: 'calculation-grant',
      issuerId: p.issuerId, issuerAdminRevision: p.issuerAdminRevision, leaseExpiresAt: expiresAt.toISOString() });
    return { state: String(row.state), authority };
  });
}

/** One call is one quantum. A persisted issuer is never converted into an authenticated human session. */
export async function acquireGrantJobExecution(pool: Pool, job: GrantJobExecutionRow, signal?: AbortSignal, options: GrantJobExecutionOptions = {}): Promise<GrantJobExecution> {
  signal?.throwIfAborted();
  if (!policyUuidSchema.safeParse(job.id).success || !policyUuidSchema.safeParse(job.project_id).success || !policyUuidSchema.safeParse(job.requested_by).success)
    return fail('JOB_AUTHORITY_INVALID');
  if (job.authority_kind === 'current-login') {
    if (job.grant_provenance !== null || !policyUuidSchema.safeParse(job.login_id).success ||
      !(job.login_expires_at instanceof Date || typeof job.login_expires_at === 'string')) return fail('JOB_AUTHORITY_INVALID');
    const principal: JobPrincipal = { userId: job.requested_by, loginId: job.login_id as string, loginExpiresAt: new Date(job.login_expires_at).getTime() };
    assertLoginNotExpired(principal);
    // Read an EXISTING real binding. Unlike first human HTTP access, a worker
    // must never INSERT a missing login binding to manufacture authority.
    await schedulerTransaction(pool, async c => {
      if (!(await c.query('SELECT id FROM projects WHERE id=$1', [job.project_id])).rows.length) return fail('PROJECT_NOT_FOUND', 404);
      const live = (await c.query<{ is_admin: boolean; user_id: string | null; expires_at: Date | string | null; revoked_at: Date | string | null }>(
        `SELECT u.is_admin,l.user_id,l.expires_at,l.revoked_at FROM users u
          LEFT JOIN viewer_login_bindings l ON l.login_id=$2 WHERE u.id=$1`, [principal.userId, principal.loginId])).rows[0];
      if (!live || live.user_id !== principal.userId || live.revoked_at !== null || live.expires_at === null || new Date(live.expires_at).getTime() !== principal.loginExpiresAt)
        return fail('LOGIN_REVOKED', 401);
      if (live.is_admin !== true) return fail('ADMIN_REQUIRED', 403);
      signal?.throwIfAborted(); assertLoginNotExpired(principal);
    }, signal);
    return { principal, async finish(joinConfirmed) { if (typeof joinConfirmed !== 'boolean') fail('CALCULATION_GRANT_JOIN_REQUIRED'); } };
  }
  if (job.authority_kind !== 'calculation-grant') return fail('JOB_AUTHORITY_INVALID');
  if (job.kind !== 'calculate' || job.login_id !== null || job.login_expires_at !== null) return fail('CALCULATION_GRANT_JOB_SCOPE_DENIED', 403);
  const parsed = calculationGrantProvenanceSchema.safeParse(job.grant_provenance);
  if (!parsed.success || parsed.data.projectId !== job.project_id || parsed.data.issuerId !== job.requested_by)
    return fail('CALCULATION_GRANT_PROVENANCE_INVALID', 403);
  const provenance = parsed.data;
  const recovery = options.recovery ?? grantWorkerRecoveryAdapter, repository = createCalculationGrantRepository(pool);
  const previous = await recovery.read({ projectId: job.project_id, jobId: job.id });
  if (previous) {
    if (previous.projectId !== job.project_id || previous.jobId !== job.id ||
      canonicalPurposeJson(previous.provenance) !== canonicalPurposeJson(provenance)) return fail('CALCULATION_GRANT_RECOVERY_CONFLICT');
    const existing = await reconcileIntent(pool, previous);
    if (existing && existing.state !== 'released') {
      if (!options.confirmRecoveredJoin || await options.confirmRecoveredJoin(previous) !== true)
        return fail('CALCULATION_GRANT_LEASE_RECOVERY_REQUIRED');
      // Cleanup may use the old exact owner after expiry/revocation; it never grants new execution.
      await repository.release(existing.authority);
    }
    await recovery.retire(previous);
  }
  signal?.throwIfAborted();
  const model = await schedulerTransaction(pool, async c => {
    let item = (await c.query<{ cable_id: string; dependencies: unknown }>(
      `SELECT cable_id,dependencies FROM pf_job_items WHERE project_id=$1 AND job_id=$2 AND state='waiting' ORDER BY cable_id LIMIT 1`,
      [job.project_id, job.id])).rows[0];
    // A recovered job can have committed its last immutable proposal before the
    // terminal job-state ACK. Retain a real dependency scope for that bookkeeping
    // quantum; no engine request is fabricated and the worker still finds no item.
    if(!item)item=(await c.query<{cable_id:string;dependencies:unknown}>(
      "SELECT cable_id,dependencies FROM pf_job_items WHERE project_id=$1 AND job_id=$2 AND state='complete' AND dependencies IS NOT NULL ORDER BY cable_id LIMIT 1",[job.project_id,job.id])).rows[0];
    if (!item) return fail('CALCULATION_GRANT_WAITING_ITEM_REQUIRED');
    const dependencies = itemDependenciesSchema.safeParse(item.dependencies);
    if (!dependencies.success || dependencies.data.projectId !== job.project_id || dependencies.data.cableId !== item.cable_id)
      return fail('CALCULATION_GRANT_JOB_MODEL_INVALID');
    await requireCalculationGrantRevision(c, provenance);
    signal?.throwIfAborted(); return dependencies.data.model;
  }, signal);
  signal?.throwIfAborted();
  const claim: CalculationGrantLeaseClaim = Object.freeze({ projectId: job.project_id, grantId: provenance.grantId,
    grantRevision: provenance.grantRevision, grantEpoch: provenance.grantEpoch, installationEpoch: provenance.installationEpoch,
    operation: 'calculate', modelVersionId: model.id, selectionRevision: model.selectionRevision, contentFingerprint: model.contentFingerprint,
    ...newCalculationGrantLeaseOwner() });
  const intent: GrantJobClaimRecovery = Object.freeze({ jobId: job.id, projectId: job.project_id,
    provenance: Object.freeze({ ...provenance }), claim: Object.freeze({ ...claim }) });
  await recovery.retain(intent);
  const authority = await repository.claim(claim, signal).catch(error => {
    if (error instanceof PathFinderError && error.code === 'CALCULATION_GRANT_COMMIT_OUTCOME_UNKNOWN')
      throw new GrantJobClaimOutcomeUnknownError(intent);
    throw error;
  }).catch(async error => {
    // A thrown refusal or transient transport is not proof that claim never committed.
    // Only a successful serialized exact no-row/released read permits retiring its owner intent.
    if (!(error instanceof GrantJobClaimOutcomeUnknownError)) {
      const observed = await reconcileIntent(pool, intent).catch(() => undefined);
      if (observed === null || observed?.state === 'released') await recovery.retire(intent);
    }
    throw error;
  });
  // After a known successful claim, return ownership even if cancellation just
  // arrived. The worker finally block must join (or confirm no engine started)
  // and retire this EXACT owner, rather than losing it in a thrown abort.
  let disposition: 'released' | 'quarantined' | undefined, cleanup: Promise<void> | undefined;
  return { principal: grantOperationPrincipal(authority), async finish(joinConfirmed) {
    if (typeof joinConfirmed !== 'boolean') return fail('CALCULATION_GRANT_JOIN_REQUIRED');
    const requested = joinConfirmed ? 'released' : 'quarantined';
    if (disposition !== undefined && disposition !== requested) return fail('CALCULATION_GRANT_CLEANUP_CONFLICT');
    disposition = requested;
    // Same-disposition retries retain the exact lease even after an uncertain
    // cleanup COMMIT. An unconfirmed join can never fall through to release.
    cleanup ??= (joinConfirmed ? repository.release(authority).then(() => recovery.retire(intent)) : repository.quarantine(authority, 'ENGINE_SESSION_REAP_FAILED'))
      .catch(error => { cleanup = undefined; throw error; });
    await cleanup;
  } };
}
