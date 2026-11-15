import type { PoolClient } from 'pg';
import { buildAutoLengthSource } from './autoLengthStore.js';
import { collectDependenciesForVersion, hash } from './dependencies.js';
import { requireCurrentBarrierWriteScope } from './barrierWrites.js';
import { readTrayCapacityRouting } from './trayCapacityRouting.js';
import { routeCompatibilityIssue, type BarrierDependencySnapshot } from './jobContracts.js';
import { PathFinderError } from './errors.js';
import { isPermittedCablePurposeRoute } from '../../shared/routingCablePurposes.js';

type Queryable = Pick<PoolClient,'query'>;
/** A release is current edit authority, not authority inherited from an old job.
 * Only an exact immutable result whose complete mathematical inputs still match
 * may supply its automatic fallback. Caller holds the project and cable locks. */
export async function readCurrentAutomaticRouting(client: Queryable, projectId: string, cableId: string, adapters: {
  collect?: typeof collectDependenciesForVersion; barrierFence?: typeof requireCurrentBarrierWriteScope; capacity?: typeof readTrayCapacityRouting;
} = {}): Promise<string|null> {
  const row = (await client.query<Record<string,any>>(`/* cable-routing:current-automatic */ SELECT a.source,a.source_sha256,a.proposal_id,
    p.status,p.dependencies,p.result,s.record FROM pf_auto_lengths a JOIN pf_proposals p ON p.project_id=a.project_id AND p.cable_id=a.cable_id AND p.id=a.proposal_id
    JOIN pf_revision_results s ON s.project_id=a.project_id AND s.cable_id=a.cable_id AND s.proposal_id=a.proposal_id
    WHERE a.project_id=$1 AND a.cable_id=$2 AND octet_length(a.source::text)<=16384 AND octet_length(p.dependencies::text)<=1048576
    AND octet_length(p.result::text)<=4194304 AND octet_length(s.record::text)<=131072 FOR SHARE OF a,p,s`,[projectId,cableId])).rows[0];
  if (!row || row.status!=='calculated') return null;
  try {
    const d = row.dependencies as BarrierDependencySnapshot;
    if(d?.schemaVersion!=='pathfinder.dependencies.v8' || !d.barriers?.binding?.policy || d.barriers.binding.policy.drillThroughWalls || hash(row.source)!==row.source_sha256)return null;
    const source=buildAutoLengthSource({projectId,cableId,jobId:row.record.jobId,proposalId:row.proposal_id,
      dependencies:d,result:row.result,seal:row.record,admissionOrdinal:row.source.admissionOrdinal});
    if(hash(source)!==row.source_sha256 || row.record.summary.routeText!==row.result.route.routeText
      || row.result.route.routeText!==row.result.route.routeCodes.join('')
      || d.cablePurposeRouting && !isPermittedCablePurposeRoute(row.result.route.routeCodes,d.cablePurposeRouting.allowedRouteCodes))return null;
    const fence=adapters.barrierFence??requireCurrentBarrierWriteScope;
    const identity=await fence(client as PoolClient,d);
    const current=await(adapters.collect??collectDependenciesForVersion)(client as PoolClient,projectId,cableId,d.options,d.schemaVersion,true,identity);
    if(!current.dependencies || hash({...current.dependencies,cableWriteRevision:d.cableWriteRevision})!==hash(d))return null;
    const capacity=await(adapters.capacity??readTrayCapacityRouting)(client as PoolClient,{projectId,cableId,jobId:row.record.jobId});
    if(d.settings.trayCapacity?.enabled && !capacity)return null;
    const assessment=capacity?.evaluate(row.result.route.routeCodes);
    if(capacity?.restrictionEnabled && (!assessment || assessment.policyIssue || assessment.blockedRouteCodes.length || assessment.unavailableRouteCodes.length))return null;
    await fence(client as PoolClient,d);
    const route=row.record.summary.routeText;
    return typeof route==='string'&&routeCompatibilityIssue(route)===null?route:null;
  } catch(error) {
    if(error instanceof PathFinderError && error.status<500 || error instanceof Error && ['ZodError','TypeError'].includes(error.name))return null;
    if(error instanceof PathFinderError && /ENGINE|BARRIER|STORAGE/.test(error.code))return null;
    throw error;
  }
}
