import type { Pool, PoolClient } from 'pg';
import { canonicalPurposeJson } from '../../shared/pathfinderPurposePolicy.js';
import { initialFillProgressSchema, initialFillProgressQuerySchema, initialFillProgressStatuses, emptyInitialFillCounters,
  INITIAL_FILL_PROGRESS_LIMITS, type InitialFillProgress, type InitialFillProgressQuery, type InitialFillProgressStatus } from '../../shared/pathfinderInitialFillProgress.js';
import { locationImpactRecordSchema, type LocationImpactRecord } from '../../shared/pathfinderLocationImpacts.js';
import { initialFillMandateReference } from '../../shared/pathfinderInitialFill.js';
import { readInitialFillMandateForImpact } from './initialFillMandates.js';
import { hash } from './dependencies.js';
import { cableWorkflowReadTransaction } from './cableWorkflowRead.js';
import type { JobPrincipal } from './jobContracts.js';
import { PathFinderError } from './errors.js';
type Row = Record<string, any>;
const fail = (code: string, status = 409): never => { throw new PathFinderError(code, status, 'Initial-fill progress is unavailable for this exact account and impact. Refresh its status.'); };
const code = (value: unknown, fallback: string) => typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/.test(value) ? value : fallback;
const iso = (value: Date | string | null) => value === null ? null : new Date(value).toISOString();

/** Metadata observation of original authority. This neither renews nor grants it. */
async function currentAuthority(client: PoolClient, value: LocationImpactRecord): Promise<boolean> {
  const row = (await client.query<Row>(`/* initial-fill-progress:authority */ SELECT u.is_admin,u.pf_admin_revision::text AS admin_revision,
    l.user_id,l.expires_at,l.revoked_at,i.installation_epoch,s.active_model_version_id,s.selection_revision::text,m.state,m.health,m.content_fingerprint,
    p.current_aggregate_id,p.current_artifact_id,p.geometry_revision::text,a.manifest->>'coordinateFrameId' AS capture_frame_id,f.snapshot_sha256,
    (SELECT id FROM pf_geometry_trace_sets WHERE project_id=$1 AND aggregate_id=p.current_aggregate_id ORDER BY created_at DESC,id DESC LIMIT 1) AS trace_id
    FROM users u LEFT JOIN viewer_login_bindings l ON l.login_id=$3 CROSS JOIN pf_installation_state i
    LEFT JOIN project_model_selections s ON s.project_id=$1 LEFT JOIN model_versions m ON m.project_id=s.project_id AND m.id=s.active_model_version_id
    LEFT JOIN pf_project_preparations p ON p.project_id=$1 LEFT JOIN pf_preparation_aggregates a ON a.project_id=p.project_id AND a.id=p.current_aggregate_id
    LEFT JOIN pf_artifacts f ON f.project_id=p.project_id AND f.id=p.current_artifact_id WHERE u.id=$2 AND i.singleton=true`, [value.projectId, value.actorId, value.loginId])).rows[0];
  const c = value.current;
  return Boolean(row && row.is_admin && row.admin_revision === value.actorAdminRevision && row.user_id === value.actorId && row.revoked_at === null
    && iso(row.expires_at) === value.loginExpiresAt && row.installation_epoch === value.installationEpoch
    && Date.now() < Math.min(Date.parse(value.loginExpiresAt), Date.parse(value.authorityExpiresAt))
    && row.active_model_version_id === c.modelVersionId && row.selection_revision === c.selectionRevision && row.state === 'ready' && row.health === 'healthy'
    && row.content_fingerprint === c.contentFingerprint && row.current_aggregate_id === c.aggregateId && row.current_artifact_id === c.artifactId
    && row.geometry_revision === c.geometryRevision && row.capture_frame_id === c.captureFrameId && row.snapshot_sha256 === c.projectionSha256 && row.trace_id === c.traceId);
}
function observation(row: Row, live: boolean): { status: InitialFillProgressStatus; reasonCode: string | null; receiptId: string | null; retryable: boolean } {
  const result = (status: InitialFillProgressStatus, reasonCode: string | null = null, receiptId: string | null = null, retryable = false) => ({ status, reasonCode, receiptId, retryable });
  if (row.attempt_key) {
    if (!initialFillProgressStatuses.includes(row.dispatch_status) || ['awaiting-result', 'not-applicable'].includes(row.dispatch_status)) return result('unknown', 'INITIAL_FILL_DISPATCH_UNAVAILABLE');
    const status = row.dispatch_status as InitialFillProgressStatus;
    if (['written', 'already-written'].includes(status)) return row.verified_receipt_id ? result(status, null, row.verified_receipt_id) : result('unknown', 'INITIAL_FILL_RECEIPT_REQUIRED');
    const retryable = status === 'unknown' && Number.isInteger(row.attempts) && row.attempts < 3 && row.not_before !== null;
    // A status without a scheduled dispatch/valid running lease is uncertain,
    // not evidence of an endlessly active worker.
    if (status === 'pending' && (row.not_before === null || !Number.isInteger(row.attempts) || row.attempts >= 3)) return result('unknown', row.attempts >= 3 ? 'INITIAL_FILL_RECOVERY_LIMIT' : 'INITIAL_FILL_DISPATCH_UNAVAILABLE');
    if (status === 'running') {
      const expiry = row.lease_until === null ? NaN : new Date(row.lease_until).getTime();
      if (!Number.isFinite(expiry)) return result('unknown', 'INITIAL_FILL_DISPATCH_UNAVAILABLE');
      if (expiry <= Date.now()) {
        const recoverable = Number.isInteger(row.attempts) && row.attempts < 3 && row.not_before !== null;
        return result('unknown', recoverable ? 'INITIAL_FILL_LEASE_EXPIRED' : 'INITIAL_FILL_RECOVERY_LIMIT', null, recoverable);
      }
    }
    return result(status, row.reason_code === null ? null : code(row.reason_code, 'INITIAL_FILL_UNAVAILABLE'), null, retryable);
  }
  const activeJob = ['queued', 'running', 'complete'].includes(row.job_state) && row.cancel_requested === false;
  if (live && row.proposal_status === 'calculated' && row.dependency_version === 'pathfinder.dependencies.v7' && row.item_state === 'complete' && row.item_status === 'calculated' && activeJob)
    return result('awaiting-result', 'INITIAL_FILL_AWAITING_DISCOVERY');
  if (live && ['queued', 'running'].includes(row.job_state) && row.cancel_requested === false && ['waiting', 'running'].includes(row.item_state))
    return result('awaiting-result', 'INITIAL_FILL_AWAITING_CALCULATION');
  if (live && !row.job_id && ['pending', 'collecting'].includes(row.impact_status)) return result('awaiting-result', 'INITIAL_FILL_AWAITING_CALCULATION');
  return result('not-applicable', !live ? 'INITIAL_FILL_AUTHORITY_NOT_CURRENT' : row.cancel_requested || ['cancelled', 'failed'].includes(row.job_state)
    ? 'INITIAL_FILL_CALCULATION_STOPPED' : row.item_status === 'no_path' ? 'INITIAL_FILL_NO_PATH' : 'INITIAL_FILL_RESULT_NOT_APPLICABLE');
}

