import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { RECALCULATION_LIMITS, recalculationCommandSchema, recalculationContextSchema, recalculationReceiptSchema, recalculationPreferencesSchema, recalculationReasonSchema, type RecalculationCommand, type RecalculationContext, type RecalculationReceipt, type RecalculationPreferences } from '../../shared/pathfinderRecalculation.js';
import { canonicalPurposeJson, policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { assertLoginNotExpired, requireCurrentLogin } from './auth.js';
import type { JobPrincipal } from './jobContracts.js';
import type { OperationPrincipal } from './operationAuthority.js';
import { readGrantJobAuthority } from './grantJobAuthority.js';
import { PathFinderError } from './errors.js';
import { markRecalculationDirty } from './recalculationSchema.js';
import { readLocationImpactJobAuthority } from './locationImpactRepository.js';

type Row = Record<string, any>;
const hash = (value: unknown): string => createHash('sha256').update(canonicalPurposeJson(value)).digest('hex');
const fail = (code: string, status = 409): never => { throw new PathFinderError(code,status,'The recalculation request is unavailable or changed. Retain an uncertain command and refresh its context.'); };
const iso = (value: string | Date): string => new Date(value).toISOString();
const revision = (value: unknown): string => {
  if (typeof value !== 'string' || /^(?:0|[1-9][0-9]{0,18})$/.exec(value)?.[0] !== value || BigInt(value)>9223372036854775807n) return fail('RECALCULATION_STORAGE_INVALID',500);
  return value;
};
const reasons = (values: unknown): string[] => {
  if (!Array.isArray(values) || values.length > 64) return fail('RECALCULATION_STORAGE_INVALID',500);
  return [...new Set(values.map(value=>recalculationReasonSchema.parse(value)))];
};
export const RECALCULATION_SQL_BOUNDS = Object.freeze({acquisitionMilliseconds:5000,lockMilliseconds:3000,statementMilliseconds:15000,idleMilliseconds:30000,claimMilliseconds:60000,commandReceipts:4096});
async function connect(pool: Pool): Promise<PoolClient> {
  let expired=false,timer:ReturnType<typeof setTimeout>|undefined;
  const pending=pool.connect().then(c=>{if(expired){c.release();return fail('RECALCULATION_DATABASE_BUSY',503);}return c;});
  try{return await Promise.race([pending,new Promise<never>((_,reject)=>{timer=setTimeout(()=>{expired=true;reject(new PathFinderError('RECALCULATION_DATABASE_BUSY',503));},5000);})]);}
  finally{if(timer)clearTimeout(timer);}
}
/** State locks are intentionally absent here: the enrollment callback takes them LAST. */
export async function recalculationTransaction<T>(pool:Pool,projectId:string,who:JobPrincipal,operation:(client:PoolClient)=>Promise<T>,signal?:AbortSignal):Promise<T>{
  policyUuidSchema.parse(projectId);policyUuidSchema.parse(who.userId);policyUuidSchema.parse(who.loginId);assertLoginNotExpired(who);signal?.throwIfAborted();
  const c=await connect(pool);let committing=false,discard=false;
  try{
    await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='3000ms';SET LOCAL statement_timeout='15000ms';SET LOCAL idle_in_transaction_session_timeout='30000ms'");
    const exists=(await c.query('SELECT id FROM projects WHERE id=$1 FOR NO KEY UPDATE',[projectId])).rows.length===1;
    const account=(await c.query<{is_admin:boolean}>('SELECT is_admin FROM users WHERE id=$1 FOR SHARE',[who.userId])).rows[0];
    if(!account)return fail('LOGIN_REVOKED',401);if(!account.is_admin)return fail('ADMIN_REQUIRED',403);
    await requireCurrentLogin(c,who);if(!exists)return fail('PROJECT_NOT_FOUND',404);
    signal?.throwIfAborted();const value=await operation(c);signal?.throwIfAborted();assertLoginNotExpired(who);committing=true;await c.query('COMMIT');return value;
  }catch(error){discard=committing;try{await c.query('ROLLBACK');}catch{discard=true;}
    if(committing)return fail('RECALCULATION_COMMIT_OUTCOME_UNKNOWN',503);
    if(['55P03','57014'].includes((error as {code?:string})?.code??''))return fail('RECALCULATION_DATABASE_BUSY',503);
    throw error;
  }finally{c.release(discard?true:undefined);}
}
async function state(c:PoolClient,projectId:string,lock=false):Promise<Row>{
  const row=(await c.query<Row>(`SELECT *,control_revision::text,desired_generation::text,enrolled_generation::text,authority_epoch::text,attempt_generation::text FROM pf_recalculation_state WHERE project_id=$1${lock?' FOR UPDATE':''}`,[projectId])).rows[0];
  if(!row)return fail('RECALCULATION_STATE_REQUIRED',409);return row;
}
async function storedAuthority(c:PoolClient,s:Row):Promise<boolean>{
  if(!s.actor_id||!s.login_id||!s.login_expires_at||!s.authority_expires_at||new Date(s.authority_expires_at).getTime()<=Date.now())return false;
  const row=(await c.query<{is_admin:boolean;user_id:string;revoked_at:Date|null;expires_at:Date}>(`SELECT u.is_admin,l.user_id,l.revoked_at,l.expires_at FROM users u JOIN viewer_login_bindings l ON l.login_id=$2 WHERE u.id=$1`,[s.actor_id,s.login_id])).rows[0];
  return !!row&&row.is_admin&&row.user_id===s.actor_id&&!row.revoked_at&&new Date(row.expires_at).getTime()===new Date(s.login_expires_at).getTime()&&new Date(row.expires_at).getTime()>Date.now();
}
async function context(c:PoolClient,projectId:string,who:JobPrincipal,s?:Row):Promise<RecalculationContext>{
  s??=await state(c,projectId);const live=await storedAuthority(c,s);
  const currentGeneration=s.enrolled_generation!==null&&s.enrolled_generation===s.desired_generation;
  let status=s.status,reasonCodes=reasons(s.reason_codes),completed=currentGeneration?s.completed:0,total=currentGeneration?s.total:0;
  if(!s.enabled)status='disabled';else if(s.paused)status='paused';else if(!live){status='awaiting_authority';reasonCodes=[...new Set(['ADMINISTRATOR_ENROLLMENT_REQUIRED',...reasonCodes])].slice(0,64);}
  else if(s.engine_unavailable_code){status='blocked';reasonCodes=[...new Set([recalculationReasonSchema.parse(s.engine_unavailable_code),...reasonCodes])].slice(0,64);}
  if(s.current_job_id&&currentGeneration){
    const job=(await c.query<Row>('SELECT state,cancel_requested,completed,total FROM pf_jobs WHERE project_id=$1 AND id=$2',[projectId,s.current_job_id])).rows[0];
    if(job){
      completed=job.completed;total=job.total;
      if(live&&!s.paused&&s.enabled&&!s.engine_unavailable_code)status=job.cancel_requested||job.state==='cancelled'?'failed':job.state==='running'?'calculating':job.state==='queued'?'queued':job.state==='failed'?'failed':'complete';
    }
  }
  const value=recalculationContextSchema.parse({schemaVersion:'wfc.pf.recalculation-context.v1',projectId,controlRevision:revision(s.control_revision),desiredGeneration:revision(s.desired_generation),enrolledGeneration:s.enrolled_generation===null?null:revision(s.enrolled_generation),status,enabled:s.enabled,paused:s.paused,
    authority:s.actor_id?{kind:'current-login',actorId:s.actor_id,expiresAt:iso(s.authority_expires_at),currentLogin:s.actor_id===who.userId&&s.login_id===who.loginId}:null,
    reasonCodes,jobId:s.current_job_id,completed,total,readyCables:currentGeneration?s.ready_cables:0,blockedCables:currentGeneration?s.blocked_cables:0,updatedAt:iso(s.updated_at),preferences:s.preferences===null?null:recalculationPreferencesSchema.parse(s.preferences),timeoutMilliseconds:s.timeout_ms});
  if(Buffer.byteLength(canonicalPurposeJson(value))>RECALCULATION_LIMITS.responseBytes)return fail('RECALCULATION_RESPONSE_LIMIT',413);return value;
}

export type RecalculationClaim={projectId:string;generation:string;controlRevision:string;authorityEpoch:string;claimId:string;ownerToken:string;leaseExpiresAt:string;principal:JobPrincipal;preferences:RecalculationPreferences;timeoutMilliseconds:number};
export type RecalculationJobAdmission={jobId:string|null;inputSha256:string;duplicate:boolean;readyCables:number;blockedCables:number;total:number;reasonCodes:string[]};
export type RecalculationJobAdapter={createInTransaction(client:PoolClient,input:{projectId:string;principal:OperationPrincipal;scope:'project';preferences:RecalculationPreferences;timeoutMilliseconds:number;signal:AbortSignal;beforeInsert():Promise<void>}):Promise<RecalculationJobAdmission>};
export type RecalculationEnrollmentResult={status:'enrolled'|'blocked'|'duplicate'|'superseded';generation:string;jobId:string|null};

export type RecalculationJobAuthority={enrolled:false}|{enrolled:true;valid:boolean;code:string;generation:string;authorityEpoch:string};
/** One bounded heartbeat read; `lock` is reserved for caller-owned dispatch/final transactions. */
export async function readRecalculationJobAuthority(c:Pick<PoolClient,'query'>,input:{projectId:string;jobId:string;cableId?:string;lock?:boolean}):Promise<RecalculationJobAuthority>{
  const scoped=await readLocationImpactJobAuthority(c,input);if(scoped)return scoped;
  const grantAuthority=await readGrantJobAuthority(c,input);if(grantAuthority)return grantAuthority;
  let lockedIdentity:{actor_id:string;login_id:string}|undefined,lockedAuthorityValid=true;
  if(input.lock){
    // A reviewer may be a different current administrator. Lock the ORIGINAL finite
    // authority before scheduler state, then obtain a fresh authoritative joined read.
    lockedIdentity=(await c.query<{actor_id:string;login_id:string}>('SELECT actor_id,login_id FROM pf_recalculation_enrollments WHERE project_id=$1 AND job_id=$2',[input.projectId,input.jobId])).rows[0];
    if(!lockedIdentity)return {enrolled:false};
    const user=(await c.query<{is_admin:boolean}>('SELECT is_admin FROM users WHERE id=$1 FOR SHARE',[lockedIdentity.actor_id])).rows[0];
    const login=(await c.query<{user_id:string;expires_at:Date;revoked_at:Date|null}>('SELECT user_id,expires_at,revoked_at FROM viewer_login_bindings WHERE login_id=$1 FOR SHARE',[lockedIdentity.login_id])).rows[0];
    lockedAuthorityValid=!!user?.is_admin&&!!login&&login.user_id===lockedIdentity.actor_id&&!login.revoked_at&&new Date(login.expires_at).getTime()>Date.now();
  }
  const row=(await c.query<Row>(`SELECT e.generation::text,e.authority_epoch::text,e.actor_id,e.login_id,e.authority_expires_at,
    s.desired_generation::text,s.authority_epoch::text AS current_epoch,s.enabled,s.paused,s.engine_unavailable_code,s.actor_id AS current_actor,s.login_id AS current_login,s.authority_expires_at AS current_expiry,
    j.requested_by,j.login_id AS job_login,j.login_expires_at,u.is_admin,l.user_id AS login_user,l.expires_at,l.revoked_at
    FROM pf_recalculation_enrollments e JOIN pf_recalculation_state s USING(project_id) JOIN pf_jobs j ON j.project_id=e.project_id AND j.id=e.job_id
    LEFT JOIN users u ON u.id=e.actor_id LEFT JOIN viewer_login_bindings l ON l.login_id=e.login_id
    WHERE e.project_id=$1 AND e.job_id=$2${input.lock?' FOR SHARE OF e,s,j':''}`,[input.projectId,input.jobId])).rows[0];
  if(!row)return {enrolled:false};
  const base={enrolled:true as const,generation:revision(row.generation),authorityEpoch:revision(row.authority_epoch)};
  if(!lockedAuthorityValid||lockedIdentity&&(lockedIdentity.actor_id!==row.actor_id||lockedIdentity.login_id!==row.login_id))return {...base,valid:false,code:'AUTOMATIC_AUTHORITY_EXPIRED'};
  if(row.engine_unavailable_code)return {...base,valid:false,code:'ENGINE_IDENTITY_UNAVAILABLE'};
  if(row.desired_generation!==row.generation)return {...base,valid:false,code:'AUTOMATIC_GENERATION_SUPERSEDED'};
  if(!row.enabled||row.paused||row.current_epoch!==row.authority_epoch||row.current_actor!==row.actor_id||row.current_login!==row.login_id)return {...base,valid:false,code:'AUTOMATIC_ENROLLMENT_REVOKED'};
  if(!row.is_admin||row.login_user!==row.actor_id||row.revoked_at||row.requested_by!==row.actor_id||row.job_login!==row.login_id||new Date(row.expires_at).getTime()!==new Date(row.login_expires_at).getTime()||Math.min(new Date(row.expires_at).getTime(),new Date(row.authority_expires_at).getTime(),new Date(row.current_expiry).getTime())<=Date.now())return {...base,valid:false,code:'AUTOMATIC_AUTHORITY_EXPIRED'};
  return {...base,valid:true,code:'AUTOMATIC_AUTHORITY_CURRENT'};
}
export async function requireEnrollmentAuthority(c:PoolClient,input:{projectId:string;jobId:string;cableId?:string}):Promise<void>{const value=await readRecalculationJobAuthority(c,{...input,lock:true});if(value.enrolled&&!value.valid)fail(value.code);}

/** Call LAST after the normal current-admin job cancel UPDATE in the same transaction. */
export async function pauseRecalculationForJob(c:PoolClient,input:{projectId:string;jobId:string}):Promise<boolean>{
  const row=await c.query(`UPDATE pf_recalculation_state s SET paused=true,control_revision=control_revision+1,authority_epoch=authority_epoch+1,status='paused',reason_codes='["AUTOMATIC_CANCELLED"]',updated_at=clock_timestamp()
    WHERE s.project_id=$1 AND s.enabled AND NOT s.paused AND s.current_job_id=$2 AND EXISTS(SELECT 1 FROM pf_recalculation_enrollments e WHERE e.project_id=s.project_id AND e.job_id=$2) RETURNING s.project_id`,[input.projectId,input.jobId]);
  return row.rows.length>0;
}

export function createRecalculationRepository(pool:Pool,adapter:RecalculationJobAdapter){
  const repository={
    async authorize(projectId:string,who:JobPrincipal){return recalculationTransaction(pool,projectId,who,async()=>undefined);},
    async context(projectId:string,who:JobPrincipal){return recalculationTransaction(pool,projectId,who,c=>context(c,projectId,who));},
    async command(projectId:string,who:JobPrincipal,raw:RecalculationCommand,signal?:AbortSignal):Promise<RecalculationReceipt>{
      const command=recalculationCommandSchema.parse(raw),requestSha256=hash(command);
      return recalculationTransaction(pool,projectId,who,async c=>{
        const s=await state(c,projectId,true);
        const prior=(await c.query<Row>('SELECT request_sha256,receipt FROM pf_recalculation_commands WHERE project_id=$1 AND actor_id=$2 AND idempotency_key=$3',[projectId,who.userId,command.idempotencyKey])).rows[0];
        if(prior){if(prior.request_sha256!==requestSha256)return fail('RECALCULATION_IDEMPOTENCY_CONFLICT');return recalculationReceiptSchema.parse({...prior.receipt,duplicate:true});}
        if(['enable','resume','retry'].includes(command.action)){const grant=(await c.query<{enabled:boolean}>(`SELECT (r.record->>'enabled')::boolean AS enabled FROM pf_calculation_grant_heads h JOIN pf_calculation_grant_revisions r ON r.project_id=h.project_id AND r.id=h.grant_id AND r.grant_revision=h.control_revision WHERE h.project_id=$1`,[projectId])).rows[0];if(grant?.enabled)return fail('CALCULATION_GRANT_DISABLE_REQUIRED');}
        if(s.control_revision!==command.expectedControlRevision)return fail('RECALCULATION_CONTROL_CONFLICT');
        const count=(await c.query<{count:string}>('SELECT count(*)::text AS count FROM pf_recalculation_commands WHERE project_id=$1',[projectId])).rows[0];if(BigInt(count.count)>=4096n)return fail('RECALCULATION_COMMAND_RETENTION_LIMIT',413);
        const live=await storedAuthority(c,s);
        const sameEnable=command.action==='enable'&&s.enabled&&!s.paused&&live&&hash(s.preferences)===hash(command.preferences)&&s.timeout_ms===command.timeoutMilliseconds;
        if(!sameEnable){
          if(command.action==='resume'||command.action==='retry'){if(!s.enabled||!s.preferences||!s.timeout_ms)return fail('RECALCULATION_ENABLE_REQUIRED');}
          const renew=['enable','resume','retry'].includes(command.action),enabled=command.action==='disable'?false:command.action==='enable'?true:s.enabled,paused=command.action==='disable'?false:command.action==='pause'?true:renew?false:s.paused;
          if(command.action==='pause'&&!s.enabled)return fail('RECALCULATION_ENABLE_REQUIRED');
          const expiry=new Date(Math.min(who.loginExpiresAt,Date.now()+RECALCULATION_LIMITS.authorityMilliseconds));
          await c.query(`UPDATE pf_recalculation_state SET control_revision=control_revision+1,authority_epoch=authority_epoch+1,enabled=$2,paused=$3,
            actor_id=CASE WHEN $4 THEN $5 ELSE actor_id END,login_id=CASE WHEN $4 THEN $6 ELSE login_id END,login_expires_at=CASE WHEN $4 THEN $7 ELSE login_expires_at END,authority_expires_at=CASE WHEN $4 THEN $8 ELSE authority_expires_at END,
            preferences=$9,timeout_ms=$10,status=$11,reason_codes=$12,updated_at=clock_timestamp() WHERE project_id=$1`,
          [projectId,enabled,paused,renew,who.userId,who.loginId,new Date(who.loginExpiresAt),expiry,command.action==='enable'?command.preferences:s.preferences,command.action==='enable'?command.timeoutMilliseconds:s.timeout_ms,!enabled?'disabled':paused?'paused':'debouncing',JSON.stringify(!enabled?['AUTOMATIC_DISABLED']:paused?['AUTOMATIC_PAUSED']:['AUTOMATIC_REQUESTED'])]);
          if(renew)await markRecalculationDirty(c,{projectId,domain:command.action==='enable'?'preferences':'manual',reason:command.action==='retry'?'EXPLICIT_RETRY':command.action==='resume'?'EXPLICIT_RESUME':'AUTOMATIC_ENABLED'});
          if(!renew)await c.query('UPDATE pf_jobs SET cancel_requested=true,updated_at=now() WHERE project_id=$1 AND id IN(SELECT job_id FROM pf_recalculation_enrollments WHERE project_id=$1) AND state IN(\'queued\',\'running\')',[projectId]);
        }
        const receipt=recalculationReceiptSchema.parse({schemaVersion:'wfc.pf.recalculation-command-receipt.v1',duplicate:false,context:await context(c,projectId,who)});
        await c.query('INSERT INTO pf_recalculation_commands(project_id,actor_id,idempotency_key,request_sha256,request,receipt) VALUES($1,$2,$3,$4,$5,$6)',[projectId,who.userId,command.idempotencyKey,requestSha256,command,receipt]);return receipt;
      },signal);
    },
    /** Only scheduler rows are held. No project/user/cable lock is acquired by a claim. */
    async claimNext(signal?:AbortSignal):Promise<RecalculationClaim|null>{
      signal?.throwIfAborted();const c=await connect(pool);let discard=false,committing=false;
      try{
        await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='3000ms';SET LOCAL statement_timeout='15000ms'");
        // Persist finite-authority loss instead of inventing a worker principal.
        await c.query(`UPDATE pf_recalculation_state s SET status='awaiting_authority',reason_codes='["ADMINISTRATOR_ENROLLMENT_REQUIRED"]',updated_at=clock_timestamp()
          WHERE s.project_id IN(SELECT p.project_id FROM pf_recalculation_state p WHERE p.enabled AND NOT p.paused AND p.status<>'awaiting_authority' AND (p.authority_expires_at<=clock_timestamp() OR NOT EXISTS(SELECT 1 FROM users u JOIN viewer_login_bindings l ON l.login_id=p.login_id WHERE u.id=p.actor_id AND u.is_admin AND l.user_id=p.actor_id AND l.revoked_at IS NULL AND l.expires_at=p.login_expires_at AND l.expires_at>clock_timestamp())) ORDER BY p.project_id LIMIT 5 FOR UPDATE OF p SKIP LOCKED)`);
        await c.query(`UPDATE pf_recalculation_state s SET status='failed',reason_codes='["RECALCULATION_RECOVERY_LIMIT"]',updated_at=clock_timestamp()
          WHERE s.project_id IN(SELECT p.project_id FROM pf_recalculation_state p WHERE p.status='collecting' AND p.attempt_generation=p.desired_generation AND p.attempts>=3 AND p.enrolled_generation IS DISTINCT FROM p.desired_generation
          AND NOT EXISTS(SELECT 1 FROM pf_recalculation_claims cl WHERE cl.project_id=p.project_id AND cl.generation=p.desired_generation AND cl.lease_until>clock_timestamp()) ORDER BY p.project_id LIMIT 5 FOR UPDATE OF p SKIP LOCKED)`);
        const s=(await c.query<Row>(`SELECT s.*,s.desired_generation::text,s.control_revision::text,s.authority_epoch::text,s.attempt_generation::text FROM pf_recalculation_state s
          WHERE s.enabled AND NOT s.paused AND s.engine_unavailable_code IS NULL AND s.authority_expires_at>clock_timestamp() AND s.due_at<=clock_timestamp() AND s.enrolled_generation IS DISTINCT FROM s.desired_generation
          AND s.status IN('debouncing','collecting','superseded') AND (s.attempt_generation IS DISTINCT FROM s.desired_generation OR s.attempts<3)
          AND EXISTS(SELECT 1 FROM users u JOIN viewer_login_bindings l ON l.login_id=s.login_id WHERE u.id=s.actor_id AND u.is_admin AND l.user_id=s.actor_id AND l.revoked_at IS NULL AND l.expires_at=s.login_expires_at AND l.expires_at>clock_timestamp())
          AND NOT EXISTS(SELECT 1 FROM pf_recalculation_claims cl WHERE cl.project_id=s.project_id AND cl.generation=s.desired_generation AND cl.lease_until>clock_timestamp())
          ORDER BY s.due_at,s.project_id LIMIT 1 FOR UPDATE OF s SKIP LOCKED`)).rows[0];
        if(!s){committing=true;await c.query('COMMIT');return null;}
        const claimId=randomUUID(),ownerToken=randomUUID(),lease=new Date(Date.now()+60000);
        await c.query(`INSERT INTO pf_recalculation_claims(project_id,generation,control_revision,authority_epoch,claim_id,owner_token,lease_until) VALUES($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT(project_id) DO UPDATE SET generation=EXCLUDED.generation,control_revision=EXCLUDED.control_revision,authority_epoch=EXCLUDED.authority_epoch,claim_id=EXCLUDED.claim_id,owner_token=EXCLUDED.owner_token,lease_until=EXCLUDED.lease_until,created_at=now()`,[s.project_id,s.desired_generation,s.control_revision,s.authority_epoch,claimId,ownerToken,lease]);
        await c.query("UPDATE pf_recalculation_state SET status='collecting',attempts=CASE WHEN attempt_generation=desired_generation THEN attempts+1 ELSE 1 END,attempt_generation=desired_generation,updated_at=clock_timestamp() WHERE project_id=$1",[s.project_id]);
        signal?.throwIfAborted();committing=true;await c.query('COMMIT');return {projectId:s.project_id,generation:revision(s.desired_generation),controlRevision:revision(s.control_revision),authorityEpoch:revision(s.authority_epoch),claimId,ownerToken,leaseExpiresAt:lease.toISOString(),principal:{userId:s.actor_id,loginId:s.login_id,loginExpiresAt:new Date(s.login_expires_at).getTime()},preferences:recalculationPreferencesSchema.parse(s.preferences),timeoutMilliseconds:s.timeout_ms};
      }catch(error){discard=committing;try{await c.query('ROLLBACK');}catch{discard=true;}throw error;}finally{c.release(discard?true:undefined);}
    },
    async enrollClaim(claim:RecalculationClaim,externalSignal?:AbortSignal):Promise<RecalculationEnrollmentResult>{
      const deadline=new AbortController(),timer=setTimeout(()=>deadline.abort(new PathFinderError('RECALCULATION_COLLECTION_DEADLINE',503)),RECALCULATION_LIMITS.collectionMilliseconds);
      const signal=externalSignal?AbortSignal.any([externalSignal,deadline.signal]):deadline.signal;
      try{return await recalculationTransaction(pool,claim.projectId,claim.principal,async c=>{
        const prior=(await c.query<Row>('SELECT job_id FROM pf_recalculation_enrollments WHERE project_id=$1 AND generation=$2',[claim.projectId,claim.generation])).rows[0];
        if(prior)return {status:'duplicate' as const,generation:claim.generation,jobId:prior.job_id};
        let guarded=false,guardState:Row|undefined;
        const beforeInsert=async()=>{
          if(guarded)return fail('RECALCULATION_ADAPTER_GUARD_REUSED',500);signal.throwIfAborted();assertLoginNotExpired(claim.principal);
          const s=await state(c,claim.projectId,true),cl=(await c.query<Row>('SELECT *,generation::text,control_revision::text,authority_epoch::text FROM pf_recalculation_claims WHERE project_id=$1 FOR UPDATE',[claim.projectId])).rows[0];
          if(s.desired_generation!==claim.generation||s.control_revision!==claim.controlRevision||s.authority_epoch!==claim.authorityEpoch)return fail('AUTOMATIC_GENERATION_SUPERSEDED');
          if(!cl||cl.claim_id!==claim.claimId||cl.owner_token!==claim.ownerToken||cl.generation!==claim.generation||cl.authority_epoch!==claim.authorityEpoch||new Date(cl.lease_until).getTime()<=Date.now())return fail('RECALCULATION_CLAIM_FENCED');
          if(!s.enabled||s.paused||s.actor_id!==claim.principal.userId||s.login_id!==claim.principal.loginId||new Date(s.authority_expires_at).getTime()<=Date.now())return fail('AUTOMATIC_ENROLLMENT_REVOKED');
          if(s.engine_unavailable_code)return fail('ENGINE_IDENTITY_UNAVAILABLE');
          if(hash(s.preferences)!==hash(recalculationPreferencesSchema.parse(claim.preferences))||s.timeout_ms!==claim.timeoutMilliseconds||cl.control_revision!==claim.controlRevision)return fail('RECALCULATION_CLAIM_INPUT_MISMATCH');
          guarded=true;guardState=s;
        };
        const admission=await adapter.createInTransaction(c,{projectId:claim.projectId,principal:claim.principal,scope:'project',preferences:claim.preferences,timeoutMilliseconds:claim.timeoutMilliseconds,signal,beforeInsert});
        if(!guarded||!guardState)return fail('RECALCULATION_ADAPTER_GUARD_MISSING',500);signal.throwIfAborted();
        if(!/^[a-f0-9]{64}$(?![\s\S])/.test(admission.inputSha256)||!Number.isSafeInteger(admission.total)||admission.total<0||admission.total>10000||!Number.isSafeInteger(admission.readyCables)||!Number.isSafeInteger(admission.blockedCables)||admission.readyCables<0||admission.blockedCables<0||admission.readyCables+admission.blockedCables!==admission.total||(admission.jobId===null)!==(admission.readyCables===0))return fail('RECALCULATION_ADAPTER_RESULT_INVALID',500);
        if(admission.jobId)policyUuidSchema.parse(admission.jobId);const codes=reasons(admission.reasonCodes);
        await c.query(`INSERT INTO pf_recalculation_enrollments(project_id,generation,control_revision,authority_epoch,actor_id,login_id,authority_expires_at,job_id,input_sha256,total,ready_cables,blocked_cables,reason_codes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,[claim.projectId,claim.generation,claim.controlRevision,claim.authorityEpoch,claim.principal.userId,claim.principal.loginId,guardState.authority_expires_at,admission.jobId,admission.inputSha256,admission.total,admission.readyCables,admission.blockedCables,JSON.stringify(codes)]);
        await c.query(`UPDATE pf_recalculation_state SET enrolled_generation=$2,current_job_id=$3,status=$4,reason_codes=$5,total=$6,completed=$7,ready_cables=$8,blocked_cables=$9,first_dirty_at=NULL,due_at=NULL,updated_at=clock_timestamp() WHERE project_id=$1`,[claim.projectId,claim.generation,admission.jobId,admission.jobId?'queued':'blocked',JSON.stringify(codes),admission.total,admission.blockedCables,admission.readyCables,admission.blockedCables]);
        signal.throwIfAborted();if(new Date(guardState.authority_expires_at).getTime()<=Date.now())return fail('AUTOMATIC_AUTHORITY_EXPIRED');
        return {status:admission.jobId?'enrolled' as const:'blocked' as const,generation:claim.generation,jobId:admission.jobId};
      },signal);}catch(error){
        if(error instanceof PathFinderError&&error.code==='AUTOMATIC_GENERATION_SUPERSEDED')return {status:'superseded',generation:claim.generation,jobId:null};
        if(!externalSignal?.aborted&&!(error instanceof PathFinderError&&error.code==='RECALCULATION_COMMIT_OUTCOME_UNKNOWN'))await repository.recordBlocked(claim,error).catch(()=>undefined);
        throw error;
      }finally{clearTimeout(timer);}
    },
    /** Never clears a newer dirty generation and never acknowledges an uncertain COMMIT. */
    async recordBlocked(claim:RecalculationClaim,error:unknown):Promise<void>{
      const code=error instanceof PathFinderError?error.code:'RECALCULATION_ENROLLMENT_FAILED',safe=recalculationReasonSchema.safeParse(code),reason=safe.success?safe.data:'RECALCULATION_ENROLLMENT_FAILED';
      const authority=['LOGIN_EXPIRED','LOGIN_REVOKED','ADMIN_REQUIRED','AUTOMATIC_ENROLLMENT_REVOKED','AUTOMATIC_AUTHORITY_EXPIRED'].includes(reason),transient=['RECALCULATION_DATABASE_BUSY','RECALCULATION_COLLECTION_DEADLINE'].includes(reason);
      const c=await connect(pool);let discard=false,committing=false;
      try{await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='3000ms';SET LOCAL statement_timeout='15000ms'");await c.query(`UPDATE pf_recalculation_state s SET status=CASE WHEN $5 THEN 'awaiting_authority' WHEN $6 AND attempts<3 THEN 'debouncing' WHEN $6 THEN 'failed' ELSE 'blocked' END,
        reason_codes=$4,due_at=CASE WHEN $6 AND attempts<3 THEN clock_timestamp()+interval '5 seconds' ELSE NULL END,updated_at=clock_timestamp()
        WHERE s.project_id=$1 AND s.desired_generation=$2 AND s.authority_epoch=$3
        AND EXISTS(SELECT 1 FROM pf_recalculation_claims c WHERE c.project_id=s.project_id AND c.claim_id=$7 AND c.owner_token=$8)`,[claim.projectId,claim.generation,claim.authorityEpoch,JSON.stringify([reason]),authority,transient,claim.claimId,claim.ownerToken]);
        await c.query('UPDATE pf_recalculation_claims SET lease_until=clock_timestamp() WHERE project_id=$1 AND claim_id=$2 AND owner_token=$3',[claim.projectId,claim.claimId,claim.ownerToken]);committing=true;await c.query('COMMIT');
      }catch(error){discard=committing;try{await c.query('ROLLBACK');}catch{discard=true;}throw error;}finally{c.release(discard?true:undefined);}
    },
  };
  return repository;
}
export type RecalculationRepository=ReturnType<typeof createRecalculationRepository>;
