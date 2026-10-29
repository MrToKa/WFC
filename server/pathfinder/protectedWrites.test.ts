// @vitest-environment node
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import type { Pool,PoolClient } from 'pg';
const seams=vi.hoisted(()=>({identity:vi.fn(),scope:vi.fn(),collect:vi.fn(),seal:vi.fn(),synthetic:vi.fn(),snapshot:vi.fn(),authority:vi.fn(),applicability:vi.fn(),abandoned:vi.fn()}));
vi.mock('./calculationEngineIdentity.js',()=>({barrierCalculationEngineIdentity:seams.identity}));
vi.mock('./barrierCalculationScope.js',()=>({collectBarrierCalculationScope:seams.scope,readCurrentBarrierAdmissionIntent:vi.fn()}));
vi.mock('./dependencies.js',async original=>({...await original<typeof import('./dependencies.js')>(),collectDependenciesForVersion:seams.collect,hasSyntheticProof:seams.synthetic}));
vi.mock('./revisionResultRepository.js',()=>({verifyRevisionResultForProposal:seams.seal,persistRevisionAdmission:vi.fn()}));
vi.mock('./storage.js',()=>({readSnapshot:seams.snapshot}));
vi.mock('./recalculationRepository.js',()=>({requireEnrollmentAuthority:seams.authority,readRecalculationJobAuthority:async()=>({enrolled:false}),pauseRecalculationForJob:vi.fn()}));
vi.mock('./proposalApplicability.js',()=>({readProposalApplicability:seams.applicability}));
vi.mock('./applyRecovery.js',()=>({readApplyAbandonment:seams.abandoned}));
import { createPathFinderApply } from './apply.js';
import { createPathFinderJobs } from './jobs.js';
import { syntheticBarrierWriteInputs } from './barrierWriteFixtures.js';
import { hash } from './dependencies.js';
import { PathFinderError } from './errors.js';
import type { PathFinderRepository } from './repository.js';

