// @vitest-environment node
import { Pool, type PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initializeMaterialIdentity, materialIdentityTables } from './materialIdentitySchema.js';

// Every object is isolated in a newly created test schema, never the application's schema.
const url = process.env.WFC_MATERIAL_IDENTITY_TEST_DATABASE_URL;
describe.skipIf(!url)('material identity database constraints', () => {
  let pool: Pool;
  let client: PoolClient;
  let migrationPool: Pool;
  const schema = `material_identity_test_${randomUUID().replaceAll('-', '')}`;
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 3, options: `-c search_path=${schema}` });
    await pool.query(`CREATE SCHEMA ${schema}`);
    client = await pool.connect();
    migrationPool = {
      connect: async () => ({ query: client.query.bind(client), release: () => {} }),
    } as unknown as Pool;
    for (const table of materialIdentityTables) {
      const field = table === 'material_cable_types' ? 'name' : 'type';
      await client.query(`CREATE TABLE ${table} (
        id SERIAL PRIMARY KEY, ${field} TEXT NOT NULL, manufacturer TEXT, part_no TEXT
      ); CREATE UNIQUE INDEX ${table}_${field}_lower_idx ON ${table} (LOWER(${field}));`);
    }
  });
  afterAll(async () => {
    client?.release();
    await pool?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool?.end();
  });

  it('starts with legacy duplicates intact and prevents new duplicates', async () => {
    await client.query(`INSERT INTO material_instruments (type, manufacturer, part_no)
      VALUES ('First', 'Legacy', 'L1'), ('Second', ' legacy ', 'l1')`);
    await initializeMaterialIdentity(migrationPool);
    await expect(
      client.query(
        `INSERT INTO material_instruments (type, manufacturer, part_no) VALUES ('Third', 'Legacy', 'L1')`,
      ),
    ).rejects.toMatchObject({ code: '23505' });
    expect(
      (await client.query('SELECT COUNT(*)::int AS count FROM material_instruments')).rows[0].count,
    ).toBe(2);
    await client.query(
      "UPDATE material_instruments SET type = 'Updated legacy' WHERE type = 'First'",
    );
  });

  it('migrates existing tables and can run again after repeated Types are saved', async () => {
    await initializeMaterialIdentity(migrationPool);
    for (const table of materialIdentityTables) {
      const field = table === 'material_cable_types' ? 'name' : 'type';
      await client.query(`INSERT INTO ${table} (${field}, manufacturer, part_no)
        VALUES ('Sensor', 'ABB', 'A1'), ('Sensor', 'ABB', 'A2'), ('Sensor', 'Other', 'A1')`);
      await expect(
        client.query(`INSERT INTO ${table} (${field}, manufacturer, part_no)
        VALUES ('Different type', ' abb ', 'a1')`),
      ).rejects.toMatchObject({ code: '23505' });
      await expect(
        client.query(`UPDATE ${table} SET part_no = 'A1' WHERE part_no = 'A2'`),
      ).rejects.toMatchObject({ code: '23505' });
      await client.query(`INSERT INTO ${table} (${field}, manufacturer, part_no)
        VALUES ('Sensor', NULL, NULL), ('Sensor', NULL, NULL), ('Sensor', '', '')`);
    }
    await initializeMaterialIdentity(migrationPool);
  });

  it('rejects concurrent duplicate inserts in a conflicted catalog', async () => {
    const first = await pool.connect();
    const second = await pool.connect();
    try {
      await first.query('BEGIN');
      await first.query(`INSERT INTO material_instruments (type, manufacturer, part_no)
        VALUES ('Concurrent', 'ABB', 'Concurrent')`);
      const competing = second
        .query(
          `INSERT INTO material_instruments (type, manufacturer, part_no)
        VALUES ('Concurrent', 'ABB', 'Concurrent')`,
        )
        .then(
          () => null,
          (error: { code: string }) => error.code,
        );
      await first.query('COMMIT');
      expect(await competing).toBe('23505');
    } finally {
      await first.query('ROLLBACK');
      first.release();
      second.release();
    }
  });

  it('preserves references and frees active identities when obsolete, then upgrades to an index', async () => {
    await client.query(`CREATE TABLE material_references (material_id INTEGER REFERENCES material_instruments(id));
      INSERT INTO material_references SELECT id FROM material_instruments WHERE type = 'Updated legacy'`);
    await client.query("UPDATE material_instruments SET part_no = 'L2' WHERE type = 'Second'");
    await expect(
      client.query("DELETE FROM material_instruments WHERE type = 'Updated legacy'"),
    ).rejects.toMatchObject({ code: '23514' });
    await client.query(
      "UPDATE material_instruments SET obsolete_at = NOW() WHERE type = 'Updated legacy'",
    );
    expect(
      (
        await client.query(`SELECT 1 FROM material_references r
      JOIN material_instruments m ON m.id = r.material_id WHERE m.obsolete_at IS NOT NULL`)
      ).rows,
    ).toHaveLength(1);
    await client.query(`INSERT INTO material_instruments (type, manufacturer, part_no)
      VALUES ('Replacement', 'Legacy', 'L1')`);
    await initializeMaterialIdentity(migrationPool);
    const triggers = await client.query(`SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'material_instruments'::regclass AND tgname = 'material_product_identity_guard'`);
    expect(triggers.rows).toHaveLength(0);
    await expect(
      client.query(`INSERT INTO material_instruments (type, manufacturer, part_no)
      VALUES ('Duplicate', 'Legacy', 'L1')`),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      client.query(
        "UPDATE material_instruments SET obsolete_at = NULL WHERE type = 'Updated legacy'",
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });
});
