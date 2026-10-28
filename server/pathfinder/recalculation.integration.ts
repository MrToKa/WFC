/** Source-only root-invokable rollback controls; importing this module opens no connection. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {isIP} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {policyUuidSchema} from '../../shared/pathfinderPurposePolicy.js';
import {defaultOptions} from './jobContracts.js';
import {recalculationTransaction,readRecalculationJobAuthority} from './recalculationRepository.js';
import {markRecalculationDirty} from './recalculationSchema.js';

const PROJECT='56eadef6-8382-49f8-a652-c8f12026602e',ACTOR='9ac1ea26-8bee-4719-87c5-1693df5682b4',MODEL='098a7e6f-6e39-4935-a98b-ba3b683875a5',EMAIL=`${ACTOR}@pf-r3-ui.invalid`;
const phases=['events-coalesce','details-event','drawing-ignore','apply-marker-ignore','cable-statement','generation-fence','authority-expiry','authority-revocation','immutable','foreign-key','fencing-role','fencing-login','fencing-state','cable-state-order'] as const;
export const recalculationControlInputSchema=z.object({
  schemaVersion:z.literal('wfc.pf.recalculation-control.v1'),phase:z.enum(phases),phaseIntentId:policyUuidSchema,intentCreatedAt:z.string().datetime(),
  projectId:z.literal(PROJECT),actorEmail:z.literal(EMAIL),expectedActiveModelVersionId:z.literal(MODEL),
  principal:z.object({userId:z.literal(ACTOR),loginId:policyUuidSchema,loginExpiresAt:z.number().int().positive()}).strict(),
  expectedDatabaseUser:z.literal('pf_local'),expectedServerAddress:z.string().min(1).max(64).refine(value=>{const parts=value.split('/'),family=isIP(parts[0]);return parts.length<=2&&family!==0&&(parts.length===1||parts[1]===(family===4?'32':'128'));}),
  fixtureCableIds:z.array(policyUuidSchema).length(3).refine(ids=>new Set(ids).size===3),
  ownedIds:z.object({jobId:policyUuidSchema,commandKey:policyUuidSchema,foreignJobId:policyUuidSchema}).strict(),
}).strict().superRefine((value,ctx)=>{const ids=[value.phaseIntentId,value.principal.loginId,...value.fixtureCableIds,...Object.values(value.ownedIds)];if(new Set(ids).size!==ids.length||ids.some(id=>[PROJECT,ACTOR,MODEL].includes(id)))ctx.addIssue({code:'custom',message:'Each control needs exact distinct retained and fresh host-owned identities.'});});
export type RecalculationControlInput=z.infer<typeof recalculationControlInputSchema>;
const tables=['pf_recalculation_state','pf_recalculation_claims','pf_recalculation_enrollments','pf_recalculation_commands','pf_recalculation_events'] as const;
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
const errorCode=(error:unknown)=>(error as {code?:string})?.code;

export async function rollbackRecalculationControl(c:PoolClient):Promise<void>{
  let discard=false;try{await c.query('ROLLBACK');}catch(error){discard=true;throw new Error('Owned recalculation control rollback is unconfirmed.',{cause:error});}finally{c.release(discard?true:undefined);}
}
async function rollbackOnly<T>(pool:Pool,operation:(c:PoolClient)=>Promise<T>):Promise<T>{
  const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='3000ms';SET LOCAL statement_timeout='5000ms';SET LOCAL idle_in_transaction_session_timeout='12000ms'");return await operation(c);}finally{await rollbackRecalculationControl(c);}
}
async function refuse(c:PoolClient,operation:()=>Promise<unknown>,expected:string):Promise<void>{
  await c.query('SAVEPOINT recalculation_refusal');try{await assert.rejects(operation,error=>errorCode(error)===expected);}finally{await c.query('ROLLBACK TO SAVEPOINT recalculation_refusal');await c.query('RELEASE SAVEPOINT recalculation_refusal');}
}
async function preservation(pool:Pool,input:RecalculationControlInput):Promise<string>{
  const members=tables.map(table=>`'${table}',(SELECT jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text) FROM ${table} r WHERE project_id=$1)`);
  const row=(await pool.query<{proof:string}>(`SELECT jsonb_build_object(${members.join(',')},
    'project',(SELECT to_jsonb(r) FROM projects r WHERE id=$1),
    'selection',(SELECT to_jsonb(r) FROM project_model_selections r WHERE project_id=$1),
    'preparation',(SELECT to_jsonb(r) FROM pf_project_preparations r WHERE project_id=$1),
    'registry',(SELECT to_jsonb(r) FROM pf_project_state r WHERE project_id=$1),
    'policy',(SELECT to_jsonb(r) FROM pf_purpose_project_state r WHERE project_id=$1),
    'catalogEvents',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM pf_catalog_events r WHERE project_id=$1),
    'actor',(SELECT jsonb_build_object('email',email,'role',role,'is_admin',is_admin) FROM users WHERE id=$2),
    'login',(SELECT to_jsonb(r) FROM viewer_login_bindings r WHERE login_id=$3),
    'cables',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM cables r WHERE project_id=$1),
    'jobs',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM pf_jobs r WHERE project_id=$1),
    'items',(SELECT jsonb_agg(to_jsonb(r) ORDER BY job_id,cable_id) FROM pf_job_items r WHERE project_id=$1),
    'proposals',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM pf_proposals r WHERE project_id=$1),
    'applies',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM pf_apply_receipts r WHERE project_id=$1))::text AS proof`,[PROJECT,ACTOR,input.principal.loginId])).rows[0];
  assert.ok(row&&typeof row.proof==='string');assert.ok(Buffer.byteLength(row.proof)<=16*1024**2,'Control preservation exceeds the bounded synthetic scope.');return digest(row.proof);
}
async function guard(pool:Pool,input:RecalculationControlInput):Promise<void>{
  assert.ok(pool.options.max!==undefined&&pool.options.max>=3&&pool.options.max<=6);
  assert.ok(pool.options.connectionTimeoutMillis!==undefined&&pool.options.connectionTimeoutMillis>0&&pool.options.connectionTimeoutMillis<=5000);
  assert.ok(pool.options.query_timeout!==undefined&&pool.options.query_timeout>0&&pool.options.query_timeout<=6000);
  assert.ok(input.principal.loginExpiresAt>Date.now()+60000);assert.ok(Math.abs(Date.now()-Date.parse(input.intentCreatedAt))<86400000);
  await rollbackOnly(pool,async c=>{
    assert.deepEqual((await c.query('SELECT current_database() AS database,current_user AS username,inet_server_addr()::text AS address,inet_server_port() AS port')).rows[0],{database:'wfc_pathfinder_local',username:input.expectedDatabaseUser,address:input.expectedServerAddress,port:5432});
    assert.deepEqual((await c.query('SELECT project_number,name FROM projects WHERE id=$1',[PROJECT])).rows[0],{project_number:`PF-R3-UI-${PROJECT}`,name:`PF-R3-UI-${PROJECT}`});
    assert.deepEqual((await c.query('SELECT email,is_admin,role FROM users WHERE id=$1',[ACTOR])).rows[0],{email:EMAIL,is_admin:true,role:'admin'});
    const login=(await c.query('SELECT user_id,expires_at,revoked_at FROM viewer_login_bindings WHERE login_id=$1',[input.principal.loginId])).rows[0];assert.ok(login);assert.equal(login.user_id,ACTOR);assert.equal(login.revoked_at,null);assert.equal(new Date(login.expires_at).getTime(),input.principal.loginExpiresAt);
    assert.equal((await c.query('SELECT active_model_version_id FROM project_model_selections WHERE project_id=$1',[PROJECT])).rows[0]?.active_model_version_id,MODEL);
    const cables=(await c.query<{id:string;from_location:string|null;to_location:string|null}>('SELECT id,from_location,to_location FROM cables WHERE project_id=$1 ORDER BY id',[PROJECT])).rows;assert.equal(cables.length,3);assert.deepEqual(cables.map(row=>row.id).sort(),[...input.fixtureCableIds].sort());
    const endpointNames=new Set(['PF-R5-A','PF-R5-A-ALIAS','PF-R5-B']);for(const cable of cables)for(const endpoint of [cable.from_location,cable.to_location])assert.ok(endpoint===null||endpointNames.has(endpoint),'The exact owned cables must retain their bounded R5 endpoint namespace.');
    assert.equal((await c.query("SELECT id FROM pf_jobs WHERE project_id=$1 AND state IN('queued','running')",[PROJECT])).rows.length,0,'Quiesce only the owned fixture calculation jobs before rollback controls.');
    assert.equal((await c.query('SELECT id FROM pf_jobs WHERE id=ANY($1::uuid[])',[Object.values(input.ownedIds)])).rows.length,0);
    assert.equal((await c.query('SELECT 1 FROM pf_recalculation_commands WHERE project_id=$1 AND idempotency_key=$2',[PROJECT,input.ownedIds.commandKey])).rows.length,0);
    assert.equal((await c.query('SELECT project_id FROM pf_recalculation_state WHERE project_id=$1',[PROJECT])).rows.length,1);
  });
}
async function generation(c:PoolClient):Promise<bigint>{return BigInt((await c.query<{generation:string}>('SELECT desired_generation::text AS generation FROM pf_recalculation_state WHERE project_id=$1',[PROJECT])).rows[0].generation);}
async function syntheticEnrollment(c:PoolClient,input:RecalculationControlInput):Promise<void>{
  await markRecalculationDirty(c,{projectId:PROJECT,domain:'manual',reason:'ROLLBACK_CONTROL',sourceRevision:input.phaseIntentId});
  await c.query(`UPDATE pf_recalculation_state SET enabled=true,paused=false,actor_id=$2,login_id=$3,login_expires_at=$4,authority_expires_at=$5,authority_epoch=authority_epoch+1,
    preferences=$6,timeout_ms=60000,status='queued',current_job_id=NULL WHERE project_id=$1`,[PROJECT,ACTOR,input.principal.loginId,new Date(input.principal.loginExpiresAt),new Date(Math.min(input.principal.loginExpiresAt,Date.now()+60000)),{secondaryDistanceMeters:2,preferVerticalApproach:true}]);
  await c.query(`INSERT INTO pf_jobs(id,project_id,requested_by,login_id,login_expires_at,state,total,completed,options,timeout_ms,request_hash) VALUES($1,$2,$3,$4,$5,'queued',3,0,$6,60000,$7)`,[input.ownedIds.jobId,PROJECT,ACTOR,input.principal.loginId,new Date(input.principal.loginExpiresAt),defaultOptions,'a'.repeat(64)]);
  await c.query(`INSERT INTO pf_recalculation_enrollments(project_id,generation,control_revision,authority_epoch,actor_id,login_id,authority_expires_at,job_id,input_sha256,total,ready_cables,blocked_cables,reason_codes)
    SELECT project_id,desired_generation,control_revision,authority_epoch,actor_id,login_id,authority_expires_at,$2,$3,3,3,0,'[]' FROM pf_recalculation_state WHERE project_id=$1`,[PROJECT,input.ownedIds.jobId,'b'.repeat(64)]);
  await c.query('UPDATE pf_recalculation_state SET current_job_id=$2,enrolled_generation=desired_generation WHERE project_id=$1',[PROJECT,input.ownedIds.jobId]);
  assert.deepEqual(await readRecalculationJobAuthority(c,{projectId:PROJECT,jobId:input.ownedIds.jobId}),{enrolled:true,valid:true,code:'AUTOMATIC_AUTHORITY_CURRENT',generation:String(await generation(c)),authorityEpoch:(await c.query('SELECT authority_epoch::text AS epoch FROM pf_recalculation_state WHERE project_id=$1',[PROJECT])).rows[0].epoch});
}
async function fence(pool:Pool,input:RecalculationControlInput):Promise<void>{
  const writer=await pool.connect();let observer:PoolClient|undefined,primary:Promise<unknown>|undefined,mutation:Promise<unknown>|undefined,writerReleased=false,release!:()=>void,entered!:(pid:number)=>void;
  const barrier=new Promise<void>(r=>{release=r;}),ready=new Promise<number>(r=>{entered=r;});
  try{
    observer=await pool.connect();await writer.query('BEGIN');await writer.query("SET LOCAL lock_timeout='4000ms';SET LOCAL statement_timeout='5000ms';SET LOCAL idle_in_transaction_session_timeout='12000ms'");
    const writerPid=(await writer.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    if(input.phase==='cable-state-order'){
      await writer.query('SELECT id FROM cables WHERE project_id=$1 AND id=$2 FOR UPDATE',[PROJECT,input.fixtureCableIds[0]]);
      let readerPid!:number;primary=recalculationTransaction(pool,PROJECT,input.principal,async c=>{readerPid=(await c.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0].pid;entered(readerPid);await c.query('SELECT id FROM cables WHERE project_id=$1 AND id=$2 FOR UPDATE',[PROJECT,input.fixtureCableIds[0]]);await c.query('SELECT project_id FROM pf_recalculation_state WHERE project_id=$1 FOR UPDATE',[PROJECT]);});void primary.catch(()=>undefined);await Promise.race([ready,primary.then(()=>{throw new Error('Collector did not enter the held barrier.');})]);
      const until=performance.now()+1500;let blocked=false;while(performance.now()<until){if((await observer.query<{blockers:number[]}>('SELECT pg_blocking_pids($1) AS blockers',[readerPid])).rows[0].blockers.includes(writerPid)){blocked=true;break;}await delay(25);}assert.ok(blocked);
      // The collector does not own scheduler state while waiting for the cable.
      await writer.query("UPDATE cables SET tag=COALESCE(tag,'')||'~PF-R7-ROLLBACK' WHERE project_id=$1 AND id=$2",[PROJECT,input.fixtureCableIds[0]]);writerReleased=true;await rollbackRecalculationControl(writer);await primary;return;
    }
    primary=recalculationTransaction(pool,PROJECT,input.principal,async c=>{if(input.phase==='fencing-state')await c.query('SELECT project_id FROM pf_recalculation_state WHERE project_id=$1 FOR SHARE',[PROJECT]);entered((await c.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0].pid);await barrier;});void primary.catch(()=>undefined);
    const holderPid=await Promise.race([ready,primary.then(()=>{throw new Error('Production authority transaction did not enter the barrier.');})]);
    mutation=input.phase==='fencing-role'?writer.query('UPDATE users SET is_admin=is_admin WHERE id=$1 AND email=$2',[ACTOR,EMAIL]):input.phase==='fencing-login'?writer.query('UPDATE viewer_login_bindings SET expires_at=expires_at WHERE login_id=$1 AND user_id=$2',[input.principal.loginId,ACTOR]):writer.query('UPDATE pf_recalculation_state SET control_revision=control_revision WHERE project_id=$1',[PROJECT]);void mutation.catch(()=>undefined);
    const until=performance.now()+1500;let blocked=false;while(performance.now()<until){if((await observer.query<{blockers:number[]}>('SELECT pg_blocking_pids($1) AS blockers',[writerPid])).rows[0].blockers.includes(holderPid)){blocked=true;break;}await delay(25);}assert.ok(blocked,'Exact production transaction must fence the owned row edit.');release();await primary;await mutation;
  }finally{
    release();try{
      // This owner may block the collector's cable read. Roll it back BEFORE joining that read.
      if(input.phase==='cable-state-order'&&!writerReleased){writerReleased=true;await rollbackRecalculationControl(writer);}
      await primary?.catch(()=>undefined);await mutation?.catch(()=>undefined);
    }finally{try{if(!writerReleased){writerReleased=true;await rollbackRecalculationControl(writer);}}finally{observer?.release();}}
  }
}

/** Every mutable probe is rollback-only. Normal HTTP enrollment/worker/UI is tested separately by root. */
export async function runRecalculationControl(pool:Pool,raw:unknown){
  const input=recalculationControlInputSchema.parse(raw),started=performance.now();await guard(pool,input);const before=await preservation(pool,input);let failure:unknown;
  try{
    if(input.phase.startsWith('fencing-')||input.phase==='cable-state-order')await fence(pool,input);
    else await rollbackOnly(pool,async c=>{
      await c.query('SELECT id FROM projects WHERE id=$1 FOR NO KEY UPDATE',[PROJECT]);const initial=await generation(c);
      if(input.phase==='events-coalesce'){
        await markRecalculationDirty(c,{projectId:PROJECT,domain:'manual',reason:'ROLLBACK_EVENT_ONE',sourceRevision:input.phaseIntentId});await markRecalculationDirty(c,{projectId:PROJECT,domain:'manual',reason:'ROLLBACK_EVENT_TWO',sourceRevision:input.phaseIntentId});assert.equal(await generation(c),initial+2n);
        const row=(await c.query('SELECT due_at,first_dirty_at FROM pf_recalculation_state WHERE project_id=$1',[PROJECT])).rows[0];assert.ok(new Date(row.due_at).getTime()-new Date(row.first_dirty_at).getTime()<=5000);assert.equal((await c.query('SELECT job_id FROM pf_recalculation_enrollments WHERE project_id=$1 AND generation>$2',[PROJECT,initial.toString()])).rows.length,0);
      }else if(input.phase==='details-event'){
        await c.query('UPDATE projects SET end_connection_length=COALESCE(end_connection_length,0)+0.01 WHERE id=$1',[PROJECT]);assert.equal(await generation(c),initial+1n);
      }else if(input.phase==='drawing-ignore'){
        await c.query(`UPDATE projects SET cable_layout_settings=COALESCE(cable_layout_settings,'{}'::jsonb)||jsonb_build_object('pf_r7_rollback_probe',$2::text) WHERE id=$1`,[PROJECT,input.phaseIntentId]);assert.equal(await generation(c),initial);
      }else if(input.phase==='apply-marker-ignore'){
        await c.query("SELECT set_config('wfc.pathfinder_apply','1',true)");await c.query('UPDATE cables SET design_length=COALESCE(design_length,0)+1 WHERE project_id=$1 AND id=$2',[PROJECT,input.fixtureCableIds[0]]);assert.equal(await generation(c),initial);
      }else if(input.phase==='cable-statement'){
        await c.query("UPDATE cables SET tag=COALESCE(tag,'')||'~PF-R7-ROLLBACK' WHERE project_id=$1 AND id=ANY($2::uuid[])",[PROJECT,input.fixtureCableIds]);assert.equal(await generation(c),initial+1n);
      }else{
        await syntheticEnrollment(c,input);
        if(input.phase==='generation-fence'){await markRecalculationDirty(c,{projectId:PROJECT,domain:'manual',reason:'ROLLBACK_SUPERSEDED'});assert.equal((await readRecalculationJobAuthority(c,{projectId:PROJECT,jobId:input.ownedIds.jobId}) as {code:string}).code,'AUTOMATIC_GENERATION_SUPERSEDED');}
        else if(input.phase==='authority-expiry'){await c.query("UPDATE pf_recalculation_state SET authority_expires_at=clock_timestamp()-interval '1 second' WHERE project_id=$1",[PROJECT]);assert.equal((await readRecalculationJobAuthority(c,{projectId:PROJECT,jobId:input.ownedIds.jobId}) as {valid:boolean}).valid,false);}
        else if(input.phase==='authority-revocation'){await c.query('UPDATE viewer_login_bindings SET revoked_at=clock_timestamp() WHERE login_id=$1 AND user_id=$2',[input.principal.loginId,ACTOR]);assert.equal((await readRecalculationJobAuthority(c,{projectId:PROJECT,jobId:input.ownedIds.jobId}) as {valid:boolean}).valid,false);}
        else if(input.phase==='immutable'){await refuse(c,()=>c.query('UPDATE pf_recalculation_enrollments SET input_sha256=input_sha256 WHERE project_id=$1 AND job_id=$2',[PROJECT,input.ownedIds.jobId]),'P0001');const marker={scope:'rollback-only R7 mechanics',phaseIntentId:input.phaseIntentId};await c.query('INSERT INTO pf_recalculation_commands(project_id,actor_id,idempotency_key,request_sha256,request,receipt) VALUES($1,$2,$3,$4,$5,$5)',[PROJECT,ACTOR,input.ownedIds.commandKey,'c'.repeat(64),marker]);await refuse(c,()=>c.query('DELETE FROM pf_recalculation_commands WHERE project_id=$1 AND actor_id=$2 AND idempotency_key=$3',[PROJECT,ACTOR,input.ownedIds.commandKey]),'P0001');}
        else if(input.phase==='foreign-key')await refuse(c,()=>c.query('UPDATE pf_recalculation_state SET current_job_id=$2 WHERE project_id=$1',[PROJECT,input.ownedIds.foreignJobId]),'23503');
        else assert.fail('Unknown phase.');
      }
    });
  }catch(error){failure=error;}
  const after=await preservation(pool,input);assert.equal(after,before,'All five scheduler tables and retained fixture core state must be exact after confirmed rollback.');if(failure)throw failure;const elapsedMilliseconds=Math.round(performance.now()-started);assert.ok(elapsedMilliseconds<20000,'The independent control exceeded its explicit deadline.');
  return {schemaVersion:'wfc.pf.recalculation-control-result.v1',phase:input.phase,phaseIntentId:input.phaseIntentId,status:'PASS',scope:'rollback-only production SQL primitives and reader; normal HTTP/producer/engine/UI tested separately',beforeSha256:before,afterSha256:after,elapsedMilliseconds,nontransactionalSequenceAdvances:[],engineeringAccepted:false};
}
