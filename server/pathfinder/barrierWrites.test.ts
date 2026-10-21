// @vitest-environment node
import { beforeEach,describe,expect,it,vi } from 'vitest';
import type { PoolClient } from 'pg';
const seams=vi.hoisted(()=>({identity:vi.fn(),scope:vi.fn()}));
vi.mock('./calculationEngineIdentity.js',()=>({barrierCalculationEngineIdentity:seams.identity}));
vi.mock('./barrierCalculationScope.js',()=>({collectBarrierCalculationScope:seams.scope}));
import { readBarrierWriteEvidence,requireBarrierWriteEvidence,requireCurrentBarrierWriteScope } from './barrierWrites.js';
import { syntheticBarrierWriteInputs } from './barrierWriteFixtures.js';
import { hash } from './dependencies.js';
import { barrierWriteEvidenceSchema } from '../../shared/pathfinderBarrierWrites.js';
import { createBarrierRuntimePolicy } from '../../shared/pathfinderBarrierRuntime.js';

beforeEach(()=>vi.resetAllMocks());
describe('pure exact protected write evidence',()=>{
  it.each(['clear','bypassed'] as const)('retains the distinct successful %s scope instead of relabeling it',status=>{
    const f=syntheticBarrierWriteInputs();if(f.result.schemaVersion!=='pathfinder.model.response.v3')throw Error('Protected fixture required.');
    const context=f.dependencies.barriers;
    if(status==='clear'){
      context.binding.snapshot!.mode='mesh-set';context.storage!.capture={blobId:f.id(80),sha256:'a'.repeat(64),bytes:1024};
      f.result.barriers.qualification={captureSha256:context.storage!.capture.sha256,pureVerificationSha256:'f'.repeat(64),decompositionSha256:'1'.repeat(64),
        computationalMemberships:[{computationalMeshId:'shell:000000',parentSelectionIds:[f.id(81)],fragmentIds:[11]}]};
      f.result.barriers.proof!.status='clear-selected-scope';f.result.barriers.proof!.checkedSegments=1;f.result.barriers.proof!.reasonCode='REGISTERED_SCOPE_CLEAR';
    }else{
      context.binding.policy=createBarrierRuntimePolicy(true);context.binding.policySha256=hash(context.binding.policy);
      f.dependencies.options.barrierRouting!.drillThroughWalls=true;
      f.result.barriers.proof!.status='bypassed';f.result.barriers.proof!.reasonCode='EXPLICIT_DRILLING_BYPASS';
    }
    f.dependencies.options.barrierRouting!.expectedSnapshot=structuredClone(context.binding.snapshot);
    f.result.barriers.context=structuredClone(context);f.result.barriers.proof!.binding=structuredClone(context.binding);
    f.result.barriers.directSecondary!.binding=structuredClone(context.binding);f.result.barriers.diagnostics.status=status;
    expect(requireBarrierWriteEvidence(f.dependencies,f.result)).toMatchObject({status,drillThroughWalls:status==='bypassed'});
  });
  it('binds every retained owner/result/context/route digest without mutating inputs',()=>{
    const f=syntheticBarrierWriteInputs(),before=structuredClone({dependencies:f.dependencies,result:f.result});
    const evidence=requireBarrierWriteEvidence(f.dependencies,f.result);
    expect(evidence).toMatchObject({projectId:f.dependencies.projectId,cableId:f.dependencies.cableId,dependencySha256:hash(f.dependencies),
      engineResultSha256:hash(f.result),contextSha256:hash(f.dependencies.barriers),status:'no-barriers-declared',drillThroughWalls:false});
    expect(barrierWriteEvidenceSchema.safeParse(evidence).success).toBe(true);
    expect(f.dependencies).toEqual(before.dependencies);expect(f.result).toEqual(before.result);
  });
  it.each(['legacy','preview','unknown-result-field','missing-ledger','changed-ledger','changed-length','changed-route-point','changed-proof','changed-endpoint','changed-context','changed-policy','mv','missing-options','missing-proof'] as const)
    ('refuses %s without gaining write authority',kind=>{
      const f=syntheticBarrierWriteInputs();let dependencies:unknown=f.dependencies,result:unknown=f.result;
      if(kind==='legacy')dependencies=f.legacy;
      if(kind==='preview')f.result.calculationMode='design' as 'calculate';
      if(kind==='unknown-result-field')result={...f.result,unverified:true};
      if(kind==='missing-ledger')delete f.result.lengthLedger;
      if(kind==='changed-ledger')f.result.lengthLedger!.designLengthMeters='8';
      if(kind==='changed-length')f.result.design!.designLengthMeters='8';
      if(kind==='changed-route-point')f.result.route!.pathPoints[1].x=6;
      if(kind==='changed-proof'&&f.result.schemaVersion==='pathfinder.model.response.v3')f.result.barriers.proof!.routeSha256='1'.repeat(64);
      if(kind==='changed-endpoint')f.dependencies.from.point=[2,3,4];
      if(kind==='changed-context')f.dependencies.barriers.binding.registryRevision='2';
      if(kind==='changed-policy')f.dependencies.options.barrierRouting!.drillThroughWalls=true;
      if(kind==='mv')f.dependencies.cableInputs.mto='MV';
      if(kind==='missing-options')dependencies={...f.dependencies,options:null};
      if(kind==='missing-proof'&&f.result.schemaVersion==='pathfinder.model.response.v3')f.result.barriers.proof=null;
      expect(readBarrierWriteEvidence(dependencies,result)).toBeNull();
      expect(()=>requireBarrierWriteEvidence(dependencies,result)).toThrowError(expect.objectContaining({code:'BARRIER_WRITE_PROOF_REQUIRED',status:409}));
    });
  it.each([null,{},[],{schemaVersion:'pathfinder.dependencies.v8'}])('treats incomplete stored input as unverified',dependencies=>{
    expect(readBarrierWriteEvidence(dependencies,{})).toBeNull();
  });
  it('does not accept contradictory receipt labels or injected geometry',()=>{
    const f=syntheticBarrierWriteInputs(),evidence=requireBarrierWriteEvidence(f.dependencies,f.result);
    for(const patch of [{drillThroughWalls:true},{status:'bypassed'},{snapshotId:null},{mesh:[]}])expect(barrierWriteEvidenceSchema.safeParse({...evidence,...patch}).success).toBe(false);
  });
});
describe('transaction-scoped live protected write fence',()=>{
  const client={} as PoolClient;
  it('forces exact v2 identity and current retained barrier bytes on every boundary',async()=>{
    const f=syntheticBarrierWriteInputs();seams.identity.mockResolvedValue(f.dependencies.engineIdentity);seams.scope.mockResolvedValue(f.dependencies.barriers);
    const signal=new AbortController().signal,options={signal,deadline:Date.now()+1000};
    await expect(requireCurrentBarrierWriteScope(client,f.dependencies,options)).resolves.toEqual(f.dependencies.engineIdentity);
    f.dependencies.cableWriteRevision='8'; // own cable write does not change the physical fence
    await expect(requireCurrentBarrierWriteScope(client,f.dependencies,options)).resolves.toEqual(f.dependencies.engineIdentity);
    expect(seams.identity).toHaveBeenCalledTimes(2);expect(seams.identity).toHaveBeenCalledWith({force:true});
    expect(seams.scope).toHaveBeenCalledWith(client,f.dependencies.projectId,f.dependencies.options.barrierRouting,options);
  });
  it.each(['identity','scope'] as const)('rejects changed %s before commit',async kind=>{
    const f=syntheticBarrierWriteInputs();seams.identity.mockResolvedValue(kind==='identity'?{...f.dependencies.engineIdentity,contentSha256:'1'.repeat(64)}:f.dependencies.engineIdentity);
    seams.scope.mockResolvedValue({...f.dependencies.barriers,storage:null});
    await expect(requireCurrentBarrierWriteScope(client,f.dependencies)).rejects.toMatchObject({code:'PROPOSAL_STALE',status:409});
  });
  it('propagates storage failures rather than disguising them as a safe empty publication',async()=>{
    const f=syntheticBarrierWriteInputs(),failure=Error('Synthetic retained-file I/O failure');
    seams.identity.mockResolvedValue(f.dependencies.engineIdentity);seams.scope.mockRejectedValue(failure);
    await expect(requireCurrentBarrierWriteScope(client,f.dependencies)).rejects.toBe(failure);
  });
  it('honors cancellation before identity work and after retained-scope reads',async()=>{
    const f=syntheticBarrierWriteInputs(),cancel=new AbortController();cancel.abort();
    await expect(requireCurrentBarrierWriteScope(client,f.dependencies,{signal:cancel.signal})).rejects.toBeDefined();expect(seams.identity).not.toHaveBeenCalled();
    const after=new AbortController();seams.identity.mockResolvedValue(f.dependencies.engineIdentity);seams.scope.mockImplementation(async()=>{after.abort();return f.dependencies.barriers;});
    await expect(requireCurrentBarrierWriteScope(client,f.dependencies,{signal:after.signal})).rejects.toBeDefined();
  });
});
