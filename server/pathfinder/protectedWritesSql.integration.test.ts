// @vitest-environment node
import {readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Pool,type PoolClient} from 'pg';
import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
const seams=vi.hoisted(()=>({identity:vi.fn(),scope:vi.fn(),collect:vi.fn(),seal:vi.fn(),synthetic:vi.fn(),snapshot:vi.fn(),authority:vi.fn(),applicability:vi.fn(),abandoned:vi.fn()}));
vi.mock('./calculationEngineIdentity.js',()=>({barrierCalculationEngineIdentity:seams.identity}));
vi.mock('./barrierCalculationScope.js',()=>({collectBarrierCalculationScope:seams.scope,readCurrentBarrierAdmissionIntent:vi.fn()}));
vi.mock('./dependencies.js',async original=>({...await original<typeof import('./dependencies.js')>(),collectDependenciesForVersion:seams.collect,hasSyntheticProof:seams.synthetic}));
vi.mock('./revisionResultRepository.js',()=>({verifyRevisionResultForProposal:seams.seal,persistRevisionAdmission:vi.fn()}));
vi.mock('./storage.js',()=>({readSnapshot:seams.snapshot}));
vi.mock('./recalculationRepository.js',()=>({requireEnrollmentAuthority:seams.authority,readRecalculationJobAuthority:async()=>({enrolled:false}),pauseRecalculationForJob:vi.fn()}));
vi.mock('./proposalApplicability.js',()=>({readProposalApplicability:seams.applicability}));
vi.mock('./applyRecovery.js',()=>({readApplyAbandonment:seams.abandoned}));
import {createPathFinderApply} from './apply.js';
import {createPathFinderJobs} from './jobs.js';
import type {PathFinderRepository} from './repository.js';
import {syntheticBarrierWriteInputs} from './barrierWriteFixtures.js';
import {hash} from './dependencies.js';
import {PathFinderError} from './errors.js';

/** Actual PostgreSQL principal/Review/Apply/CAS/history/receipt transactions.
 * Engine output, immutable capture/identity/seal/applicability and dependency
 * projection are explicit synthetic adapters, not actual model/geometry proof.
 * The physical-fence adapter still takes a real FOR SHARE publication-row lock.
 * This suite performs no HTTP/UI, process, native or engineering acceptance. */
