/** Narrow actual-PostgreSQL controls. No app/db bootstrap import and no automatic execution.
 * Caller must independently bind a NEW owned restore's containers/images/network before supplying
 * a NEW max:1 raw pg Pool with connectionTimeoutMillis/query_timeout=5000 and exact SQL identity.
 * Caller also bounds the containing process and durably saves the returned receipt before asserting.
 * Caller owns Pool error handling and end(); this function retains its Client listener through release.
 * Only temporary fixture tables are written; all are rolled back.
 * This verifies production match() SQL/classification, not HTTP or production-schema/FK conformance.
 */
import assert from 'node:assert/strict';
import { createHash,randomUUID } from 'node:crypto';
import type { Pool,PoolClient } from 'pg';
import { createPathFinderRepository } from './repository.js';
import type { JobPrincipal } from './jobContracts.js';
import { syntheticStraightSnapshot } from './syntheticFixture.js';
import { validateSnapshotStructure } from './matching.js';

type Candidate={objectId:string;visibility:'visible'|'hidden'|'unknown';projectId?:string;artifactId?:string;role?:'object'|'hierarchy'|'routing-leaf'};
type Target={database:'wfc_pathfinder_local';serverAddress:string;serverPort:number;syntheticProjectId:string};
type Check={name:string;status:'PASS'|'FAIL';milliseconds:number;details?:unknown;code?:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const safeCode=(error:unknown)=>{
  const code=(error as {code?:unknown})?.code;
  return typeof code==='string'&&/^[A-Z0-9_]{1,80}$/.test(code)?code:error instanceof assert.AssertionError?'ASSERTION_FAILURE':'CANDIDATE_CONTROL_FAILED';
};
const temporarySchema=`
CREATE TEMP TABLE projects(id uuid PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE users(id uuid PRIMARY KEY,is_admin boolean NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE viewer_login_bindings(login_id uuid PRIMARY KEY,user_id uuid NOT NULL,expires_at timestamptz NOT NULL,revoked_at timestamptz) ON COMMIT DROP;
CREATE TEMP TABLE pf_project_state(project_id uuid PRIMARY KEY,registry_revision bigint NOT NULL,updated_at timestamptz DEFAULT NOW()) ON COMMIT DROP;
CREATE TEMP TABLE project_model_selections(project_id uuid PRIMARY KEY,active_model_version_id uuid,selection_revision integer NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE model_versions(id uuid PRIMARY KEY,project_id uuid NOT NULL,content_fingerprint text NOT NULL,state text NOT NULL,health text NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE pf_artifacts(id uuid PRIMARY KEY,project_id uuid NOT NULL,model_version_id uuid NOT NULL,purpose text NOT NULL,created_at timestamptz NOT NULL DEFAULT NOW()) ON COMMIT DROP;
CREATE TEMP TABLE cables(id uuid PRIMARY KEY,project_id uuid NOT NULL,from_location text,to_location text) ON COMMIT DROP;
CREATE TEMP TABLE pf_locations(id uuid PRIMARY KEY,project_id uuid NOT NULL,name text NOT NULL,revision bigint NOT NULL DEFAULT 1,created_by uuid NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE pf_location_aliases(project_id uuid NOT NULL,normalized_alias text NOT NULL,display_alias text NOT NULL,location_id uuid NOT NULL,PRIMARY KEY(project_id,normalized_alias)) ON COMMIT DROP;
CREATE TEMP TABLE pf_model_objects(project_id uuid NOT NULL,artifact_id uuid NOT NULL,object_id text NOT NULL,external_id text,db_id integer,name text NOT NULL,geometry_role text NOT NULL,anchor jsonb NOT NULL,visibility text NOT NULL,match_names jsonb NOT NULL,PRIMARY KEY(project_id,artifact_id,object_id)) ON COMMIT DROP;
CREATE TEMP TABLE pf_location_bindings(project_id uuid NOT NULL,location_id uuid NOT NULL,model_version_id uuid NOT NULL,artifact_id uuid,revision bigint NOT NULL DEFAULT 1,point jsonb NOT NULL,object_id text,external_id text,source text NOT NULL,confirmed_by uuid NOT NULL,confirmed_at timestamptz NOT NULL DEFAULT NOW(),derivation text,coordinate_frame text DEFAULT 'canonical-world-metres',PRIMARY KEY(project_id,location_id,model_version_id)) ON COMMIT DROP;
CREATE TEMP TABLE pf_location_matches(project_id uuid NOT NULL,location_id uuid NOT NULL,model_version_id uuid NOT NULL,status text NOT NULL,candidate_object_ids jsonb NOT NULL,PRIMARY KEY(project_id,location_id,model_version_id)) ON COMMIT DROP;
CREATE TEMP TABLE pf_location_events(id uuid PRIMARY KEY,project_id uuid NOT NULL,location_id uuid NOT NULL,model_version_id uuid,actor_id uuid NOT NULL,kind text NOT NULL,registry_revision bigint NOT NULL,event_data jsonb NOT NULL) ON COMMIT DROP;`;

/** Root-only explicit invocation. A returned FAIL must be persisted before caller asserts/cleans up. */
export async function runCandidateEligibilityIntegration(pool:Pool,target:Target) {
  const startedAt=new Date().toISOString(),checks:Check[]=[],queryHashes=new Set<string>();
  const receipt:{schemaVersion:string;status:'PASS'|'FAIL';startedAt:string;finishedAt?:string;scope:string;target:Target;observedIdentity?:unknown;checks:Check[];cleanup?:unknown;failure?:{code:string};candidateQuerySha256?:string[];temporarySchemaSha256:string;transportErrorObserved?:boolean}={
    schemaVersion:'pathfinder.candidate-eligibility.integration.v1',status:'FAIL',startedAt,
    scope:'Real production repository.match on real PostgreSQL temporary fixture tables; outer transaction always rolls back. No HTTP/full-schema/FK/native/engineering claim. No public business-table writes.',
    target,checks,temporarySchemaSha256:createHash('sha256').update(temporarySchema).digest('hex'),
  };
  let client:PoolClient|undefined,began=false,created=false,transportFailed=false;const deadline=Date.now()+45000;
  const onClientError=()=>{transportFailed=true;};
  const budget=()=>{assert.ok(!transportFailed,'Client transport failed');assert.ok(Date.now()<deadline,'Cooperative integration deadline');};
  try {
    assert.equal(process.env.PF_LOCAL_DEMO,'true');assert.equal(target.database,'wfc_pathfinder_local');
    assert.equal(pool.options.max,1);assert.equal(pool.options.connectionTimeoutMillis,5000);assert.equal(pool.options.query_timeout,5000);
    assert.ok(typeof target.serverAddress==='string'&&target.serverAddress.length>0&&target.serverAddress.length<=128);assert.ok(Number.isSafeInteger(target.serverPort)&&target.serverPort>0&&target.serverPort<=65535);assert.match(target.syntheticProjectId,uuid);
    client=await pool.connect();
    client.on('error',onClientError);
    const identity=(await client.query('SELECT current_database() AS database,host(inet_server_addr()) AS address,inet_server_port() AS port')).rows[0];receipt.observedIdentity=identity;
    assert.deepEqual(identity,{database:target.database,address:target.serverAddress,port:target.serverPort});
    const marker=(await client.query('SELECT fixture_id FROM public.pf_synthetic_projects WHERE project_id=$1',[target.syntheticProjectId])).rows[0];assert.equal(marker?.fixture_id,'pf-local-straight-v1');
    assert.equal((await client.query("SELECT to_regclass('pg_temp.pf_model_objects') AS existing")).rows[0].existing,null);
    await client.query('BEGIN');began=true;
    await client.query("SET LOCAL statement_timeout='3s'");await client.query("SET LOCAL lock_timeout='2s'");await client.query("SET LOCAL idle_in_transaction_session_timeout='10s'");
    await client.query(temporarySchema);created=true;await client.query('SET LOCAL search_path=pg_temp,public');
    const projectId=randomUUID(),otherProject=randomUUID(),modelId=randomUUID(),artifactId=randomUUID(),oldArtifact=randomUUID(),locationId=randomUUID(),userId=randomUUID(),loginId=randomUUID();
    const who:JobPrincipal={userId,loginId,loginExpiresAt:Date.now()+3600000};
    await client.query('INSERT INTO pg_temp.projects(id) VALUES($1),($2)',[projectId,otherProject]);await client.query('INSERT INTO pg_temp.users(id,is_admin) VALUES($1,true)',[userId]);
    await client.query('INSERT INTO pg_temp.pf_project_state(project_id,registry_revision) VALUES($1,1)',[projectId]);
    await client.query('INSERT INTO pg_temp.project_model_selections(project_id,active_model_version_id,selection_revision) VALUES($1,$2,1)',[projectId,modelId]);
    await client.query("INSERT INTO pg_temp.model_versions(id,project_id,content_fingerprint,state,health) VALUES($1,$2,$3,'ready','healthy')",[modelId,projectId,'a'.repeat(64)]);
    await client.query("INSERT INTO pg_temp.pf_artifacts(id,project_id,model_version_id,purpose,created_at) VALUES($1,$2,$3,'planning',NOW()),($4,$2,$3,'planning',NOW()-interval '1 day')",[artifactId,projectId,modelId,oldArtifact]);
    const physical=client;
    const serviceClient={
      async query(sql:string,values?:unknown[]) {
        if(sql==='BEGIN') return physical.query('SAVEPOINT pf_candidate_service');
        if(sql==='COMMIT') return physical.query('RELEASE SAVEPOINT pf_candidate_service');
        if(sql==='ROLLBACK') {await physical.query('ROLLBACK TO SAVEPOINT pf_candidate_service');return physical.query('RELEASE SAVEPOINT pf_candidate_service');}
        if(sql.startsWith('SELECT * FROM pf_model_objects')) queryHashes.add(createHash('sha256').update(sql).digest('hex'));
        return physical.query(sql,values);
      },release() { /* Physical outer transaction/connection belongs to this driver. */ },
    };
    const repository=createPathFinderRepository({connect:async()=>serviceClient} as unknown as Pool);
    async function reset(candidates:Candidate[],manual=false) {
      budget();
      await physical.query('TRUNCATE pg_temp.pf_model_objects,pg_temp.pf_locations,pg_temp.pf_location_aliases,pg_temp.pf_location_bindings,pg_temp.pf_location_matches,pg_temp.pf_location_events,pg_temp.viewer_login_bindings');
      await physical.query('UPDATE pg_temp.pf_project_state SET registry_revision=1 WHERE project_id=$1',[projectId]);await physical.query('UPDATE pg_temp.users SET is_admin=true WHERE id=$1',[userId]);
      await physical.query('INSERT INTO pg_temp.pf_locations(id,project_id,name,created_by) VALUES($1,$2,$3,$4)',[locationId,projectId,'=A001',userId]);
      await physical.query('INSERT INTO pg_temp.pf_location_aliases(project_id,normalized_alias,display_alias,location_id) VALUES($1,$2,$2,$3)',[projectId,'=A001',locationId]);
      for(const candidate of candidates) await physical.query(`INSERT INTO pg_temp.pf_model_objects(project_id,artifact_id,object_id,name,geometry_role,anchor,visibility,match_names)
        VALUES($1,$2,$3,'=A001',$4,'[1,2,3]'::jsonb,$5,'["=A001"]'::jsonb)`,[candidate.projectId??projectId,candidate.artifactId??artifactId,candidate.objectId,candidate.role??'object',candidate.visibility]);
      if(manual) await physical.query(`INSERT INTO pg_temp.pf_location_bindings(project_id,location_id,model_version_id,artifact_id,point,object_id,source,confirmed_by,revision)
        VALUES($1,$2,$3,$4,'[9,8,7]'::jsonb,'manual-original','manual',$5,7)`,[projectId,locationId,modelId,oldArtifact,userId]);
    }
    async function check(name:string,operation:()=>Promise<unknown>) {const at=Date.now();try{budget();const details=await operation();checks.push({name,status:'PASS',milliseconds:Date.now()-at,...(details===undefined?{}:{details})});}catch(error){checks.push({name,status:'FAIL',milliseconds:Date.now()-at,code:safeCode(error)});}}
    async function outcome() {
      const bindings=(await physical.query('SELECT object_id,source,revision::text,point FROM pg_temp.pf_location_bindings ORDER BY location_id')).rows;
      const matches=(await physical.query('SELECT status,candidate_object_ids FROM pg_temp.pf_location_matches ORDER BY location_id')).rows;return {bindings,matches};
    }
    for(const current of [
      {name:'three-early-hidden-candidates-do-not-consume-limit-before-later-visible',rows:[{objectId:'a-hidden',visibility:'hidden'},{objectId:'b-hidden',visibility:'hidden'},{objectId:'c-hidden',visibility:'hidden'},{objectId:'z-visible',visibility:'visible'}],bound:'z-visible'},
      {name:'hidden-and-visible-bind-only-visible',rows:[{objectId:'a-hidden',visibility:'hidden'},{objectId:'z-visible',visibility:'visible'}],bound:'z-visible'},
      {name:'only-hidden-is-missing',rows:[{objectId:'hidden',visibility:'hidden'}],status:'missing',ids:[]},
      {name:'single-unknown-stays-unverified',rows:[{objectId:'unknown',visibility:'unknown'}],status:'unverified',ids:['unknown']},
      {name:'visible-and-unknown-stay-ambiguous',rows:[{objectId:'visible',visibility:'visible'},{objectId:'unknown',visibility:'unknown'}],status:'ambiguous',ids:['unknown','visible']},
      {name:'two-visible-stay-ambiguous',rows:[{objectId:'a-visible',visibility:'visible'},{objectId:'b-visible',visibility:'visible'}],status:'ambiguous',ids:['a-visible','b-visible']},
      {name:'hierarchy-and-foreign-project-artifact-do-not-enter-count',rows:[{objectId:'a-hierarchy',visibility:'visible',role:'hierarchy'},{objectId:'b-foreign-project',visibility:'visible',projectId:otherProject},{objectId:'c-old-artifact',visibility:'visible',artifactId:oldArtifact},{objectId:'z-visible',visibility:'visible'}],bound:'z-visible'},
    ] as Array<{name:string;rows:Candidate[];bound?:string;status?:string;ids?:string[]}>) await check(current.name,async()=>{
      await reset(current.rows);const matched=await repository.match(projectId,who,'1'),actual=await outcome();
      if(current.bound){assert.equal(matched.matchedLocations,1);assert.deepEqual(actual,{bindings:[{object_id:current.bound,source:'automatic',revision:'1',point:[1,2,3]}],matches:[]});}
      else {assert.equal(matched.matchedLocations,0);assert.deepEqual(actual,{bindings:[],matches:[{status:current.status,candidate_object_ids:current.ids}]});}
      return {matchedLocations:matched.matchedLocations,...actual};
    });
    await check('known-hidden-ancestor-and-planning-exclusion-fold-before-sql',async()=>{
      const snapshot=syntheticStraightSnapshot(projectId,modelId,'a'.repeat(64)),object=snapshot.objects.find(object=>object.geometryRole==='object')!;
      const ancestor={...object,id:'ancestor',parentId:null,geometryRole:'hierarchy' as const,nativeHidden:true};object.parentId='ancestor';snapshot.objects.push(ancestor);
      const inherited=validateSnapshotStructure(snapshot).get(object.id)!;ancestor.nativeHidden=false;ancestor.planningExcluded=true;const excluded=validateSnapshotStructure(snapshot).get(object.id)!;
      assert.equal(inherited,'hidden');assert.equal(excluded,'hidden');await reset([{objectId:'a-inherited',visibility:inherited},{objectId:'b-excluded',visibility:excluded},{objectId:'z-visible',visibility:'visible'}]);
      assert.equal((await repository.match(projectId,who,'1')).matchedLocations,1);assert.equal((await outcome()).bindings[0].object_id,'z-visible');return {inherited,excluded};
    });
    await check('same-model-manual-binding-precedence-retains-original-point-revision',async()=>{await reset([{objectId:'replacement',visibility:'visible'}],true);assert.equal((await repository.match(projectId,who,'1')).matchedLocations,0);assert.deepEqual(await outcome(),{bindings:[{object_id:'manual-original',source:'manual',revision:'7',point:[9,8,7]}],matches:[]});});
    for(const guard of ['admin','login','registry'] as const) await check('current-'+guard+'-fence-before-binding',async()=>{
      await reset([{objectId:'visible',visibility:'visible'}]);
      if(guard==='admin') await physical.query('UPDATE pg_temp.users SET is_admin=false WHERE id=$1',[userId]);
      if(guard==='login') await physical.query('INSERT INTO pg_temp.viewer_login_bindings(login_id,user_id,expires_at,revoked_at) VALUES($1,$2,$3,NOW())',[loginId,userId,new Date(who.loginExpiresAt)]);
      await assert.rejects(repository.match(projectId,who,guard==='registry'?'0':'1'),error=>(error as {code?:string}).code===({admin:'ADMIN_REQUIRED',login:'LOGIN_REVOKED',registry:'REGISTRY_CONFLICT'}[guard]));assert.deepEqual(await outcome(),{bindings:[],matches:[]});
    });
    assert.equal(queryHashes.size,1,'All candidate queries must share the exact production SQL');
    assert.equal(transportFailed,false,'Client transport failed');
    receipt.status=checks.length===12&&checks.every(check=>check.status==='PASS')?'PASS':'FAIL';
  } catch(error) {receipt.failure={code:safeCode(error)};}
  finally {
    if(client) {
      let cleanupFailed=false;
      try {if(began) await client.query('ROLLBACK');const absent=(await client.query("SELECT to_regclass('pg_temp.pf_model_objects') AS remaining")).rows[0].remaining===null;receipt.cleanup={status:absent?'PASS':'FAIL',outerTransactionRolledBack:began,temporaryTablesCreated:created,temporaryModelObjectsAbsent:absent};if(!absent){cleanupFailed=true;receipt.status='FAIL';}}
      catch(error){cleanupFailed=true;receipt.cleanup={status:'FAIL',code:safeCode(error)};receipt.status='FAIL';}
      try {const discard=transportFailed||cleanupFailed;client.release(discard);if(!discard)client.off('error',onClientError);}
      catch(error){receipt.cleanup={status:'FAIL',code:safeCode(error),releaseFailed:true};receipt.status='FAIL';}
    }
  }
  receipt.transportErrorObserved=transportFailed;if(transportFailed)receipt.status='FAIL';
  receipt.candidateQuerySha256=[...queryHashes];receipt.finishedAt=new Date().toISOString();return receipt;
}
