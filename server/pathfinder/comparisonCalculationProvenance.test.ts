// @vitest-environment node
import{describe,it,expect}from'vitest';
import{hasCurrentComparisonCalculationProvenance as valid}from'./comparisonCalculationProvenance.js';
const id=(n:number)=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`;
const preparation={aggregateId:id(1),geometryRevision:'4',captureFrameId:id(2),projectionSha256:'a'.repeat(64)};
const scope={comparisonId:id(3),comparisonRevision:'7',sourceAggregateId:id(4),targetAggregateId:id(1),decisionSetSha256:'b'.repeat(64),contentSha256:'c'.repeat(64)};
describe('comparison authority in calculation dependencies',()=>{
 it('distinguishes an explicit not-required scope from an omitted or pending comparison',()=>{expect(valid({schemaVersion:'pathfinder.dependencies.v4',preparation,comparison:null})).toBe(true);expect(valid({schemaVersion:'pathfinder.dependencies.v4',preparation})).toBe(false);expect(valid({schemaVersion:'pathfinder.dependencies.v4',preparation,comparison:undefined})).toBe(false);expect(valid({schemaVersion:'pathfinder.dependencies.v4',preparation,comparison:{readiness:'pending'}})).toBe(false);});
 it('requires exact published target aggregate while keeping historical source distinct',()=>{expect(valid({schemaVersion:'pathfinder.dependencies.v4',preparation,comparison:scope})).toBe(true);expect(valid({schemaVersion:'pathfinder.dependencies.v4',preparation,comparison:{...scope,targetAggregateId:id(9)}})).toBe(false);expect(valid({schemaVersion:'pathfinder.dependencies.v4',preparation,comparison:{...scope,sourceAggregateId:scope.targetAggregateId}})).toBe(false);});
 it.each(['pathfinder.dependencies.v2','pathfinder.dependencies.v3'])('does not promote historical %s to comparison authority',(schemaVersion)=>{expect(valid({schemaVersion,preparation,comparison:null})).toBe(false);});
 it.each(['comparisonId','comparisonRevision','decisionSetSha256','contentSha256'])('rejects absent or malformed %s',(key)=>{const missing={...scope} as Record<string,unknown>;delete missing[key];expect(valid({schemaVersion:'pathfinder.dependencies.v4',preparation,comparison:missing})).toBe(false);expect(valid({schemaVersion:'pathfinder.dependencies.v4',preparation,comparison:{...scope,[key]:'unverified'}})).toBe(false);});
 it('does not accept comparison evidence without a current preparation envelope',()=>{expect(valid({schemaVersion:'pathfinder.dependencies.v4',comparison:scope})).toBe(false);});
});
