// @vitest-environment node
import { beforeEach,describe,expect,it,vi } from 'vitest';
import type { PoolClient } from 'pg';
const seams=vi.hoisted(()=>({identity:vi.fn(),mixedIdentity:vi.fn(),scope:vi.fn(),state:vi.fn()}));
vi.mock('./calculationEngineIdentity.js',()=>({barrierCalculationEngineIdentity:seams.identity,mixedBarrierCalculationEngineIdentity:seams.mixedIdentity}));
vi.mock('./barrierCalculationScope.js',()=>({collectBarrierCalculationScope:seams.scope,collectBarrierCalculationState:seams.state}));
import { readBarrierWriteEvidence,requireBarrierWriteEvidence,requireCurrentBarrierWriteScope } from './barrierWrites.js';
import { syntheticBarrierWriteInputs } from './barrierWriteFixtures.js';
import { hash } from './dependencies.js';
import { barrierWriteEvidenceSchema } from '../../shared/pathfinderBarrierWrites.js';
import { createBarrierRuntimePolicy } from '../../shared/pathfinderBarrierRuntime.js';
import { MIXED_BARRIER_POLICY,MIXED_BARRIER_COLLISION_VERSION,MIXED_BARRIER_VERIFIER_VERSION,MIXED_BARRIER_RUNTIME_PROFILE,
  MIXED_BARRIER_OPENING_RUNTIME_PROFILE,INTER_TRAY_OPENING_MANEUVER_POLICY,
  createMixedBarrierRuntimePolicy,mixedBarrierEngineIdentitySchema,mixedBarrierExecutionSchema,mixedBarrierOpeningRuntimeProfileSchema,type MixedBarrierVerifierEvidence } from '../../shared/pathfinderBarrierMixed.js';
import { supportedBarrierWriteEvidenceSchema } from '../../shared/pathfinderBarrierSupported.js';
import { engineResponseSchema,type BarrierDependencySnapshot } from './jobContracts.js';

function mixedEmptyInputs(){
  const f=syntheticBarrierWriteInputs();
  if(f.result.schemaVersion!=='pathfinder.model.response.v3'||f.result.barriers.schemaVersion!=='wfc.pf.barrier-execution.v1')throw Error('fixture');
  const old=f.result.barriers,policy=createMixedBarrierRuntimePolicy(false),oldContext=old.context;
  if(!oldContext.binding.snapshot||!old.proof||!old.directSecondary)throw Error('fixture');
  const context={...oldContext,schemaVersion:'wfc.pf.barrier-runtime.v2' as const,binding:{...oldContext.binding,schemaVersion:'wfc.pf.barrier-calculation-binding.v2' as const,
    policy,policySha256:hash(policy),snapshot:{...oldContext.binding.snapshot,schemaVersion:'wfc.pf.barrier-snapshot-reference.v2' as const,geometryPolicy:MIXED_BARRIER_POLICY,mode:'explicit-empty' as const}},
    profile:structuredClone(MIXED_BARRIER_RUNTIME_PROFILE),profileSha256:hash(MIXED_BARRIER_RUNTIME_PROFILE)};
  const {schemaVersion:_directTag,policyVersion:_directPolicy,...direct}=old.directSecondary;
  const execution=mixedBarrierExecutionSchema.parse({...old,schemaVersion:'wfc.pf.barrier-execution.v2',context,
    proof:{...old.proof,schemaVersion:'wfc.pf.barrier-mixed-check-proof.v2',binding:context.binding,domain:'provided-original-triangle-surface-contact-and-independently-qualified-closed-solid-occupancy',
      globalModelCoverageVerified:false,physicalCableRadiusChecked:false,ownTerminalExemptionsSupported:false,authority:'none'},
    directSecondary:{...direct,schemaVersion:'wfc.pf.mixed-constrained-direct-secondary.v2',binding:context.binding},
    qualification:null,ownTerminalExemptionsSupported:false,engineeringAccepted:false,authority:'none'});
  const {contentSha256:_oldHash,...oldIdentity}=f.dependencies.engineIdentity;
  const identity=mixedBarrierEngineIdentitySchema.parse({...oldIdentity,schemaVersion:'wfc.pf.engine-identity.v3',contentSha256:'0'.repeat(64),
    policyVersions:{...oldIdentity.policyVersions,projection:'wfc.pf.model-runner-v3-mixed-barrier-projection.v1',barriers:MIXED_BARRIER_COLLISION_VERSION,
      qualification:MIXED_BARRIER_VERIFIER_VERSION,runtimeProfile:MIXED_BARRIER_RUNTIME_PROFILE.schemaVersion,geometryPolicy:MIXED_BARRIER_POLICY}});
  const {contentSha256:_placeholder,...body}=identity;identity.contentSha256=hash(body);
  const dependencies:BarrierDependencySnapshot={...f.dependencies,engineIdentity:identity,barriers:context,barrierQualification:null,
    options:{...f.dependencies.options,barrierRouting:{schemaVersion:'wfc.pf.barrier-admission-intent.v2',geometryPolicy:MIXED_BARRIER_POLICY,scope:context.binding.scope,
      expectedRegistryRevision:context.binding.registryRevision,expectedSnapshot:context.binding.snapshot,drillThroughWalls:false}}};
  const {calculationMode:_mode,...responseBody}=f.result;
  const result={...engineResponseSchema.parse({...responseBody,barriers:execution}),calculationMode:'calculate' as const};
  return{...f,dependencies,result};
}

