// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { migrations } from './registry.js';
import { assertDatabaseCompatible, migrateDatabase, validateLedger } from './runner.js';
import { assertBaselineShape } from './schemaInspection.js';

const ledger = migrations.map(({ version, name, checksum }) => ({ version, name, checksum, adopted: false }));

describe('explicit migrations and read-only startup compatibility', () => {
  it('checks a supported schema exclusively with SELECT statements', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ name: 'wfc_schema_migrations' }] }).mockResolvedValueOnce({ rows: ledger });
    await assertDatabaseCompatible({ query } as unknown as PoolClient);
    expect(query.mock.calls.every(([sql]) => /^SELECT /i.test(sql))).toBe(true);
  });

  it('refuses an unversioned schema without creating a ledger or running backfills', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ name: null }] });
    await expect(assertDatabaseCompatible({ query } as unknown as PoolClient)).rejects.toThrow('unversioned');
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('rejects changed, newer and missing migrations', async () => {
    expect(() => validateLedger([{ ...ledger[0], checksum: 'changed' }])).toThrow('changed migration');
    expect(() => validateLedger([...ledger, { version: 999, name: 'future', checksum: 'x', adopted: false }])).toThrow('Unsupported');
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ name: 'wfc_schema_migrations' }] }).mockResolvedValueOnce({ rows: ledger.slice(0, 1) });
    await expect(assertDatabaseCompatible({ query } as unknown as PoolClient)).rejects.toThrow('requires');
  });

  it('does not adopt a populated unversioned database without the explicit flag', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('to_regclass')) return { rows: [{ name: null }] };
      if (sql.includes('information_schema.columns')) return { rows: [{ table_name: 'legacy' }] };
      return { rows: [] };
    });
    const release = vi.fn();
    const connect = vi.fn().mockResolvedValue({ query, release });
    await expect(migrateDatabase({ connect } as unknown as Pool)).rejects.toThrow('--adopt-baseline');
    expect(query.mock.calls.some(([sql]) => /CREATE|INSERT|UPDATE|DELETE|BEGIN/.test(sql))).toBe(false);
    expect(release).toHaveBeenCalledOnce();
  });

  it('does not mistake an empty ledger for permission to re-run a populated legacy schema', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('to_regclass')) return { rows: [{ name: 'wfc_schema_migrations' }] };
      if (sql.includes('information_schema.columns')) return { rows: [{ table_name: 'legacy' }] };
      return { rows: [] };
    });
    const connect = vi.fn().mockResolvedValue({ query, release: vi.fn() });
    await expect(migrateDatabase({ connect } as unknown as Pool)).rejects.toThrow('--adopt-baseline');
    expect(query.mock.calls.some(([sql]) => /CREATE|INSERT|UPDATE|DELETE/.test(sql))).toBe(false);
  });

  it('fails baseline adoption when known columns or constraints are absent', () => {
    const expected = { columns: [{ table_name: 'cables', column_name: 'id', data_type: 'uuid', udt_name: 'uuid', is_nullable: 'NO' }], constraints: [] };
    expect(() => assertBaselineShape(expected, { columns: [], constraints: [] })).toThrow('cables.id');
  });

  it('rolls back a failed migration and never records it as applied', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('to_regclass')) return { rows: [{ name: 'wfc_schema_migrations' }] };
      if (sql.includes('SELECT version')) return { rows: ledger.slice(0, 1) };
      if (sql.includes('ALTER TABLE cable_types')) throw new Error('Injected DDL failure');
      return { rows: [] };
    });
    const release = vi.fn();
    const connect = vi.fn().mockResolvedValue({ query, release });
    await expect(migrateDatabase({ connect } as unknown as Pool)).rejects.toThrow('Injected DDL failure');
    expect(query).toHaveBeenCalledWith('ROLLBACK');
    expect(query).not.toHaveBeenCalledWith('COMMIT');
    expect(query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO wfc_schema_migrations'))).toBe(false);
    expect(release).toHaveBeenCalledOnce();
  });
});
