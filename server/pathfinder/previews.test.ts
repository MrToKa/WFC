// @vitest-environment node
import { describe,expect,it,vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { collectPreviewDependencies,createPathFinderPreviews,previewEngineRequest,previewResultDto,previewSchema,type PreviewInput } from './previews.js';
import type { EngineResponse,JobPrincipal } from './jobContracts.js';
import { snapshotObject } from './contracts.js';
import { proposalRoutingPreferences } from './jobContracts.js';
import { createPathFinderApply } from './apply.js';
import { syntheticEngineIdentity } from './calculationFixtures.js';
vi.mock('./calculationEngineIdentity.js',()=>({calculationEngineIdentity:vi.fn(async()=>syntheticEngineIdentity())}));

// Preview's former behaviour is retained only behind an explicitly scoped
// producer. Actual missing/mismatched producer controls live in routingScope.test.
vi.mock('./routingScope.js',async importOriginal=>({...await importOriginal<typeof import('./routingScope.js')>(),requirePreparedRoutingScope:vi.fn(async()=>({catalogRevision:'1',routingContentSha256:'c'.repeat(64),routingPolicyRevision:'1',routingPolicySha256:'d'.repeat(64)}))}));
vi.mock('./endpointBindingRepository.js',()=>({
  readCurrentEndpointBindingContext:vi.fn(async()=>({modelVersionId:modelId,selectionRevision:'3',contentFingerprint:'a'.repeat(64),artifactId,
    aggregateId:who.userId,projectionSha256:'b'.repeat(64),captureFrameId:who.loginId,geometryRevision:'2',traceId:null})),
  readEndpointBindingScope:vi.fn(async(client:PoolClient,input:{locationId:string})=>{
    const value=(client as unknown as {endpointAliases:Array<Record<string,unknown>>}).endpointAliases.find(row=>row.id===input.locationId);
    if(!value?.point||value.artifact_id&&value.artifact_id!==artifactId)return{status:'stale',code:'ENDPOINT_BINDING_STALE'};
    return{status:'confirmed',binding:{id:who.loginId,artifactId,locationId:input.locationId,locationRevision:'2',bindingRevision:value.revision,pointProjectMetres:value.point,
      contentSha256:'e'.repeat(64),mode:'fixed-world',captureFrameId:who.loginId,qualifiedProjectFrameId:null,aggregateId:who.userId,projectionSha256:'b'.repeat(64),sourceObject:null,sourceDecisionId:null}};
  }),
}));

const projectId='11111111-1111-4111-8111-111111111111',modelId='22222222-2222-4222-8222-222222222222',artifactId='33333333-3333-4333-8333-333333333333';
const who:JobPrincipal={userId:'44444444-4444-4444-8444-444444444444',loginId:'55555555-5555-4555-8555-555555555555',loginExpiresAt:Date.now()+3_600_000};
const settings={connection_gap:'1',secondary_tray_length:'5',end_connection_length:'6',additional_bending_percent:'10',pf_settings_revision:'7'};
const input=():PreviewInput=>({from:{name:'From',point:[0,0,.5]},to:{name:'To',point:[10,0,.5]},category:'Instrumentation',reverse:false,
  artifactId,expectedSelectionRevision:'3',expectedSettingsRevision:'7',expectedRegistryRevision:'4',secondaryDistanceMeters:2,preferVerticalApproach:true});
function database(options:{admin?:boolean;settings?:typeof settings;registry?:string;artifact?:string;modelState?:string;health?:string;aliases?:Array<Record<string,unknown>>;objects?:Array<Record<string,unknown>>;duplicate?:string;job?:Record<string,unknown>;stored?:Record<string,unknown>;proposal?:Record<string,unknown>;review?:Record<string,unknown>}={}) {
  const query=vi.fn(async (sql:string,_parameters?:unknown[])=>{
    if (sql==='SELECT id FROM projects WHERE id=$1 FOR NO KEY UPDATE') return {rows:[{id:projectId}]};
    if (sql.startsWith('SELECT is_admin')) return {rows:[{is_admin:options.admin!==false}]};
    if (sql.startsWith('SELECT user_id,expires_at')) return {rows:[{user_id:who.userId,expires_at:new Date(who.loginExpiresAt),revoked_at:null}]};
    if (sql.includes('FROM project_model_selections s LEFT JOIN')) return {rows:[{active_model_version_id:modelId,selection_revision:'3',state:options.modelState ?? 'ready',health:options.health ?? 'healthy',content_fingerprint:'a'.repeat(64)}]};
    if (sql.includes('FROM project_model_selections WHERE')) return {rows:[{active_model_version_id:modelId,selection_revision:'3'}]};
    if (sql.includes('FROM model_versions WHERE')) return {rows:[{id:modelId,state:options.modelState ?? 'ready',health:options.health ?? 'healthy',content_fingerprint:'a'.repeat(64)}]};
    if (sql.startsWith('SELECT * FROM pf_artifacts')) return {rows:[{id:options.artifact ?? artifactId,snapshot_sha256:'b'.repeat(64),content_fingerprint:'a'.repeat(64)}]};
    if (sql.startsWith('SELECT id FROM pf_artifacts')) return {rows:[{id:artifactId}]};
    if (sql.includes('FROM projects WHERE id=$1')) return {rows:[options.settings ?? settings]};
    if (sql.includes('FROM pf_project_state')) return {rows:[{registry_revision:options.registry ?? '4'}]};
    if (sql.includes('FROM pf_location_aliases')) return {rows:options.aliases ?? []};
    if (sql.includes('FROM pf_model_objects')) return {rows:options.objects ?? []};
    if (sql.startsWith('SELECT id FROM pf_jobs')) return {rows:options.duplicate ? [{id:options.duplicate}] : []};
    if (sql.startsWith('SELECT * FROM pf_jobs')) return {rows:options.job ? [options.job] : []};
    if (sql.startsWith('SELECT * FROM pf_lookup_results')) return {rows:options.stored ? [options.stored] : []};
    if (sql.startsWith('SELECT p.*,j.state AS job_state')) return {rows:options.proposal ? [options.proposal] : []};
    if (sql.startsWith('SELECT * FROM pf_reviews')) return {rows:options.review ? [options.review] : []};
    return {rows:[]};
  });
  const client={query,release:vi.fn(),endpointAliases:options.aliases??[]};return {query,client:client as unknown as PoolClient,pool:{connect:vi.fn(async()=>client)} as unknown as Pool};
}
const response:EngineResponse={schemaVersion:'pathfinder.model.response.v1',requestId:projectId,status:'calculated',message:'Path found.',engineeringAccepted:false,effectiveCategory:'Control',
  design:{lengthBeforePercentageMeters:'16',unroundedLengthMeters:'17.6',designLengthMeters:'18'},route:{success:true,message:'Path found.',routeText:'/BC1',routeCodes:['BC1'],segmentIds:['dbid:12','dbid:12'],
    pathPoints:[{x:0,y:0,z:.5},{x:10,y:0,z:.5}],lengthMeters:10,fromDistanceMeters:0,toDistanceMeters:0,fromRequiresSecondary:false,toRequiresSecondary:false,connectionGapCount:0,connectionGapLengthMeters:0}};

describe('standalone Path preview contract and dependency boundary',()=>{
  it('returns immutable retained proposal preferences and fails closed when either original option is unknown',()=>{
    expect(proposalRoutingPreferences({secondaryDistanceMeters:2,preferVerticalApproach:true,irrelevant:1})).toEqual({secondaryDistanceMeters:2,preferVerticalApproach:true});
    expect(proposalRoutingPreferences({secondaryDistanceMeters:0,preferVerticalApproach:false})).toEqual({secondaryDistanceMeters:0,preferVerticalApproach:false});
    for (const options of [null,{},'options',{secondaryDistanceMeters:2},{preferVerticalApproach:true},{secondaryDistanceMeters:NaN,preferVerticalApproach:true},{secondaryDistanceMeters:Infinity,preferVerticalApproach:true},{secondaryDistanceMeters:-1,preferVerticalApproach:true},{secondaryDistanceMeters:1_000_001,preferVerticalApproach:true},{secondaryDistanceMeters:'2',preferVerticalApproach:true}]) expect(proposalRoutingPreferences(options)).toBeNull();
  });
  it('rejects even an existing exact review before cable writes when retained proposal preferences are unknown',async()=>{
    const db=database({proposal:{id:artifactId,project_id:projectId,proposal_hash:'a'.repeat(64),dependencies:{options:{}},result:response},
      review:{id:modelId,actor_id:who.userId,proposal_id:artifactId,proposal_hash:'a'.repeat(64),validation_method:'manual-review'}});
    await expect(createPathFinderApply(db.pool)(projectId,who,artifactId,{idempotencyKey:who.userId,reviewId:modelId,expectedCableWriteRevision:'0'})).rejects.toMatchObject({code:'PROPOSAL_PREFERENCES_REQUIRED'});
    expect(db.query.mock.calls.some(([sql])=>/UPDATE cables|INSERT INTO pf_apply_receipts/.test(sql))).toBe(false);expect(db.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });
  it('requires current model, artifact, registry and Project Details revisions and rejects client allowance/identity overrides',()=>{
    expect(previewSchema.parse(input()).category).toBe('Instrumentation');
    for (const key of ['expectedSelectionRevision','expectedSettingsRevision','expectedRegistryRevision','artifactId'] as const) {const candidate:Record<string,unknown>={...input()};delete candidate[key];expect(previewSchema.safeParse(candidate).success).toBe(false);}
    for (const extra of [{connectionGap:99},{projectSettings:{endConnectionLength:'999'}},{actorId:who.userId},{cableId:artifactId},{timeoutMilliseconds:1}]) expect(previewSchema.safeParse({...input(),...extra}).success).toBe(false);
  });
  it('accepts only a noncompeting boundary on routing leaves while retaining legacy explicit-name snapshots',()=>{
    const object={id:'dbid:3',parentId:'dbid:2',name:'leaf',geometryRole:'routing-leaf',leafToRootNames:['leaf','TRAY','root'],properties:[],nativeHidden:null,
      planningExcluded:false,categoryAssignmentSource:'explicit-planning',allowedCategories:['Control'],bounds:{minimum:[0,0,0],maximum:[1,1,1]},fragments:[]};
    expect(snapshotObject.safeParse({...object,routeBoundaryId:'dbid:2'}).success).toBe(true);
    expect(snapshotObject.safeParse({...object,routeName:'/TRAY',shapeName:'leaf'}).success).toBe(true);
    expect(snapshotObject.safeParse({...object,routeBoundaryId:'dbid:2',routeName:'/TRAY'}).success).toBe(false);
    expect(snapshotObject.safeParse({...object,routeBoundaryId:'dbid:2',geometryRole:'object'}).success).toBe(false);
  });
  it('accepts empty labels only for explicit points and rejects missing, nonfinite, out-of-bounds or oversized endpoint data',()=>{
    expect(previewSchema.safeParse({...input(),from:{name:'',point:[0,0,0]}}).success).toBe(true);
    for (const from of [{name:'  '},{name:'A',point:[NaN,0,0]},{name:'A',point:[Infinity,0,0]},{name:'A',point:[1e9+1,0,0]},{name:'A'.repeat(501)},{name:'A',point:[0,0]},{name:'A\nB'}]) expect(previewSchema.safeParse({...input(),from}).success).toBe(false);
    for (const category of ['Unknown','instrumentation','']) expect(previewSchema.safeParse({...input(),category}).success).toBe(false);
    for (const secondaryDistanceMeters of [-1,Infinity,NaN,1_000_001]) expect(previewSchema.safeParse({...input(),secondaryDistanceMeters}).success).toBe(false);
  });
  it('uses server Details gap and exact three allowances without persisting manual endpoints or touching cables',async()=>{
    const db=database(),dependencies=await collectPreviewDependencies(db.client,projectId,input());
    expect(dependencies.options.connectionToleranceMeters).toBe(1);expect(dependencies.settings).toEqual({revision:'7',connectionGap:'1',secondaryTrayLength:'5',endConnectionLength:'6',additionalBendingPercent:'10'});
    expect(dependencies.from.source).toBe('manual-world-point');expect(dependencies.from.point).toEqual([0,0,.5]);
    expect(db.query.mock.calls.every(([sql])=>!/^\s*(INSERT|UPDATE|DELETE)/i.test(sql))).toBe(true);
  });
  it.each([{expectedSettingsRevision:'6',code:'PROJECT_SETTINGS_CONFLICT'},{expectedRegistryRevision:'2',code:'REGISTRY_CONFLICT'},{expectedSelectionRevision:'2',code:'MODEL_SELECTION_CONFLICT'},{artifactId:modelId,code:'MODEL_INDEX_CONFLICT'}])('rejects stale requested dependency $code',async({code,...patch})=>{
    await expect(collectPreviewDependencies(database().client,projectId,{...input(),...patch})).rejects.toMatchObject({code});
  });
  it.each([{modelState:'deleting'},{health:'unhealthy'}])('rejects active but unavailable model %j',async options=>{
    await expect(collectPreviewDependencies(database(options).client,projectId,input())).rejects.toMatchObject({code:'MODEL_UNAVAILABLE'});
  });
  it('reuses one valid shared alias and its binding identity before model-name search',async()=>{
    const db=database({aliases:[{id:artifactId,revision:'9',point:[1,2,3],object_id:'dbid:11',artifact_id:artifactId}]});
    const result=await collectPreviewDependencies(db.client,projectId,{...input(),from:{name:'Alias'}});
    expect(result.from).toMatchObject({name:'Alias',point:[1,2,3],locationId:artifactId,bindingRevision:'9',source:'shared-location'});
    expect(db.query.mock.calls.some(([sql])=>sql.includes('FROM pf_model_objects'))).toBe(false);
  });
  it.each([{point:null},{point:[1,2,3],artifact_id:modelId}])('does not silently replace a stale shared alias with a different model match',async alias=>{
    await expect(collectPreviewDependencies(database({aliases:[{id:artifactId,revision:'9',...alias}],objects:[{object_id:'dbid:11',anchor:[1,2,3]}]}).client,projectId,{...input(),from:{name:'Alias'}})).rejects.toMatchObject({code:'PREVIEW_LOCATION_STALE'});
  });
  it('resolves one exact prepared equipment bottom anchor, preserving its object identity',async()=>{
    const result=await collectPreviewDependencies(database({objects:[{object_id:'dbid:11',anchor:[1,2,3]}]}).client,projectId,{...input(),from:{name:' Equipment '}});
    expect(result.from).toMatchObject({point:[1,2,3],objectId:'dbid:11',source:'equipment-bottom-aabb'});
  });
  it.each([{objects:[],code:'PREVIEW_LOCATION_MISSING'},{objects:[{object_id:'1'},{object_id:'2'}],code:'PREVIEW_LOCATION_AMBIGUOUS'}])('fails closed for unresolved endpoint $code',async({code,objects})=>{
    await expect(collectPreviewDependencies(database({objects}).client,projectId,{...input(),from:{name:'Name'}})).rejects.toMatchObject({code});
  });
  it('passes original endpoints, exact settings and reverse flag into unchanged C# calculation semantics',async()=>{
    const dependencies=await collectPreviewDependencies(database().client,projectId,{...input(),reverse:true,secondaryDistanceMeters:3.5,preferVerticalApproach:false});
    const request=previewEngineRequest(dependencies,modelId,60000);
    expect(request).toMatchObject({operation:'calculate',reverse:true,category:'Instrumentation',from:{x:0,y:0,z:.5},to:{x:10,y:0,z:.5},options:{connectionToleranceMeters:1,secondaryDistanceMeters:3.5,preferVerticalApproach:false},projectSettings:{revision:'7',secondaryTrayLength:'5',endConnectionLength:'6',additionalBendingPercent:'10'}});
    expect(request.projectSettings).not.toHaveProperty('connectionGap');
  });
  it('returns exact full metrics/points and design with explicit non-applicable preview provenance',async()=>{
    const dependencies=await collectPreviewDependencies(database().client,projectId,{...input(),reverse:true}),result=previewResultDto(response,dependencies,true);
    expect(result).toMatchObject({canApply:false,engineeringAccepted:false,acceptanceScope:'standalone-preview',stale:true,design:response.design,from:dependencies.to,to:dependencies.from});
    expect(result.route?.points).toEqual([[0,0,.5],[10,0,.5]]);expect(result.route?.objectIds).toEqual(['dbid:12']);expect(result.route?.lengthMeters).toBe(10);
  });
  it('creates only a durable preview job, never a cable, proposal, review or apply receipt',async()=>{
    const db=database(),result=await createPathFinderPreviews(db.pool).create(projectId,who,input());expect(result.duplicate).toBe(false);
    const inserts=db.query.mock.calls.filter(([sql])=>/^\s*INSERT/i.test(sql));expect(inserts).toHaveLength(2);
    expect(inserts[0][0]).toContain('INSERT INTO viewer_login_bindings');expect(inserts[1][0]).toContain("'preview'");expect(inserts[1][0]).toContain('INSERT INTO pf_jobs');
    expect(db.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
  });
  it('deduplicates only the same current principal queued/running preview',async()=>{
    const db=database({duplicate:modelId});await expect(createPathFinderPreviews(db.pool).create(projectId,who,input())).resolves.toEqual({jobId:modelId,duplicate:true});
    expect(db.query.mock.calls.some(([sql])=>sql.includes('INSERT INTO pf_jobs'))).toBe(false);
    const duplicateQuery=db.query.mock.calls.find(([sql])=>sql.startsWith('SELECT id FROM pf_jobs'));expect(duplicateQuery?.[0]).toContain("state IN ('queued','running')");expect(duplicateQuery?.[1]?.slice(0,3)).toEqual([projectId,who.userId,who.loginId]);
  });
  it('checks current administrator authority inside the transaction before enqueueing a preview',async()=>{
    const db=database({admin:false});await expect(createPathFinderPreviews(db.pool).create(projectId,who,input())).rejects.toMatchObject({code:'ADMIN_REQUIRED'});
    expect(db.query.mock.calls.some(([sql])=>sql.includes('INSERT INTO pf_jobs'))).toBe(false);expect(db.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });
  it('does not expose ordinary cable or lookup jobs through preview result reads',async()=>{
    const db=database();await expect(createPathFinderPreviews(db.pool).get(projectId,who,artifactId)).rejects.toMatchObject({code:'PREVIEW_NOT_FOUND'});
    expect(db.query.mock.calls.find(([sql])=>sql.startsWith('SELECT * FROM pf_jobs'))?.[0]).toContain("kind='preview'");
  });
  it('marks retained results stale when Project Details or registry changes after completion',async()=>{
    const base=await collectPreviewDependencies(database().client,projectId,input());
    for (const patch of [{settings:{...settings,pf_settings_revision:'8'}},{registry:'5'}]) {
      const db=database({...patch,job:{id:artifactId,project_id:projectId,state:'complete',kind:'preview',diagnostic_input:base},stored:{result:response,dependencies:base,stale_at_completion:false}});
      const result=await createPathFinderPreviews(db.pool).get(projectId,who,artifactId);expect(result.result?.stale).toBe(true);expect(result.result?.canApply).toBe(false);
    }
  });
});
