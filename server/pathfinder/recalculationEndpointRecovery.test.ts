// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {PathFinderError} from './errors.js';
const recovery=vi.hoisted(()=>vi.fn());
vi.mock('./endpointBindingRequalification.js',()=>({requalifyAutomaticEndpointBindingsInTransaction:recovery}));
import {createRecalculationRepository} from './recalculationRepository.js';
import {recalculationFixture,RECALCULATION_FIXTURE as f} from './recalculationFixtures.js';
beforeEach(()=>recovery.mockReset().mockResolvedValue(0));
describe('automatic enrollment same-model endpoint recovery boundary',()=>{
 it('commits recovery without enrolling the superseded generation, then enrolls settled heads exactly once',async()=>{
  const x=recalculationFixture(),r=createRecalculationRepository(x.pool,x.adapter);
  recovery.mockImplementationOnce(async()=>{x.db.state.desired_generation='3';return 2;});
  expect(await r.enrollClaim(x.claim)).toMatchObject({status:'superseded',generation:'2',jobId:null});
  expect(x.adapter.createInTransaction).not.toHaveBeenCalled();expect(x.db.enrollments.size).toBe(0);expect(x.db.state.desired_generation).toBe('3');
  const next={...x.claim,generation:'3'};x.db.claim!.generation='3';
  expect(await r.enrollClaim(next)).toMatchObject({status:'enrolled',generation:'3'});
  expect(x.adapter.createInTransaction).toHaveBeenCalledTimes(1);expect(recovery).toHaveBeenCalledTimes(2);
  expect(await r.enrollClaim(next)).toMatchObject({status:'duplicate'});expect(recovery).toHaveBeenCalledTimes(2);
 });
 it('rolls recovery back when finite output authority expires during proof collection',async()=>{
  const x=recalculationFixture(),now=Date.now(),clock=vi.spyOn(Date,'now').mockReturnValue(now);
  recovery.mockImplementationOnce(async()=>{x.db.state.desired_generation='3';clock.mockReturnValue(now+1800001);return 2;});
  try{await expect(createRecalculationRepository(x.pool,x.adapter).enrollClaim(x.claim)).rejects.toMatchObject({code:'AUTOMATIC_AUTHORITY_EXPIRED'});expect(recovery).toHaveBeenCalledTimes(1);expect(x.adapter.createInTransaction).not.toHaveBeenCalled();expect(x.db.enrollments.size).toBe(0);}finally{clock.mockRestore();}
 });
 it('leaves normal admission available when recovery has no valid saved heads',async()=>{
  const x=recalculationFixture();expect(await createRecalculationRepository(x.pool,x.adapter).enrollClaim(x.claim)).toMatchObject({status:'enrolled'});
  expect(recovery).toHaveBeenCalledWith(x.client,f.projectId,x.who,expect.any(AbortSignal));
 });
 it.each([{paused:true},{enabled:false},{authority_expires_at:new Date(0).toISOString()},{actor_id:f.key},{login_id:f.key}])('cannot recover locations under revoked finite authority %j',async patch=>{
  const x=recalculationFixture();Object.assign(x.db.state,patch);await expect(createRecalculationRepository(x.pool,x.adapter).enrollClaim(x.claim)).rejects.toMatchObject({code:'AUTOMATIC_ENROLLMENT_REVOKED'});expect(recovery).not.toHaveBeenCalled();
 });
 it('does not recover under an obsolete generation or foreign owner',async()=>{
  const x=recalculationFixture();x.db.state.desired_generation='3';expect(await createRecalculationRepository(x.pool,x.adapter).enrollClaim(x.claim)).toMatchObject({status:'superseded'});expect(recovery).not.toHaveBeenCalled();
  x.db.state.desired_generation='2';x.db.claim!.owner_token=f.key;await expect(createRecalculationRepository(x.pool,x.adapter).enrollClaim(x.claim)).rejects.toMatchObject({code:'RECALCULATION_CLAIM_FENCED'});expect(recovery).not.toHaveBeenCalled();
 });
 it('rolls back an unknown recovery error and never submits a partially verified job',async()=>{
  const x=recalculationFixture();recovery.mockImplementationOnce(async()=>{x.db.state.desired_generation='3';throw new PathFinderError('ENDPOINT_HEAD_INTEGRITY',409);});
  await expect(createRecalculationRepository(x.pool,x.adapter).enrollClaim(x.claim)).rejects.toMatchObject({code:'ENDPOINT_HEAD_INTEGRITY'});expect(x.db.state.desired_generation).toBe('2');expect(x.adapter.createInTransaction).not.toHaveBeenCalled();expect(x.db.enrollments.size).toBe(0);
 });
});
