// @vitest-environment node
import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';

const mocks = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), capture: vi.fn() }));
vi.mock('../db.js', () => ({ pool: { query: mocks.query, connect: mocks.connect } }));
vi.mock('../services/objectStorageService.js', () => ({
  getObjectStream: vi.fn(),
  getTemplateBucket: vi.fn(),
}));
vi.mock('../services/projectService.js', () => ({
  ensureProjectExists: vi.fn(async () => ({ id: 'project' })),
}));
vi.mock('../services/projectCatalogSnapshotService.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/projectCatalogSnapshotService.js')>()),
  captureTrayMaterialSnapshot: mocks.capture,
}));
import { traysRouter } from './traysRoutes.js';

type Handler = (request: Request, response: Response) => Promise<void>;
type Layer = {
  route?: { path: string; methods: Record<string, boolean>; stack: { handle: Handler }[] };
};
const handler = (method: string, path: string): Handler => {
  const route = (traysRouter as unknown as { stack: Layer[] }).stack.find(
    (layer) => layer.route?.path === path && layer.route.methods[method],
  )?.route;
  return route!.stack.at(-1)!.handle;
};
const snapshot = {
  schemaVersion: 1,
  capturedAt: '2026-01-01',
  material: { id: 'source', type: 'Old type', weightKgPerM: 3 },
  loadCurve: null,
  imageObjectKey: null,
};
const tray = {
  id: 'tray',
  project_id: 'project',
  name: 'Tray 1',
  tray_type: 'Old type',
  width_mm: 333,
  height_mm: 88,
  length_mm: 3000,
  material_snapshot: snapshot,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
};
const client = { query: vi.fn(), release: vi.fn() };
const response = () => {
  const value = { status: vi.fn(), json: vi.fn() };
  value.status.mockReturnValue(value);
  return value as unknown as Response;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.connect.mockResolvedValue(client);
  mocks.query.mockResolvedValue({ rows: [tray], rowCount: 1 });
  mocks.capture.mockResolvedValue({
    ...snapshot,
    material: { ...snapshot.material, id: 'new-source', type: 'New type' },
  });
  client.query.mockResolvedValue({ rows: [tray], rowCount: 1 });
});

describe('tray snapshot route boundaries', () => {
  it.each(['/', '/:trayId'])(
    'reads stored snapshot at GET %s without capture or mutation',
    async (path) => {
      const res = response();
      await handler('get', path)(
        { params: { projectId: 'project', trayId: 'tray' } } as unknown as Request,
        res,
      );
      expect(mocks.connect).not.toHaveBeenCalled();
      expect(mocks.capture).not.toHaveBeenCalled();
      expect(mocks.query.mock.calls.every(([sql]) => String(sql).trim().startsWith('SELECT'))).toBe(
        true,
      );
      expect(res.json).toHaveBeenCalled();
    },
  );

  it('captures a new type on the same transaction as creation', async () => {
    await handler('post', '/')(
      {
        params: { projectId: 'project' },
        body: { name: 'Tray 1', type: 'New type' },
      } as unknown as Request,
      response(),
    );
    expect(mocks.capture).toHaveBeenCalledWith(client, 'New type');
    expect(client.query.mock.calls[0][0]).toBe('BEGIN');
    expect(client.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
    expect(
      client.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO trays'))?.[1][8],
    ).toMatchObject({ material: { id: 'new-source' } });
  });

  it.each([snapshot, null])(
    'preserves captured or unknown historical data during unrelated same-type edits: %j',
    async (materialSnapshot) => {
      client.query.mockResolvedValue({
        rows: [{ ...tray, material_snapshot: materialSnapshot }],
        rowCount: 1,
      });
      await handler('patch', '/:trayId')(
        {
          params: { projectId: 'project', trayId: 'tray' },
          body: { type: 'old TYPE', lengthMm: 6000 },
        } as unknown as Request,
        response(),
      );
      expect(mocks.capture).not.toHaveBeenCalled();
      const update = client.query.mock.calls.find(([sql]) => String(sql).includes('UPDATE trays'));
      expect(update?.[0]).not.toContain('material_snapshot =');
      expect(client.query.mock.calls.some(([sql]) => String(sql).includes('FOR UPDATE'))).toBe(
        true,
      );
    },
  );

  it('captures a replacement only when the selected type changes', async () => {
    await handler('patch', '/:trayId')(
      {
        params: { projectId: 'project', trayId: 'tray' },
        body: { type: 'New type' },
      } as unknown as Request,
      response(),
    );
    expect(mocks.capture).toHaveBeenCalledWith(client, 'New type');
    expect(
      client.query.mock.calls.find(([sql]) => String(sql).includes('UPDATE trays'))?.[0],
    ).toContain('material_snapshot =');
  });

  it('preserves same-type snapshot and copied dimensions when reimporting a length change', async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ['Name', 'Type', 'Length [mm]'],
        ['Tray 1', 'Old type', 6000],
      ]),
    );
    await handler('post', '/import')(
      {
        params: { projectId: 'project' },
        body: {},
        file: { originalname: 'trays.xlsx', buffer: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) },
      } as unknown as Request,
      response(),
    );
    expect(mocks.capture).not.toHaveBeenCalled();
    const update = client.query.mock.calls.find(([sql]) => String(sql).includes('UPDATE trays'));
    expect(update?.[1]).toEqual(['Old type', null, 333, 88, 6000, 'tray', snapshot]);
  });
});
