import {randomBytes,randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {CALCULATION_GRANT_LIMITS,CALCULATION_GRANT_OPERATIONS,calculationGrantSchema,calculationGrantContextSchema,calculationGrantCommandSchema,
  calculationGrantReceiptSchema,calculationGrantProducerStatusSchema,calculationGrantOperationSchema,type CalculationGrant,type CalculationGrantContext,
  type CalculationGrantCommand,type CalculationGrantReceipt,type CalculationGrantProducerStatus,type CalculationGrantOperation} from '../../shared/pathfinderCalculationGrant.js';
import {policyUuidSchema,policyRevisionSchema,policyHashSchema,canonicalPurposeJson} from '../../shared/pathfinderPurposePolicy.js';
import type {JobPrincipal} from './jobContracts.js';
import {recalculationTransaction} from './recalculationRepository.js';
import {schedulerTransaction} from './schedulerTransaction.js';
import {PathFinderError} from './errors.js';
import {calculationGrantAuthoritySchema,calculationAuthorityOwnerHash,calculationGrantRecordHash,validateCalculationGrantRecord,requireCalculationGrant,
  type CalculationGrantAuthority} from './calculationAuthority.js';

type Row=Record<string,any>;
const fail=(code:string,status=409):never=>{throw new PathFinderError(code,status,'The calculation grant changed or is unavailable. Refresh its current state and reconcile any uncertain command using its original key.');};
const next=(value:string):string=>{const result=BigInt(policyRevisionSchema.parse(value))+1n;if(result>9223372036854775807n)fail('CALCULATION_GRANT_REVISION_LIMIT');return result.toString();};
const hash=(value:unknown)=>calculationGrantRecordHash(value);
export type CalculationGrantAdapters={
  /** Root supplies an installation-qualified producer record; absence is unqualified. */
  producerStatus?:(c:PoolClient,input:{projectId:string;installationEpoch:string})=>Promise<CalculationGrantProducerStatus>;
  /** Root invalidates scheduler/owned jobs in this SAME human-authorized transaction. No ordinary business writes. */
  afterCommand?:(c:PoolClient,input:{projectId:string;grant:CalculationGrant|null;previousGrant:CalculationGrant|null;command:CalculationGrantCommand;principal:JobPrincipal})=>Promise<void>;
};
const headSql=`SELECT h.project_id,h.grant_id,h.control_revision::text,h.grant_epoch::text AS head_epoch,
  r.id,r.grant_revision::text,r.grant_epoch::text,r.installation_epoch,r.issuer_id,r.issuer_admin_revision::text,r.record_sha256,r.record
  FROM pf_calculation_grant_heads h LEFT JOIN pf_calculation_grant_revisions r ON r.project_id=h.project_id AND r.id=h.grant_id AND r.grant_revision=h.control_revision WHERE h.project_id=$1`;
async function readHead(c:PoolClient,projectId:string,lock=false):Promise<{row:Row;grant:CalculationGrant|null}>{
  const row=(await c.query<Row>(headSql+(lock?' FOR UPDATE OF h':''),[projectId])).rows[0];if(!row)fail('CALCULATION_GRANT_STATE_REQUIRED');
  policyRevisionSchema.parse(row.control_revision);policyRevisionSchema.parse(row.head_epoch);
  if(row.grant_id===null){if(row.control_revision!=='0'||row.head_epoch!=='0'||row.record!==null)fail('CALCULATION_GRANT_INTEGRITY',500);return{row,grant:null};}
  const grant=validateCalculationGrantRecord(row as Parameters<typeof validateCalculationGrantRecord>[0]);
  if(grant.id!==row.grant_id||grant.grantRevision!==row.control_revision||grant.grantEpoch!==row.head_epoch)fail('CALCULATION_GRANT_INTEGRITY',500);
  return{row,grant};
}
async function installation(c:PoolClient,lock=false):Promise<string>{
  const row=(await c.query<{installation_epoch:string}>(`SELECT installation_epoch FROM pf_installation_state WHERE singleton=true${lock?' FOR SHARE':''}`)).rows[0];
  if(!row)fail('CALCULATION_GRANT_INSTALLATION_REQUIRED',503);return policyUuidSchema.parse(row.installation_epoch);
}
async function producer(c:PoolClient,adapters:CalculationGrantAdapters,projectId:string,installationEpoch:string):Promise<CalculationGrantProducerStatus>{
  return calculationGrantProducerStatusSchema.parse(adapters.producerStatus?await adapters.producerStatus(c,{projectId,installationEpoch}):{status:'unqualified',reasonCode:'MANAGED_PRODUCER_UNQUALIFIED'});
}
async function readContext(c:PoolClient,adapters:CalculationGrantAdapters,projectId:string):Promise<CalculationGrantContext>{
  const {row,grant}=await readHead(c,projectId),epoch=await installation(c),producerState=await producer(c,adapters,projectId,epoch);
  let status:CalculationGrantContext['status']='disabled';const reasonCodes:string[]=[];
  if(grant?.enabled){
    if(grant.installationEpoch!==epoch){status='restore-fenced';reasonCodes.push('CALCULATION_GRANT_RESTORE_FENCED');}
    else{
      const issuer=(await c.query<{is_admin:boolean;revision:string}>('SELECT is_admin,pf_admin_revision::text AS revision FROM users WHERE id=$1',[grant.enabledBy])).rows[0];
      if(!issuer?.is_admin||issuer.revision!==grant.issuerAdminRevision){status='revoked';reasonCodes.push('CALCULATION_GRANT_ISSUER_REVOKED');}
      else if(!['ready','running'].includes(producerState.status)){status='blocked';reasonCodes.push(producerState.reasonCode??'MANAGED_PRODUCER_UNQUALIFIED');}
      else status='enabled';
    }
  }
  const result=calculationGrantContextSchema.parse({schemaVersion:'wfc.pf.calculation-grant-context.v1',projectId,controlRevision:row.control_revision,grant,status,reasonCodes,producer:producerState});
  if(Buffer.byteLength(canonicalPurposeJson(result))>CALCULATION_GRANT_LIMITS.responseBytes)fail('CALCULATION_GRANT_RESPONSE_LIMIT',413);return result;
}
async function humanTransaction<T>(pool:Pool,projectId:string,who:JobPrincipal,callback:(c:PoolClient)=>Promise<T>,signal?:AbortSignal):Promise<T>{
  try{return await recalculationTransaction(pool,projectId,who,callback,signal);}
  catch(error){if(error instanceof PathFinderError&&error.code==='RECALCULATION_COMMIT_OUTCOME_UNKNOWN')fail('CALCULATION_GRANT_COMMIT_OUTCOME_UNKNOWN',503);throw error;}
}
export const calculationGrantLeaseClaimSchema=z.object({projectId:policyUuidSchema,grantId:policyUuidSchema,grantRevision:policyRevisionSchema,grantEpoch:policyRevisionSchema,
  installationEpoch:policyUuidSchema,operation:calculationGrantOperationSchema,modelVersionId:policyUuidSchema,selectionRevision:policyRevisionSchema,contentFingerprint:policyHashSchema,
  leaseId:policyUuidSchema,ownerToken:policyHashSchema}).strict();
export type CalculationGrantLeaseClaim=z.infer<typeof calculationGrantLeaseClaimSchema>;
/** Persist this server-owned intent privately before claim so unknown COMMIT can reconcile exactly. */
export function newCalculationGrantLeaseOwner():{leaseId:string;ownerToken:string}{return{leaseId:randomUUID(),ownerToken:randomBytes(32).toString('hex')};}

export function createCalculationGrantRepository(pool:Pool,adapters:CalculationGrantAdapters={}){
  return{
    authorize:(projectId:string,who:JobPrincipal)=>humanTransaction(pool,projectId,who,async()=>undefined),
    context:(projectId:string,who:JobPrincipal)=>humanTransaction(pool,projectId,who,c=>readContext(c,adapters,projectId)),
    async command(projectId:string,who:JobPrincipal,raw:CalculationGrantCommand,signal?:AbortSignal):Promise<CalculationGrantReceipt>{
      const command=calculationGrantCommandSchema.parse(raw),requestSha256=hash(command);
      return humanTransaction(pool,projectId,who,async c=>{
        const epoch=await installation(c,true),{row,grant:previousGrant}=await readHead(c,projectId,true);
        const previous=(await c.query<Row>('SELECT request_sha256,request,receipt FROM pf_calculation_grant_commands WHERE project_id=$1 AND actor_id=$2 AND idempotency_key=$3',[projectId,who.userId,command.idempotencyKey])).rows[0];
        if(previous){if(previous.request_sha256!==requestSha256||canonicalPurposeJson(previous.request)!==canonicalPurposeJson(command))fail('CALCULATION_GRANT_IDEMPOTENCY_CONFLICT');return calculationGrantReceiptSchema.parse({...previous.receipt,duplicate:true});}
        if(row.control_revision!==command.expectedControlRevision)fail('CALCULATION_GRANT_CONTROL_CONFLICT');
        const count=(await c.query<{count:string}>('SELECT count(*)::text AS count FROM pf_calculation_grant_commands WHERE project_id=$1',[projectId])).rows[0];
        if(BigInt(count.count)>=BigInt(CALCULATION_GRANT_LIMITS.commandsPerProject))fail('CALCULATION_GRANT_COMMAND_LIMIT',413);
        let grant=previousGrant;
        // Disable with no grant records only an exact receipt. It does not invent a prior enable.
        if(command.action==='enable'||previousGrant){
          if(BigInt(row.control_revision)>=BigInt(CALCULATION_GRANT_LIMITS.revisionsPerProject))fail('CALCULATION_GRANT_REVISION_LIMIT',413);
          const issuer=(await c.query<{revision:string}>('SELECT pf_admin_revision::text AS revision FROM users WHERE id=$1 FOR SHARE',[who.userId])).rows[0];
          if(!issuer)fail('LOGIN_REVOKED',401);const now=new Date().toISOString(),revision=next(row.control_revision),grantEpoch=next(row.head_epoch);
          grant=calculationGrantSchema.parse({schemaVersion:'wfc.pf.calculation-grant.v1',projectId,id:previousGrant?.id??randomUUID(),grantRevision:revision,grantEpoch,installationEpoch:epoch,
            enabled:command.action==='enable',enabledBy:command.action==='enable'?who.userId:previousGrant!.enabledBy,enabledAt:command.action==='enable'?now:previousGrant!.enabledAt,
            updatedAt:now,issuerAdminRevision:command.action==='enable'?issuer.revision:previousGrant!.issuerAdminRevision,scope:'active-model',operations:[...CALCULATION_GRANT_OPERATIONS],
            limitsProfile:'local-bounded-v1',preferences:command.action==='enable'?command.preferences:previousGrant!.preferences,
            timeoutMilliseconds:command.action==='enable'?command.timeoutMilliseconds:previousGrant!.timeoutMilliseconds});
          await c.query(`INSERT INTO pf_calculation_grant_revisions(project_id,id,grant_revision,grant_epoch,installation_epoch,issuer_id,issuer_admin_revision,record_sha256,record)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[projectId,grant.id,revision,grantEpoch,epoch,grant.enabledBy,grant.issuerAdminRevision,hash(grant),grant]);
          await c.query('UPDATE pf_calculation_grant_heads SET grant_id=$2,control_revision=$3,grant_epoch=$4,updated_at=clock_timestamp() WHERE project_id=$1',[projectId,grant.id,revision,grantEpoch]);
          await adapters.afterCommand?.(c,{projectId,grant,previousGrant,command,principal:who});
        }
        const receipt=calculationGrantReceiptSchema.parse({schemaVersion:'wfc.pf.calculation-grant-receipt.v1',duplicate:false,context:await readContext(c,adapters,projectId)});
        await c.query('INSERT INTO pf_calculation_grant_commands(project_id,actor_id,idempotency_key,request_sha256,request,receipt) VALUES($1,$2,$3,$4,$5,$6)',[projectId,who.userId,command.idempotencyKey,requestSha256,command,receipt]);return receipt;
      },signal);
    },
    /** Trusted internal call only; never reachable with a human management body or JWT. */
    async claim(raw:CalculationGrantLeaseClaim,signal?:AbortSignal):Promise<CalculationGrantAuthority>{
      const input=calculationGrantLeaseClaimSchema.parse(raw);signal?.throwIfAborted();
      try{return await schedulerTransaction(pool,async c=>{
        // One global owner slot in this installation. Restored epoch-fenced
        // owners remain truthful audit rows, not evidence of a process join.
        await c.query("SELECT pg_advisory_xact_lock(hashtext('wfc-pathfinder-calculation-grant-lease-v1'))");
        if(!(await c.query('SELECT id FROM projects WHERE id=$1 FOR NO KEY UPDATE',[input.projectId])).rows.length)fail('PROJECT_NOT_FOUND',404);
        const initial=await readHead(c,input.projectId);if(!initial.grant)return fail('CALCULATION_GRANT_REQUIRED');
        const issuer=(await c.query<{is_admin:boolean;revision:string}>('SELECT is_admin,pf_admin_revision::text AS revision FROM users WHERE id=$1 FOR SHARE',[initial.grant.enabledBy])).rows[0];
        if(!issuer?.is_admin||issuer.revision!==initial.grant.issuerAdminRevision)fail('CALCULATION_GRANT_ISSUER_REVOKED',403);
        const model=(await c.query<{active_model_version_id:string;selection_revision:string;state:string;health:string;content_fingerprint:string}>(`SELECT s.active_model_version_id,s.selection_revision::text,m.state,m.health,m.content_fingerprint
          FROM project_model_selections s JOIN model_versions m ON m.project_id=s.project_id AND m.id=s.active_model_version_id WHERE s.project_id=$1 FOR SHARE OF s,m`,[input.projectId])).rows[0];
        if(!model||model.active_model_version_id!==input.modelVersionId||model.selection_revision!==input.selectionRevision||model.content_fingerprint!==input.contentFingerprint||model.state!=='ready'||model.health!=='healthy')fail('CALCULATION_GRANT_MODEL_CHANGED');
        const epoch=await installation(c,true),{grant}=await readHead(c,input.projectId,true);
        if(!grant?.enabled||grant.id!==input.grantId||grant.grantRevision!==input.grantRevision||grant.grantEpoch!==input.grantEpoch)return fail('CALCULATION_GRANT_REVOKED');
        if(epoch!==input.installationEpoch||grant.installationEpoch!==epoch)fail('CALCULATION_GRANT_RESTORE_FENCED');
        if(input.operation==='prepare'){
          const state=await producer(c,adapters,input.projectId,epoch);if(!['ready','running'].includes(state.status))fail(state.reasonCode??'MANAGED_PRODUCER_UNQUALIFIED',503);
        }
        const prior=(await c.query<Row>('SELECT * FROM pf_calculation_grant_leases WHERE id=$1',[input.leaseId])).rows[0];
        if(prior){
          const authority=calculationGrantAuthoritySchema.parse({...input,kind:'calculation-grant',issuerId:grant.enabledBy,issuerAdminRevision:grant.issuerAdminRevision,leaseExpiresAt:new Date(prior.expires_at).toISOString()});
          await requireCalculationGrant(c,authority,input.operation,{lock:true});return Object.freeze(authority);
        }
        const active=(await c.query<Row>("SELECT id,state,expires_at FROM pf_calculation_grant_leases WHERE installation_epoch=$1 AND state IN('active','quarantined') LIMIT 1",[epoch])).rows[0];
        if(active)fail(active.state==='quarantined'?'CALCULATION_GRANT_LEASE_QUARANTINED':new Date(active.expires_at).getTime()<=Date.now()?'CALCULATION_GRANT_LEASE_RECOVERY_REQUIRED':'CALCULATION_GRANT_LEASE_BUSY');
        const count=(await c.query<{count:string}>('SELECT count(*)::text AS count FROM pf_calculation_grant_leases WHERE project_id=$1',[input.projectId])).rows[0];
        if(BigInt(count.count)>=BigInt(CALCULATION_GRANT_LIMITS.leaseHistoryPerProject))fail('CALCULATION_GRANT_LEASE_HISTORY_LIMIT',413);
        const createdAt=new Date(),expiresAt=new Date(createdAt.getTime()+CALCULATION_GRANT_LIMITS.executionLeaseMilliseconds);
        await c.query(`INSERT INTO pf_calculation_grant_leases(id,project_id,grant_id,grant_revision,grant_epoch,installation_epoch,issuer_id,issuer_admin_revision,operation,model_version_id,selection_revision,content_fingerprint,owner_sha256,state,created_at,expires_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'active',$14,$15)`,[input.leaseId,input.projectId,grant.id,grant.grantRevision,grant.grantEpoch,epoch,grant.enabledBy,grant.issuerAdminRevision,input.operation,input.modelVersionId,input.selectionRevision,input.contentFingerprint,calculationAuthorityOwnerHash(input.ownerToken),createdAt,expiresAt]);
        const authority=calculationGrantAuthoritySchema.parse({...input,kind:'calculation-grant',issuerId:grant.enabledBy,issuerAdminRevision:grant.issuerAdminRevision,leaseExpiresAt:expiresAt.toISOString()});
        signal?.throwIfAborted();await requireCalculationGrant(c,authority,input.operation,{lock:true});return Object.freeze(authority);
      },signal);}catch(error){if(error instanceof PathFinderError&&error.code==='SCHEDULER_COMMIT_OUTCOME_UNKNOWN')fail('CALCULATION_GRANT_COMMIT_OUTCOME_UNKNOWN',503);if((error as {code?:string})?.code==='23505')fail('CALCULATION_GRANT_LEASE_BUSY');throw error;}
    },
    /** Cleanup after a confirmed join may retire an expired/revoked lease, but can never grant new work. */
    async release(authority:CalculationGrantAuthority,signal?:AbortSignal):Promise<void>{await closeLease(pool,authority,'released',null,signal);},
    async quarantine(authority:CalculationGrantAuthority,reasonCode:string,signal?:AbortSignal):Promise<void>{
      if(!/^[A-Z][A-Z0-9_]{0,95}$(?![\s\S])/.test(reasonCode))fail('CALCULATION_GRANT_REASON_INVALID',400);await closeLease(pool,authority,'quarantined',reasonCode,signal);
    },
  };
}
async function closeLease(pool:Pool,raw:CalculationGrantAuthority,state:'released'|'quarantined',reason:string|null,signal?:AbortSignal):Promise<void>{
  const authority=calculationGrantAuthoritySchema.parse(raw);
  await schedulerTransaction(pool,async c=>{
    const row=(await c.query<Row>('SELECT project_id,owner_sha256,state FROM pf_calculation_grant_leases WHERE id=$1 FOR UPDATE',[authority.leaseId])).rows[0];
    if(!row||row.project_id!==authority.projectId||row.owner_sha256!==calculationAuthorityOwnerHash(authority.ownerToken))fail('CALCULATION_GRANT_LEASE_FENCED');
    if(row.state==='released'){if(state==='released')return;fail('CALCULATION_GRANT_LEASE_FENCED');}
    await c.query('UPDATE pf_calculation_grant_leases SET state=$2,closed_at=CASE WHEN $2=\'released\' THEN clock_timestamp() ELSE NULL END,reason_code=$3 WHERE id=$1',[authority.leaseId,state,reason]);
  },signal);
}
/** Restore tools use a fresh epoch; normal backend restarts must NOT call this function. */
export async function fenceCalculationGrantInstallation(pool:Pool,expectedEpoch:string,newEpoch:string):Promise<void>{
  policyUuidSchema.parse(expectedEpoch);policyUuidSchema.parse(newEpoch);if(expectedEpoch===newEpoch)fail('CALCULATION_GRANT_RESTORE_EPOCH_REUSED');
  await schedulerTransaction(pool,c=>fenceCalculationGrantInstallationInTransaction(c,expectedEpoch,newEpoch));
}
/** Owned cold restore shares this exact transaction with durable login fencing.
 * Epoch-fenced leases remain byte-exact: no false release, join or owner recovery. */
export async function fenceCalculationGrantInstallationInTransaction(c:Pick<PoolClient,'query'>,expectedEpoch:string,newEpoch:string):Promise<void>{
  policyUuidSchema.parse(expectedEpoch);policyUuidSchema.parse(newEpoch);if(expectedEpoch===newEpoch)fail('CALCULATION_GRANT_RESTORE_EPOCH_REUSED');
  await c.query("SELECT pg_advisory_xact_lock(hashtext('wfc-pathfinder-calculation-grant-lease-v1'))");
  const changed=await c.query('UPDATE pf_installation_state SET installation_epoch=$2,updated_at=clock_timestamp() WHERE singleton=true AND installation_epoch=$1 RETURNING installation_epoch',[expectedEpoch,newEpoch]);
  if(changed.rows.length!==1)fail('CALCULATION_GRANT_INSTALLATION_CONFLICT');
}
export type CalculationGrantRepository=ReturnType<typeof createCalculationGrantRepository>;
