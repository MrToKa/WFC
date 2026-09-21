// @vitest-environment node
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import type { Request, Response } from 'express';
import JSZip from 'jszip';
import { beforeEach, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db.js', () => ({ pool: database }));
vi.mock('../services/projectService.js', () => ({
  ensureProjectExists: vi.fn().mockResolvedValue({ id: 'project', project_number: 'P1' }),
}));
import { cablesRouter } from './cablesRoutes.js';

type Handler = (req: Request, res: Response) => Promise<void>;
type Layer = {
  route?: { path: string; methods: Record<string, boolean>; stack: { handle: Handler }[] };
};
const handler = (cablesRouter as unknown as { stack: Layer[] }).stack
  .find((layer) => layer.route?.path === '/export' && layer.route.methods.get)!
  .route!.stack.at(-1)!.handle;

beforeEach(() => {
  database.query.mockReset();
  database.query.mockResolvedValue({
    rows: [
      {
        cable_id: 42,
        revision: 'A',
        mto: 'LV',
        tag: 'Cable 42',
        type_name: 'Type A',
        type_purpose: 'Power',
        type_diameter_mm: '12',
        type_weight_kg_per_m: '0.5',
        from_location: 'Panel A',
        to_location: 'Panel B',
        delivery: 'Delivered',
        routing: 'TRAY-01',
        design_length: '25',
      },
    ],
  });
});

const runExport = async (query: Record<string, unknown>) => {
  const res = { status: vi.fn(), json: vi.fn(), send: vi.fn(), setHeader: vi.fn() };
  res.status.mockReturnValue(res);
  await handler(
    { params: { projectId: 'project' }, query } as unknown as Request,
    res as unknown as Response,
  );
  return res;
};
const readSheet = async (response: Awaited<ReturnType<typeof runExport>>) => {
  expect(response.status).not.toHaveBeenCalled();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(response.send.mock.calls[0][0]);
  return workbook.getWorksheet('Cables')!;
};
const readSheetXml = async (response: Awaited<ReturnType<typeof runExport>>) => {
  const archive = await JSZip.loadAsync(response.send.mock.calls[0][0]);
  return archive.file('xl/worksheets/sheet1.xml')!.async('string');
};

it.each([undefined, 'cableId', 'routing,cableId,designLength'])(
  'locks the ID header and full column while leaving other exported columns editable: %s',
  async (columns) => {
    const response = await runExport({ view: 'list', ...(columns ? { columns } : {}) });
    const sheet = await readSheet(response);
    expect(await readSheetXml(response)).toContain('<sheetProtection sheet="1"');
    expect(sheet.getCell('A1').value).toBe('Cable Id');
    for (let column = 1; column <= sheet.columnCount; column++) {
      for (const row of [1, 2, 1000]) {
        // Excel cells are locked by default when no protection style is stored.
        expect(sheet.getCell(row, column).protection?.locked ?? true).toBe(column === 1);
      }
    }
  },
);

it('protects the exported sheet with password 123 while permitting formatting and filtering', async () => {
  const response = await runExport({ view: 'list', columns: 'cableId,tag' });
  const xml = await readSheetXml(response);
  const protection = xml.match(/<sheetProtection\b[^>]*\/>/)?.[0];
  expect(protection).toBeDefined();
  const attribute = (name: string) => {
    const match = protection!.match(new RegExp(`${name}="([^"]+)"`));
    expect(match).not.toBeNull();
    return match![1];
  };
  expect(attribute('sheet')).toBe('1');
  expect(attribute('autoFilter')).toBe('0');
  expect(attribute('formatCells')).toBe('0');
  expect(attribute('formatColumns')).toBe('0');
  expect(attribute('formatRows')).toBe('0');
  expect(attribute('algorithmName')).toBe('SHA-512');
  const salt = Buffer.from(attribute('saltValue'), 'base64');
  const spinCount = Number(attribute('spinCount'));
  expect(spinCount).toBe(100000);
  // Verify the password against the hash serialized into the actual XLSX file.
  let hash = createHash('sha512').update(salt).update(Buffer.from('123', 'utf16le')).digest();
  for (let index = 0; index < spinCount; index++) {
    const iteration = Buffer.alloc(4);
    iteration.writeUInt32LE(index);
    hash = createHash('sha512').update(hash).update(iteration).digest();
  }
  expect(attribute('hashValue')).toBe(hash.toString('base64'));
  const archive = await JSZip.loadAsync(response.send.mock.calls[0][0]);
  const tableXml = await archive.file('xl/tables/table1.xml')!.async('string');
  expect(tableXml).toContain('<autoFilter ref="A1:B2"');
});

it('does not protect the sheet or add ID when ID is not selected', async () => {
  const response = await runExport({ view: 'list', columns: 'tag,designLength' });
  expect(await readSheetXml(response)).not.toContain('<sheetProtection');
  expect((await readSheet(response)).getRow(1).values).toEqual([
    undefined, 'Tag', 'Design Length [m]',
  ]);
});

it('keeps empty optional cells editable alongside protected IDs', async () => {
  database.query.mockResolvedValue({ rows: [{ cable_id: 42, tag: null, design_length: null }] });
  const sheet = await readSheet(
    await runExport({ view: 'list', columns: 'cableId,tag,designLength' }),
  );
  expect(sheet.getCell('A2').protection?.locked ?? true).toBe(true);
  expect(sheet.getCell('B2').protection.locked).toBe(false);
  expect(sheet.getCell('C2').protection.locked).toBe(false);
});

it('exports only selected data columns in table order, with matching numeric values and formatting', async () => {
  const sheet = await readSheet(
    await runExport({ view: 'list', columns: 'designLength,typeName,tag,actions' }),
  );
  expect(sheet.getRow(1).values).toEqual([undefined, 'Tag', 'Type', 'Design Length [m]']);
  expect(sheet.getRow(2).values).toEqual([undefined, 'Cable 42', 'Type A', 25]);
  expect(sheet.columnCount).toBe(3);
  expect(sheet.getColumn(3).numFmt).toBe('#,##0');
});

it.each(['routing', 'all'])(
  'preserves the existing %s filter, type, MTO and sorting even for hidden fields',
  async (criteria) => {
    const query = {
      view: 'list',
      filter: ' TRAY-01 ',
      criteria,
      cableTypeId: 'type-1',
      mto: 'LV',
      sortColumn: 'routing',
      sortDirection: 'desc',
    };
    await runExport(query);
    const originalQuery = database.query.mock.calls[0];
    const sheet = await readSheet(await runExport({ ...query, columns: 'tag' }));
    expect(database.query.mock.calls[1]).toEqual(originalQuery);
    expect(originalQuery[0]).toContain("LOWER(COALESCE(c.routing, '')) LIKE $3");
    expect(originalQuery[0]).toContain('c.cable_type_id = $2');
    expect(originalQuery[0]).toContain('c.mto = $4');
    expect(originalQuery[0]).toContain(
      "ORDER BY LOWER(COALESCE(c.routing, '')) DESC, c.cable_id ASC",
    );
    expect(originalQuery[1]).toEqual(['project', 'type-1', '%tray-01%', 'LV']);
    expect(sheet.getRow(1).values).toEqual([undefined, 'Tag']);
    expect(sheet.getRow(2).values).toEqual([undefined, 'Cable 42']);
  },
);

it('keeps selected headers when no cables match', async () => {
  database.query.mockResolvedValue({ rows: [] });
  const sheet = await readSheet(await runExport({ view: 'list', columns: 'cableId,tag' }));
  expect(sheet.getRow(1).values).toEqual([undefined, 'Cable Id', 'Tag']);
  expect(sheet.columnCount).toBe(2);
  expect(sheet.getCell('A1').protection?.locked ?? true).toBe(true);
  expect(sheet.getCell('A2').protection?.locked ?? true).toBe(true);
  expect(sheet.getCell('B1').protection.locked).toBe(false);
  expect(sheet.getCell('B2').protection.locked).toBe(false);
});

it.each(['', 'actions', 'unknown', 'tag,tag', ['tag', 'routing']])(
  'rejects invalid column selection %j',
  async (columns) => {
    const response = await runExport({ view: 'list', columns });
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.send).not.toHaveBeenCalled();
  },
);
