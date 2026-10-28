// @vitest-environment node
import {afterEach,describe,expect,it,vi} from 'vitest';
import type {Pool,PoolClient} from 'pg';
import {CALCULATION_GRANT_OPERATIONS,calculationGrantSchema} from '../../shared/pathfinderCalculationGrant.js';
import {calculationAuthorityOwnerHash,calculationGrantRecordHash,calculationGrantProvenance,requireCalculationGrant,requireCalculationGrantRevision,grantTransaction,type CalculationGrantAuthority} from './calculationAuthority.js';
const id=(n:number)=>`da800000-0000-4000-8000-${String(n).padStart(12,'0')}`;
type Row=Record<string,any>;
function fixture(){
  const grant=calculationGrantSchema.parse({schemaVersion:'wfc.pf.calculation-grant.v1',projectId:id(1),id:id(2),grantRevision:'1',grantEpoch:'1',installationEpoch:id(3),enabled:true,enabledBy:id(4),enabledAt:new Date().toISOString(),updatedAt:new Date().toISOString(),issuerAdminRevision:'2',scope:'active-model',operations:[...CALCULATION_GRANT_OPERATIONS],limitsProfile:'local-bounded-v1',preferences:{secondaryDistanceMeters:2,preferVerticalApproach:true},timeoutMilliseconds:60000});
  const authority:CalculationGrantAuthority={kind:'calculation-grant',projectId:id(1),grantId:id(2),grantRevision:'1',grantEpoch:'1',installationEpoch:id(3),issuerId:id(4),issuerAdminRevision:'2',leaseId:id(5),ownerToken:'a'.repeat(64),leaseExpiresAt:new Date(Date.now()+60000).toISOString(),operation:'calculate',modelVersionId:id(6),selectionRevision:'3',contentFingerprint:'b'.repeat(64)};
  const db={issuer:{is_admin:true,revision:'2'},installation:{installation_epoch:id(3)},model:{active_model_version_id:id(6),selection_revision:'3',state:'ready',health:'healthy',content_fingerprint:'b'.repeat(64)},
    grant:{project_id:id(1),id:id(2),grant_revision:'1',grant_epoch:'1',installation_epoch:id(3),issuer_id:id(4),issuer_admin_revision:'2',record:grant,record_sha256:calculationGrantRecordHash(grant),head_revision:'1',head_epoch:'1',grant_id:id(2)} as Row,
    lease:{project_id:id(1),grant_id:id(2),lease_revision:'1',lease_epoch:'1',lease_installation:id(3),lease_issuer:id(4),lease_admin_revision:'2',operation:'calculate',model_version_id:id(6),lease_selection:'3',lease_fingerprint:'b'.repeat(64),owner_sha256:calculationAuthorityOwnerHash(authority.ownerToken),lease_state:'active',expires_at:authority.leaseExpiresAt} as Row,commitLost:false};
  const calls:string[]=[],release=vi.fn(),query=vi.fn(async(sql:string,_values?:unknown[])=>{
    calls.push(sql.replace(/\s+/g,' ').trim());if(sql==='COMMIT'&&db.commitLost)throw new Error('Synthetic lost COMMIT response.');
    if(sql.startsWith('SELECT id FROM projects'))return{rows:[{id:id(1)}]};
    if(sql.includes('FROM users WHERE id='))return{rows:[db.issuer]};if(sql.includes('FROM project_model_selections'))return{rows:[db.model]};
    if(sql.includes('FROM pf_installation_state'))return{rows:[db.installation]};if(sql.includes('FROM pf_calculation_grant_heads'))return{rows:[db.grant]};
    if(sql.includes('FROM pf_calculation_grant_leases'))return{rows:[db.lease]};return{rows:[]};
  });
  const c={query,release} as unknown as PoolClient,pool={connect:vi.fn(async()=>c)} as unknown as Pool;return{grant,authority,db,c,pool,query,calls,release};
}
afterEach(()=>vi.useRealTimers());
describe('grant authority boundaries with mocked caller-owned SQL',()=>{
  it('keeps persistent grant authority valid after its finite execution lease expires',async()=>{
    const x=fixture(),expired={...x.authority,leaseExpiresAt:new Date(0).toISOString()};
    await expect(requireCalculationGrantRevision(x.c,calculationGrantProvenance(expired),{lock:true})).resolves.toEqual(x.grant);
    expect(x.calls.some(sql=>sql.includes('pf_calculation_grant_leases'))).toBe(false);
    await expect(requireCalculationGrant(x.c,expired,'calculate')).rejects.toMatchObject({code:'CALCULATION_GRANT_LEASE_EXPIRED'});
  });
  it('checks the exact current issuer revision so demotion then re-promotion cannot revive a grant',async()=>{
    const x=fixture();x.db.issuer.revision='4';
    await expect(requireCalculationGrantRevision(x.c,calculationGrantProvenance(x.authority))).rejects.toMatchObject({code:'CALCULATION_GRANT_ISSUER_REVOKED'});
    expect(x.calls.some(sql=>sql.includes('pf_calculation_grant_heads'))).toBe(false);
  });
  it.each(['role','head-revision','head-epoch','installation','disabled','body-hash'] as const)('refuses changed persistent %s authority',async change=>{
    const x=fixture();if(change==='role')x.db.issuer.is_admin=false;if(change==='head-revision')x.db.grant.head_revision='2';if(change==='head-epoch')x.db.grant.head_epoch='2';
    if(change==='installation')x.db.installation.installation_epoch=id(9);if(change==='disabled'){x.db.grant.record={...x.grant,enabled:false};x.db.grant.record_sha256=calculationGrantRecordHash(x.db.grant.record);}if(change==='body-hash')x.db.grant.record_sha256='f'.repeat(64);
    await expect(requireCalculationGrantRevision(x.c,calculationGrantProvenance(x.authority),{lock:true})).rejects.toBeDefined();
  });
  it.each(['operation','owner','model','selection','fingerprint','quarantined','expiry-identity','grant-epoch'] as const)('refuses changed finite execution %s identity',async change=>{
    const x=fixture();if(change==='operation')x.db.lease.operation='prepare';if(change==='owner')x.db.lease.owner_sha256='c'.repeat(64);if(change==='model')x.db.model.active_model_version_id=id(9);
    if(change==='selection')x.db.model.selection_revision='4';if(change==='fingerprint')x.db.model.content_fingerprint='c'.repeat(64);if(change==='quarantined')x.db.lease.lease_state='quarantined';if(change==='expiry-identity')x.db.lease.expires_at=new Date(Date.now()+30000).toISOString();if(change==='grant-epoch')x.db.lease.lease_epoch='2';
    await expect(requireCalculationGrant(x.c,x.authority,'calculate',{lock:true})).rejects.toBeDefined();
  });
  it('rejects authority for a different operation before SQL and never creates a human login',async()=>{
    const x=fixture();await expect(requireCalculationGrant(x.c,x.authority,'prepare')).rejects.toMatchObject({code:'CALCULATION_GRANT_OPERATION_DENIED'});expect(x.query).not.toHaveBeenCalled();
    await requireCalculationGrant(x.c,x.authority,'calculate',{lock:true});expect(x.calls.join('\n')).not.toContain('viewer_login_bindings');
  });
  it('holds project/issuer first and takes final grant/lease locks only after callback input locks',async()=>{
    const x=fixture();await expect(grantTransaction(x.pool,x.authority,'calculate',async c=>{await c.query('SYNTHETIC INPUT LOCK');return 42;})).resolves.toBe(42);
    const project=x.calls.findIndex(sql=>sql.startsWith('SELECT id FROM projects')),issuer=x.calls.findIndex(sql=>sql.includes('FROM users')&&sql.endsWith('FOR SHARE')),
      input=x.calls.indexOf('SYNTHETIC INPUT LOCK'),head=x.calls.findIndex(sql=>sql.includes('FROM pf_calculation_grant_heads')&&sql.endsWith('FOR SHARE OF h,r'));
    expect(project).toBeGreaterThan(0);expect(issuer).toBeGreaterThan(project);expect(input).toBeGreaterThan(issuer);expect(head).toBeGreaterThan(input);expect(x.calls.at(-1)).toBe('COMMIT');expect(x.release).toHaveBeenCalledWith(undefined);
  });
  it('rolls back provisional callback writes if the epoch changes before final guard',async()=>{
    const x=fixture();await expect(grantTransaction(x.pool,x.authority,'calculate',async c=>{await c.query('SYNTHETIC PROVISIONAL WRITE');x.db.grant.head_epoch='2';})).rejects.toMatchObject({code:'CALCULATION_GRANT_REVOKED'});
    expect(x.calls.at(-1)).toBe('ROLLBACK');expect(x.calls).not.toContain('COMMIT');
  });
  it('rolls back expiration after callback and does not extend lease authority',async()=>{
    vi.useFakeTimers();const x=fixture();await expect(grantTransaction(x.pool,x.authority,'calculate',async()=>{vi.setSystemTime(new Date(Date.parse(x.authority.leaseExpiresAt)+1));})).rejects.toMatchObject({code:'CALCULATION_GRANT_LEASE_EXPIRED'});
    expect(x.calls.at(-1)).toBe('ROLLBACK');expect(x.calls.some(sql=>/UPDATE.+expires_at/i.test(sql))).toBe(false);
  });
  it('reports unknown COMMIT and discards transport without returning a false receipt',async()=>{
    const x=fixture();x.db.commitLost=true;await expect(grantTransaction(x.pool,x.authority,'calculate',async()=>42)).rejects.toMatchObject({code:'CALCULATION_GRANT_COMMIT_OUTCOME_UNKNOWN'});expect(x.release).toHaveBeenCalledWith(true);
  });
  it('rolls back cancellation rather than publishing the callback result',async()=>{
    const x=fixture(),controller=new AbortController();await expect(grantTransaction(x.pool,x.authority,'calculate',async()=>controller.abort(),controller.signal)).rejects.toBeDefined();expect(x.calls.at(-1)).toBe('ROLLBACK');expect(x.calls).not.toContain('COMMIT');
  });
});
