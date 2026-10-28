// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import type { JobPrincipal } from './jobContracts.js';
import { createPathFinderRepository } from './repository.js';
import { normalizeLocation, validateSnapshotStructure } from './matching.js';
import { syntheticStraightSnapshot } from './syntheticFixture.js';
import { geometryTraceFixture } from './geometryTraceFixtures.js';
import { runCandidateEligibilityIntegration } from './candidateEligibilityIntegration.js';
import { EventEmitter } from 'node:events';
import { readAutomaticEndpointCandidates, type AutomaticEndpointCandidateResult } from './automaticEndpointCandidates.js';
import { endpointBindingFixture } from './endpointBindingFixtures.js';
import { endpointBindingHash } from './endpointBindingRepository.js';
import type { EndpointBinding } from '../../shared/pathfinderEndpointBindings.js';

vi.mock('./automaticEndpointCandidates.js',()=>({readAutomaticEndpointCandidates:vi.fn(async(client:unknown,input:{locationIds:string[]})=>{
  const state=client as {verifiedCandidate?:AutomaticEndpointCandidateResult};
  return new Map(input.locationIds.map(id=>[id,state.verifiedCandidate??{status:'preparation-required',candidateObjectIds:[],point:null}]));
})}));

const projectId='11111111-1111-4111-8111-111111111111',modelId='22222222-2222-4222-8222-222222222222',artifactId='33333333-3333-4333-8333-333333333333',locationId='44444444-4444-4444-8444-444444444444';
const who:JobPrincipal={userId:'55555555-5555-4555-8555-555555555555',loginId:'66666666-6666-4666-8666-666666666666',loginExpiresAt:Date.now()+3600000};
type Candidate={object_id:string;visibility:'visible'|'hidden'|'unknown';anchor:number[];external_id:null};
const candidate=(id:string,visibility:Candidate['visibility']='visible'):Candidate=>({object_id:id,visibility,anchor:[1,2,3],external_id:null});
type Cable = {id:string;from_location:string|null;to_location:string|null};
type Location = {id:string;name:string;aliases:string[];revision:string} & Record<string,unknown>;
function database(options:{rows?:Candidate[];manual?:boolean;legacyAutomatic?:boolean;projectMode?:boolean;admin?:boolean;revoked?:boolean;registry?:string;model?:string|null;verifiedCandidate?:AutomaticEndpointCandidateResult;cables?:Cable[];locations?:Location[];heads?:EndpointBinding[]}={}) {
  const aggregate=options.projectMode?{...geometryTraceFixture().aggregate,projectId,modelVersionId:modelId,artifactId}:null;
  const locationRows:Location[]=options.locations??[{id:locationId,name:' =a001 ',aliases:['Other alias'],revision:'1',...(options.manual||options.legacyAutomatic?{model_version_id:modelId,binding_revision:'7',point:[9,8,7],object_id:'legacy-id',source:options.manual?'manual':'automatic',artifact_id:artifactId,derivation:'equipment-bottom-aabb',coordinate_frame:'canonical-world-metres'}: {})}];
  const writes:{kind:'binding'|'match';values:unknown[]}[]=[],release=vi.fn();
  const query=vi.fn(async(sql:string,values:unknown[]=[])=>{
    if (['BEGIN','COMMIT','ROLLBACK'].includes(sql)) return {rows:[]};
    if (sql==='SELECT id FROM projects WHERE id=$1 FOR NO KEY UPDATE') return {rows:[{id:projectId}]};
    if (sql.startsWith('SELECT is_admin')) return {rows:[{is_admin:options.admin!==false}]};
    if (sql.startsWith('INSERT INTO viewer_login_bindings')) return {rows:[]};
    if (sql.startsWith('SELECT user_id,expires_at')) return {rows:[{user_id:who.userId,expires_at:new Date(who.loginExpiresAt),revoked_at:options.revoked?new Date():null}]};
    if (sql.startsWith('SELECT registry_revision::text')) return {rows:[{registry_revision:options.registry??'1'}]};
    if (sql.includes('FROM project_model_selections s LEFT JOIN')) return {rows:[{active_model_version_id:options.model===undefined?modelId:options.model,selection_revision:'1',content_fingerprint:'a'.repeat(64),state:'ready',health:'healthy'}]};
    if (sql.startsWith('SELECT current_aggregate_id FROM pf_project_preparations')) return {rows:aggregate?[{current_aggregate_id:aggregate.id}]:[]};
    if (sql.startsWith('SELECT active_model_version_id,selection_revision::text')) return {rows:[{active_model_version_id:options.model===undefined?modelId:options.model,selection_revision:'1'}]};
    if (sql.startsWith('SELECT state,health,content_fingerprint')) return {rows:[{state:'ready',health:'healthy',content_fingerprint:'a'.repeat(64)}]};
    if (sql.startsWith('SELECT * FROM pf_artifacts')) return {rows:[{id:artifactId}]};
    if (sql.startsWith('SELECT p.current_aggregate_id')) return {rows:aggregate?[{current_aggregate_id:aggregate.id,current_artifact_id:artifactId,aggregate_artifact_id:artifactId,aggregate_model_id:modelId,aggregate_revision:aggregate.geometryRevision,pointer_revision:aggregate.geometryRevision,geometry_revision:aggregate.geometryRevision,manifest:aggregate,snapshot_sha256:aggregate.projection.sha256}]:[]};
    if (sql.startsWith('SELECT id FROM pf_preparation_aggregates')||sql.startsWith('SELECT id FROM pf_artifacts')) return {rows:[{id:values[1]}]};
    if (sql.startsWith('SELECT id,manifest FROM pf_geometry_trace_sets')) return {rows:[]};
    if (sql.startsWith('SELECT h.location_id')) return {rows:(options.heads??[]).filter(binding=>!sql.includes('h.location_id=ANY')||(values[1] as string[]).includes(binding.locationId)).map(binding=>({location_id:binding.locationId,location_revision:locationRows.find(row=>row.id===binding.locationId)!.revision,binding_id:binding.id,binding_revision:binding.bindingRevision,record_sha256:binding.contentSha256,record:binding}))};
    if (sql.startsWith('SELECT pf_settings_revision::text')) return {rows:[{pf_settings_revision:'1',connection_gap:'1',secondary_tray_length:'7',end_connection_length:'5',additional_bending_percent:'10'}]};
    if (sql.startsWith('SELECT id,cable_id,tag,from_location')) return {rows:[]};
    if (sql.startsWith('SELECT id,from_location,to_location FROM cables')) return {rows:(options.cables??[]).filter(cable=>(values[1] as string[]).includes(cable.id)).sort((a,b)=>a.id.localeCompare(b.id))};
    if (sql.startsWith('SELECT DISTINCT value AS name FROM cables')) return {rows:[...new Set((options.cables??[]).flatMap(cable=>[cable.from_location,cable.to_location]))].filter((name):name is string=>typeof name==='string'&&name.trim()!=='').map(name=>({name}))};
    if (sql.startsWith('SELECT location_id FROM pf_location_aliases')) return {rows:locationRows.filter(row=>[row.name,...row.aliases].some(name=>normalizeLocation(name)===values[1])).map(row=>({location_id:row.id}))};
    if (sql.startsWith('SELECT l.id,l.name')) return {rows:locationRows.filter(row=>!sql.includes('l.id=ANY')||(values[2] as string[]).includes(row.id))};
    if (sql.startsWith('SELECT * FROM pf_model_objects')) return {rows:options.rows??[candidate('visible')]};
    if (sql.startsWith('SELECT model_version_id,revision::text,point')) return {rows:[]};
    if (sql.startsWith('INSERT INTO pf_location_bindings')) {writes.push({kind:'binding',values});return {rows:[]};}
    if (sql.startsWith('INSERT INTO pf_location_matches')) {writes.push({kind:'match',values});return {rows:[]};}
    if (sql.startsWith('INSERT INTO pf_location_events')||sql.startsWith('DELETE FROM pf_location_matches')) return {rows:[]};
    if (sql.startsWith('UPDATE pf_project_state SET')) return {rows:[{registry_revision:'2'}]};
    throw Error('Unexpected test query: '+sql);
  });
  const pool={connect:vi.fn(async()=>({query,release,verifiedCandidate:options.verifiedCandidate}))} as unknown as Pool;
  const repo=createPathFinderRepository(pool);
  return {query,writes,pool,release,repo,match:()=>repo.match(projectId,who,'1')};
}
beforeEach(()=>vi.clearAllMocks());

