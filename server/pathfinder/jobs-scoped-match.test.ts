// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import type { PathFinderRepository } from './repository.js';

const seams=vi.hoisted(()=>({collect:vi.fn(),persist:vi.fn(),transaction:vi.fn(),automatic:vi.fn()}));
vi.mock('./dependencyBatch.js',()=>({collectDependencyBatchInTransaction:seams.collect}));
vi.mock('./revisionResultRepository.js',()=>({persistRevisionAdmission:seams.persist,verifyRevisionResultForProposal:vi.fn()}));
vi.mock('./auth.js',async original=>({...await original<typeof import('./auth.js')>(),principalTransaction:seams.transaction}));
vi.mock('./automaticPairMandates.js',()=>({appendAutomaticPairMandatesInTransaction:seams.automatic}));
import {createPathFinderJobs} from './jobs.js';
import {createJobSchema,defaultOptions} from './jobContracts.js';
import {PathFinderError} from './errors.js';
import {hash} from './dependencies.js';

const id=(n:number)=>'b2700000-0000-4000-8000-'+n.toString(16).padStart(12,'0');
const projectId=id(1),cableId=id(2),who={userId:id(3),loginId:id(4),loginExpiresAt:Date.parse('2099-01-01T00:00:00Z')};
const scope={projectId,modelVersionId:id(5),contentFingerprint:'a'.repeat(64),selectionRevision:'2',captureFrameId:id(6),captureFrameSha256:'b'.repeat(64),coordinateFrame:'canonical-world-metres' as const};
const options={...defaultOptions,barrierRouting:{schemaVersion:'wfc.pf.barrier-admission-intent.v1' as const,scope,expectedRegistryRevision:'4',drillThroughWalls:false,
  expectedSnapshot:{snapshotId:id(7),scope,registryRevision:'4',contentSha256:'c'.repeat(64),mode:'explicit-empty' as const}}};
const automaticPairPolicy={schemaVersion:'wfc.pf.automatic-pair-policy.v1' as const,mode:'when-both-empty-or-unchanged-automatic' as const};
function fixture() {
  const state={duplicate:false};
  const match=vi.fn().mockResolvedValue({registryRevision:'8'}),query=vi.fn(async(sql:string,_args:unknown[]=[])=>{
    if(sql.startsWith('SELECT registry_revision'))return {rows:[{registry_revision:'8'}]};
    if(sql.includes('FROM pf_jobs'))return {rows:state.duplicate&&sql.startsWith('SELECT id FROM')?[{id:id(40)}]:[]};
    if(sql.startsWith('INSERT INTO pf_jobs')||sql.startsWith('INSERT INTO pf_job_items'))return {rows:[]};
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
  it('strictly accepts automatic pair authority outside mathematical options without upgrading old requests',()=>{
    const legacy={expectedRegistryRevision:'7',cableIds:[cableId],options};
    expect(createJobSchema.parse(legacy)).toEqual(legacy);
    expect(createJobSchema.parse({...legacy,automaticPairPolicy})).toEqual({...legacy,automaticPairPolicy});
    for(const invalid of [null,{}, {...automaticPairPolicy,extra:true}, {...automaticPairPolicy,mode:'always'}])
      expect(createJobSchema.safeParse({...legacy,automaticPairPolicy:invalid}).success).toBe(false);
    expect(createJobSchema.safeParse({...legacy,options:{...options,automaticPairPolicy}}).success).toBe(false);
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
