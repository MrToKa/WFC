import {createHash,timingSafeEqual} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {policyUuidSchema,policyRevisionSchema,policyHashSchema,canonicalPurposeJson} from '../../shared/pathfinderPurposePolicy.js';
import {calculationGrantSchema,calculationGrantProvenanceSchema,calculationGrantOperationSchema,CALCULATION_GRANT_LIMITS,type CalculationGrant,
  type CalculationGrantProvenance,type CalculationGrantOperation} from '../../shared/pathfinderCalculationGrant.js';
import {PathFinderError} from './errors.js';
import type {JobPrincipal} from './jobContracts.js';

const timestamp=z.string().datetime({offset:false}).refine(value=>value.endsWith('Z'));
/** Internal capability only. No human HTTP parser accepts this shape or its owner token. */
export const calculationGrantAuthoritySchema=z.object({kind:z.literal('calculation-grant'),projectId:policyUuidSchema,grantId:policyUuidSchema,
  grantRevision:policyRevisionSchema,grantEpoch:policyRevisionSchema,installationEpoch:policyUuidSchema,issuerId:policyUuidSchema,issuerAdminRevision:policyRevisionSchema,
  leaseId:policyUuidSchema,ownerToken:policyHashSchema,leaseExpiresAt:timestamp,operation:calculationGrantOperationSchema,
  modelVersionId:policyUuidSchema,selectionRevision:policyRevisionSchema,contentFingerprint:policyHashSchema}).strict();
export type CalculationGrantAuthority=z.infer<typeof calculationGrantAuthoritySchema>;
export type CalculationAuthority={kind:'current-login';principal:JobPrincipal}|CalculationGrantAuthority;
export const calculationGrantProvenance=(authority:CalculationGrantAuthority):CalculationGrantProvenance=>calculationGrantProvenanceSchema.parse({
  kind:authority.kind,projectId:authority.projectId,grantId:authority.grantId,grantRevision:authority.grantRevision,grantEpoch:authority.grantEpoch,
  installationEpoch:authority.installationEpoch,issuerId:authority.issuerId,issuerAdminRevision:authority.issuerAdminRevision});