function mixedPhysicalInputs(){
  const f=mixedEmptyInputs(),context=f.dependencies.barriers;
  if(context.schemaVersion!=='wfc.pf.barrier-runtime.v2'||!context.binding.snapshot||!context.storage
    ||f.result.schemaVersion!=='pathfinder.model.response.v3'||f.result.barriers.schemaVersion!=='wfc.pf.barrier-execution.v2')throw Error('fixture');
  context.binding.snapshot.mode='mixed-mesh-set';context.storage.capture={blobId:f.id(80),sha256:'a'.repeat(64),bytes:1024};
  const qualification:MixedBarrierVerifierEvidence={captureId:context.storage.intentId,scope:context.binding.scope,
    originalSurfaceComponents:1,qualifiedClosedSolidComponents:0,fragmentCount:1,vertexCount:3,triangleCount:1,
    originalGeometrySha256:'3'.repeat(64),verificationSha256:'4'.repeat(64),numericToleranceMetres:1e-7,
    componentMemberships:[{componentId:'component:000000',kind:'original-surface',fragmentIds:[11],parentSelectionIds:[f.id(81)],triangleCount:1,sourceMembershipSha256:'2'.repeat(64)}],
    inputSchemaVersion:'wfc.pf.barrier-capture.v1',policyVersion:MIXED_BARRIER_POLICY,coverage:'provided-fragments-only',
    geometryProvenance:'capture-bound-provided-original-triangles',sdkCoverageVerified:false,sdkSourceBytesVerified:false,currentFrameVerified:false,
    engineeringAccepted:false,ownTerminalExemptionsSupported:false,authority:'none'};
  // Independently retained expectation and the synthetic response are detached.
  // A production expectation is derived only after protected storage validation.
  f.dependencies.barrierQualification=structuredClone(qualification);
  f.dependencies.options.barrierRouting!.expectedSnapshot=structuredClone(context.binding.snapshot);
  f.result.barriers.context=structuredClone(context);f.result.barriers.proof!.binding=structuredClone(context.binding);
  f.result.barriers.proof!.status='clear-selected-scope';f.result.barriers.proof!.checkedSegments=1;f.result.barriers.proof!.reasonCode='REGISTERED_SCOPE_CLEAR';
  f.result.barriers.directSecondary!.binding=structuredClone(context.binding);f.result.barriers.diagnostics.status='clear';
  f.result.barriers.qualification={captureSha256:context.storage.capture.sha256,evidence:structuredClone(qualification)};
  return f;
}

