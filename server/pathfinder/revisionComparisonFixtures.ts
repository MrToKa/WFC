import { vi } from 'vitest';
import type { Pool } from 'pg';
import { geometryTraceFixture } from './geometryTraceFixtures.js';
import { buildGeometryTrace } from './geometryTraceBuilder.js';
import { revisionComparisonHash } from './revisionComparisonPublisher.js';
import { executeRevisionComparisonThread } from './revisionComparisonThread.js';
import { createRevisionComparisonRepository } from './revisionComparisonRepository.js';
import { canonicalPurposeJson } from '../../shared/pathfinderPurposePolicy.js';
import type { RevisionComparisonDecision,RevisionComparisonManifest } from '../../shared/pathfinderRevisionComparison.js';

export const revisionFixtureId=(n:number)=>`a6000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
type Row=Record<string,unknown>;
/** Synthetic in-memory SQL protocol; never an actual database or model claim. */
export function revisionComparisonFixture(){
  const side=(n:number)=>{const f=geometryTraceFixture();f.aggregate.id=revisionFixtureId(n);f.aggregate.artifactId=revisionFixtureId(n+1);f.traceId=revisionFixtureId(n+2);f.recordsBlobId=revisionFixtureId(n+3);const built=buildGeometryTrace(f);return{f,built};};
  const source=side(10),target=side(20),other=side(30),pid=source.f.aggregate.projectId,who={userId:source.f.createdBy,loginId:revisionFixtureId(1),loginExpiresAt:Date.now()+600000};
  const state={exists:true,admin:true,revoked:false,revision:'0',selection:'1',rollbackFails:false,commitFails:false,ordinal:0,intents:new Map<string,Row>(),targets:new Map<string,Row>(),sets:new Map<string,{manifest:RevisionComparisonManifest;rows_blob:unknown}>(),changes:new Map<string,Row[]>(),decisions:new Map<string,{record:RevisionComparisonDecision;record_sha256:string}>(),heads:new Map<string,{comparisonId:string;subjectKey:string;decisionId:string}>(),commands:new Map<string,Row>(),qualifications:new Map<string,Row>(),members:[] as Row[],bindings:new Map<string,Row>(),migrations:new Map<string,Row>()};
  const blobs=new Map<string,Buffer>(),sides=[source,target,other];
  for(const s of sides)blobs.set(s.f.aggregate.sessionId+':'+s.built.manifest.objectRecords.payloadRef,Buffer.from(canonicalPurposeJson(s.built.records)));
  const storeBlob=async(_p:string,s:string,id:string,value:unknown,limit=64*1024**2)=>{const bytes=Buffer.from(canonicalPurposeJson(value));if(bytes.length>limit)throw Error('MOCK_BLOB_LIMIT');const key=s+':'+id,old=blobs.get(key);if(old&&!old.equals(bytes))throw Error('MOCK_BLOB_IMMUTABLE');blobs.set(key,bytes);return{payloadRef:id,sha256:revisionComparisonHash(value),bytes:bytes.length};};
  const readBlob=async(_p:string,s:string,ref:{payloadRef:string;sha256:string;bytes:number},limit=64*1024**2)=>{const bytes=blobs.get(s+':'+ref.payloadRef);if(!bytes||bytes.length>limit||bytes.length!==ref.bytes||revisionComparisonHash(JSON.parse(bytes.toString('utf8')))!==ref.sha256)throw Error('MOCK_BLOB_INTEGRITY');return bytes;};
  let snapshot:typeof state|null=null;
  const release=vi.fn(),query=vi.fn(async(sql:string,args:unknown[]=[]):Promise<{rows:Row[]}>=>{const a=args as string[];
    if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)){if(sql==='BEGIN')snapshot=structuredClone(state);if(sql==='COMMIT'){if(state.commitFails)throw Error('commit transport');snapshot=null;}if(sql==='ROLLBACK'){if(state.rollbackFails)throw Error('rollback transport');if(snapshot)Object.assign(state,snapshot);snapshot=null;}return{rows:[]};}
    if(sql.startsWith('SET LOCAL')||sql.startsWith('INSERT INTO viewer_login_bindings'))return{rows:[]};
    if(sql.startsWith('SELECT id FROM projects'))return{rows:state.exists?[{id:pid}]:[]};
    if(sql.startsWith('SELECT is_admin'))return{rows:[{is_admin:state.admin}]};
    if(sql.startsWith('SELECT user_id,expires_at'))return{rows:[{user_id:who.userId,expires_at:new Date(who.loginExpiresAt),revoked_at:state.revoked?new Date():null}]};
    if(sql.startsWith('INSERT INTO pf_revision_comparison_state'))return{rows:[]};
    if(sql.startsWith('SELECT comparison_revision::text FROM pf_revision_comparison_state'))return{rows:[{comparison_revision:state.revision}]};
    if(sql.startsWith('UPDATE pf_revision_comparison_state')){state.revision=a[1];return{rows:[]};}
    if(sql.startsWith('SELECT active_model_version_id'))return{rows:[{active_model_version_id:target.f.aggregate.modelVersionId,selection_revision:state.selection}]};
    if(sql.startsWith('SELECT state,health,content_fingerprint'))return{rows:[{state:'ready',health:'healthy',content_fingerprint:target.f.aggregate.contentFingerprint}]};
    if(sql.startsWith('SELECT p.current_aggregate_id'))return{rows:[]};
    if(sql.startsWith('/* comparison:pair */')){const s=sides.find(x=>x.f.aggregate.id===a[1]&&x.f.traceId===a[2]);return{rows:s?[{aggregate:s.f.aggregate,plan:s.f.plan,trace:s.built.manifest,label:'Synthetic revision',snapshot_sha256:s.f.aggregate.projection.sha256,snapshot_bytes:String(s.f.aggregate.projection.bytes),model_version_id:s.f.aggregate.modelVersionId}]:[]};}
    if(sql.startsWith('INSERT INTO pf_revision_comparison_targets')){const key=a[1]+':'+a[2];if(!state.targets.has(key))state.targets.set(key,{target_aggregate_id:a[1],target_model_version_id:a[2],current_comparison_id:null,comparison_revision:'0',decision_set_sha256:a[3]});return{rows:[]};}
    if(sql.startsWith('SELECT target_aggregate_id')){const value=state.targets.get(a[1]+':'+a[2]);return{rows:value?[value]:[]};}
    if(sql.startsWith('SELECT current_comparison_id')){const value=state.targets.get(a[1]+':'+a[2]);return{rows:value?[value]:[]};}
    if(sql.startsWith('UPDATE pf_revision_comparison_targets')){const value=state.targets.get(a[1]+':'+a[2])!;value.comparison_revision=a[3];if(sql.includes('current_comparison_id')){value.current_comparison_id=a[4];value.decision_set_sha256=a[5];}else value.decision_set_sha256=a[4];return{rows:[]};}
    if(sql.startsWith('SELECT kind,request_sha256')){const value=state.commands.get(a[1]+':'+a[2]);return{rows:value?[value]:[]};}
    if(sql.startsWith('INSERT INTO pf_revision_comparison_commands')){state.commands.set(a[1]+':'+a[2],{kind:a[3],request_sha256:a[4],request:args[5],receipt:args[6]});return{rows:[]};}
    if(sql.startsWith('SELECT id,request,input_sha256')){const value=sql.includes('actor_id=')?[...state.intents.values()].find(x=>x.actor_id===a[1]&&x.idempotency_key===a[2]):state.intents.get(a[1]);return{rows:value?[value]:[]};}
    if(sql.startsWith('SELECT id,state,lease_expires_at')){const list=[...state.intents.values()].filter(x=>x.target_aggregate_id===a[1]&&x.target_model_version_id===a[2]).sort((x,y)=>Number(y.admission_order)-Number(x.admission_order));return{rows:list.slice(0,1)};}
    if(sql.startsWith('SELECT id,state FROM pf_revision_comparison_intents')){const list=[...state.intents.values()].filter(x=>x.target_aggregate_id===a[1]&&x.target_model_version_id===a[2]).sort((x,y)=>Number(y.admission_order)-Number(x.admission_order));return{rows:list.slice(0,1)};}
    if(sql.startsWith('INSERT INTO pf_revision_comparison_intents')){state.intents.set(a[0],{id:a[0],project_id:a[1],source_aggregate_id:a[2],target_aggregate_id:a[3],source_trace_id:a[4],target_trace_id:a[5],target_model_version_id:a[6],actor_id:a[7],idempotency_key:a[8],input_sha256:a[9],request:args[10],frozen:args[11],state:'pending',lease_token:a[12],lease_expires_at:args[13],admission_order:++state.ordinal});return{rows:[]};}
    if(sql.startsWith('UPDATE pf_revision_comparison_intents SET lease_token')){const value=state.intents.get(a[1])!;value.lease_token=a[2];value.lease_expires_at=args[3];return{rows:[]};}
    if(sql.startsWith('UPDATE pf_revision_comparison_intents SET state')){state.intents.get(a[1])!.state='complete';return{rows:[]};}
    if(sql.startsWith('INSERT INTO pf_revision_comparison_sets')){state.sets.set(a[0],{manifest:args[7] as RevisionComparisonManifest,rows_blob:args[8]});return{rows:[]};}
    if(sql.startsWith('SELECT manifest FROM pf_revision_comparison_sets'))return{rows:sql.includes('AND id=')?(state.sets.has(a[1])?[state.sets.get(a[1])!]:[]):[...state.sets.values()]};
    if(sql.startsWith('INSERT INTO pf_revision_comparison_changes')){const old=state.changes.get(a[1])??[];state.changes.set(a[1],[...old,...JSON.parse(a[2])]);return{rows:[]};}
    if(sql.startsWith('SELECT record,record_sha256 FROM pf_revision_comparison_changes'))return{rows:(state.changes.get(a[1])??[]).slice(Number(args[3]),Number(args[3])+Number(args[2]))};
    if(sql.startsWith('SELECT h.subject_key'))return{rows:[...state.heads.values()].filter(h=>h.comparisonId===a[1]).sort((x,y)=>x.subjectKey.localeCompare(y.subjectKey)).map(h=>{const d=state.decisions.get(h.decisionId)!;return{subject_key:h.subjectKey,decision_id:h.decisionId,record_sha256:d.record_sha256,kind:d.record.kind,decision_revision:d.record.decisionRevision};})};
    if(sql.startsWith('SELECT decision_id FROM pf_revision_comparison_decision_heads')){const value=state.heads.get(a[1]+':'+a[2]);return{rows:value?[{decision_id:value.decisionId}]:[]};}
    if(sql.startsWith('SELECT d.record,d.record_sha256')){const head=[...state.heads.values()].find(h=>h.comparisonId===a[1]&&h.decisionId===a[2]),value=head?state.decisions.get(head.decisionId):null;return{rows:value?[value]:[]};}
    if(sql.startsWith('SELECT record,record_sha256 FROM pf_revision_comparison_decisions')){if(sql.includes('AND id=')){const d=state.decisions.get(a[2]);return{rows:d?[d]:[]};}return{rows:[...state.decisions.values()].filter(d=>d.record.comparisonId===a[1]&&(args[2]===null||BigInt(d.record.comparisonRevision)<BigInt(a[2]))).sort((x,y)=>Number(BigInt(y.record.comparisonRevision)-BigInt(x.record.comparisonRevision))).slice(0,Number(args[3]))};}
    if(sql.startsWith('INSERT INTO pf_revision_comparison_decisions')){state.decisions.set(a[0],{record:args[11] as RevisionComparisonDecision,record_sha256:a[10]});return{rows:[]};}
    if(sql.startsWith('INSERT INTO pf_revision_comparison_decision_heads')){state.heads.set(a[1]+':'+a[2],{comparisonId:a[1],subjectKey:a[2],decisionId:a[3]});return{rows:[]};}
    if(sql.startsWith('INSERT INTO pf_revision_comparison_decision_objects')){state.members.push({decisionId:a[1],side:a[2],objectId:a[4]});return{rows:[]};}
    if(sql.startsWith('SELECT o.object_revision_id'))return{rows:state.members.filter(m=>(args[3] as string[]).includes(m.objectId as string)&&[...state.heads.values()].some(h=>h.decisionId===m.decisionId&&h.comparisonId===a[1]&&h.subjectKey!==a[2])).slice(0,1)};
    if(sql.startsWith('SELECT record FROM pf_geometry_object_revisions')){const object=sides.flatMap(s=>s.built.records).find(r=>r.id===a[2]&&r.traceId===a[1]);return{rows:object?[{record:object}]:[]};}
    if(sql.startsWith('SELECT record,summary FROM pf_geometry_object_revisions')){const s=sides.find(s=>s.built.records.some(r=>r.id===a[1])),object=s?.built.records.find(r=>r.id===a[1]);return{rows:object?[{record:object,summary:{recordSha256:revisionComparisonHash(object)}}]:[]};}
    if(sql.startsWith('SELECT record,record_sha256 FROM pf_endpoint_binding_revisions')){const row=state.bindings.get(a[1]);return{rows:row?[row]:[]};}
    if(sql.startsWith('SELECT record,record_sha256 FROM pf_endpoint_migration_decisions')){const row=state.migrations.get(a[1]);return{rows:row?[row]:[]};}
    if(sql.startsWith('SELECT record FROM pf_revision_binding_frame_qualifications')){const value=state.qualifications.get(a[1]);return{rows:value?[value]:[]};}
    if(sql.startsWith('SELECT record,record_sha256 FROM pf_revision_binding_frame_qualifications')){const value=state.qualifications.get(sql.includes('comparison_id=$2')?a[2]:a[1]);return{rows:value?[value]:[]};}
    if(sql.startsWith('INSERT INTO pf_revision_binding_frame_qualifications')){state.qualifications.set(a[2],{record:args[5],record_sha256:a[4]});return{rows:[]};}
    throw Error('Unexpected revision fixture SQL: '+sql.slice(0,140));
  });
  const client={query,release},pool={connect:vi.fn(async()=>client)} as unknown as Pool;
  const worker=vi.fn(async(input:Parameters<typeof executeRevisionComparisonThread>[0])=>executeRevisionComparisonThread(input,{storePreparationBlob:storeBlob,readPreparationBlob:readBlob}));
  const runWorker=vi.fn(async(input:{projectId:string;sessionId:string;comparisonId:string;frozenBlob:{payloadRef:string;sha256:string;bytes:number}})=>worker({...input,schemaVersion:'wfc.pf.revision-comparison-thread.v1',requestId:revisionFixtureId(99),storageLockBuffer:new SharedArrayBuffer(4)}));
  const routing={catalogRevision:source.f.aggregate.catalogRevision,routingContentSha256:source.f.aggregate.routingContentSha256,routingPolicyRevision:source.f.aggregate.routingPolicyRevision,routingPolicySha256:source.f.aggregate.routingPolicySha256};
  const repo=createRevisionComparisonRepository(pool,{storeBlob,readBlob,runWorker,readRoutingScope:async()=>routing});let key=100;
  const pair=(s:typeof source)=>({aggregateId:s.f.aggregate.id,traceId:s.f.traceId,projectionSha256:s.f.aggregate.projection.sha256,traceContentSha256:s.built.manifest.contentSha256});
  const command=()=>({schemaVersion:'wfc.pf.revision-comparison-create.v1' as const,source:pair(source),target:pair(target),expectedComparisonRevision:state.revision,idempotencyKey:revisionFixtureId(key++),reason:'Synthetic retained model comparison'});
  return{source,target,other,pid,who,state,blobs,storeBlob,readBlob,query,release,client,pool,worker,runWorker,repo,command,pair,routing};
}
