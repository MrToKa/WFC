// @vitest-environment node
import {describe,expect,it} from 'vitest';
import {modelLocationMatchFixture} from './modelLocationMatchFixtures.js';
import {createEndpointBindingRepository,endpointBindingHash} from './endpointBindingRepository.js';
import {endpointFixtureId as id} from './endpointBindingFixtures.js';
async function fixture(distance=0){
 const f=await modelLocationMatchFixture();
 const endpoint=createEndpointBindingRepository(f.pool);
 const command={schemaVersion:'wfc.pf.endpoint-binding-write.v1' as const,expectedRegistryRevision:f.state.registry,expectedLocationRevision:null,expectedHeadId:null,expectedSelectionRevision:f.context.current.selectionRevision,modelVersionId:f.context.current.modelVersionId,aggregateId:f.context.current.aggregateId,projectionSha256:f.context.current.projectionSha256,captureFrameId:f.context.current.captureFrameId,idempotencyKey:id(999),reason:'Existing manual old-model endpoint',location:{name:'Equipment',aliases:['Alias']},mode:'fixed-world' as const,pointProjectMetres:[2,3,3+distance] as [number,number,number],derivation:'manual-world-point' as const,provenanceObject:null};
 await endpoint.confirm(f.projectId,f.who,id(950),command);
 const old=f.state.bindings.get(f.state.heads.get(id(950))!)!;old.modelVersionId=id(951);const {contentSha256:_old,...body}=old;old.contentSha256=endpointBindingHash(body);
 return {...f,old};
}
describe('approved new-model From/To migration through real assignment policy',()=>{
 it.each([0,0.25])('updates unique exact name within %s m, retains old revision and updates shared aliases',async distance=>{
  const f=await fixture(distance),old=structuredClone(f.old),ctx=await f.repo.context(f.projectId,f.who);expect(ctx.crossModelNames).toContain('EQUIPMENT');
  const result=await f.repo.assign(f.projectId,f.who,f.command());expect(result.results.some(r=>r.status==='assigned'&&r.locationId===f.old.locationId)).toBe(true);
  const head=f.state.bindings.get(f.state.heads.get(f.old.locationId)!)!;expect(head.modelVersionId).toBe(f.context.current.modelVersionId);expect(head.pointProjectMetres).toEqual([2,3,3]);expect(head.supersedesBindingId).toBe(old.id);expect(f.state.bindings.get(old.id)).toEqual(old);
  expect(f.resolved('Alias')).toBe(f.old.locationId);
 });
 it('retains the exact old binding and diagnostic when movement exceeds 25cm',async()=>{const f=await fixture(0.25001),old=structuredClone(f.old);const result=await f.repo.assign(f.projectId,f.who,f.command());expect(result.results.find(r=>r.name==='EQUIPMENT')).toMatchObject({status:'unavailable',reasonCode:'MODEL_LOCATION_CROSS_MODEL_DISTANCE_EXCEEDED'});expect(f.state.heads.get(old.locationId)).toBe(old.id);expect(f.state.bindings.get(old.id)).toEqual(old);});
 it('retains old binding on duplicate exact-name candidates even when one is nearby',async()=>{const f=await fixture(),command=f.command();command.scan.candidates.push(...command.scan.candidates.map((c,i)=>({...c,objectId:999+i})));const result=await f.repo.assign(f.projectId,f.who,command);expect(result.results.find(r=>r.name==='EQUIPMENT')?.status).toBe('ambiguous');expect(f.state.heads.get(f.old.locationId)).toBe(f.old.id);});
});
