// @vitest-environment node
import express from 'express';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { componentSchema, materialComponentsRouter, materialTrayCadRouter } from './routes.js';

const mocks = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn(), upload: vi.fn(), remove: vi.fn(), convert: vi.fn() }));
vi.mock('../services/materialAuditPool.js', () => ({ materialAuditPool: { query: mocks.query }, withMaterialTransaction: mocks.transaction }));
vi.mock('../services/objectStorageService.js', () => ({
  getProjectBucket: () => 'isolated-test', uploadObject: mocks.upload, deleteObject: mocks.remove, getObjectStream: vi.fn(),
}));
vi.mock('../cadDesign/converter.js', () => ({ convertStepToMesh: mocks.convert }));
vi.mock('../middleware.js', () => ({ requireAdmin: (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.header('x-test-admin') === 'yes') next(); else res.status(403).json({ code: 'ADMIN_REQUIRED' });
} }));
const componentId = '00000000-0000-4000-8000-000000000001';
const familyId = '00000000-0000-4000-8000-000000000002';
const assetId = '00000000-0000-4000-8000-000000000003';
const step = 'ISO-10303-21;\nHEADER; ENDSEC; DATA; ENDSEC;\nEND-ISO-10303-21;';
let server: Server | undefined;
const start = async () => {
  const app = express();
  app.use(express.json());
  app.use('/components', materialComponentsRouter);
  app.use('/trays', materialTrayCadRouter);
  app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(500).json({ code: 'TEST_FAILURE' }); });
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server!.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test address');
  return `http://127.0.0.1:${address.port}`;
};
const multipart = (source = step) => {
  const data = new FormData();
  data.append('file', new Blob([source]), 'part.step');
  return data;
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.query.mockResolvedValue({ rows: [] });
  mocks.upload.mockResolvedValue(undefined);
  mocks.remove.mockResolvedValue(undefined);
  mocks.convert.mockResolvedValue({ bytes: Buffer.from('{}'), mesh: { triangleCount: 1, solidCount: 1, boundsMm: { min: [0,0,0], max: [1,1,1] }, units: 'mm' } });
});
afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve,reject) => server!.close(error => error ? reject(error) : resolve()));
    server = undefined;
  }
});
describe('Materials component identity', () => {
  it('rejects fitting aliases of a straight tray and untrusted storage/mesh metadata', () => {
    expect(componentSchema.safeParse({ familyId, name: 'Elbow', partNumber: 'EL-60', componentKind: 'bend', materialTrayId: componentId }).success).toBe(false);
    expect(componentSchema.safeParse({ familyId, name: 'Elbow', partNumber: 'EL-60', componentKind: 'bend', source_object_key: 'foreign/key' }).success).toBe(false);
    expect(componentSchema.safeParse({ familyId, name: 'Elbow', partNumber: 'EL-60', componentKind: 'bend', widthMm: Infinity }).success).toBe(false);
    expect(componentSchema.safeParse({ familyId, name: 'Elbow', partNumber: 'EL-60', componentKind: 'bend' }).success).toBe(true);
  });
  it('denies writes before storage or converter access for non-admin users', async () => {
    const base = await start();
    const response = await fetch(`${base}/components/${componentId}/cad-assets`, { method: 'POST', body: multipart() });
    expect(response.status).toBe(403);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.convert).not.toHaveBeenCalled();
  });
  it('requires a global family and rejects new duplicate manufacturer/SKU identities with 409', async () => {
    const base = await start();
    mocks.transaction.mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: '23505' }));
    const response = await fetch(`${base}/components`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-admin': 'yes' },
      body: JSON.stringify({ familyId, partNumber: 'BEND-60', componentKind: 'bend', name: 'Bend' }) });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: 'MATERIAL_COMPONENT_IDENTITY_EXISTS' });
  });
  it('lists inactive revisions so pinned earlier versions remain inspectable', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ id: componentId }] }).mockResolvedValueOnce({ rows: [{ id: assetId, revision: 1, active: false }] });
    const base = await start();
    const response = await fetch(`${base}/components/${componentId}/cad-assets`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ assets: [{ id: assetId, revision: 1, active: false }] });
    expect(mocks.query.mock.calls[1][0]).not.toContain('AND active');
  });
  it('disables legacy tray upload instead of reusing a straight SKU for a fitting', async () => {
    const base = await start();
    const response = await fetch(`${base}/trays/${componentId}/cad-assets`, { method: 'POST' });
    expect(response.status).toBe(410);
    expect(mocks.convert).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});
