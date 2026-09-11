// @vitest-environment node

import type { Request, Response } from 'express';
import * as XLSX from 'xlsx';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.mock('../db.js', () => ({ pool: database }));

import { materialsRouter } from './materialsRoutes.js';

type Handler = (request: Request, response: Response) => Promise<void>;
type Route = {
  path: string;
  methods: Record<string, boolean>;
  stack: Array<{ handle: Handler }>;
};
type Cell = string | number | boolean | null;

const curveId = '00000000-0000-4000-8000-000000000001';
const curveRow = {
  id: curveId,
  name: 'Curve A',
  description: null,
  tray_id: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z'
};

const workbookBuffer = (rows: Cell[][], sheetName = 'Materials'): Buffer => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheetName);
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};

const invoke = async (path: string, buffer: Buffer, loadCurveId = curveId) => {
  const routes = (materialsRouter as unknown as { stack: Array<{ route?: Route }> }).stack;
  const route = routes.find((layer) => layer.route?.methods.post && layer.route.path === path)?.route;
  if (!route) throw new Error(`Missing POST ${path}`);
  const response = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis()
  };
  await route.stack[route.stack.length - 1].handle(
    {
      params: { loadCurveId },
      file: { buffer, originalname: 'materials.xlsx' }
    } as unknown as Request,
    response as unknown as Response
  );
  return response;
};

const createClient = () => ({
  query: vi.fn(async (sql: string, _values?: unknown[]) => {
    if (sql.includes('SELECT id FROM material_load_curves')) {
      return { rowCount: 1, rows: [{ id: curveId }] };
    }
    if (sql.includes('WHERE lc.id = $1')) {
      return { rowCount: 1, rows: [curveRow] };
    }
    return { rowCount: 0, rows: [] };
  }),
  release: vi.fn()
});

let client: ReturnType<typeof createClient>;

const expectRejected = (
  response: Awaited<ReturnType<typeof invoke>>,
  row: number,
  column: string
) => {
  expect(response.status).toHaveBeenCalledWith(400);
  expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
    error: expect.stringContaining('No data was changed'),
    issues: expect.arrayContaining([expect.objectContaining({ row, column, message: expect.any(String) })]),
    totalIssues: expect.any(Number)
  }));
  expect(database.connect).not.toHaveBeenCalled();
  expect(client.query).not.toHaveBeenCalled();
};

beforeEach(() => {
  vi.clearAllMocks();
  client = createClient();
  database.query.mockResolvedValue({ rowCount: 0, rows: [] });
  database.connect.mockResolvedValue(client);
});

