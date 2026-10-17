import { Pool } from 'pg';
import { pathToFileURL } from 'node:url';
import { createModelStorage } from '../modelRegistry/storage.js';
import { inventory, auditModels, fenceRestored, recoveryReport } from './service.js';

export async function main(args: string[]): Promise<void> {
  const [command, ...flags] = args;
  if (!['inventory', 'fence-restored', 'audit-models', 'recover'].includes(command) || flags.some(flag => flag !== '--apply') || flags.length > 1 || flags.length && command !== 'recover') throw Error('INVALID_OPERATION');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 15_000, query_timeout: 120_000 });
  pool.on('error', () => { /* Command reports only bounded safe failure codes. */ });
  try {
    const result = command === 'inventory' ? await inventory(pool) : command === 'fence-restored' ? await fenceRestored(pool, process.env) : command === 'audit-models' ? await auditModels(pool, createModelStorage(), AbortSignal.timeout(30 * 60_000)) : await recoveryReport(pool, process.env.WFC_MODEL_IMPORT_ROOT ?? '/var/lib/wfc/model-imports', createModelStorage(), flags.includes('--apply'), process.env);
    process.stdout.write(JSON.stringify(result) + '\n');
    if (result.status !== 'PASS') process.exitCode = 1;
  } finally { await pool.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(() => {
    process.stdout.write(JSON.stringify({ schemaVersion: 1, status: 'FAIL', code: 'OPERATION_REFUSED_OR_FAILED', detail: 'Check private operator configuration, target ownership, resource integrity and service availability.' }) + '\n');
    process.exitCode = 1;
  });
}