describe('Materials immutable STEP revisions', () => {
  it('rejects invalid STEP envelope before querying or converting', async () => {
    const base = await start();
    const response = await fetch(`${base}/components/${componentId}/cad-assets`, { method: 'POST', headers: { 'x-test-admin': 'yes' }, body: multipart('not a STEP file') });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: 'INVALID_MATERIAL_CAD_FILE' });
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.convert).not.toHaveBeenCalled();
  });
  it('reuses identical active bytes without invoking the converter', async () => {
    const base = await start();
    mocks.query.mockResolvedValueOnce({ rows: [{ id: componentId }] }).mockResolvedValueOnce({ rows: [{ id: assetId }] });
    const response = await fetch(`${base}/components/${componentId}/cad-assets`, { method: 'POST', headers: { 'x-test-admin': 'yes' }, body: multipart() });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: assetId, reused: true, meshReady: true });
    expect(mocks.convert).not.toHaveBeenCalled();
  });
  it('cleans both object keys when mesh upload fails after STEP upload', async () => {
    const base = await start();
    mocks.query.mockResolvedValueOnce({ rows: [{ id: componentId }] }).mockResolvedValueOnce({ rows: [] });
    mocks.upload.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('mesh upload failed'));
    const response = await fetch(`${base}/components/${componentId}/cad-assets`, { method: 'POST', headers: { 'x-test-admin': 'yes' }, body: multipart() });
    expect(response.status).toBe(500);
    expect(mocks.remove).toHaveBeenCalledTimes(2);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('serializes publication and cleans redundant objects when concurrent identical upload wins', async () => {
    const base = await start();
    mocks.query.mockResolvedValueOnce({ rows: [{ id: componentId }] }).mockResolvedValueOnce({ rows: [] });
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ id: componentId }] }).mockResolvedValueOnce({ rows: [{ id: assetId, source_sha256: '' }] });
    mocks.transaction.mockImplementationOnce(async (work: (client: { query: typeof query }) => Promise<unknown>) => {
      const sha = mocks.query.mock.calls[1][1][1];
      query.mockReset().mockResolvedValueOnce({ rows: [{ id: componentId }] }).mockResolvedValueOnce({ rows: [{ id: assetId, source_sha256: sha }] });
      return work({ query });
    });
    const response = await fetch(`${base}/components/${componentId}/cad-assets`, { method: 'POST', headers: { 'x-test-admin': 'yes' }, body: multipart() });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: assetId, reused: true, meshReady: true });
    expect(query.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(mocks.remove).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenCalledTimes(2);
  });
  it('publishes a new revision once without deleting committed objects', async () => {
    const base = await start();
    mocks.query.mockResolvedValueOnce({ rows: [{ id: componentId }] }).mockResolvedValueOnce({ rows: [] });
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ id: componentId }] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ next: 2 }] }).mockResolvedValue({ rows: [] });
    mocks.transaction.mockImplementationOnce((work: (client: { query: typeof query }) => Promise<unknown>) => work({ query }));
    const response = await fetch(`${base}/components/${componentId}/cad-assets`, { method: 'POST', headers: { 'x-test-admin': 'yes' }, body: multipart() });
    expect(response.status).toBe(201);
    const result = await response.json() as { id: string };
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(query.mock.calls[3][0]).toContain('SET active=FALSE');
    expect(query.mock.calls[4][1][2]).toBe(2);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
