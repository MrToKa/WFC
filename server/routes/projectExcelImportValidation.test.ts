// @vitest-environment node

import type { Request, Response, Router } from 'express';
import * as XLSX from 'xlsx';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  connect: vi.fn(),
  ensureProjectExists: vi.fn(),
  snapshot: vi.fn(),
}));
vi.mock('../db.js', () => ({ pool: { query: mocks.query, connect: mocks.connect } }));
vi.mock('../services/projectService.js', () => ({
  ensureProjectExists: mocks.ensureProjectExists,
}));
vi.mock('../services/projectCableTypeSnapshotService.js', () => ({
  snapshotStandardMaterialsToProjectCableType: mocks.snapshot,
}));

import { cablesRouter } from './cablesRoutes.js';
import { cableTypesRouter } from './cableTypesRoutes.js';
import { traysRouter } from './traysRoutes.js';

type Handler = (req: Request, res: Response) => Promise<void>;
type Layer = {
  route?: { path: string; methods: Record<string, boolean>; stack: { handle: Handler }[] };
};
const id = '00000000-0000-4000-8000-000000000001';
const cableHeaders = [
  'Cable Id',
  'Type',
  'Tag',
  'From Location',
  'To Location',
  'Design Length [m]',
];
const validCable = [1, 'Cable type', 'C1', 'A', 'B', 10];

const handlerFor = (router: Router, path: string): Handler => {
  const route = (router as unknown as { stack: Layer[] }).stack.find(
    (layer) => layer.route?.path === path && layer.route.methods.post,
  )?.route;
  const handler = route?.stack.at(-1)?.handle;
  if (!handler) throw new Error(`Missing import route ${path}`);
  return handler;
};

const importSheet = async (
  router: Router,
  data: unknown[][],
  path = '/import',
  configure?: (sheet: XLSX.WorkSheet) => void,
) => {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(data);
  configure?.(sheet);
  XLSX.utils.book_append_sheet(workbook, sheet, 'Import');
  const response = { status: vi.fn(), json: vi.fn() };
  response.status.mockReturnValue(response);
  const request = {
    params: { projectId: id, cableTypeId: id },
    userId: id,
    file: {
      buffer: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
      originalname: 'import.xlsx',
    },
  } as unknown as Request;
  await handlerFor(router, path)(request, response as unknown as Response);
  return response;
};

const client = { query: vi.fn(), release: vi.fn() };
const assertNoWrites = () => {
  const calls = [...client.query.mock.calls, ...mocks.query.mock.calls];
  expect(calls.filter(([sql]) => /^\s*(?:INSERT|UPDATE|DELETE)\b/i.test(String(sql)))).toEqual([]);
};
const assertInvalid = (
  response: Awaited<ReturnType<typeof importSheet>>,
  column: string,
  row = 2,
) => {
  expect(response.status).toHaveBeenCalledWith(400);
  expect(response.json).toHaveBeenCalledWith(
    expect.objectContaining({
      error: expect.stringContaining('No data was changed'),
      issues: expect.arrayContaining([
        expect.objectContaining({ row, column, message: expect.any(String) }),
      ]),
    }),
  );
  assertNoWrites();
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.ensureProjectExists.mockResolvedValue({ id });
  mocks.connect.mockResolvedValue(client);
  client.query.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM cable_types') && sql.includes('lower(name) = ANY')) {
      if (sql.includes('source_material_cable_type_id')) return { rows: [], rowCount: 0 };
      return { rows: [{ id, name: 'Cable type' }], rowCount: 1 };
    }
    if (sql.includes('FROM material_cable_types')) {
      return {
        rows: [{ id, name: 'Cable type', diameter_mm: 12, weight_kg_per_m: 2 }],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 0 };
  });
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM cable_types') && sql.includes('LIMIT 1'))
      return { rows: [{ id, name: 'Cable type' }], rowCount: 1 };
    if (sql.includes('FROM material_cable_installation_materials'))
      return { rows: [{ type: 'Connector', name: 'Connector' }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
});

