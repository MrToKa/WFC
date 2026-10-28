// @vitest-environment node
import { beforeEach,describe,expect,it,vi } from 'vitest';
import type { Pool,PoolClient } from 'pg';
const mocks=vi.hoisted(()=>({engine:vi.fn(),store:vi.fn(),discard:vi.fn(),read:vi.fn(),digest:vi.fn()}));
vi.mock('./engine.js',()=>({runEngine:mocks.engine}));
vi.mock('./storage.js',()=>({storeSnapshot:mocks.store,discardSnapshot:mocks.discard,readSnapshot:mocks.read,snapshotDigest:mocks.digest}));
import { collectLookupDependencies,createPathFinderLookups,lookupDiagnostics } from './lookups.js';
import { artifactSchema,snapshotSchema } from './contracts.js';
import { defaultOptions,lookupSchema,lookupPlanSchema } from './jobContracts.js';
import { createPathFinderRepository,latestArtifact } from './repository.js';
import { syntheticStraightSnapshot } from './syntheticFixture.js';
import { syntheticLookupSnapshot } from './lookupFixture.js';

const projectId='11111111-1111-4111-8111-111111111111',modelId='22222222-2222-4222-8222-222222222222',artifactId='33333333-3333-4333-8333-333333333333';
const who={userId:'44444444-4444-4444-8444-444444444444',loginId:'55555555-5555-4555-8555-555555555555',loginExpiresAt:Date.now()+3_600_000};
const marker={adapterVersion:'wfc.protected-lookup-capture.v1',lookupRouteCodes:['/BC001']};
function snapshot() {
  return syntheticLookupSnapshot(projectId,modelId,'a'.repeat(64));
}
type Options={admin?:boolean;revoked?:boolean;selection?:string;health?:string;state?:string;gap?:string;settingsRevision?:string;planningArtifact?:boolean;reuse?:boolean;existingPurpose?:string;failJob?:boolean;commitUnknown?:boolean;job?:Record<string,any>;stored?:Record<string,any>};
function database(options:Options={}) {
  let inserted:Record<string,any>|undefined;
  const query=vi.fn(async(sql:string,params:unknown[]=[])=>{
    if(sql==='COMMIT' && options.commitUnknown) throw Error('Lost acknowledgement');
    if(sql==='SELECT id FROM projects WHERE id=$1 FOR NO KEY UPDATE')return {rows:[{id:projectId}]};
    if(sql.startsWith('SELECT is_admin'))return {rows:[{is_admin:options.admin!==false}]};
    if(sql.startsWith('SELECT user_id,expires_at'))return {rows:[{user_id:who.userId,expires_at:new Date(who.loginExpiresAt),revoked_at:options.revoked?new Date():null}]};
    if(sql.includes('FROM project_model_selections s LEFT JOIN'))return {rows:[{active_model_version_id:modelId,selection_revision:options.selection??'3'}]};
    if(sql.includes('FROM project_model_selections WHERE'))return {rows:[{active_model_version_id:modelId,selection_revision:options.selection??'3'}]};
    if(sql.includes('FROM model_versions WHERE'))return {rows:[{id:modelId,state:options.state??'ready',health:options.health??'healthy',content_fingerprint:'a'.repeat(64)}]};
    if(sql.startsWith('SELECT connection_gap'))return {rows:[{connection_gap:options.gap??'1',secondary_tray_length:'3',end_connection_length:'5',additional_bending_percent:'10',pf_settings_revision:options.settingsRevision??'7'}]};
    if(sql.startsWith('INSERT INTO pf_artifacts')) {inserted={id:params[0],model_version_id:params[2],content_fingerprint:params[3],snapshot_sha256:params[4],capture:params[6],purpose:'lookup'};return {rows:[]};}
    if(sql.startsWith('SELECT * FROM pf_artifacts')) {
      if(sql.includes("purpose='planning'"))return {rows:options.planningArtifact?[{id:artifactId,content_fingerprint:'a'.repeat(64),snapshot_sha256:'b'.repeat(64),purpose:'planning'}]:[]};
      if(inserted && params[2]===inserted.id)return {rows:[inserted]};
      return {rows:params[0]===projectId && params[1]===modelId && params[2]===artifactId ? [{id:artifactId,content_fingerprint:'a'.repeat(64),snapshot_sha256:'b'.repeat(64),purpose:options.existingPurpose??'lookup',capture:marker}]:[]};
    }
    if(sql.startsWith('SELECT id,snapshot_sha256 FROM pf_artifacts'))return {rows:options.reuse?[{id:artifactId,snapshot_sha256:'b'.repeat(64)}]:[]};
    if(sql.startsWith('SELECT id FROM pf_artifacts'))return {rows:options.commitUnknown&&inserted?[{id:inserted.id}]:[]};
    if(sql.startsWith('INSERT INTO pf_jobs')&&options.failJob){inserted=undefined;throw Error('Job insert failed');}
    if(sql.startsWith('SELECT * FROM pf_jobs'))return {rows:options.job?[options.job]:[]};
    if(sql.startsWith('SELECT * FROM pf_lookup_results'))return {rows:options.stored?[options.stored]:[]};
    return {rows:[]};
  });
  const client={query,release:vi.fn()};return {query,client:client as unknown as PoolClient,pool:{connect:vi.fn(async()=>client),query} as unknown as Pool,options};
}
const input=()=>({routeText:'/BC001',reverse:false,expectedSelectionRevision:'3',snapshot:snapshot()});
beforeEach(()=>{vi.clearAllMocks();mocks.store.mockResolvedValue({sha256:'b'.repeat(64),bytes:123});mocks.discard.mockResolvedValue(undefined);mocks.read.mockResolvedValue(Buffer.from('snapshot'));mocks.digest.mockReturnValue('b'.repeat(64));
  mocks.engine.mockResolvedValue({schemaVersion:'pathfinder.model.response.v1',requestId:projectId,status:'lookup_planned',message:'Ordered route parsed.',engineeringAccepted:false,routeCodes:['/BC001']});});

