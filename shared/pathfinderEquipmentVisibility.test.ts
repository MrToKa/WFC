// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { equipmentEligibilitySchema, endpointVisibilitySchema, preparationPlanHashInput } from './pathfinderPreparation.js';
import { preparationCaptureRequest, validatePreparationPart, mergePreparationParts } from './preparationMerge.js';
import { snapshotSchema } from '../server/pathfinder/contracts.js';
import { geometryTraceFixture } from '../server/pathfinder/geometryTraceFixtures.js';
import { buildGeometryTrace, geometryTraceHash } from '../server/pathfinder/geometryTraceBuilder.js';
import { geometryObjectRevisionSchema } from './pathfinderGeometryTrace.js';

const scope = {schemaVersion:'wfc.pf.sdk-display-visibility.v1' as const,basis:'sdk-display-before-pf-appearance' as const,contentSha256:'a'.repeat(64)};
const proof = {schemaVersion:'wfc.pf.equipment-eligibility.v1' as const,matchingPolicyVersion:'wfc.pf.project-exact-candidates.v3' as const,
  visibilityScopeSha256:scope.contentSha256,visibility:'visible' as const,checkedAncestorCount:1,fragmentStatus:'all-visible' as const,fragmentCount:1};
function currentFixture(){
  const input=geometryTraceFixture();
  // A simulated converted SDK envelope over synthetic coordinates only.
  input.snapshot.capture={...input.snapshot.capture,sourceKind:'converted',adapterVersion:'wfc.protected-selected-capture.v1'};
  input.plan.matchingPolicyVersion='wfc.pf.project-exact-candidates.v3';input.plan.requestedScope.endpointVisibility={...scope};
  const {scopeSha256:_scope,...body}=input.plan.requestedScope;
  input.plan.requestedScope.scopeSha256=geometryTraceHash(body);input.plan.orderedPlanSha256=geometryTraceHash(preparationPlanHashInput(input.plan));
  input.aggregate.orderedPlanSha256=input.plan.orderedPlanSha256;input.aggregate.orderedScopeSha256=input.plan.requestedScope.scopeSha256;
  input.snapshot.objects[2].equipmentEligibility={...proof};return input;
}