describe('project cable Excel validation', () => {
  it.each([
    { label: 'missing ID', column: 'Cable Id', index: 0, value: '' },
    { label: 'fractional ID', column: 'Cable Id', index: 0, value: 1.2 },
    { label: 'out-of-range ID', column: 'Cable Id', index: 0, value: 2147483648 },
    { label: 'invalid length', column: 'Design Length [m]', index: 5, value: 'ten' },
    { label: 'fractional length', column: 'Design Length [m]', index: 5, value: 1.2 },
    { label: 'negative length', column: 'Design Length [m]', index: 5, value: -1 },
    { label: 'out-of-range length', column: 'Design Length [m]', index: 5, value: 1000001 },
    { label: 'missing type', column: 'Type', index: 1, value: '' },
    { label: 'overlong tag', column: 'Tag', index: 2, value: 'x'.repeat(501) },
  ])('rejects $label before any writes', async ({ column, index, value }) => {
    const row = [...validCable];
    row[index] = value;
    assertInvalid(await importSheet(cablesRouter, [cableHeaders, row]), column);
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('reports the physical row after blank lines and prevents partial imports', async () => {
    assertInvalid(
      await importSheet(cablesRouter, [
        cableHeaders,
        validCable,
        [],
        [2, 'Cable type', '', '', '', 'bad'],
      ]),
      'Design Length [m]',
      4,
    );
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('rejects duplicate cable IDs including alternate numeric spelling', async () => {
    assertInvalid(
      await importSheet(cablesRouter, [cableHeaders, validCable, ['01', ...validCable.slice(1)]]),
      'Cable Id',
      3,
    );
  });

  it('reports unknown project cable types without importing known rows', async () => {
    assertInvalid(
      await importSheet(cablesRouter, [
        cableHeaders,
        validCable,
        [2, 'Missing type', '', '', '', 20],
      ]),
      'Type',
      3,
    );
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('rejects unknown MTO values with allowed values', async () => {
    const response = await importSheet(cablesRouter, [
      [...cableHeaders, 'MTO'],
      [...validCable, 'unknown'],
    ]);
    assertInvalid(response, 'MTO');
    expect(response.json.mock.calls[0][0].issues[0].message).toContain('Instrumentation');
  });

  it('keeps revision aliases, case-insensitive MTO and raw formatted numeric values', async () => {
    const response = await importSheet(
      cablesRouter,
      [
        [...cableHeaders, 'Rev.', 'MTO'],
        [1000, 'Cable type', 1, 'A', 'B', 10, 'R2', 'lv'],
      ],
      '/import',
      (sheet) => {
        sheet.A2.z = '#,##0';
        sheet.C2.z = '000';
        sheet.F2.z = '0.00" m"';
      },
    );
    expect(response.status).not.toHaveBeenCalled();
    const insert = client.query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO cables ('),
    );
    expect(insert?.[1][2]).toBe(1000);
    expect(insert?.[1][3]).toBe('R2');
    expect(insert?.[1][4]).toBe('LV');
    expect(insert?.[1][5]).toBe('001');
    expect(insert?.[1][11]).toBe(10);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ summary: { inserted: 1, updated: 0, skipped: 0 } }),
    );
  });
});

describe('project cable type Excel validation', () => {
  it('rejects missing names in populated rows', async () => {
    assertInvalid(
      await importSheet(cableTypesRouter, [
        ['Type', 'Purpose'],
        ['', 'Power'],
      ]),
      'Type',
    );
  });

  it('rejects duplicate case-insensitive names', async () => {
    assertInvalid(
      await importSheet(cableTypesRouter, [['Type'], ['Cable type'], [' cable TYPE ']]),
      'Type',
      3,
    );
  });

  it('reports an unknown material catalog type', async () => {
    assertInvalid(
      await importSheet(cableTypesRouter, [['Type'], ['Cable type'], ['Missing type']]),
      'Type',
      3,
    );
  });

  it('rejects aliases that resolve to the same catalog entry before inserts', async () => {
    assertInvalid(
      await importSheet(cableTypesRouter, [['Type'], ['Cable type'], ['Cable-type']]),
      'Type',
      3,
    );
  });

  it('imports a valid catalog alias and snapshots its standard materials', async () => {
    const response = await importSheet(cableTypesRouter, [['Type'], ['Cable-type']]);
    expect(response.status).not.toHaveBeenCalled();
    const insert = client.query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO cable_types'),
    );
    expect(insert?.[1][2]).toBe('Cable type');
    expect(mocks.snapshot).toHaveBeenCalledOnce();
  });

  it('updates an existing project type when the workbook uses a catalog alias', async () => {
    const defaultQuery = client.query.getMockImplementation()!;
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM cable_types') && sql.includes('lower(name) = ANY')) {
        return {
          rows: [{ id, name: 'Cable type', source_material_cable_type_id: id }],
          rowCount: 1,
        };
      }
      return defaultQuery(sql);
    });
    const response = await importSheet(cableTypesRouter, [['Type'], ['Cable-type']]);
    expect(response.status).not.toHaveBeenCalled();
    expect(
      client.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO cable_types')),
    ).toBe(false);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ summary: { inserted: 0, updated: 1, skipped: 0 } }),
    );
  });
});

