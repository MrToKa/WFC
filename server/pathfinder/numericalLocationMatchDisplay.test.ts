// @vitest-environment node
import type { PoolClient } from 'pg';
import {describe,it,expect,vi} from 'vitest';
import {modelLocationMatchFixture} from './modelLocationMatchFixtures.js';
import {createEndpointBindingRepository,endpointBindingHash} from './endpointBindingRepository.js';
import {endpointFixtureId as id} from './endpointBindingFixtures.js';
import {readNumericalLocationMatchDisplay} from './numericalLocationMatchDisplay.js';
import {readCableEndpointDisplay} from './cableEndpointDisplay.js';
import type {EndpointBinding,EndpointBindingWrite} from '../../shared/pathfinderEndpointBindings.js';
import {cableEndpointDisplayMatchesSourceGroup} from '../../shared/pathfinderCableEndpoints.js';

/** Actual matching/binding/display functions over a synthetic SQL protocol;
 * production PostgreSQL/browser verification is separate. */
async function fixture(grouped=false,hops=1){
  const f=await modelLocationMatchFixture(),command=f.command();
  if(grouped){
    const first=command.scan.candidates[0];first.objectIdentity={guid:'7586ffbb-1d0a-5942-b687-06884123c866',sourceFile:'equipment.dwg'};
    command.scan.candidates.push({...first,objectId:100});
  }
  await f.repo.assign(f.projectId,f.who,command);
  const locationId=f.resolved(command.names[0]),source=f.state.bindings.get(f.state.heads.get(locationId)!)!;
  const point=[...source.pointProjectMetres] as [number,number,number];point[2]+=1e-12;
  let input:EndpointBindingWrite={schemaVersion:'wfc.pf.endpoint-binding-write.v1',expectedRegistryRevision:f.state.registry,
    expectedLocationRevision:source.locationRevision,expectedHeadId:source.id,expectedSelectionRevision:f.context.current.selectionRevision,
    modelVersionId:source.modelVersionId,aggregateId:source.aggregateId,projectionSha256:source.projectionSha256,captureFrameId:source.captureFrameId,
    idempotencyKey:id(811),reason:'Exact numeric source correction',location:{name:command.names[0],aliases:[]},mode:'fixed-world',
    derivation:'manual-world-point',provenanceObject:null,pointProjectMetres:point};
  const repository=createEndpointBindingRepository(f.pool);
  let receipt=await repository.confirm(f.projectId,f.who,locationId,input);
  const rows=[];
  for(let hop=1;hop<hops;hop++){
    rows.push({actor_id:f.who.userId,idempotency_key:input.idempotencyKey,kind:'confirm',request:{locationId,input},request_sha256:endpointBindingHash({locationId,input}),receipt});
    const previous=receipt.binding,next=[...previous.pointProjectMetres] as [number,number,number];next[2]+=1e-12;
    input={...input,expectedRegistryRevision:f.state.registry,expectedLocationRevision:previous.locationRevision,expectedHeadId:previous.id,idempotencyKey:id(811+hop),pointProjectMetres:next};
    receipt=await repository.confirm(f.projectId,f.who,locationId,input);
  }
  const head=receipt.binding;
  const row={actor_id:f.who.userId,idempotency_key:input.idempotencyKey,kind:'confirm',request:{locationId,input},
    request_sha256:endpointBindingHash({locationId,input}),receipt};
  let commands=[...rows,row],sourceRow:{record:EndpointBinding;record_sha256:string}|null=null;
  const boundaries=new Set<string>(),base=f.query.getMockImplementation()!;
  f.query.mockImplementation(async(sql:string,args:unknown[]=[])=>{
    if(sql.startsWith('/* numerical-display:per-end-boundary */'))return {rows:boundaries.has(String(args[2]))?[{}]:[]};
    if(sql.startsWith('/* numerical-display:command */'))return {rows:commands.filter(r=>r.receipt.binding.id===args[2])};
    if(sql.startsWith('/* numerical-display:source */')){const b=f.state.bindings.get(String(args[2]));return {rows:sourceRow?[sourceRow]:b?[{record:b,record_sha256:b.contentSha256}]:[]};}
    if(sql.startsWith('/* cable-endpoint:display-command */')||sql.startsWith('/* model-location-match:preserved-display */'))return {rows:[]};
    return base(sql,args);
  });
  const value={projectId:f.projectId,current:f.context.current,head,location:{id:locationId,name:command.names[0],aliases:[],revision:head.locationRevision}};
  const check=vi.fn(),read=()=>readNumericalLocationMatchDisplay(f.client as unknown as PoolClient,value,check);
  const rehash=()=>{row.request_sha256=endpointBindingHash(row.request);};
  f.query.mockClear();
  return {...f,value,source,input,row,check,read,rehash,boundaries,setCommands:(v:typeof commands)=>{commands=v;},setSource:(v:typeof sourceRow)=>{sourceRow=v;}};
}

