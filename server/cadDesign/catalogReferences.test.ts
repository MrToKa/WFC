// @vitest-environment node
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
const client = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn() }));
vi.mock('../db.js', () => ({ pool: db }));
vi.mock('../config.js', () => ({ config: { jwtSecret: 'test-only', bcryptRounds: 4 } }));
vi.mock('../services/objectStorageService.js', () => ({
  getObjectStream: vi.fn(), getProjectBucket: vi.fn(),
}));
import { cadDesignRouter } from './routes.js';

const projectId = '00000000-0000-4000-8000-000000000001';
const assetId = '00000000-0000-4000-8000-000000000002';
const catalogId = '00000000-0000-4000-8000-000000000003';
let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  // Project assignment middleware is covered separately; exercise the real
  // requireProjectEdit guard here without connecting to an account database.
  app.use((req, _res, next) => { req.canEditProject = req.header('x-test-editor') === 'true'; next(); });
  app.use('/api/projects/:projectId/cad-design', cadDesignRouter);
  await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects/${projectId}/cad-design`;
});
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
beforeEach(() => {
  vi.clearAllMocks();
  db.connect.mockResolvedValue(client);
  client.query.mockImplementation(async (sql: string) => {
    if (sql.includes('SELECT a.original_filename')) return { rows: [{ original_filename: 'custom-fitting.step', source_sha256: 'a'.repeat(64) }] };
    if (sql.includes('INSERT INTO cad_catalog_items')) return { rows: [{ id: catalogId }] };
    return { rows: [] };
  });
});
const select = (body: unknown, editor = true) => fetch(`${base}/catalog`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-editor': String(editor) }, body: JSON.stringify(body),
});

describe('Materials revision references in Routings builder', () => {
  it('requires project editing permission before acquiring a database client', async () => {
    expect((await select({ assetId }, false)).status).toBe(403);
    expect(db.connect).not.toHaveBeenCalled();
  });

  it.each([{ manufacturer: 'Fake', partNumber: 'Fake', family: 'Fake' }, { assetId, partNumber: 'Spoofed' }, { assetId: '../source.step' }])(
    'rejects project product authoring or metadata overrides: %j', async body => {
      expect((await select(body)).status).toBe(400);
      expect(db.connect).not.toHaveBeenCalled();
    },
  );

  it('rejects the old multipart STEP upload without buffering or storing its source', async () => {
    const body = new FormData();
    body.set('file', new Blob(['ISO-10303-21;']), 'fitting.step');
    const result = await fetch(`${base}/catalog`, { method: 'POST', headers: { 'x-test-editor': 'true' }, body });
    expect(result.status).toBe(400);
    expect(db.connect).not.toHaveBeenCalled();
  });

  it('pins a global asset using server-derived SKU, family and source keys; unknown parts receive no ports', async () => {
    const result = await select({ assetId });
    expect(result.status).toBe(201);
    expect(await result.json()).toEqual({ id: expect.any(String), assetId, reused: false, conversionStatus: 'ready' });
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('FOR SHARE OF a'), [assetId]);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('SELECT $1,$2,f.manufacturer,c.part_number,f.name'),
      [expect.any(String), projectId, assetId, null]);
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO cad_catalog_ports'))).toBe(false);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('reuses exactly the same asset reference, never a matching STEP hash from another SKU', async () => {
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT a.original_filename')) return { rows: [{ original_filename: 'part.step', source_sha256: 'a'.repeat(64) }] };
      if (sql.startsWith('SELECT id FROM cad_catalog_items')) return { rows: [{ id: catalogId }] };
      return { rows: [] };
    });
    const result = await select({ assetId });
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ id: catalogId, assetId, reused: true });
    expect(client.query).toHaveBeenCalledWith('SELECT id FROM cad_catalog_items WHERE project_id=$1 AND material_component_cad_asset_id=$2', [projectId, assetId]);
  });

  it('refuses retired or nonexistent revisions for new selection', async () => {
    client.query.mockResolvedValue({ rows: [] });
    const result = await select({ assetId });
    expect(result.status).toBe(404);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO cad_catalog_items'))).toBe(false);
  });

  it('retains old revision IDs and revision numbers in catalogue responses', async () => {
    db.query.mockResolvedValue({ rows: [{ id: catalogId, materialAssetId: assetId, cadRevision: 1 }] });
    const result = await fetch(`${base}/catalog`);
    expect(await result.json()).toEqual({ items: [{ id: catalogId, materialAssetId: assetId, cadRevision: 1 }] });
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('material_component_cad_asset_id AS "materialAssetId"'), [projectId]);
  });

  it('only places ready, globally pinned components into proposed designs on the active healthy model', async () => {
    db.query.mockResolvedValue({ rows: [] });
    const result = await fetch(`${base}/designs/${catalogId}/instances`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-editor': 'true' },
      body: JSON.stringify({ catalogItemId: catalogId, transform: { positionMm: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } } }),
    });
    expect(result.status).toBe(409);
    const sql = String(db.query.mock.calls[0][0]);
    expect(sql).toContain("d.status='proposed'");
    expect(sql).toContain("c.conversion_status='ready' AND c.material_component_cad_asset_id IS NOT NULL");
    expect(sql).toContain("v.state='ready' AND v.health='healthy'");
  });
});
