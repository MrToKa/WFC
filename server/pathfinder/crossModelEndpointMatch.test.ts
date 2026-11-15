import type {ModelLocationMatchAssign} from '../../shared/pathfinderModelLocationMatch.js';
// @vitest-environment node
import {describe,it,expect} from 'vitest';
import {evaluateCrossModelEndpointMatch as evaluate} from './crossModelEndpointMatch.js';
const candidate=(id=1,point:[number,number,number]=[0,0,0]):ModelLocationMatchAssign['scan']['candidates'][number]=>({objectId:id,name:'Equipment',matchedNames:['RIO1'],bounds:{minimum:[point[0],point[1],point[2]] as [number,number,number],maximum:[point[0],point[1],point[2]+1] as [number,number,number]},bottomCentre:point});
const input=()=>({previous:{status:'confirmed' as const,modelVersionId:'old',pointProjectMetres:[0,0,0] as [number,number,number],locationRevision:'1'},locationRevision:'1',currentModelVersionId:'new',logicalName:' rio1 ',candidates:[candidate()]});
describe('cross-model exact identity plus 25cm corroboration',()=>{
 it.each([[0,0,0],[0.25,0,0],[0,0,-0.25],[0.15,0.2,0]])('accepts same/near 3D point %j',(...coordinates)=>{const x=input();x.candidates=[candidate(1,coordinates as [number,number,number])];expect(evaluate(x)).toMatchObject({accepted:true});});
 it.each([[0.25001,0,0],[0.2,0.2,0],[0,0,0.251]])('rejects outside the 3D radius %j',(...coordinates)=>{const x=input();x.candidates=[candidate(1,coordinates as [number,number,number])];expect(evaluate(x)).toMatchObject({accepted:false,reasonCode:'MODEL_LOCATION_CROSS_MODEL_DISTANCE_EXCEEDED'});});
 it('does not accept an arbitrary nearby different tag',()=>{const x=input();x.candidates[0].matchedNames=['RIO2'];expect(evaluate(x)).toMatchObject({accepted:false,reasonCode:'MODEL_LOCATION_CROSS_MODEL_MISSING'});});
 it('does not let proximity break a duplicate identity tie',()=>{const x=input();x.candidates.push(candidate(2,[10,0,0]));expect(evaluate(x)).toMatchObject({accepted:false,reasonCode:'MODEL_LOCATION_CROSS_MODEL_AMBIGUOUS'});});
 it('preserves same-model manual point even when candidate is near',()=>{const x=input();x.currentModelVersionId='old';expect(evaluate(x)).toMatchObject({accepted:false,reasonCode:'MODEL_LOCATION_CROSS_MODEL_NOT_REQUIRED'});});
 it('requires an unchanged confirmed saved logical location',()=>{const x=input();x.locationRevision='2';expect(evaluate(x)).toMatchObject({accepted:false,reasonCode:'MODEL_LOCATION_CROSS_MODEL_SAVED_BINDING_REQUIRED'});});
 it('counts source item fragments as one object',()=>{const x=input(),identity={guid:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sourceFile:'model.nwc'};x.candidates=[{...candidate(1),objectIdentity:identity},{...candidate(2),objectIdentity:identity}];expect(evaluate(x)).toMatchObject({accepted:true});});
 it.each([0,.25])('corroborates a previous centre with the NEW bounds centre at %sm, not its bottom',offset=>{
  const x=input();x.previous.pointProjectMetres=[0,0,.5];x.candidates=[candidate(1,[offset,0,0])];
  expect(evaluate({...x,previous:{...x.previous,derivation:'matched-model-centre-fallback.v1'}})).toMatchObject({accepted:true,distanceMetres:offset});
 });
 it('rejects a centre beyond25cm and keeps duplicate tags ambiguous',()=>{
  const x=input();x.previous.pointProjectMetres=[0,0,.5];x.candidates=[candidate(1,[.250001,0,0])];
  const previous={...x.previous,derivation:'matched-model-centre-fallback.v1' as const};
  expect(evaluate({...x,previous})).toMatchObject({accepted:false,reasonCode:'MODEL_LOCATION_CROSS_MODEL_DISTANCE_EXCEEDED'});
  x.candidates=[candidate(1),candidate(2)];expect(evaluate({...x,previous})).toMatchObject({accepted:false,reasonCode:'MODEL_LOCATION_CROSS_MODEL_AMBIGUOUS'});
 });
});