export const calculationAuthorityOwnerHash=(ownerToken:string):string=>createHash('sha256').update(policyHashSchema.parse(ownerToken)).digest('hex');
export const calculationGrantRecordHash=(value:unknown):string=>createHash('sha256').update(canonicalPurposeJson(value)).digest('hex');
const fail=(code:string,status=409):never=>{throw new PathFinderError(code,status,'The calculation grant is unavailable, expired or changed. Current human administrator activation is required before affected work can continue.');};
const equalHash=(a:string,b:string)=>/^[a-f0-9]{64}$(?![\s\S])/.test(a)&&/^[a-f0-9]{64}$(?![\s\S])/.test(b)&&timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
export function assertCalculationGrantLeaseTime(authority:CalculationGrantAuthority):void{
  if(Date.parse(authority.leaseExpiresAt)<=Date.now())fail('CALCULATION_GRANT_LEASE_EXPIRED');
}
export function validateCalculationGrantRecord(row:{record:unknown;record_sha256:string;project_id:string;id:string;grant_revision:string;grant_epoch:string;installation_epoch:string;issuer_id:string;issuer_admin_revision:string}):CalculationGrant{
  const grant=calculationGrantSchema.parse(row.record);
  if(grant.projectId!==row.project_id||grant.id!==row.id||grant.grantRevision!==row.grant_revision||grant.grantEpoch!==row.grant_epoch
    ||grant.installationEpoch!==row.installation_epoch||grant.enabledBy!==row.issuer_id||grant.issuerAdminRevision!==row.issuer_admin_revision
    ||!equalHash(calculationGrantRecordHash(grant),row.record_sha256))fail('CALCULATION_GRANT_INTEGRITY',500);
  return grant;
}
/** Persistent original grant authority for HUMAN Review/Apply. An expired execution lease is irrelevant here. */
export async function requireCalculationGrantRevision(c:Pick<PoolClient,'query'>,raw:CalculationGrantProvenance|Omit<CalculationGrantProvenance,'kind'>,
  options:{lock?:boolean}={}):Promise<CalculationGrant>{
  const ref=calculationGrantProvenanceSchema.parse('kind' in raw?raw:{...raw,kind:'calculation-grant'}),lock=Boolean(options.lock);
  const issuer=(await c.query<{is_admin:boolean;revision:string}>(`SELECT is_admin,pf_admin_revision::text AS revision FROM users WHERE id=$1${lock?' FOR SHARE':''}`,[ref.issuerId])).rows[0];
  if(!issuer?.is_admin||issuer.revision!==ref.issuerAdminRevision)fail('CALCULATION_GRANT_ISSUER_REVOKED',403);
  const installation=(await c.query<{installation_epoch:string}>(`SELECT installation_epoch FROM pf_installation_state WHERE singleton=true${lock?' FOR SHARE':''}`)).rows[0];
  if(!installation||installation.installation_epoch!==ref.installationEpoch)fail('CALCULATION_GRANT_RESTORE_FENCED');
  const row=(await c.query<Record<string,any>>(`SELECT r.project_id,r.id,r.grant_revision::text,r.grant_epoch::text,r.installation_epoch,r.issuer_id,r.issuer_admin_revision::text,r.record,r.record_sha256,
    h.control_revision::text AS head_revision,h.grant_epoch::text AS head_epoch,h.grant_id
    FROM pf_calculation_grant_heads h JOIN pf_calculation_grant_revisions r ON r.project_id=h.project_id AND r.id=h.grant_id AND r.grant_revision=h.control_revision
    WHERE h.project_id=$1${lock?' FOR SHARE OF h,r':''}`,[ref.projectId])).rows[0];
  if(!row||row.id!==ref.grantId||row.head_revision!==ref.grantRevision||row.head_epoch!==ref.grantEpoch||row.installation_epoch!==ref.installationEpoch
    ||row.issuer_id!==ref.issuerId||row.issuer_admin_revision!==ref.issuerAdminRevision)fail('CALCULATION_GRANT_REVOKED');
  const grant=validateCalculationGrantRecord(row as Parameters<typeof validateCalculationGrantRecord>[0]);
  if(!grant.enabled)fail('CALCULATION_GRANT_REVOKED');return grant;
}
/** Caller takes project first. Locking guards take issuer, current model, installation, then grant/lease LAST. */
export async function requireCalculationGrant(c:Pick<PoolClient,'query'>,raw:CalculationGrantAuthority,operation:CalculationGrantOperation,
  options:{lock?:boolean}={}):Promise<CalculationGrant>{
  const authority=calculationGrantAuthoritySchema.parse(raw);calculationGrantOperationSchema.parse(operation);
  if(authority.operation!==operation)fail('CALCULATION_GRANT_OPERATION_DENIED',403);assertCalculationGrantLeaseTime(authority);
  const lock=Boolean(options.lock);
  const issuer=(await c.query<{is_admin:boolean;revision:string}>(`SELECT is_admin,pf_admin_revision::text AS revision FROM users WHERE id=$1${lock?' FOR SHARE':''}`,[authority.issuerId])).rows[0];
  if(!issuer?.is_admin||issuer.revision!==authority.issuerAdminRevision)fail('CALCULATION_GRANT_ISSUER_REVOKED',403);
  const model=(await c.query<{active_model_version_id:string;selection_revision:string;state:string;health:string;content_fingerprint:string}>(`SELECT s.active_model_version_id,s.selection_revision::text,m.state,m.health,m.content_fingerprint
    FROM project_model_selections s JOIN model_versions m ON m.project_id=s.project_id AND m.id=s.active_model_version_id
    WHERE s.project_id=$1${lock?' FOR SHARE OF s,m':''}`,[authority.projectId])).rows[0];
  if(!model||model.active_model_version_id!==authority.modelVersionId||model.selection_revision!==authority.selectionRevision
    ||model.content_fingerprint!==authority.contentFingerprint||model.state!=='ready'||model.health!=='healthy')fail('CALCULATION_GRANT_MODEL_CHANGED');
  const grant=await requireCalculationGrantRevision(c,calculationGrantProvenance(authority),{lock});
  const row=(await c.query<Record<string,any>>(`SELECT project_id,grant_id,grant_revision::text AS lease_revision,grant_epoch::text AS lease_epoch,
    installation_epoch AS lease_installation,issuer_id AS lease_issuer,issuer_admin_revision::text AS lease_admin_revision,operation,model_version_id,selection_revision::text AS lease_selection,
    content_fingerprint AS lease_fingerprint,owner_sha256,state AS lease_state,expires_at FROM pf_calculation_grant_leases WHERE project_id=$1 AND id=$2${lock?' FOR SHARE':''}`,[authority.projectId,authority.leaseId])).rows[0];
  if(!row||row.grant_id!==authority.grantId||row.lease_revision!==authority.grantRevision||row.lease_epoch!==authority.grantEpoch
    ||row.lease_installation!==authority.installationEpoch||row.lease_issuer!==authority.issuerId||row.lease_admin_revision!==authority.issuerAdminRevision)fail('CALCULATION_GRANT_REVOKED');
  if(!grant.enabled||grant.scope!=='active-model'||!grant.operations.includes(operation))fail('CALCULATION_GRANT_OPERATION_DENIED',403);
  if(row.lease_state!=='active'||row.operation!==operation||row.model_version_id!==authority.modelVersionId||row.lease_selection!==authority.selectionRevision
    ||row.lease_fingerprint!==authority.contentFingerprint||!equalHash(row.owner_sha256,calculationAuthorityOwnerHash(authority.ownerToken)))fail('CALCULATION_GRANT_LEASE_FENCED');
  if(new Date(row.expires_at).toISOString()!==authority.leaseExpiresAt)fail('CALCULATION_GRANT_LEASE_FENCED');
  assertCalculationGrantLeaseTime(authority);return grant;
}
async function connect(pool:Pool):Promise<PoolClient>{
  let expired=false,timer:ReturnType<typeof setTimeout>|undefined;
  const pending=pool.connect().then(c=>{if(expired){c.release();return fail('CALCULATION_GRANT_DATABASE_BUSY',503);}return c;});
  try{return await Promise.race([pending,new Promise<never>((_,reject)=>{timer=setTimeout(()=>{expired=true;reject(new PathFinderError('CALCULATION_GRANT_DATABASE_BUSY',503));},CALCULATION_GRANT_LIMITS.acquisitionMilliseconds);})]);}
  finally{if(timer)clearTimeout(timer);}
}
/** Project/issuer are held first; heavy shared operations run before the final live head/lease fence. */
export async function grantTransaction<T>(pool:Pool,raw:CalculationGrantAuthority,operation:CalculationGrantOperation,
  callback:(c:PoolClient)=>Promise<T>,signal?:AbortSignal):Promise<T>{
  const authority=calculationGrantAuthoritySchema.parse(raw);assertCalculationGrantLeaseTime(authority);signal?.throwIfAborted();
  const c=await connect(pool);let committing=false,discard=false;
  try{
    await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='3000ms';SET LOCAL statement_timeout='15000ms';SET LOCAL idle_in_transaction_session_timeout='30000ms'");
    if(!(await c.query('SELECT id FROM projects WHERE id=$1 FOR NO KEY UPDATE',[authority.projectId])).rows.length)fail('PROJECT_NOT_FOUND',404);
    const issuer=(await c.query<{is_admin:boolean;revision:string}>('SELECT is_admin,pf_admin_revision::text AS revision FROM users WHERE id=$1 FOR SHARE',[authority.issuerId])).rows[0];
    if(!issuer?.is_admin||issuer.revision!==authority.issuerAdminRevision)fail('CALCULATION_GRANT_ISSUER_REVOKED',403);
    await requireCalculationGrant(c,authority,operation);signal?.throwIfAborted();
    const result=await callback(c);signal?.throwIfAborted();await requireCalculationGrant(c,authority,operation,{lock:true});
    signal?.throwIfAborted();assertCalculationGrantLeaseTime(authority);committing=true;await c.query('COMMIT');return result;
  }catch(error){discard=committing;try{await c.query('ROLLBACK');}catch{discard=true;}
    if(committing)fail('CALCULATION_GRANT_COMMIT_OUTCOME_UNKNOWN',503);
    if(['55P03','57014'].includes((error as {code?:string})?.code??''))fail('CALCULATION_GRANT_DATABASE_BUSY',503);throw error;
  }finally{c.release(discard?true:undefined);}
}
