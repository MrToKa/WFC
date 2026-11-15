// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll,beforeAll,beforeEach,describe,expect,it } from 'vitest';
import { initializePathFinderJobs } from './jobsSchema.js';
import { initializeAutomaticPairSchema } from './automaticPairSchema.js';
import { collectDependencyBatchInTransaction } from './dependencyBatch.js';
import { defaultOptions } from './jobContracts.js';
import { AUTOMATIC_PAIR_POLICY,automaticPairMandateHashInput,automaticPairMandateSchema } from '../../shared/pathfinderAutomaticPair.js';
import { automaticPairHash } from './automaticPairReceiptProof.js';

// Actual production schema, cascade and immutable guards in a uniquely owned
// disposable database. Seeded engineering records are synthetic audit fixtures,
// not evidence of native geometry or a bypass of authenticated admission.
describe.skipIf(process.env.WFC_ROUTING_CONTROL_POSTGRES!=='1')('retained job audit after ordinary live cable deletion',()=>{
  const database='wfc_jobs_delete_'+randomUUID().replaceAll('-','');
  let pool:Pool,admin:Pool,created=false,closing=false;
  beforeAll(async()=>{
    const inspection=JSON.parse(execFileSync('docker',['inspect','wfc-test-postgres'],{encoding:'utf8'}))[0],ports=inspection.NetworkSettings.Ports['5432/tcp'];
    if(ports.length!==1||ports[0].HostIp!=='127.0.0.1'||ports[0].HostPort!=='55432')throw Error('Unexpected owned PostgreSQL boundary.');
    const env=Object.fromEntries(inspection.Config.Env.map((value:string)=>{const at=value.indexOf('=');return[value.slice(0,at),value.slice(at+1)];}));
    const config={host:'127.0.0.1',port:55432,user:env.POSTGRES_USER??'postgres',password:env.POSTGRES_PASSWORD,connectionTimeoutMillis:5000,statement_timeout:10000,lock_timeout:3000};
    admin=new Pool({...config,database:'postgres',max:1});
    if(!/^wfc_jobs_delete_[a-f0-9]{32}$/.test(database))throw Error('Invalid owned database.');
    await admin.query(`CREATE DATABASE ${database}`);created=true;pool=new Pool({...config,database,max:3});
    pool.on('error',(error:Error&{code?:string})=>{if(closing&&error.code==='57P01')return;throw Error('Owned PostgreSQL pool failed: '+(error.code??'UNKNOWN'));});
    expect((await pool.query('SELECT current_database() AS name')).rows[0].name).toBe(database);
    await pool.query(`CREATE TABLE projects(id uuid PRIMARY KEY,connection_gap numeric DEFAULT 1,secondary_tray_length numeric DEFAULT 7,
      end_connection_length numeric DEFAULT 5,additional_bending_percent numeric DEFAULT 10);
      CREATE TABLE cables(id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      cable_write_revision bigint NOT NULL DEFAULT 1,routing text,design_length numeric,install_length numeric,UNIQUE(project_id,id));
      CREATE TABLE pf_artifacts(id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,UNIQUE(project_id,id));
      CREATE TABLE cable_versions(id uuid PRIMARY KEY,change_source text);`);
    await initializePathFinderJobs(pool);await initializeAutomaticPairSchema(pool);
  });
  afterAll(async()=>{closing=true;await pool?.end();if(created)await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);await admin?.end();});
  beforeEach(async()=>{await pool.query('DELETE FROM projects');});
  async function seed(){
    const projectId=randomUUID(),cableId=randomUUID(),actorId=randomUUID(),loginId=randomUUID(),expiry=new Date(Date.now()+3600000).toISOString();
    await pool.query('INSERT INTO projects(id) VALUES($1)',[projectId]);await pool.query("INSERT INTO cables(id,project_id,routing,design_length) VALUES($1,$2,'/A',7)",[cableId,projectId]);
    const jobs:string[]=[];
    for(let at=0;at<2;at++){
      const jobId=randomUUID(),proposalId=randomUUID(),dependencies={schemaVersion:'pathfinder.dependencies.v8',projectId,cableId,cableWriteRevision:'1'};
      const dependencyHash=automaticPairHash(dependencies),draft=automaticPairMandateSchema.parse({schemaVersion:'wfc.pf.automatic-pair-mandate.v1',id:randomUUID(),projectId,jobId,cableId,actorId,
        actorAdminRevision:'1',loginId,loginExpiresAt:expiry,authorityExpiresAt:new Date(Date.now()+30000).toISOString(),installationEpoch:randomUUID(),createdAt:new Date().toISOString(),
        policy:AUTOMATIC_PAIR_POLICY,source:{kind:'explicit-job'},requestSha256:'a'.repeat(64),dependencyHash,cableWriteRevision:'1',baselineSha256:'b'.repeat(64),
        ownership:{kind:'policy',controlRevision:'1'},contentSha256:'0'.repeat(64)});
      const record={...draft,contentSha256:automaticPairHash(automaticPairMandateHashInput(draft))};
      await pool.query(`INSERT INTO pf_jobs(id,project_id,requested_by,login_id,login_expires_at,state,total,completed,options,timeout_ms,request_hash)
        VALUES($1,$2,$3,$4,$5,'complete',1,1,'{}',60000,$6)`,[jobId,projectId,actorId,loginId,expiry,'a'.repeat(64)]);
      await pool.query("INSERT INTO pf_job_items(project_id,job_id,cable_id,state,dependencies,status,message) VALUES($1,$2,$3,'complete',$4,'calculated','Synthetic retained audit fixture')",[projectId,jobId,cableId,dependencies]);
      await pool.query(`INSERT INTO pf_proposals(id,project_id,job_id,cable_id,status,dependencies,dependency_hash,geometry_hash,result,proposal_hash)
        VALUES($1,$2,$3,$4,'calculated',$5,$6,$7,$8,$9)`,[proposalId,projectId,jobId,cableId,dependencies,dependencyHash,'c'.repeat(64),{syntheticAudit:true},'d'.repeat(64)]);
      await pool.query('INSERT INTO pf_automatic_pair_mandates(project_id,job_id,cable_id,id,actor_id,login_id,record_sha256,record,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [projectId,jobId,cableId,record.id,actorId,loginId,record.contentSha256,record,record.createdAt]);
      await pool.query('INSERT INTO pf_automatic_pair_dispatch(project_id,job_id,cable_id) VALUES($1,$2,$3)',[projectId,jobId,cableId]);
      await pool.query(`INSERT INTO pf_apply_receipts(id,project_id,actor_id,idempotency_key,payload_hash,proposal_id,cable_id,before_snapshot,after_snapshot,provenance)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[randomUUID(),projectId,actorId,randomUUID(),'e'.repeat(64),proposalId,cableId,{routing:null},{routing:'/A',design_length:7},{syntheticAudit:true}]);
      jobs.push(jobId);
    }
    return{projectId,cableId,jobs};
  }
  async function audit(projectId:string){return(await pool.query(`SELECT jsonb_build_object(
    'items',(SELECT jsonb_agg(to_jsonb(i) ORDER BY job_id) FROM pf_job_items i WHERE project_id=$1),
    'proposals',(SELECT jsonb_agg(to_jsonb(p) ORDER BY job_id) FROM pf_proposals p WHERE project_id=$1),
    'mandates',(SELECT jsonb_agg(to_jsonb(m) ORDER BY job_id) FROM pf_automatic_pair_mandates m WHERE project_id=$1),
    'dispatch',(SELECT jsonb_agg(to_jsonb(d) ORDER BY job_id) FROM pf_automatic_pair_dispatch d WHERE project_id=$1),
    'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY proposal_id) FROM pf_apply_receipts r WHERE project_id=$1)) AS value`,[projectId])).rows[0].value;}
  it('repairs the legacy cascade repeatably and retains both immutable job admissions unchanged',async()=>{
    const f=await seed(),before=await audit(f.projectId);
    await pool.query('ALTER TABLE pf_job_items ADD CONSTRAINT pf_job_items_project_id_cable_id_fkey FOREIGN KEY(project_id,cable_id) REFERENCES cables(project_id,id) ON DELETE CASCADE');
    await expect(pool.query('DELETE FROM cables WHERE project_id=$1 AND id=$2',[f.projectId,f.cableId])).rejects.toThrow('Automatic pair mandate is immutable');
    expect((await pool.query('SELECT id FROM cables WHERE id=$1',[f.cableId])).rowCount).toBe(1);expect(await audit(f.projectId)).toEqual(before);
    await initializePathFinderJobs(pool);await initializePathFinderJobs(pool);
    await pool.query('DELETE FROM cables WHERE project_id=$1 AND id=$2',[f.projectId,f.cableId]);
    expect(await audit(f.projectId)).toEqual(before);
    const current=(await pool.query(`SELECT i.job_id,c.id AS current_cable_id FROM pf_job_items i LEFT JOIN cables c ON c.project_id=i.project_id AND c.id=i.cable_id
      WHERE i.project_id=$1 ORDER BY i.job_id`,[f.projectId])).rows;
    expect(current).toHaveLength(2);expect(current.every(row=>row.current_cable_id===null)).toBe(true);
  });
  it('retains job/project/proposal/mandate ownership and immutable deletion guards after a cable is gone',async()=>{
    const f=await seed();await pool.query('DELETE FROM cables WHERE id=$1',[f.cableId]);
    const constraints=(await pool.query(`SELECT conname FROM pg_constraint WHERE contype='f' AND conrelid IN('pf_job_items'::regclass,'pf_proposals'::regclass,
      'pf_apply_receipts'::regclass,'pf_automatic_pair_mandates'::regclass,'pf_automatic_pair_dispatch'::regclass)`)).rows.map(row=>row.conname);
    for(const name of ['pf_job_items_project_id_job_id_fkey','pf_proposals_project_id_job_id_fkey','pf_apply_receipts_project_id_proposal_id_fkey',
      'pf_automatic_pair_mandates_project_id_job_id_cable_id_fkey','pf_automatic_pair_dispatch_project_id_job_id_cable_id_fkey'])expect(constraints).toContain(name);
    expect(constraints).not.toContain('pf_job_items_project_id_cable_id_fkey');
    await expect(pool.query('DELETE FROM pf_automatic_pair_mandates WHERE project_id=$1',[f.projectId])).rejects.toThrow('Automatic pair mandate is immutable');
    await expect(pool.query('UPDATE pf_automatic_pair_mandates SET record=record WHERE project_id=$1',[f.projectId])).rejects.toThrow('Automatic pair mandate is immutable');
    await expect(pool.query('DELETE FROM pf_job_items WHERE project_id=$1',[f.projectId])).rejects.toThrow('Automatic pair mandate is immutable');
    await expect(pool.query("INSERT INTO pf_job_items(project_id,job_id,cable_id,state,status,message) VALUES($1,$2,$3,'blocked','missing','')",[f.projectId,randomUUID(),f.cableId])).rejects.toMatchObject({code:'23503'});
  });
  it('refuses a new live-cable admission while the retained engineering audit remains readable',async()=>{
    const f=await seed();await pool.query('DELETE FROM cables WHERE id=$1',[f.cableId]);
    const client=await pool.connect();try{await client.query('BEGIN');await client.query('SELECT id FROM projects WHERE id=$1 FOR NO KEY UPDATE',[f.projectId]);
      await expect(collectDependencyBatchInTransaction(client,{projectId:f.projectId,cableIds:[f.cableId],options:{...defaultOptions}})).rejects.toMatchObject({code:'CABLE_NOT_FOUND',status:404});
      await client.query('ROLLBACK');}finally{client.release();}
    expect((await audit(f.projectId)).mandates).toHaveLength(2);
  });
  it('still allows normal whole-project deletion to cascade its complete owned audit scope',async()=>{
    const f=await seed();await pool.query('DELETE FROM projects WHERE id=$1',[f.projectId]);
    for(const table of ['cables','pf_jobs','pf_job_items','pf_proposals','pf_apply_receipts','pf_automatic_pair_mandates','pf_automatic_pair_dispatch'])
      expect((await pool.query(`SELECT 1 FROM ${table} WHERE project_id=$1`,[f.projectId])).rowCount).toBe(0);
  });
});
