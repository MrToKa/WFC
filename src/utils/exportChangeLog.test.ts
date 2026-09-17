// @vitest-environment node
import { expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { buildChangeLogWorkbook } from './exportChangeLog';

it('creates a readable Excel workbook with complete text, timestamps, items and revisions', () => {
  const entries = Array.from({ length: 23 }, (_, i) => ({
    id: String(i),
    userId: 'u',
    userName: 'Иван',
    changedAt: '2026-09-17T12:30:00Z',
    name: '=Cable',
    revision: '01',
    changes: ['Размер: 1 → 2', 'Second change'],
  }));
  const workbook = buildChangeLogWorkbook(entries, {
    fileName: 'history',
    showItem: true,
    showRevision: true,
  });
  const parsed = XLSX.read(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }), {
    type: 'buffer',
  });
  const sheet = parsed.Sheets['Change log'];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  expect(rows).toHaveLength(24);
  expect(rows[0]).toEqual(['Item', 'Who', 'When', 'Revision', 'Changes']);
  expect(rows[23]).toEqual([
    '=Cable',
    'Иван',
    '2026-09-17T12:30:00Z',
    '01',
    'Размер: 1 → 2\nSecond change',
  ]);
  expect(sheet.A2.t).toBe('s');
  expect(sheet.A2.f).toBeUndefined();
});

it('omits item and revision columns for individual histories', () => {
  const workbook = buildChangeLogWorkbook([], { fileName: 'history' });
  expect(XLSX.utils.sheet_to_json(workbook.Sheets['Change log'], { header: 1 })).toEqual([
    ['Who', 'When', 'Changes'],
  ]);
});
