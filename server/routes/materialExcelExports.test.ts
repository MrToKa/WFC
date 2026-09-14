// @vitest-environment node

import type { Request, RequestHandler, Response, Router } from 'express';
import ExcelJS from 'exceljs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db.js', () => ({ pool: database }));
vi.mock('../middleware.js', () => ({
  authenticate: (_req: Request, _res: Response, next: () => void) => next(),
  requireAdmin: (_req: Request, _res: Response, next: () => void) => next(),
}));

import { materialCableTypesRouter } from './materialCableTypesRoutes.js';
import { materialCableInstallationMaterialsRouter } from './materialCableInstallationMaterialsRoutes.js';
import { materialTrayInstallationMaterialsRouter } from './materialTrayInstallationMaterialsRoutes.js';
import {
  materialInstrumentsRouter,
  materialInstrumentInstallationMaterialsRouter,
} from './materialInstrumentsRoutes.js';
import { materialsRouter } from './materialsRoutes.js';

const invoke = async (router: Router, path: string, method: 'get' | 'post', body?: unknown) => {
  const routes = (
    router as unknown as {
      stack: {
        route?: {
          path: string;
          methods: Record<string, boolean>;
          stack: { handle: RequestHandler }[];
        };
      }[];
    }
  ).stack;
  const route = routes.find(
    (layer) => layer.route?.path === path && layer.route.methods[method],
  )?.route;
  if (!route) throw new Error(`Missing ${method} ${path}`);
  const response = {
    locals: {},
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
    send: vi.fn(),
  };
  for (const { handle } of route.stack) {
    const next = vi.fn();
    await handle({ body } as Request, response as unknown as Response, next);
    if (!next.mock.calls.length) break;
  }
  return response;
};

const rows = ['Included', 'Excluded'].map((name, index) => ({
  id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  name,
  type: name,
  tray_type: name,
  support_type: name,
  manufacturer: 'Manufacturer',
  purpose: 'Purpose',
  material: null,
  description: null,
  part_no: null,
  remarks: null,
  dimension_mm: null,
  diameter_mm: null,
  weight_kg: null,
  weight_kg_per_m: null,
  height_mm: null,
  rung_height_mm: null,
  width_mm: null,
  length_mm: null,
  load_curve_name: null,
  unit_price: '42',
  minimum_order_quantity: '1',
  order_measurement: 'pcs',
  packaging: 'Box',
}));

const workbookTypes = async (buffer: Buffer) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const sheet = workbook.worksheets[0];
  let typeColumn = 0;
  sheet.getRow(1).eachCell((cell, index) => {
    if (cell.value === 'Type') typeColumn = index;
  });
  expect(typeColumn).toBeGreaterThan(0);
  const types: string[] = [];
  sheet.eachRow((row, index) => {
    if (index > 1 && row.getCell(typeColumn).value)
      types.push(String(row.getCell(typeColumn).value));
  });
  return types;
};

describe.each([
  { name: 'cable types', router: materialCableTypesRouter, path: '/export' },
  {
    name: 'cable installation materials',
    router: materialCableInstallationMaterialsRouter,
    path: '/export',
  },
  {
    name: 'tray installation materials',
    router: materialTrayInstallationMaterialsRouter,
    path: '/export',
  },
  { name: 'instruments', router: materialInstrumentsRouter, path: '/export' },
  {
    name: 'instrument installation materials',
    router: materialInstrumentInstallationMaterialsRouter,
    path: '/export',
  },
  { name: 'trays', router: materialsRouter, path: '/trays/export' },
  { name: 'supports', router: materialsRouter, path: '/supports/export' },
])('$name Excel export', ({ router, path }) => {
  beforeEach(() => {
    database.query.mockReset().mockResolvedValue({ rows });
  });

  it('includes only selected material rows in the actual workbook', async () => {
    const response = await invoke(router, path, 'post', { ids: [rows[0].id] });
    expect(response.status).not.toHaveBeenCalled();
    expect(await workbookTypes(response.send.mock.calls[0][0])).toEqual(['Included']);
  });

  it('keeps workbook headers but includes no materials for an empty selection', async () => {
    const response = await invoke(router, path, 'post', { ids: [] });
    expect(response.status).not.toHaveBeenCalled();
    expect(await workbookTypes(response.send.mock.calls[0][0])).toEqual([]);
  });

  it('preserves the full catalog export for existing GET callers', async () => {
    const response = await invoke(router, path, 'get');
    expect(await workbookTypes(response.send.mock.calls[0][0])).toEqual(['Included', 'Excluded']);
  });

  it.each([{}, { ids: ['invalid'] }, { ids: null }])(
    'rejects invalid selections: %j',
    async (body) => {
      const response = await invoke(router, path, 'post', body);
      expect(response.status).toHaveBeenCalledWith(400);
      expect(database.query).not.toHaveBeenCalled();
      expect(response.send).not.toHaveBeenCalled();
    },
  );
});
