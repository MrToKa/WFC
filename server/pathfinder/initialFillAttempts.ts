import {randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {initialFillApplyRequestSchema,initialFillRequestHashInput,type InitialFillApplyRequest} from '../../shared/pathfinderInitialFill.js';
import {policyUuidSchema} from '../../shared/pathfinderPurposePolicy.js';
import {hash} from './dependencies.js';
import {initialFillIdempotencyKey} from './initialFillIdentity.js';
import {schedulerTransaction} from './schedulerTransaction.js';
import {PathFinderError} from './errors.js';
type Row=Record<string,any>;
export type InitialFillClaim={projectId:string;actorId:string;idempotencyKey:string;request:InitialFillApplyRequest;ownerToken:string;leaseExpiresAt:string};
const fail=(code:string):never=>{throw new PathFinderError(code,409);};

/** Bookkeeping only. Every actual cable write separately proves the original mandate. */
export function createInitialFillAttempts(pool:Pool){
  return {
    async discover(signal?:AbortSignal){return schedulerTransaction(pool,async client=>{
      const rows=(await client.query<Row>(`/* initial-fill:discover */ SELECT m.project_id,m.id AS mandate_id,m.actor_id,p.id AS proposal_id,p.cable_id,p.proposal_hash,p.dependencies->>'cableWriteRevision' AS revision
        FROM pf_initial_fill_mandates m JOIN pf_location_impact_enrollments e ON e.project_id=m.project_id AND e.impact_id=m.impact_id
        JOIN pf_proposals p ON p.project_id=e.project_id AND p.job_id=e.job_id
        JOIN pf_job_items i ON i.project_id=p.project_id AND i.job_id=p.job_id AND i.cable_id=p.cable_id
        JOIN pf_jobs j ON j.project_id=p.project_id AND j.id=p.job_id
        LEFT JOIN pf_initial_fill_attempts a ON a.project_id=m.project_id AND a.mandate_id=m.id AND a.proposal_id=p.id
        WHERE a.proposal_id IS NULL AND i.state='complete' AND i.status='calculated' AND p.status='calculated'
          AND p.dependencies->>'schemaVersion'='pathfinder.dependencies.v7' AND j.state IN('queued','running','complete') AND NOT j.cancel_requested
        ORDER BY p.created_at,m.project_id,m.id,p.id LIMIT 10 FOR SHARE OF m,p,i,j`)).rows;
      for(const row of rows){signal?.throwIfAborted();const request=initialFillApplyRequestSchema.parse({schemaVersion:'wfc.pf.initial-fill-request.v1',
        idempotencyKey:initialFillIdempotencyKey({projectId:row.project_id,cableId:row.cable_id,proposalId:row.proposal_id,proposalHash:row.proposal_hash,mandateId:row.mandate_id,expectedCableWriteRevision:row.revision}),
        proposalId:row.proposal_id,expectedProposalHash:row.proposal_hash,mandateId:row.mandate_id,expectedCableWriteRevision:row.revision});
        await client.query(`INSERT INTO pf_initial_fill_attempts(project_id,actor_id,idempotency_key,mandate_id,proposal_id,cable_id,request_sha256,request)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,[row.project_id,row.actor_id,request.idempotencyKey,row.mandate_id,row.proposal_id,row.cable_id,hash(initialFillRequestHashInput(request)),request]);
        const exact=(await client.query<Row>('SELECT request_sha256,mandate_id,proposal_id,cable_id FROM pf_initial_fill_attempts WHERE project_id=$1 AND actor_id=$2 AND idempotency_key=$3',
          [row.project_id,row.actor_id,request.idempotencyKey])).rows[0];
        if(!exact||exact.request_sha256!==hash(initialFillRequestHashInput(request))||exact.mandate_id!==row.mandate_id||exact.proposal_id!==row.proposal_id||exact.cable_id!==row.cable_id)return fail('INITIAL_FILL_ATTEMPT_CONFLICT');
        await client.query(`INSERT INTO pf_initial_fill_dispatch(project_id,actor_id,idempotency_key) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[row.project_id,row.actor_id,request.idempotencyKey]);
      }
      return rows.length;
    },signal);},
    async claim(signal?:AbortSignal):Promise<InitialFillClaim|null>{return schedulerTransaction(pool,async client=>{
      await client.query(`WITH exhausted AS(SELECT project_id,actor_id,idempotency_key FROM pf_initial_fill_dispatch
        WHERE status IN('running','unknown') AND attempts>=3 AND lease_until<=clock_timestamp() ORDER BY lease_until,project_id,idempotency_key LIMIT 10 FOR UPDATE SKIP LOCKED)
        UPDATE pf_initial_fill_dispatch d SET status='unknown',reason_code='INITIAL_FILL_RECOVERY_LIMIT',owner_token=NULL,lease_until=NULL,not_before=NULL,updated_at=clock_timestamp()
        FROM exhausted x WHERE d.project_id=x.project_id AND d.actor_id=x.actor_id AND d.idempotency_key=x.idempotency_key`);
      const row=(await client.query<Row>(`SELECT d.project_id,d.actor_id,d.idempotency_key,a.request_sha256,a.request
        FROM pf_initial_fill_dispatch d JOIN pf_initial_fill_attempts a USING(project_id,actor_id,idempotency_key)
        WHERE d.status IN('pending','running','unknown') AND d.attempts<3 AND d.not_before<=clock_timestamp()
          AND (d.lease_until IS NULL OR d.lease_until<=clock_timestamp())
        ORDER BY d.not_before,d.project_id,d.idempotency_key LIMIT 1 FOR UPDATE OF d SKIP LOCKED`)).rows[0];
      if(!row)return null;const request=initialFillApplyRequestSchema.parse(row.request);
      if(request.idempotencyKey!==row.idempotency_key||hash(initialFillRequestHashInput(request))!==row.request_sha256)return fail('INITIAL_FILL_ATTEMPT_INTEGRITY');
      const token=randomUUID(),expiry=new Date(Date.now()+60000).toISOString();
      await client.query(`UPDATE pf_initial_fill_dispatch SET status='running',attempts=attempts+1,owner_token=$4,lease_until=$5,updated_at=clock_timestamp()
        WHERE project_id=$1 AND actor_id=$2 AND idempotency_key=$3`,[row.project_id,row.actor_id,row.idempotency_key,token,expiry]);
      return {projectId:policyUuidSchema.parse(row.project_id),actorId:policyUuidSchema.parse(row.actor_id),idempotencyKey:request.idempotencyKey,request,ownerToken:token,leaseExpiresAt:expiry};
    },signal);},
    async fence(client:PoolClient,claim:InitialFillClaim){
      const row=(await client.query<Row>(`SELECT d.status,d.owner_token,d.lease_until,a.request_sha256 FROM pf_initial_fill_dispatch d
        JOIN pf_initial_fill_attempts a USING(project_id,actor_id,idempotency_key)
        WHERE d.project_id=$1 AND d.actor_id=$2 AND d.idempotency_key=$3 FOR UPDATE OF d FOR SHARE OF a`,[claim.projectId,claim.actorId,claim.idempotencyKey])).rows[0];
      if(!row||row.status!=='running'||row.owner_token!==claim.ownerToken||new Date(row.lease_until).toISOString()!==claim.leaseExpiresAt
        ||Date.now()>=Date.parse(claim.leaseExpiresAt)||row.request_sha256!==hash(initialFillRequestHashInput(claim.request)))return fail('INITIAL_FILL_CLAIM_FENCED');
    },
    async finish(claim:InitialFillClaim,outcome:{status:string;receiptId:string|null;code?:string}){
      const allowed=['written','already-written','review-required','stale','authority-expired','refused','unknown'];if(!allowed.includes(outcome.status))return fail('INITIAL_FILL_OUTCOME_INVALID');
      return schedulerTransaction(pool,client=>client.query(`UPDATE pf_initial_fill_dispatch SET status=$4,receipt_id=$5,reason_code=$6,owner_token=NULL,lease_until=NULL,
        not_before=CASE WHEN $4='unknown' AND attempts<3 THEN clock_timestamp()+interval '5 seconds' ELSE NULL END,updated_at=clock_timestamp()
        WHERE project_id=$1 AND actor_id=$2 AND idempotency_key=$3 AND owner_token=$7`,[claim.projectId,claim.actorId,claim.idempotencyKey,outcome.status,outcome.receiptId,outcome.code??null,claim.ownerToken]));
    },
  };
}
export type InitialFillAttempts=ReturnType<typeof createInitialFillAttempts>;
