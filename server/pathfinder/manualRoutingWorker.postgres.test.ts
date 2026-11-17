// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeCableRoutingControlSchema } from './cableRoutingControlSchema.js';
import { initializeManualRoutingSchema } from './manualRoutingSchema.js';
import { applyCableRoutingControlInTransaction, enqueueManualRouteCalculation, readCableRoutingControl, readCableRoutingViews } from './cableRoutingControlRepository.js';
import { createManualRoutingWorker, type ManualRoutingClaim, type ManualRoutingCollection } from './manualRoutingWorker.js';
import { manualPhysicalCodes } from './manualRoutingContracts.js';
import { syntheticBarrierWriteInputs } from './barrierWriteFixtures.js';
import { buildCableEngineRequest } from './worker.js';
import { PathFinderError } from './errors.js';
import type { EngineInvocation } from './engineSession.js';
import type { EngineResponse } from './jobContracts.js';
import { createManualRoutingNativeFixture } from './manualRoutingNativeFixture.js';
import { readCableObstacleLinks } from './cableObstacleLinks.js';

// Actual transactions, claims, authority rows, immutable records, invalidation
// triggers and read verification. Synthetic collection is explicitly injected;
// optional native cases use real freshly executed C# geometry separately.
describe.skipIf(process.env.WFC_ROUTING_CONTROL_POSTGRES!=='1')('manual route worker on an owned actual PostgreSQL database',()=>{
  const database='wfc_manual_route_'+randomUUID().replaceAll('-',''),f=syntheticBarrierWriteInputs(),projectId=f.dependencies.projectId;
  const actorId=randomUUID(),loginId=randomUUID(),installationEpoch=randomUUID();
  const principal={userId:actorId,loginId,loginExpiresAt:Date.now()+3600000};
  let admin:Pool,pool:Pool,created=false,closing=false;
  beforeAll(async()=>{
    const inspected=JSON.parse(execFileSync('docker',['inspect','wfc-test-postgres'],{encoding:'utf8'}))[0],ports=inspected.NetworkSettings.Ports['5432/tcp'];
    if(ports.length!==1||ports[0].HostIp!=='127.0.0.1'||ports[0].HostPort!=='55432')throw Error('Unexpected owned PostgreSQL boundary.');
    const env=Object.fromEntries(inspected.Config.Env.map((v:string)=>{const at=v.indexOf('=');return[v.slice(0,at),v.slice(at+1)];}));
    const config={host:'127.0.0.1',port:55432,user:env.POSTGRES_USER??'postgres',password:env.POSTGRES_PASSWORD,connectionTimeoutMillis:5000,statement_timeout:10000};
    admin=new Pool({...config,database:'postgres',max:1});
    if(!/^wfc_manual_route_[a-f0-9]{32}$/.test(database))throw Error('Invalid owned database.');
    await admin.query(`CREATE DATABASE ${database}`);created=true;pool=new Pool({...config,database,max:5});
    pool.on('error',(error:Error&{code?:string})=>{if(closing&&error.code==='57P01')return;throw new Error('Owned PostgreSQL pool failed: '+(error.code??'UNKNOWN'));});
    expect((await pool.query('SELECT current_database() AS name')).rows[0].name).toBe(database);
    await pool.query(`CREATE TABLE projects(id uuid PRIMARY KEY);
      CREATE TABLE users(id uuid PRIMARY KEY,is_admin boolean NOT NULL,pf_admin_revision bigint NOT NULL DEFAULT 1,first_name text,last_name text,email text);
      CREATE TABLE viewer_login_bindings(login_id uuid PRIMARY KEY,user_id uuid NOT NULL,expires_at timestamptz NOT NULL,revoked_at timestamptz);
      CREATE TABLE pf_installation_state(singleton boolean PRIMARY KEY,installation_epoch uuid NOT NULL);
      CREATE TABLE cable_types(id uuid PRIMARY KEY,project_id uuid,name text);
      CREATE TABLE cables(remarks text,id uuid PRIMARY KEY,project_id uuid NOT NULL,cable_id integer,revision text DEFAULT '00',tag text,mto text DEFAULT 'LV',routing text,
        from_location text DEFAULT 'FROM',to_location text DEFAULT 'TO',cable_type_id uuid,design_length numeric,install_length numeric,
        pull_date date,connected_from date,connected_to date,tested date,delivery text,updated_at timestamptz NOT NULL DEFAULT now(),cable_write_revision bigint NOT NULL DEFAULT 1,UNIQUE(project_id,id));
      CREATE TABLE cable_versions(remarks text,id uuid PRIMARY KEY,cable_id uuid REFERENCES cables(id) ON DELETE CASCADE,version_number bigint,change_type text,change_source text,
        cable_number integer,revision text,mto text,tag text,cable_type_id uuid,cable_type_name text,from_location text,to_location text,routing text,delivery text,
        design_length numeric,install_length numeric,pull_date date,connected_from date,connected_to date,tested date,changed_by uuid,changed_by_snapshot jsonb,
        UNIQUE(cable_id,version_number));
      CREATE TABLE pf_recalculation_events(project_id uuid,generation bigint,domain text,reason text,source_revision text);
      CREATE TABLE pf_recalculation_state(project_id uuid PRIMARY KEY,preferences jsonb,enabled boolean DEFAULT false,paused boolean DEFAULT false,
        authority_expires_at timestamptz,desired_generation bigint DEFAULT 1,control_revision bigint DEFAULT 1,authority_epoch bigint DEFAULT 1,
        actor_id uuid,login_id uuid,login_expires_at timestamptz,automatic_pair_authority jsonb);
      CREATE TABLE pf_endpoint_binding_heads(project_id uuid,location_id uuid,binding_id uuid,binding_revision bigint,PRIMARY KEY(project_id,location_id));
      CREATE TABLE pf_location_aliases(project_id uuid,location_id uuid,normalized_alias text);
      CREATE TABLE trays(id uuid PRIMARY KEY,project_id uuid,name text,length_mm numeric);
      CREATE TABLE pf_auto_lengths(project_id uuid,cable_id uuid,proposal_id uuid,source jsonb,source_sha256 text);
      CREATE TABLE pf_proposals(project_id uuid,cable_id uuid,id uuid,status text,dependencies jsonb,result jsonb,proposal_hash text);
      CREATE TABLE pf_revision_results(project_id uuid,cable_id uuid,proposal_id uuid,record jsonb,record_sha256 text,engine_result_sha256 text,ledger_sha256 text);
      CREATE FUNCTION pf_recalculation_dirty(pid uuid,kind text,why text,source_value text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$ DECLARE gen bigint;BEGIN
        INSERT INTO pf_recalculation_state(project_id) VALUES(pid) ON CONFLICT DO NOTHING;
        UPDATE pf_recalculation_state SET desired_generation=desired_generation+1 WHERE project_id=pid RETURNING desired_generation INTO gen;
        INSERT INTO pf_recalculation_events VALUES(pid,gen,kind,why,source_value);END $$;`);
    const schemaSource=await readFile(new URL('./schema.ts',import.meta.url),'utf8'),revisionStart=schemaSource.indexOf('CREATE OR REPLACE FUNCTION own_cable_write_revision()'),revisionEnd=schemaSource.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS cables_project_record_identity',revisionStart);
    if(revisionStart<0||revisionEnd<revisionStart)throw Error('Production write revision trigger was not found.');
    await pool.query(schemaSource.slice(revisionStart,revisionEnd));
    const recalcSource=await readFile(new URL('./recalculationSchema.ts',import.meta.url),'utf8'),recalcStart=recalcSource.indexOf('CREATE OR REPLACE FUNCTION pf_recalculation_cable_update()'),recalcEnd=recalcSource.indexOf('CREATE OR REPLACE FUNCTION pf_recalculation_no_truncate()',recalcStart);
    if(recalcStart<0||recalcEnd<recalcStart)throw Error('Production recalculation update trigger was not found.');
    await pool.query(recalcSource.slice(recalcStart,recalcEnd));
    await pool.query('CREATE TRIGGER pf_recalculation_cable_update AFTER UPDATE ON cables REFERENCING OLD TABLE AS pf_recalc_old NEW TABLE AS pf_recalc_new FOR EACH STATEMENT EXECUTE FUNCTION pf_recalculation_cable_update()');
    await pool.query('INSERT INTO projects VALUES($1)',[projectId]);await pool.query('INSERT INTO users(id,is_admin,pf_admin_revision,first_name,last_name,email) VALUES($1,true,1,$2,$3,$4)',[actorId,'Manual','Worker','manual-worker@example.test']);
    await pool.query('INSERT INTO pf_installation_state VALUES(true,$1)',[installationEpoch]);
    await initializeCableRoutingControlSchema(pool);await initializeManualRoutingSchema(pool);await initializeManualRoutingSchema(pool);
  });
  afterAll(async()=>{closing=true;await pool?.end();if(created)await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);await admin?.end();});
  beforeEach(async()=>{
    await pool.query('DELETE FROM cables');await pool.query('DELETE FROM trays');await pool.query('DELETE FROM pf_recalculation_events');
    await pool.query('DELETE FROM pf_recalculation_state');
    await pool.query('DELETE FROM cable_types');
    await pool.query('DELETE FROM pf_location_aliases');await pool.query('DELETE FROM pf_endpoint_binding_heads');
    await pool.query('UPDATE users SET is_admin=true,pf_admin_revision=1 WHERE id=$1',[actorId]);
    await pool.query('UPDATE pf_installation_state SET installation_epoch=$1',[installationEpoch]);
    await pool.query('DELETE FROM viewer_login_bindings');
  });
  async function tx<T>(operation:(client:PoolClient)=>Promise<T>){const client=await pool.connect();try{await client.query('BEGIN');const value=await operation(client);await client.query('COMMIT');return value;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
  async function seed(route='/A',pid=projectId){
    await pool.query('INSERT INTO projects VALUES($1) ON CONFLICT DO NOTHING',[pid]);
    const row=(await pool.query('INSERT INTO cables(id,project_id,tag,cable_type_id) VALUES($1,$2,$3,$4) RETURNING *',[randomUUID(),pid,'Worker fixture',randomUUID()])).rows[0];
    await pool.query('INSERT INTO cable_types VALUES($1,$2,$3)',[row.cable_type_id,pid,'Worker cable type']);
    await put(row,route);return(await pool.query('SELECT * FROM cables WHERE id=$1',[row.id])).rows[0];
  }
  async function put(row:Record<string,any>,route:string){return tx(async client=>{
    const before=(await client.query('SELECT * FROM cables WHERE id=$1 FOR UPDATE',[row.id])).rows[0];
    const result=await applyCableRoutingControlInTransaction(client,{projectId:row.project_id,cableId:row.id,actorId,principal,before,after:{...before,routing:route},
      automaticRouting:null,mutation:{kind:'manual',routing:route,manualProtected:true}});
    await client.query('UPDATE cables SET routing=$2 WHERE id=$1',[row.id,result.routing]);return result;
  });}
  async function state(row:Record<string,any>){return(await pool.query('SELECT *,manual_revision::text,generation::text FROM pf_manual_route_jobs WHERE project_id=$1 AND cable_id=$2',[row.project_id,row.id])).rows[0];}
  function fixture(row:Record<string,any>,options:{onExecute?:()=>Promise<void>;execute?:(request:EngineInvocation,signal:AbortSignal)=>Promise<EngineResponse>;overrides?:(requestId:string)=>Promise<Partial<ManualRoutingCollection>>}={}){
    const changes={stamp:'original'};
    const collect=vi.fn(async(client:PoolClient,c:ManualRoutingClaim,requestId:string):Promise<ManualRoutingCollection>=>{
      const cable=(await client.query('SELECT cable_write_revision::text FROM cables WHERE project_id=$1 AND id=$2 FOR UPDATE',[c.projectId,c.cableId])).rows[0];
      const control=await readCableRoutingControl(client,c.projectId,c.cableId,true);
      if(!control||control.manualRevision!==c.manualRevision||!control.control.manualRouting)throw new PathFinderError('MANUAL_ROUTE_SUPERSEDED',409);
      manualPhysicalCodes(control.control.manualRouting);
      const d=structuredClone(f.dependencies);Object.assign(d,{projectId:c.projectId,cableId:c.cableId});
      d.cableWriteRevision=cable.cable_write_revision;
      const constraint={schemaVersion:'pathfinder.manual-ordered-route.v1' as const,routeText:control.control.manualRouting};
      const dependencies={schemaVersion:'pathfinder.manual-route.dependencies.v1' as const,manualRevision:c.manualRevision,constraint,protected:d,capacity:null};
      Object.assign(d.settings,{testStamp:changes.stamp});
      const request=buildCableEngineRequest(d,requestId,60000);delete request.directSecondaryPolicy;request.manualRouteConstraint=constraint;
      const authority=(await client.query('SELECT pf_admin_revision::text AS revision FROM users WHERE id=$1',[actorId])).rows[0];
      const epoch=(await client.query('SELECT installation_epoch FROM pf_installation_state')).rows[0].installation_epoch;
      return{dependencies,request,adminRevision:authority.revision,installationEpoch:epoch,...await options.overrides?.(requestId)};
    });
    const execute=vi.fn(async(request:EngineInvocation,signal:AbortSignal)=>{
      await options.onExecute?.();if(options.execute)return options.execute(request,signal);
      const {calculationMode:_mode,...response}=structuredClone(f.result);response.requestId=request.requestId;
      if(response.route){response.route.routeCodes=['/A'];response.route.routeText='/A';}
      if(response.schemaVersion==='pathfinder.model.response.v3')response.barriers.directSecondary=null;
      return response;
    });
    return{worker:createManualRoutingWorker(pool,{collect,execute}),collect,execute,changes};
  }
  it('calculates and seals full manual length, updates used manual Design and keeps Routing/Install unchanged',async()=>{
    const row=await seed(),w=fixture(row);await w.worker.tick();
    expect(await state(row)).toMatchObject({state:'calculated',length_metres:7,owner_token:null});
    expect(w.execute.mock.calls[0][0]).toMatchObject({operation:'calculate',schemaVersion:'pathfinder.model.runner.v2',manualRouteConstraint:{routeText:'/A'}});
    expect(w.execute.mock.calls[0][0]).not.toHaveProperty('directSecondaryPolicy');
    const view=(await readCableRoutingViews(pool,row.project_id,[row.id])).get(row.id)!;
    expect(view).toMatchObject({manualRouteLength:7,manualRouteLengthStatus:'calculated',routingDiagnostics:[]});
    expect((await pool.query('SELECT routing,design_length,install_length FROM cables WHERE id=$1',[row.id])).rows[0]).toEqual({routing:'/A',design_length:'7',install_length:null});
    expect((await pool.query('SELECT change_source,changed_by,design_length,routing,install_length FROM cable_versions WHERE cable_id=$1',[row.id])).rows)
      .toEqual([{change_source:'pathfinder',changed_by:actorId,design_length:'7',routing:'/A',install_length:null}]);
    expect((await pool.query("SELECT count(*)::int AS count FROM pf_recalculation_events WHERE domain='cables'")).rows[0].count).toBe(1);
    await expect(pool.query("UPDATE pf_manual_route_results SET record='{}'::jsonb")).rejects.toThrow('Manual routing result is immutable');
  });
  it('atomically persists the exact calculated obstacle Remarks with manual Design and immutable history',async()=>{
    const row=await seed();await pool.query('UPDATE cables SET remarks=$2 WHERE id=$1',[row.id,'User instruction']);
    const parent={selectionId:randomUUID(),kind:'wall',objectId:'dbid:123',dbId:123,externalId:null,name:'Synthetic wall',identityBasis:'version-local-only',inclusion:'own-and-all-descendant-fragments'};
    const w=fixture(row,{execute:async request=>{
      const {calculationMode:_mode,...response}=structuredClone(f.result);response.requestId=request.requestId;
      if(response.route){response.route.routeCodes=['/A'];response.route.routeText='/A';}
      if(response.schemaVersion==='pathfinder.model.response.v3'){
        response.barriers.directSecondary=null;response.barriers.obstacleReport={status:'complete',crossedParentSelectionIds:[parent.selectionId],blockingParentSelectionIds:[],
          checkedSegments:1,totalSegments:1,reasonCode:'SYNTHETIC_REPORT_WRITER_TEST',selectedParents:[parent as any]};
      }
      return response;
    }});await w.worker.tick();
    expect(await state(row)).toMatchObject({state:'calculated',length_metres:7});
    const expected='User instruction\n[PathFinder obstacles] Crosses obstacles: #123.';
    expect((await pool.query('SELECT remarks,design_length,routing FROM cables WHERE id=$1',[row.id])).rows[0]).toEqual({remarks:expected,design_length:'7',routing:'/A'});
    expect((await pool.query('SELECT remarks,design_length,routing FROM cable_versions WHERE cable_id=$1',[row.id])).rows).toEqual([{remarks:expected,design_length:'7',routing:'/A'}]);
    const result=(await pool.query('SELECT record FROM pf_manual_route_results WHERE cable_id=$1',[row.id])).rows[0].record;
    expect(result.response.barriers.obstacleReport.crossedParentSelectionIds).toEqual([parent.selectionId]);
    expect(result.designWrite.status).toBe('written');
    const client=await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const linked=await readCableObstacleLinks(client,row.project_id,row.id);
      expect(linked).toMatchObject({status:'recorded',source:{kind:'manual-result',id:result.id},
        scope:result.response.barriers.context.binding.scope,obstacles:[{selectionId:parent.selectionId,dbId:123,name:'Synthetic wall',kind:'wall'}]});
      await client.query('ROLLBACK');
    } finally {client.release();}
  });
  it('fences an old completion after A→B→A manual edits',async()=>{
    const row=await seed(),w=fixture(row,{onExecute:async()=>{await put(row,'/B');await put(row,'/A');}});await w.worker.tick();
    expect(await state(row)).toMatchObject({state:'pending',manual_revision:'4',owner_token:null,length_metres:null});
    expect((await pool.query('SELECT * FROM pf_manual_route_results')).rowCount).toBe(0);
    expect((await pool.query('SELECT * FROM cable_versions')).rowCount).toBe(0);
  });
  it('discards a same-text completion if a frozen dependency changes before publish',async()=>{
    const row=await seed();const w=fixture(row,{onExecute:async()=>{w.changes.stamp='new-geometry';}});await w.worker.tick();
    expect(await state(row)).toMatchObject({state:'pending',length_metres:null,diagnostics:expect.arrayContaining(['MANUAL_ROUTE_INPUTS_CHANGED'])});
    expect((await pool.query('SELECT * FROM pf_manual_route_results')).rowCount).toBe(0);
  });
  it.each(['install_length','pull_date','connected_from','connected_to','tested'])('keeps Design readonly for current execution fact %s while storing the manual comparison',async column=>{
    const row=await seed(),value=column==='install_length'?23:'2026-11-15';
    await pool.query(`UPDATE cables SET design_length=99,${column}=$2 WHERE id=$1`,[row.id,value]);
    const w=fixture(row);await w.worker.tick();
    expect(await state(row)).toMatchObject({state:'calculated',length_metres:7});
    const cable=(await pool.query(`SELECT design_length,${column} AS fact FROM cables WHERE id=$1`,[row.id])).rows[0];
    expect(cable.design_length).toBe('99');expect(cable.fact).not.toBeNull();
    expect((await pool.query('SELECT * FROM cable_versions WHERE cable_id=$1',[row.id])).rowCount).toBe(0);
    expect((await pool.query("SELECT record->'designWrite'->>'status' AS status FROM pf_manual_route_results WHERE cable_id=$1",[row.id])).rows[0].status).toBe('execution-protected');
  });
  it.each(['install_length','pull_date','connected_from','connected_to','tested'])('accepts a current derived result but skips Design when %s arrives during calculation',async column=>{
    const row=await seed(),value=column==='install_length'?23:'2026-11-15';await pool.query('UPDATE cables SET design_length=99 WHERE id=$1',[row.id]);
    const w=fixture(row,{onExecute:async()=>{await pool.query(`UPDATE cables SET ${column}=$2 WHERE id=$1`,[row.id,value]);}});
    await w.worker.tick();expect(await state(row)).toMatchObject({state:'calculated',length_metres:7});
    expect((await pool.query('SELECT design_length,routing FROM cables WHERE id=$1',[row.id])).rows[0]).toEqual({design_length:'99',routing:'/A'});
    expect((await pool.query('SELECT * FROM cable_versions WHERE cable_id=$1',[row.id])).rowCount).toBe(0);
  });
  it('keeps a sticky execution latch protective even after its current dates are cleared',async()=>{
    const row=await seed();await pool.query("UPDATE cables SET design_length=99,pull_date='2026-11-15' WHERE id=$1",[row.id]);
    await pool.query('UPDATE cables SET pull_date=NULL WHERE id=$1',[row.id]);
    const w=fixture(row);await w.worker.tick();expect((await state(row)).state).toBe('calculated');
    expect((await pool.query('SELECT design_length FROM cables WHERE id=$1',[row.id])).rows[0].design_length).toBe('99');
    expect((await pool.query('SELECT * FROM cable_versions')).rowCount).toBe(0);
  });
  it.each(['unprotected','different-effective-route'] as const)('keeps an unused manual comparison out of Design: %s',async kind=>{
    const row=await seed();
    if(kind==='unprotected')await tx(async client=>{
      const before=(await client.query('SELECT * FROM cables WHERE id=$1 FOR UPDATE',[row.id])).rows[0];
      await applyCableRoutingControlInTransaction(client,{projectId,cableId:row.id,actorId,principal,before,after:before,automaticRouting:null,
        mutation:{kind:'manual',routing:'/A',manualProtected:false}});
    });
    const usedRouting=kind==='unprotected'?'/A':'/AUTO_OR_OTHER';
    await pool.query('UPDATE cables SET routing=$2,design_length=99 WHERE id=$1',[row.id,usedRouting]);
    const w=fixture(row);await w.worker.tick();expect(await state(row)).toMatchObject({state:'calculated',length_metres:7});
    expect((await pool.query('SELECT routing,design_length FROM cables WHERE id=$1',[row.id])).rows[0]).toEqual({routing:usedRouting,design_length:'99'});
    expect((await pool.query('SELECT * FROM cable_versions')).rowCount).toBe(0);
  });
  it('does not duplicate history or revisions for an equal Design on subsequent valid checks',async()=>{
    const row=await seed();await pool.query('UPDATE cables SET design_length=7 WHERE id=$1',[row.id]);
    const before=(await pool.query('SELECT cable_write_revision::text FROM cables WHERE id=$1',[row.id])).rows[0].cable_write_revision;
    const w=fixture(row);await w.worker.tick();
    await tx(async client=>{const c=await readCableRoutingControl(client,projectId,row.id,true);await enqueueManualRouteCalculation(client,projectId,row.id,c!.manualRevision,principal);});
    await w.worker.tick();expect((await state(row)).state).toBe('calculated');
    expect((await pool.query('SELECT cable_write_revision::text FROM cables WHERE id=$1',[row.id])).rows[0].cable_write_revision).toBe(before);
    expect((await pool.query('SELECT * FROM cable_versions')).rowCount).toBe(0);
  });
  it('rolls back Design and its result when required history cannot be recorded',async()=>{
    const row=await seed();await pool.query('UPDATE cables SET design_length=99 WHERE id=$1',[row.id]);
    const before=(await pool.query('SELECT cable_write_revision::text FROM cables WHERE id=$1',[row.id])).rows[0].cable_write_revision;
    await pool.query("CREATE FUNCTION fail_manual_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'History unavailable';END $$; CREATE TRIGGER fail_manual_history BEFORE INSERT ON cable_versions FOR EACH ROW EXECUTE FUNCTION fail_manual_history()");
    try{const w=fixture(row);await w.worker.tick();expect((await state(row)).state).toBe('invalid');
      expect((await pool.query('SELECT design_length,cable_write_revision::text FROM cables WHERE id=$1',[row.id])).rows[0]).toEqual({design_length:'99',cable_write_revision:before});
      expect((await pool.query('SELECT * FROM pf_manual_route_results')).rowCount).toBe(0);
    }finally{await pool.query('DROP TRIGGER fail_manual_history ON cable_versions;DROP FUNCTION fail_manual_history()');}
  });
  it.each(['revoked login','administrator removed','administrator revision','installation epoch'] as const)('refuses completion after %s',async kind=>{
    const row=await seed(),w=fixture(row,{onExecute:async()=>{
      if(kind==='revoked login')await pool.query('UPDATE viewer_login_bindings SET revoked_at=clock_timestamp()');
      if(kind==='administrator removed')await pool.query('UPDATE users SET is_admin=false');
      if(kind==='administrator revision')await pool.query('UPDATE users SET pf_admin_revision=2');
      if(kind==='installation epoch')await pool.query('UPDATE pf_installation_state SET installation_epoch=$1',[randomUUID()]);
    }});await w.worker.tick();expect((await state(row)).state).toBe('invalid');
    expect((await pool.query('SELECT * FROM pf_manual_route_results')).rowCount).toBe(0);
  });
  it('claims one owner and never lets an expired owner publish after recovery',async()=>{
    const row=await seed(),a=fixture(row),b=fixture(row),first=await a.worker.claim();expect(first).not.toBeNull();expect(await b.worker.claim()).toBeNull();
    await pool.query("UPDATE pf_manual_route_jobs SET lease_until=clock_timestamp()-interval '1 second'");
    const second=await b.worker.claim();expect(second?.ownerToken).not.toBe(first?.ownerToken);
    await a.worker.process(first!);expect((await state(row)).owner_token).toBe(second?.ownerToken);
    await b.worker.process(second!);expect((await state(row)).state).toBe('calculated');
  });
  it('keeps invalid manual text and proceeds to another valid cable',async()=>{
    const bad=await seed('/A/A'),good=await seed('/A'),w=fixture(bad);await pool.query('UPDATE cables SET design_length=99 WHERE id=$1',[bad.id]);await w.worker.tick();await w.worker.tick();
    expect(await state(bad)).toMatchObject({state:'invalid',length_metres:null,diagnostics:expect.arrayContaining(['MANUAL_ROUTE_ADJACENT_REPEAT_AMBIGUOUS'])});
    expect((await state(good)).state).toBe('calculated');expect((await pool.query('SELECT routing FROM cables WHERE id=$1',[bad.id])).rows[0].routing).toBe('/A/A');
    expect((await pool.query('SELECT design_length FROM cables WHERE id=$1',[bad.id])).rows[0].design_length).toBe('99');
    expect((await pool.query('SELECT * FROM cable_versions WHERE cable_id=$1',[bad.id])).rowCount).toBe(0);
  });
  it('keeps migrated jobs visibly waiting for real authority',async()=>{
    const row=await seed();await pool.query('UPDATE pf_manual_route_jobs SET actor_id=NULL,login_id=NULL,login_expires_at=NULL');
    const w=fixture(row);await w.worker.tick();expect(w.execute).not.toHaveBeenCalled();
    expect((await state(row)).diagnostics).toEqual(['MANUAL_CALCULATION_AUTHORITY_REQUIRED']);
  });
  it('activates a migrated pending check on an explicit unchanged Save without changing intent and leaves a calculated Save alone',async()=>{
    const row=await seed(),before=await readCableRoutingControl(pool,projectId,row.id);
    await pool.query('UPDATE pf_manual_route_jobs SET actor_id=NULL,login_id=NULL,login_expires_at=NULL');
    await pool.query('DELETE FROM viewer_login_bindings');
    const generation=(await state(row)).generation;
    await put(row,'/A');
    expect(await readCableRoutingControl(pool,projectId,row.id)).toEqual(before);
    expect(await state(row)).toMatchObject({actor_id:actorId,login_id:loginId,manual_revision:before?.manualRevision,generation:String(BigInt(generation)+1n)});
    const w=fixture(row);await w.worker.tick();expect((await state(row)).state).toBe('calculated');
    const calculatedGeneration=(await state(row)).generation;await put(row,'/A');expect((await state(row)).generation).toBe(calculatedGeneration);
  });
  it('advances the authority warning beyond its first bounded hundred rows',async()=>{
    const rows=(await pool.query("INSERT INTO cables(id,project_id,routing) SELECT gen_random_uuid(),$1,'/A' FROM generate_series(1,101) RETURNING id",[projectId])).rows;
    await pool.query('INSERT INTO pf_manual_route_jobs(project_id,cable_id,manual_revision) SELECT project_id,cable_id,manual_revision FROM pf_cable_routing_controls');
    const w=fixture({id:rows[0].id,project_id:projectId});await w.worker.tick();
    expect((await pool.query("SELECT count(*)::int AS count FROM pf_manual_route_jobs WHERE diagnostics='[\"MANUAL_CALCULATION_AUTHORITY_REQUIRED\"]'::jsonb")).rows[0].count).toBe(100);
    await w.worker.tick();expect((await pool.query("SELECT count(*)::int AS count FROM pf_manual_route_jobs WHERE diagnostics='[\"MANUAL_CALCULATION_AUTHORITY_REQUIRED\"]'::jsonb")).rows[0].count).toBe(101);
  });
  it('bounds project-lock waits and recovers the same durable job after a long import releases its lock',async()=>{
    const row=await seed(),w=fixture(row),lock=await pool.connect();
    await lock.query('BEGIN');await lock.query('SELECT id FROM projects WHERE id=$1 FOR NO KEY UPDATE',[projectId]);
    try{for(let i=0;i<3;i++){
      await pool.query('UPDATE pf_manual_route_jobs SET next_attempt_at=clock_timestamp()');
      const c=await w.worker.claim();expect(c).not.toBeNull();await w.worker.process(c!);
      expect(await state(row)).toMatchObject({state:'pending',attempts:0,diagnostics:expect.arrayContaining(['ENDPOINT_DATABASE_BUSY'])});
    }}finally{await lock.query('COMMIT');lock.release();}
    await pool.query('UPDATE pf_manual_route_jobs SET next_attempt_at=clock_timestamp()');await w.worker.tick();
    expect(await state(row)).toMatchObject({state:'calculated',length_metres:7});
  },20000);
  it('reports bounded crash recovery exhaustion rather than leaving a running row forever',async()=>{
    const row=await seed();await pool.query("UPDATE pf_manual_route_jobs SET state='running',attempts=3,owner_token=$1,lease_until=clock_timestamp()-interval '1 second'",[randomUUID()]);
    const w=fixture(row);expect(await w.worker.claim()).toBeNull();expect(await state(row)).toMatchObject({state:'invalid',diagnostics:['MANUAL_ROUTE_RECOVERY_LIMIT']});
  });
  it('records a new automatic policy generation for a protection-only release while respecting continuous OFF',async()=>{
    const row=await seed();await pool.query('INSERT INTO pf_recalculation_state(project_id,enabled) VALUES($1,false) ON CONFLICT(project_id) DO UPDATE SET enabled=false',[projectId]);
    const startGeneration=BigInt((await pool.query('SELECT desired_generation::text FROM pf_recalculation_state WHERE project_id=$1',[projectId])).rows[0].desired_generation);
    await pool.query('UPDATE pf_cable_routing_controls SET manual_protected=false,revision=revision+1 WHERE cable_id=$1',[row.id]);
    expect((await pool.query('SELECT enabled,desired_generation::text FROM pf_recalculation_state WHERE project_id=$1',[projectId])).rows[0]).toEqual({enabled:false,desired_generation:String(startGeneration+1n)});
    expect((await pool.query("SELECT domain,reason FROM pf_recalculation_events WHERE project_id=$1 AND domain='manual'",[projectId])).rows).toEqual([{domain:'manual',reason:'ROUTING_CONTROL_CHANGED'}]);
    expect((await pool.query('SELECT routing,cable_write_revision::text FROM cables WHERE id=$1',[row.id])).rows[0]).toEqual({routing:'/A',cable_write_revision:'1'});
    await pool.query('UPDATE pf_recalculation_state SET enabled=true WHERE project_id=$1',[projectId]);
    await pool.query('UPDATE pf_cable_routing_controls SET manual_protected=true,revision=revision+1 WHERE cable_id=$1',[row.id]);
    await pool.query('UPDATE pf_cable_routing_controls SET manual_protected=false,revision=revision+1 WHERE cable_id=$1',[row.id]);
    expect((await pool.query('SELECT enabled,desired_generation::text FROM pf_recalculation_state WHERE project_id=$1',[projectId])).rows[0]).toEqual({enabled:true,desired_generation:String(startGeneration+2n)});
  });
  it('invalidates model/settings/barrier/preferences events, tray extensions and only referenced endpoint cables',async()=>{
    const row=await seed(),other=await seed(),w=fixture(row);await w.worker.tick();await w.worker.tick();
    await pool.query("UPDATE cables SET from_location='OTHER_FROM',to_location='OTHER_TO' WHERE id=$1",[other.id]);
    await pool.query("UPDATE pf_manual_route_jobs SET state='calculated'");
    const location=randomUUID();await pool.query("INSERT INTO pf_location_aliases VALUES($1,$2,'FROM')",[projectId,location]);
    await pool.query('INSERT INTO pf_endpoint_binding_heads VALUES($1,$2,$3,1)',[projectId,location,randomUUID()]);
    expect((await state(row)).state).toBe('stale');expect((await state(other)).state).toBe('calculated');
    for(const domain of ['model','settings','barriers','preferences']){
      await pool.query("UPDATE pf_manual_route_jobs SET state='calculated'");
      await pool.query("INSERT INTO pf_recalculation_events VALUES($1,1,$2,'TEST_INPUT_CHANGED',NULL)",[projectId,domain]);
      expect((await state(row)).state).toBe('stale');
    }
    await pool.query('INSERT INTO trays VALUES($1,$2,$3,5000)',[randomUUID(),projectId,'BC182']);
    await pool.query("UPDATE pf_manual_route_jobs SET state='calculated'");await pool.query('UPDATE trays SET length_mm=7000');
    expect((await state(row)).state).toBe('stale');
  });
  it.skipIf(process.env.WFC_MANUAL_ROUTING_NATIVE!=='1').each(['happy','opening','blocked','missing'] as const)('executes a fresh real native %s route through the SQL worker and immutable read projection',async kind=>{
    const native=await createManualRoutingNativeFixture();
    try{
      const template=native.request(randomUUID(),kind),constraint=template.manualRouteConstraint as {schemaVersion:'pathfinder.manual-ordered-route.v1';routeText:string};
      const row=await seed(constraint.routeText,native.projectId);
      await pool.query("UPDATE cables SET mto='Control' WHERE id=$1",[row.id]);row.mto='Control';
      Object.assign(row,(await pool.query('SELECT * FROM cables WHERE id=$1',[row.id])).rows[0]);
      await pool.query('UPDATE pf_manual_route_jobs SET next_attempt_at=clock_timestamp() WHERE cable_id=$1',[row.id]);
      const manualRevision=(await state(row)).manual_revision;
      let frozenRequest:EngineInvocation|undefined;
      const w=fixture(row,{execute:native.execute,overrides:async requestId=>{
        const p=native.protectedOverrides(kind);p.cableId=row.id;p.cableWriteRevision=String(row.cable_write_revision);
        p.cableInputs={...p.cableInputs,cableTypeId:row.cable_type_id,fromLocation:row.from_location,toLocation:row.to_location};
        frozenRequest??=native.request(requestId,kind);
        return{request:structuredClone(frozenRequest),dependencies:{schemaVersion:'pathfinder.manual-route.dependencies.v1',manualRevision,constraint,protected:p,capacity:null}};
      }});
      await w.worker.tick();
      const saved=await state(row),expected=native.expected[kind];
      expect(saved,JSON.stringify(saved.diagnostics)).toMatchObject({state:expected===null?'invalid':'calculated',length_metres:expected});
      expect(native.executions).toHaveLength(1);expect(native.executions[0].pid).toBeGreaterThan(0);
      const result=(await pool.query('SELECT record FROM pf_manual_route_results WHERE project_id=$1 AND cable_id=$2',[row.project_id,row.id])).rows[0].record;
      expect(result.response.requestId).toBe(native.executions[0].requestId);
      expect(result.dependencies.constraint.routeText).toBe(constraint.routeText);
      const view=(await readCableRoutingViews(pool,row.project_id,[row.id])).get(row.id)!;
      expect(view.manualRouteLengthStatus).toBe(expected===null?'invalid':'calculated');expect(view.manualRouteLength).toBe(expected);
      if(kind==='happy')expect(result.response.lengthLedger).toMatchObject({raw:{lengthMeters:12,fromDistanceMeters:3,toDistanceMeters:4},secondaryEnds:2,replacementMeters:'14',designLengthMeters:'27'});
      if(kind==='opening')expect(result.response.barriers.diagnostics.reasonCode).toContain('INTER_TRAY_OPENING_MANEUVER_V1');
      if(kind==='blocked')expect(result.response.route?.success??false).toBe(false);
      if(kind==='missing'){expect(saved.diagnostics).toContain('MANUAL_ROUTE_REQUIRED_TRAY_UNAVAILABLE');expect(constraint.routeText).toBe('/DOES_NOT_EXIST');}
      expect((await pool.query('SELECT routing,design_length,install_length FROM cables WHERE id=$1',[row.id])).rows[0]).toEqual({routing:constraint.routeText,design_length:expected===null?null:String(expected),install_length:null});
      expect((await pool.query('SELECT change_source,changed_by FROM cable_versions WHERE cable_id=$1',[row.id])).rows)
        .toEqual(expected===null?[]:[{change_source:'pathfinder',changed_by:actorId}]);
    }finally{await native.dispose();}
  });
});
