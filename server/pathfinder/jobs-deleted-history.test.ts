// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
const mocks=vi.hoisted(()=>({collect:vi.fn(),synthetic:vi.fn(),seal:vi.fn(),scope:vi.fn(),engineIdentity:vi.fn()}));
vi.mock('./dependencies.js',async original=>({...await original<typeof import('./dependencies.js')>(),collectDependencies:mocks.collect,collectDependenciesForVersion:mocks.collect,hasSyntheticProof:mocks.synthetic}));
vi.mock('./revisionResultRepository.js',()=>({persistRevisionAdmission:vi.fn(),verifyRevisionResultForProposal:mocks.seal}));
vi.mock('./recalculationRepository.js',()=>({readRecalculationJobAuthority:async()=>({enrolled:false}),pauseRecalculationForJob:vi.fn(),requireEnrollmentAuthority:vi.fn()}));
vi.mock('./routingScope.js',async original=>({...await original<typeof import('./routingScope.js')>(),requireVersionedCalculationScope:mocks.scope}));
vi.mock('./calculationEngineIdentity.js',()=>({calculationEngineIdentity:mocks.engineIdentity}));
import { createPathFinderJobs, proposalDto } from './jobs.js';
import { PathFinderError } from './errors.js';
import { defaultOptions } from './jobContracts.js';
import type { PathFinderRepository } from './repository.js';

const id=(n:number)=>'d9100000-0000-4000-8000-'+n.toString(16).padStart(12,'0');
const projectId=id(1),proposalId=id(2),cableId=id(3),jobId=id(4),who={userId:id(5),loginId:id(6),loginExpiresAt:Date.parse('2099-01-01T00:00:00Z')};
function row(){return {id:proposalId,project_id:projectId,job_id:jobId,cable_id:cableId,status:'calculated',proposal_hash:'a'.repeat(64),dependency_hash:'b'.repeat(64),job_state:'complete',cancel_requested:false,
  dependencies:{schemaVersion:'pathfinder.dependencies.v5',projectId,cableId,cableWriteRevision:'7',options:{...defaultOptions},engineVersion:'unchanged-test-version'},
  result:{schemaVersion:'pathfinder.model.response.v1',requestId:id(7),status:'calculated',message:'Original sealed output.',engineeringAccepted:false,calculationMode:'calculate',
    route:{success:true,message:'',routeText:'/A',routeCodes:['/A'],segmentIds:['dbid:1'],pathPoints:[{x:0,y:0,z:0},{x:5,y:0,z:0}],lengthMeters:5,
      fromDistanceMeters:0,toDistanceMeters:0,fromRequiresSecondary:false,toRequiresSecondary:false,connectionGapCount:0,connectionGapLengthMeters:0},
    design:{lengthBeforePercentageMeters:'5',unroundedLengthMeters:'5.5',designLengthMeters:'6'},lengthLedger:{schemaVersion:'synthetic-sealed-marker'}},created_at:'2026-10-19T00:00:00Z'};}
function database(options:{admin?:boolean;revoked?:boolean}={}){
  const proposal=row(),release=vi.fn(),query=vi.fn(async(sql:string)=>{
    if(sql.startsWith('SELECT id FROM projects'))return {rows:[{id:projectId}]};
    if(sql.startsWith('SELECT is_admin'))return {rows:[{is_admin:options.admin!==false}]};
    if(sql.startsWith('SELECT user_id,expires_at'))return {rows:[{user_id:who.userId,expires_at:new Date(who.loginExpiresAt),revoked_at:options.revoked?new Date():null}]};
    if(sql.startsWith('SELECT p.*,j.state AS job_state'))return {rows:[proposal]};
    if(sql.startsWith('SELECT * FROM pf_jobs'))return {rows:[{id:jobId,project_id:projectId,kind:'calculate',state:'complete',total:1,completed:1,cancel_requested:false,failure:null,attempts:1,created_at:'2026-10-19T00:00:00Z',updated_at:'2026-10-19T00:00:00Z'}]};
    return {rows:[]};
  });
  const client={query,release} as unknown as PoolClient,pool={connect:async()=>client} as unknown as Pool;
  return {client,pool,query,release,proposal};
}
beforeEach(()=>{
  vi.clearAllMocks();mocks.collect.mockRejectedValue(new PathFinderError('CABLE_NOT_FOUND',404));mocks.synthetic.mockResolvedValue(false);
  mocks.seal.mockResolvedValue({revisionResultSha256:'c'.repeat(64),baselineHash:'d'.repeat(64),ledgerHash:'e'.repeat(64)});
  mocks.scope.mockImplementation(()=>undefined);mocks.engineIdentity.mockResolvedValue({contentSha256:'f'.repeat(64)});
});

