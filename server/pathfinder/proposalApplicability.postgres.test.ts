// @vitest-environment node
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { syntheticBarrierWriteInputs } from './barrierWriteFixtures.js';
import { encodeCadOverlay } from './cadOverlay.js';
import { hash } from './dependencies.js';
import { readAutomaticPairProposalApplicability, readProposalApplicability, type ProposalApplicabilityInput } from './proposalApplicability.js';
import type { AutomaticPairMandate } from '../../shared/pathfinderAutomaticPair.js';

const authority=vi.hoisted(()=>vi.fn());
const outputAuthority=vi.hoisted(()=>vi.fn());
vi.mock('./locationImpactRepository.js',()=>({readLocationImpactJobAuthority:authority}));
vi.mock('./recalculationRepository.js',()=>({readRecalculationJobAuthority:async()=>({enrolled:false})}));
vi.mock('./automaticPairMandates.js',()=>({requireCurrentAutomaticPairMandate:outputAuthority}));

const url=process.env.PF_APPLICABILITY_SQL_URL;
let pool:Pool,client:PoolClient;
const limit=256*1024;
function fixture(pointCount=2500){
  const {dependencies,result,id}=syntheticBarrierWriteInputs();
  if(pointCount){
    const points=Array.from({length:pointCount},(_,i)=>[5.4+Math.cos(i/pointCount),70.68+Math.sin(i/pointCount),19.3]);
    const port=(pointMetres:number[])=>({pointMetres,outward:[0,0,1],u:[1,0,0],v:[0,1,0],widthMetres:.3,heightMetres:.06});
    dependencies.routing.cadOverlay=encodeCadOverlay({schemaVersion:'wfc.pf.cad-overlay-payload.v3',projectId:dependencies.projectId,
      modelVersionId:dependencies.model.id,baseSnapshotSha256:dependencies.artifact.sha256,
      segments:[{id:`cad:${id(77)}`,name:'/CAD_DENSE',allowedCategoryMask:7,pointsMetres:points,ports:[port(points[0]),port(points.at(-1)!)]}]});
  }
  const jobId=id(100),proposalId=id(101),dependencyHash=hash(dependencies),baselineHash='e'.repeat(64);
  const proposalHash=hash({dependencies,result,baselineHash});
  const input:ProposalApplicabilityInput={projectId:dependencies.projectId,cableId:dependencies.cableId,jobId,proposalId,dependencyHash,
    dependencyVersion:dependencies.schemaVersion,jobState:'complete',cancelRequested:false,
    seal:{projectId:dependencies.projectId,cableId:dependencies.cableId,jobId,proposalId,dependencyHash,baselineHash,
      proposalHash,engineResultSha256:hash(result)}};
  const mandate={projectId:input.projectId,jobId,cableId:input.cableId,dependencyHash,source:{kind:'explicit-job'}} as AutomaticPairMandate;
  return {dependencies,result,input,mandate,proposalHash};
}
async function seed(f:ReturnType<typeof fixture>,itemDependencies:unknown=f.dependencies){
  await client.query('INSERT INTO pg_temp.pf_jobs VALUES($1,$2,$3,false)',[f.input.projectId,f.input.jobId,'complete']);
  await client.query('INSERT INTO pg_temp.pf_job_items VALUES($1,$2,$3,$4,$5,$6)',
    [f.input.projectId,f.input.jobId,f.input.cableId,'complete','calculated',itemDependencies===null?null:JSON.stringify(itemDependencies)]);
  await client.query('INSERT INTO pg_temp.pf_proposals VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [f.input.projectId,f.input.proposalId,f.input.jobId,f.input.cableId,'calculated',f.proposalHash,f.input.dependencyHash,
      JSON.stringify(f.dependencies),JSON.stringify(f.result)]);
}