describe('verified tiny numeric correction presentation',()=>{
  it('recovers the actual original matched object and rebinds only presentation to the current point/head',async()=>{
    const f=await fixture(),before=structuredClone(f.value),display=await readCableEndpointDisplay(f.client as unknown as PoolClient,f.value,f.check);
    expect(display).toMatchObject({source:'confirmed-display-only',sdkObjectId:f.source.autoMatchEvidence!.sdkObjectId,
      bindingId:f.value.head.id,bindingContentSha256:f.value.head.contentSha256,pointProjectMetres:f.value.head.pointProjectMetres});
    expect(f.value).toEqual(before);expect(f.value.head.sourceObject).toBeNull();expect(f.value.head.attachment).toBeNull();
    expect(f.query.mock.calls.map(c=>c[0]).join('\n')).not.toMatch(/\bINSERT\b|\bUPDATE\b|\bDELETE\b/);
  });
  it.each(['hash','actor','key','receipt','head','location','selection','model','frame','registry','revision','aliases','large-change','duplicate','source-hash','source-scope'])(
    'refuses %s without falling through to historical presentation',async kind=>{
      const f=await fixture();
      if(kind==='hash')f.row.request_sha256='f'.repeat(64);
      if(kind==='actor')f.row.actor_id=id(999);
      if(kind==='key')f.row.idempotency_key=id(999);
      if(kind==='receipt')f.row.receipt={...f.row.receipt,binding:{...f.row.receipt.binding,reason:'Unrelated'}};
      if(kind==='head')f.input.expectedHeadId=id(999);
      if(kind==='location')f.row.request.locationId=id(999);
      if(kind==='selection')f.input.expectedSelectionRevision='999';
      if(kind==='model')f.input.modelVersionId=id(999);
      if(kind==='frame')f.input.captureFrameId=id(999);
      if(kind==='registry')f.input.expectedRegistryRevision='999';
      if(kind==='revision')f.input.expectedLocationRevision='999';
      if(kind==='aliases')f.input.location.name='Unrelated';
      if(kind==='large-change'){
        const b=f.value.head;b.pointProjectMetres[2]+=0.01;b.displacementVectorMetres=b.pointProjectMetres.map((p,i)=>p-f.source.pointProjectMetres[i]) as [number,number,number];
        b.displacementMetres=Math.hypot(...b.displacementVectorMetres);const {contentSha256:_old,...body}=b;b.contentSha256=endpointBindingHash(body);
      }
      if(kind==='duplicate')f.setCommands([f.row,f.row]);
      if(kind==='source-hash')f.setSource({record:f.source,record_sha256:'f'.repeat(64)});
      if(kind==='source-scope')f.setSource({record:{...f.source,captureFrameId:id(999)},record_sha256:f.source.contentSha256});
      if(kind!=='hash')f.rehash();expect(await f.read()).toBeNull();
    });
  it.each(['current','ancestor'])('stops at any %s per-end command, including explicit clears or malformed records',async where=>{
    const f=await fixture();f.boundaries.add(where==='current'?f.value.head.id:f.source.id);expect(await f.read()).toBeNull();
  });
  it('never uses numeric fallback when an exact per-end row is malformed',async()=>{
    const f=await fixture(),base=f.query.getMockImplementation()!;
    f.query.mockImplementation(async(sql:string,args:unknown[]=[])=>sql.startsWith('/* cable-endpoint:display-command */')?{rows:[{request:null}]}:base(sql,args));
    expect(await readCableEndpointDisplay(f.client as unknown as PoolClient,f.value,f.check)).toBeNull();
    expect(f.query.mock.calls.some(c=>c[0].startsWith('/* numerical-display:'))).toBe(false);
  });
  it('retains the verified source group as presentation for a corrected head without match evidence',async()=>{
    const f=await fixture(true),display=await f.read();
    expect(f.value.head.autoMatchEvidence).toBeUndefined();
    expect(display?.sdkObjectIds).toEqual(f.source.autoMatchEvidence!.objectGroup!.objectIds);
    expect(display?.preservedMatchObjectGroup).toEqual(f.source.autoMatchEvidence!.objectGroup);
    expect(display&&cableEndpointDisplayMatchesSourceGroup(display,f.value.head)).toBe(true);
  });
  it('accepts at most eight exact numeric command links and refuses a ninth',async()=>{
    const accepted=await fixture(false,8);expect((await accepted.read())?.bindingId).toBe(accepted.value.head.id);
    const refused=await fixture(false,9);expect(await refused.read()).toBeNull();
    expect(refused.query.mock.calls.filter(c=>c[0].startsWith('/* numerical-display:command */'))).toHaveLength(8);
  });
  it('propagates cancellation and database failures',async()=>{
    const f=await fixture();f.check.mockImplementationOnce(()=>{throw Error('cancelled');});await expect(f.read()).rejects.toThrow('cancelled');
    f.query.mockRejectedValueOnce(Error('database unavailable'));await expect(f.read()).rejects.toThrow('database unavailable');
  });
});
