/** Actual SQL/HTTP controls. Run only inside the separately owned local demo backend. */
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import jwt from 'jsonwebtoken';
import { pool } from '../db.js';
import { config } from '../config.js';
import { signAccessToken } from '../auth.js';
import { syntheticStraightSnapshot } from './syntheticFixture.js';
import { pathFinderRoot, snapshotFilename } from './storage.js';
import { principalTransaction } from './auth.js';
import { lockProject } from './repository.js';

type Json = Record<string,any>;
export async function runPathFinderIntegration(projectId:string) {
  assert.equal(process.env.PF_LOCAL_DEMO,'true','Explicit isolated local demo required');
  assert.match(projectId,/^[0-9a-f-]{36}$/);
  assert.equal((await pool.query('SELECT current_database() AS name')).rows[0].name,'wfc_pathfinder_local');
  const marker = (await pool.query('SELECT fixture_id FROM pf_synthetic_projects WHERE project_id=$1',[projectId])).rows[0];
  assert.equal(marker?.fixture_id,'pf-local-straight-v1','Server-seeded synthetic project required');
  const origin = process.env.PF_TEST_API_ORIGIN ?? 'http://127.0.0.1:4000';
  const parsed = new URL(origin); assert.equal(parsed.protocol,'http:'); assert.ok(['127.0.0.1','localhost'].includes(parsed.hostname)); assert.equal(parsed.port,'4000'); assert.equal(parsed.pathname,'/');
  const actorId = randomUUID(),suffix = actorId.replaceAll('-','').slice(0,10),cableIds = [randomUUID(),randomUUID()];
  const prefix = `pf_test_${suffix}`,pauseKey = Math.floor(Math.random()*1_000_000_000)+1;
  const locationIds:string[] = [],uploadedArtifacts:string[] = [],checks:Json[] = [],cleanup:Json[] = [];
  const beforeSettings = (await pool.query('SELECT secondary_tray_length::text,end_connection_length::text,additional_bending_percent::text FROM projects WHERE id=$1',[projectId])).rows[0];
  const initialModel = (await pool.query('SELECT active_model_version_id FROM project_model_selections WHERE project_id=$1',[projectId])).rows[0].active_model_version_id;
  await pool.query('INSERT INTO users(id,email,password_hash,is_admin,role) VALUES($1,$2,$3,true,$4)',[actorId,`${actorId}@pf-integration.invalid`,'Isolated direct-service fixture; no login password.','admin']);
  const email = `${actorId}@pf-integration.invalid`,token = signAccessToken(actorId,email,true).token;
  const base = `/api/projects/${projectId}/pathfinder`;
  async function request(method:string,url:string,body?:unknown,bearer=token) {
    const response = await fetch(origin+url,{method,headers:{Authorization:`Bearer ${bearer}`,...(body === undefined ? {} : {'Content-Type':'application/json'})},body:body === undefined ? undefined : JSON.stringify(body)});
    const value = response.status===204 ? {} : await response.json() as Json; return {status:response.status,value};
  }
  async function api(method:string,url:string,body?:unknown,bearer=token):Promise<Json> {
    const response = await request(method,url,body,bearer); assert.ok(response.status>=200 && response.status<300,`${method} ${url}: ${response.status} ${response.value.code ?? ''}`); return response.value;
  }
  async function state() {return api('GET',base+'/state');}
  async function waitFor<T>(action:()=>Promise<T|undefined>,milliseconds=15000):Promise<T> {
    const end = Date.now()+milliseconds;
    while (Date.now()<end) {const value=await action(); if (value !== undefined) return value; await delay(50);}
    throw Error('Isolated integration condition did not settle within its deadline.');
  }
  async function calculate():Promise<Json> {
    await pool.query('UPDATE cables SET tag=$2 WHERE id=$1',[cableIds[0],'PF-INTEGRATION-'+randomUUID()]);
    const current = await state(),accepted = await api('POST',base+'/jobs',{cableIds:[cableIds[0]],expectedRegistryRevision:current.registryRevision,force:true});
    await waitFor(async () => {const job=await api('GET',base+'/jobs/'+accepted.jobId); if (job.status==='failed' || job.status==='cancelled') throw Error('Calculation stopped: '+job.failure); return job.status==='complete' ? job : undefined;},45000);
    const row = (await pool.query('SELECT id FROM pf_proposals WHERE project_id=$1 AND job_id=$2 AND cable_id=$3',[projectId,accepted.jobId,cableIds[0]])).rows[0];
    assert.ok(row?.id,'Expected a proposal, rather than a fabricated blocked result.');
    return api('GET',base+'/proposals/'+row.id);
  }
  async function reviewed(proposal:Json,bearer=token):Promise<Json> {
    return api('POST',base+'/proposals/'+proposal.id+'/review',{expectedProposalHash:proposal.proposalHash},bearer);
  }
  async function apply(proposal:Json,reviewId:string,idempotencyKey=randomUUID(),bearer=token) {
    return request('POST',base+'/proposals/'+proposal.id+'/apply',{reviewId,idempotencyKey,expectedCableWriteRevision:proposal.cableWriteRevision},bearer);
  }
  async function cable() {return (await pool.query('SELECT routing,design_length,install_length,cable_write_revision::text FROM cables WHERE id=$1',[cableIds[0]])).rows[0];}
  async function test(name:string,run:()=>Promise<unknown>) {
    const started=Date.now();
    try {const details=await run(); checks.push({name,status:'PASS',milliseconds:Date.now()-started,...(details === undefined ? {} : {details})});}
    catch(error) {checks.push({name,status:'FAIL',milliseconds:Date.now()-started,message:error instanceof Error ? error.message : 'Unknown test failure'});}
  }
  async function installPause() {
    await pool.query(`CREATE FUNCTION ${prefix}_pause() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.id='${cableIds[0]}'::uuid THEN PERFORM pg_advisory_xact_lock(${pauseKey}); END IF; RETURN NEW; END $$;
      CREATE TRIGGER ${prefix}_pause AFTER UPDATE OF routing,design_length ON cables FOR EACH ROW EXECUTE FUNCTION ${prefix}_pause()`);
    const holder=await pool.connect(); await holder.query('SELECT pg_advisory_lock($1)',[pauseKey]); return holder;
  }
  async function dropPause() {await pool.query(`DROP TRIGGER IF EXISTS ${prefix}_pause ON cables; DROP FUNCTION IF EXISTS ${prefix}_pause()`);}
  async function waitForPausedApply() {
    await waitFor(async () => (await pool.query(`SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND state='active' AND wait_event_type='Lock'
      AND position('UPDATE cables c SET routing=' IN query)>0 LIMIT 1`)).rows.length ? true : undefined);
  }
  try {
    const typeId = (await pool.query('SELECT id FROM cable_types WHERE project_id=$1 ORDER BY created_at,id LIMIT 1',[projectId])).rows[0].id;
    const from=`=PF-TEST-FROM-${suffix}`,to=`=PF-TEST-TO-${suffix}`;
    for (let i=0;i<2;i++) await pool.query(`INSERT INTO cables(id,project_id,cable_id,cable_type_id,mto,tag,from_location,to_location,install_length)
      SELECT $1,$2,COALESCE(MAX(cable_id),0)+1,$3,$4,$5,$6,$7,$8 FROM cables WHERE project_id=$2`,[cableIds[i],projectId,typeId,i?'Control':'Instrumentation',`PF-INTEGRATION-${suffix}-${i}`,i?to:from,i?from:to,i?98:99]);
    for (const [name,point] of [[from,[0,0,.5]],[to,[10,0,.5]]] as const) {
      let current=await state();const created=await api('POST',base+'/locations',{name,aliases:[],expectedRegistryRevision:current.registryRevision}); locationIds.push(created.locationId);
      current=await state();await api('PUT',base+'/locations/'+created.locationId+'/binding',{modelVersionId:initialModel,expectedSelectionRevision:current.activeModel.selectionRevision,
        expectedRegistryRevision:current.registryRevision,point,objectId:null,externalId:null,derivation:'manual-world-point'});
    }
    await test('shared project locations resolve both From/To uses',async () => {
      assert.equal((await request('GET',base+'/authorization')).status,204);
      const current=await state(),first=current.cables.find((value:Json)=>value.id===cableIds[0]),second=current.cables.find((value:Json)=>value.id===cableIds[1]);
      assert.equal(first.fromMatch.status,'matched');assert.equal(first.toMatch.status,'matched');assert.equal(first.fromMatch.locationId,second.toMatch.locationId);assert.equal(first.toMatch.locationId,second.fromMatch.locationId);
    });
    await test('project mutex permits mixed-import and admin-assignment FK lock orders without a deadlock',async()=>{
      const importer=await pool.connect();let pf:Promise<unknown>|undefined;
      try {
        await importer.query('BEGIN');await importer.query("SET LOCAL statement_timeout='3s'");
        await importer.query('SELECT id FROM cables WHERE id=$1 FOR UPDATE',[cableIds[0]]);
        let signal!:()=>void;const entered=new Promise<void>(resolve=>{signal=resolve;});
        const claims=jwt.decode(token) as jwt.JwtPayload;
        pf=principalTransaction(pool,projectId,{userId:actorId,loginId:claims.jti!,loginExpiresAt:claims.exp!*1000},async client=>{
          signal();await client.query('SELECT id FROM cables WHERE id=$1 FOR UPDATE',[cableIds[0]]);
        });
        await Promise.race([entered,pf]);
        // A real inserted cable performs project KEY SHARE while PF holds the project mutex and awaits this import's existing cable.
        await importer.query(`INSERT INTO cables(id,project_id,cable_id,cable_type_id,mto,tag,from_location,to_location)
          SELECT $1,project_id,(SELECT COALESCE(MAX(cable_id),0)+1 FROM cables WHERE project_id=$2),cable_type_id,mto,'PF-LOCK-CONTROL',from_location,to_location FROM cables WHERE id=$3`,[randomUUID(),projectId,cableIds[0]]);
        await importer.query('ROLLBACK');await pf;
      } finally {await importer.query('ROLLBACK');importer.release();await pf;}
      const assignment=await pool.connect(),pfClient=await pool.connect();let waiting:Promise<unknown>|undefined;
      try {
        await assignment.query('BEGIN');await assignment.query("SET LOCAL statement_timeout='3s'");await assignment.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[actorId]);
        await pfClient.query('BEGIN');await pfClient.query("SET LOCAL statement_timeout='3s'");await lockProject(pfClient,projectId);
        waiting=pfClient.query('SELECT is_admin FROM users WHERE id=$1 FOR SHARE',[actorId]);
        // This is the existing admin-assignment order: user UPDATE followed by project FK KEY SHARE.
        await assignment.query('SELECT id FROM projects WHERE id=$1 FOR KEY SHARE',[projectId]);
        await assignment.query('ROLLBACK');await waiting;
      } finally {await assignment.query('ROLLBACK');await pfClient.query('ROLLBACK');assignment.release();pfClient.release();await waiting;}
    });
    await test('actual durable job creates exact synthetic Instrumentation proposal',async () => {
      const proposal=await calculate();assert.equal(proposal.status,'calculated');assert.equal(proposal.route.lengthMeters,10);assert.equal(proposal.design.designLengthMeters,'18');
      assert.equal(proposal.effectiveCategory,'Control');assert.equal(proposal.synthetic,true);assert.equal(proposal.acceptanceScope,'local-synthetic-fixture');assert.ok(proposal.route.points.length>=2);
      return {geometry:proposal.route.lengthMeters,design:proposal.design.designLengthMeters,scope:proposal.acceptanceScope};
    });
    await test('queued ordered lookup and Reverse preserve exact points without Apply or cable changes',async () => {
      const before=await cable();
      for(const reverse of [false,true]) {
        const current=await state(),accepted=await api('POST',base+'/lookups',{routeText:'/BC001/BC001/SECONDARY',reverse,
          expectedSelectionRevision:current.activeModel.selectionRevision,artifactId:current.artifacts[0].id});
        const result=await waitFor(async()=>{const value=await api('GET',base+'/lookups/'+accepted.jobId);if(value.status==='failed')throw Error(value.failure);return value.status==='complete'?value:undefined;},45000);
        assert.equal(result.kind,'lookup');assert.equal(result.result.status,'calculated');assert.equal(result.result.route.lengthMeters,10);assert.equal(result.result.design,null);
        assert.equal(result.result.acceptanceScope,'diagnostic-lookup');assert.equal(result.result.engineeringAccepted,false);assert.equal(result.result.route.points[0][0],reverse?10:0);
        assert.equal((await request('POST',base+'/proposals/'+accepted.jobId+'/review',{expectedProposalHash:'a'.repeat(64)})).status,404);
      }
      assert.deepEqual(await cable(),before);
    });
    await test('lookup result becomes stale after model selection revision changes',async () => {
      const current=await state(),accepted=await api('POST',base+'/lookups',{routeText:'/BC001',reverse:false,expectedSelectionRevision:current.activeModel.selectionRevision,artifactId:current.artifacts[0].id});
      await waitFor(async()=>{const value=await api('GET',base+'/lookups/'+accepted.jobId);return value.status==='complete'?value:undefined;},45000);
      await pool.query('UPDATE project_model_selections SET active_model_version_id=NULL,selection_revision=selection_revision+1 WHERE project_id=$1',[projectId]);
      await pool.query('UPDATE project_model_selections SET active_model_version_id=$2,selection_revision=selection_revision+1 WHERE project_id=$1',[projectId,initialModel]);
      assert.equal((await api('GET',base+'/lookups/'+accepted.jobId)).result.stale,true);
    });
    await test('explicit forced retry replaces a seeded transient failure while automatic requests deduplicate',async () => {
      const proposal=await calculate(),oldJobId=proposal.jobId;
      // Deliberately seed a failed item in this private fixture; do not invent a successful engine result.
      await pool.query('DELETE FROM pf_proposals WHERE project_id=$1 AND job_id=$2',[projectId,oldJobId]);
      await pool.query("UPDATE pf_job_items SET status='deadline_exceeded',message='Synthetic transient-failure control' WHERE project_id=$1 AND job_id=$2",[projectId,oldJobId]);
      const current=await state(),body={cableIds:[cableIds[0]],expectedRegistryRevision:current.registryRevision};
      const repeated=await api('POST',base+'/jobs',body);assert.equal(repeated.jobId,oldJobId);assert.equal(repeated.duplicate,true);
      const forced=await api('POST',base+'/jobs',{...body,force:true});assert.notEqual(forced.jobId,oldJobId);assert.equal(forced.duplicate,false);
      await waitFor(async()=>{const job=await api('GET',base+'/jobs/'+forced.jobId);return job.status==='complete'?job:undefined;},45000);
      const row=(await pool.query('SELECT id FROM pf_proposals WHERE project_id=$1 AND job_id=$2 AND cable_id=$3',[projectId,forced.jobId,cableIds[0]])).rows[0];
      assert.equal((await api('GET',base+'/proposals/'+row.id)).status,'calculated');
    });
    await test('explicit Review + Apply preserves installLength, adds history and replays idempotently',async () => {
      const proposal=await calculate(),review=await reviewed(proposal),key=randomUUID(),first=await apply(proposal,review.reviewId,key);
      assert.equal(first.status,200);assert.equal((await cable()).install_length,99);assert.equal((await cable()).design_length,18);
      const repeat=await apply(proposal,review.reviewId,key);assert.equal(repeat.status,200);assert.equal(repeat.value.duplicate,true);assert.equal(repeat.value.receipt.id,first.value.receipt.id);
      const mismatch=await apply(proposal,randomUUID(),key);assert.equal(mismatch.status,409);assert.equal(mismatch.value.code,'IDEMPOTENCY_CONFLICT');
      const history=(await pool.query('SELECT change_source,install_length FROM cable_versions WHERE cable_id=$1 ORDER BY version_number DESC LIMIT 1',[cableIds[0]])).rows[0];assert.equal(history.change_source,'pathfinder');assert.equal(history.install_length,99);
      const same=await calculate(),sameReview=await reviewed(same),beforeSame=await cable(),sameKey=randomUUID();
      assert.equal((await apply(same,sameReview.reviewId,sameKey)).status,200);
      const afterSame=await cable();assert.equal(BigInt(afterSame.cable_write_revision),BigInt(beforeSame.cable_write_revision)+1n);assert.equal(afterSame.routing,beforeSame.routing);assert.equal(afterSame.design_length,beforeSame.design_length);
      assert.equal((await apply(same,sameReview.reviewId,sameKey)).value.duplicate,true);assert.equal((await cable()).cable_write_revision,afterSame.cable_write_revision);
      assert.equal((await api('GET',base+'/proposals/'+same.id)).stale,true);assert.equal((await apply(same,sameReview.reviewId)).value.code,'PROPOSAL_STALE');
    });
    await test('manual routing A to B to A conflicts despite identical final inputs',async () => {
      const proposal=await calculate(),review=await reviewed(proposal),before=await cable();await pool.query("UPDATE cables SET routing='/MANUAL' WHERE id=$1",[cableIds[0]]);await pool.query('UPDATE cables SET routing=$2 WHERE id=$1',[cableIds[0],before.routing]);
      const result=await apply(proposal,review.reviewId);assert.equal(result.status,409);assert.equal(result.value.code,'PROPOSAL_STALE');assert.equal((await cable()).design_length,before.design_length);
    });
    await test('settings-only rerun uses retained geometry and exact Project Details formula',async () => {
      await calculate();await pool.query('UPDATE projects SET end_connection_length=8 WHERE id=$1',[projectId]);
      try {const proposal=await calculate();assert.equal(proposal.calculationMode,'design');assert.equal(proposal.route.lengthMeters,10);assert.equal(proposal.design.designLengthMeters,'20');}
      finally {await pool.query('UPDATE projects SET end_connection_length=6 WHERE id=$1',[projectId]);}
    });
    await test('allowance A to B to A revision invalidates reviewed result',async () => {
      const proposal=await calculate(),review=await reviewed(proposal);await pool.query('UPDATE projects SET end_connection_length=7 WHERE id=$1',[projectId]);await pool.query('UPDATE projects SET end_connection_length=6 WHERE id=$1',[projectId]);
      const result=await apply(proposal,review.reviewId);assert.equal(result.status,409);assert.equal(result.value.code,'PROPOSAL_STALE');
    });
    await test('active model selection A to null to A invalidates reviewed result',async () => {
      const proposal=await calculate(),review=await reviewed(proposal);await pool.query('UPDATE project_model_selections SET active_model_version_id=NULL,selection_revision=selection_revision+1 WHERE project_id=$1',[projectId]);await pool.query('UPDATE project_model_selections SET active_model_version_id=$2,selection_revision=selection_revision+1 WHERE project_id=$1',[projectId,initialModel]);
      const result=await apply(proposal,review.reviewId);assert.equal(result.status,409);assert.equal(result.value.code,'PROPOSAL_STALE');
    });
    await test('revoked login cannot write locations, match, enqueue or read PF state',async () => {
      const revoked=signAccessToken(actorId,email,true).token,claims=jwt.decode(revoked) as jwt.JwtPayload;
      await pool.query('INSERT INTO viewer_login_bindings(login_id,user_id,expires_at,revoked_at) VALUES($1,$2,$3,NOW())',[claims.jti,actorId,new Date(claims.exp!*1000)]);
      const current=await state();
      for (const [method,url,body] of [['GET',base+'/authorization',undefined],['GET',base+'/state',undefined],['POST',base+'/locations',{name:'REVOKED-'+suffix,aliases:[],expectedRegistryRevision:current.registryRevision}],['POST',base+'/match',{expectedRegistryRevision:current.registryRevision}],['POST',base+'/jobs',{cableIds:[cableIds[0]],expectedRegistryRevision:current.registryRevision}]] as const) {
        const result=await request(method,url,body,revoked);assert.equal(result.status,401);assert.equal(result.value.code,'LOGIN_REVOKED');
      }
      assert.equal((await pool.query('SELECT 1 FROM pf_location_aliases WHERE project_id=$1 AND normalized_alias=$2',[projectId,'REVOKED-'+suffix.toUpperCase()])).rows.length,0);
    });
    await test('current admin revocation and cross-project proposal lookup are denied',async () => {
      const proposal=await calculate();await pool.query("UPDATE users SET is_admin=false,role='engineer' WHERE id=$1",[actorId]);
      try {assert.equal((await request('GET',base+'/state')).status,403);assert.equal((await request('GET',base+'/authorization')).status,403);} finally {await pool.query("UPDATE users SET is_admin=true,role='admin' WHERE id=$1",[actorId]);}
      const other=(await pool.query('SELECT id FROM projects WHERE id<>$1 ORDER BY created_at LIMIT 1',[projectId])).rows[0];assert.ok(other);
      assert.equal((await request('GET',`/api/projects/${other.id}/pathfinder/proposals/${proposal.id}`)).status,404);
    });
    await test('cancellation reaches terminal only after owned calculation stops',async () => {
      await pool.query('UPDATE cables SET tag=$2 WHERE id=$1',[cableIds[0],'CANCEL-'+randomUUID()]);const current=await state(),job=await api('POST',base+'/jobs',{cableIds:[cableIds[0]],expectedRegistryRevision:current.registryRevision});await api('DELETE',base+'/jobs/'+job.jobId);
      const terminal=await waitFor(async () => {const value=await api('GET',base+'/jobs/'+job.jobId);return ['cancelled','failed'].includes(value.status)?value:undefined;},15000);assert.equal(terminal.status,'cancelled');
      const unchanged=await state(),automaticRequest=await api('POST',base+'/jobs',{cableIds:[cableIds[0]],expectedRegistryRevision:unchanged.registryRevision});
      assert.equal(automaticRequest.jobId,job.jobId);assert.equal(automaticRequest.paused,true);
      await delay(16100);
      const recreated=await pool.query(`SELECT 1 FROM pf_jobs WHERE project_id=$1 AND requested_by=$2 AND kind='calculate'
        AND created_at>(SELECT created_at FROM pf_jobs WHERE id=$3) LIMIT 1`,[projectId,actorId,job.jobId]);
      assert.equal(recreated.rows.length,0,'Automatic scanning must honor the latest cancellation until an explicit Calculate resumes it.');
    });
    await test('expired lease recovery fences the obsolete owner and publishes once',async () => {
      await pool.query('UPDATE cables SET tag=$2 WHERE id=$1',[cableIds[0],'RECOVER-'+randomUUID()]);const current=await state(),accepted=await api('POST',base+'/jobs',{cableIds:[cableIds[0]],expectedRegistryRevision:current.registryRevision,force:true}),old=randomUUID();
      await pool.query("UPDATE pf_jobs SET state='running',owner_token=$2,lease_until=NOW()-INTERVAL '1 second' WHERE id=$1",[accepted.jobId,old]);
      await waitFor(async () => {const value=await api('GET',base+'/jobs/'+accepted.jobId);return value.status==='complete'?value:undefined;},45000);
      assert.equal((await pool.query('UPDATE pf_jobs SET completed=999 WHERE id=$1 AND owner_token=$2 RETURNING id',[accepted.jobId,old])).rows.length,0);
      assert.equal((await pool.query('SELECT count(*)::int AS count FROM pf_proposals WHERE job_id=$1 AND cable_id=$2',[accepted.jobId,cableIds[0]])).rows[0].count,1);
    });
    await test('receipt failure rolls back cable, history and receipt atomically',async () => {
      const proposal=await calculate(),review=await reviewed(proposal),before=await cable(),history=(await pool.query('SELECT count(*)::int AS count FROM cable_versions WHERE cable_id=$1',[cableIds[0]])).rows[0].count;
      await pool.query(`CREATE FUNCTION ${prefix}_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.cable_id='${cableIds[0]}'::uuid THEN RAISE EXCEPTION 'Owned rollback control'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER ${prefix}_fail BEFORE INSERT ON pf_apply_receipts FOR EACH ROW EXECUTE FUNCTION ${prefix}_fail()`);
      try {assert.equal((await apply(proposal,review.reviewId)).status,500);assert.deepEqual(await cable(),before);assert.equal((await pool.query('SELECT count(*)::int AS count FROM cable_versions WHERE cable_id=$1',[cableIds[0]])).rows[0].count,history);}
      finally {await pool.query(`DROP TRIGGER IF EXISTS ${prefix}_fail ON pf_apply_receipts;DROP FUNCTION IF EXISTS ${prefix}_fail()`);}
    });
    await test('admin revocation waits until protected Apply commits',async () => {
      const proposal=await calculate(),review=await reviewed(proposal),holder=await installPause();let pending:Promise<any>|undefined;
      try {
        const applying=apply(proposal,review.reviewId);await waitForPausedApply();let finished=false;
        pending=pool.query('UPDATE users SET is_admin=false WHERE id=$1',[actorId]).then(value=>{finished=true;return value;});await delay(100);assert.equal(finished,false);
        await holder.query('SELECT pg_advisory_unlock($1)',[pauseKey]);assert.equal((await applying).status,200);await pending;
      } finally {await holder.query('SELECT pg_advisory_unlock($1)',[pauseKey]);holder.release();await pending;await pool.query("UPDATE users SET is_admin=true,role='admin' WHERE id=$1",[actorId]);await dropPause();}
    });
    await test('model health changes wait until protected Apply commits',async () => {
      const proposal=await calculate(),review=await reviewed(proposal),holder=await installPause();let pending:Promise<any>|undefined;
      try {
        const applying=apply(proposal,review.reviewId);await waitForPausedApply();let finished=false;
        pending=pool.query("UPDATE model_versions SET health='unavailable' WHERE project_id=$1 AND id=$2",[projectId,initialModel]).then(value=>{finished=true;return value;});await delay(100);assert.equal(finished,false);
        await holder.query('SELECT pg_advisory_unlock($1)',[pauseKey]);assert.equal((await applying).status,200);await pending;
      } finally {await holder.query('SELECT pg_advisory_unlock($1)',[pauseKey]);holder.release();await pending;await pool.query("UPDATE model_versions SET health='healthy' WHERE project_id=$1 AND id=$2",[projectId,initialModel]);await dropPause();}
    });
    await test('login expiration while Apply is paused rolls the write back',async () => {
      const proposal=await calculate(),review=await reviewed(proposal),before=await cable();
      const short=jwt.sign({sub:actorId,email,isAdmin:true,jti:randomUUID()},config.jwtSecret,{expiresIn:3}),claims=jwt.decode(short) as jwt.JwtPayload,holder=await installPause();
      try {const applying=apply(proposal,review.reviewId,randomUUID(),short);await waitForPausedApply();await delay(Math.max(0,claims.exp!*1000-Date.now()+80));await holder.query('SELECT pg_advisory_unlock($1)',[pauseKey]);const result=await applying;assert.equal(result.status,401);assert.equal(result.value.code,'LOGIN_EXPIRED');assert.deepEqual(await cable(),before);}
      finally {await holder.query('SELECT pg_advisory_unlock($1)',[pauseKey]);holder.release();await dropPause();}
    });
    await test('HTTP-uploaded geometry cannot acquire the seeded synthetic proof',async () => {
      let current=await state();const snapshot=syntheticStraightSnapshot(projectId,initialModel,current.activeModel.contentFingerprint);
      assert.equal((await request('POST',base+'/artifacts',{modelVersionId:initialModel,expectedSelectionRevision:current.activeModel.selectionRevision,expectedRegistryRevision:current.registryRevision,snapshot,engineeringAccepted:true})).status,400);
      const uploaded=await api('POST',base+'/artifacts',{modelVersionId:initialModel,expectedSelectionRevision:current.activeModel.selectionRevision,expectedRegistryRevision:current.registryRevision,snapshot});uploadedArtifacts.push(uploaded.artifactId);assert.equal(uploaded.engineeringAccepted,false);
      for (const [index,locationId] of locationIds.entries()) {current=await state();await api('PUT',base+'/locations/'+locationId+'/binding',{modelVersionId:initialModel,expectedSelectionRevision:current.activeModel.selectionRevision,expectedRegistryRevision:current.registryRevision,point:index?[10,0,.5]:[0,0,.5],objectId:null,externalId:null});}
      const proposal=await calculate(),review=await reviewed(proposal);assert.equal(proposal.synthetic,false);assert.equal(proposal.canApply,false);const result=await apply(proposal,review.reviewId);assert.equal(result.status,409);assert.equal(result.value.code,'ENGINEERING_ACCEPTANCE_REQUIRED');
    });
  } finally {
    await pool.query(`DROP TRIGGER IF EXISTS ${prefix}_pause ON cables;DROP FUNCTION IF EXISTS ${prefix}_pause();DROP TRIGGER IF EXISTS ${prefix}_fail ON pf_apply_receipts;DROP FUNCTION IF EXISTS ${prefix}_fail()`).catch(error=>cleanup.push({name:'temporary SQL triggers',status:'FAIL',message:error.message}));
    await pool.query("UPDATE users SET is_admin=true,role='admin' WHERE id=$1",[actorId]);
    await pool.query('UPDATE projects SET secondary_tray_length=$2,end_connection_length=$3,additional_bending_percent=$4 WHERE id=$1',[projectId,beforeSettings.secondary_tray_length,beforeSettings.end_connection_length,beforeSettings.additional_bending_percent]);
    await pool.query('UPDATE project_model_selections SET active_model_version_id=$2,selection_revision=selection_revision+CASE WHEN active_model_version_id IS DISTINCT FROM $2::uuid THEN 1 ELSE 0 END WHERE project_id=$1',[projectId,initialModel]);
    await pool.query("UPDATE model_versions SET health='healthy' WHERE project_id=$1 AND id=$2",[projectId,initialModel]);
    await pool.query("UPDATE pf_jobs SET cancel_requested=true WHERE requested_by=$1 AND state IN ('queued','running')",[actorId]);
    await waitFor(async ()=>(await pool.query("SELECT 1 FROM pf_jobs WHERE requested_by=$1 AND state='running'",[actorId])).rows.length?undefined:true,15000).catch(error=>cleanup.push({name:'owned jobs stopped',status:'FAIL',message:error.message}));
    await pool.query('DELETE FROM pf_jobs WHERE requested_by=$1',[actorId]);await pool.query('DELETE FROM cables WHERE id=ANY($1::uuid[])',[cableIds]);
    await pool.query('DELETE FROM pf_locations WHERE project_id=$1 AND id=ANY($2::uuid[])',[projectId,locationIds]);
    for (const id of uploadedArtifacts) {
      const row=(await pool.query('DELETE FROM pf_artifacts WHERE project_id=$1 AND id=$2 RETURNING snapshot_sha256',[projectId,id])).rows[0];
      if (row) {const filename=await snapshotFilename(id),bytes=await fs.readFile(filename);assert.equal(createHash('sha256').update(bytes).digest('hex'),row.snapshot_sha256);await fs.unlink(filename);}
    }
    // Reestablish automatic demonstration bindings after deleting only the test upload.
    const current=await state();await api('POST',base+'/match',{expectedRegistryRevision:current.registryRevision});
    await pool.query('DELETE FROM viewer_login_bindings WHERE user_id=$1',[actorId]);await pool.query('DELETE FROM users WHERE id=$1',[actorId]);
    cleanup.push({name:'fixture admin/cables/locations/jobs/uploads removed; original synthetic allowances/model restored; immutable audit events retained',status:'PASS'});
  }
  const result={schemaVersion:'pathfinder.integration.v1',recordedAtUtc:new Date().toISOString(),projectId,scope:'separate local synthetic fixture only',status:checks.every(value=>value.status==='PASS') && cleanup.every(value=>value.status==='PASS')?'PASS':'FAIL',
    passed:checks.filter(value=>value.status==='PASS').length,total:checks.length,checks,cleanup,nativeParity:'BLOCKED; synthetic integration does not establish real model engineering acceptance.',
    sourceSha256:createHash('sha256').update(await fs.readFile(new URL(import.meta.url))).digest('hex')};
  const root=await pathFinderRoot(),directory=path.join(root,'integration');await fs.mkdir(directory,{recursive:true});const filename=path.join(directory,'integration-'+randomUUID()+'.json');await fs.writeFile(filename,JSON.stringify(result,null,2),{flag:'wx'});
  console.log(JSON.stringify({...result,evidence:filename}));return result;
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {const result=await runPathFinderIntegration(process.argv[2]);process.exitCode=result.status==='PASS'?0:1;}
  catch(error) {console.error(error instanceof Error ? error.message : 'Isolated integration failed.');process.exitCode=1;} finally {await pool.end();}
}
