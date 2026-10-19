// @vitest-environment node
import {describe,it,expect,vi} from 'vitest';
import type {Pool,PoolClient} from 'pg';
import {claimCalculationSlice,finishCalculationSlice,initializeWorkerScheduling} from './workerScheduling.js';

type Row=Record<string,unknown>;
type Call={sql:string;values:unknown[]};
const project='a7000000-0000-4000-8000-000000000101';
const jobId='a7000000-0000-4000-8000-000000000102';
const owner='a7000000-0000-4000-8000-000000000103';
const job=(overrides:Row={}):Row=>({id:jobId,project_id:project,state:'queued',attempts:0,cancel_requested:false,kind:'calculate',owner_token:owner,...overrides});
const compact=(sql:string)=>sql.replace(/\s+/g,' ').trim();

/** SQL is recorded and its row results are injected; this opens no PostgreSQL connection. */
function database(options:{project?:string|null;row?:Row|null;failure?:string;waiting?:boolean}={}){
  const calls:Call[]=[],release=vi.fn();
  const query=vi.fn(async(sql:string,values:unknown[]=[])=>{
    calls.push({sql:compact(sql),values});
    if(options.failure&&sql.includes(options.failure))throw new Error('Synthetic query failure.');
    if(sql.includes('SELECT s.project_id FROM pf_engine_project_service'))return {rows:options.project===null?[]:[{project_id:options.project??project}]};
    if(sql.startsWith('SELECT * FROM pf_jobs WHERE project_id='))return {rows:options.row===null?[]:[options.row??job()]};
    if(sql.includes('RETURNING *'))return {rows:[{...(options.row??job()),state:'running',owner_token:values[1],attempts:Number((options.row??job()).attempts)+Number(values[2])}]};
    if(sql.includes('SELECT 1 FROM pf_job_items'))return {rows:options.waiting?[{exists:1}]:[]};
    return {rows:[]};
  });
  const client={query,release} as unknown as PoolClient;
  const connect=vi.fn(async()=>client),pool={connect} as unknown as Pool;
  return {calls,query,release,client,connect,pool};
}

