import type { Pool, PoolClient } from 'pg';
import { migrations, loadBaselineShape, type Migration } from './registry.js';
import { assertBaselineShape, inspectSchema, type Queryable } from './schemaInspection.js';

const MIGRATION_LOCK = 'wfc-schema-migrations-v1';
type LedgerRow = { version: number; name: string; checksum: string; adopted: boolean };

export const readLedger = async (client: Queryable): Promise<LedgerRow[] | null> => {
  const exists = await client.query<{ name: string | null }>("SELECT to_regclass('public.wfc_schema_migrations')::text AS name");
  if (!exists.rows[0]?.name) return null;
  const rows = await client.query<LedgerRow>('SELECT version, name, checksum, adopted FROM wfc_schema_migrations ORDER BY version');
  return rows.rows;
};

export const validateLedger = (rows: LedgerRow[], known: Migration[] = migrations): void => {
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const migration = known[index];
    if (!migration || row.version !== migration.version || row.name !== migration.name || row.checksum !== migration.checksum) {
      throw new Error(`Unsupported or changed migration at version ${row.version}. Use the matching application release; never edit an applied migration.`);
    }
  }
};

/** Compatibility only: this function executes SELECTs, never DDL/backfills. */
export const assertDatabaseCompatible = async (client: Queryable): Promise<void> => {
  const ledger = await readLedger(client);
  if (!ledger) throw new Error('WFC schema is unversioned. Back up the database and run npm run db:migrate -- --adopt-baseline explicitly.');
  validateLedger(ledger);
  if (ledger.length !== migrations.length) {
    throw new Error(`WFC schema version ${ledger.at(-1)?.version ?? 0} requires ${migrations.at(-1)?.version}. Run the explicit migration command before starting this release.`);
  }
};

export const migrateDatabase = async (
  pool: Pick<Pool, 'connect'>,
  options: { adoptBaseline?: boolean; onProgress?: (message: string) => void } = {},
): Promise<{ applied: number[]; adopted: boolean }> => {
  const client: PoolClient = await pool.connect();
  const applied: number[] = [];
  let adopted = false;
  let locked = false;
  try {
    await client.query("SET lock_timeout = '10s'");
    await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [MIGRATION_LOCK]);
    locked = true;
    let ledger = await readLedger(client);
    if (!ledger || ledger.length === 0) {
      const shape = await inspectSchema(client);
      const populated = shape.columns.length > 0;
      if (populated && !options.adoptBaseline) {
        throw new Error('Existing unversioned database: back up and inspect it, then explicitly pass --adopt-baseline. Legacy startup SQL will not be executed.');
      }
      if (populated) assertBaselineShape(loadBaselineShape(), shape);
      await client.query('BEGIN');
      try {
        await client.query(`CREATE TABLE IF NOT EXISTS wfc_schema_migrations (
          version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL,
          adopted BOOLEAN NOT NULL DEFAULT FALSE, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
        if (populated) {
          const baseline = migrations[0];
          await client.query('INSERT INTO wfc_schema_migrations (version,name,checksum,adopted) VALUES ($1,$2,$3,TRUE)',
            [baseline.version, baseline.name, baseline.checksum]);
          adopted = true;
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      ledger = await readLedger(client);
    }
    validateLedger(ledger ?? []);
    for (const migration of migrations.slice(ledger?.length ?? 0)) {
      options.onProgress?.(`Applying ${migration.version}: ${migration.name}`);
      await client.query('BEGIN');
      try {
        await migration.apply(client);
        await client.query('INSERT INTO wfc_schema_migrations (version,name,checksum) VALUES ($1,$2,$3)',
          [migration.version, migration.name, migration.checksum]);
        await client.query('COMMIT');
        applied.push(migration.version);
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
    }
    return { applied, adopted };
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [MIGRATION_LOCK]).catch(() => undefined);
    await client.query('RESET lock_timeout').catch(() => undefined);
    client.release();
  }
};
