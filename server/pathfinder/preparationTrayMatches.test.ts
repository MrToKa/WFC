// @vitest-environment node
import { beforeEach,describe,expect,it,vi } from 'vitest';
import type { Pool,PoolClient } from 'pg';
import type { PreparationContext } from '../../shared/pathfinderPreparation.js';
import { preparationTrayMatchesWriteSchema,type PreparationTrayMatchesWrite } from '../../shared/pathfinderTrayMatches.js';
import { createPreparationService } from './preparationSessions.js';
import { PathFinderError } from './errors.js';
const state=vi.hoisted(()=>({context:null as unknown as PreparationContext,commands:new Map<string,any>(),events:[] as any[],sql:[] as string[],authorized:true,failEvent:false,reads:0}));
vi.mock('./auth.js',()=>({principalTransaction:async(_pool:unknown,_project:string,_who:unknown,operation:(client:PoolClient)=>Promise<unknown>)=>{
  if(!state.authorized)throw new PathFinderError('ADMIN_REQUIRED',403);
  const before=structuredClone({context:state.context,commands:state.commands,events:state.events});
  try{return await operation(client as unknown as PoolClient);}catch(error){Object.assign(state,before);throw error;}
}}));
vi.mock('./preparationPlans.js',async original=>({...await original<typeof import('./preparationPlans.js')>(),
  readPreparationContext:async()=>{state.reads++;return structuredClone(state.context);}}));
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const who={userId:id(8),loginId:id(9),loginExpiresAt:Date.now()+600000};
const client={query:vi.fn(async(sql:string,p:any[]=[])=>{
  state.sql.push(sql);
  if(sql.startsWith('SELECT kind,request_sha256'))return{rows:state.commands.has(p[2])?[structuredClone(state.commands.get(p[2]))]:[]};
  if(sql.startsWith('INSERT INTO pf_preparation_commands')){state.commands.set(p[2],{kind:p[3],request_sha256:p[4],receipt:structuredClone(p[5])});return{rows:[]};}
  if(sql.startsWith('INSERT INTO pf_preparation_resolutions')){if(state.context.resolutions.some(r=>r.projectTrayId===p[1]))throw Error('Would overwrite saved assignment');state.context.resolutions.push(structuredClone(p[2]));return{rows:[]};}
  if(sql.startsWith('INSERT INTO pf_preparation_resolution_events')){if(state.failEvent)throw Error('Synthetic event write failure');state.events.push(structuredClone(p));return{rows:[]};}
  if(sql.startsWith('UPDATE pf_project_preparations SET resolution_revision=')){state.context.scope.resolutionRevision=p[1];return{rows:[]};}
  throw Error('Unexpected assignment SQL: '+sql);
})};
const adapters={validatePart:vi.fn(),validateUnion:vi.fn(),publish:vi.fn()};
const service=()=>createPreparationService({} as Pool,adapters);
const match=(n:number,roots:string[])=>({projectTrayId:id(100+n),rootObjectIds:roots});
function command(matches:PreparationTrayMatchesWrite['matches']=[match(1,['dbid:11'])]):PreparationTrayMatchesWrite{return{
  schemaVersion:'wfc.pf.preparation-tray-matches.write.v1',expected:structuredClone(state.context.scope),idempotencyKey:id(20),
  matchingPolicyVersion:'wfc.pf.project-exact-candidates.v3',complete:true,matches,
};}
function trays(count:number){state.context.trays=Array.from({length:count},(_,i)=>({projectTrayId:id(101+i),rawName:`B${i+1}`,routeName:`/B${i+1}`,
  purposeKey:'LV',allowedCategories:['LV'],policyState:'configured',diagnosticCodes:[]}));}