const fixturePath=process.env.PF_B7_SQL_FIXTURE,schemaName='pfb7_protectedwrites';
let pool:Pool;
const schema=`
CREATE TABLE projects(id uuid PRIMARY KEY);
CREATE TABLE users(id uuid PRIMARY KEY,is_admin boolean NOT NULL,first_name text,last_name text,email text);
CREATE TABLE viewer_login_bindings(login_id uuid PRIMARY KEY,user_id uuid NOT NULL,expires_at timestamptz NOT NULL,revoked_at timestamptz);
CREATE TABLE cable_types(id uuid PRIMARY KEY,name text NOT NULL);
CREATE TABLE cables(id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id),cable_write_revision bigint NOT NULL DEFAULT 0,
 from_location text,to_location text,mto text,routing text,design_length numeric,install_length numeric,revision text,
 cable_id text,tag text,cable_type_id uuid NOT NULL REFERENCES cable_types(id),delivery text,pull_date date,connected_from boolean DEFAULT false,
 connected_to boolean DEFAULT false,tested boolean DEFAULT false,updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(project_id,id));
CREATE TABLE cable_versions(id uuid PRIMARY KEY,cable_id uuid NOT NULL,version_number integer NOT NULL,change_type text,change_source text,
 cable_number text,revision text,mto text,tag text,cable_type_id uuid,cable_type_name text,from_location text,to_location text,routing text,delivery text,
 design_length numeric,install_length numeric,pull_date date,connected_from boolean,connected_to boolean,tested boolean,changed_by uuid,changed_by_snapshot jsonb,
 UNIQUE(cable_id,version_number));
CREATE TABLE pf_jobs(id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id),state text NOT NULL,cancel_requested boolean NOT NULL DEFAULT false,
 kind text NOT NULL DEFAULT 'calculate',total integer NOT NULL DEFAULT 1,completed integer NOT NULL DEFAULT 1,attempts integer NOT NULL DEFAULT 1,
 failure text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(project_id,id));
CREATE TABLE pf_proposals(id uuid PRIMARY KEY,project_id uuid NOT NULL,job_id uuid NOT NULL,cable_id uuid NOT NULL,status text NOT NULL,
 dependencies jsonb NOT NULL,dependency_hash text NOT NULL,geometry_hash text NOT NULL,result jsonb NOT NULL,proposal_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(project_id,id),FOREIGN KEY(project_id,job_id) REFERENCES pf_jobs(project_id,id));
CREATE TABLE pf_reviews(id uuid PRIMARY KEY,project_id uuid NOT NULL,proposal_id uuid NOT NULL,actor_id uuid NOT NULL,proposal_hash text NOT NULL,
 validation_method text NOT NULL,revision_result_sha256 text NOT NULL,review_login_id uuid NOT NULL,review_dependency_sha256 text NOT NULL,
 reviewed_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(project_id,proposal_id) REFERENCES pf_proposals(project_id,id));
CREATE TABLE pf_apply_receipts(id uuid PRIMARY KEY,project_id uuid NOT NULL,actor_id uuid NOT NULL,idempotency_key uuid NOT NULL,payload_hash text NOT NULL,
 proposal_id uuid NOT NULL,cable_id uuid NOT NULL,before_snapshot jsonb NOT NULL,after_snapshot jsonb NOT NULL,provenance jsonb NOT NULL,
 applied_at timestamptz NOT NULL DEFAULT now(),UNIQUE(project_id,actor_id,idempotency_key));
CREATE TABLE pfb7_barrier_state(project_id uuid PRIMARY KEY REFERENCES projects(id),context jsonb NOT NULL);
`;
type Row=Record<string,any>;
async function seed(){
  const f=syntheticBarrierWriteInputs(),{dependencies,result,id}=f,projectId=dependencies.projectId,cableId=dependencies.cableId,proposalId=id(30),jobId=id(31);
  const who={userId:id(32),loginId:id(33),loginExpiresAt:Date.parse('2099-01-01T00:00:00Z')};
  await pool.query('INSERT INTO projects VALUES($1)',[projectId]);
  await pool.query("INSERT INTO users VALUES($1,true,'Synthetic','Administrator','synthetic@example.invalid')",[who.userId]);
  await pool.query('INSERT INTO viewer_login_bindings VALUES($1,$2,$3,NULL)',[who.loginId,who.userId,new Date(who.loginExpiresAt)]);
  await pool.query("INSERT INTO cable_types VALUES($1,'Synthetic type')",[dependencies.cableInputs.cableTypeId]);
  await pool.query(`INSERT INTO cables(id,project_id,from_location,to_location,mto,routing,design_length,install_length,revision,cable_id,tag,cable_type_id)
    VALUES($1,$2,$3,$4,$5,'/OLD',99,123.45,'engineering-1','SYNTHETIC-01','Unchanged synthetic tag',$6)`,
    [cableId,projectId,dependencies.cableInputs.fromLocation,dependencies.cableInputs.toLocation,dependencies.cableInputs.mto,dependencies.cableInputs.cableTypeId]);
  const cable=async()=>(await pool.query(`SELECT to_jsonb(c)||jsonb_build_object('design_length',c.design_length::text,'install_length',c.install_length::text,
    'cable_write_revision',c.cable_write_revision::text) AS value FROM cables c WHERE project_id=$1 AND id=$2`,[projectId,cableId])).rows[0].value as Row;
  dependencies.cableWriteRevision=(await cable()).cable_write_revision;
  const baselineHash='e'.repeat(64),proposalHash=hash({dependencies,result,baselineHash});
  const seal={admissionId:id(34),revisionResultSha256:'d'.repeat(64),baselineHash,engineResultSha256:hash(result),ledgerHash:hash(result.lengthLedger),dependencyHash:hash(dependencies),
    oldModel:null,summary:{newModel:dependencies.model,reasonCodes:[]},comparisonRef:null,observedEvents:[],physicalChangeProven:false};
  await pool.query("INSERT INTO pf_jobs(id,project_id,state) VALUES($1,$2,'complete')",[jobId,projectId]);
  await pool.query(`INSERT INTO pf_proposals(id,project_id,job_id,cable_id,status,dependencies,dependency_hash,geometry_hash,result,proposal_hash)
    VALUES($1,$2,$3,$4,'calculated',$5,$6,$7,$8,$9)`,[proposalId,projectId,jobId,cableId,dependencies,hash(dependencies),'a'.repeat(64),result,proposalHash]);
  await pool.query('INSERT INTO pfb7_barrier_state VALUES($1,$2)',[projectId,dependencies.barriers]);
  let scopeReads=0,scopeHook:((client:PoolClient,context:Row,ordinal:number)=>Promise<Row>)|undefined;
  seams.identity.mockResolvedValue(dependencies.engineIdentity);seams.seal.mockResolvedValue(seal);seams.synthetic.mockResolvedValue(false);
  seams.applicability.mockResolvedValue({applicable:true,evidence:null});seams.snapshot.mockResolvedValue({});seams.abandoned.mockResolvedValue(null);seams.authority.mockResolvedValue(undefined);
  seams.scope.mockImplementation(async(client:PoolClient,pid:string)=>{
    if(pid!==projectId)throw new Error('Synthetic barrier scope crossed projects.');
    const row=(await client.query('SELECT context FROM pfb7_barrier_state WHERE project_id=$1 FOR SHARE',[projectId])).rows[0];
    if(!row)throw new PathFinderError('BARRIER_CALCULATION_STORAGE_INVALID',409);
    return scopeHook?scopeHook(client,row.context,++scopeReads):(scopeReads++,row.context);
  });
  seams.collect.mockImplementation(async(client:PoolClient,pid:string,cid:string,_options:unknown,_version:string,lock:boolean)=>{
    const value=(await client.query(`SELECT cable_write_revision::text,from_location,to_location,mto,cable_type_id FROM cables WHERE project_id=$1 AND id=$2 ${lock?'FOR UPDATE':''}`,[pid,cid])).rows[0];
    if(!value)throw new PathFinderError('CABLE_NOT_FOUND',404);
    return {cable:value,dependencies:{...dependencies,cableWriteRevision:value.cable_write_revision,
      cableInputs:{fromLocation:value.from_location,toLocation:value.to_location,mto:value.mto,cableTypeId:value.cable_type_id}}};
  });
  const jobs=createPathFinderJobs(pool,{} as PathFinderRepository),confirm=()=>jobs.review(projectId,who,proposalId,proposalHash);
  const apply=(input:{reviewId:string;idempotencyKey:string;expectedCableWriteRevision:string})=>createPathFinderApply(pool)(projectId,who,proposalId,input);
  const reviewed=async()=>{const review=await confirm();scopeReads=0;return{reviewId:review.reviewId,idempotencyKey:id(36),expectedCableWriteRevision:dependencies.cableWriteRevision};};
  const counts=async()=>(await pool.query(`SELECT (SELECT count(*)::int FROM cable_versions) AS history,(SELECT count(*)::int FROM pf_reviews) AS reviews,
    (SELECT count(*)::int FROM pf_apply_receipts) AS receipts`)).rows[0];
  return{...f,projectId,cableId,proposalId,jobId,who,proposalHash,seal,cable,counts,confirm,apply,reviewed,
    setScopeHook:(hook:typeof scopeHook)=>{scopeHook=hook;scopeReads=0;}};
}
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return{promise,resolve};}

