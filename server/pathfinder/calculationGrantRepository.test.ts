// @vitest-environment node
import {describe,expect,it,vi} from 'vitest';
import type {Pool,PoolClient} from 'pg';
import {createCalculationGrantRepository,newCalculationGrantLeaseOwner,fenceCalculationGrantInstallation,type CalculationGrantLeaseClaim} from './calculationGrantRepository.js';
import {calculationGrantRecordHash,calculationAuthorityOwnerHash,calculationGrantProvenance,requireCalculationGrantRevision} from './calculationAuthority.js';
import type {CalculationGrant,CalculationGrantCommand} from '../../shared/pathfinderCalculationGrant.js';
const id=(n:number)=>`fa800000-0000-4000-8000-${String(n).padStart(12,'0')}`;
type Row=Record<string,any>;
/** Actual repository/transaction functions over an in-memory SQL interpreter; no DB or runtime is opened. */
function fixture(){
  const who={userId:id(2),loginId:id(3),loginExpiresAt:Date.now()+3600000};
  const db={admin:true,adminRevision:'2',installation:id(4),head:{grantId:null as string|null,revision:'0',epoch:'0'},grants:new Map<string,CalculationGrant>(),commands:new Map<string,Row>(),leases:new Map<string,Row>(),commitLost:false,modelRevision:'3'};
  const calls:Array<{sql:string;values:unknown[]}>=[],release=vi.fn();let snapshot:typeof db|undefined;
  const head=()=>{const g=db.grants.get(db.head.revision);return{project_id:id(1),grant_id:db.head.grantId,control_revision:db.head.revision,head_revision:db.head.revision,head_epoch:db.head.epoch,
    id:g?.id??null,grant_revision:g?.grantRevision??null,grant_epoch:g?.grantEpoch??null,installation_epoch:g?.installationEpoch??null,issuer_id:g?.enabledBy??null,issuer_admin_revision:g?.issuerAdminRevision??null,record:g??null,record_sha256:g?calculationGrantRecordHash(g):null};};
  const leaseProjection=(l:Row)=>({...l,lease_revision:l.grant_revision,lease_epoch:l.grant_epoch,lease_installation:l.installation_epoch,lease_issuer:l.issuer_id,lease_admin_revision:l.issuer_admin_revision,
    lease_selection:l.selection_revision,lease_fingerprint:l.content_fingerprint,lease_state:l.state});
  const query=vi.fn(async(raw:string,values:unknown[]=[])=>{
    const sql=raw.replace(/\s+/g,' ').trim();calls.push({sql,values});
    if(sql==='BEGIN'){snapshot=structuredClone(db);return{rows:[]};}
    if(sql==='COMMIT'){snapshot=undefined;if(db.commitLost){db.commitLost=false;throw new Error('Synthetic committed response lost.');}return{rows:[]};}
    if(sql==='ROLLBACK'){if(snapshot){Object.assign(db,snapshot);snapshot=undefined;}return{rows:[]};}
    if(sql.startsWith('SELECT id FROM projects'))return{rows:values[0]===id(1)?[{id:id(1)}]:[]};
    if(sql.startsWith('SELECT is_admin FROM users'))return{rows:[{is_admin:db.admin}]};
    if(sql.startsWith('SELECT is_admin,pf_admin_revision'))return{rows:[{is_admin:db.admin,revision:db.adminRevision}]};
    if(sql.startsWith('SELECT pf_admin_revision'))return{rows:[{revision:db.adminRevision}]};
    if(sql.startsWith('INSERT INTO viewer_login_bindings'))return{rows:[]};
    if(sql.startsWith('SELECT user_id,expires_at,revoked_at FROM viewer_login_bindings'))return{rows:[{user_id:who.userId,expires_at:new Date(who.loginExpiresAt),revoked_at:null}]};
    if(sql.startsWith('SELECT installation_epoch FROM pf_installation_state'))return{rows:[{installation_epoch:db.installation}]};
    if(sql.startsWith('UPDATE pf_installation_state')){if(values[0]!==db.installation)return{rows:[]};db.installation=String(values[1]);return{rows:[{installation_epoch:db.installation}]};}
    if(sql.includes('FROM project_model_selections'))return{rows:[{active_model_version_id:id(6),selection_revision:db.modelRevision,state:'ready',health:'healthy',content_fingerprint:'b'.repeat(64)}]};
    if(sql.includes('FROM pf_calculation_grant_heads'))return{rows:values[0]===id(1)?[head()]:[]};
    if(sql.startsWith('SELECT request_sha256,request,receipt FROM pf_calculation_grant_commands')){const row=db.commands.get(String(values[2]));return{rows:row?[row]:[]};}
    if(sql.startsWith('SELECT count(*)::text AS count FROM pf_calculation_grant_commands'))return{rows:[{count:String(db.commands.size)}]};
    if(sql.startsWith('SELECT count(*)::text AS count FROM pf_calculation_grant_leases'))return{rows:[{count:String(db.leases.size)}]};
    if(sql.startsWith('INSERT INTO pf_calculation_grant_revisions')){const grant=structuredClone(values[8]) as CalculationGrant;db.grants.set(grant.grantRevision,grant);return{rows:[]};}
    if(sql.startsWith('UPDATE pf_calculation_grant_heads')){db.head={grantId:String(values[1]),revision:String(values[2]),epoch:String(values[3])};return{rows:[]};}
    if(sql.startsWith('INSERT INTO pf_calculation_grant_commands')){db.commands.set(String(values[2]),{request_sha256:values[3],request:structuredClone(values[4]),receipt:structuredClone(values[5])});return{rows:[]};}
    if(sql.startsWith('SELECT * FROM pf_calculation_grant_leases')){const row=db.leases.get(String(values[0]));return{rows:row?[row]:[]};}
    if(sql.startsWith('SELECT id,state,expires_at FROM pf_calculation_grant_leases')){const row=[...db.leases.values()].find(l=>l.installation_epoch===values[0]&&['active','quarantined'].includes(l.state));return{rows:row?[row]:[]};}
    if(sql.startsWith('INSERT INTO pf_calculation_grant_leases')){db.leases.set(String(values[0]),{id:values[0],project_id:values[1],grant_id:values[2],grant_revision:values[3],grant_epoch:values[4],installation_epoch:values[5],issuer_id:values[6],issuer_admin_revision:values[7],operation:values[8],model_version_id:values[9],selection_revision:values[10],content_fingerprint:values[11],owner_sha256:values[12],state:'active',created_at:values[13],expires_at:values[14],closed_at:null});return{rows:[]};}
    if(sql.startsWith('SELECT project_id,owner_sha256,state FROM pf_calculation_grant_leases')){const row=db.leases.get(String(values[0]));return{rows:row?[row]:[]};}
    if(sql.includes('FROM pf_calculation_grant_leases WHERE project_id=')){const row=db.leases.get(String(values[1]));return{rows:row&&row.project_id===values[0]?[leaseProjection(row)]:[]};}
    if(sql.startsWith('UPDATE pf_calculation_grant_leases SET state=')){const row=db.leases.get(String(values[0]));if(row){row.state=values[1];row.closed_at=values[1]==='released'?new Date():null;row.reason_code=values[2];}return{rows:[]};}
    return{rows:[]};
  });
  const c={query,release} as unknown as PoolClient,pool={connect:vi.fn(async()=>c)} as unknown as Pool;
  const command:CalculationGrantCommand={schemaVersion:'wfc.pf.calculation-grant-command.v1',action:'enable',expectedControlRevision:'0',idempotencyKey:id(7),reason:'Synthetic explicit grant activation.',preferences:{secondaryDistanceMeters:2,preferVerticalApproach:true},timeoutMilliseconds:60000};
  const afterCommand=vi.fn(async()=>undefined),repo=createCalculationGrantRepository(pool,{afterCommand}),ready=createCalculationGrantRepository(pool,{afterCommand,producerStatus:async()=>({status:'ready',reasonCode:null})});
  const claim=(g:CalculationGrant,change:Partial<CalculationGrantLeaseClaim>={}):CalculationGrantLeaseClaim=>({projectId:id(1),grantId:g.id,grantRevision:g.grantRevision,grantEpoch:g.grantEpoch,installationEpoch:g.installationEpoch,operation:'calculate',modelVersionId:id(6),selectionRevision:'3',contentFingerprint:'b'.repeat(64),...newCalculationGrantLeaseOwner(),...change});
  return{who,db,c,pool,calls,release,command,repo,ready,claim,afterCommand};
}
describe('explicit durable calculation grants and bounded execution owners',()=>{
  it.each(['active','quarantined'] as const)('fences a restored %s owner without claiming a join, then permits an explicitly re-enabled local grant',async state=>{
    const x=fixture(),firstGrant=(await x.ready.command(id(1),x.who,x.command)).context.grant!,authority=await x.ready.claim(x.claim(firstGrant));
    if(state==='quarantined')await x.ready.quarantine(authority,'ENGINE_SESSION_REAP_FAILED');
    const old=structuredClone(x.db.leases.get(authority.leaseId));await fenceCalculationGrantInstallation(x.pool,id(4),id(9));
    expect(x.db.leases.get(authority.leaseId)).toEqual(old);expect(old!.state).toBe(state);expect(old!.closed_at).toBeNull();
    await expect(requireCalculationGrantRevision(x.c,calculationGrantProvenance(authority))).rejects.toMatchObject({code:'CALCULATION_GRANT_RESTORE_FENCED'});
    const fresh=(await x.ready.command(id(1),x.who,{...x.command,expectedControlRevision:'1',idempotencyKey:id(11)})).context.grant!;
    await expect(x.ready.claim(x.claim(fresh))).resolves.toMatchObject({installationEpoch:id(9),grantRevision:'2'});
    expect(x.db.leases.get(authority.leaseId)).toEqual(old);
    await expect(x.ready.claim(x.claim(fresh))).rejects.toMatchObject({code:'CALCULATION_GRANT_LEASE_BUSY'});
  });
  it('starts disabled with no grant and honest unqualified producer, without inventing a login',async()=>{
    const x=fixture(),ctx=await x.repo.context(id(1),x.who);expect(ctx).toMatchObject({grant:null,controlRevision:'0',status:'disabled',producer:{status:'unqualified'}});expect(x.db.grants.size).toBe(0);expect(x.afterCommand).not.toHaveBeenCalled();
  });
  it('creates an exact immutable enabled revision but keeps an unqualified producer blocked',async()=>{
    const x=fixture(),receipt=await x.repo.command(id(1),x.who,x.command);expect(receipt.context).toMatchObject({controlRevision:'1',status:'blocked',grant:{enabled:true,issuerAdminRevision:'2',installationEpoch:id(4)}});
    expect(x.db.grants.size).toBe(1);expect(x.db.commands.size).toBe(1);expect(x.afterCommand).toHaveBeenCalledOnce();expect(x.calls.some(c=>/INSERT INTO.+viewer_login_bindings/.test(c.sql))).toBe(true); // Human management alone uses its real login.
    const persisted=[...x.db.grants.values()][0];expect(JSON.stringify(persisted)).not.toMatch(/loginId|ownerToken|leaseId|bearer/);
  });
  it('replays an exact command before stale CAS but rejects changed body with the same key',async()=>{
    const x=fixture(),first=await x.repo.command(id(1),x.who,x.command),replay=await x.repo.command(id(1),x.who,x.command);expect(replay).toEqual({...first,duplicate:true});expect(x.db.grants.size).toBe(1);expect(x.afterCommand).toHaveBeenCalledOnce();
    await expect(x.repo.command(id(1),x.who,{...x.command,reason:'Changed body.'})).rejects.toMatchObject({code:'CALCULATION_GRANT_IDEMPOTENCY_CONFLICT'});
  });
  it('refuses current-role loss even for an existing exact command receipt',async()=>{
    const x=fixture();await x.repo.command(id(1),x.who,x.command);x.db.admin=false;await expect(x.repo.command(id(1),x.who,x.command)).rejects.toMatchObject({code:'ADMIN_REQUIRED'});
  });
  it('keeps disable-before-first-enable a receipt-only no-op and never creates a grant',async()=>{
    const x=fixture(),{preferences:_p,timeoutMilliseconds:_t,...base}=x.command;const receipt=await x.repo.command(id(1),x.who,{...base,action:'disable'});expect(receipt.context.grant).toBeNull();expect(x.db.grants.size).toBe(0);expect(x.afterCommand).not.toHaveBeenCalled();
  });
  it('preserves committed unknown-ACK command for exact replay and discards its failed transport',async()=>{
    const x=fixture();x.db.commitLost=true;await expect(x.repo.command(id(1),x.who,x.command)).rejects.toMatchObject({code:'CALCULATION_GRANT_COMMIT_OUTCOME_UNKNOWN'});expect(x.release).toHaveBeenCalledWith(true);
    const replay=await x.repo.command(id(1),x.who,x.command);expect(replay.duplicate).toBe(true);expect(x.db.grants.size).toBe(1);expect(x.afterCommand).toHaveBeenCalledOnce();
  });
  it('claims one finite exact model operation and persists only a hash of its private owner',async()=>{
    const x=fixture(),g=(await x.ready.command(id(1),x.who,x.command)).context.grant!,input=x.claim(g),start=x.calls.length,authority=await x.ready.claim(input);
    expect(Date.parse(authority.leaseExpiresAt)-Date.now()).toBeLessThanOrEqual(900000);expect(x.db.leases.size).toBe(1);
    expect(x.db.leases.get(authority.leaseId)?.owner_sha256).toBe(calculationAuthorityOwnerHash(input.ownerToken));expect(JSON.stringify([...x.db.leases.values()])).not.toContain(input.ownerToken);
    expect(x.calls.slice(start).some(c=>c.sql.includes('viewer_login_bindings'))).toBe(false);
    expect(await x.ready.claim(input)).toEqual(authority);expect(x.db.leases.size).toBe(1);
  });
  it('refuses prepare without actual producer qualification while allowing qualified prepare',async()=>{
    const x=fixture(),g=(await x.repo.command(id(1),x.who,x.command)).context.grant!,input=x.claim(g,{operation:'prepare'});
    await expect(x.repo.claim(input)).rejects.toMatchObject({code:'MANAGED_PRODUCER_UNQUALIFIED'});expect(x.db.leases.size).toBe(0);
    expect((await x.ready.claim(input)).operation).toBe('prepare');
  });
  it('refuses another owner and never reassigns an expired or quarantined unjoined slot',async()=>{
    const x=fixture(),g=(await x.ready.command(id(1),x.who,x.command)).context.grant!,first=await x.ready.claim(x.claim(g));
    await expect(x.ready.claim(x.claim(g))).rejects.toMatchObject({code:'CALCULATION_GRANT_LEASE_BUSY'});
    x.db.leases.get(first.leaseId)!.expires_at=new Date(0);await expect(x.ready.claim(x.claim(g))).rejects.toMatchObject({code:'CALCULATION_GRANT_LEASE_RECOVERY_REQUIRED'});
    await x.ready.quarantine(first,'ENGINE_SESSION_REAP_FAILED');await expect(x.ready.claim(x.claim(g))).rejects.toMatchObject({code:'CALCULATION_GRANT_LEASE_QUARANTINED'});
    await x.ready.release(first);expect(x.db.leases.get(first.leaseId)!.state).toBe('released');await expect(x.ready.claim(x.claim(g))).resolves.toMatchObject({grantRevision:'1'});
  });
  it('rejects a replay lease whose claimed secret differs from the original owner',async()=>{
    const x=fixture(),g=(await x.ready.command(id(1),x.who,x.command)).context.grant!,input=x.claim(g);await x.ready.claim(input);
    await expect(x.ready.claim({...input,ownerToken:'c'.repeat(64)})).rejects.toMatchObject({code:'CALCULATION_GRANT_LEASE_FENCED'});
  });
  it('keeps grant history but refuses old grants after demotion/re-promotion and restore epoch fencing',async()=>{
    const x=fixture(),g=(await x.ready.command(id(1),x.who,x.command)).context.grant!,authority=await x.ready.claim(x.claim(g));
    x.db.adminRevision='4';expect((await x.repo.context(id(1),x.who)).status).toBe('revoked');await expect(requireCalculationGrantRevision(x.c,calculationGrantProvenance(authority))).rejects.toMatchObject({code:'CALCULATION_GRANT_ISSUER_REVOKED'});
    x.db.adminRevision='2';await fenceCalculationGrantInstallation(x.pool,id(4),id(9));expect((await x.repo.context(id(1),x.who)).status).toBe('restore-fenced');expect(x.db.grants.size).toBe(1);
  });
  it('disables through a new immutable epoch and rejects currentness of the previous grant',async()=>{
    const x=fixture(),g=(await x.ready.command(id(1),x.who,x.command)).context.grant!,authority=await x.ready.claim(x.claim(g));
    const receipt=await x.repo.command(id(1),x.who,{schemaVersion:x.command.schemaVersion,action:'disable',expectedControlRevision:'1',idempotencyKey:id(8),reason:'Explicit stop.'});
    expect(receipt.context).toMatchObject({controlRevision:'2',status:'disabled',grant:{enabled:false,grantEpoch:'2'}});expect(x.db.grants.size).toBe(2);
    await expect(requireCalculationGrantRevision(x.c,calculationGrantProvenance(authority))).rejects.toMatchObject({code:'CALCULATION_GRANT_REVOKED'});
    await x.repo.release(authority);expect(x.db.leases.get(authority.leaseId)!.state).toBe('released');
  });
});
