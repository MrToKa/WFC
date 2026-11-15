import type { PoolClient } from 'pg';
import { z } from 'zod';
import { endpointBindingSchema, endpointBindingReceiptSchema, endpointBindingWriteSchema, normalizeEndpointLocation,
  type EndpointBinding, type EndpointCurrentScope } from '../../shared/pathfinderEndpointBindings.js';
import { cableEndpointConfirmedDisplaySelectionSchema, type CableEndpointContext } from '../../shared/pathfinderCableEndpoints.js';
import { canonicalPurposeJson, policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { endpointBindingHash } from './endpointBindingRepository.js';
import { readMatchedLocationDisplay } from './modelLocationMatchDisplay.js';

const ownerSchema=z.object({locationId:policyUuidSchema,input:endpointBindingWriteSchema}).strict();
const same=(a:unknown,b:unknown)=>canonicalPurposeJson(a)===canonicalPurposeJson(b);
const names=(location:{name:string;aliases:string[]})=>[location.name,...location.aliases].map(normalizeEndpointLocation).sort();
type Input={projectId:string;current:EndpointCurrentScope;location:NonNullable<CableEndpointContext['location']>;head:EndpointBinding};
const valid=(head:EndpointBinding,input:Input)=>{
  const {contentSha256,...body}=head,c=input.current;
  return endpointBindingHash(body)===contentSha256&&head.projectId===input.projectId&&head.locationId===input.location.id
    &&head.status==='confirmed'&&head.mode==='fixed-world'&&head.sourceObject===null&&head.attachment===null
    &&head.modelVersionId===c.modelVersionId&&head.aggregateId===c.aggregateId&&head.artifactId===c.artifactId
    &&head.projectionSha256===c.projectionSha256&&head.captureFrameId===c.captureFrameId;
};

/** Presentation only, for tiny same-frame corrections recorded by the generic
 * binding command. Never searches past a per-end command (including a clear),
 * and never changes the current point or claims geometry/connector authority. */
export async function readNumericalLocationMatchDisplay(client:PoolClient,input:Input,check:()=>void):Promise<NonNullable<CableEndpointContext['confirmedDisplaySelection']>|null>{
  const parsed=endpointBindingSchema.safeParse(input.head);
  if(!parsed.success||!valid(parsed.data,input)||parsed.data.locationRevision!==input.location.revision)return null;
  let head=parsed.data;const visited=new Set<string>();
  for(let depth=0;depth<=8;depth++){
    check();if(visited.has(head.id)||!valid(head,input))return null;visited.add(head.id);
    // A malformed or explicitly cleared per-end receipt is a hard boundary.
    const boundary=await client.query(`/* numerical-display:per-end-boundary */ SELECT 1 FROM pf_endpoint_binding_commands
      WHERE project_id=$1 AND kind='confirm' AND request->>'schemaVersion'='wfc.pf.cable-endpoint-command-owner.v1'
        AND receipt#>>'{receipt,locationId}'=$2 AND receipt#>>'{receipt,binding,binding,id}'=$3 LIMIT 1 FOR SHARE`,[input.projectId,input.location.id,head.id]);
    check();if(boundary.rows.length)return null;
    if(['matched-model-bottom-aabb.v1','matched-model-centre-fallback.v1'].includes(head.derivation)){
      const display=await readMatchedLocationDisplay(client,{...input,head,location:{...input.location,revision:head.locationRevision}},check);
      if(!display)return null;
      const group=head.autoMatchEvidence?.objectGroup;
      return cableEndpointConfirmedDisplaySelectionSchema.parse({...display,pointProjectMetres:input.head.pointProjectMetres,
        bindingId:input.head.id,bindingContentSha256:input.head.contentSha256,...(group?{preservedMatchObjectGroup:group}:{})});
    }
    if(depth===8||head.derivation!=='manual-world-point'||!head.supersedesBindingId)return null;
    const rows=(await client.query<{actor_id:unknown;idempotency_key:unknown;request_sha256:unknown;request:unknown;receipt:unknown}>(
      `/* numerical-display:command */ SELECT actor_id,idempotency_key,request_sha256,
        CASE WHEN octet_length(request::text)<=65536 THEN request ELSE NULL END AS request,
        CASE WHEN octet_length(receipt::text)<=65536 THEN receipt ELSE NULL END AS receipt
        FROM pf_endpoint_binding_commands WHERE project_id=$1 AND kind='confirm' AND request->>'locationId'=$2
          AND receipt->>'schemaVersion'='wfc.pf.endpoint-binding-receipt.v1' AND receipt#>>'{binding,id}'=$3
        LIMIT 2 FOR SHARE`,[input.projectId,input.location.id,head.id])).rows;
    check();if(rows.length!==1)return null;
    const row=rows[0],owner=ownerSchema.safeParse(row.request),receipt=endpointBindingReceiptSchema.safeParse(row.receipt);
    if(!owner.success||!receipt.success||row.request_sha256!==endpointBindingHash(owner.data))return null;
    const command=owner.data.input,result=receipt.data;
    if(command.mode!=='fixed-world'||command.derivation!=='manual-world-point'||command.provenanceObject!==null
      ||owner.data.locationId!==head.locationId||row.actor_id!==head.confirmedBy||row.idempotency_key!==command.idempotencyKey
      ||command.expectedHeadId!==head.supersedesBindingId||command.expectedLocationRevision===null
      ||command.expectedSelectionRevision!==input.current.selectionRevision||command.modelVersionId!==input.current.modelVersionId
      ||command.aggregateId!==input.current.aggregateId||command.projectionSha256!==input.current.projectionSha256
      ||command.captureFrameId!==input.current.captureFrameId||command.reason!==head.reason
      ||!same(command.pointProjectMetres,head.pointProjectMetres)||!same(names(command.location),names(input.location))
      ||result.projectId!==input.projectId||result.locationId!==head.locationId||!same(result.binding,head)
      ||result.locationRevision!==head.locationRevision||result.registryRevision!==head.locationRegistryRevision
      ||BigInt(command.expectedRegistryRevision)+1n!==BigInt(result.registryRevision))return null;
    const sourceRows=(await client.query<{record:unknown;record_sha256:unknown}>(`/* numerical-display:source */ SELECT record_sha256,
      CASE WHEN octet_length(record::text)<=65536 THEN record ELSE NULL END AS record
      FROM pf_endpoint_binding_revisions WHERE project_id=$1 AND location_id=$2 AND id=$3 LIMIT 2 FOR SHARE`,
    [input.projectId,input.location.id,head.supersedesBindingId])).rows;
    check();if(sourceRows.length!==1)return null;
    const source=endpointBindingSchema.safeParse(sourceRows[0].record);
    if(!source.success||!valid(source.data,input)||source.data.contentSha256!==sourceRows[0].record_sha256
      ||source.data.id!==head.supersedesBindingId||source.data.locationRevision!==command.expectedLocationRevision
      ||BigInt(source.data.locationRevision)+1n!==BigInt(head.locationRevision)
      ||BigInt(source.data.bindingRevision)+1n!==BigInt(head.bindingRevision)
      ||BigInt(source.data.locationRegistryRevision)>BigInt(command.expectedRegistryRevision)
      ||!same(head.priorPointProjectMetres,source.data.pointProjectMetres)||head.priorCaptureFrameId!==source.data.captureFrameId
      ||Math.hypot(...head.pointProjectMetres.map((p,i)=>p-source.data.pointProjectMetres[i]))>1e-6
      ||Math.hypot(...input.head.pointProjectMetres.map((p,i)=>p-source.data.pointProjectMetres[i]))>1e-6)return null;
    head=source.data;
  }
  return null;
}
