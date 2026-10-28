// @vitest-environment node
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), getPackage: vi.fn(), verifyAccessToken: vi.fn() }));
vi.mock('../db.js', () => ({ pool: { query: mocks.query } }));
vi.mock('../auth.js', () => ({ verifyAccessToken: mocks.verifyAccessToken }));
vi.mock('../modelRegistry/runtime.js', () => ({ getModelRegistry: () => ({ getPackage: mocks.getPackage }) }));
import { authenticate, loadCurrentUserRole, requireProjectAccess, requireProjectReadOnly } from '../middleware.js';
import { ModelRegistryError } from '../modelRegistry/errors.js';
import { modelRegistryRouter } from './modelRegistryRoutes.js';

const projectId = '11111111-1111-4111-8111-111111111111';
const versionId = '22222222-2222-4222-8222-222222222222';
const raw = Buffer.from('PK test archive from verified private handle');
let root: string, server: Server, origin: string;
let role: 'engineer' | 'admin' | 'technician' | 'basic';
let granted: boolean;
const closed: ReturnType<typeof vi.fn>[] = [];

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'wfc-package-route-'));
  await fs.writeFile(path.join(root, 'verified.zip'), raw);
  const app = express();
  app.use('/api/projects', authenticate, loadCurrentUserRole, requireProjectReadOnly);
  app.use('/api/projects/:projectId', requireProjectAccess, modelRegistryRouter);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await fs.rm(root, { recursive: true, force: true });
});
beforeEach(() => {
  vi.clearAllMocks(); closed.length = 0; role = 'admin'; granted = true;
  mocks.verifyAccessToken.mockReturnValue({ sub: 'engineer-id', email: 'test@fixture.invalid', isAdmin: false });
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM users')) return { rows: [{ is_admin: role === 'admin', role }] };
    if (sql.includes('FROM user_project_access')) return { rows: granted ? [{}] : [] };
    throw new Error('Unexpected fixture database call');
  });
  mocks.getPackage.mockImplementation(async () => {
    const handle = await fs.open(path.join(root, 'verified.zip'), 'r');
    const close = vi.fn(async () => handle.close()); closed.push(close);
    return { handle, close, bytes: raw.length, sha256: 'a'.repeat(64), filename: `model-${versionId}.zip` };
  });
});
const url = () => `${origin}/api/projects/${projectId}/model-versions/${versionId}/package`;
const headers = { Authorization: 'Bearer current-wfc-login' };

describe('retained portable package download', () => {
  it('allows a current administrator and closes the pinned handle after a truthful ZIP response', async () => {
    const response = await fetch(url(), { headers });
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(raw);
    expect(response.headers.get('content-type')).toBe('application/zip');
    expect(response.headers.get('content-length')).toBe(String(raw.length));
    expect(response.headers.get('content-disposition')).toBe(`attachment; filename="model-${versionId}.zip"`);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-package-sha256')).toBe('a'.repeat(64));
    expect(mocks.getPackage).toHaveBeenCalledWith(projectId, versionId, expect.any(AbortSignal));
    await vi.waitFor(() => expect(closed[0]).toHaveBeenCalledOnce());
  });

  it('supports HEAD with the same verified identity and no response body', async () => {
    const response = await fetch(url(), { method: 'HEAD', headers });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBe(String(raw.length));
    expect(await response.text()).toBe('');
    await vi.waitFor(() => expect(closed[0]).toHaveBeenCalledOnce());
  });

  it('rechecks admin rights revoked while the package is being verified before sending ZIP bytes', async () => {
    const read = mocks.getPackage.getMockImplementation()!;
    mocks.getPackage.mockImplementation(async (...args) => { const archive = await read(...args); role = 'engineer'; return archive; });
    const response = await fetch(url(), { headers });
    expect(response.status).toBe(403);
    expect(response.headers.get('content-disposition')).toBeNull();
    await vi.waitFor(() => expect(closed[0]).toHaveBeenCalledOnce());
  });

  it('denies unauthenticated and every non-admin role before reading any package', async () => {
    expect((await fetch(url())).status).toBe(401);
    for (const denied of ['basic', 'technician', 'engineer'] as const) {
      role = denied;
      expect((await fetch(url(), { headers })).status).toBe(403);
    }
    expect(mocks.getPackage).not.toHaveBeenCalled();
  });

  it.each([['PACKAGE_NOT_FOUND', 404], ['PACKAGE_UNAVAILABLE', 503]] as const)('returns a safe %s JSON error before sending ZIP headers', async (code, status) => {
    mocks.getPackage.mockRejectedValue(new ModelRegistryError(code, status));
    const response = await fetch(url(), { headers });
    expect(response.status).toBe(status);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('content-disposition')).toBeNull();
    expect(await response.json()).toMatchObject({ code });
  });
});
