import fs from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repository = fileURLToPath(new URL('../../', import.meta.url));
export const origin = 'http://127.0.0.1:5181';
export const statePath = path.join(repository, '.data', 'poc-state.json');
export function assertPocTarget() {
  const [container] = JSON.parse(execFileSync('docker', ['inspect', 'wfc-aalborg-poc-api-1'], { encoding: 'utf8' }));
  const env = Object.fromEntries(container.Config.Env.map(line => {
    const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)];
  }));
  if (container.Config.Labels['com.docker.compose.project'] !== 'wfc-aalborg-poc' ||
      env.WFC_CAD_ISOLATED_STACK !== 'true' || env.WFC_CAD_DESIGN_ENABLED !== 'true' ||
      new URL(env.DATABASE_URL).pathname !== '/wfc_poc' ||
      env.MINIO_BUCKET_PROJECTS !== 'wfc-poc-project-files') throw new Error('Not the isolated PoC target.');
}
export async function credentials() {
  const filename = path.join(repository, '.env.poc');
  const text = await fs.readFile(filename, 'utf8');
  const env = Object.fromEntries(text.split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => {
    const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)];
  }));
  if (!env.POC_ADMIN_EMAIL || !env.POC_ADMIN_PASSWORD) {
    env.POC_ADMIN_EMAIL = 'aalborg-poc@local.invalid';
    env.POC_ADMIN_PASSWORD = process.env.POC_ADMIN_PASSWORD || randomBytes(24).toString('hex');
    await fs.appendFile(filename, `POC_ADMIN_EMAIL=${env.POC_ADMIN_EMAIL}\nPOC_ADMIN_PASSWORD=${env.POC_ADMIN_PASSWORD}\n`);
  }
  return { email: env.POC_ADMIN_EMAIL, password: env.POC_ADMIN_PASSWORD };
}
export async function login({ create = false } = {}) {
  assertPocTarget();
  const body = await credentials();
  let response = await fetch(origin + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (response.status === 401 && create) {
    response = await fetch(origin + '/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, firstName: 'Aalborg', lastName: 'PoC' }),
    });
  }
  if (!response.ok) throw new Error('PoC login failed HTTP ' + response.status);
  const identity = await response.json();
  if (!identity.user.isAdmin) throw new Error('PoC acceptance requires its own administrator.');
  return identity;
}
export async function api(token, route, init = {}) {
  if (!route.startsWith('/api/') || route.includes('..')) throw new Error('Invalid PoC API path.');
  const response = await fetch(origin + route, { ...init, headers: { Authorization: 'Bearer ' + token, ...init.headers }, redirect: 'error' });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`PoC ${init.method || 'GET'} ${route}: HTTP ${response.status} ${error.code || error.error || ''}`);
  }
  return response;
}
export const json = (method, value) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
export async function saveState(state) {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(state, null, 2) + '\n');
}
