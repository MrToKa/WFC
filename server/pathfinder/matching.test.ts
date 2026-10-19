// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ComputationalSnapshot, LocationDto, SnapshotObject } from './contracts.js';
import { artifactSchema, bindLocationSchema } from './contracts.js';
import { matchLocation, normalizeLocation, objectMatchNames, validateSnapshotStructure } from './matching.js';

const id = '11111111-1111-4111-8111-111111111111';
const matrix = [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
function object(value: Partial<SnapshotObject> = {}): SnapshotObject {
  return {id:'object',name:'=A01',geometryRole:'object',leafToRootNames:['=A01'],properties:[],nativeHidden:false,planningExcluded:false,
    categoryAssignmentSource:'unassigned',allowedCategories:[],bounds:{minimum:[0,0,0],maximum:[2,2,2]},fragments:[],...value};
}
function snapshot(objects: SnapshotObject[]): ComputationalSnapshot {
  return {schemaVersion:'pathfinder.model.snapshot.v1',model:{projectId:id,modelVersionId:id,contentSha256:'a'.repeat(64)},
    capture:{adapterVersion:'test-v1',sourceKind:'synthetic',inventoryComplete:true,geometryComplete:true,unitsVerified:true,transformsVerified:true,planningVisibilityKnown:true,sourceLinkVerified:false,evidenceSha256:[]},
    coordinates:{vertexFrame:'canonical-world-metres',sourceUnits:'metres',metresPerSourceUnit:1,sourceToWorldMetres:matrix,globalOffsetMetres:[0,0,0],displayToWorldMetres:matrix},objects};
}
function location(value: Partial<LocationDto> = {}): LocationDto {
  return {id,name:'=A01',aliases:['Equipment A'],revision:'1',binding:{modelVersionId:id,revision:'1',point:[1,1,0],objectId:'object',externalId:null,source:'manual',status:'confirmed'},...value};
}
describe('PathFinder project location matching',() => {
  it('normalizes Unicode and invariant case without losing engineering punctuation or zeroes',() => {
    expect(normalizeLocation('  =a001-É ')).toBe('=A001-É');
    expect(normalizeLocation('e\u0301')).toBe('É');
    expect(normalizeLocation('=A001')).not.toBe(normalizeLocation('A1'));
  });
  it('reuses the same project identity for From, To and aliases',() => {
    expect(matchLocation(' =a01 ',[location()],true).locationId).toBe(id);
    expect(matchLocation('equipment a',[location()],true).locationId).toBe(id);
  });
  it('does not fuzzy-match missing punctuation',() => expect(matchLocation('A01',[location()],true).status).toBe('missing'));
  it('reports missing rather than a fabricated zero point',() => expect(matchLocation(null,[location()],true)).toEqual({status:'missing',locationId:null,candidates:[]}));
  it('never selects the first of ambiguous aliases',() => expect(matchLocation('=A01',[location(),location({id:'other'})],true).status).toBe('ambiguous'));
  it('requires active-version reconfirmation',() => expect(matchLocation('=A01',[location({binding:{...location().binding!,status:'stale'}})],true).status).toBe('stale'));
  it('does not accept a previous binding without an active model',() => expect(matchLocation('=A01',[location()],false).status).toBe('stale'));
  it('exposes ambiguous object candidates for unresolved locations',() => expect(matchLocation('=A01',[location({binding:null,matching:{status:'ambiguous',candidateObjectIds:['a','b']}})],true)).toMatchObject({status:'ambiguous',candidates:['a','b']}));
  it('recognizes only explicit property labels',() => {
    expect(objectMatchNames(object({properties:[{category:'x',name:'Tag',value:'=B01'},{category:'x',name:'Description',value:'=C01'}]}))).toEqual(['=A01','=B01']);
  });
  it('indexes a single leading slash on model evidence while preserving strict project alias identity',() => {
    expect(objectMatchNames(object({name:' /=a001 ',properties:[{category:'x',name:'Tag',value:'/cafe\u0301'}]}))).toEqual(['/=A001','=A001','/CAF\u00c9','CAF\u00c9']);
    expect(normalizeLocation('/=A001')).toBe('/=A001');
    expect(matchLocation('/=A01',[location()],true).status).toBe('missing');
  });
  it('does not remove repeated/trailing/internal slashes, numeric zeroes or engineering punctuation',() => {
    expect(objectMatchNames(object({name:'//=A001',properties:[{category:'x',name:'Location',value:'=A001/'},{category:'x',name:'Tag',value:'=A001/PART'}]}))).toEqual(['//=A001','=A001/','=A001/PART']);
    expect(objectMatchNames(object({name:'/=A001'}))).not.toContain('A001');
    expect(objectMatchNames(object({name:'/=A001'}))).not.toContain('=A1');
  });
});
describe('PathFinder artifact validation and hierarchy',() => {
  it('uses inherited native visibility, preserving unknown evidence',() => {
    const value = snapshot([object({id:'root',geometryRole:'hierarchy',nativeHidden:null}),object({id:'child',parentId:'root'})]);
    expect(validateSnapshotStructure(value).get('child')).toBe('unknown');
    value.objects[0].nativeHidden = true;
    expect(validateSnapshotStructure(value).get('child')).toBe('hidden');
  });
  it('rejects duplicate version-local identities',() => expect(() => validateSnapshotStructure(snapshot([object(),object()]))).toThrow('DUPLICATE_OBJECT_ID'));
  it('rejects parent cycles',() => expect(() => validateSnapshotStructure(snapshot([object({id:'a',parentId:'b'}),object({id:'b',parentId:'a'})]))).toThrow('INVALID_HIERARCHY'));
  it('rejects over-depth chains even when ordered root first',() => {
    const values = Array.from({length:513},(_,i) => object({id:String(i),parentId:i ? String(i-1) : null,geometryRole:'hierarchy'}));
    expect(() => validateSnapshotStructure(snapshot(values))).toThrow('INVALID_HIERARCHY');
  });
  it('rejects complete inventory with absent parent',() => expect(() => validateSnapshotStructure(snapshot([object({parentId:'absent'})]))).toThrow('MISSING_PARENT'));
  it('does not fit hierarchy as physical routing',() => expect(() => validateSnapshotStructure(snapshot([object({id:'a',geometryRole:'routing-leaf'}),object({id:'b',parentId:'a'})]))).toThrow('ROUTING_LEAF_HAS_CHILD'));
  it('rejects unassigned categories promoted to Control',() => expect(() => validateSnapshotStructure(snapshot([object({allowedCategories:['Control']})]))).toThrow('UNASSIGNED_CATEGORY'));
  it('rejects claimed units without their scale',() => {
    const value = snapshot([object()]); value.coordinates.metresPerSourceUnit = null;
    expect(() => validateSnapshotStructure(value)).toThrow('UNVERIFIED_UNITS');
  });
  it('rejects caller engineering acceptance fields',() => expect(artifactSchema.safeParse({modelVersionId:id,expectedSelectionRevision:'0',expectedRegistryRevision:'0',snapshot:snapshot([object()]),engineeringAccepted:true}).success).toBe(false));
  it('rejects nonfinite manually entered points',() => expect(bindLocationSchema.safeParse({modelVersionId:id,expectedSelectionRevision:'0',expectedRegistryRevision:'0',point:[0,Infinity,0],objectId:null,externalId:null}).success).toBe(false));
  it('rejects rounded numeric concurrency tokens',() => expect(bindLocationSchema.safeParse({modelVersionId:id,expectedSelectionRevision:9007199254740992,expectedRegistryRevision:'0',point:[0,0,0],objectId:null,externalId:null}).success).toBe(false));
});