describe('retained proposal reads after live cable deletion',()=>{
  it('preserves the exact sealed output and provenance while refusing Apply in a missing-cable detail',async()=>{
    const db=database(),before=structuredClone(db.proposal),value=await proposalDto(db.client,db.proposal,true);
    expect(value).toMatchObject({id:proposalId,cableId,stale:true,canApply:false,proposalHash:'a'.repeat(64),revisionResultHash:'c'.repeat(64),revisionBaselineHash:'d'.repeat(64)});
    expect(value.message).toContain('cable no longer exists');expect(value.message).toContain('cannot be applied');
    expect(value.route?.points).toEqual([[0,0,0],[5,0,0]]);expect(value.design).toEqual(before.result.design);expect(value.lengthLedger).toEqual(before.result.lengthLedger);
    expect(value.dependencies).toBe(db.proposal.dependencies);expect(value.revisionResult).toEqual(await mocks.seal.mock.results[0].value);
    expect(db.proposal).toEqual(before);expect(mocks.scope).toHaveBeenCalledWith(db.proposal.dependencies);
    expect(mocks.seal).toHaveBeenCalledWith(db.client,{projectId,proposalId,result:db.proposal.result,dependencies:db.proposal.dependencies,proposalHash:db.proposal.proposal_hash});
  });

  it('keeps the normal state endpoint projection available under real current-principal checks',async()=>{
    const db=database(),jobs=createPathFinderJobs(db.pool,{} as PathFinderRepository),state=await jobs.state(projectId,who);
    expect(state.jobs).toHaveLength(1);expect(state.proposals).toHaveLength(1);
    expect(state.proposals[0]).toMatchObject({id:proposalId,stale:true,canApply:false});
    expect(db.query.mock.calls.some(([sql])=>sql==='SELECT is_admin FROM users WHERE id=$1 FOR SHARE')).toBe(true);
    expect(db.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');expect(db.release).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  it('keeps the exact historical proposal detail readable through the normal service',async()=>{
    const db=database(),value=await createPathFinderJobs(db.pool,{} as PathFinderRepository).proposal(projectId,who,proposalId);
    expect(value).toMatchObject({id:proposalId,cableId,stale:true,canApply:false});expect(value.route?.points).toHaveLength(2);
    expect(value.revisionResultHash).toBe('c'.repeat(64));expect(db.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
  });

  it.each([new PathFinderError('CALCULATION_ENGINE_UNAVAILABLE',503),Object.assign(new Error('Not a typed missing-input refusal.'),{code:'CABLE_NOT_FOUND'})])('does not hide another collection failure %s',async failure=>{
    const db=database();mocks.collect.mockRejectedValue(failure);
    await expect(createPathFinderJobs(db.pool,{} as PathFinderRepository).state(projectId,who)).rejects.toBe(failure);
    expect(mocks.seal).not.toHaveBeenCalled();expect(db.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });

  it.each([{admin:false,code:'ADMIN_REQUIRED'},{revoked:true,code:'LOGIN_REVOKED'}])('still refuses current-principal access for $code',async({code,...options})=>{
    const db=database(options);
    await expect(createPathFinderJobs(db.pool,{} as PathFinderRepository).state(projectId,who)).rejects.toMatchObject({code});
    expect(mocks.collect).not.toHaveBeenCalled();expect(mocks.seal).not.toHaveBeenCalled();expect(db.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });

  it('does not apply the read fallback to the independent locked human Review collector',async()=>{
    const db=database();
    await expect(createPathFinderJobs(db.pool,{} as PathFinderRepository).review(projectId,who,proposalId,'a'.repeat(64))).rejects.toMatchObject({code:'CABLE_NOT_FOUND'});
    expect(mocks.collect).toHaveBeenCalledWith(db.client,projectId,cableId,db.proposal.dependencies.options,db.proposal.dependencies.schemaVersion,true);
    expect(db.query.mock.calls.some(([sql])=>sql.startsWith('INSERT INTO pf_reviews'))).toBe(false);expect(db.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });
});
