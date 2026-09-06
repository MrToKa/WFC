// @vitest-environment node

import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MaterialSupportRow } from '../models/materialSupport.js';

const database = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db.js', () => ({ pool: database }));

import { materialsRouter } from './materialsRoutes.js';

type Handler = (request: Request, response: Response) => Promise<void>;
type Route = {
  path: string;
  methods: Record<string, boolean>;
  stack: Array<{ handle: Handler }>;
};

const routes = (materialsRouter as unknown as { stack: Array<{ route?: Route }> }).stack;

const invoke = async (path: string, query: Record<string, string> = {}) => {
  const route = routes.find((layer) => layer.route?.methods.get && layer.route.path === path)?.route;
  if (!route) throw new Error(`Missing GET ${path}`);

  const response = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  await route.stack[route.stack.length - 1].handle(
    { query } as unknown as Request,
    response as unknown as Response,
  );
  return response;
};

const supportRow: MaterialSupportRow = {
  id: '00000000-0000-4000-8000-000000000001',
  support_type: 'Wall bracket',
  manufacturer: 'ACME',
  height_mm: '100',
  width_mm: '200',
  length_mm: null,
  weight_kg: '1.25',
  unit_price: '12.50',
  minimum_order_quantity: '4',
  order_measurement: 'pcs',
  packaging: 'Box',
  source: 'Catalog',
  image_template_id: '00000000-0000-4000-8000-000000000002',
  image_template_file_name: 'bracket.png',
  image_template_content_type: 'image/png',
  created_at: new Date('2026-09-06T00:00:00.000Z'),
  updated_at: new Date('2026-09-06T01:00:00.000Z'),
};

describe('material supports catalog listing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the complete public catalog with mapped dimensions and image metadata', async () => {
    const rows = Array.from({ length: 51 }, (_, index) => ({
      ...supportRow,
      id: `support-${index}`,
      support_type: `Bracket ${String(index).padStart(2, '0')}`,
    }));
    database.query.mockResolvedValueOnce({ rows });

    const response = await invoke('/supports/all');

    expect(database.query).toHaveBeenCalledOnce();
    const sql = database.query.mock.calls[0][0] as string;
    expect(sql).toContain('ORDER BY ms.support_type ASC');
    expect(sql).toContain('LEFT JOIN template_files');
    expect(sql).not.toMatch(/\b(?:LIMIT|OFFSET)\b/i);
    const payload = response.json.mock.calls[0][0];
    expect(payload.supports).toHaveLength(51);
    expect(payload.supports[50]).toEqual({
      id: 'support-50',
      type: 'Bracket 50',
      manufacturer: 'ACME',
      heightMm: 100,
      widthMm: 200,
      lengthMm: null,
      weightKg: 1.25,
      unitPrice: 12.5,
      minimumOrderQuantity: 4,
      orderMeasurement: 'pcs',
      packaging: 'Box',
      source: 'Catalog',
      imageTemplateId: supportRow.image_template_id,
      imageTemplateFileName: 'bracket.png',
      imageTemplateContentType: 'image/png',
      createdAt: '2026-09-06T00:00:00.000Z',
      updatedAt: '2026-09-06T01:00:00.000Z',
    });

    const allRouteIndex = routes.findIndex((layer) => layer.route?.path === '/supports/all');
    const detailsRouteIndex = routes.findIndex(
      (layer) => layer.route?.methods.get && layer.route.path === '/supports/:supportId',
    );
    expect(allRouteIndex).toBeLessThan(detailsRouteIndex);
    expect(routes[allRouteIndex].route?.stack).toHaveLength(1);
  });

  it('preserves the existing paginated supports endpoint', async () => {
    database.query
      .mockResolvedValueOnce({ rows: [{ count: 51 }] })
      .mockResolvedValueOnce({ rows: [supportRow] });

    const response = await invoke('/supports', { page: '2', pageSize: '25' });

    expect(database.query).toHaveBeenLastCalledWith(expect.stringContaining('LIMIT $1 OFFSET $2'), [
      25,
      25,
    ]);
    expect(response.json).toHaveBeenCalledWith({
      supports: [expect.objectContaining({ id: supportRow.id })],
      pagination: expect.objectContaining({ page: 2, pageSize: 25, totalItems: 51, totalPages: 3 }),
    });
  });

  it('returns a controlled error when loading the full catalog fails', async () => {
    const error = new Error('Database unavailable');
    database.query.mockRejectedValueOnce(error);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const response = await invoke('/supports/all');
      expect(response.status).toHaveBeenCalledWith(500);
      expect(response.json).toHaveBeenCalledWith({ error: 'Failed to fetch supports' });
    } finally {
      consoleError.mockRestore();
    }
  });
});
