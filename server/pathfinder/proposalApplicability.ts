import type { PoolClient } from 'pg';
import { sealedCableItemApplicabilitySchema, type SealedCableItemApplicability } from '../../shared/pathfinderItemApplicability.js';
import { hash } from './dependencies.js';
import { readLocationImpactJobAuthority } from './locationImpactRepository.js';

type Seal = { projectId: string; jobId: string; cableId: string; proposalId: string; dependencyHash: string };
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