async function scopedProject() {
  const f=endpointBindingFixture(),saved=(await f.repo.confirm(f.f.aggregate.projectId,f.who,f.locationId,f.command())).binding;
  const aggregate=geometryTraceFixture().aggregate;
  const locationRows:Location[]=[{id:locationId,name:'From',aliases:[' From alias '],revision:'1'},
    {id:'44444444-4444-4444-8444-444444444445',name:'To',aliases:[],revision:'1'},
    {id:'44444444-4444-4444-8444-444444444446',name:'Unrelated',aliases:[],revision:'1'}];
  const heads=locationRows.slice(0,2).map((location,index)=>{
    const body={...saved,id:`44444444-4444-4444-8444-44444444445${index}`,projectId,locationId:location.id,locationRevision:location.revision,
      modelVersionId:modelId,aggregateId:aggregate.id,artifactId,projectionSha256:aggregate.projection.sha256,captureFrameId:aggregate.coordinateFrameId};
    const {contentSha256:_old,...record}=body;return {...record,contentSha256:endpointBindingHash(record)};
  });
  const cables:Cable[]=[{id:'77777777-7777-4777-8777-777777777771',from_location:' from ALIAS ',to_location:'To'},
    {id:'77777777-7777-4777-8777-777777777772',from_location:'Unrelated',to_location:'To'}];
  return {locationRows,heads,cables};
}

