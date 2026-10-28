// @vitest-environment node
import {describe,expect,it,vi} from 'vitest';
import type {PoolClient} from 'pg';
import {locationImpactRecordSchema} from '../../shared/pathfinderLocationImpacts.js';
import {endpointBindingHash} from './endpointBindingRepository.js';
import {nextCalculationItem} from './workerScheduling.js';

const id=(n:number)=>'b2720000-0000-4000-8000-'+n.toString(16).padStart(12,'0');
const origin=id(99),siblings=[id(1),id(2)],projectId=id(3),jobId=id(4),impactId=id(5);
type State='waiting'|'running'|'complete'|'blocked';
/** In-memory SQL protocol. It evaluates the scoped ordering/filter contract;
 * no engine, SDK, database or application runtime is started. */
function fixture(options:{legacy?:boolean;unlinked?:boolean;external?:boolean;automaticPolicy?:boolean}={}){
  const base={id:impactId,projectId,actorId:id(6),actorAdminRevision:'1',loginId:id(7),loginExpiresAt:'2099-01-01T01:00:00.000Z',
    authorityExpiresAt:'2099-01-01T00:30:00.000Z',installationEpoch:id(8),idempotencyKey:id(9),commandSha256:'a'.repeat(64),locationId:id(10),
    bindingId:id(11),bindingContentSha256:'b'.repeat(64),observedRegistryRevision:'7',
    current:{modelVersionId:id(12),selectionRevision:'1',contentFingerprint:'c'.repeat(64),aggregateId:id(13),artifactId:id(14),captureFrameId:id(15),projectionSha256:'d'.repeat(64),geometryRevision:'1',traceId:null},
    calculation:null,eligibleCableIds:[...siblings,origin],excludedMvCableIds:[],blockedCategoryCableIds:[],createdAt:'2099-01-01T00:00:00.000Z',contentSha256:'0'.repeat(64)};
  const draft=locationImpactRecordSchema.parse({...base,...(options.legacy?{schemaVersion:'wfc.pf.location-impact-record.v1'}:
    options.automaticPolicy?{schemaVersion:'wfc.pf.location-impact-record.v3',originCableId:origin,
      calculation:{preferences:{secondaryDistanceMeters:2,preferVerticalApproach:true},timeoutMilliseconds:60000},
      automaticPairPolicy:{schemaVersion:'wfc.pf.automatic-pair-policy.v1',mode:'when-both-empty-or-unchanged-automatic'}}:
      {schemaVersion:'wfc.pf.location-impact-record.v2',originCableId:origin})});
  const {contentSha256:_hash,...body}=draft,record={...draft,contentSha256:endpointBindingHash(body)};
  const items=new Map<string,State>([...siblings,...(options.external?[]:[origin])].map(cableId=>[cableId,'waiting']));
  const state={externalState:'waiting' as State,dispatch:'enrolled',jobState:'queued',cancelled:false,deleted:false,hash:record.contentSha256};
  const query=vi.fn(async(sql:string,args:unknown[]=[]):Promise<{rows:Record<string,unknown>[]} >=>{
    if(sql.startsWith('SELECT impact_id FROM pf_location_impact_enrollments'))return {rows:options.unlinked?[]:[{impact_id:impactId}]};
    if(sql.startsWith('SELECT i.project_id'))return {rows:[{project_id:projectId,id:impactId,actor_id:record.actorId,login_id:record.loginId,
      idempotency_key:record.idempotencyKey,command_sha256:record.commandSha256,record_sha256:state.hash,record}]};
    if(sql.startsWith('/* location-impact:origin-progress */'))return {rows:state.deleted?[]:[{mto:'LV',impact_id:options.external?id(88):impactId,dispatch_status:state.dispatch,
      job_id:options.external?id(89):jobId,job_state:state.jobState,cancel_requested:state.cancelled,item_state:options.external?state.externalState:items.get(origin)}]};
    if(sql.startsWith('SELECT * FROM pf_job_items')){
      const candidates=[...items].filter(([cableId,itemState])=>itemState==='waiting'&&(!args[3]||cableId===args[2]));
      candidates.sort((a,b)=>Number(b[0]===args[2])-Number(a[0]===args[2])||a[0].localeCompare(b[0]));
      return {rows:candidates.slice(0,1).map(([cable_id,itemState])=>({cable_id,state:itemState}))};
    }
    throw Error('Unexpected priority SQL: '+sql);
  });
  const client={query} as unknown as PoolClient;
  return {items,state,query,next:()=>nextCalculationItem(client,{project_id:projectId,id:jobId})};
}
describe('durable popup origin priority within shared-location jobs',()=>{
  it.each([false,true])('selects a UUID-last origin before siblings and holds siblings until its terminal item is committed (automatic policy=%s)',async automaticPolicy=>{
    const f=fixture({automaticPolicy});expect((await f.next())?.cable_id).toBe(origin);f.items.set(origin,'running');
    expect(await f.next()).toBeUndefined();expect(f.items.get(siblings[0])).toBe('waiting');
    f.items.set(origin,'complete');expect((await f.next())?.cable_id).toBe(siblings[0]);
    const selects=f.query.mock.calls.filter(([sql])=>sql.startsWith('SELECT * FROM pf_job_items'));
    expect(selects[0][0]).toContain('AND ($4::boolean=false OR cable_id=$3::uuid)');
    expect(selects[0][0]).toContain('ORDER BY CASE WHEN cable_id=$3::uuid THEN 0 ELSE 1 END,cable_id FOR UPDATE LIMIT 1');
    expect(selects.map(([,args])=>args)).toEqual([[projectId,jobId,origin,true],[projectId,jobId,origin,true],[projectId,jobId,origin,false]]);
  });
  it('reselects the same origin after interrupted-lease recovery without duplicating or dropping siblings',async()=>{
    const f=fixture();expect((await f.next())?.cable_id).toBe(origin);f.items.set(origin,'running');expect(await f.next()).toBeUndefined();
    f.items.set(origin,'waiting');expect((await f.next())?.cable_id).toBe(origin);expect(f.items.size).toBe(3);
    f.items.set(origin,'blocked');expect((await f.next())?.cable_id).toBe(siblings[0]);f.items.set(siblings[0],'complete');expect((await f.next())?.cable_id).toBe(siblings[1]);
    expect(f.query.mock.calls.every(([sql])=>!/^UPDATE|^INSERT|^DELETE/.test(sql))).toBe(true);
  });
  it('keeps a paired-save earlier impact queued until its latest origin in the other impact finishes',async()=>{
    const f=fixture({external:true});expect(await f.next()).toBeUndefined();f.state.externalState='running';expect(await f.next()).toBeUndefined();
    expect([...f.items.keys()]).toEqual(siblings);f.state.externalState='complete';expect((await f.next())?.cable_id).toBe(siblings[0]);
  });
  it('does not treat a requested cancellation as a terminal or joined origin calculation',async()=>{
    const f=fixture({external:true});f.state.cancelled=true;f.state.dispatch='cancelled';f.state.externalState='running';f.state.jobState='running';
    expect(await f.next()).toBeUndefined();expect(f.items.get(siblings[0])).toBe('waiting');
    f.state.jobState='cancelled';expect((await f.next())?.cable_id).toBe(siblings[0]);
  });
  it.each(['legacy','unlinked'] as const)('retains ordinary UUID ordering for %s jobs',async kind=>{
    const f=fixture({[kind]:true});expect((await f.next())?.cable_id).toBe(siblings[0]);
    const select=f.query.mock.calls.find(([sql])=>sql.startsWith('SELECT * FROM pf_job_items'))!;
    expect(select[0]).toBe("SELECT * FROM pf_job_items WHERE project_id=$1 AND job_id=$2 AND state='waiting' ORDER BY cable_id FOR UPDATE LIMIT 1");expect(select[1]).toEqual([projectId,jobId]);
    expect(f.query.mock.calls.some(([sql])=>sql.startsWith('/* location-impact:origin-progress */'))).toBe(false);
  });
  it.each(['failed','cancelled','deleted'] as const)('does not hang siblings after a terminal %s origin',async kind=>{
    const f=fixture({external:true});if(kind==='deleted')f.state.deleted=true;else f.state.jobState=kind;
    expect((await f.next())?.cable_id).toBe(siblings[0]);
  });
  it('refuses tampered immutable priority evidence without reading or claiming any cable item',async()=>{
    const f=fixture();f.state.hash='f'.repeat(64);await expect(f.next()).rejects.toMatchObject({code:'LOCATION_IMPACT_INTEGRITY'});
    expect(f.query.mock.calls.some(([sql])=>sql.startsWith('SELECT * FROM pf_job_items'))).toBe(false);
  });
});
