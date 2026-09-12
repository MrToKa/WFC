import { pool } from '../db.js';
import { assertDatabaseCompatible, migrateDatabase, readLedger } from './runner.js';

const args = new Set(process.argv.slice(2));
try {
  if ([...args].some((arg) => !['--adopt-baseline', '--check', '--status'].includes(arg))) {
    throw new Error('Usage: npm run db:migrate -- [--adopt-baseline | --check | --status]');
  }
  const target = await pool.query<{ database: string; version: string }>('SELECT current_database() AS database, current_setting(\'server_version\') AS version');
  console.log('Migration target:', target.rows[0]);
  if (args.has('--check')) {
    await assertDatabaseCompatible(pool);
    console.log('Schema compatible. No writes performed.');
  } else if (args.has('--status')) {
    console.log({ ledger: await readLedger(pool) });
  } else {
    console.log(await migrateDatabase(pool, { adoptBaseline: args.has('--adopt-baseline'), onProgress: console.log }));
  }
} catch (error) {
  // Do not dump configuration or connection strings on a failed invocation.
  console.error(error instanceof Error ? error.message : 'Migration failed');
  process.exitCode = 1;
} finally {
  await pool.end();
}
