// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {PoolClient} from 'pg';
import {endpointBindingFixture,endpointFixtureId as id} from './endpointBindingFixtures.js';
import {endpointBindingHash,readEndpointBindingHeads,readEndpointBindingScope} from './endpointBindingRepository.js';
const proof=vi.hoisted(()=>({read:vi.fn()}));
vi.mock('./revisionComparisonEvidenceReader.js',()=>({readConfirmedRevisionBindingValidity:proof.read,createConfirmedRevisionBindingValidator:()=>proof.read}));
beforeEach(()=>{vi.clearAllMocks();proof.read.mockResolvedValue({valid:false,code:'ENDPOINT_MIGRATION_FRAME_STALE'});});
async function fixture(migrated=true){const f=endpointBindingFixture(),first=await f.repo.confirm(f.f.aggregate.projectId,f.who,f.locationId,f.command());
 const draft={...first.binding,sourceDecisionId:migrated?id(990):null},{contentSha256:_sha,...body}=draft,binding={...draft,contentSha256:endpointBindingHash(body)};f.state.bindings.set(binding.id,binding);
 return{...f,binding,input:{projectId:binding.projectId,locationId:binding.locationId,modelVersionId:binding.modelVersionId,aggregateId:binding.aggregateId,projectionSha256:binding.projectionSha256,captureFrameId:binding.captureFrameId}};
}
describe('confirmed migration current-basis gate in every endpoint consumer',()=>{
 it('does not wrap an obsolete migrated point in fresh calculation provenance',async()=>{const f=await fixture();expect(await readEndpointBindingScope(f.client as unknown as PoolClient,f.input)).toEqual({status:'stale',code:'ENDPOINT_MIGRATION_FRAME_STALE'});expect(proof.read).toHaveBeenCalledWith(f.client,f.binding);});
 it('shows the same stale state in context, bounded list and matching heads',async()=>{const f=await fixture();
  expect((await f.repo.context(f.binding.projectId,f.who,f.locationId)).readiness).toEqual({status:'stale',calculationReady:false,reasonCodes:['ENDPOINT_MIGRATION_FRAME_STALE']});
  expect((await f.repo.list(f.binding.projectId,f.who)).locations[0].readiness.calculationReady).toBe(false);
  expect((await readEndpointBindingHeads(f.client as unknown as PoolClient,f.binding.projectId)).get(f.locationId)?.ready).toBe(false);
 });
 it('accepts an unchanged live basis without rewriting immutable point or migration receipt',async()=>{const f=await fixture(),before=JSON.stringify(f.binding);proof.read.mockResolvedValue({valid:true,code:'ENDPOINT_MIGRATION_BASIS_CURRENT'});
  expect((await readEndpointBindingScope(f.client as unknown as PoolClient,f.input)).status).toBe('confirmed');expect((await f.repo.context(f.binding.projectId,f.who,f.locationId)).readiness.calculationReady).toBe(true);expect(JSON.stringify(f.state.bindings.get(f.binding.id))).toBe(before);
 });
 it('ordinary explicit current-frame confirmations need no cross-revision migration evidence',async()=>{const f=await fixture(false);expect((await readEndpointBindingScope(f.client as unknown as PoolClient,f.input)).status).toBe('confirmed');expect((await f.repo.context(f.binding.projectId,f.who,f.locationId)).readiness.calculationReady).toBe(true);expect(proof.read).not.toHaveBeenCalled();});
});
