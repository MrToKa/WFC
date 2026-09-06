// @vitest-environment node

import type { Request, Response, Router } from 'express';
import * as XLSX from 'xlsx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const databaseMocks = vi.hoisted(() => ({
  pool: {
    connect: vi.fn(),
    query: vi.fn(),
  },
}));

vi.mock('../db.js', () => ({ pool: databaseMocks.pool }));

import { materialCableInstallationMaterialsRouter } from './materialCableInstallationMaterialsRoutes.js';
import { materialCableTypesRouter } from './materialCableTypesRoutes.js';
import { materialsRouter } from './materialsRoutes.js';
import { materialTrayInstallationMaterialsRouter } from './materialTrayInstallationMaterialsRoutes.js';
import {
  materialInstrumentsRouter,
  materialInstrumentInstallationMaterialsRouter,
} from './materialInstrumentsRoutes.js';

type ImportHandler = (req: Request, res: Response) => Promise<void>;

type RouterLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: ImportHandler }>;
  };
};

type CatalogCase = {
  name: string;
  router: Router;
  path: string;
  table: string;
  row: Record<string, string | number>;
  existingRow: Record<string, string>;
  updatePriceIndex: number;
  insertPriceIndex: number;
};

const catalogCases: CatalogCase[] = [
  {
    name: 'cable type',
    router: materialCableTypesRouter,
    path: '/import',
    table: 'material_cable_types',
    row: { Type: 'Legacy cable type' },
    existingRow: { id: 'cable-type-id', name: 'Legacy cable type' },
    updatePriceIndex: 8,
    insertPriceIndex: 10,
  },
  {
    name: 'cable installation material',
    router: materialCableInstallationMaterialsRouter,
    path: '/import',
    table: 'material_cable_installation_materials',
    row: { Type: 'Legacy cable installation material' },
    existingRow: { id: 'cable-installation-id', type: 'Legacy cable installation material' },
    updatePriceIndex: 7,
    insertPriceIndex: 9,
  },
  {
    name: 'tray installation material',
    router: materialTrayInstallationMaterialsRouter,
    path: '/import',
    table: 'material_tray_installation_materials',
    row: { Type: 'Legacy tray installation material' },
    existingRow: { id: 'tray-installation-id', type: 'Legacy tray installation material' },
    updatePriceIndex: 7,
    insertPriceIndex: 9,
  },
  {
    name: 'instrument',
    router: materialInstrumentsRouter,
    path: '/import',
    table: 'material_instruments',
    row: { Type: 'Legacy instrument' },
    existingRow: { id: 'instrument-id', type: 'Legacy instrument' },
    updatePriceIndex: 7,
    insertPriceIndex: 9,
  },
  {
    name: 'instrument installation material',
    router: materialInstrumentInstallationMaterialsRouter,
    path: '/import',
    table: 'material_instrument_installation_materials',
    row: { Type: 'Legacy instrument installation material' },
    existingRow: {
      id: 'instrument-installation-id',
      type: 'Legacy instrument installation material',
    },
    updatePriceIndex: 7,
    insertPriceIndex: 9,
  },
  {
    name: 'tray',
    router: materialsRouter,
    path: '/trays/import',
    table: 'material_trays',
    row: {
      Manufacturer: 'Legacy maker',
      Type: 'Legacy tray',
      'Height [mm]': 60,
      'Rung height [mm]': 15,
      'Width [mm]': 300,
      'Weight [kg/m]': 2.5,
    },
    existingRow: { id: 'tray-id', type: 'Legacy tray' },
    updatePriceIndex: 6,
    insertPriceIndex: 7,
  },
  {
    name: 'support',
    router: materialsRouter,
    path: '/supports/import',
    table: 'material_supports',
    row: {
      Manufacturer: 'Legacy maker',
      Type: 'Legacy support',
      'Height [mm]': 40,
      'Width [mm]': 60,
      'Length [mm]': 3000,
      'Weight [kg]': 3.5,
    },
    existingRow: { id: 'support-id', type: 'Legacy support' },
    updatePriceIndex: 6,
    insertPriceIndex: 7,
  },
];

