import type {Pool,PoolClient} from 'pg';
import {vi} from 'vitest';
import type {JobPrincipal} from './jobContracts.js';
import type {RecalculationClaim,RecalculationJobAdapter} from './recalculationRepository.js';

/** Entirely synthetic SQL-dispatch fixture, never a database or engineering acceptance. */
export const RECALCULATION_FIXTURE={projectId:'11111111-1111-4111-8111-111111111111',actorId:'22222222-2222-4222-8222-222222222222',loginId:'33333333-3333-4333-8333-333333333333',jobId:'44444444-4444-4444-8444-444444444444',key:'55555555-5555-4555-8555-555555555555',claimId:'66666666-6666-4666-8666-666666666666',owner:'77777777-7777-4777-8777-777777777777'};
type Row=Record<string,any>;
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;
export function recalculationFixture(){
  const f=RECALCULATION_FIXTURE,who:JobPrincipal={userId:f.actorId,loginId:f.loginId,loginExpiresAt:Date.now()+3600000};
  const initial={project_id:f.projectId,control_revision:'1',desired_generation:'2',enrolled_generation:null,authority_epoch:'1',enabled:true,paused:false,actor_id:f.actorId,login_id:f.loginId,login_expires_at:new Date(who.loginExpiresAt).toISOString(),authority_expires_at:new Date(Date.now()+1200000).toISOString(),preferences:{secondaryDistanceMeters:2,preferVerticalApproach:true},timeout_ms:60000,status:'debouncing',reason_codes:['GEOMETRY_CHANGED'],current_job_id:null,completed:0,total:0,ready_cables:0,blocked_cables:0,updated_at:new Date().toISOString(),attempt_generation:null,attempts:0};
  const db:{state:Row;commands:Map<string,Row>;enrollments:Map<string,Row>;claim:Row|null;jobs:Map<string,Row>;authority:boolean;grantEnabled:boolean;projectExists:boolean;events:string[];queries:string[];rollbackFails:boolean;commitLost:boolean}={state:initial,commands:new Map(),enrollments:new Map(),claim:null,jobs:new Map(),authority:true,grantEnabled:false,projectExists:true,events:[],queries:[],rollbackFails:false,commitLost:false};
  let saved:{state:Row;commands:Array<[string,Row]>;enrollments:Array<[string,Row]>;claim:Row|null;jobs:Array<[string,Row]>}|undefined;
  const result=(rows:Row[]=[])=>({rows,rowCount:rows.length});
  const query=vi.fn(async(raw:string|{text:string},p:any[]=[])=>{
    const sql=typeof raw==='string'?raw:raw.text;db.queries.push(sql);
    if(sql==='BEGIN'){saved=clone({state:db.state,commands:[...db.commands],enrollments:[...db.enrollments],claim:db.claim,jobs:[...db.jobs]});return result();}
    if(sql.startsWith('SET LOCAL'))return result();
    if(sql==='COMMIT'){saved=undefined;if(db.commitLost)throw new Error('synthetic lost acknowledgement');return result();}
    if(sql==='ROLLBACK'){if(db.rollbackFails)throw new Error('synthetic rollback lost');if(saved){db.state=saved.state;db.commands=new Map(saved.commands);db.enrollments=new Map(saved.enrollments);db.claim=saved.claim;db.jobs=new Map(saved.jobs);}saved=undefined;return result();}
    if(sql.startsWith('SELECT id FROM projects'))return result(db.projectExists?[{id:f.projectId}]:[]);
    if(sql.startsWith("SELECT (r.record->>'enabled')::boolean"))return result([{enabled:db.grantEnabled}]);
    if(sql.startsWith('SELECT is_admin FROM users'))return result([{is_admin:db.authority}]);
    if(sql.startsWith('INSERT INTO viewer_login_bindings'))return result();
    if(sql.startsWith('SELECT user_id,expires_at,revoked_at FROM viewer_login_bindings'))return result([{user_id:f.actorId,expires_at:new Date(who.loginExpiresAt),revoked_at:null}]);
    if(sql.startsWith('SELECT u.is_admin,l.user_id'))return result([{is_admin:db.authority,user_id:f.actorId,revoked_at:null,expires_at:new Date(who.loginExpiresAt)}]);
    if(sql.startsWith('SELECT *,control_revision::text'))return result([clone(db.state)]);
    if(sql.includes('automatic-generation:enable-principal'))return result([{is_admin:db.authority,admin_revision:'1',installation_epoch:f.owner}]);
    if(sql.startsWith('SELECT request_sha256,receipt'))return result(db.commands.has(p[2])?[db.commands.get(p[2])!]:[]);
    if(sql.startsWith('SELECT count(*)::text'))return result([{count:String(db.commands.size)}]);
    if(sql.startsWith('INSERT INTO pf_recalculation_commands')){db.commands.set(p[2],{request_sha256:p[3],request:clone(p[4]),receipt:clone(p[5])});return result();}
    if(sql.startsWith('UPDATE pf_recalculation_state SET control_revision')){Object.assign(db.state,{control_revision:String(BigInt(db.state.control_revision)+1n),authority_epoch:String(BigInt(db.state.authority_epoch)+1n),enabled:p[1],paused:p[2],preferences:p[8],timeout_ms:p[9],status:p[10],reason_codes:JSON.parse(p[11]),automatic_pair_authority:p[12]??null});if(p[3])Object.assign(db.state,{actor_id:p[4],login_id:p[5],login_expires_at:p[6],authority_expires_at:p[7]});return result();}
    if(sql.startsWith('SELECT pf_recalculation_dirty')){db.state.desired_generation=String(BigInt(db.state.desired_generation)+1n);db.state.status='debouncing';db.events.push(p[2]);return result();}
    if(sql.startsWith('UPDATE pf_jobs SET cancel_requested'))return result();
    if(sql.startsWith('SELECT state,cancel_requested'))return result(db.jobs.has(p[1])?[db.jobs.get(p[1])!]:[]);
    if(sql.includes('recalculation:progress'))return result();
    if(sql.startsWith('SELECT job_id FROM pf_recalculation_enrollments'))return result(db.enrollments.has(p[1])?[db.enrollments.get(p[1])!]:[]);
    if(sql.startsWith('SELECT *,generation::text'))return result(db.claim?[clone(db.claim)]:[]);
    if(sql.startsWith('INSERT INTO pf_recalculation_enrollments')){if(db.enrollments.has(p[1]))throw new Error('duplicate synthetic generation');db.enrollments.set(p[1],{job_id:p[7],input_sha256:p[8]});return result();}
    if(sql.startsWith('UPDATE pf_recalculation_state SET enrolled_generation')){Object.assign(db.state,{enrolled_generation:p[1],current_job_id:p[2],status:p[3],reason_codes:JSON.parse(p[4]),total:p[5],completed:p[6],ready_cables:p[7],blocked_cables:p[8]});return result();}
    if(sql.startsWith('UPDATE pf_recalculation_state s SET status=CASE')){if(db.state.desired_generation===p[1]&&db.state.authority_epoch===p[2]){db.state.status=p[4]?'awaiting_authority':p[5]?'debouncing':'blocked';db.state.reason_codes=JSON.parse(p[3]);}return result();}
    if(sql.startsWith('UPDATE pf_recalculation_claims SET lease_until'))return result();
    throw new Error('Unexpected synthetic SQL: '+sql.slice(0,100));
  });
  const release=vi.fn(),client={query,release} as unknown as PoolClient,pool={connect:vi.fn(async()=>client),query} as unknown as Pool;
  const claim:RecalculationClaim={projectId:f.projectId,generation:'2',controlRevision:'1',authorityEpoch:'1',claimId:f.claimId,ownerToken:f.owner,leaseExpiresAt:new Date(Date.now()+60000).toISOString(),principal:who,preferences:initial.preferences,timeoutMilliseconds:60000};
  db.claim={claim_id:claim.claimId,owner_token:claim.ownerToken,generation:claim.generation,control_revision:claim.controlRevision,authority_epoch:claim.authorityEpoch,lease_until:claim.leaseExpiresAt};
  const adapter:RecalculationJobAdapter={createInTransaction:vi.fn(async(c,input)=>{await input.beforeInsert();db.jobs.set(f.jobId,{state:'queued',cancel_requested:false,completed:0,total:3});return {jobId:f.jobId,inputSha256:'a'.repeat(64),duplicate:false,readyCables:2,blockedCables:1,total:3,reasonCodes:['LOCATIONS_REQUIRED']};})};
  return {db,pool,client,query,release,who,claim,adapter};
}