type Row=Record<string,any>;
const now=Date.parse('2026-10-21T16:00:00Z');
beforeEach(()=>{vi.resetAllMocks();vi.useFakeTimers();vi.setSystemTime(now);});
afterEach(()=>vi.useRealTimers());
function fixture(){
  const f=syntheticBarrierWriteInputs(),{dependencies,result,id}=f,projectId=dependencies.projectId,cableId=dependencies.cableId,proposalId=id(30),jobId=id(31);
  const who={userId:id(32),loginId:id(33),loginExpiresAt:now+60000};
  const proposal:Row={id:proposalId,project_id:projectId,cable_id:cableId,job_id:jobId,status:'calculated',job_state:'complete',cancel_requested:false,
    dependency_hash:hash(dependencies),proposal_hash:'c'.repeat(64),dependencies,result};
  const seal={admissionId:id(34),revisionResultSha256:'d'.repeat(64),baselineHash:'e'.repeat(64),engineResultSha256:hash(result),ledgerHash:hash(result.lengthLedger),
    dependencyHash:hash(dependencies),oldModel:null,summary:{newModel:null,reasonCodes:[]},comparisonRef:null,observedEvents:[],physicalChangeProven:false};
  const review:Row={id:id(35),actor_id:who.userId,proposal_id:proposalId,proposal_hash:proposal.proposal_hash,validation_method:'manual-review',
    revision_result_sha256:seal.revisionResultSha256,review_dependency_sha256:proposal.dependency_hash,review_login_id:who.loginId,reviewed_at:new Date(now).toISOString()};
  const input={idempotencyKey:id(36),reviewId:review.id,expectedCableWriteRevision:'7'};
  const state={cable:{routing:'/OLD',design_length:'99',install_length:'123.4500',cable_write_revision:'7',tag:'Synthetic unchanged tag'},
    receipts:[] as Row[],history:[] as Row[],reviews:[] as Row[],admin:true,revoked:false,casMiss:false,failHistory:false,missingHistory:false,failReceipt:false,lostCommit:false,postUpdate:null as ((row:Row)=>void)|null};
  let backup:Pick<typeof state,'cable'|'receipts'|'history'|'reviews'>|null=null;
  const query=vi.fn(async(sql:string,args:any[]=[]):Promise<{rows:Row[]}>=>{
    if(sql==='BEGIN'){backup=structuredClone({cable:state.cable,receipts:state.receipts,history:state.history,reviews:state.reviews});return{rows:[]};}
    if(sql==='ROLLBACK'){if(backup)Object.assign(state,backup);backup=null;return{rows:[]};}
    if(sql==='COMMIT'){backup=null;if(state.lostCommit)throw Error('Synthetic COMMIT acknowledgement lost');return{rows:[]};}
    if(sql.startsWith('SELECT id FROM projects'))return{rows:[{id:projectId}]};
    if(sql.startsWith('SELECT is_admin'))return{rows:[{is_admin:state.admin}]};
    if(sql.startsWith('INSERT INTO viewer_login_bindings')||sql.startsWith('SELECT set_config'))return{rows:[]};
    if(sql.startsWith('SELECT user_id,expires_at'))return{rows:[{user_id:who.userId,expires_at:new Date(who.loginExpiresAt),revoked_at:state.revoked?new Date(now):null}]};
    if(sql.startsWith('SELECT * FROM pf_apply_receipts'))return{rows:state.receipts.filter(r=>r.idempotency_key===args[2]&&r.actor_id===args[1])};
    if(sql.startsWith('SELECT p.*,j.state'))return{rows:[proposal]};
    if(sql.startsWith('SELECT * FROM pf_reviews'))return{rows:[review]};
    if(sql.startsWith('INSERT INTO pf_reviews')){state.reviews.push({id:args[0]});return{rows:[]};}
    if(sql.startsWith('SELECT to_jsonb(c)'))return{rows:[{value:structuredClone(state.cable)}]};
    if(sql.startsWith('UPDATE cables c')){
      if(state.casMiss||state.cable.cable_write_revision!==args[4])return{rows:[]};
      state.cable={...state.cable,routing:args[2],design_length:args[3],cable_write_revision:'8'};state.postUpdate?.(state.cable);return{rows:[{value:structuredClone(state.cable)}]};
    }
    if(sql.startsWith('INSERT INTO cable_versions')){if(state.failHistory)throw Error('Synthetic history failure');if(state.missingHistory)return{rows:[]};state.history.push(structuredClone(state.cable));return{rows:[{id:args[0]}]};}
    if(sql.startsWith('INSERT INTO pf_apply_receipts')){if(state.failReceipt)throw Error('Synthetic receipt failure');const r={id:args[0],project_id:args[1],actor_id:args[2],idempotency_key:args[3],payload_hash:args[4],proposal_id:args[5],cable_id:args[6],before_snapshot:args[7],after_snapshot:args[8],provenance:args[9]};state.receipts.push(r);return{rows:[r]};}
    throw Error('Unexpected synthetic SQL: '+sql.slice(0,120));
  });
  const release=vi.fn(),client={query,release} as unknown as PoolClient,pool={connect:async()=>client} as unknown as Pool;
  seams.identity.mockResolvedValue(dependencies.engineIdentity);seams.scope.mockResolvedValue(dependencies.barriers);seams.collect.mockResolvedValue({dependencies,cable:{cable_write_revision:'7'}});
  seams.seal.mockResolvedValue(seal);seams.applicability.mockResolvedValue({applicable:true,evidence:null});seams.synthetic.mockResolvedValue(false);seams.snapshot.mockResolvedValue({});
  const apply=()=>createPathFinderApply(pool)(projectId,who,proposalId,input);
  const jobs=createPathFinderJobs(pool,{} as PathFinderRepository),confirm=()=>jobs.review(projectId,who,proposalId,proposal.proposal_hash);
  return{...f,projectId,cableId,proposalId,jobId,who,proposal,seal,review,input,state,query,release,client,apply,confirm,jobs};
}
describe('protected human Review and Apply with synthetic transaction transport',()=>{
  it('replaces both existing values atomically, preserving installed length and history',async()=>{
    const f=fixture(),outcome=await f.apply();
    expect(outcome.duplicate).toBe(false);expect(f.state.cable).toEqual({routing:'/A',design_length:'7',install_length:'123.4500',cable_write_revision:'8',tag:'Synthetic unchanged tag'});
    expect(f.state.history).toHaveLength(1);expect(f.state.receipts).toHaveLength(1);
    expect(outcome.receipt.before).toMatchObject({routing:'/OLD',design_length:'99'});
    expect(outcome.receipt.provenance).toMatchObject({schemaVersion:'pathfinder.apply.v3',barrierEvidence:{dependencySha256:hash(f.dependencies),engineResultSha256:hash(f.result),status:'no-barriers-declared'},validationMethod:'manual-review'});
    expect(seams.collect).toHaveBeenCalledExactlyOnceWith(f.client,f.projectId,f.cableId,f.dependencies.options,'pathfinder.dependencies.v8',true,f.dependencies.engineIdentity);
    expect(seams.identity).toHaveBeenCalledTimes(2);expect(seams.scope).toHaveBeenCalledTimes(2);expect(f.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
  });
  it('confirms only the exact protected proposal and rechecks the physical fence before review commit',async()=>{
    const f=fixture(),outcome=await f.confirm();expect(outcome.proposal.canApply).toBe(true);expect(f.state.reviews).toHaveLength(1);
    expect(seams.identity).toHaveBeenCalledTimes(2);expect(seams.scope).toHaveBeenCalledTimes(2);
    expect(f.state.receipts).toHaveLength(0);expect(f.state.history).toHaveLength(0);expect(f.state.cable.routing).toBe('/OLD');
  });
  it('does not turn a missing live cable into a readable-only Review fallback',async()=>{
    const f=fixture();seams.collect.mockRejectedValue(new PathFinderError('CABLE_NOT_FOUND',404));
    await expect(f.confirm()).rejects.toMatchObject({code:'CABLE_NOT_FOUND'});expect(f.state.reviews).toHaveLength(0);
  });
  it.each(['review','apply'] as const)('refuses historical %s without a new write',async action=>{
    const f=fixture();f.proposal.dependencies=f.legacy;
    await expect(action==='review'?f.confirm():f.apply()).rejects.toMatchObject({code:'BARRIER_WRITE_PROOF_REQUIRED'});
    expect(f.state.reviews).toHaveLength(0);expect(f.state.receipts).toHaveLength(0);expect(f.state.cable.design_length).toBe('99');
  });
  it.each(['review','apply'] as const)('rolls back %s after barrier change at final fence',async action=>{
    const f=fixture();seams.scope.mockResolvedValueOnce(f.dependencies.barriers).mockResolvedValueOnce({...f.dependencies.barriers,storage:null});
    await expect(action==='review'?f.confirm():f.apply()).rejects.toMatchObject({code:'PROPOSAL_STALE'});
    expect(f.state.reviews).toHaveLength(0);expect(f.state.history).toHaveLength(0);expect(f.state.receipts).toHaveLength(0);expect(f.state.cable.routing).toBe('/OLD');
  });
  it.each(['identity','expired','authority','history','missing-history','receipt','revision'] as const)('retains old values on %s failure',async kind=>{
    const f=fixture();
    if(kind==='identity')seams.identity.mockResolvedValueOnce(f.dependencies.engineIdentity).mockResolvedValueOnce({...f.dependencies.engineIdentity,contentSha256:'0'.repeat(64)});
    if(kind==='expired')seams.scope.mockResolvedValueOnce(f.dependencies.barriers).mockImplementationOnce(async()=>{vi.setSystemTime(now+60001);return f.dependencies.barriers;});
    if(kind==='authority')seams.authority.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new PathFinderError('LOGIN_REVOKED',401));
    if(kind==='history')f.state.failHistory=true;if(kind==='missing-history')f.state.missingHistory=true;if(kind==='receipt')f.state.failReceipt=true;if(kind==='revision')f.state.casMiss=true;
    await expect(f.apply()).rejects.toBeDefined();expect(f.state.cable.routing).toBe('/OLD');expect(f.state.cable.design_length).toBe('99');expect(f.state.cable.install_length).toBe('123.4500');
    expect(f.state.history).toHaveLength(0);expect(f.state.receipts).toHaveLength(0);expect(f.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });
  it.each(['install_length','routing','design_length','cable_write_revision','tag'] as const)('rolls back a trigger that changes %s unexpectedly',async field=>{
    const f=fixture();f.state.postUpdate=row=>{row[field]=field==='routing'?'/WRONG':'123456';};
    await expect(f.apply()).rejects.toMatchObject({code:'APPLY_WRITE_INTEGRITY'});expect(f.state.cable.routing).toBe('/OLD');expect(f.state.cable.install_length).toBe('123.4500');expect(f.state.receipts).toHaveLength(0);
  });
  it.each(['admin','revoked'] as const)('requires current %s authority before receipt recovery or new write',async kind=>{
    const f=fixture();if(kind==='admin')f.state.admin=false;else f.state.revoked=true;
    await expect(f.apply()).rejects.toMatchObject({code:kind==='admin'?'ADMIN_REQUIRED':'LOGIN_REVOKED'});expect(f.state.receipts).toHaveLength(0);
  });
  it('returns exact committed old receipt before fresh proof checks without authorizing a new old proposal',async()=>{
    const f=fixture();f.proposal.dependencies=f.legacy;
    const old={id:f.id(50),project_id:f.projectId,actor_id:f.who.userId,idempotency_key:f.input.idempotencyKey,payload_hash:hash({proposalId:f.proposalId,...f.input}),proposal_id:f.proposalId,cable_id:f.cableId,
      before_snapshot:{routing:'/OLD'},after_snapshot:{routing:'/SAVED'},provenance:{schemaVersion:'pathfinder.apply.v2'}};
    f.state.receipts.push(old);await expect(f.apply()).resolves.toMatchObject({duplicate:true,receipt:{id:old.id,provenance:old.provenance}});
    expect(seams.identity).not.toHaveBeenCalled();expect(seams.collect).not.toHaveBeenCalled();expect(f.state.cable.routing).toBe('/OLD');
    f.input.expectedCableWriteRevision='8';await expect(f.apply()).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
  });
  it('keeps committed write on lost acknowledgement and reconciles the original command once',async()=>{
    const f=fixture();f.state.lostCommit=true;
    await expect(f.apply()).rejects.toMatchObject({code:'PATHFINDER_COMMIT_OUTCOME_UNKNOWN'});expect(f.state.cable.routing).toBe('/A');expect(f.release).toHaveBeenCalledWith(true);
    f.state.lostCommit=false;seams.scope.mockRejectedValue(Error('Changed old physical scope'));
    await expect(f.apply()).resolves.toMatchObject({duplicate:true});expect(f.state.history).toHaveLength(1);expect(f.state.receipts).toHaveLength(1);
  });
});