describe('R7 engine project scheduling (mocked SQL contract and decisions)',()=>{
  it('adds the service clock and job counters transactionally without resetting existing service or attempts',async()=>{
    const db=database();await initializeWorkerScheduling(db.pool);
    expect(db.calls[0].sql).toBe('BEGIN');
    const bounds=db.calls.find(c=>c.sql.startsWith('SET LOCAL'))!;
    expect(bounds.sql).toContain("lock_timeout='3000ms'");
    expect(bounds.sql).toContain("statement_timeout='15000ms'");
    expect(bounds.sql).toContain("idle_in_transaction_session_timeout='30000ms'");
    const advisory=db.calls.find(c=>c.sql.includes('pg_advisory_xact_lock'))!;
    expect(advisory.sql).toContain("pg_advisory_xact_lock(hashtext('wfc-pathfinder-service-schema-v1'))");
    const definition=db.calls.find(c=>c.sql.includes('ALTER TABLE pf_jobs'))!;
    expect(db.calls.indexOf(bounds)).toBeLessThan(db.calls.indexOf(advisory));
    expect(db.calls.indexOf(advisory)).toBeLessThan(db.calls.indexOf(definition));
    const ddl=definition.sql;
    expect(ddl).toContain('ADD COLUMN IF NOT EXISTS last_served_at timestamptz');
    expect(ddl).toContain('ADD COLUMN IF NOT EXISTS dispatch_slices bigint NOT NULL DEFAULT 0 CHECK(dispatch_slices>=0)');
    expect(ddl).toContain('project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE');
    expect(ddl).toContain('INSERT INTO pf_engine_project_service(project_id) SELECT id FROM projects ON CONFLICT DO NOTHING');
    expect(ddl).toContain('AFTER INSERT ON projects');
    expect(ddl).toContain('VALUES(NEW.id) ON CONFLICT DO NOTHING');
    expect(ddl).not.toMatch(/UPDATE\s+(?:pf_jobs|pf_engine_project_service)\s+SET/i);
    expect(db.calls.at(-1)?.sql).toBe('COMMIT');expect(db.release).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  it('rolls back a refused schema mutation instead of acknowledging initialization',async()=>{
    const db=database({failure:'ALTER TABLE pf_jobs'});
    await expect(initializeWorkerScheduling(db.pool)).rejects.toThrow('Synthetic query failure.');
    expect(db.calls.at(-1)?.sql).toBe('ROLLBACK');expect(db.calls.some(c=>c.sql==='COMMIT')).toBe(false);
    expect(db.release).toHaveBeenCalledOnce();
  });

  it('selects the least-served project before a job, so extra jobs cannot buy project turns',async()=>{
    const db=database();const claimed=await claimCalculationSlice(db.pool);
    const projectQuery=db.calls.find(c=>c.sql.startsWith('SELECT s.project_id'))!;
    expect(projectQuery.values).toEqual([]);
    expect(projectQuery.sql).toContain("j.state='queued' OR j.state='running' AND j.lease_until<now()");
    expect(projectQuery.sql).toContain('ORDER BY s.last_served_at ASC NULLS FIRST,s.project_id FOR UPDATE OF s SKIP LOCKED LIMIT 1');
    expect(projectQuery.sql).not.toMatch(/JOIN pf_jobs|COUNT\(/i);
    const jobQuery=db.calls.find(c=>c.sql.startsWith('SELECT * FROM pf_jobs'))!;
    expect(db.calls.indexOf(projectQuery)).toBeLessThan(db.calls.indexOf(jobQuery));
    expect(jobQuery.values).toEqual([project]);
    expect(jobQuery.sql).toContain("WHERE project_id=$1 AND (state='queued' OR state='running' AND lease_until<now())");
    expect(jobQuery.sql).toContain('ORDER BY last_served_at ASC NULLS FIRST,created_at,id FOR UPDATE SKIP LOCKED LIMIT 1');
    expect(claimed).toMatchObject({id:jobId,project_id:project,state:'running',attempts:1});
    const service=db.calls.find(c=>c.sql.startsWith('UPDATE pf_engine_project_service'))!;
    expect(service.values).toEqual([project]);expect(service.sql).toContain('last_served_at=clock_timestamp()');
  });

  it('does not dispatch or consume a service turn when no project is eligible',async()=>{
    const db=database({project:null});expect(await claimCalculationSlice(db.pool)).toBeNull();
    expect(db.calls.map(c=>c.sql)).toHaveLength(4);
    expect(db.calls.filter(c=>c.sql.startsWith('SET LOCAL'))).toHaveLength(1);
    expect(db.calls.at(-1)?.sql).toBe('COMMIT');
    expect(db.calls.some(c=>c.sql.startsWith('UPDATE '))).toBe(false);
  });

  it('advances only the chosen project service clock when its eligible job disappears before its row lock',async()=>{
    const db=database({row:null});expect(await claimCalculationSlice(db.pool)).toBeNull();
    const updates=db.calls.filter(c=>c.sql.startsWith('UPDATE '));
    expect(updates).toHaveLength(1);expect(updates[0].sql).toContain('UPDATE pf_engine_project_service');
    expect(updates[0].values).toEqual([project]);expect(db.calls.at(-1)?.sql).toBe('COMMIT');
  });

  it.each([
    ['fresh queued job','queued',0,1],
    ['first interrupted running lease','running',1,1],
    ['second interrupted running lease','running',2,1],
    ['clean yield after first attempt','queued',1,0],
    ['clean yield after second attempt','queued',2,0],
    ['clean yield after final allowed attempt','queued',3,0],
  ])('%s increments interrupted recovery attempts by the correct amount',async(_label,state,attempts,increment)=>{
    const db=database({row:job({state,attempts})}),claimed=await claimCalculationSlice(db.pool);
    const update=db.calls.find(c=>c.sql.includes('dispatch_slices=dispatch_slices+1'))!;
    expect(update.values[0]).toBe(jobId);expect(update.values[1]).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    expect(update.values[2]).toBe(increment);expect(claimed?.attempts).toBe(Number(attempts)+Number(increment));
    expect(update.sql).toContain("lease_until=now()+interval '30 seconds'");
    const reset=db.calls.find(c=>c.sql.startsWith('UPDATE pf_job_items'))!;
    expect(reset.sql).toContain("SET state='waiting' WHERE project_id=$1 AND job_id=$2 AND state='running'");
    expect(reset.values).toEqual([project,jobId]);expect(db.calls.at(-1)?.sql).toBe('COMMIT');
  });

  it.each([
    ['cancelled before first dispatch',job({cancel_requested:true}), 'cancelled','Cancelled.'],
    ['cancelled yielded job',job({cancel_requested:true,attempts:3}),'cancelled','Cancelled.'],
    ['exhausted interrupted lease',job({state:'running',attempts:3}),'failed','Interrupted job exceeded its recovery attempts.'],
  ])('%s clears ownership without dispatching or rewriting item state',async(_label,row,state,message)=>{
    const db=database({row:row as Row});expect(await claimCalculationSlice(db.pool)).toBeNull();
    const terminal=db.calls.find(c=>c.sql.startsWith('UPDATE pf_jobs'))!;
    expect(terminal.values).toEqual([jobId,state,message]);
    expect(terminal.sql).toContain('owner_token=NULL,lease_until=NULL');
    expect(db.calls.some(c=>c.sql.startsWith('UPDATE pf_job_items'))).toBe(false);
    expect(db.calls.some(c=>c.sql.includes('dispatch_slices=dispatch_slices+1'))).toBe(false);
  });

  it('rolls back a failed row claim, including its provisional project service turn',async()=>{
    const db=database({failure:'dispatch_slices=dispatch_slices+1'});
    await expect(claimCalculationSlice(db.pool)).rejects.toThrow('Synthetic query failure.');
    expect(db.calls.some(c=>c.sql.startsWith('UPDATE pf_engine_project_service'))).toBe(true);
    expect(db.calls.at(-1)?.sql).toBe('ROLLBACK');
    expect(db.calls.some(c=>c.sql==='COMMIT')).toBe(false);
    expect(db.calls.some(c=>c.sql.startsWith('UPDATE pf_job_items'))).toBe(false);
  });

  it('yields a calculated item back to its job without burning recovery attempts or claiming total completion',async()=>{
    const db=database({waiting:true});await finishCalculationSlice(db.client,job({state:'running',attempts:3}));
    expect(db.calls[0].sql).toContain("state='waiting' LIMIT 1");expect(db.calls[0].values).toEqual([project,jobId]);
    const finish=db.calls[1];expect(finish.values).toEqual([jobId,owner,'queued']);
    expect(finish.sql).toContain('WHERE id=$1 AND owner_token=$2');
    expect(finish.sql).toContain('owner_token=NULL,lease_until=NULL');
    expect(finish.sql).not.toMatch(/attempts\s*=|completed\s*=|dispatch_slices\s*=/);
    expect(db.calls.some(c=>c.sql==='COMMIT')).toBe(false);
    // The caller retains its existing authority/fence transaction through its own COMMIT.
  });

  it('completes a calculation only after no waiting item remains',async()=>{
    const db=database();await finishCalculationSlice(db.client,job());
    expect(db.calls).toHaveLength(2);expect(db.calls[1].values).toEqual([jobId,owner,'complete']);
  });

  it.each(['lookup','preview'])('finishes one-shot %s without querying calculation items',async kind=>{
    const db=database({waiting:true});await finishCalculationSlice(db.client,job({kind}));
    expect(db.calls).toHaveLength(1);expect(db.calls[0].values).toEqual([jobId,owner,'complete']);
    expect(db.calls[0].sql).toContain('WHERE id=$1 AND owner_token=$2');
  });

  it('does not acknowledge finishing when the caller-owned fenced write refuses',async()=>{
    const db=database({failure:'UPDATE pf_jobs SET state=$3'});
    await expect(finishCalculationSlice(db.client,job())).rejects.toThrow('Synthetic query failure.');
    expect(db.calls.some(c=>c.sql==='COMMIT'||c.sql==='ROLLBACK')).toBe(false);
  });
});
