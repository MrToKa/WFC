// @vitest-environment node

import type { Request, Response, Router } from 'express';
import * as XLSX from 'xlsx';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

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
  return importBuffer(router, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer, path);
};

const importBuffer = async (router: Router, buffer: Buffer, path = '/import') => {
  const response = { status: vi.fn(), json: vi.fn() };
  response.status.mockReturnValue(response);
  const request = {
    params: { projectId: id, cableTypeId: id },
    userId: id,
    file: {
      buffer,
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
  client.query.mockImplementation(async (sql: string, values?: unknown[]) => {
    if (sql.includes('INSERT INTO trays')) return {
      rows: [{
        id: values![0], project_id: values![1], name: values![2], tray_type: values![3],
        purpose: values![4], width_mm: values![5], height_mm: values![6], length_mm: values![7],
        created_at: '2026-01-01', updated_at: '2026-01-01',
      }], rowCount: 1,
    };
    if (sql.includes('SELECT * FROM cable_types')) return { rows: [{ id, name: 'Cable type' }], rowCount: 1 };
    if (sql.includes('FROM users')) return { rows: [{ name: 'Editor' }], rowCount: 1 };
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
      expect.objectContaining({ summary: { inserted: 1, updated: 0, unchanged: 0, skipped: 0 } }),
    );
  });
});

