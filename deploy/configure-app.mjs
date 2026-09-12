import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'dotenv';

const env = parse(readFileSync('server/.env'));
if (!env.DATABASE_URL) throw new Error('server/.env must configure DATABASE_URL');
const target = new URL(env.DATABASE_URL);
if (['localhost', '127.0.0.1', '::1'].includes(target.hostname)) target.hostname = 'host.docker.internal';
const storageEndpoint = ['localhost', '127.0.0.1', '::1'].includes(env.MINIO_ENDPOINT ?? 'localhost')
  ? 'host.docker.internal' : env.MINIO_ENDPOINT;
const values = { DATABASE_URL: target.toString(), MINIO_ENDPOINT: storageEndpoint };
const quote = (value) => `'${String(value).replaceAll("'", "\\'")}'`;
mkdirSync('.data/deployment', { recursive: true });
// Never overwrite operator settings; edit the generated file deliberately later.
writeFileSync('.data/deployment/app.env', Object.entries(values).map(([key, value]) => `${key}=${quote(value)}\n`).join(''), { flag: 'wx', mode: 0o600 });
console.log('Created ignored .data/deployment/app.env with container-accessible endpoints. Credentials were not printed.');
