// @vitest-environment node
import type { Request, Response } from 'express';
import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.mock('../db.js', () => ({ pool: db }));
import { materialsRouter } from './materialsRoutes.js';
import { createMaterialTraySchema, updateMaterialTraySchema } from '../validators.js';
import { mapMaterialTrayRow, type MaterialTrayRow } from '../models/materialTray.js';
const id = '00000000-0000-4000-8000-000000000001';
const row = { id, tray_type: 'KL 100', order_number: '00123-A', manufacturer: null, height_mm: null, rung_height_mm: null, width_mm: null, weight_kg_per_m: null, unit_price: 0, minimum_order_quantity: 1, order_measurement: 'pcs', packaging: 'pcs', created_at: '2026-01-01', updated_at: '2026-01-01' };
const invoke = async (method: string, path: string, request: object = {}) => {
  type Route = { path: string; methods: Record<string, boolean>; stack: { handle: (req: Request, res: Response) => Promise<void> }[] };
  const route = (materialsRouter as unknown as { stack: { route?: Route }[] }).stack.find(l => l.route?.path === path && l.route.methods[method])?.route;
  if (!route) throw new Error('Missing route');
  const res = { locals: {}, status: vi.fn().mockReturnThis(), json: vi.fn(), send: vi.fn(), setHeader: vi.fn() };
  await route.stack.at(-1)!.handle(request as Request, res as unknown as Response);
  return res;
};
const workbook = (headers: string[], values: (string | number)[]) => {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([headers, values]);
  if (headers.includes('Order number') && typeof values[1] === 'number') sheet.B2.z = '00000';
  XLSX.utils.book_append_sheet(book, sheet, 'Trays');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};
let client: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
beforeEach(() => {
  db.query.mockReset().mockResolvedValue({ rows: [row], rowCount: 1 });
  client = { query: vi.fn().mockResolvedValue({ rows: [{ id }], rowCount: 1 }), release: vi.fn() };
  db.connect.mockReset().mockResolvedValue(client);
});
describe('material tray order number', () => {
  it('accepts text, null and an order-number-only patch, rejects numbers and oversized text', () => {
    expect(createMaterialTraySchema.parse({ type: 'A', orderNumber: ' 001-A ' }).orderNumber).toBe('001-A');
    expect(updateMaterialTraySchema.parse({ orderNumber: null }).orderNumber).toBeNull();
    expect(updateMaterialTraySchema.parse({ orderNumber: '001-A' }).orderNumber).toBe('001-A');
    expect(createMaterialTraySchema.safeParse({ type: 'A', orderNumber: 123 }).success).toBe(false);
    expect(createMaterialTraySchema.safeParse({ type: 'A', orderNumber: 'x'.repeat(201) }).success).toBe(false);
    expect(mapMaterialTrayRow(row as MaterialTrayRow).orderNumber).toBe('00123-A');
  });
  it('persists text on create and exposes it in the response', async () => {
    const res = await invoke('post', '/trays', { body: { type: 'KL 100', orderNumber: ' 00123-A ' } });
    expect(res.status).toHaveBeenCalledWith(201);
    const insert = db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO material_trays'));
    expect(insert?.[0]).toContain('order_number');
    expect(insert?.[1].at(-1)).toBe('00123-A');
    expect(res.json).toHaveBeenCalledWith({ tray: expect.objectContaining({ orderNumber: '00123-A' }) });
  });
  it.each(['00123-A', null, ''])('persists an order-number-only patch: %s', async orderNumber => {
    const res = await invoke('patch', '/trays/:trayId', { params: { trayId: id }, body: { orderNumber } });
    expect(res.status).not.toHaveBeenCalled();
    const update = db.query.mock.calls.find(([sql]) => sql.includes('UPDATE material_trays'));
    expect(update?.[0]).toContain('order_number = $1');
    expect(update?.[1]).toEqual([orderNumber || null, id]);
  });
  it.each(['/trays/export', '/trays/template'])('includes a text column in %s', async path => {
    const res = await invoke('get', path);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(res.send.mock.calls[0][0]);
    const sheet = book.worksheets[0];
    let column = 0;
    sheet.getRow(1).eachCell((cell, index) => {
      if (cell.value === 'Order number') column = index;
    });
    expect(column).toBeGreaterThan(0);
    expect(sheet.getColumn(column).numFmt).toBe('@');
    if (path.endsWith('export')) {
      expect(sheet.getCell(2, column).value).toBe('00123-A');
      const imported = await invoke('post', '/trays/import', { file: { buffer: res.send.mock.calls[0][0] } });
      expect(imported.status).not.toHaveBeenCalled();
      const update = client.query.mock.calls.find(([sql]) => sql.includes('UPDATE material_trays'));
      expect(update?.[1].slice(-2)).toEqual([true, '00123-A']);
    }
  });
  it.each([
    { headers: ['Type', 'Order number'], values: ['KL 100', '00123-A'], expected: [true, '00123-A'] },
    { headers: ['Type', 'Order number'], values: ['KL 100', 123], expected: [true, '00123'] },
    { headers: ['Type', 'Order number'], values: ['KL 100', ''], expected: [true, null] },
    { headers: ['Type'], values: ['KL 100'], expected: [false, null] },
  ])('imports displayed order number and preserves a legacy missing column: $expected', async ({ headers, values, expected }) => {
    const res = await invoke('post', '/trays/import', { file: { buffer: workbook(headers, values) } });
    expect(res.status).not.toHaveBeenCalled();
    const update = client.query.mock.calls.find(([sql]) => sql.includes('UPDATE material_trays'));
    expect(update?.[0]).toContain('order_number = CASE WHEN $13 THEN $14 ELSE order_number END');
    expect(update?.[1].slice(-2)).toEqual(expected);
  });
  it('imports new trays with an order number', async () => {
    client.query.mockImplementation(async (sql: string) => ({ rows: [], rowCount: sql.includes('SELECT id FROM material_trays') ? 0 : 1 }));
    const res = await invoke('post', '/trays/import', { file: { buffer: workbook(['Type', 'Order number'], ['KL 100', '0001']) } });
    expect(res.status).not.toHaveBeenCalled();
    const insert = client.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO material_trays'));
    expect(insert?.[1].at(-1)).toBe('0001');
  });
});
