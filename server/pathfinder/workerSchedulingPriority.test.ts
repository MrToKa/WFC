// @vitest-environment node
import {describe,expect,it,vi} from 'vitest';
import type {Pool,PoolClient} from 'pg';
import {claimCalculationSlice} from './workerScheduling.js';

const id=(n:number)=>'b7250000-0000-4000-8000-'+n.toString(16).padStart(12,'0');
const project=id(1),otherProject=id(2),origin=id(90);
type Impact={schema:'v1'|'v2'|'v3';enrolled?:boolean;eligible?:boolean;current?:boolean;generationMatches?:boolean;
  projectMatches?:boolean;identityMatches?:boolean;hashMatches?:boolean;originId?:string;itemState?:string};
type Job={id:string;project_id:string;state:string;attempts:number;cancel_requested:boolean;kind:string;
  created_at:number;last_served_at:number|null;not_before:number|null;lease_until:number;owner_token:string|null;
  impact?:Impact;requestHint?:string};
const job=(n:number,overrides:Partial<Job>={}):Job=>({id:id(n),project_id:project,state:'queued',attempts:1,cancel_requested:false,kind:'calculate',
  created_at:n,last_served_at:null,not_before:null,lease_until:0,owner_token:null,...overrides});
const popup=(n:number,impact:Partial<Impact>={},overrides:Partial<Job>={})=>job(n,{impact:{schema:'v3',originId:origin,itemState:'waiting',...impact},...overrides});
const compact=(sql:string)=>sql.replace(/\s+/g,' ').trim();
const nullable=(a:number|null,b:number|null)=>a===null?b===null?0:-1:b===null?1:a-b;

/** Stateful scheduling protocol, not a PostgreSQL integration test. Ordering is
 * evaluated over multiple projects/jobs; SQL predicates are checked separately. */
function fixture(jobs:Job[],services:Record<string,number|null>={[project]:null}){
  const calls:{sql:string;values:unknown[]}[]=[],now=1000;
  const eligible=(row:Job)=>(row.state==='queued'||row.state==='running'&&row.lease_until<now)&&(row.not_before===null||row.not_before<=now);
  const priority=(row:Job)=>{
    const record=row.impact;
    return row.kind==='calculate'&&!row.cancel_requested&&record&&['v2','v3'].includes(record.schema)
      &&record.enrolled!==false&&record.eligible!==false&&record.current!==false&&record.generationMatches!==false
      &&record.projectMatches!==false&&record.identityMatches!==false&&record.hashMatches!==false
      &&record.itemState==='waiting'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(record.originId??'');
  };
  const query=vi.fn(async(sql:string,values:unknown[]=[])=>{
    const text=compact(sql);calls.push({sql:text,values});
    if(text.startsWith('SELECT s.project_id')){
      const projects=Object.keys(services).filter(key=>jobs.some(row=>row.project_id===key&&eligible(row)));
      projects.sort((a,b)=>nullable(services[a],services[b])||a.localeCompare(b));
      return {rows:projects.slice(0,1).map(project_id=>({project_id}))};
    }
    if(text.startsWith('SELECT * FROM pf_jobs')){
      const prioritizesOrigins=text.includes("ORDER BY CASE WHEN kind='calculate' AND NOT cancel_requested AND EXISTS(");
      const choices=jobs.filter(row=>row.project_id===values[0]&&eligible(row));
      choices.sort((a,b)=>(prioritizesOrigins?Number(Boolean(priority(b)))-Number(Boolean(priority(a))):0)
        ||nullable(a.last_served_at,b.last_served_at)||a.created_at-b.created_at||a.id.localeCompare(b.id));
      return {rows:choices.slice(0,1)};
    }
    if(text.startsWith('UPDATE pf_engine_project_service')){services[String(values[0])]=now;return {rows:[]};}
    if(text.includes('dispatch_slices=dispatch_slices+1')){
      const selected=jobs.find(row=>row.id===values[0])!;
      Object.assign(selected,{state:'running',owner_token:values[1],attempts:selected.attempts+Number(values[2])});return {rows:[selected]};
    }
    if(text.startsWith('UPDATE pf_jobs SET state=$2')){
      Object.assign(jobs.find(row=>row.id===values[0])!,{state:values[1],owner_token:null});return {rows:[]};
    }
    if(text.startsWith('UPDATE pf_job_items')||text==='BEGIN'||text==='COMMIT'||text==='ROLLBACK'||text.startsWith('SET LOCAL'))return {rows:[]};
    throw Error('Unexpected scheduler statement: '+text);
  });
  const release=vi.fn(),client={query,release} as unknown as PoolClient;
  return {pool:{connect:vi.fn(async()=>client)} as unknown as Pool,calls,query,services};
}

