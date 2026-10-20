import type { PoolClient } from 'pg';
import { RECALCULATION_LIMITS } from '../../shared/pathfinderRecalculation.js';
import { policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { optionsSchema, type EngineOptions, type CurrentDependencySnapshot } from './jobContracts.js';
import { collectCommonCalculationInputs, freezeCableDependenciesForVersion, canonicalJson, type CollectedDependencies } from './dependencies.js';
import { calculationEngineIdentity } from './calculationEngineIdentity.js';
import { readNeededEndpointBindingHeads } from './endpointBindingRepository.js';
import { endpointCalculationPoint, type CurrentEndpointCalculationPoint } from './endpointCalculationProvenance.js';
import { readAutomaticEndpointCandidates } from './automaticEndpointCandidates.js';
import { normalizeLocation } from './matching.js';
import { PathFinderError } from './errors.js';

export type DependencyBatch = { items: Array<CollectedDependencies & {id:string}>; registryRevision:string; options:EngineOptions; bytes:number };
const refused = (code:string,status=413):never => {throw new PathFinderError(code,status,'The complete cable scope exceeds a bounded calculation admission limit. No partial scope was admitted.');};

/** Caller holds project/authority locks. Scheduler state must remain unlocked until this returns. */
export async function collectDependencyBatchInTransaction(client:PoolClient,input:{
  projectId:string;options:EngineOptions;cableIds?:string[];signal?:AbortSignal;
  deadline?:number;engineIdentity?:CurrentDependencySnapshot['engineIdentity'];
  dependencyVersion?:'pathfinder.dependencies.v7';
}):Promise<DependencyBatch>{
  const projectId=policyUuidSchema.parse(input.projectId),options=optionsSchema.parse(input.options);
  const deadline=Math.min(input.deadline??Infinity,Date.now()+RECALCULATION_LIMITS.collectionMilliseconds);
  const check=()=>{input.signal?.throwIfAborted();if(Date.now()>deadline)refused('RECALCULATION_COLLECTION_DEADLINE',503);};
  if(input.cableIds&&input.cableIds.length>RECALCULATION_LIMITS.cables)refused('JOB_CABLE_BUDGET');
  const requested=input.cableIds?[...new Set(input.cableIds.map(id=>policyUuidSchema.parse(id)))].sort():undefined;
  check();
  const identities=(await client.query<{id:string}>(`SELECT id FROM cables WHERE project_id=$1 ${requested?'AND id=ANY($2::uuid[])':''} ORDER BY id LIMIT 10001 FOR UPDATE`,requested?[projectId,requested]:[projectId])).rows;
  if(identities.length>RECALCULATION_LIMITS.cables)refused('JOB_CABLE_BUDGET');
  if(requested&&requested.length!==identities.length)throw new PathFinderError('CABLE_NOT_FOUND',404);
  if(!identities.length)throw new PathFinderError('NO_CABLES',409,'There are no cables in this calculation scope.');
  if(new Set(identities.map(x=>x.id)).size!==identities.length)refused('RECALCULATION_CABLE_INTEGRITY',500);
  const cables:Array<Record<string,any>>=[];let inputBytes=0;
  for(let at=0;at<identities.length;at+=RECALCULATION_LIMITS.cableChunk){
    check();const ids=identities.slice(at,at+RECALCULATION_LIMITS.cableChunk).map(x=>x.id);
    // Oversized text is refused explicitly before materializing it in the API process.
    const values=(await client.query<Record<string,any>>(`SELECT id,
      CASE WHEN octet_length(from_location)>4096 THEN NULL ELSE from_location END AS from_location,
      CASE WHEN octet_length(to_location)>4096 THEN NULL ELSE to_location END AS to_location,
      CASE WHEN octet_length(tag)>4096 THEN NULL ELSE tag END AS tag,
      CASE WHEN char_length(routing)>8000 OR octet_length(routing)>32000 THEN NULL ELSE routing END AS routing,
      design_length::text,install_length::text,mto,cable_type_id,cable_write_revision::text,
      (COALESCE(octet_length(from_location),0)>4096 OR COALESCE(octet_length(to_location),0)>4096
        OR COALESCE(octet_length(tag),0)>4096 OR COALESCE(char_length(routing),0)>8000 OR COALESCE(octet_length(routing),0)>32000) AS input_oversize
      FROM cables WHERE project_id=$1 AND id=ANY($2::uuid[]) ORDER BY id`,[projectId,ids])).rows;
    if(values.length!==ids.length||values.some((row,n)=>row.id!==ids[n]))refused('RECALCULATION_CABLE_INTEGRITY',409);
    for(const row of values){if(row.input_oversize)refused('RECALCULATION_INPUT_BYTES');inputBytes+=Buffer.byteLength(canonicalJson(row));if(inputBytes>RECALCULATION_LIMITS.dependencyBytes)refused('RECALCULATION_INPUT_BYTES');cables.push(row);}
  }
  check();
  // One actual implementation read per whole batch; no DLL hashing in its cable loop.
  const identity=input.engineIdentity??await calculationEngineIdentity({force:true});
  const common=await collectCommonCalculationInputs(client,projectId,options,true,identity);
  check();
  const registry=common.inputs===null?(await client.query<{registry_revision:string}>('SELECT registry_revision::text FROM pf_project_state WHERE project_id=$1 FOR SHARE',[projectId])).rows[0]?.registry_revision:common.inputs.registryRevision;
  if(!registry)throw new PathFinderError('REGISTRY_CONFLICT',409);
  const items:DependencyBatch['items']=[];let bytes=0;
  const append=(item:CollectedDependencies)=>{bytes+=Buffer.byteLength(canonicalJson({id:item.cable.id,status:item.status,message:item.message,dependencies:item.dependencies}));if(bytes>RECALCULATION_LIMITS.dependencyBytes)refused('RECALCULATION_DEPENDENCY_BYTES');items.push({id:item.cable.id,...item});};
  if(common.inputs===null){for(const cable of cables){check();append({cable,dependencies:null,status:common.status,message:common.message});}return{items,registryRevision:registry,options,bytes};}
  const names=[...new Set(cables.flatMap(cable=>[cable.from_location,cable.to_location]).filter((name):name is string=>typeof name==='string'&&normalizeLocation(name)!=='').map(normalizeLocation))].sort();
  if(names.length>RECALCULATION_LIMITS.neededLocations)refused('ENDPOINT_NEEDED_LOCATION_LIMIT');
  const aliases=new Map<string,string[]>();let locationBytes=0;
  for(let at=0;at<names.length;at+=RECALCULATION_LIMITS.headChunk){
    check();const subset=names.slice(at,at+RECALCULATION_LIMITS.headChunk);
    const found=(await client.query<{normalized_alias:string;location_id:string}>(
      'SELECT a.normalized_alias,a.location_id FROM pf_location_aliases a JOIN pf_locations l ON l.project_id=a.project_id AND l.id=a.location_id WHERE a.project_id=$1 AND a.normalized_alias=ANY($2::text[]) ORDER BY a.normalized_alias,a.location_id FOR SHARE OF a,l',[projectId,subset])).rows;
    for(const row of found){locationBytes+=Buffer.byteLength(canonicalJson(row));if(locationBytes>RECALCULATION_LIMITS.neededLocationBytes)refused('ENDPOINT_NEEDED_LOCATION_BYTES');if(!subset.includes(row.normalized_alias))refused('RECALCULATION_ALIAS_INTEGRITY',500);const ids=aliases.get(row.normalized_alias)??[];if(!ids.includes(row.location_id))ids.push(row.location_id);aliases.set(row.normalized_alias,ids);}
  }
  const locationIds=[...new Set([...aliases.values()].flat())].sort();
  const heads=await readNeededEndpointBindingHeads(client,{projectId,current:common.bindingContext,locationIds,deadline,signal:input.signal,initialBytes:locationBytes});
  const unbound = locationIds.filter(id => !heads.has(id));
  const automatic = unbound.length && common.bindingContext.traceId ? await readAutomaticEndpointCandidates(client,
    {projectId,current:common.bindingContext,locationIds:unbound,deadline,signal:input.signal}) : new Map();
  const endpoint=(name:string|null):CurrentEndpointCalculationPoint|null=>{
    if(!name)return null;const ids=aliases.get(normalizeLocation(name));if(ids?.length!==1)return null;
    const head=heads.get(ids[0]);return head ? head.ready?endpointCalculationPoint(head.binding):null : automatic.get(ids[0])?.point ?? null;
  };
  for(const cable of cables){check();append(freezeCableDependenciesForVersion(common.inputs,cable,endpoint(cable.from_location),endpoint(cable.to_location),input.dependencyVersion??'pathfinder.dependencies.v5'));}
  check();return{items,registryRevision:registry,options:common.inputs.options,bytes};
}