const findImportHandler = (router: Router, path: string): ImportHandler => {
  const layers = (router as unknown as { stack: RouterLayer[] }).stack;
  const route = layers.find(
    (layer) => layer.route?.path === path && layer.route.methods.post,
  )?.route;
  if (!route) throw new Error(`Import route ${path} was not found`);
  const handler = route.stack[route.stack.length - 1]?.handle;
  if (!handler) throw new Error(`Import handler ${path} was not found`);
  return handler;
};

const workbookBuffer = (row: Record<string, string | number>): Buffer => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([row]), 'Materials');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};

const responseStub = (): {
  response: Response;
  json: ReturnType<typeof vi.fn>;
  status: ReturnType<typeof vi.fn>;
} => {
  const json = vi.fn();
  const status = vi.fn();
  const response = { json, status } as unknown as Response;
  status.mockReturnValue(response);
  json.mockReturnValue(response);
  return { response, json, status };
};

const invokeImport = async (
  catalog: CatalogCase,
  row: Record<string, string | number>,
  existing: boolean,
): Promise<{ sql: string; values: unknown[] }> => {
  let mutation: { sql: string; values: unknown[] } | undefined;
  const client = {
    query: vi.fn(async (sqlValue: unknown, values: unknown[] = []) => {
      const sql = String(sqlValue);
      if (sql.includes(`UPDATE ${catalog.table}`) || sql.includes(`INSERT INTO ${catalog.table}`)) {
        mutation = { sql, values };
      }
      if (
        sql.includes(`FROM ${catalog.table}`) &&
        (sql.includes('WHERE lower(') || sql.includes('WHERE LOWER('))
      ) {
        return {
          rowCount: existing ? 1 : 0,
          rows: existing ? [catalog.existingRow] : [],
        };
      }
      return { rowCount: 0, rows: [] };
    }),
    release: vi.fn(),
  };
  databaseMocks.pool.connect.mockResolvedValue(client);
  databaseMocks.pool.query.mockResolvedValue({ rowCount: 0, rows: [] });

  const { response, json, status } = responseStub();
  const request = {
    file: {
      buffer: workbookBuffer(row),
      originalname: 'legacy-materials.xlsx',
    },
  } as unknown as Request;
  await findImportHandler(catalog.router, catalog.path)(request, response);

  expect(status).not.toHaveBeenCalled();
  expect(json).toHaveBeenCalledOnce();
  expect(mutation).toBeDefined();
  return mutation as { sql: string; values: unknown[] };
};

describe('material catalog import prices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const missingPriceCases = [
    { label: 'an absent Price column', price: undefined },
    { label: 'a blank Price cell', price: '' },
    { label: 'an invalid negative Price', price: -1 },
  ] as const;

  for (const catalog of catalogCases) {
    it.each(missingPriceCases)(
      `preserves the existing ${catalog.name} price for $label`,
      async ({ price }) => {
        const row = price === undefined ? catalog.row : { ...catalog.row, Price: price };
        const mutation = await invokeImport(catalog, row, true);

        expect(mutation.sql).toContain('unit_price = COALESCE(');
        expect(mutation.values[catalog.updatePriceIndex]).toBeNull();
      },
    );

    it(`defaults a new ${catalog.name} price to zero when Price is absent`, async () => {
      const mutation = await invokeImport(catalog, catalog.row, false);

      expect(mutation.sql).toContain(`INSERT INTO ${catalog.table}`);
      expect(mutation.values[catalog.insertPriceIndex]).toBe(0);
    });
  }
});

describe('material catalog import connection failures', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(catalogCases)('returns a JSON error for $name when a connection fails', async (catalog) => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    databaseMocks.pool.query.mockResolvedValue({ rowCount: 0, rows: [] });
    databaseMocks.pool.connect.mockRejectedValue(new Error('Database unavailable'));
    const { response, status, json } = responseStub();
    const request = {
      file: { buffer: workbookBuffer(catalog.row), originalname: 'materials.xlsx' },
    } as unknown as Request;

    await findImportHandler(catalog.router, catalog.path)(request, response);

    expect(databaseMocks.pool.connect).toHaveBeenCalledOnce();
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ error: expect.any(String) });
  });
});