describe('selected cable matching scope',()=>{
  it('keeps a manually confirmed pair calculable without reading unrelated unprepared endpoints',async()=>{
    const f=await scopedProject(),db=database({projectMode:true,cables:f.cables,locations:f.locationRows,heads:f.heads});
    await expect(db.repo.match(projectId,who,'1',[f.cables[0].id])).resolves.toEqual({createdLocations:0,matchedLocations:0,registryRevision:'1'});
    expect(readAutomaticEndpointCandidates).not.toHaveBeenCalled();expect(db.writes).toEqual([]);
    const headRead=db.query.mock.calls.find(([sql])=>sql.startsWith('SELECT h.location_id'))!;
    expect(headRead[0]).toContain('h.location_id=ANY($2::uuid[])');expect(headRead[1]).toEqual([projectId,f.locationRows.slice(0,2).map(row=>row.id)]);
    const locations=db.query.mock.calls.find(([sql])=>sql.startsWith('SELECT l.id,l.name'))!;
    expect(locations[0]).toContain('l.id=ANY($3::uuid[])');expect(locations[1]).toEqual([projectId,modelId,f.locationRows.slice(0,2).map(row=>row.id)]);
    expect(db.query.mock.calls.some(([sql])=>sql.startsWith('SELECT DISTINCT value AS name FROM cables'))).toBe(false);
    expect(db.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
  });
  it('retains project-wide preparation refusal for the same mixed project',async()=>{
    const f=await scopedProject(),db=database({projectMode:true,cables:f.cables,locations:f.locationRows,heads:f.heads});
    await expect(db.match()).rejects.toMatchObject({code:'ENDPOINT_PREPARATION_REQUIRED',status:409});
    expect(readAutomaticEndpointCandidates).toHaveBeenCalledExactlyOnceWith(expect.anything(),expect.objectContaining({locationIds:[f.locationRows[2].id]}));
    expect(db.writes).toEqual([]);expect(db.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });
  it('still refuses an actually selected automatic endpoint whose preparation evidence is absent',async()=>{
    const f=await scopedProject(),db=database({projectMode:true,cables:f.cables,locations:f.locationRows,heads:f.heads});
    await expect(db.repo.match(projectId,who,'1',[f.cables[1].id])).rejects.toMatchObject({code:'ENDPOINT_PREPARATION_REQUIRED',status:409});
    expect(readAutomaticEndpointCandidates).toHaveBeenCalledExactlyOnceWith(expect.anything(),expect.objectContaining({locationIds:[f.locationRows[2].id]}));
    expect(db.writes).toEqual([]);expect(db.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });
  it.each([{scope:[] as string[],code:'NO_CABLES'},{scope:['77777777-7777-4777-8777-777777777779'],code:'CABLE_NOT_FOUND'}])('refuses an empty or missing exact cable scope before matching: $code',async({scope,code})=>{
    const db=database({projectMode:true});await expect(db.repo.match(projectId,who,'1',scope)).rejects.toMatchObject({code});
    expect(db.query.mock.calls.some(([sql])=>sql.startsWith('SELECT l.id,l.name')||sql.startsWith('SELECT * FROM pf_artifacts'))).toBe(false);expect(db.writes).toEqual([]);
  });
  it('canonicalizes duplicate ids without widening a valid selected scope',async()=>{
    const f=await scopedProject(),db=database({projectMode:true,cables:f.cables,locations:f.locationRows,heads:f.heads});
    await expect(db.repo.match(projectId,who,'1',[f.cables[0].id,f.cables[0].id])).resolves.toMatchObject({createdLocations:0,matchedLocations:0});
    expect(db.query.mock.calls.find(([sql])=>sql.startsWith('SELECT id,from_location,to_location FROM cables'))?.[1]).toEqual([projectId,[f.cables[0].id]]);
    expect(readAutomaticEndpointCandidates).not.toHaveBeenCalled();expect(db.writes).toEqual([]);
  });
  it('rejects an oversized requested scope before materializing cable or location data',async()=>{
    const db=database({projectMode:true});await expect(db.repo.match(projectId,who,'1',Array.from({length:10001},()=> '77777777-7777-4777-8777-777777777771'))).rejects.toMatchObject({code:'JOB_CABLE_BUDGET',status:413});
    expect(db.query.mock.calls.some(([sql])=>sql.startsWith('SELECT id,from_location,to_location FROM cables')||sql.startsWith('SELECT l.id,l.name'))).toBe(false);expect(db.writes).toEqual([]);
  });
  it.each([{admin:false,code:'ADMIN_REQUIRED'},{revoked:true,code:'LOGIN_REVOKED'},{registry:'2',code:'REGISTRY_CONFLICT'}])('keeps scoped matching behind current authority/revision checks: $code',async({code,...options})=>{
    const db=database(options);await expect(db.repo.match(projectId,who,'1',['77777777-7777-4777-8777-777777777771'])).rejects.toMatchObject({code});
    expect(db.query.mock.calls.some(([sql])=>sql.startsWith('SELECT id,from_location,to_location FROM cables'))).toBe(false);expect(db.writes).toEqual([]);
  });
});

describe('automatic candidate eligibility and ambiguity',()=>{
  it('requires known-hidden eligibility in the production query before ORDER/LIMIT and preserves project/artifact/name fences',async()=>{
    const db=database();expect((await db.match()).matchedLocations).toBe(1);
    const [sql,parameters]=db.query.mock.calls.find(([sql])=>sql.startsWith('SELECT * FROM pf_model_objects'))!;
    expect(sql).toMatch(/geometry_role='object'[\s\S]*AND visibility<>'hidden'[\s\S]*ORDER BY object_id LIMIT 3$/);
    expect(parameters).toEqual([projectId,artifactId,['=A001','OTHER ALIAS']]);expect(db.writes[0]).toMatchObject({kind:'binding'});
  });
  it.each([
    {label:'single unknown',rows:[candidate('unknown','unknown')],status:'unverified'},
    {label:'visible plus unknown',rows:[candidate('visible'),candidate('unknown','unknown')],status:'ambiguous'},
    {label:'two visible',rows:[candidate('first'),candidate('second')],status:'ambiguous'},
    {label:'no eligible objects',rows:[],status:'missing'},
  ])('keeps $label unresolved without an automatic binding',async({rows,status})=>{
    const db=database({rows});expect((await db.match()).matchedLocations).toBe(0);expect(db.writes).toEqual([{kind:'match',values:[projectId,locationId,modelId,status,JSON.stringify(rows.map(row=>row.object_id))]}]);
  });
  it('does not replace an existing current-model manual binding or query model candidates for it',async()=>{
    const db=database({manual:true,rows:[candidate('replacement')]});expect((await db.match()).matchedLocations).toBe(0);expect(db.writes).toEqual([]);expect(db.query.mock.calls.some(([sql])=>sql.includes('FROM pf_model_objects'))).toBe(false);
  });
  it('records a sole visible project-mode candidate as unverified without creating binding authority or bumping the registry',async()=>{
    const db=database({projectMode:true,rows:[candidate('visible')],verifiedCandidate:{status:'automatic-ready',candidateObjectIds:['dbid:5'],point:null}});
    expect(await db.match()).toEqual({createdLocations:0,matchedLocations:0,registryRevision:'1'});
    expect(db.writes).toEqual([{kind:'match',values:[projectId,locationId,modelId,'unverified',JSON.stringify(['dbid:5'])]}]);
    expect(readAutomaticEndpointCandidates).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({projectId,locationIds:[locationId]}));
    expect(db.query.mock.calls.some(([sql])=>sql.startsWith('SELECT * FROM pf_model_objects'))).toBe(false);
    expect(db.query.mock.calls.find(([sql])=>sql.startsWith('SELECT current_aggregate_id FROM pf_project_preparations'))?.[1]).toEqual([projectId]);
    expect(db.query.mock.calls.some(([sql])=>sql.startsWith('INSERT INTO pf_location_bindings')||sql.startsWith('INSERT INTO pf_endpoint_binding_')||sql.startsWith('INSERT INTO pf_location_events')||sql.startsWith('UPDATE pf_project_state'))).toBe(false);
  });
  it('requires preparation again before saving misleading matches from old unknown display evidence',async()=>{
    const db=database({projectMode:true,rows:[candidate('unknown','unknown')]});
    await expect(db.match()).rejects.toMatchObject({code:'ENDPOINT_PREPARATION_REQUIRED'});
    expect(db.writes).toEqual([]);expect(db.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    expect(db.query.mock.calls.some(([sql])=>sql.startsWith('SELECT * FROM pf_model_objects'))).toBe(false);
  });
  it('keeps a confirmed manual location usable even when automatic preparation must be repeated',async()=>{
    const db=database({projectMode:true,manual:true});
    expect((await db.match()).matchedLocations).toBe(0);expect(db.writes).toEqual([]);
  });
  it.each(['ambiguous','object-unverified','missing'] as const)('records verified project %s status without inventing confirmed binding authority',async status=>{
    const candidateObjectIds=status==='missing'?[]:['dbid:5','dbid:6'];
    const db=database({projectMode:true,verifiedCandidate:{status,candidateObjectIds,point:null}});
    expect((await db.match()).matchedLocations).toBe(0);
    expect(db.writes).toEqual([{kind:'match',values:[projectId,locationId,modelId,status==='object-unverified'?'unverified':status,JSON.stringify(candidateObjectIds)]}]);
  });
  it('keeps an old automatic binding stale in project state and never promotes it during candidate matching',async()=>{
    const db=database({projectMode:true,legacyAutomatic:true,rows:[candidate('replacement')],verifiedCandidate:{status:'saved-binding-required',candidateObjectIds:[],point:null}});
    const before=await db.repo.state(projectId,who);expect(before.locations[0].binding).toMatchObject({source:'automatic',revision:'7',point:[9,8,7],status:'stale'});
    expect(before.locations[0].calculationAvailability).toMatchObject({status:'not-evaluated',pointAvailable:false,reasonCode:'LOCATION_NOT_IN_CABLE_SCOPE'});
    expect((await db.match()).matchedLocations).toBe(0);
    expect(db.writes).toEqual([{kind:'match',values:[projectId,locationId,modelId,'unverified',JSON.stringify([])]}]);
    expect((await db.repo.state(projectId,who)).locations[0].binding).toMatchObject({source:'automatic',revision:'7',point:[9,8,7],status:'stale'});
    expect(db.query.mock.calls.some(([sql])=>sql.startsWith('INSERT INTO pf_location_bindings')||sql.startsWith('INSERT INTO pf_endpoint_binding_'))).toBe(false);
  });
  it('refuses the legacy binding method in project mode before any legacy point or audit write',async()=>{
    const db=database({projectMode:true,manual:true});
    await expect(db.repo.bindLocation(projectId,who,locationId,{modelVersionId:modelId,expectedSelectionRevision:'1',expectedRegistryRevision:'1',point:[4,5,6],objectId:null,externalId:null})).rejects.toMatchObject({code:'ENDPOINT_BINDING_UPGRADE_REQUIRED',status:409});
    expect(db.writes).toEqual([]);
    expect(db.query.mock.calls.some(([sql])=>sql.includes('FROM pf_locations')||sql.includes('FROM pf_location_bindings')||sql.startsWith('INSERT INTO pf_location_events'))).toBe(false);
    expect(db.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });
  it.each([{label:'current administrator loss',options:{admin:false},code:'ADMIN_REQUIRED'},{label:'revoked login',options:{revoked:true},code:'LOGIN_REVOKED'},{label:'stale registry',options:{registry:'2'},code:'REGISTRY_CONFLICT'}])('rejects $label before candidate queries or writes',async({options,code})=>{
    const db=database(options);await expect(db.match()).rejects.toMatchObject({code});expect(db.writes).toEqual([]);expect(db.query.mock.calls.some(([sql])=>sql.includes('FROM pf_model_objects'))).toBe(false);expect(db.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');expect(db.release).toHaveBeenCalledOnce();
  });
  it('does not query an artifact or create a binding when no active model exists',async()=>{
    const db=database({model:null});expect((await db.match()).matchedLocations).toBe(0);expect(db.query.mock.calls.some(([sql])=>sql.includes('FROM pf_artifacts')||sql.includes('FROM pf_model_objects'))).toBe(false);expect(db.writes).toEqual([]);
  });
  it('folds known hidden ancestors and planning exclusions before matching, retaining unknown evidence',()=>{
    const snapshot=syntheticStraightSnapshot(projectId,modelId,'a'.repeat(64)),equipment=snapshot.objects.find(object=>object.geometryRole==='object')!;
    const ancestor={...equipment,id:'parent',parentId:null,geometryRole:'hierarchy' as const,nativeHidden:true};equipment.parentId='parent';snapshot.objects.push(ancestor);
    expect(validateSnapshotStructure(snapshot).get(equipment.id)).toBe('hidden');ancestor.nativeHidden=false;ancestor.planningExcluded=true;expect(validateSnapshotStructure(snapshot).get(equipment.id)).toBe('hidden');ancestor.planningExcluded=false;equipment.nativeHidden=null;expect(validateSnapshotStructure(snapshot).get(equipment.id)).toBe('unknown');
  });
  it('actual-SQL driver refuses non-demo invocation before obtaining any connection',async()=>{
    const previous=process.env.PF_LOCAL_DEMO;delete process.env.PF_LOCAL_DEMO;const connect=vi.fn();
    try {const result=await runCandidateEligibilityIntegration({connect} as unknown as Pool,{database:'wfc_pathfinder_local',serverAddress:'127.0.0.1',serverPort:5432,syntheticProjectId:projectId});expect(result.status).toBe('FAIL');expect(connect).not.toHaveBeenCalled();}
    finally {if(previous===undefined)delete process.env.PF_LOCAL_DEMO;else process.env.PF_LOCAL_DEMO=previous;}
  });
  it('actual-SQL driver catches repeated transport errors through rollback and discards the damaged client',async()=>{
    const previous=process.env.PF_LOCAL_DEMO;process.env.PF_LOCAL_DEMO='true';let listenerAtRelease=0;
    class Client extends EventEmitter {
      release=vi.fn((_discard?:boolean)=>{listenerAtRelease=this.listenerCount('error');});
      async query(sql:string) {
        if(sql.includes('current_database()'))return {rows:[{database:'wfc_pathfinder_local',address:'127.0.0.1',port:5432}]};
        if(sql.includes('public.pf_synthetic_projects'))return {rows:[{fixture_id:'pf-local-straight-v1'}]};
        if(sql.includes("AS existing"))return {rows:[{existing:null}]};
        if(sql.startsWith('\nCREATE TEMP TABLE')){this.emit('error',new Error('private transport details'));throw Object.assign(new Error('private query details'),{code:'08006'});}
        if(sql==='ROLLBACK'){this.emit('error',new Error('duplicate private transport details'));return {rows:[]};}
        if(sql.includes('AS remaining'))return {rows:[{remaining:null}]};
        return {rows:[]};
      }
    }
    const client=new Client(),pool={options:{max:1,connectionTimeoutMillis:5000,query_timeout:5000},connect:vi.fn(async()=>client)} as unknown as Pool;
    try {const result=await runCandidateEligibilityIntegration(pool,{database:'wfc_pathfinder_local',serverAddress:'127.0.0.1',serverPort:5432,syntheticProjectId:projectId});expect(result.status).toBe('FAIL');expect(result.transportErrorObserved).toBe(true);expect(result.failure?.code).toBe('08006');expect(client.release).toHaveBeenCalledWith(true);expect(listenerAtRelease).toBe(1);expect(client.listenerCount('error')).toBe(1);expect(JSON.stringify(result)).not.toContain('private');}
    finally {if(previous===undefined)delete process.env.PF_LOCAL_DEMO;else process.env.PF_LOCAL_DEMO=previous;}
  });
});
