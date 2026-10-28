// @vitest-environment node
import {createHash} from 'node:crypto';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {PoolClient} from 'pg';
import type {PreparationPlan,PreparationSession} from '../../shared/pathfinderPreparation.js';
const state=vi.hoisted(()=>({cache:Buffer.alloc(0),projection:Buffer.alloc(0),active:0,maximum:0,order:[] as string[]}));
async function read(kind:string,bytes:Buffer){state.order.push(kind);state.active++;state.maximum=Math.max(state.maximum,state.active);await Promise.resolve();state.active--;return Buffer.from(bytes);}
vi.mock('./storage.js',async original=>({...await original<typeof import('./storage.js')>(),readSnapshot:()=>read('cache',state.cache)}));
vi.mock('./preparationStorage.js',async original=>({...await original<typeof import('./preparationStorage.js')>(),readPreparationBlob:(_p:string,_s:string,ref:{payloadRef:string})=>read(ref.payloadRef.endsWith('12')?'trace':'projection',ref.payloadRef.endsWith('12')?Buffer.from('{}'):state.projection)}));
vi.mock('./repository.js',()=>({bumpRegistry:vi.fn(async()=>'2')}));
import {createPreparationPublisher} from './preparationPublisher.js';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture(){
  const plan={id:id(1),projectId:id(2),modelVersionId:id(3),contentFingerprint:'a'.repeat(64),catalogRevision:'1',routingContentSha256:'b'.repeat(64),routingPolicyRevision:'1',routingPolicySha256:'c'.repeat(64)} as PreparationPlan;
  const matrix=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
  const snapshot={schemaVersion:'pathfinder.model.snapshot.v1',model:{projectId:plan.projectId,modelVersionId:plan.modelVersionId,contentSha256:plan.contentFingerprint},capture:{adapterVersion:'synthetic-test',sourceKind:'synthetic',inventoryComplete:false,geometryComplete:false,unitsVerified:false,transformsVerified:false,planningVisibilityKnown:false,sourceLinkVerified:false,evidenceSha256:[]},coordinates:{vertexFrame:'canonical-world-metres',sourceUnits:'m',metresPerSourceUnit:1,sourceToWorldMetres:matrix,displayToWorldMetres:matrix,globalOffsetMetres:[0,0,0]},objects:[{id:' dbid:1 ',dbId:1,parentId:null,name:'STRAIGHT',geometryRole:'routing-leaf',leafToRootNames:['STRAIGHT'],properties:[],nativeHidden:false,planningExcluded:false,allowedCategories:['LV'],categoryAssignmentSource:'synthetic',routeName:'/B001',shapeName:'STRAIGHT',bounds:{minimum:[0,0,0],maximum:[1,1,0]},fragments:[{id:' fragment:1 ',vertices:[[0,0,0],[1,0,0],[0,1,0]],triangleIndices:[0,1,2],fragmentToWorldMetres:matrix,transformAlreadyApplied:true}]}]};
  state.cache=Buffer.from(JSON.stringify(snapshot));state.projection=Buffer.from(state.cache);
  const digest=createHash('sha256').update(state.cache).digest('hex'),validation={projection:{schemaVersion:'pathfinder.model.snapshot.v1',payloadRef:id(11),sha256:digest,bytes:state.cache.length},traceIndex:{schemaVersion:'wfc.pf.preparation-trace-index.v1',payloadRef:id(12),sha256:'d'.repeat(64),bytes:2},counts:{objects:1,physicalLeaves:1,fragments:1,vertices:3,triangles:1},engineVersion:'test',rulesVersion:'test',diagnostics:[],publicationData:{snapshotId:id(11),sha256:digest,bytes:state.cache.length}};
  const query=vi.fn(async(_sql:string,_parameters?:unknown[])=>({rows:[]})),client={query} as unknown as PoolClient;
  const publish=()=>createPreparationPublisher(vi.fn()).publish(client,{session:{} as PreparationSession,plan,aggregateId:id(13),geometryRevision:'1',validation,principal:{userId:id(14),loginId:id(15),loginExpiresAt:Date.now()+60000}});
  return{publish,query,snapshot};
}
beforeEach(()=>{state.active=0;state.maximum=0;state.order=[];});
describe('bounded final publication verification',()=>{
  it('verifies all immutable representations sequentially, retains strict normalization and writes the same model projection',async()=>{
    const f=fixture();await expect(f.publish()).resolves.toEqual({artifactId:id(11),registryRevision:'2'});
    expect(state.order).toEqual(['trace','cache','projection']);expect(state.maximum).toBe(1);
    const row=JSON.parse(String(f.query.mock.calls.find(call=>call[0].includes('jsonb_to_recordset'))?.[1]?.[2]));
    expect(row[0].object_id).toBe('dbid:1');expect(row[0].anchor).toEqual([0.5,0.5,0]);
  });
  it('refuses differing immutable projection bytes before any database write',async()=>{
    const f=fixture();state.projection=Buffer.from('{}');await expect(f.publish()).rejects.toMatchObject({code:'PREPARATION_PROJECTION_INTEGRITY'});expect(f.query).not.toHaveBeenCalled();
  });
  it.each(['unknown-header','unknown-object','nonfinite','wrong-model','duplicate-id'] as const)('retains strict/structure fences for %s before writing',async kind=>{
    const f=fixture(),value=JSON.parse(state.cache.toString());
    if(kind==='unknown-header')value.foreign=true;
    if(kind==='unknown-object')value.objects[0].foreign=true;
    if(kind==='nonfinite')value.objects[0].fragments[0].vertices[0][0]=null;
    if(kind==='wrong-model')value.model.contentSha256='f'.repeat(64);
    if(kind==='duplicate-id')value.objects[0].allowedCategories=['LV','LV'];
    state.cache=Buffer.from(JSON.stringify(value));state.projection=Buffer.from(state.cache);
    await expect(f.publish()).rejects.toBeDefined();expect(f.query).not.toHaveBeenCalled();
  });
});