export function createInitialFillProgress(pool: Pool) {
  return { read(projectId: string, who: JobPrincipal, raw: InitialFillProgressQuery, signal?: AbortSignal) {
    const input = initialFillProgressQuerySchema.parse(raw);
    return cableWorkflowReadTransaction(pool, projectId, who, async (client, check) => {
      const row = (await client.query<Row>(`/* initial-fill-progress:impact */ SELECT project_id,id,actor_id,login_id,idempotency_key,command_sha256,record_sha256,
        CASE WHEN octet_length(record::text)<=1048576 THEN record ELSE NULL END AS record FROM pf_location_impacts WHERE project_id=$1 AND actor_id=$2 AND id=$3`, [projectId, who.userId, input.impactId])).rows[0];
      if (!row) return fail('INITIAL_FILL_IMPACT_NOT_FOUND', 404);
      const parsed = locationImpactRecordSchema.safeParse(row.record); if (!parsed.success) return fail('INITIAL_FILL_PROGRESS_INTEGRITY'); const impact = parsed.data, { contentSha256, ...body } = impact;
      if (impact.projectId !== projectId || impact.actorId !== who.userId || impact.id !== input.impactId || row.project_id !== projectId || row.actor_id !== who.userId || row.id !== impact.id || impact.contentSha256 !== row.record_sha256 || hash(body) !== contentSha256
        || impact.loginId !== row.login_id || impact.idempotencyKey !== row.idempotency_key || impact.commandSha256 !== row.command_sha256) return fail('INITIAL_FILL_PROGRESS_INTEGRITY');
      const allIds = [...impact.eligibleCableIds, ...impact.excludedMvCableIds, ...impact.blockedCategoryCableIds];
      if (input.cableId && !allIds.includes(input.cableId)) return fail('INITIAL_FILL_CABLE_OUTSIDE_IMPACT', 404);
      const mandate = await readInitialFillMandateForImpact(client, projectId, impact.id), counters = emptyInitialFillCounters();
      if (mandate && (mandate.projectId !== projectId || mandate.impactId !== impact.id || mandate.actorId !== who.userId || mandate.impactContentSha256 !== contentSha256 || mandate.commandSha256 !== impact.commandSha256
        || mandate.actorAdminRevision !== impact.actorAdminRevision || mandate.loginId !== impact.loginId || mandate.loginExpiresAt !== impact.loginExpiresAt || mandate.authorityExpiresAt !== impact.authorityExpiresAt
        || mandate.installationEpoch !== impact.installationEpoch || mandate.idempotencyKey !== impact.idempotencyKey || canonicalPurposeJson(mandate.current) !== canonicalPurposeJson(impact.current)
        || canonicalPurposeJson(mandate.eligibleCableIds) !== canonicalPurposeJson(impact.eligibleCableIds))) return fail('INITIAL_FILL_PROGRESS_INTEGRITY');
      let selected: InitialFillProgress['selected'] = input.cableId ? { cableId: input.cableId, status: mandate ? 'not-applicable' : 'not-authorized', reasonCode: mandate ? 'INITIAL_FILL_CATEGORY_EXCLUDED' : 'INITIAL_FILL_EXPLICIT_MANDATE_REQUIRED', receiptId: null } : null;
      let retryableUnknown = 0;
      const live = mandate ? await currentAuthority(client, impact) : false;
      if (mandate && impact.eligibleCableIds.length) {
        const rows = (await client.query<Row>(`/* initial-fill-progress:items */ SELECT scope.cable_id,e.job_id,j.state AS job_state,j.cancel_requested,i.state AS item_state,
          CASE WHEN octet_length(i.status)<=96 THEN i.status ELSE NULL END AS item_status,
          CASE WHEN octet_length(p.status)<=96 THEN p.status ELSE NULL END AS proposal_status,
          CASE WHEN octet_length(p.dependencies->>'schemaVersion')<=96 THEN p.dependencies->>'schemaVersion' ELSE NULL END AS dependency_version,
          a.idempotency_key AS attempt_key,d.status AS dispatch_status,d.attempts,d.not_before,d.lease_until,
          CASE WHEN d.reason_code~'^[A-Z][A-Z0-9_]{0,95}$' THEN d.reason_code ELSE NULL END AS reason_code,r.id AS verified_receipt_id,dispatch.status AS impact_status
          FROM unnest($3::uuid[]) scope(cable_id) LEFT JOIN pf_location_impact_enrollments e ON e.project_id=$1 AND e.impact_id=$2
          LEFT JOIN pf_location_impact_dispatch dispatch ON dispatch.project_id=$1 AND dispatch.impact_id=$2
          LEFT JOIN pf_jobs j ON j.project_id=e.project_id AND j.id=e.job_id LEFT JOIN pf_job_items i ON i.project_id=e.project_id AND i.job_id=e.job_id AND i.cable_id=scope.cable_id
          LEFT JOIN pf_proposals p ON p.project_id=e.project_id AND p.job_id=e.job_id AND p.cable_id=scope.cable_id
          LEFT JOIN pf_initial_fill_attempts a ON a.project_id=$1 AND a.mandate_id=$4 AND a.proposal_id=p.id AND a.actor_id=$5
          LEFT JOIN pf_initial_fill_dispatch d ON d.project_id=a.project_id AND d.actor_id=a.actor_id AND d.idempotency_key=a.idempotency_key
          LEFT JOIN pf_apply_receipts r ON r.project_id=a.project_id AND r.actor_id=a.actor_id AND r.idempotency_key=a.idempotency_key AND r.proposal_id=a.proposal_id AND r.cable_id=a.cable_id AND r.id=d.receipt_id
          ORDER BY scope.cable_id LIMIT 10001`, [projectId, impact.id, impact.eligibleCableIds, mandate.id, who.userId])).rows;
        if (rows.length !== impact.eligibleCableIds.length || rows.some((item, at) => item.cable_id !== impact.eligibleCableIds[at])) return fail('INITIAL_FILL_PROGRESS_INTEGRITY');
        for (const item of rows) { check(); const value = observation(item, live); counters[value.status]++; if (value.retryable) retryableUnknown++;
          if (item.cable_id === input.cableId) selected = { cableId: item.cable_id, status: value.status, reasonCode: value.reasonCode, receiptId: value.receiptId }; }
      }
      check(); const result = initialFillProgressSchema.parse({ schemaVersion: 'wfc.pf.initial-fill-progress.v1', projectId, actorId: who.userId, impactId: impact.id,
        mandate: mandate ? initialFillMandateReference(mandate) : null, authorized: mandate !== null, currentAuthority: live, eligibleCables: impact.eligibleCableIds.length,
        counters, retryableUnknown, outstanding: counters.pending + counters.running + retryableUnknown + counters['awaiting-result'], selected });
      if (Buffer.byteLength(canonicalPurposeJson(result)) > INITIAL_FILL_PROGRESS_LIMITS.responseBytes) return fail('INITIAL_FILL_PROGRESS_LIMIT', 413); return result;
    }, signal);
  } };
}