describe('project tray Excel validation', () => {
  it.each(['bad', -1, 1000001, true, '0x10'])('rejects invalid dimensions: %s', async (value) => {
    assertInvalid(
      await importSheet(traysRouter, [
        ['Name', 'Width [mm]'],
        ['Tray 1', value],
      ]),
      'Width [mm]',
    );
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('rejects duplicate names without silently skipping a row', async () => {
    assertInvalid(await importSheet(traysRouter, [['Name'], ['Tray 1'], ['tray 1']]), 'Name', 3);
  });

  it('preserves supported dimension formats and optional free-text types', async () => {
    const response = await importSheet(
      traysRouter,
      [
        ['Name', 'Type', 'Width [mm]', 'Height [mm]', 'Length [mm]'],
        [1, 'Custom type', '300 mm', '1.200,5', 3000],
      ],
      '/import',
      (sheet) => {
        sheet.A2.z = '"Tray "000';
        sheet.E2.z = '#,##0';
      },
    );
    expect(response.status).not.toHaveBeenCalled();
    const insert = client.query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO trays'),
    );
    expect(insert?.[1].slice(2)).toEqual(['Tray 001', 'Custom type', null, 300, 1200.5, 3000]);
  });
});

describe('cable type default material Excel validation', () => {
  const path = '/:cableTypeId/default-materials/import';
  const headers = ['Material', 'Quantity', 'Unit', 'Remarks'];

  it.each([
    { label: 'unknown unit', row: ['Connector', 1, 'kg'], column: 'Unit' },
    { label: 'excessive quantity', row: ['Connector', 1000001, 'pcs'], column: 'Quantity' },
    { label: 'invalid quantity', row: ['Connector', 'several', 'pcs'], column: 'Quantity' },
    { label: 'missing quantity', row: ['Connector', '', 'pcs'], column: 'Quantity' },
    { label: 'missing unit', row: ['Connector', 1, ''], column: 'Unit' },
    { label: 'missing material', row: ['', 1, 'pcs'], column: 'Material' },
    {
      label: 'overlong remarks',
      row: ['Connector', 1, 'pcs', 'x'.repeat(2001)],
      column: 'Remarks',
    },
  ])('rejects $label without deleting existing materials', async ({ row, column }) => {
    assertInvalid(
      await importSheet(cableTypesRouter, [headers, ['Connector', 1, 'pcs'], [], row], path),
      column,
      4,
    );
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('reports unknown materials at the actual worksheet row', async () => {
    assertInvalid(
      await importSheet(cableTypesRouter, [headers, [], ['Missing', 1, 'pcs']], path),
      'Material',
      3,
    );
  });

  it('does not erase existing materials when a required identifier is hidden by Excel formatting', async () => {
    const response = await importSheet(cableTypesRouter, [headers, [1, '', '']], path, (sheet) => {
      sheet.A2.z = ';;;';
    });
    assertInvalid(response, 'Material');
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('rejects duplicate normalized rows before replacing existing materials', async () => {
    assertInvalid(
      await importSheet(
        cableTypesRouter,
        [headers, ['Connector', 1, 'pcs'], ['connector', 1, 'pcs']],
        path,
      ),
      'Material',
      3,
    );
  });

  it('keeps case-insensitive headers, decimal commas and different quantities for a material', async () => {
    const response = await importSheet(
      cableTypesRouter,
      [
        [' material ', 'QUANTITY', 'unit'],
        ['Connector', '2,5', 'pcs/m'],
        ['Connector', 3, 'pcs'],
      ],
      path,
    );
    expect(response.status).not.toHaveBeenCalled();
    const insert = client.query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO cable_type_default_materials'),
    );
    expect(insert?.[1][3]).toBe(2.5);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ summary: { imported: 2 } }),
    );
  });
});

describe.each([
  {
    name: 'cables',
    router: cablesRouter,
    headers: cableHeaders,
    path: '/import',
    required: 'Cable Id',
  },
  {
    name: 'cable types',
    router: cableTypesRouter,
    headers: ['Type'],
    path: '/import',
    required: 'Type',
  },
  { name: 'trays', router: traysRouter, headers: ['Name'], path: '/import', required: 'Name' },
  {
    name: 'default materials',
    router: cableTypesRouter,
    headers: ['Material', 'Quantity', 'Unit'],
    path: '/:cableTypeId/default-materials/import',
    required: 'Material',
  },
])('$name workbook structure', ({ router, headers, path, required }) => {
  it('rejects a header-only workbook', async () => {
    assertInvalid(await importSheet(router, [headers], path), 'Workbook');
  });

  it('rejects missing required headers', async () => {
    assertInvalid(await importSheet(router, [['Unrelated'], ['value']], path), required, 1);
  });
});
