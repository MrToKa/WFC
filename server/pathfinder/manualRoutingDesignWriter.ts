import { routeObstacleRemarks, exactObstacleRemarksTransition } from './obstacleRemarks.js';
import type { PoolClient } from 'pg';
import { canonicalDecimalString } from '../../shared/pathfinderLengthLedger.js';
import { canonicalPurposeJson } from '../../shared/pathfinderPurposePolicy.js';
import { executionRoutingReasons } from '../../shared/cableRoutingControl.js';
import { cableExecutionFacts, readCableRoutingControl } from './cableRoutingControlRepository.js';
import { recordPathFinderCableHistory } from './cableWriteHistory.js';
import { PathFinderError } from './errors.js';

type Row=Record<string,any>;
export type ManualDesignWrite={schemaVersion:'pathfinder.manual-design-write.v1';status:'written'|'unchanged'|'not-used-manual'|'execution-protected';
  beforeCableWriteRevision:string;afterCableWriteRevision:string;history?:{id:string;versionNumber:string}};
/** Caller owns current principal/project, mathematical dependency and job
 * generation fences. Only the used protected manual route can own Design. */
export async function writeManualRoutingDesign(client:PoolClient,input:{projectId:string;cableId:string;actorId:string;
  manualRevision:string;manualRouting:string;lengthMetres:number;result?:unknown}):Promise<ManualDesignWrite>{
  if(!Number.isSafeInteger(input.lengthMetres)||input.lengthMetres<0||input.lengthMetres>1000000)throw new PathFinderError('MANUAL_DESIGN_LENGTH_INVALID',409);
  const before=(await client.query<Row>(`/* manual-design:baseline */ SELECT to_jsonb(c)||jsonb_build_object('design_length',c.design_length::text,
    'install_length',c.install_length::text,'cable_write_revision',c.cable_write_revision::text) AS value FROM cables c
    WHERE c.project_id=$1 AND c.id=$2 FOR UPDATE`,[input.projectId,input.cableId])).rows[0]?.value;
  if(!before)throw new PathFinderError('MANUAL_ROUTE_SUPERSEDED',409);
  const control=await readCableRoutingControl(client,input.projectId,input.cableId,true);
  if(!control||control.manualRevision!==input.manualRevision||control.control.manualRouting!==input.manualRouting)throw new PathFinderError('MANUAL_ROUTE_SUPERSEDED',409);
  const unchanged=(status:ManualDesignWrite['status']):ManualDesignWrite=>({schemaVersion:'pathfinder.manual-design-write.v1',status,
    beforeCableWriteRevision:before.cable_write_revision,afterCableWriteRevision:before.cable_write_revision});
  if(executionRoutingReasons(cableExecutionFacts(before),control.control.executionLocked).length)return unchanged('execution-protected');
  if(!control.control.manualProtected||before.routing!==input.manualRouting)return unchanged('not-used-manual');
  const remarks=routeObstacleRemarks(before.remarks,input.result);
  if(before.design_length!==null&&canonicalDecimalString(before.design_length)===String(input.lengthMetres)&&Object.is(remarks,before.remarks))return unchanged('unchanged');
  const previousSetting=(await client.query<{value:string|null}>("SELECT current_setting('wfc.pathfinder_apply',true) AS value")).rows[0]?.value??'';
  await client.query("SELECT set_config('wfc.pathfinder_apply','1',true)");
  const after=(await client.query<Row>(`/* manual-design:write */ UPDATE cables c SET design_length=$3,remarks=$5,updated_at=clock_timestamp()
    WHERE c.project_id=$1 AND c.id=$2 AND c.cable_write_revision=$4 RETURNING to_jsonb(c)||jsonb_build_object('design_length',c.design_length::text,
    'install_length',c.install_length::text,'cable_write_revision',c.cable_write_revision::text) AS value`,
  [input.projectId,input.cableId,String(input.lengthMetres),before.cable_write_revision,remarks ?? null])).rows[0]?.value;
  const allowed=new Set(['design_length','remarks','updated_at','cable_write_revision']);
  if(!after||!exactObstacleRemarksTransition(before,after,input.result)||canonicalDecimalString(after.design_length)!==String(input.lengthMetres)
    ||BigInt(after.cable_write_revision)!==BigInt(before.cable_write_revision)+1n
    ||canonicalPurposeJson(Object.keys(before).sort())!==canonicalPurposeJson(Object.keys(after).sort())
    ||Object.keys(before).some(key=>!allowed.has(key)&&canonicalPurposeJson(before[key])!==canonicalPurposeJson(after[key])))
    throw new PathFinderError('MANUAL_DESIGN_WRITE_INTEGRITY',409);
  const history=await recordPathFinderCableHistory(client,input);
  await client.query("SELECT set_config('wfc.pathfinder_apply',$1,true)",[previousSetting]);
  return{schemaVersion:'pathfinder.manual-design-write.v1',status:'written',beforeCableWriteRevision:before.cable_write_revision,
    afterCableWriteRevision:after.cable_write_revision,history};
}
