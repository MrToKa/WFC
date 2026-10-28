// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { automaticEndpointContentHash, automaticEndpointCalculationPointSchema, hasCurrentEndpointCalculationProvenance, scopedEndpointResolutionSchema, type EndpointCalculationPoint } from './endpointCalculationProvenance.js';
import { requireVersionedCalculationScope } from './routingScope.js';
import { geometryHash } from './dependencies.js';
import { defaultOptions, type CurrentDependencySnapshot, type AutomaticDependencySnapshot, type ScopedDependencySnapshot } from './jobContracts.js';
import { syntheticEngineIdentity } from './calculationFixtures.js';
const id = (n: number) => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const endpoint = (n: number): EndpointCalculationPoint => ({locationId:id(n),locationRevision:'2',bindingRevision:'3',point:[n,2,3],bindingId:id(n+10),
  bindingContentSha256:'a'.repeat(64),mode:'fixed-world',captureFrameId:id(20),qualifiedProjectFrameId:null,aggregateId:id(21),projectionSha256:'b'.repeat(64),sourceObjectRevisionId:null,migrationDecisionId:null});
const value = (): CurrentDependencySnapshot => ({schemaVersion:'pathfinder.dependencies.v5',engineIdentity:syntheticEngineIdentity(),comparison:null,projectId:id(1),cableId:id(2),cableWriteRevision:'1',registryRevision:'4',
  model:{id:id(3),selectionRevision:'2',contentFingerprint:'c'.repeat(64)},artifact:{id:id(4),sha256:'b'.repeat(64)},
  cableInputs:{fromLocation:'=A-01',toLocation:'=B-02',mto:'Instrumentation',cableTypeId:id(5)},
  settings:{revision:'1',connectionGap:'1',secondaryTrayLength:'7',endConnectionLength:'5',additionalBendingPercent:'10'},options:{...defaultOptions},
  routing:{catalogRevision:'1',routingContentSha256:'c'.repeat(64),routingPolicyRevision:'1',routingPolicySha256:'d'.repeat(64)},
  preparation:{aggregateId:id(21),geometryRevision:'2',captureFrameId:id(20),projectionSha256:'b'.repeat(64)},from:endpoint(6),to:endpoint(7),engineVersion:'pathfinder-45c24bf5-pf1-modelrunner-v1'});
