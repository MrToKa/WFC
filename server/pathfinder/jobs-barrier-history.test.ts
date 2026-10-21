// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
const mocks=vi.hoisted(()=>({collect:vi.fn(),synthetic:vi.fn(),seal:vi.fn(),scope:vi.fn(),applicability:vi.fn(),identity:vi.fn()}));
vi.mock('./dependencies.js',async original=>({...await original<typeof import('./dependencies.js')>(),collectDependenciesForVersion:mocks.collect,hasSyntheticProof:mocks.synthetic}));
vi.mock('./revisionResultRepository.js',()=>({persistRevisionAdmission:vi.fn(),verifyRevisionResultForProposal:mocks.seal}));
vi.mock('./recalculationRepository.js',()=>({readRecalculationJobAuthority:async()=>({enrolled:false}),pauseRecalculationForJob:vi.fn(),requireEnrollmentAuthority:vi.fn()}));
vi.mock('./routingScope.js',async original=>({...await original<typeof import('./routingScope.js')>(),requireVersionedCalculationScope:mocks.scope}));
vi.mock('./proposalApplicability.js',()=>({readProposalApplicability:mocks.applicability}));
vi.mock('./calculationEngineIdentity.js',()=>({calculationEngineIdentity:mocks.identity}));
import { createPathFinderJobs, proposalDto } from './jobs.js';
import { PathFinderError } from './errors.js';
import { defaultOptions } from './jobContracts.js';
import type { PathFinderRepository } from './repository.js';
import { syntheticBarrierEngineIdentity, syntheticDrillingRuntime } from './calculationFixtures.js';

