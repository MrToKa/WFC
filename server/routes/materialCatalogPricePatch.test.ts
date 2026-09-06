// @vitest-environment node

import type { Request, Response, Router } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const databaseMocks = vi.hoisted(() => ({
  pool: {
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

type PatchHandler = (req: Request, res: Response) => Promise<void>;

type RouterLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: PatchHandler }>;
  };
};

type CatalogCase = {
  name: string;
  router: Router;
  path: string;
  paramName: string;
  row: Record<string, unknown>;
};

const id = '00000000-0000-4000-8000-000000000001';
const timestamps = {
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const catalogCases: CatalogCase[] = [
  {
    name: 'cable type',
    router: materialCableTypesRouter,
    path: '/:cableTypeId',
    paramName: 'cableTypeId',
    row: {
      id,
      name: 'Power cable',
      purpose: null,
      material: null,
      description: null,
      manufacturer: null,
      part_no: null,
      remarks: null,
      diameter_mm: null,
      weight_kg_per_m: null,
      unit_price: '1.98',
      minimum_order_quantity: '1',
      order_measurement: 'pcs',
      packaging: 'pcs',
      source: null,
      ...timestamps,
    },
  },
  {
    name: 'cable installation material',
    router: materialCableInstallationMaterialsRouter,
    path: '/:cableInstallationMaterialId',
    paramName: 'cableInstallationMaterialId',
    row: {
      id,
      type: 'Cable gland',
      purpose: null,
      material: null,
      description: null,
      manufacturer: null,
      part_no: null,
      dimension_mm: null,
      weight_kg: null,
      unit_price: '1.98',
      minimum_order_quantity: '1',
      order_measurement: 'pcs',
      packaging: 'pcs',
      source: null,
      ...timestamps,
    },
  },
  {
    name: 'tray installation material',
    router: materialTrayInstallationMaterialsRouter,
    path: '/:trayInstallationMaterialId',
    paramName: 'trayInstallationMaterialId',
    row: {
      id,
      type: 'Tray connector',
      purpose: null,
      material: null,
      description: null,
      manufacturer: null,
      part_no: null,
      dimension_mm: null,
      weight_kg: null,
      unit_price: '1.98',
      minimum_order_quantity: '1',
      order_measurement: 'pcs',
      packaging: 'pcs',
      source: null,
      ...timestamps,
    },
  },
  {
    name: 'instrument',
    router: materialInstrumentsRouter,
    path: '/:instrumentId',
    paramName: 'instrumentId',
    row: {
      id,
      type: 'Sensor',
      purpose: null,
      material: null,
      description: null,
      manufacturer: null,
      part_no: null,
      dimension_mm: null,
      weight_kg: null,
      unit_price: '1.98',
      minimum_order_quantity: '1',
      order_measurement: 'pcs',
      packaging: 'pcs',
      source: null,
      ...timestamps,
    },
  },
  {
    name: 'instrument installation material',
    router: materialInstrumentInstallationMaterialsRouter,
    path: '/:instrumentInstallationMaterialId',
    paramName: 'instrumentInstallationMaterialId',
    row: {
      id,
      type: 'Sensor bracket',
      purpose: null,
      material: null,
      description: null,
      manufacturer: null,
      part_no: null,
      dimension_mm: null,
      weight_kg: null,
      unit_price: '1.98',
      minimum_order_quantity: '1',
      order_measurement: 'pcs',
      packaging: 'pcs',
      source: null,
      ...timestamps,
    },
  },
  {
    name: 'tray',
    router: materialsRouter,
    path: '/trays/:trayId',
    paramName: 'trayId',
    row: {
      id,
      tray_type: 'Cable tray',
      manufacturer: null,
      height_mm: null,
      rung_height_mm: null,
      width_mm: null,
      weight_kg_per_m: null,
      unit_price: '1.98',
      minimum_order_quantity: '1',
      order_measurement: 'pcs',
      packaging: 'pcs',
      source: null,
      load_curve_id: null,
      image_template_id: null,
      image_template_file_name: null,
      image_template_content_type: null,
      load_curve_name: null,
      ...timestamps,
    },
  },
  {
    name: 'support',
    router: materialsRouter,
    path: '/supports/:supportId',
    paramName: 'supportId',
    row: {
      id,
      support_type: 'Tray support',
      manufacturer: null,
      height_mm: null,
      width_mm: null,
      length_mm: null,
      weight_kg: null,
      unit_price: '1.98',
      minimum_order_quantity: '1',
      order_measurement: 'pcs',
      packaging: 'pcs',
      source: null,
      image_template_id: null,
      image_template_file_name: null,
      image_template_content_type: null,
      ...timestamps,
    },
  },
];

const findPatchHandler = (router: Router, path: string): PatchHandler => {
  const layers = (router as unknown as { stack: RouterLayer[] }).stack;
  const route = layers.find(
    (layer) => layer.route?.path === path && layer.route.methods.patch,
  )?.route;
  if (!route) throw new Error(`PATCH route ${path} was not found`);
  const handler = route.stack[route.stack.length - 1]?.handle;
  if (!handler) throw new Error(`PATCH handler ${path} was not found`);
  return handler;
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

describe('material catalog price PATCH routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(catalogCases)('accepts and persists a price for $name', async (catalog) => {
    let mutation: { sql: string; values: unknown[] } | undefined;
    databaseMocks.pool.query.mockImplementation(
      async (sqlValue: unknown, values: unknown[] = []) => {
        const sql = String(sqlValue);
        if (/UPDATE material_/.test(sql)) {
          mutation = { sql, values };
          return {
            rowCount: 1,
            rows: /RETURNING/.test(sql) ? [catalog.row] : [],
          };
        }
        return { rowCount: 1, rows: [catalog.row] };
      },
    );

    const { response, json, status } = responseStub();
    const request = {
      params: { [catalog.paramName]: id },
      body: { unitPrice: 1.98 },
    } as unknown as Request;

    await findPatchHandler(catalog.router, catalog.path)(request, response);

    expect(status).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledOnce();
    expect(mutation?.sql).toContain('unit_price = $1');
    expect(mutation?.values).toEqual([1.98, id]);
  });
});
