import type { PoolClient } from 'pg';
import { canonicalPurposeJson, policyHashSchema, policyRevisionSchema, policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { canonicalDecimalString } from '../../shared/pathfinderLengthLedger.js';
import type { CableWorkflowRow } from '../../shared/pathfinderCableWorkflow.js';
import type { DependencySnapshot, EngineResponse } from './jobContracts.js';
import { designLengthCompatibilityIssue, optionsSchema, proposalRoutingPreferences, routeCompatibilityIssue } from './jobContracts.js';
import { hash } from './dependencies.js';
import { requireVersionedCalculationScope } from './routingScope.js';
import { requireCalculationLengthLedger } from './lengthLedger.js';
import { verifyRevisionResultForProposal } from './revisionResultRepository.js';
import { readRecalculationJobAuthority } from './recalculationRepository.js';

export const WORKFLOW_PROOF_BYTES = 256 * 1024;
type Data = Record<string, any>;
type Verified = { raw: Data; dependencies: DependencySnapshot; result: EngineResponse; seal: NonNullable<Awaited<ReturnType<typeof verifyRevisionResultForProposal>>> };
const object = (value: unknown): Data | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Data : null;
const same = (a: unknown, b: unknown): boolean => canonicalPurposeJson(a) === canonicalPurposeJson(b);
const decimalEqual = (a: unknown, b: unknown): boolean => {
  if (a === null || b === null) return a === b;
  try { return typeof a === 'string' && typeof b === 'string' && canonicalDecimalString(a) === canonicalDecimalString(b); } catch { return false; }
};

/** Exact existing seal/ledger/compatibility proof; no engine invocation or weakened hash. */
export async function readWorkflowVerifiedProposal(client: PoolClient, projectId: string, cableId: string, proposalId: string): Promise<Verified | null> {
  policyUuidSchema.parse(proposalId);
  const raw = (await client.query<Data>(`/* cable-workflow:proposal-proof */ SELECT p.id,p.project_id,p.cable_id,p.job_id,p.status,p.proposal_hash,p.dependency_hash,
    CASE WHEN octet_length(p.dependencies::text)+octet_length(p.result::text)<=$4 THEN p.dependencies ELSE NULL END AS dependencies,
    CASE WHEN octet_length(p.dependencies::text)+octet_length(p.result::text)<=$4 THEN p.result ELSE NULL END AS result,
    j.state AS job_state,j.cancel_requested
    FROM pf_proposals p JOIN pf_jobs j ON j.project_id=p.project_id AND j.id=p.job_id
    WHERE p.project_id=$1 AND p.cable_id=$2 AND p.id=$3`, [projectId, cableId, proposalId, WORKFLOW_PROOF_BYTES])).rows[0];
  try {
    if (!raw || raw.id !== proposalId || raw.project_id !== projectId || raw.cable_id !== cableId || raw.status !== 'calculated'
      || !policyHashSchema.safeParse(raw.proposal_hash).success || !policyHashSchema.safeParse(raw.dependency_hash).success) return null;
    const dependencies = object(raw.dependencies) as DependencySnapshot | null, result = object(raw.result) as EngineResponse | null;
    if (!dependencies || !result || dependencies.projectId !== projectId || dependencies.cableId !== cableId
      || hash(dependencies) !== raw.dependency_hash || !optionsSchema.safeParse(dependencies.options).success) return null;
    requireVersionedCalculationScope(dependencies);
    if (result.status !== 'calculated' || !result.route?.success || !result.design || !proposalRoutingPreferences(dependencies.options)
      || routeCompatibilityIssue(result.route.routeText) || designLengthCompatibilityIssue(result.design.designLengthMeters)) return null;
    const ledger = requireCalculationLengthLedger(result, dependencies.settings);
    if (!ledger) return null;
    const seal = await verifyRevisionResultForProposal(client, { projectId, proposalId, result, dependencies, proposalHash: raw.proposal_hash });
    if (!seal || seal.projectId !== projectId || seal.cableId !== cableId || seal.jobId !== raw.job_id || !seal.ledgerHash || seal.ledgerHash !== hash(ledger)) return null;
    return { raw, dependencies, result, seal };
  } catch { return null; }
}

export function createCableWorkflowProofReader(client: PoolClient, projectId: string, check: () => void) {
  const proposals = new Map<string, Promise<Verified | null>>(), enrollment = new Map<string, ReturnType<typeof readRecalculationJobAuthority>>();
  const proposal = (cableId: string, proposalId: string) => {
    const key = cableId + ':' + proposalId;
    if (!proposals.has(key)) proposals.set(key, readWorkflowVerifiedProposal(client, projectId, cableId, proposalId));
    return proposals.get(key)!;
  };
  return {
    verified: proposal,
    async reviewable(cableId: string, jobId: string, proposalId: string, current: DependencySnapshot | null) {
      check(); const verified = await proposal(cableId, proposalId); check();
      if (!verified || verified.raw.job_id !== jobId) return { currentness: 'unavailable' as const, reviewable: false, reasonCodes: ['PROPOSAL_PROOF_UNAVAILABLE'] };
      if (!current || hash(current) !== verified.raw.dependency_hash)
        return { currentness: 'changed' as const, reviewable: false, reasonCodes: ['PROPOSAL_DEPENDENCIES_CHANGED'] };
      if (!enrollment.has(jobId)) enrollment.set(jobId, readRecalculationJobAuthority(client, { projectId, jobId }));
      const authority = await enrollment.get(jobId)!; check();
      if (authority.enrolled && !authority.valid)
        return { currentness: 'changed' as const, reviewable: false, reasonCodes: [authority.code] };
      return { currentness: 'current' as const, reviewable: verified.raw.job_state === 'complete' && verified.raw.cancel_requested === false,
        reasonCodes: verified.raw.cancel_requested ? ['CALCULATION_CANCEL_REQUESTED'] : [] };
    },
    /** Only a receipt-proven own write can explain the pre/post cable revision difference. */
    async accepted(cable: CableWorkflowRow['cable'], currentForOptions: (options: unknown) => Promise<DependencySnapshot | null>): Promise<boolean> {
      check(); const receipt = (await client.query<Data>(`/* cable-workflow:accepted-proof */ SELECT r.id,r.project_id,r.cable_id,r.proposal_id,r.actor_id,r.idempotency_key,r.payload_hash,
        CASE WHEN octet_length(r.before_snapshot::text)+octet_length(r.after_snapshot::text)+octet_length(r.provenance::text)<=$3 THEN r.before_snapshot ELSE NULL END AS before_snapshot,
        CASE WHEN octet_length(r.before_snapshot::text)+octet_length(r.after_snapshot::text)+octet_length(r.provenance::text)<=$3 THEN r.after_snapshot ELSE NULL END AS after_snapshot,
        CASE WHEN octet_length(r.before_snapshot::text)+octet_length(r.after_snapshot::text)+octet_length(r.provenance::text)<=$3 THEN r.provenance ELSE NULL END AS provenance,
        v.id AS review_id,v.actor_id AS review_actor,v.proposal_id AS review_proposal,v.proposal_hash AS review_proposal_hash,
        v.validation_method,v.revision_result_sha256,v.review_dependency_sha256,v.review_login_id
        FROM pf_apply_receipts r LEFT JOIN pf_reviews v ON v.project_id=r.project_id AND v.id::text=r.provenance->>'reviewId'
        WHERE r.project_id=$1 AND r.cable_id=$2 ORDER BY r.applied_at DESC,r.id DESC LIMIT 1`, [projectId, cable.id, WORKFLOW_PROOF_BYTES])).rows[0]; check();
      try {
        if (!receipt || receipt.project_id !== projectId || receipt.cable_id !== cable.id || !policyUuidSchema.safeParse(receipt.proposal_id).success) return false;
        const before = object(receipt.before_snapshot), after = object(receipt.after_snapshot), provenance = object(receipt.provenance);
        if (!before || !after || !provenance || provenance.schemaVersion !== 'pathfinder.apply.v2'
          || before.id !== cable.id || after.id !== cable.id || before.project_id !== projectId || after.project_id !== projectId
          || !policyRevisionSchema.safeParse(before.cable_write_revision).success || !policyRevisionSchema.safeParse(after.cable_write_revision).success
          || BigInt(after.cable_write_revision) !== BigInt(before.cable_write_revision) + 1n || after.cable_write_revision !== cable.cableWriteRevision
          || after.routing !== cable.routing || !decimalEqual(after.design_length, cable.designLength) || !decimalEqual(after.install_length, cable.installLength)) return false;
        const changed = new Set(['routing', 'design_length', 'updated_at', 'cable_write_revision']);
        if (!same(Object.keys(before).sort(), Object.keys(after).sort()) || Object.keys(before).some(key => !changed.has(key) && !same(before[key], after[key]))) return false;
        const verified = await proposal(cable.id, receipt.proposal_id); check(); if (!verified) return false;
        const { dependencies, result, seal, raw } = verified;
        if (dependencies.cableWriteRevision !== before.cable_write_revision || provenance.proposalId !== raw.id || provenance.proposalHash !== raw.proposal_hash
          || provenance.reviewId !== receipt.review_id || provenance.review?.id !== receipt.review_id || provenance.review?.actorId !== receipt.actor_id
          || receipt.review_actor !== receipt.actor_id || receipt.review_proposal !== raw.id || receipt.review_proposal_hash !== raw.proposal_hash
          || !['manual-review', 'synthetic-fixture'].includes(receipt.validation_method) || provenance.validationMethod !== receipt.validation_method
          || receipt.revision_result_sha256 !== seal.revisionResultSha256 || receipt.review_dependency_sha256 !== raw.dependency_hash
          || provenance.review?.loginId !== receipt.review_login_id || provenance.review?.dependencyHash !== raw.dependency_hash
          || provenance.review?.revisionResultSha256 !== seal.revisionResultSha256 || !same(provenance.dependencies, dependencies)
          || provenance.revisionResult?.revisionResultSha256 !== seal.revisionResultSha256 || provenance.revisionResult?.dependencyHash !== raw.dependency_hash
          || provenance.revisionResult?.baselineHash !== seal.baselineHash || provenance.revisionResult?.ledgerHash !== seal.ledgerHash
          || after.routing !== result.route!.routeText || !decimalEqual(after.design_length, result.design!.designLengthMeters)
          || receipt.payload_hash !== hash({ proposalId: raw.id, idempotencyKey: receipt.idempotency_key, reviewId: receipt.review_id, expectedCableWriteRevision: before.cable_write_revision })) return false;
        const current = await currentForOptions(dependencies.options); check();
        // No mutation or general hash exception: restore exactly one proven own-write revision in this local comparison only.
        return current !== null && hash({ ...current, cableWriteRevision: before.cable_write_revision }) === raw.dependency_hash;
      } catch { check(); return false; }
    },
  };
}
