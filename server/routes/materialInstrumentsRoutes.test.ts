// @vitest-environment node

import type { Request, Response, Router } from 'express';
import * as XLSX from 'xlsx';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db.js', () => ({ pool: database }));

import { authenticate, requireAdmin } from '../middleware.js';
import {
  materialInstrumentsRouter,
  materialInstrumentInstallationMaterialsRouter,
} from './materialInstrumentsRoutes.js';

type Handler = (request: Request, response: Response) => Promise<void>;
type Route = {
  path: string;
  methods: Record<string, boolean>;
  stack: Array<{ handle: Handler }>;
};

const routeFor = (router: Router, method: string, path: string): Route => {
  const layers = (router as unknown as { stack: Array<{ route?: Route }> }).stack;
  const route = layers.find(
    (layer) => layer.route?.path === path && layer.route.methods[method],
  )?.route;
  if (!route) throw new Error(`Missing ${method} ${path}`);
  return route;
};

const invoke = async (router: Router, method: string, path: string, input: object = {}) => {
  const response = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
  };
  const route = routeFor(router, method, path);
  await route.stack[route.stack.length - 1].handle(
    { params: {}, ...input } as Request,
    response as unknown as Response,
  );
  return response;
};

const id = '00000000-0000-4000-8000-000000000001';
const row = {
  id,
  type: 'Sensor bracket',
  purpose: 'Mounting',
  material: 'Steel',
  description: 'Adjustable bracket',
  manufacturer: 'ACME',
  part_no: 'SB-1',
  dimension_mm: '50x20',
  weight_kg: '0.1',
  unit_price: '12.50',
  minimum_order_quantity: '4',
  order_measurement: 'pcs',
  packaging: 'Box',
  source: null,
  created_at: '2026-09-06T00:00:00.000Z',
  updated_at: '2026-09-06T00:00:00.000Z',
};

const catalogs = [
  {
    category: 'instrument',
    router: materialInstrumentsRouter,
    table: 'material_instruments',
    assignmentTable: 'material_instrument_standard_materials',
    itemKey: 'instrument',
    collectionKey: 'instruments',
    idParam: 'instrumentId',
    fileSlug: 'instruments',
  },
  {
    category: 'instrument-installation-material',
    router: materialInstrumentInstallationMaterialsRouter,
    table: 'material_instrument_installation_materials',
    assignmentTable: 'material_instrument_installation_standard_materials',
    itemKey: 'instrumentInstallationMaterial',
    collectionKey: 'instrumentInstallationMaterials',
    idParam: 'instrumentInstallationMaterialId',
    fileSlug: 'instrument-installation-materials',
  },
];

