// @vitest-environment node
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getInstanceCadPorts, normalizeCutLengthMm, STRAIGHT_SOURCE_SHA256, supportsStraightCut } from '../../shared/cadLengths.js';

const db = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
const storage = vi.hoisted(() => ({ getObjectStream: vi.fn(), getProjectBucket: vi.fn(() => 'isolated-bucket') }));
const converter = vi.hoisted(() => ({ convertStepToMesh: vi.fn() }));
const assembly = vi.hoisted(() => ({ readBoundedSource: vi.fn(), exportStepAssembly: vi.fn() }));
vi.mock('../db.js', () => ({ pool: db }));
vi.mock('../config.js', () => ({ config: { jwtSecret: 'test-only', bcryptRounds: 4 } }));
vi.mock('../services/objectStorageService.js', () => storage);
vi.mock('./converter.js', () => converter);
vi.mock('./stepAssemblyClient.js', () => assembly);
import { cadDesignRouter } from './routes.js';

const project = '00000000-0000-4000-8000-000000000001';
const design = '00000000-0000-4000-8000-000000000002';
const instance = '00000000-0000-4000-8000-000000000003';
const catalog = '00000000-0000-4000-8000-000000000004';
const filename = 'NDX_KL_60-303_F_MED_214.step';
const knownPart = { original_filename: filename, source_sha256: STRAIGHT_SOURCE_SHA256, component_kind: 'straight' };
const transform = { positionMm: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.canEditProject = req.header('x-test-editor') === 'true'; next(); });
  app.use('/api/projects/:projectId/cad-design', cadDesignRouter);
  app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(500).json({ code: 'TEST_FAILURE' }));
  await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects/${project}/cad-design/designs/${design}`;
});
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
beforeEach(() => {
  vi.clearAllMocks();
  db.query.mockImplementation(async (sql: string) => ({ rows: sql.includes('SELECT c.original_filename,c.source_sha256,p.component_kind') ? [knownPart] : [{ id: instance, revision: 2 }] }));
});
const save = (length: unknown, patch = false, omit = false) => fetch(`${base}/instances${patch ? `/${instance}` : ''}`, {
  method: patch ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json', 'x-test-editor': 'true' },
  body: JSON.stringify({ ...(patch ? { expectedRevision: 1 } : { catalogItemId: catalog }), transform, ...(omit ? {} : { lengthMm: length }) }),
});

describe('pinned straight length and connector geometry', () => {
  it('requires the exact approved source hash and filename', () => {
    expect(supportsStraightCut(filename, STRAIGHT_SOURCE_SHA256)).toBe(true);
    expect(supportsStraightCut(filename, '0'.repeat(64))).toBe(false);
    expect(supportsStraightCut('NDX_KLBK_60-303_MED_214.step', STRAIGHT_SOURCE_SHA256)).toBe(false);
  });
  it('moves only the straight end-face and preserves the manufacturer anchors', () => {
    const original = getInstanceCadPorts(filename, STRAIGHT_SOURCE_SHA256);
    const cut = getInstanceCadPorts(filename, STRAIGHT_SOURCE_SHA256, 2500);
    expect(original.find(p => p.id === 'end')?.local.position.z).toBe(6000);
    expect(cut.find(p => p.id === 'end')?.local.position.z).toBe(2500);
    expect(cut.find(p => p.id === 'start')).toEqual(original.find(p => p.id === 'start'));
    expect(getInstanceCadPorts(filename, '0'.repeat(64), 2500)).toEqual([]);
  });
  it('normalizes full source length while rejecting nonfinite and out-of-range values', () => {
    expect(normalizeCutLengthMm(6000)).toBeNull();
    expect(normalizeCutLengthMm(undefined)).toBeNull();
    expect(normalizeCutLengthMm(1250.5)).toBe(1250.5);
    for (const length of [0, -1, 6001, Infinity, NaN]) expect(() => normalizeCutLengthMm(length)).toThrow();
  });
});

describe('proposed instance length API', () => {
  it.each([0, -1, 6001, '2500', {}])('rejects invalid length %j before database access', async length => {
    expect((await save(length)).status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });
  it('creates a cut using a scoped, verified Materials straight revision', async () => {
    expect((await save(2500)).status).toBe(201);
    expect(db.query.mock.calls[0][1]).toEqual([project, catalog]);
    const [sql, values] = db.query.mock.calls[1];
    expect(sql).toContain('cut_length_mm');
    expect(values[12]).toBe(2500);
  });
  it.each([{ ...knownPart, component_kind: 'bend' }, { ...knownPart, source_sha256: '0'.repeat(64) }])('rejects cuts for unapproved or mislabeled components', async part => {
    db.query.mockResolvedValue({ rows: [part] });
    const response = await save(2500);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ code: 'CUT_LENGTH_UNSUPPORTED' });
    expect(db.query).toHaveBeenCalledOnce();
  });
  it('retains backwards-compatible original length on an omitted POST value', async () => {
    expect((await save(undefined, false, true)).status).toBe(201);
    expect(db.query.mock.calls[0][1][12]).toBeNull();
  });
  it.each([[undefined, true, false, null], [null, false, true, null], [2500, false, true, 2500], [6000, false, true, null]])(
    'PATCH preserves omission and supports explicit reset: %j', async (length, omit, hasLength, stored) => {
      expect((await save(length, true, omit as boolean)).status).toBe(200);
      const [sql, values] = db.query.mock.calls.at(-1)!;
      expect(sql).toContain('ELSE i.cut_length_mm END');
      expect(sql).toContain('NOT EXISTS');
      expect(sql).toContain('cc.source_instance_id=i.id OR cc.target_instance_id=i.id');
      expect(values.slice(11)).toEqual([hasLength, stored]);
    },
  );
  it('rejects stale, inactive or connected updates', async () => {
    db.query.mockResolvedValue({ rows: [] });
    expect((await save(null, true)).status).toBe(409);
  });
  it('generates a private cut mesh from the stored source and length only', async () => {
    db.query.mockResolvedValue({ rows: [{ ...knownPart, cut_length_mm: 2500, source_object_key: 'canonical/source.step', mesh_object_key: 'canonical/mesh.json' }] });
    const source = Buffer.from('pinned STEP bytes');
    assembly.readBoundedSource.mockResolvedValue(source);
    converter.convertStepToMesh.mockResolvedValue({ bytes: Buffer.from('{"cut":2500}') });
    const response = await fetch(`${base}/instances/${instance}/mesh?lengthMm=100&source=untrusted`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ cut: 2500 });
    expect(db.query.mock.calls[0][1]).toEqual([project, design, instance]);
    expect(assembly.readBoundedSource).toHaveBeenCalledWith('canonical/source.step');
    expect(converter.convertStepToMesh).toHaveBeenCalledWith(source, { lengthMm: 2500 });
    expect(storage.getObjectStream).not.toHaveBeenCalled();
  });
  it('streams the original mesh when no cut is saved', async () => {
    db.query.mockResolvedValue({ rows: [{ ...knownPart, cut_length_mm: null, mesh_object_key: 'canonical/mesh.json' }] });
    storage.getObjectStream.mockResolvedValue(Readable.from(['{"original":true}']));
    const response = await fetch(`${base}/instances/${instance}/mesh`);
    expect(await response.json()).toEqual({ original: true });
    expect(storage.getObjectStream).toHaveBeenCalledWith('isolated-bucket','canonical/mesh.json');
    expect(converter.convertStepToMesh).not.toHaveBeenCalled();
  });
  it('keeps MTO quantity groups separate by cut length and includes measured total length', async () => {
    db.query.mockResolvedValue({ rows: [{ manufacturer: 'NDX', part_number: 'KL', family: 'KL', component_kind: 'straight', source_sha256: STRAIGHT_SOURCE_SHA256, quantity: 2, length_mm: 2500 }] });
    const response = await fetch(`${base}/materials.csv`);
    const csv = await response.text();
    expect(csv).toContain('"Length (mm)","Total length (m)"');
    expect(csv).toContain(',"2","2500","5"');
    expect(db.query.mock.calls[0][0]).toContain('GROUP BY c.id, a.revision, p.component_kind, i.cut_length_mm');
  });
  it('forwards saved cut lengths in STEP export without changing the pinned part source', async () => {
    const part = { original_filename: filename, source_object_key: 'canonical/source.step', cut_length_mm: 2500, x_mm: 0, y_mm: 0, z_mm: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
    db.query.mockResolvedValueOnce({ rows: [{ model_version_id: catalog, revision: 4 }] }).mockResolvedValueOnce({ rows: [part] }).mockResolvedValueOnce({ rows: [{ revision: 4 }] });
    assembly.exportStepAssembly.mockResolvedValue(Buffer.from('ISO-10303-21;'));
    expect((await fetch(`${base}/assembly.step`)).status).toBe(200);
    expect(assembly.exportStepAssembly).toHaveBeenCalledWith([part]);
    expect(db.query.mock.calls[1][0]).toContain('i.cut_length_mm');
  });
  it.each([[2500, 201], [6000, 409]])('checks saved connectors at the shortened end rather than source Z=%s', async (targetZ, status) => {
    const targetId = '00000000-0000-4000-8000-000000000005';
    const client = { query: vi.fn(), release: vi.fn() };
    db.connect.mockResolvedValue(client);
    const common = { catalog_item_id: catalog, x_mm: 0, y_mm: 0, qx: 0, qy: 0, qz: 0, qw: 1, original_filename: filename, source_sha256: STRAIGHT_SOURCE_SHA256, port_type: 'tray-end-face' };
    client.query.mockImplementation(async (sql: string, values?: unknown[]) => {
      if (sql.includes('SELECT d.id FROM cad_designs')) return { rows: [{ id: design }] };
      if (sql.includes('SELECT i.id AS instance_id')) {
        const isSource = values?.[2] === instance;
        const name = isSource ? 'end' : 'start';
        return { rows: [{ ...common, instance_id: isSource ? instance : targetId,
          z_mm: isSource ? 0 : targetZ, cut_length_mm: isSource ? 2500 : null,
          port_id: isSource ? catalog : targetId, port_name: name,
          local_transform: getInstanceCadPorts(filename, STRAIGHT_SOURCE_SHA256).find(p => p.id === name)?.local }] };
      }
      return { rows: [] };
    });
    const response = await fetch(`${base}/connections`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-editor': 'true' },
      body: JSON.stringify({ sourceInstanceId: instance, sourcePortName: 'end', targetInstanceId: targetId, targetPortName: 'start' }),
    });
    expect(response.status).toBe(status);
    expect(client.release).toHaveBeenCalledOnce();
  });
});
