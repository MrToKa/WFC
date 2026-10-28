import type { PoolClient } from 'pg';
import { createHash } from 'node:crypto';
import { canonicalPurposeJson, policyHashSchema, policyRevisionSchema, policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { canonicalDecimalString } from '../../shared/pathfinderLengthLedger.js';
import type { CableWorkflowRow } from '../../shared/pathfinderCableWorkflow.js';
import type { DependencySnapshot, EngineResponse } from './jobContracts.js';
import { designLengthCompatibilityIssue, optionsSchema, proposalRoutingPreferences, routeCompatibilityIssue } from './jobContracts.js';
import { hash } from './dependencies.js';
import { requireVersionedCalculationScope } from './routingScope.js';
import { requireCalculationLengthLedger } from './lengthLedger.js';
import { verifyRevisionResultForProposal } from './revisionResultRepository.js';
import { readProposalApplicability } from './proposalApplicability.js';
import { createInitialFillReceiptProofReader } from './initialFillReceiptProof.js';
import { createAutomaticPairReceiptProofReader } from './automaticPairReceiptProof.js';
import { readBarrierWriteEvidence } from './barrierWrites.js';
import { verifyBarrierEngineIdentity } from '../../shared/pathfinderEngineIdentity.js';
import { verifyMixedBarrierEngineIdentity } from '../../shared/pathfinderBarrierMixed.js';

export const WORKFLOW_PROOF_BYTES = 256 * 1024;
type Data = Record<string, any>;
type Verified = { raw: Data; dependencies: DependencySnapshot; result: EngineResponse; seal: NonNullable<Awaited<ReturnType<typeof verifyRevisionResultForProposal>>> };
const object = (value: unknown): Data | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Data : null;
const same = (a: unknown, b: unknown): boolean => canonicalPurposeJson(a) === canonicalPurposeJson(b);
const decimalEqual = (a: unknown, b: unknown): boolean => {
  if (a === null || b === null) return a === b;
  try { return typeof a === 'string' && typeof b === 'string' && canonicalDecimalString(a) === canonicalDecimalString(b); } catch { return false; }
};
/** Local comparison for drawing an already-written exact path. The two declared
 * upgrades below affect planning/resources, not the saved physical scene. */
export function normalizeSavedDisplayComparison(current: DependencySnapshot, frozen: DependencySnapshot): DependencySnapshot | null {
  if (current.schemaVersion !== 'pathfinder.dependencies.v8' || frozen.schemaVersion !== 'pathfinder.dependencies.v8') return null;
  const freshProfile = object(current.barriers.profile), priorProfile = object(frozen.barriers.profile);
  if (!freshProfile || !priorProfile || hash(freshProfile) !== current.barriers.profileSha256 || hash(priorProfile) !== frozen.barriers.profileSha256) return null;
  let barriers = current.barriers, profileUpgrade = false;
  if (!same(freshProfile, priorProfile)) {
    const freshLimits = object(freshProfile.qualification), priorLimits = object(priorProfile.qualification);
    if (current.barriers.schemaVersion !== 'wfc.pf.barrier-runtime.v2' || frozen.barriers.schemaVersion !== 'wfc.pf.barrier-runtime.v2'
      || priorProfile.schemaVersion !== 'wfc.pf.barrier-runtime-profile.v3' || freshProfile.schemaVersion !== 'wfc.pf.barrier-runtime-profile.v4'
      || priorLimits?.maximumParents !== 128 || priorLimits.maximumComponents !== 256
      || freshLimits?.maximumParents !== 2048 || freshLimits.maximumComponents !== 2048
      || !same({ ...freshProfile, schemaVersion: priorProfile.schemaVersion,
        qualification: { ...freshLimits, maximumParents: 128, maximumComponents: 256 } }, priorProfile)) return null;
    profileUpgrade = true;
    barriers = { ...current.barriers, profile: frozen.barriers.profile, profileSha256: frozen.barriers.profileSha256 };
  }
  const freshSettings = object(current.settings)!, priorSettings = object(frozen.settings)!;
  const freshBalance = freshSettings.routingBalance, priorBalance = priorSettings.routingBalance;
  const validBalance = (value: unknown): boolean => {
    const balance = object(value); return Boolean(balance && same(Object.keys(balance).sort(), ['layoutSha256', 'mode'])
      && balance.mode === 'destination-groups-v1' && policyHashSchema.safeParse(balance.layoutSha256).success);
  };
  if (freshBalance !== undefined && !validBalance(freshBalance) || priorBalance !== undefined && !validBalance(priorBalance)) return null;
  const balanceChanged = freshBalance !== priorBalance
    && (freshBalance === undefined || priorBalance === undefined || !same(freshBalance, priorBalance));
  let settings = current.settings;
  if (balanceChanged) {
    if (!validBalance(freshBalance) || priorBalance !== undefined && !validBalance(priorBalance)
      || freshSettings.revision !== priorSettings.revision) return null;
    const { routingBalance: _derived, ...rest } = current.settings;
    settings = priorBalance === undefined ? rest : { ...rest, routingBalance: frozen.settings.routingBalance };
  }
  const digest = (text: string) => createHash('sha256').update(text).digest('hex');
  const valid = (identity: unknown) => verifyBarrierEngineIdentity(identity, digest) || verifyMixedBarrierEngineIdentity(identity, digest);
  const fresh = object(current.engineIdentity)!, prior = object(frozen.engineIdentity)!;
  if (!valid(fresh) || !valid(prior) || fresh.schemaVersion !== prior.schemaVersion || fresh.version !== prior.version
    || profileUpgrade && (fresh.policyVersions.runtimeProfile !== freshProfile.schemaVersion || prior.policyVersions.runtimeProfile !== priorProfile.schemaVersion)
    || !same(profileUpgrade ? { ...fresh.policyVersions, runtimeProfile: priorProfile.schemaVersion } : fresh.policyVersions, prior.policyVersions)
    || !profileUpgrade && !balanceChanged && fresh.contentSha256 === prior.contentSha256) return null;
  // Everything else (settings revision/math, model, bindings, captured geometry,
  // options and cable fields) remains in the unchanged full accepted-proof hash.
  return { ...current, settings, barriers, engineIdentity: frozen.engineIdentity };
}

/** Exact existing seal/ledger/compatibility proof; no engine invocation or weakened hash. */
export async function readWorkflowVerifiedProposal(client: PoolClient, projectId: string, cableId: string, proposalId: string): Promise<Verified | null> {
  policyUuidSchema.parse(proposalId);
  const raw = (await client.query<Data>(`/* cable-workflow:proposal-proof */ SELECT p.id,p.project_id,p.cable_id,p.job_id,p.status,p.proposal_hash,p.dependency_hash,
    CASE WHEN octet_length(p.dependencies::text)+octet_length(p.result::text)<=$4 THEN p.dependencies ELSE NULL END AS dependencies,
    CASE WHEN octet_length(p.dependencies::text)+octet_length(p.result::text)<=$4 THEN p.result ELSE NULL END AS result,
    j.state AS job_state,j.cancel_requested,i.state AS item_state,i.status AS item_status
    FROM pf_proposals p JOIN pf_jobs j ON j.project_id=p.project_id AND j.id=p.job_id
    LEFT JOIN pf_job_items i ON i.project_id=p.project_id AND i.job_id=p.job_id AND i.cable_id=p.cable_id
    WHERE p.project_id=$1 AND p.cable_id=$2 AND p.id=$3`, [projectId, cableId, proposalId, WORKFLOW_PROOF_BYTES])).rows[0];
  try {
    if (!raw || raw.id !== proposalId || raw.project_id !== projectId || raw.cable_id !== cableId || raw.status !== 'calculated'
      || !policyHashSchema.safeParse(raw.proposal_hash).success || !policyHashSchema.safeParse(raw.dependency_hash).success) return null;
    const dependencies = object(raw.dependencies) as DependencySnapshot | null, result = object(raw.result) as EngineResponse | null;
    if (!dependencies || !result || dependencies.projectId !== projectId || dependencies.cableId !== cableId
      || hash(dependencies) !== raw.dependency_hash || !optionsSchema.safeParse(dependencies.options).success) return null;
    requireVersionedCalculationScope(dependencies);
    if (dependencies.schemaVersion === 'pathfinder.dependencies.v8' && !readBarrierWriteEvidence(dependencies, result)) return null;
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
  const proposals = new Map<string, Promise<Verified | null>>();
  const initialFillReceipt = createInitialFillReceiptProofReader(client, check);
  const automaticPairReceipt = createAutomaticPairReceiptProofReader(client, check);
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
      if (verified.dependencies.schemaVersion !== 'pathfinder.dependencies.v8')
        return { currentness: 'unavailable' as const, reviewable: false, reasonCodes: ['BARRIER_WRITE_PROOF_REQUIRED'] };
      if (!current || hash(current) !== verified.raw.dependency_hash)
        return { currentness: 'changed' as const, reviewable: false, reasonCodes: ['PROPOSAL_DEPENDENCIES_CHANGED'] };
      const applicable=await readProposalApplicability(client,{projectId,jobId,cableId,proposalId,
          dependencyVersion:verified.dependencies.schemaVersion,dependencyHash:verified.raw.dependency_hash,
          jobState:verified.raw.job_state,cancelRequested:verified.raw.cancel_requested,seal:verified.seal});check();
      return {currentness:applicable.applicable?'current' as const:'changed' as const,reviewable:applicable.applicable,
          reasonCodes:applicable.applicable?[]:['SCOPED_ITEM_NOT_APPLICABLE'],itemApplicability:applicable.evidence};
    },
    /** Only a receipt-proven own write can explain the pre/post cable revision difference. */
    async accepted(cable: CableWorkflowRow['cable'], currentForOptions: (options: unknown,version:DependencySnapshot['schemaVersion']) => Promise<DependencySnapshot | null>,
      expected?:{jobId:string;proposalId:string;proposalHash:string}): Promise<boolean> {
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
        // A valid older own-write receipt cannot certify a newer displayed
        // proposal, even when its route text and length happen to be identical.
        if(expected&&(!policyUuidSchema.safeParse(expected.jobId).success||!policyUuidSchema.safeParse(expected.proposalId).success
          ||!policyHashSchema.safeParse(expected.proposalHash).success||receipt.proposal_id!==expected.proposalId))return false;
        const before = object(receipt.before_snapshot), after = object(receipt.after_snapshot), provenance = object(receipt.provenance);
        if (!before || !after || !provenance || !['pathfinder.apply.v2', 'pathfinder.apply.v3', 'pathfinder.initial-fill.v1', 'pathfinder.initial-fill.v2', 'pathfinder.automatic-pair.v1'].includes(provenance.schemaVersion)
          || before.id !== cable.id || after.id !== cable.id || before.project_id !== projectId || after.project_id !== projectId
          || !policyRevisionSchema.safeParse(before.cable_write_revision).success || !policyRevisionSchema.safeParse(after.cable_write_revision).success
          || BigInt(after.cable_write_revision) !== BigInt(before.cable_write_revision) + 1n || after.cable_write_revision !== cable.cableWriteRevision
          || after.routing !== cable.routing || !decimalEqual(after.design_length, cable.designLength) || !decimalEqual(after.install_length, cable.installLength)) return false;
        const changed = new Set(['routing', 'design_length', 'updated_at', 'cable_write_revision']);
        if (!same(Object.keys(before).sort(), Object.keys(after).sort()) || Object.keys(before).some(key => !changed.has(key) && !same(before[key], after[key]))) return false;
        const verified = await proposal(cable.id, receipt.proposal_id); check(); if (!verified) return false;
        const { dependencies, result, seal, raw } = verified;
        if(expected&&(raw.job_id!==expected.jobId||raw.id!==expected.proposalId||raw.proposal_hash!==expected.proposalHash))return false;
        const automaticPair = provenance.schemaVersion === 'pathfinder.automatic-pair.v1';
        const protectedReceipt = automaticPair || provenance.schemaVersion === 'pathfinder.apply.v3' || provenance.schemaVersion === 'pathfinder.initial-fill.v2';
        if (protectedReceipt) {
          const evidence = readBarrierWriteEvidence(dependencies, result);
          if (!evidence || !same(evidence, provenance.barrierEvidence)
            || provenance.revisionResult?.engineResultSha256 !== evidence.engineResultSha256
            || provenance.revisionResult?.dependencyHash !== evidence.dependencySha256) return false;
        } else if (dependencies.schemaVersion === 'pathfinder.dependencies.v8' || Object.hasOwn(provenance, 'barrierEvidence')) return false;
        if (automaticPair) {
          const fact = await automaticPairReceipt({projectId,cableId:cable.id,receiptId:receipt.id});
          if (!fact || !same(fact.before,before) || !same(fact.after,after)) return false;
          check();
        } else if (provenance.schemaVersion === 'pathfinder.initial-fill.v1' || provenance.schemaVersion === 'pathfinder.initial-fill.v2') {
          if (!await initialFillReceipt({ projectId, cableId: cable.id, receiptId: receipt.id, proposalId: receipt.proposal_id,
            actorId: receipt.actor_id, idempotencyKey: receipt.idempotency_key, payloadHash: receipt.payload_hash,
            before, after, provenance, dependencies, result, seal })) return false;
          check();
        } else if (dependencies.cableWriteRevision !== before.cable_write_revision || provenance.proposalId !== raw.id || provenance.proposalHash !== raw.proposal_hash
          || provenance.reviewId !== receipt.review_id || provenance.review?.id !== receipt.review_id || provenance.review?.actorId !== receipt.actor_id
          || receipt.review_actor !== receipt.actor_id || receipt.review_proposal !== raw.id || receipt.review_proposal_hash !== raw.proposal_hash
          || !['manual-review', 'synthetic-fixture'].includes(receipt.validation_method) || provenance.validationMethod !== receipt.validation_method
          || protectedReceipt && provenance.review?.validationMethod !== receipt.validation_method
          || receipt.revision_result_sha256 !== seal.revisionResultSha256 || receipt.review_dependency_sha256 !== raw.dependency_hash
          || provenance.review?.loginId !== receipt.review_login_id || provenance.review?.dependencyHash !== raw.dependency_hash
          || provenance.review?.revisionResultSha256 !== seal.revisionResultSha256 || !same(provenance.dependencies, dependencies)
          || provenance.revisionResult?.revisionResultSha256 !== seal.revisionResultSha256 || provenance.revisionResult?.dependencyHash !== raw.dependency_hash
          || provenance.revisionResult?.baselineHash !== seal.baselineHash || provenance.revisionResult?.ledgerHash !== seal.ledgerHash
          || after.routing !== result.route!.routeText || !decimalEqual(after.design_length, result.design!.designLengthMeters)
          || receipt.payload_hash !== hash({ proposalId: raw.id, idempotencyKey: receipt.idempotency_key, reviewId: receipt.review_id, expectedCableWriteRevision: before.cable_write_revision })) return false;
        const current = await currentForOptions(dependencies.options,dependencies.schemaVersion); check();
        // No mutation or general hash exception: restore exactly one proven own-write revision in this local comparison only.
        return current !== null && hash({ ...current, cableWriteRevision: before.cable_write_revision }) === raw.dependency_hash;
      } catch { check(); return false; }
    },
    /** Display the exact already-written path after supported implementation or
     * planning metadata updates. Never certifies a current calculation/write. */
    async savedExactDisplay(cable: CableWorkflowRow['cable'], currentForOptions: (options: unknown, version: DependencySnapshot['schemaVersion']) => Promise<DependencySnapshot | null>,
      expected: { jobId: string; proposalId: string; proposalHash: string }): Promise<boolean> {
      try {
        if (!policyUuidSchema.safeParse(expected.jobId).success || !policyUuidSchema.safeParse(expected.proposalId).success
          || !policyHashSchema.safeParse(expected.proposalHash).success) return false;
        check(); const verified = await proposal(cable.id, expected.proposalId); check();
        if (!verified || verified.dependencies.schemaVersion !== 'pathfinder.dependencies.v8'
          || verified.raw.job_id !== expected.jobId || verified.raw.proposal_hash !== expected.proposalHash
          || verified.raw.job_state !== 'complete' || verified.raw.cancel_requested !== false
          || verified.raw.item_state !== 'complete' || verified.raw.item_status !== 'calculated'
          || !verified.result.route || verified.result.route.pathPoints.length < 2) return false;
        const frozen = verified.dependencies;
        return await this.accepted(cable, async (options, version) => {
          const current = await currentForOptions(options, version); check();
          if (!current) return null;
          // The accepted-receipt proof still checks every other dependency and
          // only its proven own-write revision. Never alter either source object.
          return normalizeSavedDisplayComparison(current, frozen);
        }, expected);
      } catch { check(); return false; }
    },
  };
}