describe.each(catalogs)('$category catalog', (catalog) => {
  beforeEach(() => {
    vi.clearAllMocks();
    database.query.mockResolvedValue({ rowCount: 1, rows: [row] });
  });

  it('lists catalog rows using its own response key and mapped numeric metadata', async () => {
    const response = await invoke(catalog.router, 'get', '/');
    expect(database.query).toHaveBeenCalledWith(expect.stringContaining(`FROM ${catalog.table}`));
    expect(response.json).toHaveBeenCalledWith({
      [catalog.collectionKey]: [
        expect.objectContaining({ id, unitPrice: 12.5, weightKg: 0.1, minimumOrderQuantity: 4 }),
      ],
    });
  });

  it('creates items with catalog defaults and returns its own response key', async () => {
    const response = await invoke(catalog.router, 'post', '/', {
      body: { type: ' Sensor bracket ' },
    });
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining(`INSERT INTO ${catalog.table}`),
      [
        expect.any(String),
        'Sensor bracket',
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        0,
        1,
        'pcs',
        'pcs',
        null,
      ],
    );
    expect(response.status).toHaveBeenCalledWith(201);
    expect(response.json).toHaveBeenCalledWith({
      [catalog.itemKey]: expect.objectContaining({ id }),
    });
  });

  it('rejects invalid input and reports duplicate types as conflicts', async () => {
    const invalid = await invoke(catalog.router, 'post', '/', {
      body: { type: '', unitPrice: -1 },
    });
    expect(invalid.status).toHaveBeenCalledWith(400);
    expect(database.query).not.toHaveBeenCalled();
    database.query.mockRejectedValueOnce({ code: '23505' });
    const duplicate = await invoke(catalog.router, 'post', '/', {
      body: { type: 'Sensor bracket' },
    });
    expect(duplicate.status).toHaveBeenCalledWith(409);
  });

  it('loads details and standard assignments from the Instrument installation catalog', async () => {
    database.query.mockResolvedValueOnce({ rows: [row] }).mockResolvedValueOnce({ rows: [] });
    const response = await invoke(catalog.router, 'get', `/:${catalog.idParam}`, {
      params: { [catalog.idParam]: id },
    });
    expect(database.query).toHaveBeenLastCalledWith(
      expect.stringContaining(`FROM ${catalog.assignmentTable} a`),
      [id],
    );
    expect(database.query.mock.calls[1][0]).toContain(
      'JOIN material_instrument_installation_materials child',
    );
    expect(response.json).toHaveBeenCalledWith({
      category: expect.objectContaining({ key: catalog.category, supportsStandardMaterials: true }),
      material: expect.objectContaining({ id }),
      standardMaterials: [],
    });
  });

  it('deletes catalog entries and reports referenced materials as conflicts', async () => {
    const input = { params: { [catalog.idParam]: id } };
    const response = await invoke(catalog.router, 'delete', `/:${catalog.idParam}`, input);
    expect(database.query).toHaveBeenCalledWith(`DELETE FROM ${catalog.table} WHERE id = $1`, [id]);
    expect(response.status).toHaveBeenCalledWith(204);
    database.query.mockRejectedValueOnce({ code: '23503' });
    const conflict = await invoke(catalog.router, 'delete', `/:${catalog.idParam}`, input);
    expect(conflict.status).toHaveBeenCalledWith(409);
  });

  it.each(['template', 'export'])(
    'generates a valid %s workbook with all tray installation fields',
    async (operation) => {
      const response = await invoke(catalog.router, 'get', `/${operation}`);
      expect(response.status).not.toHaveBeenCalled();
      expect(response.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringContaining(catalog.fileSlug),
      );
      const workbook = XLSX.read(response.send.mock.calls[0][0], { type: 'buffer' });
      expect(workbook.SheetNames[0].length).toBeLessThanOrEqual(31);
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        workbook.Sheets[workbook.SheetNames[0]],
      );
      expect(rows[0]).toMatchObject(
        operation === 'export'
          ? {
              Type: 'Sensor bracket',
              Purpose: 'Mounting',
              Material: 'Steel',
              'Part No.': 'SB-1',
              'Dimension [mm]': '50x20',
              'Weight [kg]': 0.1,
              Price: 12.5,
              'Minimum order quantity': 4,
              'Order measurement': 'pcs',
              Packaging: 'Box',
            }
          : { Price: 0, 'Minimum order quantity': 1, 'Order measurement': 'pcs', Packaging: 'pcs' },
      );
    },
  );

  it('requires admin authentication for every mutation and workbook operation', () => {
    const ownerPath = `/:${catalog.idParam}`;
    for (const [method, path] of [
      ['post', '/'],
      ['patch', ownerPath],
      ['delete', ownerPath],
      ['post', '/import'],
      ['get', '/template'],
      ['get', '/export'],
      ['post', `${ownerPath}/standard-materials`],
      ['patch', `${ownerPath}/standard-materials/:assignmentId`],
      ['delete', `${ownerPath}/standard-materials/:assignmentId`],
    ]) {
      const route = routeFor(catalog.router, method, path);
      expect(route.stack.slice(0, 2).map((layer) => layer.handle)).toEqual([
        authenticate,
        requireAdmin,
      ]);
    }
  });
});