describe('independent lookup artifacts and current authority',()=>{
  it('plans using the private C# parser without requiring a planning artifact, locations or a registry',async()=>{
    const db=database(),result=await createPathFinderLookups(db.pool).plan(projectId,who,{routeText:'/secondary/BC001/BC001',expectedSelectionRevision:'3'});
    expect(result).toEqual({routeCodes:['/BC001'],connectionGap:'1',selectionRevision:'3'});
    expect(mocks.engine.mock.calls[0][0]).toMatchObject({operation:'lookup-plan',routeText:'/secondary/BC001/BC001',projectId,modelVersionId:modelId});
    expect(mocks.engine.mock.calls[0][0]).not.toHaveProperty('snapshotId');expect(db.query.mock.calls.some(([sql])=>/pf_artifacts|pf_locations|pf_project_state/.test(sql))).toBe(false);
  });
  it('rejects request purpose/options/identity overrides and mixed legacy+snapshot bodies',()=>{
    for(const patch of [{purpose:'planning'},{options:{...defaultOptions}},{artifactId},{actorId:who.userId}])expect(lookupSchema.safeParse({...input(),...patch}).success).toBe(false);
    expect(lookupPlanSchema.safeParse({routeText:'/BC001',expectedSelectionRevision:'3',connectionGap:99}).success).toBe(false);
  });
  it('stores a lookup-purpose artifact and job without planning promotion, registry/location writes or fake cables',async()=>{
    const db=database();expect((await createPathFinderLookups(db.pool).create(projectId,who,lookupSchema.parse(input()))).duplicate).toBe(false);
    const writes=db.query.mock.calls.filter(([sql])=>/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)).map(([sql])=>sql);
    expect(writes.some(sql=>sql.includes("'lookup'"))).toBe(true);expect(writes.some(sql=>/pf_project_state|pf_model_objects|pf_location|cables|pf_proposals|pf_reviews|pf_apply_receipts/.test(sql))).toBe(false);
    expect(db.query.mock.calls.some(([sql])=>sql.includes("purpose='planning'"))).toBe(false);expect(db.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
  });
  it('keeps planning latest selection purpose-filtered even when a newer lookup artifact exists',async()=>{
    const db=database({planningArtifact:true});expect((await latestArtifact(db.client,projectId,modelId))?.id).toBe(artifactId);
    expect(db.query.mock.calls.at(-1)?.[0]).toContain("purpose='planning'");
  });
  it('reuses only exact same-purpose current-conversion bytes and checks the retained file integrity before enqueueing',async()=>{
    const db=database({reuse:true});await createPathFinderLookups(db.pool).create(projectId,who,input());
    expect(mocks.store).not.toHaveBeenCalled();expect(mocks.read).toHaveBeenCalledWith(artifactId,'b'.repeat(64));
    const reuse=db.query.mock.calls.find(([sql])=>sql.startsWith('SELECT id,snapshot_sha256'));expect(reuse?.[0]).toContain("purpose='lookup'");expect(reuse?.[1]).toEqual([projectId,modelId,'a'.repeat(64),'b'.repeat(64)]);
    expect(db.query.mock.calls.some(([sql])=>sql.startsWith('INSERT INTO pf_artifacts'))).toBe(false);
    mocks.read.mockRejectedValueOnce(Error('Artifact integrity failed'));const broken=database({reuse:true});await expect(createPathFinderLookups(broken.pool).create(projectId,who,input())).rejects.toThrow('Artifact integrity failed');
    expect(broken.query.mock.calls.some(([sql])=>sql.startsWith('INSERT INTO pf_jobs'))).toBe(false);expect(mocks.discard).not.toHaveBeenCalled();
  });
  it('refuses a lookup-purpose artifact for standalone or cable planning before any endpoint matching',async()=>{
    await expect(collectLookupDependencies(database().client,projectId,{routeText:'',reverse:false,artifactId,options:{...defaultOptions},planningOnly:true})).rejects.toMatchObject({code:'MODEL_INDEX_CONFLICT'});
  });
  it('refuses lookup capture through the ordinary planning importer, including direct repository callers',async()=>{
    const body={modelVersionId:modelId,expectedSelectionRevision:'3',expectedRegistryRevision:'0',snapshot:snapshot()};
    expect(artifactSchema.safeParse(body).success).toBe(false);const db=database();await expect(createPathFinderRepository(db.pool).ingestArtifact(projectId,who,body)).rejects.toMatchObject({code:'LOOKUP_SCOPE_REQUIRED'});expect(mocks.store).not.toHaveBeenCalled();
  });
  it.each([{projectId:artifactId},{modelVersionId:artifactId},{contentSha256:'c'.repeat(64)}])('refuses cross-scope snapshot identity %j before storage',async patch=>{
    const value=input();Object.assign(value.snapshot.model,patch);await expect(createPathFinderLookups(database().pool).create(projectId,who,value)).rejects.toMatchObject({code:'MODEL_FINGERPRINT_CONFLICT'});expect(mocks.store).not.toHaveBeenCalled();
  });
  it('rejects ordinary captures and fake lookup leaves with planning category assignments',async()=>{
    const ordinary=input();ordinary.snapshot=syntheticStraightSnapshot(projectId,modelId,'a'.repeat(64));await expect(createPathFinderLookups(database().pool).create(projectId,who,ordinary)).rejects.toMatchObject({code:'LOOKUP_SCOPE_REQUIRED'});
    const wrong=input();wrong.snapshot.objects[0].categoryAssignmentSource='explicit-planning';await expect(createPathFinderLookups(database().pool).create(projectId,who,wrong)).rejects.toMatchObject({code:'LOOKUP_SCOPE_REQUIRED'});
    const missingCategory=snapshot();missingCategory.objects[0].allowedCategories=['Control'];expect(snapshotSchema.safeParse(missingCategory).success).toBe(false);
  });
  it('pins the exact lookup artifact independently of missing or changed planning snapshots and applies only server Details gap',async()=>{
    const db=database({gap:'0.5'}),value=await collectLookupDependencies(db.client,projectId,{routeText:'/BC001',reverse:false,artifactId,expectedSelectionRevision:'3',options:{...defaultOptions,connectionToleranceMeters:99}});
    expect(value.connectionGap).toBe('0.5');expect(value.options.connectionToleranceMeters).toBe(.5);expect(db.query.mock.calls.some(([sql])=>sql.includes("purpose='planning'"))).toBe(false);
  });
  it('retains latest-artifact fences for legacy planning lookups',async()=>{
    await expect(collectLookupDependencies(database({existingPurpose:'planning'}).client,projectId,{routeText:'/BC001',reverse:false,artifactId,options:{...defaultOptions}})).rejects.toMatchObject({code:'MODEL_INDEX_CONFLICT'});
  });
  it.each([{selection:'4',code:'MODEL_SELECTION_CONFLICT'},{health:'unhealthy',code:'MODEL_UNAVAILABLE'},{state:'deleting',code:'MODEL_UNAVAILABLE'},{admin:false,code:'ADMIN_REQUIRED'},{revoked:true,code:'LOGIN_REVOKED'}])('fails closed for $code before lookup storage',async({code,...options})=>{
    await expect(createPathFinderLookups(database(options).pool).create(projectId,who,input())).rejects.toMatchObject({code});expect(mocks.store).not.toHaveBeenCalled();
  });
  it('rechecks current administrator authority after parsing, rather than trusting initial JWT/role',async()=>{
    const db=database();mocks.engine.mockImplementationOnce(async()=>{db.options.admin=false;return {status:'lookup_planned',routeCodes:['/BC001']};});
    await expect(createPathFinderLookups(db.pool).plan(projectId,who,{routeText:'/BC001',expectedSelectionRevision:'3'})).rejects.toMatchObject({code:'ADMIN_REQUIRED'});
  });
  it('rejects a model revision change while the private parser runs',async()=>{
    const db=database();mocks.engine.mockImplementationOnce(async()=>{db.options.selection='4';return {status:'lookup_planned',routeCodes:['/BC001']};});
    await expect(createPathFinderLookups(db.pool).plan(projectId,who,{routeText:'/BC001',expectedSelectionRevision:'3'})).rejects.toMatchObject({code:'MODEL_SELECTION_CONFLICT'});
  });
  it('discards only a newly unpublished snapshot after rollback and preserves an acknowledged-unknown published snapshot',async()=>{
    const rolledBack=database({failJob:true});
    await expect(createPathFinderLookups(rolledBack.pool).create(projectId,who,input())).rejects.toThrow('Job insert failed');expect(mocks.discard).toHaveBeenCalledTimes(1);
    expect(rolledBack.query.mock.calls.some(([sql])=>sql==='ROLLBACK')).toBe(true);expect(rolledBack.client.release).toHaveBeenCalledExactlyOnceWith(undefined);
    mocks.discard.mockClear();const unknown=database({commitUnknown:true});
    await expect(createPathFinderLookups(unknown.pool).create(projectId,who,input())).rejects.toMatchObject({code:'PATHFINDER_COMMIT_OUTCOME_UNKNOWN',status:503});
    expect(mocks.discard).not.toHaveBeenCalled();expect(unknown.query.mock.calls.filter(([sql])=>sql==='COMMIT')).toHaveLength(1);
    expect(unknown.query.mock.calls.some(([sql])=>sql==='ROLLBACK')).toBe(false);expect(unknown.client.release).toHaveBeenCalledExactlyOnceWith(true);
    const ownedSnapshotId=mocks.store.mock.calls.at(-1)?.[0];expect(typeof ownedSnapshotId).toBe('string');
    expect(unknown.query.mock.calls.find(([sql])=>sql==='SELECT id FROM pf_artifacts WHERE project_id=$1 AND id=$2')?.[1]).toEqual([projectId,ownedSnapshotId]);
  });
  it('reports actual distinct used leaves and nullable unavailable legacy fallback diagnostics',()=>{
    expect(lookupDiagnostics({route:{segmentIds:['1','1','2']},prepared:{counts:{fallbackBends:2,fallbackStraights:0,fallbackClearances:4}}})).toEqual({geometryLeavesUsed:2,fallbackBends:2,fallbackStraights:0,fallbackClearances:4});
    expect(lookupDiagnostics({})).toEqual({geometryLeavesUsed:null,fallbackBends:null,fallbackStraights:null,fallbackClearances:null});
  });
  it('returns frozen used gap and no design/Apply semantics, and marks a completed lookup stale after current gap changes',async()=>{
    const db=database(),dependencies=await collectLookupDependencies(db.client,projectId,{routeText:'/BC001',reverse:false,artifactId,options:{...defaultOptions}});
    db.options.job={id:artifactId,project_id:projectId,kind:'lookup',state:'complete',total:1,completed:1,diagnostic_input:dependencies};
    db.options.stored={dependencies,stale_at_completion:false,result:{status:'calculated',message:'Entered path found.',prepared:{counts:{fallbackBends:0,fallbackStraights:1,fallbackClearances:0}},route:{segmentIds:['dbid:1','dbid:1'],pathPoints:[{x:0,y:0,z:0},{x:10,y:0,z:0}]}}};
    const service=createPathFinderLookups(db.pool),before=await service.get(projectId,who,artifactId);expect(before.result).toMatchObject({connectionGap:'1',design:null,engineeringAccepted:false,acceptanceScope:'diagnostic-lookup',stale:false,diagnostics:{geometryLeavesUsed:1,fallbackStraights:1}});
    db.options.gap='0.5';db.options.settingsRevision='8';const after=await service.get(projectId,who,artifactId);expect(after.result?.stale).toBe(true);expect(after.result?.connectionGap).toBe('1');
  });
  it('keeps a completed independent lookup current after planning state changes but stale after a model selection change',async()=>{
    const db=database(),dependencies=await collectLookupDependencies(db.client,projectId,{routeText:'/BC001',reverse:false,artifactId,options:{...defaultOptions}});
    db.options.job={id:artifactId,project_id:projectId,kind:'lookup',state:'complete',total:1,completed:1,diagnostic_input:dependencies};db.options.stored={dependencies,stale_at_completion:false,result:{status:'no_path',message:'No path.'}};
    db.options.planningArtifact=true;expect((await createPathFinderLookups(db.pool).get(projectId,who,artifactId)).result?.stale).toBe(false);
    db.options.selection='4';expect((await createPathFinderLookups(db.pool).get(projectId,who,artifactId)).result?.stale).toBe(true);
  });
  it('marks a completed lookup stale when its exact retained snapshot fails integrity at readback',async()=>{
    const db=database(),dependencies=await collectLookupDependencies(db.client,projectId,{routeText:'/BC001',reverse:false,artifactId,options:{...defaultOptions}});
    db.options.job={id:artifactId,project_id:projectId,kind:'lookup',state:'complete',total:1,completed:1,diagnostic_input:dependencies};db.options.stored={dependencies,stale_at_completion:false,result:{status:'no_path',message:'No path.'}};
    mocks.read.mockRejectedValueOnce(Error('Artifact integrity failed'));expect((await createPathFinderLookups(db.pool).get(projectId,who,artifactId)).result?.stale).toBe(true);
  });
  it('never reads an exact lookup artifact through another project scope',async()=>{
    const db=database();await expect(collectLookupDependencies(db.client,modelId,{routeText:'/BC001',reverse:false,artifactId,options:{...defaultOptions}})).rejects.toMatchObject({code:'MODEL_INDEX_CONFLICT'});
    expect(db.query.mock.calls.find(([sql])=>sql.startsWith('SELECT * FROM pf_artifacts'))?.[1]?.[0]).toBe(modelId);
  });
  it('bounds concurrent private parser processes and frees slots after completion',async()=>{
    const resolvers:Array<(value:unknown)=>void>=[];mocks.engine.mockImplementation(()=>new Promise(resolve=>resolvers.push(resolve)));
    const service=createPathFinderLookups(database().pool),body={routeText:'/BC001',expectedSelectionRevision:'3'};
    const first=service.plan(projectId,who,body),second=service.plan(projectId,who,body);await vi.waitFor(()=>expect(resolvers).toHaveLength(2));
    await expect(service.plan(projectId,who,body)).rejects.toMatchObject({code:'LOOKUP_PLAN_BUSY'});for(const resolve of resolvers)resolve({status:'lookup_planned',routeCodes:['/BC001']});await Promise.all([first,second]);
    mocks.engine.mockResolvedValue({status:'lookup_planned',routeCodes:['/BC001']});await expect(service.plan(projectId,who,body)).resolves.toMatchObject({routeCodes:['/BC001']});
  });
});
