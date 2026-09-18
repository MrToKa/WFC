// @vitest-environment node
import type { Pool, PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../db.js', () => ({ pool: {} }));
import { createMaterialAuditPool } from './materialAuditPool.js';
import { materialAuditActor } from './materialAuditContext.js';

const setup = () => {
  const client = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() };
  const base = {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    connect: vi.fn().mockResolvedValue(client),
  };
  return { client, base, audit: createMaterialAuditPool(base as unknown as Pool) };
};

describe('material audit connection scope', () => {
  it('persists actor and mutation in one transaction and releases the connection', async () => {
    const { client, audit } = setup();
    await materialAuditActor.run('user-1', () =>
      audit.query('UPDATE material_trays SET unit_price = $1', [2]),
    );
    expect(client.query.mock.calls).toEqual([
      ['BEGIN'],
      ["SELECT set_config('wfc.material_actor', $1, true)", ['user-1']],
      ['UPDATE material_trays SET unit_price = $1', [2]],
      ['COMMIT'],
    ]);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('rolls back failed edits and releases the connection', async () => {
    const { client, audit } = setup();
    client.query.mockImplementation(async (sql: string) => {
      if (sql === 'UPDATE bad') throw new Error('Failed');
      return { rows: [] };
    });
    await expect(materialAuditActor.run('user-1', () => audit.query('UPDATE bad'))).rejects.toThrow(
      'Failed',
    );
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('uses transaction-local identity for existing import transactions', async () => {
    const { client, audit } = setup();
    await materialAuditActor.run('importer', async () => {
      const connection: PoolClient = await audit.connect();
      await connection.query('BEGIN');
      await connection.query('INSERT INTO material_trays ...');
      await connection.query('COMMIT');
      connection.release();
    });
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN',
      "SELECT set_config('wfc.material_actor', $1, true)",
      'INSERT INTO material_trays ...',
      'COMMIT',
    ]);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('does not retain an actor for subsequent unscoped operations', async () => {
    const { client, base, audit } = setup();
    await materialAuditActor.run('user-1', () => audit.query('UPDATE first'));
    await audit.query('SELECT 1');
    expect(base.query).toHaveBeenCalledWith('SELECT 1');
    expect(client.query).toHaveBeenCalledTimes(4);
  });
});