const automaticValue = (): AutomaticDependencySnapshot => {
  const source = value(), draft = automaticEndpointCalculationPointSchema.omit({ contentSha256: true }).parse({
    kind: 'automatic-equipment-anchor', locationId: id(6), locationRevision: '2', point: [6, 2, 3],
    modelVersionId: source.model.id, artifactId: source.artifact.id, aggregateId: source.preparation.aggregateId,
    captureFrameId: source.preparation.captureFrameId, projectionSha256: source.artifact.sha256,
    traceId: id(30), traceContentSha256: 'e'.repeat(64), sourceObjectRevisionId: id(31), sourceObjectId: 'dbid:32',
    sourceObjectRecordSha256: 'f'.repeat(64), orderedPlanSha256: 'a'.repeat(64), matchingEvidenceSha256: 'c'.repeat(64),
    matchingPolicyVersion: 'wfc.pf.project-exact-candidates.v2', matchedNames: ['=A-01'],
    derivation: 'equipment-bottom-aabb.v1', approximate: true, engineeringAccepted: false,
  });
  return { ...source, schemaVersion: 'pathfinder.dependencies.v6', from: { ...draft, contentSha256: automaticEndpointContentHash(draft) } };
};
const scopedValue = (automatic=false):ScopedDependencySnapshot => {
  const source=automatic?automaticValue():value(),{registryRevision:_registry,schemaVersion:_version,...body}=source;
  return {...body,schemaVersion:'pathfinder.dependencies.v7',endpointResolution:{schemaVersion:'pathfinder.endpoint-resolution.v1',matchingPolicy:'nfc-trim-uppercase-v1',
    from:{logicalKey:'=A-01',locationId:source.from.locationId},to:{logicalKey:'=B-02',locationId:source.to.locationId}}};
};
describe('versioned endpoint authority in cable calculations', () => {
  it.each([false,true])('admits v7 with exact scoped resolution and confirmed/automatic union (%s)',automatic=>{
    const input=scopedValue(automatic);expect(hasCurrentEndpointCalculationProvenance(input)).toBe(true);expect(()=>requireVersionedCalculationScope(input)).not.toThrow();
    expect(input).not.toHaveProperty('registryRevision');expect(scopedEndpointResolutionSchema.safeParse(input.endpointResolution).success).toBe(true);
  });
  it('admits two automatic scoped endpoints without pretending they are confirmed bindings',()=>{
    const input=scopedValue(true),automatic=automaticValue().from;
    if(!('kind'in automatic))throw Error('Wrong automatic fixture.');
    const {contentSha256:_hash,...body}={...automatic,locationId:id(7),matchedNames:['=B-02']};
    input.to={...body,contentSha256:automaticEndpointContentHash(body)};
    expect(hasCurrentEndpointCalculationProvenance(input)).toBe(true);expect(()=>requireVersionedCalculationScope(input)).not.toThrow();expect(input.to).not.toHaveProperty('bindingId');
  });
  it.each(['missing','unknown-key','wrong-location','changed-alias','wrong-policy','case','empty'] as const)('refuses an unproven v7 endpoint resolution: %s',kind=>{
    const input=scopedValue(),resolution=input.endpointResolution;
    const changed:Record<string,unknown>={...input};
    if(kind==='missing')delete changed.endpointResolution;
    if(kind==='unknown-key')changed.endpointResolution={...resolution,registryRevision:'4'};
    if(kind==='wrong-location')changed.endpointResolution={...resolution,from:{...resolution.from,locationId:id(99)}};
    if(kind==='changed-alias')changed.endpointResolution={...resolution,to:{...resolution.to,logicalKey:'=B-ALIAS'}};
    if(kind==='wrong-policy')changed.endpointResolution={...resolution,matchingPolicy:'case-insensitive-any-name'};
    if(kind==='case')changed.endpointResolution={...resolution,from:{...resolution.from,logicalKey:'=a-01'}};
    if(kind==='empty')changed.endpointResolution={...resolution,from:{...resolution.from,logicalKey:''}};
    expect(hasCurrentEndpointCalculationProvenance(changed)).toBe(false);expect(()=>requireVersionedCalculationScope(changed)).toThrow(/Confirm current shared endpoint bindings/);
  });
  it('does not permit a global registry field or contradictory preparation/artifact in a scoped body',()=>{
    const input=scopedValue();for(const registryRevision of ['4',undefined])expect(hasCurrentEndpointCalculationProvenance({...input,registryRevision})).toBe(false);
    expect(hasCurrentEndpointCalculationProvenance({...input,artifact:{...input.artifact,sha256:'f'.repeat(64)}})).toBe(false);
    expect(hasCurrentEndpointCalculationProvenance({...input,cableInputs:{...input.cableInputs,fromLocation:null}})).toBe(false);
  });
  it('preserves the exact existing NFC-then-uppercase policy when uppercase produces decomposed Unicode',()=>{
    const input=scopedValue();input.cableInputs.fromLocation='ΐ';input.endpointResolution.from.logicalKey='ΐ'.normalize('NFC').trim().toUpperCase();
    expect(input.endpointResolution.from.logicalKey.normalize('NFC')).not.toBe(input.endpointResolution.from.logicalKey);
    expect(hasCurrentEndpointCalculationProvenance(input)).toBe(true);expect(()=>requireVersionedCalculationScope(input)).not.toThrow();
    input.endpointResolution.from.logicalKey=input.endpointResolution.from.logicalKey.normalize('NFC');expect(hasCurrentEndpointCalculationProvenance(input)).toBe(false);
  });
  it('includes v7 comparison, actual implementation and exact endpoint resolution in geometry identity',()=>{
    const input=scopedValue(),allowance={...input,settings:{...input.settings,endConnectionLength:'6'}};
    expect(geometryHash(allowance)).toBe(geometryHash(input));
    expect(geometryHash({...input,endpointResolution:{...input.endpointResolution,from:{...input.endpointResolution.from,logicalKey:'=A-ALIAS'}}})).not.toBe(geometryHash(input));
    expect(geometryHash({...input,engineIdentity:{...input.engineIdentity,derivationSha256:'f'.repeat(64)}})).not.toBe(geometryHash(input));
    expect(geometryHash({...input,comparison:{comparisonId:id(41),comparisonRevision:'1',sourceAggregateId:id(42),targetAggregateId:input.preparation.aggregateId,
      decisionSetSha256:'e'.repeat(64),contentSha256:'f'.repeat(64)}})).not.toBe(geometryHash(input));
  });
  it('keeps v4 comparison evidence historical instead of inventing executable implementation identity',()=>{
    const {engineIdentity:_identity,...old}=value();
    expect(()=>requireVersionedCalculationScope({...old,schemaVersion:'pathfinder.dependencies.v4'})).toThrow(/actual calculation implementation provenance/);
  });
  it('retains historical v3 endpoint evidence for inspection but refuses it for fresh Review/Apply',()=>{
    const historical={...value(),schemaVersion:'pathfinder.dependencies.v3'};
    expect(hasCurrentEndpointCalculationProvenance(historical)).toBe(true);
    expect(()=>requireVersionedCalculationScope(historical)).toThrow(/predates revision comparison provenance/);
  });
  it('requires immutable current endpoint provenance independently of routing permissions', () => {
    expect(hasCurrentEndpointCalculationProvenance(value())).toBe(true);
    expect(() => requireVersionedCalculationScope(value())).not.toThrow();
    const historical = {...value(),schemaVersion:'pathfinder.dependencies.v2'};
    expect(hasCurrentEndpointCalculationProvenance(historical)).toBe(false);
    expect(() => requireVersionedCalculationScope(historical)).toThrow(/Confirm current shared endpoint bindings/);
  });
  it.each(['bindingId','bindingContentSha256','locationRevision','captureFrameId','aggregateId','projectionSha256'] as const)('rejects missing %s even with exact points', key => {
    const input = structuredClone(value()); delete (input.from as Partial<EndpointCalculationPoint>)[key];
    expect(hasCurrentEndpointCalculationProvenance(input)).toBe(false);
  });
  it.each(['captureFrameId','aggregateId','projectionSha256'] as const)('rejects contradictory %s between endpoint and preparation', key => {
    const input = value(); input.from[key] = key === 'projectionSha256' ? 'e'.repeat(64) : id(99);
    expect(hasCurrentEndpointCalculationProvenance(input)).toBe(false);
  });
  it('does not interpret object provenance as a qualified attachment', () => {
    const input = value(); input.from.mode='object-attached'; input.from.sourceObjectRevisionId=id(50);
    expect(hasCurrentEndpointCalculationProvenance(input)).toBe(false);
    input.from.qualifiedProjectFrameId=id(51);
    expect(hasCurrentEndpointCalculationProvenance(input)).toBe(true);
  });
  it('invalidates route reuse for changed binding identity or mode even at unchanged coordinates', () => {
    const old = value(), next=structuredClone(old); next.from.bindingId=id(99);
    expect(geometryHash(next)).not.toBe(geometryHash(old));
    next.from=structuredClone(old.from); next.from.mode='object-derived';
    expect(geometryHash(next)).not.toBe(geometryHash(old));
    next.from=structuredClone(old.from); next.preparation.geometryRevision='3';
    expect(geometryHash(next)).not.toBe(geometryHash(old));
  });
  it('retains geometry across design allowances and drawing metadata only', () => {
    const old=value(),next=structuredClone(old);next.settings.additionalBendingPercent='11';next.settings.endConnectionLength='6';next.cableWriteRevision='2';next.registryRevision='5';
    expect(geometryHash(next)).toBe(geometryHash(old));
    expect(geometryHash({...old,drawingPolicyRevision:'99'} as CurrentDependencySnapshot)).toBe(geometryHash(old));
  });
  it('refuses nonfinite or unknown provenance fields and signed64 overflow', () => {
    expect(hasCurrentEndpointCalculationProvenance({...value(),from:{...endpoint(6),point:[NaN,0,0]}})).toBe(false);
    expect(hasCurrentEndpointCalculationProvenance({...value(),from:{...endpoint(6),legacyArtifactId:null}})).toBe(false);
    expect(hasCurrentEndpointCalculationProvenance({...value(),from:{...endpoint(6),bindingRevision:'9223372036854775808'}})).toBe(false);
  });
  it('admits strict v6 machine provenance without calling its endpoint a confirmed manual binding', () => {
    const input = automaticValue();
    expect(hasCurrentEndpointCalculationProvenance(input)).toBe(true);
    expect(() => requireVersionedCalculationScope(input)).not.toThrow();
    expect(input.from).not.toHaveProperty('confirmedBy'); expect(input.from).not.toHaveProperty('bindingId');
    expect(hasCurrentEndpointCalculationProvenance({ ...input, schemaVersion: 'pathfinder.dependencies.v5' })).toBe(false);
    expect(hasCurrentEndpointCalculationProvenance({ ...value(), schemaVersion: 'pathfinder.dependencies.v6' })).toBe(false);
  });
  it.each(['modelVersionId', 'artifactId', 'aggregateId', 'captureFrameId', 'projectionSha256', 'contentSha256'] as const)(
    'rejects mismatched automatic %s even at identical coordinates', key => {
      const input = automaticValue();
      input.from = { ...input.from, [key]: key.endsWith('Sha256') ? 'd'.repeat(64) : id(99) };
      expect(hasCurrentEndpointCalculationProvenance(input)).toBe(false);
    },
  );
  it('rejects invented human confirmation, nonfinite points and unsupported automatic name identities', () => {
    const input = automaticValue();
    for (const patch of [{ confirmedBy: id(40) }, { engineeringAccepted: true }, { point: [NaN, 0, 0] },
      { matchedNames: ['=a-01'] }, { matchedNames: ['=A-01', '=A-01'] }, { sourceObjectId: 'dbid:9999999999' }])
      expect(hasCurrentEndpointCalculationProvenance({ ...input, from: { ...input.from, ...patch } })).toBe(false);
  });
  it('hashes automatic object and matching evidence while retaining design-only allowance behavior', () => {
    const input = automaticValue(), allowances = { ...input, settings: { ...input.settings, revision: '2', endConnectionLength: '6' } };
    expect(geometryHash(allowances)).toBe(geometryHash(input));
    const changed = { ...input, from: { ...input.from, matchingEvidenceSha256: 'd'.repeat(64) } };
    expect(geometryHash(changed)).not.toBe(geometryHash(input));
    const otherComparison = { ...input, comparison: { comparisonId: id(41), comparisonRevision: '1', sourceAggregateId: id(42),
      targetAggregateId: input.preparation.aggregateId, decisionSetSha256: 'e'.repeat(64), contentSha256: 'f'.repeat(64) } };
    expect(geometryHash(otherComparison)).not.toBe(geometryHash(input));
  });
});
