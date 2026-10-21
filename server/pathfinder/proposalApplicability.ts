import type { PoolClient } from 'pg';
import { sealedCableItemApplicabilitySchema, type SealedCableItemApplicability } from '../../shared/pathfinderItemApplicability.js';
import { hash } from './dependencies.js';
import { readLocationImpactJobAuthority } from './locationImpactRepository.js';
import { readRecalculationJobAuthority } from './recalculationRepository.js';
import { requireBarrierEngineStrategy } from './barrierStrategy.js';
import { requireVersionedCalculationScope } from './routingScope.js';
import { engineResponseSchema, type BarrierDependencySnapshot } from './jobContracts.js';

type Seal = { projectId: string; jobId: string; cableId: string; proposalId: string; dependencyHash: string;
  proposalHash?: string; engineResultSha256?: string; baselineHash?: string };
export type ProposalApplicabilityInput = Seal & {
  dependencyVersion: string; jobState: string; cancelRequested: boolean;
  seal: Seal | null;
};
/** A new-version completed item can be reviewed before unrelated siblings finish. */
export async function readProposalApplicability(client: PoolClient, input: ProposalApplicabilityInput): Promise<{
  applicable: boolean; evidence: SealedCableItemApplicability | null;
}> {
  const no = { applicable: false, evidence: null };
  if (input.cancelRequested || !['queued', 'running', 'complete'].includes(input.jobState)) return no;
  if (input.dependencyVersion === 'pathfinder.dependencies.v8') return readBarrierProposalApplicability(client, input);
  if (input.dependencyVersion !== 'pathfinder.dependencies.v7')
    return { applicable: input.jobState === 'complete', evidence: null };
  if (!input.seal || (['projectId','jobId','cableId','proposalId','dependencyHash'] as const).some(key => input.seal![key] !== input[key])) return no;
  const row = (await client.query<{ state: string; status: string; dependencies: unknown; job_state: string; cancel_requested: boolean }>(
    `/* pathfinder:sealed-item-applicability */ SELECT i.state,i.status,
      CASE WHEN octet_length(i.dependencies::text)<=262144 THEN i.dependencies ELSE NULL END AS dependencies,
      j.state AS job_state,j.cancel_requested FROM pf_job_items i JOIN pf_jobs j ON j.project_id=i.project_id AND j.id=i.job_id
      WHERE i.project_id=$1 AND i.job_id=$2 AND i.cable_id=$3 FOR SHARE OF i,j`,
    [input.projectId,input.jobId,input.cableId])).rows[0];
  if (!row || row.state !== 'complete' || row.status !== 'calculated' || row.cancel_requested
    || row.job_state !== input.jobState || !row.dependencies || hash(row.dependencies) !== input.dependencyHash
    || (row.dependencies as { schemaVersion?: unknown }).schemaVersion !== 'pathfinder.dependencies.v7') return no;
  const authority = await readLocationImpactJobAuthority(client, { projectId: input.projectId, jobId: input.jobId, cableId: input.cableId, lock: true });
  // v7 independent readiness belongs only to a proven scoped enrollment.
  if (!authority?.enrolled || !authority.valid) return no;
  return { applicable: true, evidence: sealedCableItemApplicabilitySchema.parse({
    schemaVersion:'wfc.pf.sealed-cable-applicability.v1',dependencyVersion:'pathfinder.dependencies.v7',
    projectId:input.projectId,jobId:input.jobId,cableId:input.cableId,proposalId:input.proposalId,
    dependencyHash:input.dependencyHash,scope:'sealed-cable-item',
  }) };
}

/** Readiness metadata does not authorize a write. Current dependencies and the
 * original authority are independently fenced again by Review/Apply. */
