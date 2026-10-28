// @vitest-environment node
import {beforeEach,describe,it,expect,vi} from 'vitest';
import type {Pool} from 'pg';
import type {EndpointBinding} from '../../shared/pathfinderEndpointBindings.js';
import {createPathFinderRepository} from './repository.js';
import {PathFinderError} from './errors.js';
import {matchLocation} from './matching.js';
import {automaticEndpointContentHash} from './endpointCalculationProvenance.js';
const mock=vi.hoisted(()=>({current:vi.fn(),heads:vi.fn(),automatic:vi.fn()}));
vi.mock('./endpointBindingRepository.js',()=>({readCurrentEndpointBindingContext:mock.current,readEndpointBindingHeads:mock.heads}));
vi.mock('./automaticEndpointCandidates.js',()=>({readAutomaticEndpointCandidates:mock.automatic}));
const id=(n:number)=>`af000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const who={userId:id(50),loginId:id(51),loginExpiresAt:Date.now()+3600000};
const current={modelVersionId:id(2),selectionRevision:'1',contentFingerprint:'a'.repeat(64),aggregateId:id(3),artifactId:id(4),projectionSha256:'b'.repeat(64),captureFrameId:id(5),geometryRevision:'1',traceId:id(6)};
function automaticPoint(locationId:string){const body={kind:'automatic-equipment-anchor' as const,locationId,locationRevision:'1',point:[1,2,3] as[number,number,number],modelVersionId:current.modelVersionId,artifactId:current.artifactId,aggregateId:current.aggregateId,captureFrameId:current.captureFrameId,projectionSha256:current.projectionSha256,traceId:current.traceId,traceContentSha256:'c'.repeat(64),sourceObjectRevisionId:id(7),sourceObjectId:'dbid:9',sourceObjectRecordSha256:'d'.repeat(64),orderedPlanSha256:'e'.repeat(64),matchingEvidenceSha256:'f'.repeat(64),matchingPolicyVersion:'wfc.pf.project-exact-candidates.v2' as const,matchedNames:['EQ01'],derivation:'equipment-bottom-aabb.v1' as const,approximate:true as const,engineeringAccepted:false as const};return{...body,contentSha256:automaticEndpointContentHash(body)};}
function database(options:{admin?:boolean;revoked?:boolean;count?:number;legacy?:boolean;model?:string|null}={}){
  const locationRows=[{id:id(10),name:'EQ01',aliases:['Alias'],revision:'1',...(options.legacy?{model_version_id:id(2),binding_revision:'8',point:[8,7,6],object_id:'old',external_id:null,source:'manual',derivation:'manual-world-point',coordinate_frame:'canonical-world-metres'}:{})},{id:id(11),name:'Unused',aliases:[],revision:'1'}];
  const cables=Array.from({length:options.count??20},(_,n)=>({id:id(100+n),cable_id:String(n),tag:'Tag'+n,from_location:' eq01 ',to_location:n%2?'ALIAS':'EQ01',mto:'Control',routing:'/BC001',design_length:'10',install_length:'20',cable_write_revision:'1'}));
  const query=vi.fn(async(sql:string,args:unknown[]=[])=>{
    if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return{rows:[]};
    if(sql==='SELECT id FROM projects WHERE id=$1 FOR NO KEY UPDATE')return{rows:[{id:id(1)}]};
    if(sql.startsWith('SELECT is_admin'))return{rows:[{is_admin:options.admin!==false}]};
    if(sql.startsWith('INSERT INTO viewer_login_bindings'))return{rows:[]};
    if(sql.startsWith('SELECT user_id,expires_at'))return{rows:[{user_id:who.userId,expires_at:new Date(who.loginExpiresAt),revoked_at:options.revoked?new Date():null}]};
    if(sql.includes('FROM project_model_selections s LEFT JOIN'))return{rows:[{active_model_version_id:options.model===undefined?id(2):options.model,selection_revision:'1',content_fingerprint:'a'.repeat(64),state:'ready',health:'healthy'}]};
    if(sql.startsWith('SELECT p.current_aggregate_id'))return{rows:[]};
    if(sql.startsWith('SELECT * FROM pf_artifacts'))return{rows:[]};
    if(sql.startsWith('SELECT registry_revision::text'))return{rows:[{registry_revision:'1'}]};
    if(sql.startsWith('SELECT pf_settings_revision::text'))return{rows:[{pf_settings_revision:'1',connection_gap:'1',secondary_tray_length:'7',end_connection_length:'5',additional_bending_percent:'10'}]};
    if(sql.startsWith('SELECT id,cable_id,tag,from_location'))return{rows:cables};
    if(sql.startsWith('SELECT l.id,l.name')){expect(args).toEqual([id(1),options.model===undefined?id(2):options.model]);return{rows:locationRows};}
    throw Error('Unexpected state query: '+sql);
  });
  const release=vi.fn(),pool={connect:vi.fn(async()=>({query,release}))} as unknown as Pool;
  return{query,release,locationRows,cables,state:()=>createPathFinderRepository(pool).state(id(1),who)};
}
beforeEach(()=>{
  vi.resetAllMocks();mock.current.mockResolvedValue(current);mock.heads.mockResolvedValue(new Map());mock.automatic.mockImplementation(async(_client,input:{locationIds:string[]})=>new Map(input.locationIds.map(locationId=>[locationId,{status:'automatic-ready',candidateObjectIds:['dbid:9'],point:automaticPoint(locationId)}])));
});

describe('coherent Path Finder state display evaluation',()=>{
  it('reuses current context and heads once and evaluates a repeated From/To location once without business writes',async()=>{
    const db=database({count:1000}),state=await db.state();expect(mock.current).toHaveBeenCalledTimes(1);expect(mock.heads).toHaveBeenCalledExactlyOnceWith(expect.any(Object),id(1),current);expect(mock.automatic).toHaveBeenCalledExactlyOnceWith(expect.any(Object),expect.objectContaining({projectId:id(1),current,locationIds:[id(10)]}));
    expect(state.registryRevision).toBe('1');expect(state.locations[0].binding).toBeNull();expect(state.locations[0].calculationAvailability).toMatchObject({status:'automatic-ready',pointAvailable:true,approximate:true});expect(state.locations[1].calculationAvailability).toMatchObject({status:'not-evaluated',reasonCode:'LOCATION_NOT_IN_CABLE_SCOPE'});
    for(const cable of state.cables){expect(cable.fromMatch).toEqual(matchLocation(cable.fromLocation,state.locations,true));expect(cable.toMatch).toEqual(matchLocation(cable.toLocation,state.locations,true));expect(cable.fromMatch.status).toBe('missing');}
    const mutationSql=db.query.mock.calls.map(([sql])=>sql).filter(sql=>/\b(?:INSERT|UPDATE|DELETE)\b/.test(sql)&&!sql.includes('FOR NO KEY UPDATE'));
    expect(mutationSql).toHaveLength(1);expect(mutationSql[0]).toMatch(/^INSERT INTO viewer_login_bindings/);expect(db.query.mock.calls.filter(([sql])=>sql.startsWith('SELECT l.id,l.name'))).toHaveLength(1);expect(db.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');expect(db.release).toHaveBeenCalledTimes(1);
  });
  it('preserves current confirmed R5 labels and point authority over an automatic candidate',async()=>{
    const db=database(),binding={modelVersionId:id(2),bindingRevision:'5',pointProjectMetres:[9,8,7],mode:'fixed-world',derivation:'manual-world-point'} as unknown as EndpointBinding;mock.heads.mockResolvedValue(new Map([[id(10),{binding,ready:true}]]));
    const state=await db.state();expect(state.locations[0].binding).toMatchObject({status:'confirmed',source:'manual',revision:'5',point:[9,8,7]});expect(state.locations[0].calculationAvailability.status).toBe('confirmed-ready');expect(state.cables[0].fromMatch.status).toBe('matched');expect(mock.automatic).not.toHaveBeenCalled();
  });
  it('keeps legacy saved points stale and blocks an automatic fallback without registry changes',async()=>{
    const db=database({legacy:true}),state=await db.state();expect(state.locations[0].binding).toMatchObject({status:'stale',source:'manual',point:[8,7,6]});expect(state.locations[0].calculationAvailability).toMatchObject({status:'saved-binding-required',pointAvailable:false});expect(mock.automatic).not.toHaveBeenCalled();expect(state.registryRevision).toBe('1');
  });
  it('retains blank/ambiguous cable matching without using per-location availability as cable admission',async()=>{
    const db=database();db.locationRows[1].name='EQ01';db.cables[0].from_location=' ';const state=await db.state();expect(state.cables[0].fromMatch).toEqual({status:'missing',locationId:null,candidates:[]});expect(state.cables[1].fromMatch).toEqual({status:'ambiguous',locationId:null,candidates:[id(10),id(11)]});expect(state.locations.every(location=>location.calculationAvailability.pointAvailable)).toBe(true);
  });
  it.each([{admin:false,code:'ADMIN_REQUIRED'},{revoked:true,code:'LOGIN_REVOKED'}])('retains current authorization refusal $code before endpoint reads',async options=>{
    const db=database(options);await expect(db.state()).rejects.toMatchObject({code:options.code});expect(mock.current).not.toHaveBeenCalled();expect(mock.automatic).not.toHaveBeenCalled();expect(db.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });
  it('propagates immutable evidence corruption instead of producing ordinary unresolved state',async()=>{
    const db=database(),failure=new PathFinderError('AUTOMATIC_ENDPOINT_OBJECT_INTEGRITY',409);mock.automatic.mockRejectedValue(failure);await expect(db.state()).rejects.toBe(failure);expect(db.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });
  it('refuses a changed model context and requires absent preparation explicitly',async()=>{
    const db=database();mock.current.mockResolvedValue({...current,modelVersionId:id(99)});await expect(db.state()).rejects.toMatchObject({code:'DISPLAY_ENDPOINT_CONTEXT_INTEGRITY'});expect(mock.automatic).not.toHaveBeenCalled();
    const none=database({model:null});mock.current.mockResolvedValue(null);const state=await none.state();expect(state.locations[0].calculationAvailability.status).toBe('preparation-required');expect(state.cables[0].fromMatch).toEqual(matchLocation(state.cables[0].fromLocation,state.locations,false));
  });
});
