// @vitest-environment node

import type { Request, Response, Router } from 'express';
import * as XLSX from 'xlsx';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const databaseMocks = vi.hoisted(() => ({ pool: { connect: vi.fn(), query: vi.fn() } }));
vi.mock('../db.js', () => ({ pool: databaseMocks.pool }));

import { materialCableTypesRouter } from './materialCableTypesRoutes.js';
import { materialCableInstallationMaterialsRouter } from './materialCableInstallationMaterialsRoutes.js';
import { materialTrayInstallationMaterialsRouter } from './materialTrayInstallationMaterialsRoutes.js';
import {
  materialInstrumentsRouter,
  materialInstrumentInstallationMaterialsRouter,
} from './materialInstrumentsRoutes.js';

const catalogs = [
  { name: 'cable types', router: materialCableTypesRouter, weight: 'Weight [kg/m]' },
  {
    name: 'cable installation materials',
    router: materialCableInstallationMaterialsRouter,
    weight: 'Weight [kg]',
  },
  {
    name: 'tray installation materials',
    router: materialTrayInstallationMaterialsRouter,
    weight: 'Weight [kg]',
  },
  { name: 'instruments', router: materialInstrumentsRouter, weight: 'Weight [kg]' },
  {
    name: 'instrument installation materials',
    router: materialInstrumentInstallationMaterialsRouter,
    weight: 'Weight [kg]',
  },
];

const invoke = async (router: Router, worksheet: XLSX.WorkSheet) => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Materials');
  const request = {
    file: {
      buffer: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }),
      originalname: 'materials.xlsx',
    },
  } as unknown as Request;
  const response = { status: vi.fn(), json: vi.fn() };
  response.status.mockReturnValue(response);
  const layer = (
    router as unknown as {
      stack: Array<{
        route?: {
          path: string;
          stack: Array<{ handle: (req: Request, res: Response) => Promise<void> }>;
        };
      }>;
    }
  ).stack.find((item) => item.route?.path === '/import');
  await layer!.route!.stack.at(-1)!.handle(request, response as unknown as Response);
  return response;
};

describe.each(catalogs)('$name Excel validation', ({ router, weight }) => {
  beforeEach(() => {
    vi.clearAllMocks();
    databaseMocks.pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
    databaseMocks.pool.connect.mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    });
  });

  it.each([
    { column: 'Price', value: -1 },
    { column: 'Price', value: 'not a price' },
    { column: 'Price', value: true },
    { column: 'Minimum order quantity', value: 0 },
    { column: 'Minimum order quantity', value: 1_000_001 },
    { column: 'Order measurement', value: 'kilograms' },
    { column: 'Packaging', value: 'crate' },
    { column: 'Type', value: 'X'.repeat(201) },
  ])('rejects invalid $column before any database writes', async ({ column, value }) => {
    const sheet = XLSX.utils.json_to_sheet([
      { Type: 'Valid material' },
      { Type: 'Invalid material', [column]: value },
    ]);
    const response = await invoke(router, sheet);
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.stringContaining('No data was changed'),
        issues: expect.arrayContaining([
          expect.objectContaining({ row: 3, column, message: expect.any(String) }),
        ]),
      }),
    );
    expect(databaseMocks.pool.connect).not.toHaveBeenCalled();
    expect(databaseMocks.pool.query).not.toHaveBeenCalled();
  });

  it.each([-1, 'bad weight', 1_000_001])('rejects invalid weight %s', async (value) => {
    const response = await invoke(
      router,
      XLSX.utils.json_to_sheet([{ Type: 'Material', [weight]: value }]),
    );
    expect(response.status).toHaveBeenCalledWith(400);
    expect(databaseMocks.pool.connect).not.toHaveBeenCalled();
  });

  it('reports actual Excel row numbers after blank rows and case-insensitive duplicates', async () => {
    const response = await invoke(
      router,
      XLSX.utils.aoa_to_sheet([['Type', 'Price'], ['Material', 1], [], [' material ', 2], ['', 3]]),
    );
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        issues: expect.arrayContaining([
          { row: 4, column: 'Type', message: expect.stringContaining('row 2') },
          { row: 5, column: 'Type', message: 'A value is required.' },
        ]),
      }),
    );
    expect(databaseMocks.pool.connect).not.toHaveBeenCalled();
  });

  it.each([
    [['Other'], ['Material']],
    [['Type']],
    [
      ['Type', 'Name'],
      ['Material', 'Ambiguous material'],
    ],
    [
      ['Type', 'Type'],
      ['Material', 'Ambiguous material'],
    ],
  ])('rejects missing data or incorrect headers (%j)', async (...rows) => {
    const response = await invoke(router, XLSX.utils.aoa_to_sheet(rows));
    expect(response.status).toHaveBeenCalledWith(400);
    expect(databaseMocks.pool.connect).not.toHaveBeenCalled();
  });

  it('imports supported aliases, comma decimals, zero price, and optional blank values', async () => {
    const response = await invoke(
      router,
      XLSX.utils.json_to_sheet([
        {
          Name: 'Material',
          'Unit Price': 0,
          [weight]: '2,5',
          'Minimum order quantity': 0.5,
          'Order measurement': 'pack',
          Packaging: 'Box',
          Description: '',
        },
      ]),
    );
    expect(response.status).not.toHaveBeenCalled();
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ summary: { inserted: 1, updated: 0, skipped: 0 } }),
    );
  });

  it('uses the underlying Excel number when its display format includes thousand separators', async () => {
    const sheet = XLSX.utils.json_to_sheet([{ Type: 'Material', Price: 1234.5 }]);
    sheet.B2.z = '#,##0.00';
    const response = await invoke(router, sheet);
    expect(response.status).not.toHaveBeenCalled();
    const client = await databaseMocks.pool.connect.mock.results[0].value;
    const insert = client.query.mock.calls.find(([sql]: [string]) => sql.includes('INSERT INTO'));
    expect(insert[1]).toContain(1234.5);
  });

  it('preserves formatted material identifiers such as leading zeroes', async () => {
    const sheet = XLSX.utils.json_to_sheet([{ Type: 1, Price: 2 }]);
    sheet.A2.z = '000';
    const response = await invoke(router, sheet);
    expect(response.status).not.toHaveBeenCalled();
    const client = await databaseMocks.pool.connect.mock.results[0].value;
    const insert = client.query.mock.calls.find(([sql]: [string]) => sql.includes('INSERT INTO'));
    expect(insert[1]).toContain('001');
  });
});

describe('installation material source validation', () => {
  it.each(catalogs.slice(1))('rejects non-web links for $name', async ({ router }) => {
    vi.clearAllMocks();
    const response = await invoke(
      router,
      XLSX.utils.json_to_sheet([{ Type: 'Material', Source: 'file:///local/document' }]),
    );
    expect(response.status).toHaveBeenCalledWith(400);
    expect(databaseMocks.pool.connect).not.toHaveBeenCalled();
  });
});
