import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {JobPrincipal} from './jobContracts.js';
import {endpointBindingSchema,normalizeEndpointLocation} from '../../shared/pathfinderEndpointBindings.js';
import {canonicalPurposeJson} from '../../shared/pathfinderPurposePolicy.js';
import {geometryObjectRevisionSchema} from '../../shared/pathfinderGeometryTrace.js';
import {readCurrentEndpointBindingContext,endpointBindingHash,confirmEndpointBindingChangeInTransaction} from './endpointBindingRepository.js';
import {readAutomaticNamedEndpointCandidate} from './automaticEndpointCandidates.js';
import {assertLoginNotExpired} from './auth.js';
import {PathFinderError} from './errors.js';
import {CROSS_MODEL_ENDPOINT_TOLERANCE_METRES} from './crossModelEndpointMatch.js';
import {readMatchedLocationDisplay} from './modelLocationMatchDisplay.js';
/** Only independently verified exact-name native candidates may replace an old
 * model binding. Nearness alone never discovers identity. Caller owns the finite
 * authorized project transaction; normal binding changes invalidate routing. */
export async function recoverCrossModelEndpointsInTransaction(c:PoolClient,pid:string,who:JobPrincipal,signal:AbortSignal){
 const check=()=>{signal.throwIfAborted();assertLoginNotExpired(who);};check();
 const needed=(await c.query(`/* cross-model-endpoints:needed */ SELECT 1 FROM pf_endpoint_binding_heads h JOIN pf_endpoint_binding_revisions r ON r.project_id=h.project_id AND r.id=h.binding_id JOIN project_model_selections s ON s.project_id=h.project_id WHERE h.project_id=$1 AND r.model_version_id<>s.active_model_version_id AND r.record->>'status'='confirmed' LIMIT 1`,[pid])).rows;if(!needed.length)return 0;
 const current=await readCurrentEndpointBindingContext(c,pid);if(!current)return 0;
 const rows=(await c.query<{id:string;name:string;revision:string;record:unknown;aliases:string[]}>(`/* cross-model-endpoints:heads */ SELECT l.id,l.name,l.revision::text,r.record,COALESCE((SELECT array_agg(a.display_alias ORDER BY a.normalized_alias) FROM pf_location_aliases a WHERE a.project_id=l.project_id AND a.location_id=l.id AND a.normalized_alias<>normalize(upper(btrim(l.name)),NFC)),ARRAY[]::text[]) AS aliases FROM pf_locations l JOIN pf_endpoint_binding_heads h ON h.project_id=l.project_id AND h.location_id=l.id JOIN pf_endpoint_binding_revisions r ON r.project_id=h.project_id AND r.id=h.binding_id WHERE l.project_id=$1 AND r.model_version_id<>$2 AND r.record->>'status'='confirmed' AND EXISTS(SELECT 1 FROM cables b JOIN pf_location_aliases a ON a.project_id=b.project_id AND (a.normalized_alias=normalize(upper(btrim(b.from_location)),NFC) OR a.normalized_alias=normalize(upper(btrim(b.to_location)),NFC)) WHERE b.project_id=l.project_id AND b.mto IS DISTINCT FROM 'MV' AND a.location_id=l.id) ORDER BY l.id LIMIT 20001 FOR SHARE OF l,h,r`,[pid,current.modelVersionId])).rows;
 if(rows.length>20000)throw new PathFinderError('ENDPOINT_NEEDED_LOCATION_LIMIT',413);
 let changed=0;
 for(const row of rows){
  check();const old=endpointBindingSchema.parse(row.record),{contentSha256,...body}=old;
  if(old.projectId!==pid||old.locationId!==row.id||endpointBindingHash(body)!==contentSha256)throw new PathFinderError('ENDPOINT_HEAD_INTEGRITY',409);
  if(old.status!=='confirmed'||old.locationRevision!==row.revision||old.modelVersionId===current.modelVersionId)continue;
  const names=[...new Set([row.name,...row.aliases].map(normalizeEndpointLocation))];
  const candidates=await Promise.all(names.map(name=>readAutomaticNamedEndpointCandidate(c,{projectId:pid,current,name,signal})));
  const identities=[...new Set(candidates.flatMap(v=>v.candidateObjectIds))];
  let reason:string|null=candidates.some(v=>['ambiguous','object-unverified'].includes(v.status))?'MODEL_LOCATION_CROSS_MODEL_AMBIGUOUS':identities.length>1?'MODEL_LOCATION_CROSS_MODEL_AMBIGUOUS':null;
  const selected=candidates.find(v=>v.status==='automatic-ready'&&v.point&&v.objectId);
  if(!reason&&!selected)reason='MODEL_LOCATION_CROSS_MODEL_MISSING';
  let selectedRecord:ReturnType<typeof geometryObjectRevisionSchema.parse>|null=null,selectedRecordSha:string|null=null;
  const readObject=async()=>{
   if(selectedRecord)return selectedRecord;
   const objects=(await c.query<{record:unknown;record_sha256:string}>(`/* cross-model-endpoints:object */ SELECT CASE WHEN octet_length(record::text)<=524288 THEN record ELSE NULL END AS record,summary->>'recordSha256' AS record_sha256 FROM pf_geometry_object_revisions WHERE project_id=$1 AND trace_id=$2 AND object_id=$3 LIMIT 2 FOR SHARE`,[pid,current.traceId,selected!.objectId])).rows;
   if(objects.length!==1)throw new PathFinderError('AUTOMATIC_ENDPOINT_OBJECT_INTEGRITY',409);
   const object=geometryObjectRevisionSchema.parse(objects[0].record);
   if(endpointBindingHash(object)!==objects[0].record_sha256||canonicalPurposeJson(object.geometry.equipmentAnchor?.pointMetres)!==canonicalPurposeJson(selected!.point))throw new PathFinderError('AUTOMATIC_ENDPOINT_OBJECT_INTEGRITY',409);
   selectedRecord=object;selectedRecordSha=objects[0].record_sha256;return object;
  };
  let observed=selected?.point??null;
  if(!reason&&old.derivation==='matched-model-centre-fallback.v1'){
   const original=old.centreFallbackEvidence!.current;
   const priorCurrent={...original,modelVersionId:old.modelVersionId,aggregateId:old.aggregateId,artifactId:old.artifactId,
    projectionSha256:old.projectionSha256,captureFrameId:old.captureFrameId,traceId:old.sameModelReuse?.targetTraceId??original.traceId};
   if(!await readMatchedLocationDisplay(c,{projectId:pid,current:priorCurrent,location:{id:row.id,name:row.name,aliases:row.aliases,revision:row.revision},head:old},check))reason='MODEL_LOCATION_CENTRE_SOURCE_UNVERIFIED';
   else{const bounds=(await readObject()).geometry.bounds;observed=bounds.minimum.map((v,i)=>(v+bounds.maximum[i])/2) as [number,number,number];}
  }
  const distance=observed?Math.hypot(...observed.map((v,i)=>v-old.pointProjectMetres[i])):null;
  if(!reason&&(distance===null||distance>CROSS_MODEL_ENDPOINT_TOLERANCE_METRES))reason='MODEL_LOCATION_CROSS_MODEL_DISTANCE_EXCEEDED';
  const request={schemaVersion:'wfc.pf.cross-model-endpoint-check.v1',projectId:pid,sourceBindingId:old.id,sourceBindingSha256:old.contentSha256,current,names,candidateObjectIds:identities.sort(),reasonCode:reason,distanceMetres:distance};
  const requestSha=endpointBindingHash(request);
  if(reason){
   const prior=(await c.query('/* cross-model-endpoints:checked */ SELECT 1 FROM pf_endpoint_binding_commands WHERE project_id=$1 AND actor_id=$2 AND request_sha256=$3 LIMIT 1',[pid,who.userId,requestSha])).rows;
   if(!prior.length)await c.query(`/* cross-model-endpoints:diagnostic */ INSERT INTO pf_endpoint_binding_commands(project_id,actor_id,idempotency_key,kind,request_sha256,request,receipt) VALUES($1,$2,$3,'confirm',$4,$5,$6)`,[pid,who.userId,randomUUID(),requestSha,request,{schemaVersion:'wfc.pf.cross-model-endpoint-check-receipt.v1',locationId:row.id,name:row.name,updated:false,reasonCode:reason,distanceMetres:distance}]);
   continue;
  }
  const object=await readObject();
  const registry=(await c.query<{revision:string}>('SELECT registry_revision::text AS revision FROM pf_project_state WHERE project_id=$1 FOR SHARE',[pid])).rows[0];
  await confirmEndpointBindingChangeInTransaction(c,pid,who,row.id,{schemaVersion:'wfc.pf.endpoint-binding-write.v1',expectedRegistryRevision:registry.revision,expectedLocationRevision:row.revision,expectedHeadId:old.id,expectedSelectionRevision:current.selectionRevision,modelVersionId:current.modelVersionId,aggregateId:current.aggregateId,projectionSha256:current.projectionSha256,captureFrameId:current.captureFrameId,idempotencyKey:randomUUID(),reason:'Automatic new-model exact-name match within 0.25 m; prior binding '+old.id+'; displacement '+distance+' m.',location:{name:row.name,aliases:row.aliases},mode:'object-derived',anchorRule:'equipment-bottom-aabb.v1',object:{traceId:current.traceId,objectRevisionId:object.id,recordSha256:selectedRecordSha}},signal);
  changed++;
 }check();return changed;
}
