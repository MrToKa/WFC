// @vitest-environment node
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn(), upload: vi.fn(), remove: vi.fn(), stream: vi.fn(), convert: vi.fn() }));
const client = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../services/materialAuditPool.js', () => ({ materialAuditPool: { query: mocks.query }, withMaterialTransaction: mocks.transaction }));
vi.mock('../services/objectStorageService.js', () => ({
  getProjectBucket: () => 'isolated-test', uploadObject: mocks.upload, deleteObject: mocks.remove, getObjectStream: mocks.stream,
}));
vi.mock('../cadDesign/converter.js', () => ({ convertStepToMesh: mocks.convert }));
vi.mock('../middleware.js', () => ({ requireAdmin: (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.header('x-test-admin') === 'yes') next(); else res.status(403).json({ code: 'ADMIN_REQUIRED' });
} }));
import { materialComponentsRouter } from './routes.js';

const componentId = '00000000-0000-4000-8000-000000000001';
const assetId = '00000000-0000-4000-8000-000000000002';
const currentId = '00000000-0000-4000-8000-000000000003';
let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/components', materialComponentsRouter);
  app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(500).json({ code: 'TEST_FAILURE' }));
  await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/components`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve,reject) => server.close(error => error ? reject(error) : resolve()));
});
const defaultQuery = async (sql: string) => {
  if (sql.startsWith('SELECT id FROM material_components')) return { rows: [{ id: componentId }] };
  if (sql.startsWith('SELECT id,active FROM')) return { rows: [{ id: assetId, active: true }] };
  if (sql.includes('AND id=$2 FOR UPDATE')) return { rows: [{ id: assetId }] };
  if (sql.includes('AND active FOR UPDATE')) return { rows: [{ id: currentId }] };
  return { rows: [] };
};
beforeEach(() => {
  vi.resetAllMocks();
  client.query.mockImplementation(defaultQuery);
  mocks.transaction.mockImplementation(async (work: (transactionClient: { query: typeof client.query }) => Promise<unknown>) => work(client));
});
const retire = (component = componentId, asset = assetId, admin = true) => fetch(`${base}/${component}/cad-assets/${asset}`, {
  method: 'DELETE', headers: { 'x-test-admin': admin ? 'yes' : 'no' },
});
const activate = (body: unknown = { expectedActiveAssetId: currentId }, component = componentId, asset = assetId, admin = true) => fetch(`${base}/${component}/cad-assets/${asset}/activate`, {
  method: 'POST', headers: { 'x-test-admin': admin ? 'yes' : 'no', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const updates = () => client.query.mock.calls.filter(([sql]) => String(sql).startsWith('UPDATE'));
const untouchedStorage = () => {
  expect(mocks.upload).not.toHaveBeenCalled();
  expect(mocks.remove).not.toHaveBeenCalled();
  expect(mocks.convert).not.toHaveBeenCalled();
};

describe('Materials STEP revision retirement', () => {
  it('denies non-admin requests before transaction, conversion or storage', async () => {
    expect((await retire(componentId,assetId,false)).status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
    untouchedStorage();
  });
  it.each([['invalid',assetId], [componentId,'invalid']])('validates scoped identifiers %s %s', async (component,asset) => {
    expect((await retire(component,asset)).status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('locks the owning component first and changes only its chosen active revision flag', async () => {
    const response = await retire();
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(client.query.mock.calls[0]).toEqual(['SELECT id FROM material_components WHERE id=$1 FOR UPDATE',[componentId]]);
    expect(client.query.mock.calls[1]).toEqual(['SELECT id,active FROM material_component_cad_assets WHERE component_id=$1 AND id=$2 FOR UPDATE',[componentId,assetId]]);
    expect(updates()).toEqual([['UPDATE material_component_cad_assets SET active=FALSE WHERE component_id=$1 AND id=$2 AND active',[componentId,assetId]]]);
    expect(client.query.mock.calls.every(([sql]) => !/\b(?:DELETE|INSERT)\b/i.test(String(sql)))).toBe(true);
    expect(mocks.query).not.toHaveBeenCalled();
    untouchedStorage();
  });
  it('returns 404 when the component is absent without looking up another component', async () => {
    client.query.mockResolvedValue({ rows: [] });
    const response = await retire();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: 'MATERIAL_COMPONENT_NOT_FOUND' });
    expect(client.query).toHaveBeenCalledOnce();
  });
  it('returns 404 for an asset outside the selected component', async () => {
    client.query.mockImplementation(async sql => sql.includes('SELECT id,active') ? { rows: [] } : defaultQuery(sql));
    const response = await retire();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: 'MATERIAL_CAD_NOT_FOUND' });
    expect(updates()).toEqual([]);
    untouchedStorage();
  });
  it('rejects an already inactive revision without changing history', async () => {
    client.query.mockImplementation(async sql => sql.includes('SELECT id,active') ? { rows: [{ id: assetId, active: false }] } : defaultQuery(sql));
    const response = await retire();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: 'MATERIAL_CAD_ALREADY_INACTIVE' });
    expect(updates()).toEqual([]);
    untouchedStorage();
  });
  it('keeps historical revisions readable and downloadable after retirement', async () => {
    expect((await retire()).status).toBe(204);
    const historical = { id: assetId, revision: 2, active: false, sourceSha256: 'pinned-sha' };
    mocks.query.mockResolvedValueOnce({ rows: [{ id: componentId }] }).mockResolvedValueOnce({ rows: [historical] });
    const history = await fetch(`${base}/${componentId}/cad-assets`);
    expect(await history.json()).toEqual({ assets: [historical] });
    expect(mocks.query.mock.calls[1][0]).not.toContain('AND active');
    mocks.query.mockResolvedValueOnce({ rows: [{ source_object_key: 'immutable/revision-2.step' }] });
    mocks.stream.mockResolvedValueOnce(Readable.from(['unchanged STEP bytes']));
    const download = await fetch(`${base}/${componentId}/cad-assets/${assetId}/download`);
    expect(download.status).toBe(200);
    expect(await download.text()).toBe('unchanged STEP bytes');
    expect(mocks.stream).toHaveBeenCalledWith('isolated-test','immutable/revision-2.step');
    untouchedStorage();
  });
});

describe('Materials STEP revision activation', () => {
  it('denies non-admin requests before transaction or storage', async () => {
    expect((await activate(undefined,componentId,assetId,false)).status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
    untouchedStorage();
  });
  it.each([['invalid',assetId], [componentId,'invalid']])('validates identifiers %s %s', async (component,asset) => {
    expect((await activate(undefined,component,asset)).status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it.each([{}, { expectedActiveAssetId: 'invalid' }, { expectedActiveAssetId: 5 }, { expectedActiveAssetId: null, sourceObjectKey: 'untrusted' }])('requires strict current-state metadata %j', async body => {
    const response = await activate(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: 'INVALID_CAD_ACTIVATION' });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('restores the chosen historical revision in one component-locked transaction', async () => {
    const response = await activate();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: assetId, active: true });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(client.query.mock.calls.slice(0,3)).toEqual([
      ['SELECT id FROM material_components WHERE id=$1 FOR UPDATE',[componentId]],
      ['SELECT id FROM material_component_cad_assets WHERE component_id=$1 AND id=$2 FOR UPDATE',[componentId,assetId]],
      ['SELECT id FROM material_component_cad_assets WHERE component_id=$1 AND active FOR UPDATE',[componentId]],
    ]);
    expect(updates()).toEqual([
      ['UPDATE material_component_cad_assets SET active=FALSE WHERE component_id=$1 AND active',[componentId]],
      ['UPDATE material_component_cad_assets SET active=TRUE WHERE component_id=$1 AND id=$2',[componentId,assetId]],
    ]);
    // Pinning, product identity, hashes, revision numbers and storage keys are untouched.
    expect(client.query.mock.calls.every(([sql]) => !/\b(?:cad_catalog_items|cad_design_instances|source_sha256|source_object_key|DELETE|INSERT)\b/i.test(String(sql)))).toBe(true);
    untouchedStorage();
  });
  it('restores from an empty active slot when the caller expected null', async () => {
    client.query.mockImplementation(async sql => sql.includes('AND active FOR UPDATE') ? { rows: [] } : defaultQuery(sql));
    expect((await activate({ expectedActiveAssetId: null })).status).toBe(200);
    expect(updates()).toHaveLength(2);
    untouchedStorage();
  });
  it.each([null,assetId])('rejects stale expected active revision %s', async expectedActiveAssetId => {
    const response = await activate({ expectedActiveAssetId });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: 'MATERIAL_CAD_ACTIVE_CHANGED' });
    expect(updates()).toEqual([]);
    untouchedStorage();
  });
  it('rejects a stale expected revision when another request retired the current STEP', async () => {
    client.query.mockImplementation(async sql => sql.includes('AND active FOR UPDATE') ? { rows: [] } : defaultQuery(sql));
    expect((await activate()).status).toBe(409);
    expect(updates()).toEqual([]);
  });
  it('returns 404 for a missing component before reading asset state', async () => {
    client.query.mockResolvedValue({ rows: [] });
    const response = await activate();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: 'MATERIAL_COMPONENT_NOT_FOUND' });
    expect(client.query).toHaveBeenCalledOnce();
  });
  it('rejects an asset belonging to another component before changing active state', async () => {
    client.query.mockImplementation(async sql => sql.includes('AND id=$2 FOR UPDATE') ? { rows: [] } : defaultQuery(sql));
    const response = await activate();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: 'MATERIAL_CAD_NOT_FOUND' });
    expect(updates()).toEqual([]);
    untouchedStorage();
  });
  it('accepts an already active target only with the matching expected revision', async () => {
    client.query.mockImplementation(async sql => sql.includes('AND active FOR UPDATE') ? { rows: [{ id: assetId }] } : defaultQuery(sql));
    const response = await activate({ expectedActiveAssetId: assetId });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: assetId, active: true });
    expect(updates()).toEqual([]);
    expect((await activate({ expectedActiveAssetId: null })).status).toBe(409);
    untouchedStorage();
  });
  it('propagates transaction failure without attempting external source cleanup', async () => {
    mocks.transaction.mockRejectedValue(new Error('rolled back'));
    expect((await activate()).status).toBe(500);
    untouchedStorage();
  });
});
