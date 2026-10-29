import { describe, expect, it } from 'vitest';
import { endpointMigrationFixture, endpointTestId as id } from './pathfinderEndpointFixtures.js';
import { evaluateEndpointMigration } from './pathfinderEndpointAttachment.js';
import { evaluateEndpointMigrationV2 } from './pathfinderEndpointAttachmentV2.js';
import { endpointMigrationDecisionSchema, endpointMigrationContentHashInput } from './pathfinderEndpointMigration.js';

function record(version: 1 | 2) {
  const fixture=endpointMigrationFixture('fixed-world');
  const scope={comparisonId:id(900),comparisonRevision:'4',sourceAggregateId:fixture.sourceBinding.aggregateId,
    targetAggregateId:fixture.targetAggregate.aggregateId,decisionSetSha256:'a'.repeat(64),contentSha256:'b'.repeat(64)};
  const evaluation=version===1?evaluateEndpointMigration(fixture):evaluateEndpointMigrationV2({...fixture,comparisonScope:scope,sourceBindingFrameQualification:null});
  return {schemaVersion:`wfc.pf.endpoint-migration-decision.v${version}`,id:id(901),projectId:fixture.sourceBinding.projectId,
    locationId:fixture.sourceBinding.locationId,sourceBindingId:fixture.sourceBinding.id,sourceHeadId:fixture.sourceBinding.id,
    expectedLocationRevision:'2',expectedRegistryRevision:'3',target:fixture.targetAggregate,evaluation,
    createdBy:id(902),createdAt:'2026-10-19T06:00:00.000Z',reason:'Synthetic codec boundary control.',contentSha256:'c'.repeat(64)};
}
describe('versioned endpoint migration union',()=>{
  it.each([1,2] as const)('reads immutable v%s without promotion or hash-input loss',version=>{
    const value=record(version),parsed=endpointMigrationDecisionSchema.parse(value);
    expect(parsed).toEqual(value);expect(endpointMigrationContentHashInput(parsed)).toEqual(Object.fromEntries(Object.entries(value).filter(([key])=>key!=='contentSha256')));
  });
  it.each([1,2] as const)('refuses a v%s decision with the other policy evaluation',version=>{
    expect(endpointMigrationDecisionSchema.safeParse({...record(version),evaluation:record(version===1?2:1).evaluation}).success).toBe(false);
  });
  it('requires original source and target pair identity for v2',()=>{
    const value=record(2);
    expect(endpointMigrationDecisionSchema.safeParse({...value,sourceBindingId:id(999)}).success).toBe(false);
    expect(endpointMigrationDecisionSchema.safeParse({...value,target:{...value.target,aggregateId:id(999)}}).success).toBe(false);
    expect(endpointMigrationDecisionSchema.safeParse({...value,engineeringAccepted:true}).success).toBe(false);
  });
});