describe('separate SDK equipment display eligibility proof',()=>{
  it('preserves exact proof through planned capture, validation, union and hashed historical trace without native proof upgrades',()=>{
    const input=currentFixture(),part=input.plan.partPlan[0],before=structuredClone(input.snapshot);
    expect(preparationCaptureRequest(input.plan,part.partId).preparationSlice?.endpointVisibility).toEqual(scope);
    const snapshot=validatePreparationPart(input.plan,part,input.snapshot);
    const merged=mergePreparationParts(input.plan,[{partId:part.partId,payload:snapshot}]);
    expect(merged.snapshot.objects[2].equipmentEligibility).toEqual(proof);
    expect(merged.snapshot.objects[2].nativeHidden).toBeNull();expect(merged.snapshot.capture.planningVisibilityKnown).toBe(false);
    expect(merged.snapshot.capture.adapterVersion).toBe('wfc.project-preparation-aggregate.v1');expect(snapshotSchema.safeParse(merged.snapshot).success).toBe(true);
    const built=buildGeometryTrace(input),record=built.records[2];
    expect(geometryObjectRevisionSchema.parse(record).historicalModel.equipmentEligibility).toEqual(proof);
    expect(record.coordinates.qualifiedProjectFrame).toBeNull();expect(built.manifest.nativeParity).toBe('not-performed');
    expect(input.snapshot).toEqual(before);
    input.snapshot.objects[2].equipmentEligibility!.fragmentCount=2;
    expect(buildGeometryTrace(input).summaries[2].recordSha256).not.toBe(built.summaries[2].recordSha256);
  });
  it.each(['missing','scope','ancestor-count','forged-geometry-free'] as const)('refuses %s eligibility before part acknowledgement and trace publication',kind=>{
    const input=currentFixture(),object=input.snapshot.objects[2];
    if(kind==='missing')delete object.equipmentEligibility;
    if(kind==='scope')object.equipmentEligibility!.visibilityScopeSha256='b'.repeat(64);
    if(kind==='ancestor-count')object.equipmentEligibility!.checkedAncestorCount=2;
    if(kind==='forged-geometry-free'){object.equipmentEligibility!.fragmentStatus='geometry-free-node-bounds';object.equipmentEligibility!.fragmentCount=0;}
    expect(()=>validatePreparationPart(input.plan,input.plan.partPlan[0],input.snapshot)).toThrowError(expect.objectContaining({code:'PART_ENDPOINT_VISIBILITY_MISMATCH'}));
    expect(()=>buildGeometryTrace(input)).toThrowError(expect.objectContaining({code:'GEOMETRY_TRACE_ENDPOINT_VISIBILITY'}));
  });
  it('never inserts new fields into old captures or immutable trace records',()=>{
    const input=geometryTraceFixture(),request=preparationCaptureRequest(input.plan,input.plan.partPlan[0].partId),built=buildGeometryTrace(input);
    expect(request.preparationSlice).not.toHaveProperty('endpointVisibility');
    expect(snapshotSchema.parse(input.snapshot)).toEqual(input.snapshot);
    expect(built.records[2].historicalModel).not.toHaveProperty('equipmentEligibility');
    input.snapshot.objects[2].equipmentEligibility={...proof};
    expect(()=>validatePreparationPart(input.plan,input.plan.partPlan[0],input.snapshot)).toThrow();
    expect(()=>buildGeometryTrace(input)).toThrow();
  });
  it.each([
    {visibility:'hidden'}, {matchingPolicyVersion:'wfc.pf.project-exact-candidates.v2'}, {checkedAncestorCount:0}, {checkedAncestorCount:513},
    {fragmentCount:-1}, {fragmentStatus:'geometry-free-node-bounds',fragmentCount:1}, {fragmentStatus:'all-visible',fragmentCount:0}, {fragmentStatus:'partial'}, {nativeHidden:false},
  ])('refuses forged or inconsistent eligibility %j',change=>expect(equipmentEligibilitySchema.safeParse({...proof,...change}).success).toBe(false));
  it('allows all-visible fragments only with a positive bounded count and keeps the SDK basis literal',()=>{
    expect(equipmentEligibilitySchema.safeParse({...proof,fragmentStatus:'all-visible',fragmentCount:1_000_000}).success).toBe(true);
    expect(equipmentEligibilitySchema.safeParse({...proof,fragmentStatus:'geometry-free-node-bounds',fragmentCount:0}).success).toBe(true);
    expect(equipmentEligibilitySchema.safeParse({...proof,fragmentStatus:'all-visible',fragmentCount:1_000_001}).success).toBe(false);
    expect(endpointVisibilitySchema.safeParse({...scope,basis:'native-visible'}).success).toBe(false);
  });
  it.each(['role','native-hidden','native-visible','planning-excluded','explicit-null'] as const)('rejects contradictory %s claims in the strict snapshot',kind=>{
    const input=currentFixture(),object=input.snapshot.objects[2];
    if(kind==='role')object.geometryRole='hierarchy';if(kind==='native-hidden')object.nativeHidden=true;if(kind==='native-visible')object.nativeHidden=false;if(kind==='planning-excluded')object.planningExcluded=true;
    if(kind==='explicit-null')Object.assign(object,{equipmentEligibility:null});
    expect(snapshotSchema.safeParse(input.snapshot).success).toBe(false);
  });
  it.each(['inventoryComplete','geometryComplete','unitsVerified','transformsVerified','planningVisibilityKnown','sourceLinkVerified'] as const)('rejects display metadata combined with the %s native/completeness claim',flag=>{
    const input=currentFixture();input.snapshot.capture[flag]=true;expect(snapshotSchema.safeParse(input.snapshot).success).toBe(false);
  });
  it.each(['native','synthetic'] as const)('does not admit %s source with simulated SDK proof',sourceKind=>{
    const input=currentFixture();input.snapshot.capture.sourceKind=sourceKind;expect(snapshotSchema.safeParse(input.snapshot).success).toBe(false);
  });
  it.each(['custom-adapter','wfc.protected-lookup-capture.v1'])('does not attach SDK proof to the %s producer',adapterVersion=>{
    const input=currentFixture();input.snapshot.capture.adapterVersion=adapterVersion;expect(snapshotSchema.safeParse(input.snapshot).success).toBe(false);
  });
});
