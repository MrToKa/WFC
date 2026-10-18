// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { requirePreparedRoutingScope, requireVersionedCalculationScope, routingScopeSchema } from './routingScope.js';
import { geometryHash } from './dependencies.js';
import type { DependencySnapshot } from './jobContracts.js';
import { defaultOptions } from './jobContracts.js';

const {readScope} = vi.hoisted(() => ({readScope:vi.fn()}));
vi.mock('./purposePolicy.js', () => ({readRoutingPolicyScope:readScope}));
const scope = {catalogRevision:'2',routingContentSha256:'a'.repeat(64),routingPolicyRevision:'3',routingPolicySha256:'b'.repeat(64)};
const projectId='11111111-1111-4111-8111-111111111111', artifactId='22222222-2222-4222-8222-222222222222';
const client = (row?: unknown) => ({query:vi.fn(async () => ({rows:row ? [row] : []}))}) as unknown as PoolClient;
describe('catalog-scoped calculation gate', () => {
  it('rejects historical artifacts rather than blessing them with current permissions', async () => {
    readScope.mockResolvedValue(scope);
    await expect(requirePreparedRoutingScope(client(),projectId,artifactId)).rejects.toMatchObject({code:'ROUTING_PREPARATION_REQUIRED'});
  });
  it.each(['catalogRevision','routingContentSha256','routingPolicyRevision','routingPolicySha256'] as const)('rejects changed %s', async key => {
    readScope.mockResolvedValue(scope);
    const changed={...scope,[key]:key.endsWith('Revision') ? '9' : 'f'.repeat(64)};
    await expect(requirePreparedRoutingScope(client({producer_version:'pathfinder.catalog-preparation.v1',routing_scope:changed}),projectId,artifactId)).rejects.toMatchObject({code:'ROUTING_PREPARATION_REQUIRED'});
  });
  it('requires the trusted producer and exact scope, not arbitrary metadata', async () => {
    readScope.mockResolvedValue(scope);
    for (const row of [{producer_version:'client',routing_scope:scope},{producer_version:'pathfinder.catalog-preparation.v1',routing_scope:{...scope,drawingPolicyRevision:'4'}},{producer_version:'pathfinder.catalog-preparation.v1',routing_scope:null}])
      await expect(requirePreparedRoutingScope(client(row),projectId,artifactId)).rejects.toMatchObject({code:'ROUTING_PREPARATION_REQUIRED'});
  });
  it('accepts only the exact immutable producer scope and binds SQL to both identities', async () => {
    readScope.mockResolvedValue(scope);
    const db=client({producer_version:'pathfinder.catalog-preparation.v1',routing_scope:scope});
    await expect(requirePreparedRoutingScope(db,projectId,artifactId)).resolves.toEqual(scope);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('FOR SHARE'),[projectId,artifactId]);
  });
  it('does not admit old queued v1 inputs, missing fields, unknown fields or revision overflow', () => {
    for (const value of [null,{}, {schemaVersion:'pathfinder.dependencies.v1',routing:scope},{schemaVersion:'pathfinder.dependencies.v2'},
      {schemaVersion:'pathfinder.dependencies.v2',routing:{...scope,catalogRevision:'9223372036854775808'}},
      {schemaVersion:'pathfinder.dependencies.v2',routing:{...scope,drawingInputRevision:'1'}}])
      expect(()=>requireVersionedCalculationScope(value)).toThrow();
    expect(()=>requireVersionedCalculationScope({schemaVersion:'pathfinder.dependencies.v2',routing:scope})).not.toThrow();
    expect(routingScopeSchema.safeParse({...scope,routingPolicyRevision:3}).success).toBe(false);
  });
  it('separates routing tokens from drawing/full-source evidence and geometry design allowances', () => {
    const value:DependencySnapshot={schemaVersion:'pathfinder.dependencies.v2',routing:scope,projectId,cableId:artifactId,cableWriteRevision:'1',registryRevision:'1',
      cableInputs:{fromLocation:'A',toLocation:'B',mto:'Control',cableTypeId:artifactId},model:{id:artifactId,selectionRevision:'1',contentFingerprint:'c'.repeat(64)},
      artifact:{id:artifactId,sha256:'d'.repeat(64)},settings:{revision:'1',connectionGap:'1',secondaryTrayLength:'7',endConnectionLength:'5',additionalBendingPercent:'10'},options:defaultOptions,
      from:{locationId:artifactId,bindingRevision:'1',point:[0,0,0]},to:{locationId:artifactId,bindingRevision:'1',point:[1,0,0]},engineVersion:'pathfinder-45c24bf5-pf1-modelrunner-v1'};
    expect(geometryHash({...value,settings:{...value.settings,revision:'4',endConnectionLength:'6'},cableWriteRevision:'9',registryRevision:'9'})).toBe(geometryHash(value));
    expect(geometryHash({...value,routing:{...scope,routingPolicyRevision:'4'}})).not.toBe(geometryHash(value));
    // Unknown server wrapper metadata is not a geometry input; the strict wire
    // scope parser separately rejects it at the admission boundary.
    expect(geometryHash({...value,drawingInputRevision:'8',sourceProjectionSha256:'e'.repeat(64),routing:{...scope,contentSha256:'f'.repeat(64)}} as DependencySnapshot)).toBe(geometryHash(value));
  });
});
