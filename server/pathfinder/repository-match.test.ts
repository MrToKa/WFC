// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import type { JobPrincipal } from './jobContracts.js';
import { createPathFinderRepository } from './repository.js';
import { validateSnapshotStructure } from './matching.js';
import { syntheticStraightSnapshot } from './syntheticFixture.js';
import { geometryTraceFixture } from './geometryTraceFixtures.js';
import { runCandidateEligibilityIntegration } from './candidateEligibilityIntegration.js';
import { EventEmitter } from 'node:events';

const projectId='11111111-1111-4111-8111-111111111111',modelId='22222222-2222-4222-8222-222222222222',artifactId='33333333-3333-4333-8333-333333333333',locationId='44444444-4444-4444-8444-444444444444';
const who:JobPrincipal={userId:'55555555-5555-4555-8555-555555555555',loginId:'66666666-6666-4666-8666-666666666666',loginExpiresAt:Date.now()+3600000};
type Candidate={object_id:string;visibility:'visible'|'hidden'|'unknown';anchor:number[];external_id:null};
const candidate=(id:string,visibility:Candidate['visibility']='visible'):Candidate=>({object_id:id,visibility,anchor:[1,2,3],external_id:null});
function database(options:{rows?:Candidate[];manual?:boolean;legacyAutomatic?:boolean;projectMode?:boolean;admin?:boolean;revoked?:boolean;registry?:string;model?:string|null}={}) {
  const aggregate=options.projectMode?{...geometryTraceFixture().aggregate,projectId,modelVersionId:modelId,artifactId}:null;
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
    if (sql.startsWith('SELECT id,manifest FROM pf_geometry_trace_sets')||sql.startsWith('SELECT h.location_id')) return {rows:[]};
    if (sql.startsWith('SELECT pf_settings_revision::text')) return {rows:[{pf_settings_revision:'1',connection_gap:'1',secondary_tray_length:'7',end_connection_length:'5',additional_bending_percent:'10'}]};
    if (sql.startsWith('SELECT id,cable_id,tag,from_location')) return {rows:[]};
    if (sql.startsWith('SELECT DISTINCT value AS name FROM cables')) return {rows:[]};
    if (sql.startsWith('SELECT l.id,l.name')) return {rows:[{id:locationId,name:' =a001 ',aliases:['Other alias'],revision:'1',...(options.manual||options.legacyAutomatic?{model_version_id:modelId,binding_revision:'7',point:[9,8,7],object_id:'legacy-id',source:options.manual?'manual':'automatic',artifact_id:artifactId,derivation:'equipment-bottom-aabb',coordinate_frame:'canonical-world-metres'}: {})}]};
    if (sql.startsWith('SELECT * FROM pf_model_objects')) return {rows:options.rows??[candidate('visible')]};
    if (sql.startsWith('SELECT model_version_id,revision::text,point')) return {rows:[]};
    if (sql.startsWith('INSERT INTO pf_location_bindings')) {writes.push({kind:'binding',values});return {rows:[]};}
    if (sql.startsWith('INSERT INTO pf_location_matches')) {writes.push({kind:'match',values});return {rows:[]};}
    if (sql.startsWith('INSERT INTO pf_location_events')||sql.startsWith('DELETE FROM pf_location_matches')) return {rows:[]};
    if (sql.startsWith('UPDATE pf_project_state SET')) return {rows:[{registry_revision:'2'}]};
    throw Error('Unexpected test query: '+sql);
  });
  const pool={connect:vi.fn(async()=>({query,release}))} as unknown as Pool;
  const repo=createPathFinderRepository(pool);
  return {query,writes,pool,release,repo,match:()=>repo.match(projectId,who,'1')};
}

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
    const db=database({projectMode:true,rows:[candidate('visible')]});
    expect(await db.match()).toEqual({createdLocations:0,matchedLocations:0,registryRevision:'1'});
    expect(db.writes).toEqual([{kind:'match',values:[projectId,locationId,modelId,'unverified',JSON.stringify(['visible'])]}]);
    expect(db.query.mock.calls.find(([sql])=>sql.startsWith('SELECT current_aggregate_id FROM pf_project_preparations'))?.[1]).toEqual([projectId]);
    expect(db.query.mock.calls.some(([sql])=>sql.startsWith('INSERT INTO pf_location_bindings')||sql.startsWith('INSERT INTO pf_endpoint_binding_')||sql.startsWith('INSERT INTO pf_location_events')||sql.startsWith('UPDATE pf_project_state'))).toBe(false);
  });
  it('keeps an old automatic binding stale in project state and never promotes it during candidate matching',async()=>{
    const db=database({projectMode:true,legacyAutomatic:true,rows:[candidate('replacement')]});
    const before=await db.repo.state(projectId,who);expect(before.locations[0].binding).toMatchObject({source:'automatic',revision:'7',point:[9,8,7],status:'stale'});
    expect(before.locations[0].calculationAvailability).toMatchObject({status:'not-evaluated',pointAvailable:false,reasonCode:'LOCATION_NOT_IN_CABLE_SCOPE'});
    expect((await db.match()).matchedLocations).toBe(0);
    expect(db.writes).toEqual([{kind:'match',values:[projectId,locationId,modelId,'unverified',JSON.stringify(['replacement'])]}]);
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