describe.each([
  { catalog: 'trays', path: '/trays/import', table: 'material_trays', dimension: 'Rung height [mm]', weight: 'Weight [kg/m]' },
  { catalog: 'supports', path: '/supports/import', table: 'material_supports', dimension: 'Length [mm]', weight: 'Weight [kg]' }
])('$catalog Excel validation', ({ path, table, dimension, weight }) => {
  it.each([
    { column: 'Type', value: '', label: 'blank type' },
    { column: 'Type', value: 'a'.repeat(201), label: 'too long type' },
    { column: 'Manufacturer', value: 'a'.repeat(201), label: 'too long manufacturer' },
    { column: 'Height [mm]', value: 'forty', label: 'non-numeric height' },
    { column: 'Width [mm]', value: -1, label: 'negative width' },
    { column: 'Height [mm]', value: 1_000_001, label: 'out of range height' },
    { column: 'Price', value: -1, label: 'negative price' },
    { column: 'Price', value: 'twelve', label: 'non-numeric price' },
    { column: 'Price', value: 'Infinity', label: 'infinite price' },
    { column: 'Price', value: true, label: 'boolean price' },
    { column: 'Minimum order quantity', value: 0, label: 'zero order quantity' },
    { column: 'Minimum order quantity', value: 1_000_001, label: 'out of range order quantity' },
    { column: 'Minimum order quantity', value: 'many', label: 'non-numeric order quantity' },
    { column: 'Order measurement', value: 'kilometers', label: 'invalid order measurement' },
    { column: 'Packaging', value: 'Boxes', label: 'invalid packaging' }
  ])('rejects $label with its physical row and column before writes', async ({ column, value }) => {
    const headers = column === 'Type' ? ['Type', 'Price'] : ['Type', column];
    const invalid = column === 'Type' ? [value, 1] : ['Bad material', value];
    const response = await invoke(path, workbookBuffer([
      headers,
      ['Valid material', null],
      [],
      invalid
    ]));
    expectRejected(response, 4, column);
  });

  it.each([dimension, weight])('rejects an invalid optional %s value', async (column) => {
    const response = await invoke(path, workbookBuffer([['Type', column], ['A', 'unknown']]));
    expectRejected(response, 2, column);
  });

  it('rejects a missing required header', async () => {
    const response = await invoke(path, workbookBuffer([['Manufacturer'], ['Maker']]));
    expectRejected(response, 1, 'Type');
  });

  it('rejects header-only workbooks instead of reporting success', async () => {
    const response = await invoke(path, workbookBuffer([['Type', 'Price']]));
    expectRejected(response, 2, 'Workbook');
  });

  it('rejects repeated type headers instead of choosing one silently', async () => {
    const response = await invoke(path, workbookBuffer([['Type', 'Type'], ['A', 'B']]));
    expectRejected(response, 1, 'Type');
  });

  it('rejects duplicate types using the same whitespace and case normalization as writes', async () => {
    const response = await invoke(path, workbookBuffer([
      ['Type'], ['Tray  A'], [], [' tray a ']
    ]));
    expectRejected(response, 4, 'Type');
    expect(response.json.mock.calls[0][0].issues[0].message).toContain('row 2');
  });

  it('accepts absent optional fields and preserves default insert values', async () => {
    const response = await invoke(path, workbookBuffer([['Type'], ['Minimal material']]));
    expect(response.status).not.toHaveBeenCalled();
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      summary: { totalRows: 1, created: 1, updated: 0, skipped: 0 }
    }));
    const insert = client.query.mock.calls.find(([sql]) => sql.includes(`INSERT INTO ${table}`));
    expect(insert?.[1]?.slice(1, 8)).toEqual(['Minimal material', null, null, null, null, null, 0]);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('ignores rows containing only whitespace', async () => {
    const response = await invoke(path, workbookBuffer([['Type', 'Price'], ['Material A', 0], ['  ', '  ']]));
    expect(response.status).not.toHaveBeenCalled();
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      summary: { totalRows: 1, created: 1, updated: 0, skipped: 0 }
    }));
  });

  it('preserves displayed type identifiers while importing raw numeric prices', async () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([['Type', 'Price'], [1, 1234.5], ['1', 0]]);
    sheet.A2.z = '000';
    sheet.B2.z = '"$"#,##0.00';
    XLSX.utils.book_append_sheet(workbook, sheet, 'Materials');

    const response = await invoke(path, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
    expect(response.status).not.toHaveBeenCalled();
    const inserts = client.query.mock.calls.filter(([sql]) => sql.includes(`INSERT INTO ${table}`));
    expect(inserts.map(([, values]) => values?.[1])).toEqual(['001', '1']);
    expect(inserts[0][1]?.[7]).toBe(1234.5);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      summary: { totalRows: 2, created: 2, updated: 0, skipped: 0 }
    }));
  });

  it('accepts decimal commas, zero dimensions, and established order measurement casing', async () => {
    const response = await invoke(path, workbookBuffer([
      ['Type', 'Height [mm]', dimension, weight, 'Price', 'Minimum order quantity', 'Order measurement', 'Packaging'],
      ['Material A', 0, '12,5', '1,75', '2,5', '0,5', 'PCS', 'Box']
    ]));
    expect(response.status).not.toHaveBeenCalled();
    const insert = client.query.mock.calls.find(([sql]) => sql.includes(`INSERT INTO ${table}`));
    expect(insert?.[1]).toEqual(expect.arrayContaining([0, 12.5, 1.75, 2.5, 0.5, 'pcs', 'Box']));
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  it('returns a validation error for a corrupt Excel archive', async () => {
    const response = await invoke(path, Buffer.from('PK\x03\x04broken archive'));
    expectRejected(response, 1, 'File');
  });
});

