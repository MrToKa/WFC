// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {Pool,PoolClient} from 'pg';
import {CALCULATION_GRANT_OPERATIONS,calculationGrantSchema} from '../../shared/pathfinderCalculationGrant.js';
import {enrollGrantGenerationInTransaction,readGrantGenerationCandidates,type GrantRecalculationAdapter} from './grantRecalculation.js';
import {calculationGrantProvenance,calculationGrantRecordHash,type CalculationGrantAuthority} from './calculationAuthority.js';
import {PathFinderError} from './errors.js';
const seams=vi.hoisted(()=>({requireGrant:vi.fn()}));
vi.mock('./calculationAuthority.js',async original=>({...await original<typeof import('./calculationAuthority.js')>(),requireCalculationGrant:seams.requireGrant}));
const id=(n:number)=>`aa880000-0000-4000-8000-${String(n).padStart(12,'0')}`;
type Row=Record<string,any>;
function fixture(){
  const grant=calculationGrantSchema.parse({schemaVersion:'wfc.pf.calculation-grant.v1',projectId:id(1),id:id(2),grantRevision:'1',grantEpoch:'1',installationEpoch:id(3),enabled:true,enabledBy:id(4),enabledAt:new Date().toISOString(),updatedAt:new Date().toISOString(),issuerAdminRevision:'2',scope:'active-model',operations:[...CALCULATION_GRANT_OPERATIONS],limitsProfile:'local-bounded-v1',preferences:{secondaryDistanceMeters:2,preferVerticalApproach:true},timeoutMilliseconds:60000});
  const authority:CalculationGrantAuthority={kind:'calculation-grant',projectId:id(1),grantId:id(2),grantRevision:'1',grantEpoch:'1',installationEpoch:id(3),issuerId:id(4),issuerAdminRevision:'2',leaseId:id(5),ownerToken:'a'.repeat(64),leaseExpiresAt:new Date(Date.now()+60000).toISOString(),operation:'calculate',modelVersionId:id(6),selectionRevision:'3',contentFingerprint:'b'.repeat(64)};
  const db={prior:null as Row|null,state:{desired_generation:'7',control_revision:'4',authority_epoch:'3',enabled:false,paused:false,actor_id:null,login_id:null,login_expires_at:null,authority_expires_at:null,engine_unavailable_code:null} as Row,
    admission:{jobId:id(7) as string|null,inputSha256:'c'.repeat(64),duplicate:false,readyCables:2,blockedCables:1,total:3,reasonCodes:['LOCATIONS_REQUIRED']},candidateRows:[] as Row[]};
  const events:string[]=[],calls:Array<{sql:string;values:unknown[]}>=[],query=vi.fn(async(raw:string,values:unknown[]=[])=>{
    const sql=raw.replace(/\s+/g,' ').trim();calls.push({sql,values});
    if(sql.startsWith('SELECT job_id,grant_provenance'))return{rows:db.prior?[db.prior]:[]};if(sql.includes('FROM pf_recalculation_state WHERE project_id=')){events.push('scheduler-lock');return{rows:[db.state]};}
    if(sql.startsWith('INSERT INTO pf_recalculation_enrollments'))events.push('enrollment');if(sql.startsWith('UPDATE pf_recalculation_state'))events.push('state-ack');
    if(sql.includes('FROM pf_recalculation_state s JOIN pf_calculation_grant_heads'))return{rows:db.candidateRows};return{rows:[]};
  });
  const release=vi.fn(),c={query,release} as unknown as PoolClient,pool={connect:vi.fn(async()=>c)} as unknown as Pool;
  seams.requireGrant.mockImplementation(async(_c:unknown,_a:unknown,_operation:unknown,options?:{lock?:boolean})=>{events.push(options?.lock?'grant-lock':'grant-read');return grant;});
  const adapter:GrantRecalculationAdapter={createInTransaction:vi.fn(async(_c,input)=>{events.push('dependencies');await input.beforeInsert();events.push('new-job');return db.admission;})};
  const input={authority,generation:'7',controlRevision:'4',authorityEpoch:'3',preferences:grant.preferences,timeoutMilliseconds:grant.timeoutMilliseconds,signal:new AbortController().signal,adapter};
  return{grant,authority,db,events,calls,query,c,pool,release,adapter,input};
}
beforeEach(()=>vi.resetAllMocks());
describe('one grant generation on the existing R7 ledger (mocked SQL only)',()=>{
  it('freezes dependencies before grant/state latches and atomically acknowledges one exact generation',async()=>{
    const x=fixture();await expect(enrollGrantGenerationInTransaction(x.c,x.input)).resolves.toEqual({status:'enrolled',generation:'7',jobId:id(7)});
    expect(x.events).toEqual(['grant-read','dependencies','grant-lock','scheduler-lock','new-job','enrollment','state-ack','grant-lock']);
    const call=x.calls.find(c=>c.sql.startsWith('INSERT INTO pf_recalculation_enrollments'))!;expect(call.sql).toContain('$5,NULL,NULL,$6');expect(call.values[4]).toBe(x.authority.issuerId);
    expect(call.values[5]).toEqual(calculationGrantProvenance(x.authority));expect(JSON.stringify(call.values)).not.toContain(x.authority.ownerToken);
    const adapterCall=vi.mocked(x.adapter.createInTransaction).mock.calls[0][1];expect(adapterCall.principal).toMatchObject({kind:'calculation-grant',userId:x.authority.issuerId});expect(adapterCall.principal).not.toHaveProperty('loginId');
  });
  it('reconciles its exact prior grant generation without another job or overwriting a newer desired generation',async()=>{
    const x=fixture();x.db.prior={job_id:id(7),grant_provenance:calculationGrantProvenance(x.authority)};x.db.state.desired_generation='8';
    await expect(enrollGrantGenerationInTransaction(x.c,x.input)).resolves.toEqual({status:'duplicate',generation:'7',jobId:id(7)});expect(x.adapter.createInTransaction).not.toHaveBeenCalled();expect(x.calls.some(c=>/^(INSERT|UPDATE)/.test(c.sql))).toBe(false);
  });
  it('never retroactively enrolls a human generation or another grant as its own',async()=>{
    const x=fixture();x.db.prior={job_id:id(7),grant_provenance:null};await expect(enrollGrantGenerationInTransaction(x.c,x.input)).rejects.toMatchObject({code:'RECALCULATION_GENERATION_AUTHORITY_CONFLICT'});expect(x.adapter.createInTransaction).not.toHaveBeenCalled();
  });
  it.each(['desired_generation','control_revision','authority_epoch'])('refuses changed %s before admitting a job',async field=>{
    const x=fixture();x.db.state[field]='99';await expect(enrollGrantGenerationInTransaction(x.c,x.input)).rejects.toMatchObject({code:'AUTOMATIC_GENERATION_SUPERSEDED'});expect(x.events).not.toContain('new-job');expect(x.events).not.toContain('enrollment');
  });
  it.each([{enabled:true},{paused:true},{actor_id:id(9)},{login_id:id(9)},{login_expires_at:new Date()},{authority_expires_at:new Date()}])('refuses competing or partial finite-login state %j',async change=>{
    const x=fixture();Object.assign(x.db.state,change);await expect(enrollGrantGenerationInTransaction(x.c,x.input)).rejects.toMatchObject({code:'RECALCULATION_AUTHORITY_MODE_CONFLICT'});expect(x.events).not.toContain('new-job');
  });
  it('persists one all-blocked enrollment with no synthetic empty job',async()=>{
    const x=fixture();x.db.admission={...x.db.admission,jobId:null,readyCables:0,blockedCables:3};
    await expect(enrollGrantGenerationInTransaction(x.c,x.input)).resolves.toEqual({status:'blocked',generation:'7',jobId:null});
    const update=x.calls.find(c=>c.sql.startsWith('UPDATE pf_recalculation_state'))!;expect(update.values[3]).toBe('blocked');expect(update.values[1]).toBe('7');
  });
  it('refuses different preferences and engine unavailability rather than inventing defaults',async()=>{
    const x=fixture();await expect(enrollGrantGenerationInTransaction(x.c,{...x.input,preferences:{...x.input.preferences,secondaryDistanceMeters:4}})).rejects.toMatchObject({code:'CALCULATION_GRANT_PREFERENCES_CHANGED'});
    x.db.state.engine_unavailable_code='ENGINE_IDENTITY_UNAVAILABLE';await expect(enrollGrantGenerationInTransaction(x.c,x.input)).rejects.toMatchObject({code:'ENGINE_IDENTITY_UNAVAILABLE'});
  });
  it.each(['missing','twice'] as const)('refuses an adapter that calls the final guard %s',async mode=>{
    const x=fixture();x.adapter.createInTransaction=vi.fn(async(_c,input)=>{if(mode==='twice'){await input.beforeInsert();await input.beforeInsert();}return x.db.admission;});
    await expect(enrollGrantGenerationInTransaction(x.c,x.input)).rejects.toMatchObject({code:mode==='missing'?'RECALCULATION_ADAPTER_GUARD_MISSING':'RECALCULATION_ADAPTER_GUARD_REUSED'});expect(x.events).not.toContain('enrollment');
  });
  it.each([{duplicate:true},{total:10001},{readyCables:4},{jobId:null},{inputSha256:'bad'}])('refuses inconsistent or reused adapter result %j',async change=>{
    const x=fixture();Object.assign(x.db.admission,change);await expect(enrollGrantGenerationInTransaction(x.c,x.input)).rejects.toMatchObject({code:'RECALCULATION_ADAPTER_RESULT_INVALID'});expect(x.events).not.toContain('enrollment');
  });
  it('rechecks finite grant authority after provisional writes so the caller must roll them back on expiry',async()=>{
    const x=fixture();seams.requireGrant.mockResolvedValueOnce(x.grant).mockResolvedValueOnce(x.grant).mockRejectedValueOnce(new PathFinderError('CALCULATION_GRANT_LEASE_EXPIRED',409));
    await expect(enrollGrantGenerationInTransaction(x.c,x.input)).rejects.toMatchObject({code:'CALCULATION_GRANT_LEASE_EXPIRED'});expect(x.events).toContain('enrollment');expect(x.calls.some(c=>c.sql==='COMMIT')).toBe(false);
  });
});
describe('bounded current grant generation candidate reader',()=>{
  it('uses the existing ledger and current issuer/install/healthy model without a human login or write',async()=>{
    const x=fixture();x.db.candidateRows=[{project_id:id(1),id:x.grant.id,grant_revision:'1',grant_epoch:'1',installation_epoch:id(3),issuer_id:id(4),issuer_admin_revision:'2',record:x.grant,record_sha256:calculationGrantRecordHash(x.grant),desired_generation:'7',control_revision:'4',authority_epoch:'3',active_model_version_id:id(6),selection_revision:'3',content_fingerprint:'b'.repeat(64)}];
    const rows=await readGrantGenerationCandidates(x.pool);expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({grant:x.grant,generation:'7',controlRevision:'4',authorityEpoch:'3'});
    const select=x.calls.find(c=>c.sql.includes('FROM pf_recalculation_state s JOIN'))!;expect(select.values).toEqual([5,null]);
    for(const fragment of ['u.is_admin=true','u.pf_admin_revision=r.issuer_admin_revision','i.installation_epoch=r.installation_epoch',"m.health='healthy'",'s.desired_generation IS DISTINCT FROM s.enrolled_generation','s.login_id IS NULL','NOT s.enabled','NOT s.paused'])expect(select.sql).toContain(fragment);
    expect(x.calls.some(c=>/^(INSERT|UPDATE|DELETE)/.test(c.sql))).toBe(false);expect(x.calls.map(c=>c.sql).join('\n')).not.toContain('viewer_login_bindings');
  });
  it.each([0,6,1.5])('refuses out-of-bound candidate limit %s before connecting',async limit=>{
    const x=fixture();await expect(readGrantGenerationCandidates(x.pool,{limit})).rejects.toMatchObject({code:'CALCULATION_GRANT_CANDIDATE_LIMIT'});expect(x.pool.connect).not.toHaveBeenCalled();
  });
  it('returns no work for an empty bounded candidate page',async()=>{const x=fixture();await expect(readGrantGenerationCandidates(x.pool,{limit:1})).resolves.toEqual([]);});
  it('continues from an exact project cursor so blocked projects cannot monopolize admission',async()=>{
    const x=fixture();await readGrantGenerationCandidates(x.pool,{limit:5,afterProjectId:id(9)});
    const select=x.calls.find(c=>c.sql.includes('FROM pf_recalculation_state s JOIN'))!;expect(select.values).toEqual([5,id(9)]);
    expect(select.sql).toContain('s.project_id>$2');expect(select.sql).toContain('ORDER BY s.project_id');
  });
});