describe('popup origin priority at safe worker item boundaries',()=>{
  it.each(['v2','v3'] as const)('serves a waiting enrolled %s origin before older background jobs in the same project',async schema=>{
    const background=job(10),selected=popup(20,{schema}),db=fixture([background,selected]);
    expect((await claimCalculationSlice(db.pool))?.id).toBe(selected.id);
    expect(background.state).toBe('queued');expect(background.owner_token).toBeNull();
  });
  it('preserves least-served/creation ordering between two waiting popup origins',async()=>{
    const older=popup(10,{}, {last_served_at:2}),leastServed=popup(20,{}, {last_served_at:1}),db=fixture([older,leastServed]);
    expect((await claimCalculationSlice(db.pool))?.id).toBe(leastServed.id);
    const tie=fixture([popup(30),popup(25)]);expect((await claimCalculationSlice(tie.pool))?.id).toBe(id(25));
  });
  it.each([
    ['completed origin',{itemState:'complete'}],['blocked origin',{itemState:'blocked'}],['running origin',{itemState:'running'}],
    ['legacy record',{schema:'v1'}],['unlinked record',{enrolled:false}],['ineligible origin',{eligible:false}],
    ['superseded target',{current:false}],['superseded generation',{generationMatches:false}],
    ['other record project',{projectMatches:false}],['mismatched impact identity',{identityMatches:false}],['mismatched record digest',{hashMatches:false}],
    ['malformed origin',{originId:'not-a-uuid'}],
  ] as const)('does not promote a %s',async(_name,impact)=>{
    const background=job(10),selected=popup(20,impact),db=fixture([selected,background]);
    expect((await claimCalculationSlice(db.pool))?.id).toBe(background.id);
  });
  it('does not promote request text without immutable impact enrollment',async()=>{
    const db=fixture([job(20,{requestHint:origin}),job(10)]);
    expect((await claimCalculationSlice(db.pool))?.id).toBe(id(10));
  });
  it('does not promote a cancelled origin job or a non-calculation job',async()=>{
    for(const overrides of [{cancel_requested:true},{kind:'lookup'},{kind:'preview'}]){
      const background=job(10),db=fixture([popup(20,{},overrides),background]);
      expect((await claimCalculationSlice(db.pool))?.id).toBe(background.id);
    }
  });
  it('never selects a popup job before not_before, even if no other job exists',async()=>{
    const db=fixture([popup(20,{}, {not_before:1001})]);expect(await claimCalculationSlice(db.pool)).toBeNull();
    expect(db.calls.some(call=>call.sql.startsWith('UPDATE'))).toBe(false);
  });
  it('excludes an active unexpired lease without cancelling or replacing its owner',async()=>{
    const active=popup(10,{itemState:'running'},{state:'running',lease_until:1001,owner_token:id(99)}),db=fixture([active,popup(20)]);
    expect((await claimCalculationSlice(db.pool))?.id).toBe(id(20));
    expect(active).toMatchObject({state:'running',owner_token:id(99)});
    expect(db.calls.some(call=>/cancel_requested\s*=/.test(call.sql))).toBe(false);
  });
  it('keeps project fairness ahead of popup priority, so one project cannot buy more turns',async()=>{
    const selected=popup(20),other=job(10,{project_id:otherProject}),db=fixture([selected,other],{[project]:9,[otherProject]:1});
    expect((await claimCalculationSlice(db.pool))?.id).toBe(other.id);
    expect(selected.state).toBe('queued');expect(db.services[project]).toBe(9);expect(db.services[otherProject]).toBe(1000);
    expect(db.calls.find(call=>call.sql.startsWith('SELECT s.project_id'))?.sql)
      .toContain('ORDER BY s.last_served_at ASC NULLS FIRST,s.project_id FOR UPDATE OF s SKIP LOCKED LIMIT 1');
  });
  it('keeps recovery/cancel fences and current-generation joins on the actual SQL path',async()=>{
    const db=fixture([popup(20)]);await claimCalculationSlice(db.pool);
    const select=db.calls.find(call=>call.sql.startsWith('SELECT * FROM pf_jobs'))!;
    expect(select.values).toEqual([project]);expect(select.sql).toContain("state='running' AND lease_until<now()");
    expect(select.sql).toContain('(not_before IS NULL OR not_before<=now())');
    expect(select.sql).toContain('JOIN pf_location_impacts impact ON impact.project_id=e.project_id AND impact.id=e.impact_id');
    expect(select.sql).toContain('origin.project_id=e.project_id AND origin.job_id=e.job_id');
    expect(select.sql).toContain('effect.cable_id=origin.cable_id AND effect.eligible');
    expect(select.sql).toContain('target.impact_id=effect.impact_id AND target.generation=effect.generation');
    expect(select.sql).toContain("origin.state='waiting'");
    expect(select.sql).toContain("IN('wfc.pf.location-impact-record.v2','wfc.pf.location-impact-record.v3')");
    expect(select.sql).toContain("impact.record->>'contentSha256'=impact.record_sha256");
    expect(select.sql).toContain('THEN 0 ELSE 1 END,last_served_at ASC NULLS FIRST,created_at,id FOR UPDATE SKIP LOCKED LIMIT 1');
    expect(select.sql).not.toContain('requestHint');
  });
});
