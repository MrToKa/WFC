// @vitest-environment node
import {describe,expect,it,vi} from 'vitest';
import type {Pool,PoolClient} from 'pg';
import {CALCULATION_GRANT_SQL,initializeCalculationGrantSchema} from './calculationGrantSchema.js';
describe('additive calculation grant schema contract',()=>{
  it('keeps issuer revision server-owned and advances it only on actual administrator transitions',()=>{
    expect(CALCULATION_GRANT_SQL).toContain("IF TG_OP='INSERT' THEN NEW.pf_admin_revision:=0");
    expect(CALCULATION_GRANT_SQL).toContain('NEW.pf_admin_revision:=OLD.pf_admin_revision');
    expect(CALCULATION_GRANT_SQL).toContain('IF NEW.is_admin IS DISTINCT FROM OLD.is_admin');
    expect(CALCULATION_GRANT_SQL).not.toContain('viewer_login_bindings');expect(CALCULATION_GRANT_SQL).not.toMatch(/INSERT INTO pf_calculation_grant_revisions/);
  });
  it('bounds and fences lease identity, owner hashes and global/project admission without expiry-based automatic reuse',()=>{
    expect(CALCULATION_GRANT_SQL).toContain("expires_at<=created_at+interval '15 minutes'");
    expect(CALCULATION_GRANT_SQL).toContain('DROP INDEX IF EXISTS pf_calculation_grant_one_global_lease');
    expect(CALCULATION_GRANT_SQL).toContain('DROP INDEX IF EXISTS pf_calculation_grant_one_project_lease');
    expect(CALCULATION_GRANT_SQL).toContain("pf_calculation_grant_one_installation_lease ON pf_calculation_grant_leases(installation_epoch) WHERE state IN('active','quarantined')");
    expect(CALCULATION_GRANT_SQL).toContain("pf_calculation_grant_one_project_installation_lease ON pf_calculation_grant_leases(project_id,installation_epoch) WHERE state IN('active','quarantined')");
    expect(CALCULATION_GRANT_SQL).toContain("owner_sha256 text NOT NULL CHECK(owner_sha256~'^[a-f0-9]{64}$')");expect(CALCULATION_GRANT_SQL).not.toContain('owner_token');
    expect(CALCULATION_GRANT_SQL).toContain("to_jsonb(OLD)-ARRAY['state','closed_at','reason_code']");
    expect(CALCULATION_GRANT_SQL).toContain('FOREIGN KEY(project_id,grant_id,grant_revision)');expect(CALCULATION_GRANT_SQL).toContain('FOREIGN KEY(project_id,model_version_id)');
  });
  it('initializes without rotating an existing installation or enabling a grant',async()=>{
    const calls:Array<{sql:string;values:unknown[]}>=[],release=vi.fn(),query=vi.fn(async(sql:string,values:unknown[]=[])=>{calls.push({sql,values});return{rows:[]};});
    const c={query,release} as unknown as PoolClient,pool={connect:vi.fn(async()=>c)} as unknown as Pool;await initializeCalculationGrantSchema(pool);
    expect(calls[0].sql).toBe('BEGIN');const seed=calls.find(call=>call.sql.startsWith('INSERT INTO pf_installation_state'))!;
    expect(seed.sql).toContain('ON CONFLICT(singleton) DO NOTHING');expect(seed.values[0]).toMatch(/^[a-f0-9-]{36}$/);expect(calls.at(-1)?.sql).toBe('COMMIT');
    expect(calls.some(call=>call.sql.startsWith('UPDATE pf_installation_state'))).toBe(false);
  });
});
