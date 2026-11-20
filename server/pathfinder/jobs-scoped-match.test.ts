// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import type { PathFinderRepository } from './repository.js';

const seams=vi.hoisted(()=>({collect:vi.fn(),persist:vi.fn(),transaction:vi.fn(),automatic:vi.fn(),requalify:vi.fn(),recover:vi.fn()}));
vi.mock('./dependencyBatch.js',()=>({collectDependencyBatchInTransaction:seams.collect}));
vi.mock('./revisionResultRepository.js',()=>({persistRevisionAdmission:seams.persist,verifyRevisionResultForProposal:vi.fn()}));
vi.mock('./auth.js',async original=>({...await original<typeof import('./auth.js')>(),principalTransaction:seams.transaction}));
vi.mock('./automaticPairMandates.js',()=>({appendAutomaticPairMandatesInTransaction:seams.automatic}));
vi.mock('./endpointBindingRequalification.js',()=>({requalifyAutomaticEndpointBindingsInTransaction:seams.requalify}));
vi.mock('./crossModelEndpointRecovery.js',()=>({recoverCrossModelEndpointsInTransaction:seams.recover}));
import {createPathFinderJobs} from './jobs.js';
import {createJobSchema,defaultOptions} from './jobContracts.js';
import {PathFinderError} from './errors.js';
import {hash} from './dependencies.js';
import {BULK_CALCULATION_SUBMISSION_LIMITS} from '../../shared/pathfinderCalculationSubmission.js';

const id=(n:number)=>'b2700000-0000-4000-8000-'+n.toString(16).padStart(12,'0');
const projectId=id(1),cableId=id(2),who={userId:id(3),loginId:id(4),loginExpiresAt:Date.parse('2099-01-01T00:00:00Z')};
const scope={projectId,modelVersionId:id(5),contentFingerprint:'a'.repeat(64),selectionRevision:'2',captureFrameId:id(6),captureFrameSha256:'b'.repeat(64),coordinateFrame:'canonical-world-metres' as const};
const options={...defaultOptions,barrierRouting:{schemaVersion:'wfc.pf.barrier-admission-intent.v1' as const,scope,expectedRegistryRevision:'4',drillThroughWalls:false,
  expectedSnapshot:{snapshotId:id(7),scope,registryRevision:'4',contentSha256:'c'.repeat(64),mode:'explicit-empty' as const}}};
const automaticPairPolicy={schemaVersion:'wfc.pf.automatic-pair-policy.v1' as const,mode:'when-both-empty-or-unchanged-automatic' as const};
function fixture() {
  type StoredBulk = {id:unknown;requested_by:unknown;bulk_submission_sha256:unknown;registry_revision:unknown};
  const state:{duplicate:boolean;storedBulk?:StoredBulk;legacyJobId?:string}={duplicate:false};
  const match=vi.fn().mockResolvedValue({registryRevision:'8'}),query=vi.fn(async(sql:string,args:unknown[]=[])=>{
    if(sql.startsWith('SELECT registry_revision'))return {rows:[{registry_revision:'8'}]};
    if(sql.includes('bulk-submission:by-id'))return {rows:state.storedBulk?.id===args[1]?[state.storedBulk]:[]};
    if(sql.includes('bulk-submission:legacy'))return {rows:state.legacyJobId?[{id:state.legacyJobId}]:[]};
    if(sql.includes('FROM pf_jobs'))return {rows:state.duplicate&&sql.startsWith('SELECT id FROM')?[{id:id(40)}]:[]};
    if(sql.startsWith('INSERT INTO pf_jobs')){
      if(args[13])state.storedBulk={id:args[0],requested_by:args[2],bulk_submission_sha256:args[13],registry_revision:args[14]};
      return {rows:[]};
    }
    if(sql.startsWith('INSERT INTO pf_job_items'))return {rows:[]};
    if(sql.includes('FROM project_model_selections s JOIN'))return {rows:[{id:scope.modelVersionId,selectionRevision:'2',contentFingerprint:'a'.repeat(64)}]};
    if(sql.startsWith('SET LOCAL'))return {rows:[]};
    throw Error('Unexpected scoped-admission fixture SQL: '+sql);
  });
  const client={query} as unknown as PoolClient;
  seams.transaction.mockImplementation(async(_pool:unknown,_project:unknown,_principal:unknown,operation:(c:PoolClient)=>Promise<unknown>)=>operation(client));
  seams.collect.mockImplementation(async(_client:unknown,input:{options:unknown})=>({registryRevision:'8',options:input.options,bytes:100,
    items:[{id:cableId,cable:{id:cableId,cable_write_revision:'9'},status:'ready',message:'',dependencies:{schemaVersion:'pathfinder.dependencies.v8',from:{point:[1,2,3]},to:{point:[4,5,6]}}}]}));
  const jobs=createPathFinderJobs({} as Pool,{match} as unknown as PathFinderRepository);
  return {match,query,client,jobs,state};
}
beforeEach(()=>{vi.clearAllMocks();seams.collect.mockReset();seams.persist.mockReset();seams.transaction.mockReset();seams.persist.mockResolvedValue(undefined);});

