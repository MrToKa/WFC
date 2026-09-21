// @vitest-environment node
import ExcelJS from 'exceljs';
import type { Request, Response } from 'express';
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
});

it.each(['', 'actions', 'unknown', 'tag,tag', ['tag', 'routing']])(
  'rejects invalid column selection %j',
  async (columns) => {
    const response = await runExport({ view: 'list', columns });
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.send).not.toHaveBeenCalled();
  },
);