const id=(n:number)=>`b6390000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const projectId=id(1),proposalId=id(2),cableId=id(3),jobId=id(4),who={userId:id(5),loginId:id(6),loginExpiresAt:Date.parse('2099-01-01T00:00:00Z')};
function row(){
  const barriers=syntheticDrillingRuntime({projectId,modelVersionId:id(8),contentFingerprint:'f'.repeat(64),selectionRevision:'1',captureFrameId:id(9),captureFrameSha256:'d'.repeat(64),coordinateFrame:'canonical-world-metres'});
  const barrierRouting={schemaVersion:'wfc.pf.barrier-admission-intent.v1',scope:barriers.binding.scope,expectedRegistryRevision:'1',expectedSnapshot:null,drillThroughWalls:true};
  return {id:proposalId,project_id:projectId,job_id:jobId,cable_id:cableId,status:'calculated',proposal_hash:'a'.repeat(64),dependency_hash:'b'.repeat(64),job_state:'complete',cancel_requested:false,
    dependencies:{schemaVersion:'pathfinder.dependencies.v8',projectId,cableId,cableWriteRevision:'7',options:{...defaultOptions,barrierRouting},from:{point:[0,0,0]},to:{point:[5,0,0]},engineIdentity:syntheticBarrierEngineIdentity(),barriers},
    result:{schemaVersion:'pathfinder.model.response.v1',requestId:id(7),status:'calculated',message:'Original sealed output.',engineeringAccepted:false,calculationMode:'calculate',
      route:{success:true,message:'',routeText:'/A',routeCodes:['/A'],segmentIds:['dbid:1'],pathPoints:[{x:0,y:0,z:0},{x:5,y:0,z:0}],lengthMeters:5,
        fromDistanceMeters:0,toDistanceMeters:0,fromRequiresSecondary:false,toRequiresSecondary:false,connectionGapCount:0,connectionGapLengthMeters:0},
      design:{lengthBeforePercentageMeters:'10',unroundedLengthMeters:'11',designLengthMeters:'11'},lengthLedger:{schemaVersion:'synthetic-sealed-marker'}},created_at:'2026-10-21T00:00:00Z'};
}
/** Real current-principal transaction flow over mock SQL, no runtime or database. */
function database(options:{admin?:boolean;revoked?:boolean}={}){
  const proposal=row(),release=vi.fn(),query=vi.fn(async(sql:string)=>{
    if(sql.startsWith('SELECT id FROM projects'))return {rows:[{id:projectId}]};
    if(sql.startsWith('SELECT is_admin'))return {rows:[{is_admin:options.admin!==false}]};
    if(sql.startsWith('SELECT user_id,expires_at'))return {rows:[{user_id:who.userId,expires_at:new Date(who.loginExpiresAt),revoked_at:options.revoked?new Date():null}]};
    if(sql.startsWith('SELECT p.*,j.state AS job_state'))return {rows:[proposal]};
    if(sql.startsWith('SELECT * FROM pf_jobs'))return {rows:[{id:jobId,project_id:projectId,kind:'calculate',state:'complete',total:1,completed:1,cancel_requested:false,failure:null,attempts:1,created_at:'2026-10-21T00:00:00Z',updated_at:'2026-10-21T00:00:00Z'}]};
    return {rows:[]};
  });
  const client={query,release} as unknown as PoolClient,pool={connect:async()=>client} as unknown as Pool;
  return {client,pool,query,release,proposal};
}
beforeEach(()=>{
  vi.clearAllMocks();mocks.collect.mockRejectedValue(new PathFinderError('BARRIER_CALCULATION_SCOPE_CHANGED',409));mocks.synthetic.mockResolvedValue(false);
  mocks.seal.mockResolvedValue({revisionResultSha256:'c'.repeat(64),baselineHash:'d'.repeat(64),ledgerHash:'e'.repeat(64)});
  mocks.scope.mockImplementation(()=>undefined);mocks.identity.mockResolvedValue({contentSha256:'f'.repeat(64)});
  // Even otherwise applicable sealed metadata cannot authorize a stale result.
  mocks.applicability.mockResolvedValue({applicable:true,evidence:null});
});
describe('retained v8 proposal history after publication or capture changes',()=>{
  it.each(['BARRIER_CALCULATION_SCOPE_CHANGED','BARRIER_CALCULATION_STORAGE_INVALID','BARRIER_BLOB_INTEGRITY','BARRIER_CURRENT_FRAME_UNAVAILABLE'])('keeps exact sealed output readable but non-applicable for %s',async code=>{
    mocks.collect.mockRejectedValue(new PathFinderError(code,409));const db=database(),before=structuredClone(db.proposal);
    const value=await proposalDto(db.client,db.proposal,true);
    expect(value).toMatchObject({id:proposalId,cableId,stale:true,canApply:false,proposalHash:'a'.repeat(64),revisionResultHash:'c'.repeat(64)});
    expect(value.message).toContain('barrier scope changed or became unavailable');expect(value.message).not.toContain('cable no longer exists');
    expect(value.route?.points).toEqual([[0,0,0],[5,0,0]]);expect(value.design).toEqual(before.result.design);expect(value.lengthLedger).toEqual(before.result.lengthLedger);
    expect(value.dependencies).toBe(db.proposal.dependencies);expect(db.proposal).toEqual(before);
  });
  it('does not let an old v8 proposal break the normal state refresh after a new publication',async()=>{
    const db=database(),state=await createPathFinderJobs(db.pool,{} as PathFinderRepository).state(projectId,who);
    expect(state.jobs).toHaveLength(1);expect(state.proposals[0]).toMatchObject({stale:true,canApply:false});
    expect(db.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');expect(db.release).toHaveBeenCalledExactlyOnceWith(undefined);
  });
  it('keeps missing-cable and unavailable-barrier messages distinct',async()=>{
    mocks.collect.mockRejectedValue(new PathFinderError('CABLE_NOT_FOUND',404));const db=database();
    expect((await proposalDto(db.client,db.proposal,true)).message).toContain('cable no longer exists');
  });
  it.each([
    new PathFinderError('ADMIN_REQUIRED',403),new PathFinderError('LOGIN_REVOKED',401),new PathFinderError('CALCULATION_ENGINE_UNAVAILABLE',503),
    new PathFinderError('ENGINE_IMPLEMENTATION_RESTART_REQUIRED',503),new PathFinderError('BARRIER_BLOB_INTEGRITY',500),
    Object.assign(new Error('Raw missing-file error.'),{code:'ENOENT'}),new TypeError('Invalid projection.'),
  ])('does not hide another currentness/authority/implementation failure %s',async failure=>{
    const db=database();mocks.collect.mockRejectedValue(failure);
    await expect(createPathFinderJobs(db.pool,{} as PathFinderRepository).state(projectId,who)).rejects.toBe(failure);
    expect(mocks.seal).not.toHaveBeenCalled();expect(db.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });
  it.each([{admin:false,code:'ADMIN_REQUIRED'},{revoked:true,code:'LOGIN_REVOKED'}])('retains current-principal checks for $code',async({code,...options})=>{
    const db=database(options);await expect(createPathFinderJobs(db.pool,{} as PathFinderRepository).state(projectId,who)).rejects.toMatchObject({code});
    expect(mocks.collect).not.toHaveBeenCalled();expect(db.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });
  it('does not extend the read fallback to locked human Review',async()=>{
    const db=database();await expect(createPathFinderJobs(db.pool,{} as PathFinderRepository).review(projectId,who,proposalId,'a'.repeat(64)))
      .rejects.toMatchObject({code:'BARRIER_WRITE_PROOF_REQUIRED'});
    expect(db.query.mock.calls.some(([sql])=>sql.startsWith('INSERT INTO pf_reviews'))).toBe(false);expect(db.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });
});
