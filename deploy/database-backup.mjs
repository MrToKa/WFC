import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from 'dotenv';

const container = process.argv[2];
if (!container || !/^[A-Za-z0-9_.-]+$/.test(container)) throw new Error('Usage: npm run db:backup -- <verified-postgres-container>');
const env = parse(readFileSync('server/.env'));
const target = new URL(env.DATABASE_URL);
const database = decodeURIComponent(target.pathname.slice(1));
if (!database) throw new Error('No configured database');
const run = (args) => {
  const result = spawnSync('docker', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Docker backup command failed (exit ${result.status}). Check the verified container and database access.`);
  return result.stdout;
};
const inspection = JSON.parse(run(['inspect', container]))[0];
const port = inspection.NetworkSettings.Ports['5432/tcp'] ?? [];
if (!['localhost', '127.0.0.1'].includes(target.hostname) || !port.some((binding) => binding.HostPort === (target.port || '5432'))) {
  throw new Error('Configured DB endpoint does not match the selected local container published port; verify target manually.');
}
const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const filename = `${database.replace(/[^A-Za-z0-9_.-]/g, '_')}-${stamp}.dump`;
const directory = path.resolve('.data/backups');
mkdirSync(directory, { recursive: true });
run(['exec', container, 'pg_dump', '--username', decodeURIComponent(target.username), '--dbname', database,
  '--format=custom', '--file', `/tmp/${filename}`]);
const output = path.join(directory, filename);
run(['cp', `${container}:/tmp/${filename}`, output]);
const manifest = { capturedAt: new Date().toISOString(), container, database, host: target.hostname,
  port: target.port || '5432', bytes: statSync(output).size,
  sha256: createHash('sha256').update(readFileSync(output)).digest('hex'),
  volumeTargets: inspection.Mounts.map(({ Type, Name, Destination }) => ({ type: Type, name: Name || null, destination: Destination })),
};
writeFileSync(`${output}.json`, JSON.stringify(manifest, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ backup: output, database, bytes: manifest.bytes, sha256: manifest.sha256 }));