describe.runIf(Boolean(url))('actual applicability SQL with connection-owned temporary tables',()=>{
  beforeAll(async()=>{
    pool=new Pool({connectionString:url,max:1,connectionTimeoutMillis:5000,query_timeout:10000});
    client=await pool.connect();
    await client.query('SET search_path=pg_temp');
    // These session-owned tables shadow production names. No public objects or
    // business records are read, changed, or dropped by this fixture.
    await client.query(`CREATE TEMP TABLE pf_jobs(project_id uuid,id uuid,state text,cancel_requested boolean);
      CREATE TEMP TABLE pf_job_items(project_id uuid,job_id uuid,cable_id uuid,state text,status text,dependencies jsonb);
      CREATE TEMP TABLE pf_proposals(project_id uuid,id uuid,job_id uuid,cable_id uuid,status text,proposal_hash text,dependency_hash text,dependencies jsonb,result jsonb)`);
  });
  beforeEach(async()=>{
    vi.clearAllMocks();authority.mockResolvedValue({enrolled:true,valid:true});outputAuthority.mockResolvedValue(undefined);
    await client.query('TRUNCATE pg_temp.pf_proposals,pg_temp.pf_job_items,pg_temp.pf_jobs');
  });
  afterAll(async()=>{client?.release();await pool?.end();});
  it('admits valid CAD proof whose single dependency plus result fits but duplicate dependency does not',async()=>{
    const f=fixture();await seed(f);
    const size=(await client.query(`SELECT octet_length(p.dependencies::text)+octet_length(p.result::text) AS single_bytes,
      octet_length(i.dependencies::text)+octet_length(p.dependencies::text)+octet_length(p.result::text) AS duplicate_bytes
      FROM pg_temp.pf_job_items i JOIN pg_temp.pf_proposals p USING(project_id,job_id,cable_id)`)).rows[0];
    expect(size.single_bytes).toBeLessThan(limit);expect(size.duplicate_bytes).toBeGreaterThan(limit);
    expect((await readProposalApplicability(client,f.input)).applicable).toBe(true);
    expect((await readAutomaticPairProposalApplicability(client,f.input,f.mandate)).applicable).toBe(true);
    expect(outputAuthority).toHaveBeenCalledOnce();
  });
  it('rejects different item dependencies even when the proposal and its seal are valid',async()=>{
    const f=fixture();await seed(f,{...f.dependencies,cableWriteRevision:'99'});
    expect((await readProposalApplicability(client,f.input)).applicable).toBe(false);
    expect((await readAutomaticPairProposalApplicability(client,f.input,f.mandate)).applicable).toBe(false);
    expect(authority).not.toHaveBeenCalled();expect(outputAuthority).not.toHaveBeenCalled();
  });
  it('retains the original bound for the single dependency and result, without authority fallback',async()=>{
    const f=fixture(5000);await seed(f);
    const size=(await client.query('SELECT octet_length(dependencies::text)+octet_length(result::text) AS bytes FROM pg_temp.pf_proposals')).rows[0];
    expect(size.bytes).toBeGreaterThan(limit);
    expect((await readProposalApplicability(client,f.input)).applicable).toBe(false);
    expect((await readAutomaticPairProposalApplicability(client,f.input,f.mandate)).applicable).toBe(false);
    expect(authority).not.toHaveBeenCalled();expect(outputAuthority).not.toHaveBeenCalled();
  });
  it('does not turn missing item dependencies into a match',async()=>{
    const f=fixture(0);await seed(f,null);
    expect((await readProposalApplicability(client,f.input)).applicable).toBe(false);expect(authority).not.toHaveBeenCalled();
  });
  it('bounds the item copy independently even when the returned proposal body is small',async()=>{
    const f=fixture(0);await seed(f,fixture(5000).dependencies);
    expect((await readProposalApplicability(client,f.input)).applicable).toBe(false);
    expect((await readAutomaticPairProposalApplicability(client,f.input,f.mandate)).applicable).toBe(false);
    expect(authority).not.toHaveBeenCalled();expect(outputAuthority).not.toHaveBeenCalled();
  });
});
