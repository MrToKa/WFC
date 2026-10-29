// @vitest-environment node
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { ENDPOINT_BINDING_SQL, initializeEndpointBindingSchema } from './endpointBindingSchema.js';

describe('additive endpoint binding schema initialization', () => {
  it('serializes additive migration and leaves all legacy values untouched', async () => {
    const statements: string[] = [], query = vi.fn(async (sql: string) => { statements.push(sql); return { rows: [] }; }), release = vi.fn();
    await initializeEndpointBindingSchema({ connect: async () => ({ query, release }) } as unknown as Pool);
    expect(statements[0]).toBe('BEGIN'); expect(statements[1]).toContain("pg_advisory_xact_lock(hashtext('wfc-purpose-policy-schema-v1'))"); expect(statements.at(-1)).toBe('COMMIT');
    expect(ENDPOINT_BINDING_SQL).not.toMatch(/(?:UPDATE|DELETE FROM|INSERT INTO)\s+(?:cables|pf_locations|pf_location_bindings|pf_artifacts|pf_preparation_aggregates)/i);
    expect(statements.filter(s => s.includes('CREATE TRIGGER'))).toHaveLength(4); expect(release).toHaveBeenCalledExactlyOnceWith(undefined);
  });
  it('protects exact project/location identity of a mutable head and monotonically versioned immutable revisions', () => {
    expect(ENDPOINT_BINDING_SQL).toContain('PRIMARY KEY(project_id,location_id)'); expect(ENDPOINT_BINDING_SQL).toContain('UNIQUE(project_id,location_id,binding_revision)');
    expect(ENDPOINT_BINDING_SQL).toContain('FOREIGN KEY(project_id,location_id,binding_id) REFERENCES pf_endpoint_binding_revisions(project_id,location_id,id)');
    expect(ENDPOINT_BINDING_SQL).toContain('FOREIGN KEY(project_id,trace_id,object_revision_id) REFERENCES pf_geometry_object_revisions(project_id,trace_id,id)');
    expect(ENDPOINT_BINDING_SQL).toContain("TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id)");
  });
  it.each(['ddl', 'rollback', 'commit'] as const)('retains failures and discards only uncertain %s connections', async phase => {
    const query = vi.fn(async (sql: string) => { if (phase !== 'commit' && sql === ENDPOINT_BINDING_SQL || phase === 'rollback' && sql === 'ROLLBACK' || phase === 'commit' && sql === 'COMMIT') throw Error('private transport detail'); return { rows: [] }; }), release = vi.fn();
    await expect(initializeEndpointBindingSchema({ connect: async () => ({ query, release }) } as unknown as Pool)).rejects.toThrow('private transport detail');
    expect(query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true); expect(release).toHaveBeenCalledExactlyOnceWith(phase === 'ddl' ? undefined : true);
  });
});