describe('tray load curve references', () => {
  it('rejects an unknown reference before creating any tray', async () => {
    const response = await invoke('/trays/import', workbookBuffer([
      ['Type', 'Load curve'], ['Valid tray', null], [], ['Invalid tray', 'Missing curve']
    ]));
    expectRejected(response, 4, 'Load curve');
    expect(response.json.mock.calls[0][0].issues[0].message).toContain('Missing curve');
  });

  it('resolves existing names using case and whitespace normalization', async () => {
    database.query.mockResolvedValueOnce({ rows: [{ id: curveId, name: 'Curve A' }] });
    const response = await invoke('/trays/import', workbookBuffer([
      ['Type', 'Load curve'], ['Tray A', ' curve  a ']
    ]));
    expect(response.status).not.toHaveBeenCalled();
    const insert = client.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO material_trays'));
    expect(insert?.[1]?.[8]).toBe(curveId);
  });
});

describe('load curve Excel validation', () => {
  const path = '/load-curves/:loadCurveId/import';
  const headers = ['L [m]', 'q(L) [kN/m]'];
  const upload = (rows: Cell[][]) => invoke(path, workbookBuffer(rows, 'CurveData'));

  it.each([
    { span: 'oops', load: 2, column: headers[0], label: 'non-numeric span' },
    { span: -1, load: 2, column: headers[0], label: 'negative span' },
    { span: null, load: 2, column: headers[0], label: 'missing span' },
    { span: 3, load: null, column: headers[1], label: 'missing load' },
    { span: 3, load: -1, column: headers[1], label: 'negative load' },
    { span: 3, load: 'NaN', column: headers[1], label: 'non-finite load' }
  ])('rejects $label instead of replacing the curve with a partial import', async ({ span, load, column }) => {
    const response = await upload([headers, [1, 2], [], [span, load]]);
    expectRejected(response, 4, column);
  });

  it('requires the named template sheet', async () => {
    const response = await invoke(path, workbookBuffer([headers, [1, 2]], 'Wrong sheet'));
    expectRejected(response, 1, 'Workbook');
    expect(response.json.mock.calls[0][0].issues[0].message).toContain('CurveData');
  });

  it('validates column headers instead of interpreting arbitrary columns as points', async () => {
    const response = await upload([['Length', 'Load'], [1, 2]]);
    expectRejected(response, 1, headers[0]);
  });

  it('rejects empty curve data', async () => {
    const response = await upload([headers]);
    expectRejected(response, 2, 'Workbook');
  });

  it('rejects duplicate spans even if their text formatting differs', async () => {
    const response = await upload([headers, [1, 2], ['1,0', 3]]);
    expectRejected(response, 3, headers[0]);
  });

  it('rejects points exceeding the limit instead of silently truncating them', async () => {
    const response = await upload([headers, ...Array.from({ length: 2001 }, (_, index) => [index, 2])]);
    expectRejected(response, 2002, 'Workbook');
    expect(response.json.mock.calls[0][0].issues[0].message).toContain('2000');
  });

  it('imports reordered template columns, sorts spans, and accepts zero and decimal commas', async () => {
    const response = await upload([[headers[1], headers[0]], ['2,5', '1,5'], [], ['  ', '  '], [0, 0]]);
    expect(response.status).not.toHaveBeenCalled();
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ summary: { importedPoints: 2 } }));
    const insert = client.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO material_load_curve_points'));
    expect(insert?.[1]).toEqual([
      expect.any(String), curveId, 1, 0, 0,
      expect.any(String), curveId, 2, 1.5, 2.5
    ]);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('returns a validation error for a corrupt Excel archive', async () => {
    const response = await invoke(path, Buffer.from('PK\x03\x04broken archive'));
    expectRejected(response, 1, 'File');
  });
});