describe.runIf(Boolean(fixturePath))('PF-B7 owned real SQL human Review and Apply with explicit synthetic calculation boundaries',()=>{
  beforeAll(async()=>{
    const scratch=await realpath(fileURLToPath(new URL('../../pathfinder-engine/.scratch/',import.meta.url))),resolved=await realpath(fixturePath!);
    const relative=path.relative(scratch,resolved),parts=relative.split(path.sep);
    if(path.isAbsolute(relative)||relative.startsWith('..')||parts.length!==2||parts[0]!=='barrier-writes-20261021-3b6e92d9-fd73-4c0f-b4f3-43680baec838'||parts[1]!=='sql.private.json')
      throw new Error('Refuse a fixture outside the exact newly owned B7 scratch context.');
    const config=JSON.parse(await readFile(resolved,'utf8')) as {database:string;url:string;owner:string};
    if(!/^wfc_pfb7_[a-f0-9_]+$/.test(config.database)||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(config.owner))throw new Error('Invalid B7 fixture capability.');
    const url=new URL(config.url);
    if(!['postgres:','postgresql:'].includes(url.protocol)||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.port!=='55441'
      ||decodeURIComponent(url.pathname.slice(1))!==config.database)throw new Error('Refuse a nonlocal, wrong-port or mismatched B7 database.');
    pool=new Pool({connectionString:config.url,options:`-c search_path=${schemaName},pg_catalog`,max:4,connectionTimeoutMillis:3000,query_timeout:10000});
    const ownership=(await pool.query('SELECT current_database() AS db,owner FROM public.pfb7_fixture_owner')).rows;
    if(ownership.length!==1||ownership[0].db!==config.database||ownership[0].owner!==config.owner)throw new Error('Fixture owner mismatch before DDL.');
    await pool.query(`CREATE SCHEMA ${schemaName}`);await pool.query(schema);
    const source=await readFile(new URL('./schema.ts',import.meta.url),'utf8'),start=source.indexOf('CREATE OR REPLACE FUNCTION own_cable_write_revision()'),end=source.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS cables_project_record_identity',start);
    if(start<0||end<start)throw new Error('Production cable revision trigger source is unavailable.');
    await pool.query(source.slice(start,end));
  });
  beforeEach(async()=>{
    vi.resetAllMocks();
    await pool.query('TRUNCATE pfb7_protectedwrites.projects,pfb7_protectedwrites.users,pfb7_protectedwrites.viewer_login_bindings,pfb7_protectedwrites.cable_types,pfb7_protectedwrites.cable_versions,pfb7_protectedwrites.pf_apply_receipts,pfb7_protectedwrites.pf_reviews CASCADE');
  });
  afterAll(async()=>{await pool?.end();});

  it('reviews and atomically replaces an existing pair while preserving install length and recording exact v3 history/receipt once',async()=>{
    const f=await seed(),before=await f.cable(),input=await f.reviewed();expect(await f.counts()).toEqual({history:0,receipts:0,reviews:1});
    const outcome=await f.apply(input),after=await f.cable();expect(outcome.duplicate).toBe(false);
    expect(after).toMatchObject({routing:'/A',design_length:'7',install_length:before.install_length,tag:before.tag,revision:before.revision});
    expect(BigInt(after.cable_write_revision)).toBe(BigInt(before.cable_write_revision)+1n);expect(await f.counts()).toEqual({history:1,receipts:1,reviews:1});
    expect(outcome.receipt.before).toEqual(before);expect(outcome.receipt.after).toEqual(after);
    expect(outcome.receipt.provenance).toMatchObject({schemaVersion:'pathfinder.apply.v3',validationMethod:'manual-review',barrierEvidence:{status:'no-barriers-declared',dependencySha256:hash(f.dependencies),engineResultSha256:hash(f.result)}});
    const history=(await pool.query('SELECT routing,design_length::text,install_length::text,change_source FROM cable_versions')).rows[0];
    expect(history).toMatchObject({routing:'/A',design_length:'7',install_length:before.install_length,change_source:'pathfinder'});
    seams.scope.mockRejectedValue(new Error('Old capture unavailable after committed receipt.'));
    expect((await f.apply(input)).duplicate).toBe(true);expect(await f.counts()).toEqual({history:1,receipts:1,reviews:1});
    await expect(f.apply({...input,expectedCableWriteRevision:after.cable_write_revision})).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
  });
  it('rolls back a new Review when the final barrier fence changes',async()=>{
    const f=await seed(),before=await f.cable();f.setScopeHook(async(_client,context,ordinal)=>ordinal===2?{...context,storage:null}:context);
    await expect(f.confirm()).rejects.toMatchObject({code:'PROPOSAL_STALE'});expect(await f.cable()).toEqual(before);expect(await f.counts()).toEqual({history:0,receipts:0,reviews:0});
  });
  it('replays an exact committed historical receipt under current principal checks without inventing new barrier authority',async()=>{
    const f=await seed(),input=await f.reviewed(),before=await f.cable(),receiptId=f.id(40),provenance={schemaVersion:'pathfinder.apply.v2',historicalFixture:true};
    await pool.query(`INSERT INTO pf_apply_receipts(id,project_id,actor_id,idempotency_key,payload_hash,proposal_id,cable_id,before_snapshot,after_snapshot,provenance)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,$9)`,[receiptId,f.projectId,f.who.userId,input.idempotencyKey,hash({proposalId:f.proposalId,...input}),f.proposalId,f.cableId,before,provenance]);
    seams.identity.mockRejectedValue(new Error('An old committed receipt needs no current engine.'));seams.scope.mockRejectedValue(new Error('Old scope unavailable.'));
    const outcome=await f.apply(input);expect(outcome).toMatchObject({duplicate:true,receipt:{id:receiptId,provenance}});
    expect(await f.cable()).toEqual(before);expect(await f.counts()).toEqual({history:0,receipts:1,reviews:1});
  });
  it('reconciles a real durable Apply after an explicitly injected lost COMMIT acknowledgement without another update',async()=>{
    const f=await seed(),input=await f.reviewed();let lost=false;
    // Forward the actual COMMIT first, then lose only its application ACK.
    // This owns no backend process and modifies no shared connection behavior.
    const uncertainPool={connect:async()=>{
      const client=await pool.connect();return {query:async(sql:string,values?:unknown[])=>{
        const result=await client.query(sql,values);
        if(sql==='COMMIT'&&!lost){lost=true;throw new Error('Explicit synthetic lost ACK after real durable COMMIT.');}return result;
      },release:(discard?:boolean)=>client.release(discard)} as unknown as PoolClient;
    }} as unknown as Pool;
    await expect(createPathFinderApply(uncertainPool)(f.projectId,f.who,f.proposalId,input)).rejects.toMatchObject({code:'PATHFINDER_COMMIT_OUTCOME_UNKNOWN'});
    expect(lost).toBe(true);expect(await f.counts()).toEqual({history:1,receipts:1,reviews:1});const after=await f.cable();
    seams.scope.mockRejectedValue(new Error('Old publication changed after durability.'));
    expect((await f.apply(input)).duplicate).toBe(true);expect(await f.cable()).toEqual(after);expect(await f.counts()).toEqual({history:1,receipts:1,reviews:1});
  });
  it('rolls back the actual pair/history/receipt when the final physical scope changes after those SQL writes',async()=>{
    const f=await seed(),input=await f.reviewed(),before=await f.cable();let observedWrites=false;
    f.setScopeHook(async(client,context,ordinal)=>{if(ordinal!==2)return context;
      const seen=(await client.query('SELECT (SELECT count(*)::int FROM cable_versions) AS history,(SELECT count(*)::int FROM pf_apply_receipts) AS receipts')).rows[0];
      observedWrites=seen.history===1&&seen.receipts===1;return{...context,storage:null};});
    await expect(f.apply(input)).rejects.toMatchObject({code:'PROPOSAL_STALE'});expect(observedWrites).toBe(true);expect(await f.cable()).toEqual(before);expect(await f.counts()).toEqual({history:0,receipts:0,reviews:1});
  });
  it('refuses intervening manual cable edits through the real owned revision trigger and live input collection',async()=>{
    const f=await seed(),input=await f.reviewed();await pool.query("UPDATE cables SET tag='Intervening manual edit' WHERE id=$1",[f.cableId]);const before=await f.cable();
    await expect(f.apply(input)).rejects.toMatchObject({code:'PROPOSAL_STALE'});expect(await f.cable()).toEqual(before);expect(await f.counts()).toEqual({history:0,receipts:0,reviews:1});
  });
  it('the final CAS refuses a competing write in the fenced transaction and rolls back it with the attempted pair',async()=>{
    const f=await seed(),input=await f.reviewed(),before=await f.cable();seams.authority.mockImplementationOnce(async(client:PoolClient)=>{await client.query("UPDATE cables SET routing='/LATE' WHERE id=$1",[f.cableId]);});
    await expect(f.apply(input)).rejects.toMatchObject({code:'CABLE_WRITE_CONFLICT'});expect(await f.cable()).toEqual(before);expect(await f.counts()).toEqual({history:0,receipts:0,reviews:1});
  });
  it.each(['admin','login'] as const)('refuses current %s revocation before writing',async kind=>{
    const f=await seed(),input=await f.reviewed(),before=await f.cable();
    if(kind==='admin')await pool.query('UPDATE users SET is_admin=false WHERE id=$1',[f.who.userId]);else await pool.query('UPDATE viewer_login_bindings SET revoked_at=now() WHERE login_id=$1',[f.who.loginId]);
    await expect(f.apply(input)).rejects.toMatchObject({code:kind==='admin'?'ADMIN_REQUIRED':'LOGIN_REVOKED'});expect(await f.cable()).toEqual(before);expect(await f.counts()).toEqual({history:0,receipts:0,reviews:1});
  });
  it.each(['history-zero-row','history-error','receipt-error','changed-install'] as const)('rolls back pair/history/receipt on real SQL %s fault',async kind=>{
    const f=await seed(),input=await f.reviewed(),before=await f.cable();
    const table=kind==='receipt-error'?'pf_apply_receipts':kind==='changed-install'?'cables':'cable_versions',operation=kind==='changed-install'?'UPDATE':'INSERT';
    const body=kind==='history-zero-row'?'RETURN NULL;':kind==='changed-install'?'NEW.install_length:=0;RETURN NEW;':"RAISE EXCEPTION 'explicit synthetic B7 SQL fault';";
    await pool.query(`CREATE FUNCTION pfb7_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN ${body} END $$;CREATE TRIGGER zz_pfb7_fault BEFORE ${operation} ON ${table} FOR EACH ROW EXECUTE FUNCTION pfb7_fault()`);
    try{const pending=f.apply(input);if(kind==='history-zero-row')await expect(pending).rejects.toMatchObject({code:'CABLE_HISTORY_WRITE_REQUIRED'});
      else if(kind==='changed-install')await expect(pending).rejects.toMatchObject({code:'APPLY_WRITE_INTEGRITY'});else await expect(pending).rejects.toThrow('explicit synthetic B7 SQL fault');
      expect(await f.cable()).toEqual(before);expect(await f.counts()).toEqual({history:0,receipts:0,reviews:1});
    }finally{await pool.query(`DROP TRIGGER zz_pfb7_fault ON ${table};DROP FUNCTION pfb7_fault()`);}
  });
  it.each(['publication','administrator','login'] as const)('holds the real %s lock until the final fence and commit',async kind=>{
    const f=await seed(),input=await f.reviewed(),entered=deferred(),release=deferred();
    f.setScopeHook(async(_client,context,ordinal)=>{if(ordinal===2){entered.resolve();await release.promise;}return context;});
    const applying=f.apply(input);let other:PoolClient|undefined;
    try{await Promise.race([entered.promise,applying.then(()=>{throw new Error('Apply completed without the expected final-fence observation.');})]);
      other=await pool.connect();await other.query('BEGIN');await other.query("SET LOCAL lock_timeout='150ms'");
      const update=kind==='publication'?other.query('UPDATE pfb7_barrier_state SET context=context WHERE project_id=$1',[f.projectId])
        :kind==='administrator'?other.query('UPDATE users SET is_admin=false WHERE id=$1',[f.who.userId])
          :other.query('UPDATE viewer_login_bindings SET revoked_at=now() WHERE login_id=$1',[f.who.loginId]);
      await expect(update).rejects.toMatchObject({code:'55P03'});await other.query('ROLLBACK');
    }finally{if(other){await other.query('ROLLBACK').catch(()=>undefined);other.release();}release.resolve();await applying;}
    expect((await applying).duplicate).toBe(false);expect(await f.counts()).toEqual({history:1,receipts:1,reviews:1});
  });
});