function saved(n:number,mode:'roots'|'exclude'='roots'){
  const resolution={id:id(200+n),projectTrayId:id(100+n),mode,rootObjectIds:mode==='roots'?[`dbid:${10+n}`]:[],reason:'Operator assignment',
    actorId:who.userId,createdAt:'2026-11-14T00:00:00.000Z',scope:structuredClone(state.context.scope)};
  state.context.resolutions.push(resolution);return resolution;
}
beforeEach(()=>{
  vi.clearAllMocks();state.commands.clear();state.events=[];state.sql=[];state.authorized=true;state.failEvent=false;state.reads=0;
  state.context={schemaVersion:'wfc.pf.preparation-context.v1',projectId:id(1),scope:{modelVersionId:id(2),contentFingerprint:'a'.repeat(64),selectionRevision:'1',
    catalogRevision:'2',routingContentSha256:'b'.repeat(64),routingPolicyRevision:'3',routingPolicySha256:'c'.repeat(64),locationRegistryRevision:'4',resolutionRevision:'0'},
    trays:[],endpointNames:[],resolutions:[],diagnostics:[],currentAggregate:null};trays(1);
});
describe('persisted tray discovery assignments without network preparation',()=>{
  it('assigns unique logical matches in one context read, preserving manual roots and exclusions and reporting every tray',async()=>{
    trays(6);const manual=saved(2),excluded=saved(3,'exclude');manual.scope.modelVersionId=id(99);
    const before=structuredClone([manual,excluded]);
    const input=command([match(1,['dbid:11']),match(2,['dbid:999']),match(3,['dbid:998']),match(4,[]),match(5,['dbid:15','dbid:16']),
      {...match(6,['dbid:61','dbid:62']),candidateRootGroups:[{rootObjectIds:['dbid:61','dbid:62'],identity:{guid:id(61),sourceFile:'source.ifc'}}]}]);
    const result=await service().trayMatches(id(1),who,input);
    expect(result.counts).toEqual({assigned:2,kept:2,missing:1,ambiguous:1});expect(result.resolutionRevision).toBe('2');expect(result.duplicate).toBe(false);
    expect(result.results[5]).toMatchObject({status:'assigned',rootObjectIds:['dbid:61','dbid:62']});
    expect(state.context.resolutions.filter(r=>[id(102),id(103)].includes(r.projectTrayId))).toEqual(before);
    expect(state.context.resolutions).toHaveLength(4);expect(state.events).toHaveLength(2);expect(state.reads).toBe(1);
    expect(state.events.map(e=>e[4])).toEqual(['1','2']);expect(state.events.every(e=>e[5].idempotencyKey===input.idempotencyKey&&!('matches' in e[5]))).toBe(true);
    expect(state.sql.some(sql=>/pf_preparation_sessions|pf_preparation_parts|pf_preparation_aggregates|geometry_revision|current_aggregate_id/.test(sql))).toBe(false);
    expect(adapters.validatePart).not.toHaveBeenCalled();expect(adapters.validateUnion).not.toHaveBeenCalled();expect(adapters.publish).not.toHaveBeenCalled();
  });
  it('replays an exact successful command after its own revision change without renewing scope or adding writes',async()=>{
    const s=service(),input=command(),first=await s.trayMatches(id(1),who,input),writes=state.sql.filter(sql=>sql.startsWith('INSERT')||sql.startsWith('UPDATE')).length;
    state.context.scope.catalogRevision='99';const replay=await s.trayMatches(id(1),who,input);
    expect(replay).toEqual({...first,duplicate:true});expect(state.reads).toBe(1);expect(state.events).toHaveLength(1);
    expect(state.sql.filter(sql=>sql.startsWith('INSERT')||sql.startsWith('UPDATE')).length).toBe(writes);
    await expect(s.trayMatches(id(1),who,{...input,matches:[match(1,['dbid:12'])]})).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
  });
  it('retains current authority checks even for exact replay',async()=>{
    const s=service(),input=command();await s.trayMatches(id(1),who,input);state.authorized=false;
    await expect(s.trayMatches(id(1),who,input)).rejects.toMatchObject({code:'ADMIN_REQUIRED'});expect(state.events).toHaveLength(1);
  });
  it('refuses a stale scope before saving any assignments',async()=>{
    const input=command();state.context.scope.resolutionRevision='1';await expect(service().trayMatches(id(1),who,input)).rejects.toMatchObject({code:'PREPARATION_SCOPE_STALE'});
    expect(state.events).toHaveLength(0);expect(state.context.resolutions).toHaveLength(0);
  });
  it.each(['missing','foreign'] as const)('refuses %s catalog coverage instead of inventing an unsearched result',async kind=>{
    const input=command(kind==='missing'?[]:[match(2,['dbid:12'])]);await expect(service().trayMatches(id(1),who,input)).rejects.toMatchObject({code:'PREPARATION_DISCOVERY_TRAYS'});
    expect(state.commands.size).toBe(0);expect(state.events).toHaveLength(0);
  });
  it('leaves colliding raw roots ambiguous and does not steal a manually assigned root',async()=>{
    trays(4);saved(1);const result=await service().trayMatches(id(1),who,command([match(1,['dbid:11']),match(2,['dbid:11']),match(3,['dbid:30']),match(4,['dbid:30'])]));
    expect(result.counts).toEqual({assigned:0,kept:1,missing:0,ambiguous:3});expect(result.resolutionRevision).toBe('0');expect(state.context.resolutions).toHaveLength(1);
    expect(state.events).toHaveLength(0);expect(state.sql.some(sql=>sql.startsWith('UPDATE'))).toBe(false);
  });
  it('keeps the same GUID from different source files ambiguous',async()=>{
    const input=command([{...match(1,['dbid:11','dbid:12']),candidateRootGroups:[{rootObjectIds:['dbid:11'],identity:{guid:id(60),sourceFile:'a.ifc'}},
      {rootObjectIds:['dbid:12'],identity:{guid:id(60),sourceFile:'b.ifc'}}]}]);
    expect((await service().trayMatches(id(1),who,input)).counts).toEqual({assigned:0,kept:0,missing:0,ambiguous:1});expect(state.events).toHaveLength(0);
  });
  it('rolls back the assignment when its immutable audit cannot be saved',async()=>{
    state.failEvent=true;await expect(service().trayMatches(id(1),who,command())).rejects.toThrow('Synthetic event write failure');
    expect(state.context.resolutions).toHaveLength(0);expect(state.context.scope.resolutionRevision).toBe('0');expect(state.commands.size).toBe(0);
  });
  it.each(['partial','duplicate-tray','duplicate-root','overlapping-groups','unidentified-multiple'] as const)('rejects unsafe discovery evidence %s',async kind=>{
    const input:any=command();if(kind==='partial')input.complete=false;
    if(kind==='duplicate-tray')input.matches.push(input.matches[0]);if(kind==='duplicate-root')input.matches[0].rootObjectIds.push('dbid:11');
    if(kind==='overlapping-groups')input.matches[0].candidateRootGroups=[{rootObjectIds:['dbid:11'],identity:null},{rootObjectIds:['dbid:11'],identity:null}];
    if(kind==='unidentified-multiple'){input.matches[0].rootObjectIds.push('dbid:12');input.matches[0].candidateRootGroups=[{rootObjectIds:['dbid:11','dbid:12'],identity:null}];}
    expect(preparationTrayMatchesWriteSchema.safeParse(input).success).toBe(false);await expect(service().trayMatches(id(1),who,input)).rejects.toThrow();
    expect(state.reads).toBe(0);expect(state.commands.size).toBe(0);
  });
});