function openingProfileInputs(){
  const f=mixedPhysicalInputs(),context=f.dependencies.barriers;
  if(context.schemaVersion!=='wfc.pf.barrier-runtime.v2'||f.dependencies.engineIdentity.schemaVersion!=='wfc.pf.engine-identity.v3'
    ||f.result.schemaVersion!=='pathfinder.model.response.v3'||f.result.barriers.schemaVersion!=='wfc.pf.barrier-execution.v2')throw Error('fixture');
  context.profile=mixedBarrierOpeningRuntimeProfileSchema.parse(MIXED_BARRIER_OPENING_RUNTIME_PROFILE);context.profileSha256=hash(context.profile);
  const identity=mixedBarrierEngineIdentitySchema.parse({...f.dependencies.engineIdentity,policyVersions:{...f.dependencies.engineIdentity.policyVersions,
    runtimeProfile:MIXED_BARRIER_OPENING_RUNTIME_PROFILE.schemaVersion,interTrayManeuvers:INTER_TRAY_OPENING_MANEUVER_POLICY}});
  const {contentSha256:_old,...body}=identity;identity.contentSha256=hash(body);f.dependencies.engineIdentity=identity;
  f.result.barriers.context=structuredClone(context);return f;
}

beforeEach(()=>vi.resetAllMocks());
describe('pure exact protected write evidence',()=>{
  it('recognizes the explicit new profile through complete unchanged final geometry and length proof gates',()=>{
    const f=openingProfileInputs(),before=structuredClone({dependencies:f.dependencies,result:f.result});
    expect(requireBarrierWriteEvidence(f.dependencies,f.result)).toMatchObject({schemaVersion:'wfc.pf.barrier-write-evidence.v2',
      status:'clear',profileSha256:hash(MIXED_BARRIER_OPENING_RUNTIME_PROFILE),contextSha256:hash(f.dependencies.barriers)});
    expect({dependencies:f.dependencies,result:f.result}).toEqual(before);
  });
  it.each(['context','identity'] as const)('rejects a valid but mismatched old/new %s without borrowing the other profile authority',side=>{
    const f=openingProfileInputs(),context=f.dependencies.barriers,identity=f.dependencies.engineIdentity;
    if(context.schemaVersion!=='wfc.pf.barrier-runtime.v2'||identity.schemaVersion!=='wfc.pf.engine-identity.v3'
      ||!('interTrayManeuvers' in identity.policyVersions)||f.result.schemaVersion!=='pathfinder.model.response.v3'
      ||f.result.barriers.schemaVersion!=='wfc.pf.barrier-execution.v2')throw Error('fixture');
    if(side==='context'){
      context.profile=structuredClone(MIXED_BARRIER_RUNTIME_PROFILE);context.profileSha256=hash(context.profile);
      f.result.barriers.context=structuredClone(context);
    }else{
      const {interTrayManeuvers:_newPolicy,...oldPolicies}=identity.policyVersions;
      const old=mixedBarrierEngineIdentitySchema.parse({...identity,policyVersions:{...oldPolicies,runtimeProfile:MIXED_BARRIER_RUNTIME_PROFILE.schemaVersion}});
      const {contentSha256:_oldHash,...body}=old;old.contentSha256=hash(body);f.dependencies.engineIdentity=old;
    }
    expect(readBarrierWriteEvidence(f.dependencies,f.result)).toBeNull();
  });
  it('rejects self-rehashed enlarged maneuver bounds at the actual immutable write-proof reader',()=>{
    const f=openingProfileInputs();
    if(f.dependencies.barriers.schemaVersion!=='wfc.pf.barrier-runtime.v2'||f.result.schemaVersion!=='pathfinder.model.response.v3'
      ||f.result.barriers.schemaVersion!=='wfc.pf.barrier-execution.v2')throw Error('fixture');
    const profile={...MIXED_BARRIER_OPENING_RUNTIME_PROFILE,interTrayManeuvers:{...MIXED_BARRIER_OPENING_RUNTIME_PROFILE.interTrayManeuvers,maximumOffsetMetres:0.2}};
    const context={...f.dependencies.barriers,profile,profileSha256:hash(profile)};
    expect(readBarrierWriteEvidence({...f.dependencies,barriers:context},{...f.result,barriers:{...f.result.barriers,context}})).toBeNull();
  });
  it('retains exact independently expected original-surface qualification for a successful physical write proof',()=>{
    const f=mixedPhysicalInputs(),before=structuredClone({dependencies:f.dependencies,result:f.result});
    expect(requireBarrierWriteEvidence(f.dependencies,f.result)).toMatchObject({schemaVersion:'wfc.pf.barrier-write-evidence.v2',status:'clear',geometryPolicy:MIXED_BARRIER_POLICY});
    expect({dependencies:f.dependencies,result:f.result}).toEqual(before);expect(seams.state).not.toHaveBeenCalled();
  });
  it.each(['response-member','response-capture','response-pure-hash','proof-route','missing-qualifier'] as const)
    ('rejects a physical mixed %s alteration without borrowing response authority',field=>{
      const f=mixedPhysicalInputs();
      if(f.result.schemaVersion!=='pathfinder.model.response.v3'||f.result.barriers.schemaVersion!=='wfc.pf.barrier-execution.v2')throw Error('fixture');
      if(field==='response-member')f.result.barriers.qualification!.evidence.componentMemberships[0].sourceMembershipSha256='8'.repeat(64);
      if(field==='response-capture')f.result.barriers.qualification!.captureSha256='8'.repeat(64);
      if(field==='response-pure-hash')f.result.barriers.qualification!.evidence.verificationSha256='8'.repeat(64);
      if(field==='proof-route')f.result.barriers.proof!.routeSha256='8'.repeat(64);
      if(field==='missing-qualifier')f.dependencies.barrierQualification=null;
      expect(readBarrierWriteEvidence(f.dependencies,f.result)).toBeNull();
    });
  it('recognizes mixed evidence through a separate frozen adjunct without filesystem or current-role access',()=>{
    const f=mixedEmptyInputs(),before=structuredClone({dependencies:f.dependencies,result:f.result});
    const evidence=requireBarrierWriteEvidence(f.dependencies,f.result);
    expect(evidence).toMatchObject({schemaVersion:'wfc.pf.barrier-write-evidence.v2',geometryPolicy:MIXED_BARRIER_POLICY,ownTerminalExemptionsSupported:false,status:'no-barriers-declared'});
    expect(supportedBarrierWriteEvidenceSchema.safeParse(evidence).success).toBe(true);expect(barrierWriteEvidenceSchema.safeParse(evidence).success).toBe(false);
    expect({dependencies:f.dependencies,result:f.result}).toEqual(before);expect(seams.scope).not.toHaveBeenCalled();expect(seams.state).not.toHaveBeenCalled();
  });
  it.each(['missing-adjunct','invalid-adjunct','wrong-identity','wrong-context','old-gains-adjunct'] as const)('refuses mixed/legacy %s without inferring new proof',field=>{
    const f=mixedEmptyInputs();let dependencies:unknown=f.dependencies;
    if(field==='missing-adjunct'){const {barrierQualification:_missing,...body}=f.dependencies;dependencies=body;}
    if(field==='invalid-adjunct')dependencies={...f.dependencies,barrierQualification:{fromResponse:true}};
    if(field==='wrong-identity')dependencies={...f.dependencies,engineIdentity:syntheticBarrierWriteInputs().dependencies.engineIdentity};
    if(field==='wrong-context')dependencies={...f.dependencies,barriers:syntheticBarrierWriteInputs().dependencies.barriers};
    if(field==='old-gains-adjunct'){const old=syntheticBarrierWriteInputs();expect(readBarrierWriteEvidence({...old.dependencies,barrierQualification:null},old.result)).toBeNull();return;}
    expect(readBarrierWriteEvidence(dependencies,f.result)).toBeNull();
  });
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
  it('recollects mixed state and its independent qualifier while keeping the old scope/identity lane untouched',async()=>{
    const f=mixedEmptyInputs();seams.mixedIdentity.mockResolvedValue(f.dependencies.engineIdentity);seams.state.mockResolvedValue({context:f.dependencies.barriers,qualification:null});
    await expect(requireCurrentBarrierWriteScope(client,f.dependencies)).resolves.toEqual(f.dependencies.engineIdentity);
    expect(seams.mixedIdentity).toHaveBeenCalledWith({force:true});expect(seams.state).toHaveBeenCalledOnce();expect(seams.identity).not.toHaveBeenCalled();expect(seams.scope).not.toHaveBeenCalled();
  });
  it('refuses a changed independently recollected mixed qualifier without weakening the context hash fence',async()=>{
    const f=mixedEmptyInputs();seams.mixedIdentity.mockResolvedValue(f.dependencies.engineIdentity);
    seams.state.mockResolvedValue({context:f.dependencies.barriers,qualification:{different:true}});
    await expect(requireCurrentBarrierWriteScope(client,f.dependencies)).rejects.toMatchObject({code:'PROPOSAL_STALE',status:409});
  });
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