async function readBarrierProposalApplicability(client: PoolClient, input: ProposalApplicabilityInput): Promise<{
  applicable: boolean; evidence: SealedCableItemApplicability | null;
}> {
  const no = { applicable: false, evidence: null };
  if (!input.seal || (['projectId','jobId','cableId','proposalId','dependencyHash'] as const).some(key => input.seal![key] !== input[key])) return no;
  const row = (await client.query<{ state: string; status: string; dependencies: unknown; proposal_dependencies: unknown; result: unknown;
    proposal_hash: string; dependency_hash: string; proposal_status: string; job_state: string; cancel_requested: boolean }>(
    `/* pathfinder:barrier-sealed-item-applicability */ SELECT i.state,i.status,
      CASE WHEN octet_length(i.dependencies::text)+octet_length(p.dependencies::text)+octet_length(p.result::text)<=262144 THEN i.dependencies ELSE NULL END AS dependencies,
      CASE WHEN octet_length(i.dependencies::text)+octet_length(p.dependencies::text)+octet_length(p.result::text)<=262144 THEN p.dependencies ELSE NULL END AS proposal_dependencies,
      CASE WHEN octet_length(i.dependencies::text)+octet_length(p.dependencies::text)+octet_length(p.result::text)<=262144 THEN p.result ELSE NULL END AS result,
      p.proposal_hash,p.dependency_hash,p.status AS proposal_status,j.state AS job_state,j.cancel_requested
      FROM pf_job_items i JOIN pf_jobs j ON j.project_id=i.project_id AND j.id=i.job_id
      JOIN pf_proposals p ON p.project_id=i.project_id AND p.job_id=i.job_id AND p.cable_id=i.cable_id AND p.id=$4
      WHERE i.project_id=$1 AND i.job_id=$2 AND i.cable_id=$3 FOR SHARE OF i,j,p`,
    [input.projectId,input.jobId,input.cableId,input.proposalId])).rows[0];
  if (!row || row.state !== 'complete' || row.status !== 'calculated' || row.proposal_status !== 'calculated' || row.cancel_requested
    || row.job_state !== input.jobState || !row.dependencies || hash(row.dependencies) !== input.dependencyHash
    || !row.proposal_dependencies || hash(row.proposal_dependencies) !== input.dependencyHash || row.dependency_hash !== input.dependencyHash
    || (row.dependencies as { schemaVersion?: unknown }).schemaVersion !== 'pathfinder.dependencies.v8') return no;
  try {
    const dependencies = row.dependencies as BarrierDependencySnapshot;
    requireVersionedCalculationScope(dependencies);
    if (dependencies.projectId !== input.projectId || dependencies.cableId !== input.cableId || !input.seal.proposalHash || !input.seal.engineResultSha256
      || !input.seal.baselineHash || row.proposal_hash !== input.seal.proposalHash || hash(row.result) !== input.seal.engineResultSha256
      || hash({ dependencies, result: row.result, baselineHash: input.seal.baselineHash }) !== row.proposal_hash) return no;
    if (!row.result || typeof row.result !== 'object' || Array.isArray(row.result)) return no;
    const { calculationMode, ...body } = row.result as Record<string, unknown>;
    if (calculationMode !== 'calculate') return no;
    const response = engineResponseSchema.parse(body);
    if (response.status !== 'calculated' || !response.route?.success || !response.design) return no;
    requireBarrierEngineStrategy(response, { context: dependencies.barriers, category: dependencies.cableInputs.mto,
      fromPoint: dependencies.from.point, toPoint: dependencies.to.point });
  } catch { return no; }
  const scoped = await readLocationImpactJobAuthority(client, { projectId: input.projectId, jobId: input.jobId, cableId: input.cableId, lock: true });
  if (scoped) {
    if (!scoped.enrolled || !scoped.valid) return no;
    return { applicable: true, evidence: sealedCableItemApplicabilitySchema.parse({
      schemaVersion:'wfc.pf.sealed-cable-applicability.v2',dependencyVersion:'pathfinder.dependencies.v8',
      projectId:input.projectId,jobId:input.jobId,cableId:input.cableId,proposalId:input.proposalId,
      dependencyHash:input.dependencyHash,scope:'sealed-cable-item',
    }) };
  }
  // A manual or whole-project enrolled job gains no independent-item authority.
  const authority = await readRecalculationJobAuthority(client, { projectId: input.projectId, jobId: input.jobId, cableId: input.cableId, lock: true });
  return { applicable: input.jobState === 'complete' && (!authority.enrolled || authority.valid), evidence: null };
}
