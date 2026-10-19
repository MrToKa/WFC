// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { hasCurrentEndpointCalculationProvenance, type EndpointCalculationPoint } from './endpointCalculationProvenance.js';
import { requireVersionedCalculationScope } from './routingScope.js';
import { geometryHash } from './dependencies.js';
import { defaultOptions, type CurrentDependencySnapshot } from './jobContracts.js';
const id = (n: number) => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const endpoint = (n: number): EndpointCalculationPoint => ({locationId:id(n),locationRevision:'2',bindingRevision:'3',point:[n,2,3],bindingId:id(n+10),
  bindingContentSha256:'a'.repeat(64),mode:'fixed-world',captureFrameId:id(20),qualifiedProjectFrameId:null,aggregateId:id(21),projectionSha256:'b'.repeat(64),sourceObjectRevisionId:null,migrationDecisionId:null});
const value = (): CurrentDependencySnapshot => ({schemaVersion:'pathfinder.dependencies.v3',projectId:id(1),cableId:id(2),cableWriteRevision:'1',registryRevision:'4',
  model:{id:id(3),selectionRevision:'2',contentFingerprint:'c'.repeat(64)},artifact:{id:id(4),sha256:'b'.repeat(64)},
  cableInputs:{fromLocation:'=A-01',toLocation:'=B-02',mto:'Instrumentation',cableTypeId:id(5)},
  settings:{revision:'1',connectionGap:'1',secondaryTrayLength:'7',endConnectionLength:'5',additionalBendingPercent:'10'},options:{...defaultOptions},
  routing:{catalogRevision:'1',routingContentSha256:'c'.repeat(64),routingPolicyRevision:'1',routingPolicySha256:'d'.repeat(64)},
  preparation:{aggregateId:id(21),geometryRevision:'2',captureFrameId:id(20),projectionSha256:'b'.repeat(64)},from:endpoint(6),to:endpoint(7),engineVersion:'pathfinder-45c24bf5-pf1-modelrunner-v1'});
describe('versioned endpoint authority in cable calculations', () => {
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
});