describe('manual calculation uses the same exact cable scope for matching and admission',()=>{
  it('recovers verified shared endpoints before freezing a forced whole-project run',async()=>{
    const f=fixture();
    const collect=seams.collect.getMockImplementation()!;
    seams.collect.mockImplementationOnce(async (...args)=>({...await collect(...args),registryRevision:'9'}));
    const result=await f.jobs.create(projectId,who,createJobSchema.parse({expectedRegistryRevision:'7',options,force:true,automaticPairPolicy}));
    expect(seams.requalify).toHaveBeenCalledExactlyOnceWith(f.client,projectId,who,expect.any(AbortSignal));
    expect(seams.recover).toHaveBeenCalledExactlyOnceWith(f.client,projectId,who,seams.requalify.mock.calls[0][3]);
    expect(seams.requalify.mock.invocationCallOrder[0]).toBeLessThan(seams.recover.mock.invocationCallOrder[0]);
    expect(seams.recover.mock.invocationCallOrder[0]).toBeLessThan(seams.collect.mock.invocationCallOrder[0]);
    expect(result.registryRevision).toBe('9');
  });
  it('strictly accepts automatic pair authority outside mathematical options without upgrading old requests',()=>{
    const legacy={expectedRegistryRevision:'7',cableIds:[cableId],options};
    expect(createJobSchema.parse(legacy)).toEqual(legacy);
    expect(createJobSchema.parse({...legacy,automaticPairPolicy})).toEqual({...legacy,automaticPairPolicy});
    for(const invalid of [null,{}, {...automaticPairPolicy,extra:true}, {...automaticPairPolicy,mode:'always'}])
      expect(createJobSchema.safeParse({...legacy,automaticPairPolicy:invalid}).success).toBe(false);
    expect(createJobSchema.safeParse({...legacy,options:{...options,automaticPairPolicy}}).success).toBe(false);
  });
  it('reserves submission IDs for forced calculations with automatic output and a valid optional cable scope',()=>{
    const input={expectedRegistryRevision:'7',options,automaticPairPolicy,force:true,submissionId:id(41)};
    expect(createJobSchema.parse(input)).toEqual(input);
    expect(createJobSchema.parse({...input,cableIds:[cableId,id(20)]})).toEqual({...input,cableIds:[cableId,id(20)]});
    for(const invalid of [{...input,cableIds:[]},{...input,cableIds:[cableId,cableId.toUpperCase()]},{...input,force:false},
      {...input,automaticPairPolicy:undefined},{...input,submissionId:'not-a-uuid'}])
      expect(createJobSchema.safeParse(invalid).success).toBe(false);
  });
  it('admits only the selected cables and replays the same scope without repeating matching or writes',async()=>{
    const f=fixture(),submissionId=id(41),cableIds=[cableId,id(20)];
    const input=createJobSchema.parse({expectedRegistryRevision:'7',options,automaticPairPolicy,force:true,submissionId,cableIds});
    const collect=seams.collect.getMockImplementation()!;
    seams.collect.mockImplementationOnce(async (...args)=>{
      const batch=await collect(...args);
      const item=batch.items[0];
      return {...batch,items:cableIds.map(id=>({...item,id,cable:{...item.cable,id}}))};
    });
    expect(await f.jobs.create(projectId,who,input)).toEqual({jobId:submissionId,duplicate:false,registryRevision:'8'});
    expect(f.match).toHaveBeenCalledExactlyOnceWith(projectId,who,'7',cableIds,f.client,expect.any(Function));
    expect(seams.collect).toHaveBeenCalledExactlyOnceWith(f.client,expect.objectContaining({projectId,cableIds,options}));
    expect(seams.automatic.mock.calls[0][1].source).toEqual({kind:'explicit-job',bulkSubmission:true});
    expect(seams.automatic.mock.calls[0][1].items.map((item:{cableId:string})=>item.cableId)).toEqual(cableIds);
    expect(seams.requalify).toHaveBeenCalledExactlyOnceWith(f.client,projectId,who,expect.any(AbortSignal),{cableIds});
    expect(seams.requalify.mock.invocationCallOrder[0]).toBeLessThan(seams.collect.mock.invocationCallOrder[0]);
    expect(seams.recover).not.toHaveBeenCalled();
    expect(await f.jobs.create(projectId,{...who,loginId:id(42)},input)).toEqual({jobId:submissionId,duplicate:true,registryRevision:'8'});
    await expect(f.jobs.create(projectId,who,{...input,cableIds:[cableId,id(21)]})).rejects.toMatchObject({code:'BULK_SUBMISSION_CONFLICT'});
    expect(f.match).toHaveBeenCalledOnce();
    expect(seams.requalify).toHaveBeenCalledOnce();
    expect(seams.collect).toHaveBeenCalledOnce();
    expect(seams.persist).toHaveBeenCalledOnce();
    expect(seams.automatic).toHaveBeenCalledOnce();
  });
  it.each(['matching','collection'] as const)('confirms no keyed job was submitted if a selected cable is absent during %s',async phase=>{
    const f=fixture(),cableIds=[cableId,id(99)];
    (phase==='matching'?f.match:seams.collect).mockRejectedValue(new PathFinderError('CABLE_NOT_FOUND',404));
    const input=createJobSchema.parse({expectedRegistryRevision:'7',options,automaticPairPolicy,force:true,submissionId:id(41),cableIds});
    await expect(f.jobs.create(projectId,who,input)).rejects.toMatchObject({code:'CABLE_NOT_FOUND',status:409,message:expect.stringContaining('Refresh the filter')});
    expect(f.match).toHaveBeenCalledExactlyOnceWith(projectId,who,'7',cableIds,f.client,expect.any(Function));
    expect(seams.collect).toHaveBeenCalledTimes(phase==='matching'?0:1);
    expect(seams.persist).not.toHaveBeenCalled();
    expect(seams.automatic).not.toHaveBeenCalled();
    expect(f.state.storedBulk).toBeUndefined();
  });
  it('retains the not-found result for an unkeyed popup calculation',async()=>{
    const f=fixture();
    f.match.mockRejectedValue(new PathFinderError('CABLE_NOT_FOUND',404));
    const input=createJobSchema.parse({expectedRegistryRevision:'7',options,automaticPairPolicy,force:true,cableIds:[cableId]});
    await expect(f.jobs.create(projectId,who,input)).rejects.toMatchObject({code:'CABLE_NOT_FOUND',status:404});
    expect(seams.transaction).not.toHaveBeenCalled();
  });
  it('replays the exact whole-project admission after the registry and login session change',async()=>{
    const f=fixture(),submissionId=id(41),input=createJobSchema.parse({expectedRegistryRevision:'7',options,automaticPairPolicy,force:true,submissionId});
    expect(await f.jobs.create(projectId,who,input)).toEqual({jobId:submissionId,duplicate:false,registryRevision:'8'});
    expect(seams.transaction).toHaveBeenCalledOnce();
    expect(seams.transaction.mock.invocationCallOrder[0]).toBeLessThan(f.match.mock.invocationCallOrder[0]);
    expect(f.match).toHaveBeenCalledExactlyOnceWith(projectId,who,'7',undefined,f.client,expect.any(Function));
    expect(seams.collect.mock.calls[0][0]).toBe(f.client);
    f.match.mockRejectedValue(new PathFinderError('REGISTRY_CONFLICT',409));
    const renewed={...who,loginId:id(42)};
    expect(await f.jobs.create(projectId,renewed,input)).toEqual({jobId:submissionId,duplicate:true,registryRevision:'8'});
    expect(f.match).toHaveBeenCalledOnce();
    expect(seams.transaction).toHaveBeenLastCalledWith(expect.anything(),projectId,renewed,expect.any(Function));
    expect(seams.persist).toHaveBeenCalledOnce();
    expect(seams.automatic).toHaveBeenCalledOnce();
    await expect(f.jobs.create(projectId,who,{...input,expectedRegistryRevision:'9'})).rejects.toMatchObject({code:'BULK_SUBMISSION_CONFLICT'});
    await expect(f.jobs.create(projectId,{...who,userId:id(43)},input)).rejects.toMatchObject({code:'BULK_SUBMISSION_CONFLICT'});
  });
  it('observes a concurrently committed job when it acquires the project transaction',async()=>{
    const f=fixture(),submissionId=id(41),input=createJobSchema.parse({expectedRegistryRevision:'7',options,automaticPairPolicy,force:true,submissionId});
    seams.transaction.mockImplementationOnce(async(_pool:unknown,_project:unknown,_principal:unknown,operation:(c:PoolClient)=>Promise<unknown>)=>{
      f.state.storedBulk={id:submissionId,requested_by:who.userId,bulk_submission_sha256:hash(input),registry_revision:'8'};
      return operation(f.client);
    });
    expect(await f.jobs.create(projectId,who,input)).toEqual({jobId:submissionId,duplicate:true,registryRevision:'8'});
    expect(f.match).not.toHaveBeenCalled();
    expect(seams.collect).not.toHaveBeenCalled();
    expect(seams.persist).not.toHaveBeenCalled();
  });
  it('admits a keyed bulk pass when verified endpoint recovery and sealing exceed the old shared deadline',async()=>{
    const f=fixture(),submissionId=id(41),now=vi.spyOn(Date,'now');
    let elapsed=0;
    const started=Date.now();
    now.mockImplementation(()=>started+elapsed);
    try {
      seams.requalify.mockImplementationOnce(async()=>{elapsed=25_000;});
      seams.persist.mockImplementationOnce(async()=>{elapsed=35_000;});
      seams.automatic.mockImplementationOnce(async(_client,_input,check:()=>void)=>{elapsed=55_000;check();});
      const input=createJobSchema.parse({expectedRegistryRevision:'7',options,automaticPairPolicy,force:true,submissionId});
      expect(await f.jobs.create(projectId,who,input)).toEqual({jobId:submissionId,duplicate:false,registryRevision:'8'});
    } finally { now.mockRestore(); }
  });
  it('refuses expired keyed preparation before creating a job',async()=>{
    const f=fixture(),now=vi.spyOn(Date,'now');
    const started=Date.now();
    now.mockReturnValue(started);
    try {
      f.match.mockImplementationOnce(async(_project,_who,_revision,_ids,_client,check:()=>void)=>{
        now.mockReturnValue(started+BULK_CALCULATION_SUBMISSION_LIMITS.admissionMilliseconds+1);
        check();
      });
      const input=createJobSchema.parse({expectedRegistryRevision:'7',options,automaticPairPolicy,force:true,submissionId:id(41)});
      await expect(f.jobs.create(projectId,who,input)).rejects.toMatchObject({code:'RECALCULATION_COLLECTION_DEADLINE',status:503});
      expect(seams.collect).not.toHaveBeenCalled();
      expect(seams.persist).not.toHaveBeenCalled();
    } finally { now.mockRestore(); }
  });
  it('checks the locked job receipt before refusing a stale registry on a keyed retry',async()=>{
    const f=fixture(),submissionId=id(41),input=createJobSchema.parse({expectedRegistryRevision:'7',options,automaticPairPolicy,force:true,submissionId});
    f.match.mockRejectedValueOnce(new PathFinderError('REGISTRY_CONFLICT',409));
    await expect(f.jobs.create(projectId,who,input)).rejects.toMatchObject({code:'REGISTRY_CONFLICT',status:409});
    expect(f.query.mock.calls[0][0]).toContain('bulk-submission:by-id');
    expect(f.query.mock.invocationCallOrder[0]).toBeLessThan(f.match.mock.invocationCallOrder[0]);
    expect(seams.transaction).toHaveBeenCalledOnce();
    expect(seams.collect).not.toHaveBeenCalled();
  });
  it('looks up legacy whole-project jobs for the current project and account',async()=>{
    const f=fixture();
    expect(await f.jobs.legacyBulkSubmission(projectId,who)).toEqual({jobId:null});
    f.state.legacyJobId=id(41);
    expect(await f.jobs.legacyBulkSubmission(projectId,who)).toEqual({jobId:id(41)});
    expect(f.query).toHaveBeenLastCalledWith(expect.stringContaining("m.record#>>'{source,kind}'='explicit-job'"),[projectId,who.userId]);
    expect(f.query).toHaveBeenLastCalledWith(expect.stringContaining('i.cable_id=c.id'),[projectId,who.userId]);
  });
  it('retains the historical request hash and creates no automatic mandate when policy is absent',async()=>{
    const f=fixture();await f.jobs.create(projectId,who,createJobSchema.parse({expectedRegistryRevision:'7',options}));
    const batch=await seams.collect.mock.results[0].value;
    const legacyHash=hash({timeoutMilliseconds:60000,items:batch.items.map((item:any)=>({id:item.id,dependencies:item.dependencies,status:item.status,cableWriteRevision:item.cable.cable_write_revision}))});
    expect(f.query.mock.calls.find(([sql])=>sql.startsWith('INSERT INTO pf_jobs'))?.[1]?.[10]).toBe(legacyHash);
    expect(seams.automatic).not.toHaveBeenCalled();
  });
  it('seals new write authority separately from the exact calculation and appends only sorted ready items after baseline insertion',async()=>{
    const f=fixture(),dependencies={schemaVersion:'pathfinder.dependencies.v8',from:{point:[1,2,3]},to:{point:[4,5,6]}};
    const batch={registryRevision:'8',options,bytes:100,items:[
      {id:id(20),cable:{cable_write_revision:'11'},dependencies,status:'ready'},
      {id:id(21),cable:{cable_write_revision:'12'},dependencies:null,status:'locations_required'},
      {id:cableId,cable:{cable_write_revision:'9'},dependencies,status:'ready'}]};
    seams.collect.mockResolvedValue(batch);
    const result=await f.jobs.create(projectId,who,createJobSchema.parse({expectedRegistryRevision:'7',options,automaticPairPolicy}));
    const calculationSha256=hash({timeoutMilliseconds:60000,items:batch.items.map(item=>({id:item.id,dependencies:item.dependencies,status:item.status,cableWriteRevision:item.cable.cable_write_revision}))});
    const requestSha256=hash({schemaVersion:'wfc.pf.automatic-pair-job-request.v1',automaticPairPolicy,options,calculationSha256});
    expect(f.query.mock.calls.find(([sql])=>sql.startsWith('INSERT INTO pf_jobs'))?.[1]?.[10]).toBe(requestSha256);
    expect(requestSha256).not.toBe(calculationSha256);
    expect(seams.automatic).toHaveBeenCalledExactlyOnceWith(f.client,{projectId,jobId:result.jobId,principal:who,policy:automaticPairPolicy,
      requestSha256,source:{kind:'explicit-job'},items:[{cableId,cableWriteRevision:'9',dependencyHash:hash(dependencies)},
        {cableId:id(20),cableWriteRevision:'11',dependencyHash:hash(dependencies)}]},expect.any(Function));
    expect(seams.automatic.mock.invocationCallOrder[0]).toBeGreaterThan(seams.persist.mock.invocationCallOrder[0]);
    expect(seams.collect.mock.calls[0][1].options).toEqual(options);expect(batch.options).not.toHaveProperty('automaticPairPolicy');
  });
  it('does not renew authority or insert mandates on an exact existing-job replay',async()=>{
    const f=fixture();f.state.duplicate=true;
    expect(await f.jobs.create(projectId,who,createJobSchema.parse({expectedRegistryRevision:'7',options,automaticPairPolicy}))).toMatchObject({jobId:id(40),duplicate:true});
    expect(seams.automatic).not.toHaveBeenCalled();expect(seams.persist).not.toHaveBeenCalled();
    expect(f.query.mock.calls.some(([sql])=>sql.startsWith('INSERT INTO pf_jobs'))).toBe(false);
  });
  it('retains a new all-blocked baseline without inventing ready-item authority',async()=>{
    const f=fixture();seams.collect.mockResolvedValue({registryRevision:'8',options,bytes:100,items:[{id:cableId,cable:{cable_write_revision:'9'},dependencies:null,status:'locations_required'}]});
    await f.jobs.create(projectId,who,createJobSchema.parse({expectedRegistryRevision:'7',options,automaticPairPolicy}));
    expect(seams.persist).toHaveBeenCalledOnce();expect(seams.automatic).not.toHaveBeenCalled();
  });
  it('passes the popup cable ids to matching before admitting its current endpoints',async()=>{
    const f=fixture(),input=createJobSchema.parse({expectedRegistryRevision:'7',cableIds:[cableId],options});
    const result=await f.jobs.create(projectId,who,input);
    expect(f.match).toHaveBeenCalledExactlyOnceWith(projectId,who,'7',[cableId]);
    expect(seams.collect).toHaveBeenCalledExactlyOnceWith(f.client,expect.objectContaining({projectId,cableIds:[cableId],options,dependencyVersion:'pathfinder.dependencies.v8'}));
    expect(f.match.mock.invocationCallOrder[0]).toBeLessThan(seams.collect.mock.invocationCallOrder[0]);
    expect(result).toMatchObject({duplicate:false,registryRevision:'8'});expect(f.query.mock.calls.filter(([sql])=>sql.startsWith('INSERT INTO pf_jobs'))).toHaveLength(1);
    expect(seams.persist).toHaveBeenCalledOnce();
  });
  it('retains the explicit whole-project scope when no ids were supplied',async()=>{
    const f=fixture();await f.jobs.create(projectId,who,createJobSchema.parse({expectedRegistryRevision:'7',options}));
    expect(f.match).toHaveBeenCalledExactlyOnceWith(projectId,who,'7',undefined);
    expect(seams.collect).toHaveBeenCalledWith(f.client,expect.objectContaining({cableIds:undefined}));
  });
  it('does not create a job when preparation for an actually selected endpoint is refused',async()=>{
    const f=fixture();f.match.mockRejectedValue(new PathFinderError('ENDPOINT_PREPARATION_REQUIRED',409));
    await expect(f.jobs.create(projectId,who,createJobSchema.parse({expectedRegistryRevision:'7',cableIds:[cableId],options}))).rejects.toMatchObject({code:'ENDPOINT_PREPARATION_REQUIRED',status:409});
    expect(f.match).toHaveBeenCalledExactlyOnceWith(projectId,who,'7',[cableId]);expect(seams.transaction).not.toHaveBeenCalled();expect(seams.collect).not.toHaveBeenCalled();expect(f.query).not.toHaveBeenCalled();
  });
  it('still fences a registry change between matching and calculation admission',async()=>{
    const f=fixture(),original=f.query.getMockImplementation()!;f.query.mockImplementation(async sql=>sql.startsWith('SELECT registry_revision')?{rows:[{registry_revision:'9'}]}:original(sql));
    await expect(f.jobs.create(projectId,who,createJobSchema.parse({expectedRegistryRevision:'7',cableIds:[cableId],options}))).rejects.toMatchObject({code:'REGISTRY_CONFLICT',status:409});
    expect(seams.collect).not.toHaveBeenCalled();expect(f.query.mock.calls.some(([sql])=>sql.startsWith('INSERT INTO pf_jobs'))).toBe(false);
  });
});