describe('partial cable Excel imports', () => {
  const existingCable = {
    id: 'existing-cable', project_id: id, cable_id: 42,
    revision: 'A', mto: 'LV', tag: 'C42', cable_type_id: id, type_name: 'Cable type',
    from_location: 'Panel A', to_location: 'Panel B', routing: 'TRAY-01', delivery: 'Delivered',
    design_length: '25', install_length: '30', pull_date: '2026-01-02',
    connected_from: '2026-01-03', connected_to: '2026-01-04', tested: '2026-01-05',
    type_purpose: 'Power', type_diameter_mm: '12', type_weight_kg_per_m: '0.5',
    created_at: '2026-01-01', updated_at: '2026-01-01',
  };
  let existingCables: typeof existingCable[];

  beforeEach(() => {
    existingCables = [existingCable];
    const defaultQuery = client.query.getMockImplementation()!;
    client.query.mockImplementation(async (sql: string, values?: unknown[]) => {
      if (sql.includes('FROM cables c') && sql.includes('ANY($2::int[])')) {
        expect(sql).toContain('c.project_id = $1');
        expect(sql).toContain('FOR UPDATE OF c');
        expect(values?.[0]).toBe(id);
        const ids = values?.[1] as number[];
        return { rows: existingCables.filter((cable) => ids.includes(cable.cable_id)) };
      }
      return defaultQuery(sql, values);
    });
  });

  const cableUpdates = () => client.query.mock.calls.filter(([sql]) => /UPDATE cables\s+SET/.test(sql));
  const versions = () => client.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO cable_versions'));

  it.each([
    { inserted: 0, updated: 0, unchanged: 3 },
    { inserted: 0, updated: 1, unchanged: 0 },
    { inserted: 0, updated: 1, unchanged: 3 },
    { inserted: 1, updated: 0, unchanged: 0 },
    { inserted: 1, updated: 0, unchanged: 3 },
    { inserted: 1, updated: 1, unchanged: 0 },
    { inserted: 1, updated: 1, unchanged: 3 },
  ])('reports every valid outcome combination: %j', async (counts) => {
    existingCables = Array.from({ length: 5 }, (_, index) => ({
      ...existingCable, cable_id: 42 + index, id: `cable-${42 + index}`, tag: `C${42 + index}`,
    }));
    const data: unknown[][] = [['ID', 'Type', 'Tag']];
    if (counts.inserted) data.push([99, 'Cable type', 'New']);
    if (counts.updated) data.push([42, 'Cable type', 'Updated']);
    for (let index = 0; index < counts.unchanged; index++) {
      data.push([43 + index, 'Cable type', `C${43 + index}`]);
    }
    const response = await importSheet(cablesRouter, data);
    expect(response.status).not.toHaveBeenCalled();
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      summary: { ...counts, skipped: 0 },
    }));
    const inserts = client.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO cables ('));
    expect(inserts).toHaveLength(counts.inserted);
    const updates = cableUpdates().filter(([sql]) => /SET\s+tag =/.test(sql));
    expect(updates).toHaveLength(counts.updated);
    if (counts.updated) expect(updates[0][1]).toEqual(['Updated', 'cable-42']);
    expect(versions()).toHaveLength(counts.inserted + counts.updated);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.query.mock.calls.some(([sql]) => /DELETE FROM cables\b/.test(sql))).toBe(false);
  });

  it.each([
    ['Revision', 'revision', 'B'], ['Rev.', 'revision', 'B'], ['MTO', 'mto', 'MV'],
    ['Tag', 'tag', 'New tag'], ['From Location', 'from_location', 'Panel C'],
    ['To Location', 'to_location', 'Panel D'], ['Routing', 'routing', 'TRAY-02'],
    ['Delivery', 'delivery', 'Pending'], ['Design Length [m]', 'design_length', 35],
  ])('updates only the supplied %s field', async (header, column, value) => {
    const response = await importSheet(cablesRouter, [['ID', header], [42, value]]);
    expect(response.status).not.toHaveBeenCalled();
    expect(cableUpdates()).toHaveLength(1);
    expect(cableUpdates()[0][0]).toContain(`${column} = $1`);
    expect(cableUpdates()[0][1]).toEqual([value, 'existing-cable']);
    expect(versions()).toHaveLength(1);
    expect(response.json.mock.calls[0][0].summary).toEqual({ inserted: 0, updated: 1, unchanged: 0, skipped: 0 });
  });

  it.each([
    ['Revision', ' A '], ['Rev.', 'A'], ['MTO', 'lv'], ['Tag', ' C42 '],
    ['From Location', 'Panel A'], ['To Location', 'Panel B'], ['Routing', 'TRAY-01'],
    ['Delivery', 'Delivered'], ['Design Length [m]', '25.0'], ['Type', 'cable TYPE'],
  ])('recognizes equivalent %s values as unchanged', async (header, value) => {
    const response = await importSheet(cablesRouter, [['ID', header], [42, value]]);
    expect(response.status).not.toHaveBeenCalled();
    expect(response.json.mock.calls[0][0].summary).toEqual({ inserted: 0, updated: 0, unchanged: 1, skipped: 0 });
    assertNoWrites();
  });

  it.each(['ID', 'Cable Id', 'Cable ID'])('updates by %s alone, preserving omitted fields, type and materials', async (header) => {
    const response = await importSheet(cablesRouter, [[header, 'Tag'], [42, 'Renamed']]);
    expect(response.status).not.toHaveBeenCalled();
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      summary: { inserted: 0, updated: 1, unchanged: 0, skipped: 0 },
    }));
    expect(cableUpdates()).toHaveLength(1);
    expect(cableUpdates()[0][0]).toMatch(/SET\s+tag = \$1,\s+updated_at = NOW\(\)\s+WHERE id = \$2/);
    expect(cableUpdates()[0][1]).toEqual(['Renamed', 'existing-cable']);
    expect(client.query.mock.calls.some(([sql]) => /(?:INSERT INTO|UPDATE|DELETE FROM) cable_materials/.test(sql))).toBe(false);
    expect(versions()).toHaveLength(1);
    expect(versions()[0][1].slice(1, 22)).toEqual([
      'existing-cable', 1, 'update', 'import', 42, 'A', 'LV', 'Renamed', id, 'Cable type',
      'Panel A', 'Panel B', 'TRAY-01', 'Delivered', 25, 30, '2026-01-02', '2026-01-03',
      '2026-01-04', '2026-01-05', id,
    ]);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  it.each([
    ['Tag', 'tag'], ['Design Length [m]', 'design_length'], ['MTO', 'mto'],
    ['Revision', 'revision'], ['From Location', 'from_location'], ['To Location', 'to_location'],
    ['Routing', 'routing'], ['Delivery', 'delivery'],
  ])('clears a blank %s while preserving omitted fields', async (header, column) => {
    const response = await importSheet(cablesRouter, [['ID', header], [42, '']]);
    expect(response.status).not.toHaveBeenCalled();
    expect(cableUpdates()).toHaveLength(1);
    expect(cableUpdates()[0][0]).toContain(`${column} = $1`);
    expect(cableUpdates()[0][1]).toEqual([null, 'existing-cable']);
  });

  it.each([
    [['ID'], [42]],
    [['ID', 'Tag'], [42, 'C42']],
  ])('reports unchanged or ID-only rows without creating revisions: %j', async (...data) => {
    const response = await importSheet(cablesRouter, data);
    expect(response.status).not.toHaveBeenCalled();
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      summary: { inserted: 0, updated: 0, unchanged: 1, skipped: 0 },
    }));
    assertNoWrites();
  });

  it('rejects missing ID and duplicate ID aliases before opening a transaction', async () => {
    assertInvalid(await importSheet(cablesRouter, [['Tag'], ['Changed']]), 'Cable Id', 1);
    assertInvalid(await importSheet(cablesRouter, [['ID', 'Cable Id', 'Tag'], [42, 42, 'Changed']]), 'Cable Id', 1);
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('rejects duplicate IDs in a partial file before any changes', async () => {
    assertInvalid(await importSheet(cablesRouter, [['ID', 'Tag'], [42, 'First'], ['042', 'Second']]), 'ID', 3);
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('rejects a missing cable without Type before modifying any other row', async () => {
    const response = await importSheet(cablesRouter, [['ID', 'Tag'], [42, 'Changed'], [], [99, 'Unknown']]);
    assertInvalid(response, 'ID', 4);
    expect(response.json.mock.calls[0][0].issues[0].message).toContain('not found in this project');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('rejects a blank Type when the column is supplied for an existing cable', async () => {
    assertInvalid(await importSheet(cablesRouter, [['ID', 'Type'], [42, '']]), 'Type');
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it.each([
    ['ID', -1], ['ID', true], ['ID', 'not an ID'], ['ID', ''],
    ['Design Length [m]', true], ['Design Length [m]', 'Infinity'],
    ['MTO', 'Unknown'], ['Type', 'Unknown'], ['Revision', 'R'.repeat(501)],
    ['Tag', 'T'.repeat(501)], ['From Location', 'F'.repeat(501)],
    ['To Location', 'T'.repeat(501)], ['Routing', 'R'.repeat(501)], ['Delivery', 'D'.repeat(501)],
  ])('rejects invalid %s without saving an earlier valid change', async (header, invalid) => {
    const data = header === 'ID'
      ? [['ID', 'Tag'], [42, 'Changed'], [invalid, 'Another']]
      : [['ID', header], [42, header === 'Type' ? 'Cable type' : header === 'MTO' ? 'MV' : header === 'Design Length [m]' ? 30 : 'Changed'], [43, invalid]];
    assertInvalid(await importSheet(cablesRouter, data), header as string, 3);
  });

  it('counts only populated rows, ignoring blank lines and trailing whitespace', async () => {
    const response = await importSheet(cablesRouter, [['ID', 'Tag'], [], [42, 'C42'], [], [' ', ' ']]);
    expect(response.status).not.toHaveBeenCalled();
    expect(response.json.mock.calls[0][0].summary).toEqual({ inserted: 0, updated: 0, unchanged: 1, skipped: 0 });
    assertNoWrites();
  });

  it('rejects an entirely empty workbook as a validation error', async () => {
    assertInvalid(await importSheet(cablesRouter, []), 'Workbook', 1);
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('treats a repeated import as unchanged after the first update', async () => {
    const data = [['ID', 'Tag'], [42, 'Changed']];
    const first = await importSheet(cablesRouter, data);
    expect(first.json.mock.calls[0][0].summary).toEqual({ inserted: 0, updated: 1, unchanged: 0, skipped: 0 });
    existingCables = [{ ...existingCable, tag: 'Changed' }];
    client.query.mockClear();
    const second = await importSheet(cablesRouter, data);
    expect(second.status).not.toHaveBeenCalled();
    expect(second.json.mock.calls[0][0].summary).toEqual({ inserted: 0, updated: 0, unchanged: 1, skipped: 0 });
    assertNoWrites();
  });

  it('rolls back an update when writing its revision fails and never reports completion', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    onTestFinished(() => log.mockRestore());
    const originalQuery = client.query.getMockImplementation()!;
    client.query.mockImplementation(async (sql: string, values?: unknown[]) => {
      if (sql.includes('INSERT INTO cable_versions')) throw new Error('Write failed');
      return originalQuery(sql, values);
    });
    const response = await importSheet(cablesRouter, [['ID', 'Tag'], [42, 'Changed']]);
    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({ error: 'Failed to import cables' });
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.query).not.toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('preserves updated and unchanged totals if the post-commit refresh fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    onTestFinished(() => log.mockRestore());
    existingCables = [existingCable, { ...existingCable, id: 'second-cable', cable_id: 43 }];
    mocks.query.mockRejectedValue(new Error('Refresh failed'));
    const response = await importSheet(cablesRouter, [['ID', 'Tag'], [42, 'Changed'], [43, 'C42']]);
    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      error: 'Cables imported but failed to refresh list',
      summary: { inserted: 0, updated: 1, unchanged: 1, skipped: 0 },
    });
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.query).not.toHaveBeenCalledWith('ROLLBACK');
  });

  it('still creates new cables when ID and Type are supplied', async () => {
    const response = await importSheet(cablesRouter, [['ID', 'Type'], [99, 'Cable type']]);
    expect(response.status).not.toHaveBeenCalled();
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      summary: { inserted: 1, updated: 0, unchanged: 0, skipped: 0 },
    }));
    const insert = client.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO cables ('));
    expect(insert?.[1].slice(2, 12)).toEqual([99, null, null, null, id, null, null, null, null, null]);
  });

  it('round-trips a filtered ID/Tag export and updates only the included cable and field', async () => {
    mocks.ensureProjectExists.mockResolvedValue({ id, project_number: 'P1' });
    mocks.query.mockResolvedValue({ rows: [existingCable] });
    const exportHandler = (cablesRouter as unknown as { stack: Layer[] }).stack.find(
      (layer) => layer.route?.path === '/export' && layer.route.methods.get,
    )!.route!.stack.at(-1)!.handle;
    const response = { status: vi.fn(), json: vi.fn(), send: vi.fn(), setHeader: vi.fn() };
    response.status.mockReturnValue(response);
    await exportHandler({
      params: { projectId: id }, query: { view: 'list', columns: 'cableId,tag', filter: 'TRAY-01', criteria: 'routing' },
    } as unknown as Request, response as unknown as Response);
    expect(response.status).not.toHaveBeenCalled();
    expect(mocks.query.mock.calls[0][1]).toEqual([id, '%tray-01%']);
    const workbook = XLSX.read(response.send.mock.calls[0][0], { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    expect(XLSX.utils.sheet_to_json(sheet, { header: 1 })).toEqual([['Cable Id', 'Tag'], [42, 'C42']]);
    sheet.B2 = { t: 's', v: 'Edited in Excel' };
    const result = await importBuffer(cablesRouter, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
    expect(result.status).not.toHaveBeenCalled();
    expect(cableUpdates()).toHaveLength(1);
    expect(cableUpdates()[0][1]).toEqual(['Edited in Excel', 'existing-cable']);
    const selected = client.query.mock.calls.find(([sql]) => sql.includes('c.cable_id = ANY'));
    expect(selected?.[1]).toEqual([id, [42]]);
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
])('$name workbook structure', ({ router, headers, path, required }) => {
  it('rejects a header-only workbook', async () => {
    assertInvalid(await importSheet(router, [headers], path), 'Workbook');
  });

  it('rejects missing required headers', async () => {
    assertInvalid(await importSheet(router, [['Unrelated'], ['value']], path), required, 1);
  });
});
